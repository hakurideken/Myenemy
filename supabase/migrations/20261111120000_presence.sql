-- Myenemy – stav kamarádů: online / ve hře / offline.
-- Spustit po 20261110120000_invites.sql: Dashboard → SQL Editor → celý soubor → Run.
-- Bezpečné spustit znovu.
--
-- * Hra se ozve (ping) každých ~15 s, jen ve viditelné záložce; při zavření stránky se
--   odhlásí (presence_offline). Online = ozval se v posledních 45 s.
-- * Ukládá se jen čas posledního ozvání a jestli hráč zrovna hraje. Vidí to jen kamarádi
--   (přes my_friends) – a jen u toho, kdo má zapnuté „Ukazovat kamarádům, že jsem online“.
--   Kdo ho vypne, je pro ostatní vždy offline a čas se mu přestane ukládat.
-- * Čas posledního ozvání se kamarádům neukazuje – jen výsledný stav.

alter table public.profiles add column if not exists last_seen timestamptz;
alter table public.profiles add column if not exists in_match boolean not null default false;
alter table public.profiles add column if not exists show_online boolean not null default true;

-- Klient z profilu dál smí číst jen id, přezdívku a kód (granty z části A se nemění).

-- Ozvání + souhrn upozornění jedním voláním (místo my_notifications).
create or replace function public.ping(p_in_match boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  visible boolean;
  want boolean := coalesce(p_in_match, false);
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select p.show_online into visible from public.profiles p where p.id = uid;
  -- Zapisovat nejvýš jednou za 10 s a při změně „ve hře“ (ochrana databáze před spamem).
  if visible then
    update public.profiles p
      set last_seen = now(), in_match = want
      where p.id = uid
        and (p.last_seen is null
             or p.last_seen < now() - interval '10 seconds'
             or p.in_match is distinct from want);
  end if;
  return public.my_notifications() || jsonb_build_object('show_online', coalesce(visible, true));
end;
$$;

-- Zavírám stránku / odhlašuji se: hned offline.
create or replace function public.presence_offline()
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
  update public.profiles p set last_seen = null, in_match = false where p.id = uid;
end;
$$;

-- Přepínač v Nastavení. Vypnutí zároveň smaže uložený čas ozvání.
create or replace function public.set_show_online(p_show boolean)
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
  update public.profiles p
    set show_online = coalesce(p_show, true),
        last_seen = case when coalesce(p_show, true) then p.last_seen else null end,
        in_match = case when coalesce(p_show, true) then p.in_match else false end
    where p.id = uid;
end;
$$;

-- Úklid rozšířený o staré časy ozvání (po 10 minutách nečinnosti se smažou).
create index if not exists profiles_last_seen_idx
  on public.profiles (last_seen) where last_seen is not null;

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
  update public.profiles set last_seen = null, in_match = false
    where last_seen < now() - interval '10 minutes';
$$;
revoke all on function public.myenemy_cleanup() from public, anon, authenticated;

-- Kamarádi s výsledným stavem (online / playing / offline); online nahoře.
drop function if exists public.my_friends();
create function public.my_friends()
returns table (
  id uuid, nickname text, tag smallint, wins integer, losses integer, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.nickname, p.tag,
    (select count(*)::integer from public.friend_matches m
       where m.user_a = f.user_a and m.user_b = f.user_b and m.winner = (select auth.uid())),
    (select count(*)::integer from public.friend_matches m
       where m.user_a = f.user_a and m.user_b = f.user_b and m.winner = p.id),
    case
      when p.show_online and p.last_seen > now() - interval '45 seconds'
        then case when p.in_match then 'playing' else 'online' end
      else 'offline'
    end
  from public.friendships f
  join public.profiles p
    on p.id = case when f.user_a = (select auth.uid()) then f.user_b else f.user_a end
  where (select auth.uid()) in (f.user_a, f.user_b)
  order by
    (p.show_online and p.last_seen > now() - interval '45 seconds') desc,
    lower(p.nickname), p.tag;
$$;

revoke all on function public.ping(boolean) from public, anon;
revoke all on function public.presence_offline() from public, anon;
revoke all on function public.set_show_online(boolean) from public, anon;
revoke all on function public.my_friends() from public, anon;
grant execute on function public.ping(boolean) to authenticated;
grant execute on function public.presence_offline() to authenticated;
grant execute on function public.set_show_online(boolean) to authenticated;
grant execute on function public.my_friends() to authenticated;

-- Export dat rozšířený o stav online (čas posledního ozvání, přepínač).
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
        'created_at', p.created_at, 'nickname_changed_at', p.nickname_changed_at,
        'show_online', p.show_online, 'last_seen', p.last_seen, 'in_match', p.in_match
      )
      from public.profiles p where p.id = uid
    ),
    -- Bez stavu kamarádů (to jsou údaje jiné osoby).
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'nickname', f.nickname, 'tag', f.tag, 'wins', f.wins, 'losses', f.losses))
      from public.my_friends() f
    ), '[]'::jsonb),
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
