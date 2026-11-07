-- Myenemy – účty (část B+C): kamarádi, žádosti o přátelství, vzájemné výsledky.
-- Spustit až po 20261107120000_accounts.sql: Dashboard → SQL Editor → celý soubor → Run.
-- Bezpečné spustit znovu (if not exists / or replace).
--
-- Zásady (stejné jako v části A):
-- * Všechny tabulky mají RLS a ŽÁDNÉ politiky – klient k nim nemá přímý přístup.
--   Čte i zapisuje jen přes funkce níže (security definer), které pracují jen
--   s auth.uid() volajícího.
-- * Kamaráda jde přidat jen podle celého jména s kódem (Pepa#0042) – žádné hledání.
-- * Odeslané žádosti ukazují jméno z doby odeslání a neprůhledné id žádosti – odesílatel
--   se nedozví ani pozdější přezdívku, ani identifikátor účtu adresáta.
-- * Výsledek zápasu se započítá, jen když ho nahlásí OBA hráči shodně a jsou kamarádi.
--   Klíč zápasu je HMAC tajemstvím z párování (ECDH) – nezná ho ani pozorovatel kanálu.
-- * Limity počítají pokusy v samostatných záznamech (nevynulují se po spárování) a běží
--   pod zámkem uživatele, aby je neobešla souběžná volání.

-- ---------------------------------------------------------------------------
-- Tabulky
-- ---------------------------------------------------------------------------

create table if not exists public.friend_requests (
  -- Neprůhledné id žádosti (klient pracuje s ním, ne s id účtů).
  id uuid not null default gen_random_uuid() unique,
  sender uuid not null references auth.users (id) on delete cascade,
  recipient uuid not null references auth.users (id) on delete cascade,
  -- Jméno adresáta v době odeslání (to vidí odesílatel v „Odeslané žádosti“).
  recipient_nickname text not null,
  recipient_tag smallint not null,
  created_at timestamptz not null default now(),
  primary key (sender, recipient),
  constraint friend_requests_not_self check (sender <> recipient)
);
create index if not exists friend_requests_recipient on public.friend_requests (recipient);

-- Odmítnutá žádost: odesílatel ji 30 dní nemůže poslat znovu (nepozná to – vidí „odesláno“).
create table if not exists public.friend_declines (
  sender uuid not null references auth.users (id) on delete cascade,
  recipient uuid not null references auth.users (id) on delete cascade,
  until timestamptz not null,
  primary key (sender, recipient)
);
create index if not exists friend_declines_until on public.friend_declines (until);

-- Záznam každého pokusu o žádost (i nepovedeného) – limit 20 za den.
create table if not exists public.friend_request_log (
  sender uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists friend_request_log_sender on public.friend_request_log (sender, created_at);
create index if not exists friend_request_log_created on public.friend_request_log (created_at);

-- Přátelství je symetrické: jeden řádek na dvojici, user_a < user_b.
create table if not exists public.friendships (
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint friendships_ordered check (user_a < user_b)
);
create index if not exists friendships_user_b on public.friendships (user_b);

-- Hlášení výsledku od jednoho hráče; čeká na hlášení soupeře (pak se smaže po 2 dnech).
create table if not exists public.match_reports (
  match_key text not null,
  reporter uuid not null references auth.users (id) on delete cascade,
  won boolean not null,
  created_at timestamptz not null default now(),
  primary key (match_key, reporter),
  constraint match_reports_key check (match_key ~ '^[0-9a-f]{64}$')
);
create index if not exists match_reports_created on public.match_reports (created_at);

-- Záznam každého hlášení – limit 100 za den (řádky v match_reports se po spárování mažou).
create table if not exists public.match_report_log (
  reporter uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists match_report_log_reporter on public.match_report_log (reporter, created_at);
create index if not exists match_report_log_created on public.match_report_log (created_at);

-- Potvrzené zápasy mezi kamarády (z nich se počítá skóre výher a proher).
create table if not exists public.friend_matches (
  match_key text primary key,
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  winner uuid not null,
  played_at timestamptz not null default now(),
  constraint friend_matches_ordered check (user_a < user_b),
  constraint friend_matches_winner check (winner = user_a or winner = user_b)
);
create index if not exists friend_matches_pair on public.friend_matches (user_a, user_b, played_at);

alter table public.friend_requests enable row level security;
alter table public.friend_declines enable row level security;
alter table public.friend_request_log enable row level security;
alter table public.friendships enable row level security;
alter table public.match_reports enable row level security;
alter table public.match_report_log enable row level security;
alter table public.friend_matches enable row level security;

revoke all on public.friend_requests from anon, authenticated;
revoke all on public.friend_declines from anon, authenticated;
revoke all on public.friend_request_log from anon, authenticated;
revoke all on public.friendships from anon, authenticated;
revoke all on public.match_reports from anon, authenticated;
revoke all on public.match_report_log from anon, authenticated;
revoke all on public.friend_matches from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Úklid starých záznamů (volá se z funkcí; volitelně i z pg_cron – viz konec souboru)
-- ---------------------------------------------------------------------------

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
$$;
revoke all on function public.myenemy_cleanup() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Žádost o přátelství podle celého jména s kódem
-- Vrací stav: sent | accepted | already-friends | already-sent | not-found | self | no-profile
-- (stav místo výjimky, aby se pokus zapsal do limitu i když se nepovede).
-- ---------------------------------------------------------------------------

create or replace function public.send_friend_request(p_nickname text, p_tag integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target uuid;
  target_nickname text;
  target_tag smallint;
  a uuid;
  b uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Souběžná volání téhož hráče jedno po druhém (jinak by obešla limit).
  perform pg_advisory_xact_lock(hashtextextended('fr-user:' || uid::text, 0));
  if not exists (select 1 from public.profiles p where p.id = uid) then
    return 'no-profile';
  end if;
  perform public.myenemy_cleanup();
  -- Limit: 20 pokusů za den, nejvýš 50 nevyřízených odeslaných žádostí.
  if (select count(*) from public.friend_request_log l
        where l.sender = uid and l.created_at > now() - interval '1 day') >= 20
     or (select count(*) from public.friend_requests r where r.sender = uid) >= 50 then
    raise exception 'limit' using errcode = 'MYE04';
  end if;
  insert into public.friend_request_log (sender) values (uid);

  if p_nickname is null or char_length(p_nickname) > 64 or p_tag is null
     or p_tag < 1 or p_tag > 9999 then
    return 'not-found';
  end if;
  select p.id, p.nickname, p.tag into target, target_nickname, target_tag
    from public.profiles p
    where lower(normalize(p.nickname, NFKC)) = lower(normalize(btrim(p_nickname, ' '), NFKC))
      and p.tag = p_tag;
  if target is null then
    return 'not-found';
  end if;
  if target = uid then
    return 'self';
  end if;
  a := least(uid, target);
  b := greatest(uid, target);
  -- Dvojice hráčů jedna po druhé (souběžné vzájemné žádosti → přátelství, ne dvě žádosti).
  perform pg_advisory_xact_lock(hashtextextended('fr-pair:' || a::text || b::text, 0));
  if exists (select 1 from public.friendships f where f.user_a = a and f.user_b = b) then
    return 'already-friends';
  end if;
  -- Druhý už žádost poslal mně → rovnou přátelé.
  if exists (select 1 from public.friend_requests r where r.sender = target and r.recipient = uid) then
    delete from public.friend_requests r
      where (r.sender = target and r.recipient = uid) or (r.sender = uid and r.recipient = target);
    insert into public.friendships (user_a, user_b) values (a, b) on conflict do nothing;
    return 'accepted';
  end if;
  if exists (select 1 from public.friend_requests r where r.sender = uid and r.recipient = target) then
    return 'already-sent';
  end if;
  -- Nedávno odmítnuto: tváří se jako odesláno, ale nic neuloží (adresát nedostane spam).
  if exists (select 1 from public.friend_declines d
               where d.sender = uid and d.recipient = target and d.until > now()) then
    return 'sent';
  end if;
  insert into public.friend_requests (sender, recipient, recipient_nickname, recipient_tag)
    values (uid, target, target_nickname, target_tag);
  return 'sent';
end;
$$;

-- Odebrat kamaráda – smažou se i vzájemné výsledky; odebraný 30 dní nemůže poslat
-- novou žádost (jako po odmítnutí).
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
  insert into public.friend_declines (sender, recipient, until)
    select p_friend, uid, now() + interval '30 days'
    where p_friend <> uid and exists (select 1 from auth.users u where u.id = p_friend)
    on conflict (sender, recipient) do update set until = excluded.until;
end;
$$;

-- ---------------------------------------------------------------------------
-- Čtení: moji kamarádi (se skóre z mého pohledu) a žádosti
-- ---------------------------------------------------------------------------

create or replace function public.my_friends()
returns table (id uuid, nickname text, tag smallint, wins integer, losses integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.nickname, p.tag,
    (select count(*)::integer from public.friend_matches m
       where m.user_a = f.user_a and m.user_b = f.user_b and m.winner = (select auth.uid())),
    (select count(*)::integer from public.friend_matches m
       where m.user_a = f.user_a and m.user_b = f.user_b and m.winner = p.id)
  from public.friendships f
  join public.profiles p
    on p.id = case when f.user_a = (select auth.uid()) then f.user_b else f.user_a end
  where (select auth.uid()) in (f.user_a, f.user_b)
  order by lower(p.nickname), p.tag;
$$;

-- id = id žádosti. Příchozí: aktuální jméno odesílatele; odeslané: jméno z doby odeslání.
create or replace function public.my_friend_requests()
returns table (id uuid, nickname text, tag smallint, incoming boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, p.nickname, p.tag, true, r.created_at
    from public.friend_requests r join public.profiles p on p.id = r.sender
    where r.recipient = (select auth.uid())
  union all
  select r.id, r.recipient_nickname, r.recipient_tag, false, r.created_at
    from public.friend_requests r
    where r.sender = (select auth.uid())
  order by 5 desc
  limit 200;
$$;

-- ---------------------------------------------------------------------------
-- Hlášení výsledku online zápasu
-- Vrací: pending (čeká na soupeře) | recorded (započteno) | ignored (nesoulad,
-- nejsou kamarádi, duplicita, příliš mnoho zápasů dvojice za den).
-- ---------------------------------------------------------------------------

create or replace function public.report_match(p_match_key text, p_won boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  other record;
  others integer;
  a uuid;
  b uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_match_key is null or p_match_key !~ '^[0-9a-f]{64}$' or p_won is null then
    return 'ignored';
  end if;
  -- Nejdřív zámek hráče (limit), pak zámek zápasu (obě hlášení jedno po druhém).
  perform pg_advisory_xact_lock(hashtextextended('mr-user:' || uid::text, 0));
  perform public.myenemy_cleanup();
  if (select count(*) from public.match_report_log l
        where l.reporter = uid and l.created_at > now() - interval '1 day') >= 100 then
    raise exception 'limit' using errcode = 'MYE04';
  end if;
  insert into public.match_report_log (reporter) values (uid);
  perform pg_advisory_xact_lock(hashtextextended('mr-key:' || p_match_key, 0));

  if exists (select 1 from public.friend_matches m where m.match_key = p_match_key) then
    return 'ignored';
  end if;
  insert into public.match_reports (match_key, reporter, won)
    values (p_match_key, uid, p_won)
    on conflict do nothing;
  if not found then
    return 'ignored';
  end if;

  select count(*) into others from public.match_reports r
    where r.match_key = p_match_key and r.reporter <> uid;
  if others = 0 then
    return 'pending';
  end if;
  if others > 1 then
    return 'ignored';
  end if;
  select r.reporter, r.won into other from public.match_reports r
    where r.match_key = p_match_key and r.reporter <> uid;
  -- Shoda: jeden vyhrál, druhý prohrál.
  if other.won = p_won then
    return 'ignored';
  end if;
  a := least(uid, other.reporter);
  b := greatest(uid, other.reporter);
  if not exists (select 1 from public.friendships f where f.user_a = a and f.user_b = b) then
    return 'ignored';
  end if;
  -- Strop na dvojici: nejvýš 50 zápasů za den (ochrana místa v databázi).
  if (select count(*) from public.friend_matches m
        where m.user_a = a and m.user_b = b and m.played_at > now() - interval '1 day') >= 50 then
    return 'ignored';
  end if;
  insert into public.friend_matches (match_key, user_a, user_b, winner)
    values (p_match_key, a, b, case when p_won then uid else other.reporter end)
    on conflict do nothing;
  delete from public.match_reports r where r.match_key = p_match_key;
  return 'recorded';
end;
$$;

-- ---------------------------------------------------------------------------
-- Práva: jen přihlášení, jen tyto funkce
-- ---------------------------------------------------------------------------

-- Žádosti se přijímají / ruší podle id žádosti. Starší verze funkcí (se stejnými typy,
-- jinými názvy parametrů) nejde přepsat přes „or replace“ – proto drop a znovu.
drop function if exists public.respond_friend_request(uuid, boolean) cascade;
drop function if exists public.cancel_friend_request(uuid) cascade;

-- Přijmout / odmítnout žádost, kterou jsem dostal. Odmítnutí = 30 dní bez nové žádosti.
create or replace function public.respond_friend_request(p_request uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  requester uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.friend_requests r
    where r.id = p_request and r.recipient = uid
    returning r.sender into requester;
  if requester is null then
    return;
  end if;
  if p_accept then
    insert into public.friendships (user_a, user_b)
      values (least(uid, requester), greatest(uid, requester))
      on conflict do nothing;
    delete from public.friend_requests r where r.sender = uid and r.recipient = requester;
  else
    insert into public.friend_declines (sender, recipient, until)
      values (requester, uid, now() + interval '30 days')
      on conflict (sender, recipient) do update set until = excluded.until;
  end if;
end;
$$;

-- Zrušit žádost, kterou jsem poslal.
create or replace function public.cancel_friend_request(p_request uuid)
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
  delete from public.friend_requests r where r.id = p_request and r.sender = uid;
end;
$$;

revoke all on function public.send_friend_request(text, integer) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.cancel_friend_request(uuid) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.my_friends() from public, anon;
revoke all on function public.my_friend_requests() from public, anon;
revoke all on function public.report_match(text, boolean) from public, anon;

grant execute on function public.send_friend_request(text, integer) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.my_friend_requests() to authenticated;
grant execute on function public.report_match(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Export dat (část A) rozšířený o kamarády, žádosti, odmítnutí, hlášení a zápasy
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Volitelně: pravidelný úklid i bez provozu (Database → Extensions → zapnout pg_cron),
-- pak spustit zvlášť:
--   select cron.schedule('myenemy-cleanup', '17 * * * *', 'select public.myenemy_cleanup()');
--
-- Kontrola po spuštění (má vrátit 0 řádků = všechny tabulky v public mají RLS):
-- select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
-- ---------------------------------------------------------------------------
