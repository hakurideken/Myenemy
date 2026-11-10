-- Myenemy – pozvánky do hry mezi kamarády a souhrn upozornění.
-- Spustit po 20261108120000_friends.sql: Dashboard → SQL Editor → celý soubor → Run.
-- Bezpečné spustit znovu.
--
-- * Pozvat jde jen kamaráda; pozvánka nese kód online místnosti a platí 10 minut.
-- * Od jednoho hráče jednomu kamarádovi je nejvýš jedna pozvánka (novější přepíše starší).
-- * Limit 30 pozvánek za hodinu (záznam pokusů zvlášť, pod zámkem hráče).
-- * Tabulky RLS bez politik, přístup jen přes security definer funkce.

create table if not exists public.game_invites (
  id uuid not null default gen_random_uuid() unique,
  sender uuid not null references auth.users (id) on delete cascade,
  recipient uuid not null references auth.users (id) on delete cascade,
  room text not null,
  created_at timestamptz not null default now(),
  primary key (sender, recipient),
  constraint game_invites_room check (room ~ '^[A-HJ-NP-Z2-9]{5}$'),
  constraint game_invites_not_self check (sender <> recipient)
);
create index if not exists game_invites_recipient on public.game_invites (recipient, created_at);
create index if not exists game_invites_created on public.game_invites (created_at);

create table if not exists public.game_invite_log (
  sender uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists game_invite_log_sender on public.game_invite_log (sender, created_at);
create index if not exists game_invite_log_created on public.game_invite_log (created_at);

alter table public.game_invites enable row level security;
alter table public.game_invite_log enable row level security;
revoke all on public.game_invites from anon, authenticated;
revoke all on public.game_invite_log from anon, authenticated;

-- Úklid rozšířený o pozvánky (starší než 10 minut) a jejich záznamy (starší než den).
create or replace function public.myenemy_cleanup()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.match_reports where created_at < now() - interval '2 days';
  delete from public.match_report_log where created_at < now() - interval '2 days';
  delete from public.friend_request_log where created_at < now() - interval '2 days';
  delete from public.friend_declines where until < now();
  delete from public.game_invites where created_at < now() - interval '10 minutes';
  delete from public.game_invite_log where created_at < now() - interval '1 day';
$$;
revoke all on function public.myenemy_cleanup() from public, anon, authenticated;

-- Pozvat kamaráda do místnosti. Vrací: sent | not-friends.
create or replace function public.send_game_invite(p_friend uuid, p_room text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_room is null or p_room !~ '^[A-HJ-NP-Z2-9]{5}$' or p_friend is null then
    return 'not-friends';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gi-user:' || uid::text, 0));
  perform public.myenemy_cleanup();
  if (select count(*) from public.game_invite_log l
        where l.sender = uid and l.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'limit' using errcode = 'MYE04';
  end if;
  insert into public.game_invite_log (sender) values (uid);
  if not exists (
    select 1 from public.friendships f
    where f.user_a = least(uid, p_friend) and f.user_b = greatest(uid, p_friend)
  ) then
    return 'not-friends';
  end if;
  -- Stejnému kamarádovi nejvýš jednou za 30 s (opakované „pípání“ se tváří jako odesláno).
  if exists (
    select 1 from public.game_invites i
    where i.sender = uid and i.recipient = p_friend and i.created_at > now() - interval '30 seconds'
  ) then
    return 'sent';
  end if;
  -- Do stejné místnosti zůstane stejná pozvánka (neozve se znovu jako nová).
  insert into public.game_invites as g (sender, recipient, room)
    values (uid, p_friend, p_room)
    on conflict (sender, recipient)
      do update set room = excluded.room, created_at = now(),
        id = case when g.room = excluded.room then g.id else gen_random_uuid() end;
  return 'sent';
end;
$$;

-- Odmítnout / odklidit pozvánku (i po přijetí).
create or replace function public.dismiss_game_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.game_invites i where i.id = p_invite and i.recipient = uid;
end;
$$;

-- Hostitel ruší místnost (bez soupeře): pozvánky do ní zmizí.
create or replace function public.cancel_game_invites(p_room text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.game_invites i where i.sender = uid and i.room = p_room;
end;
$$;
revoke all on function public.cancel_game_invites(text) from public, anon;
grant execute on function public.cancel_game_invites(text) to authenticated;

-- Souhrn pro průběžné obnovování (jedno volání): počet žádostí o přátelství a platné
-- pozvánky do hry (jen od současných kamarádů).
create or replace function public.my_notifications()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'requests', (
      select count(*) from public.friend_requests r where r.recipient = (select auth.uid())
    ),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'nickname', x.nickname, 'tag', x.tag, 'room', x.room,
        'created_at', x.created_at) order by x.created_at desc)
      from (
        select i.id, p.nickname, p.tag, i.room, i.created_at
        from public.game_invites i
        join public.profiles p on p.id = i.sender
        where i.recipient = (select auth.uid())
          and i.created_at > now() - interval '10 minutes'
          and exists (
            select 1 from public.friendships f
            where f.user_a = least(i.sender, i.recipient) and f.user_b = greatest(i.sender, i.recipient)
          )
        order by i.created_at desc
        limit 20
      ) x
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.send_game_invite(uuid, text) from public, anon;
revoke all on function public.dismiss_game_invite(uuid) from public, anon;
revoke all on function public.my_notifications() from public, anon;
grant execute on function public.send_game_invite(uuid, text) to authenticated;
grant execute on function public.dismiss_game_invite(uuid) to authenticated;
grant execute on function public.my_notifications() to authenticated;

-- Odebrání kamaráda smaže i pozvánky mezi vámi (navíc k části B).
create or replace function public.remove_friend(p_friend uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.friendships f
    where f.user_a = least(uid, p_friend) and f.user_b = greatest(uid, p_friend);
  delete from public.friend_matches m
    where m.user_a = least(uid, p_friend) and m.user_b = greatest(uid, p_friend);
  delete from public.game_invites i
    where (i.sender = uid and i.recipient = p_friend) or (i.sender = p_friend and i.recipient = uid);
  insert into public.friend_declines (sender, recipient, until)
    select p_friend, uid, now() + interval '30 days'
    where p_friend <> uid and exists (select 1 from auth.users u where u.id = p_friend)
    on conflict (sender, recipient) do update set until = excluded.until;
end;
$$;
revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated;

-- Export dat rozšířený o pozvánky do hry.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'account', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'providers', u.raw_app_meta_data -> 'providers',
      'provider_data', u.raw_user_meta_data
    ),
    'profile', (
      select jsonb_build_object(
        'nickname', p.nickname, 'tag', p.tag,
        'created_at', p.created_at, 'nickname_changed_at', p.nickname_changed_at
      )
      from public.profiles p where p.id = uid
    ),
    'friends', coalesce((select jsonb_agg(to_jsonb(f)) from public.my_friends() f), '[]'::jsonb),
    'friend_requests_sent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'to', r.recipient_nickname || '#' || lpad(r.recipient_tag::text, 4, '0'),
        'created_at', r.created_at))
      from public.friend_requests r where r.sender = uid
    ), '[]'::jsonb),
    'friend_requests_received', coalesce((
      select jsonb_agg(jsonb_build_object(
        'from', p.nickname || '#' || lpad(p.tag::text, 4, '0'),
        'created_at', r.created_at))
      from public.friend_requests r join public.profiles p on p.id = r.sender
      where r.recipient = uid
    ), '[]'::jsonb),
    'friend_requests_declined_by_me', coalesce((
      select jsonb_agg(jsonb_build_object('blocked_until', d.until))
      from public.friend_declines d where d.recipient = uid
    ), '[]'::jsonb),
    'friend_request_attempts_last_2_days',
      (select count(*) from public.friend_request_log l where l.sender = uid),
    'match_reports_pending', coalesce((
      select jsonb_agg(jsonb_build_object(
        'match_key', r.match_key, 'won', r.won, 'created_at', r.created_at))
      from public.match_reports r where r.reporter = uid
    ), '[]'::jsonb),
    'match_report_attempts_last_2_days',
      (select count(*) from public.match_report_log l where l.reporter = uid),
    'game_invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'direction', case when i.sender = uid then 'sent' else 'received' end,
        'with', p.nickname || '#' || lpad(p.tag::text, 4, '0'),
        'room', i.room, 'created_at', i.created_at))
      from public.game_invites i
      left join public.profiles p
        on p.id = case when i.sender = uid then i.recipient else i.sender end
      where uid in (i.sender, i.recipient)
    ), '[]'::jsonb),
    'game_invite_attempts_last_day',
      (select count(*) from public.game_invite_log l where l.sender = uid),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'played_at', m.played_at,
        'opponent', case when m.user_a = uid then m.user_b else m.user_a end,
        'won', m.winner = uid))
      from public.friend_matches m where uid in (m.user_a, m.user_b)
    ), '[]'::jsonb)
  ) into result
  from auth.users u where u.id = uid;
  return result;
end;
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
