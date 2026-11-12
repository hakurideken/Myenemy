-- Myenemy – turnaje (vyřazovací pavouk pro 4, 8 nebo 16 hráčů, volná místa doplní AI).
-- Spustit po 20261111120000_presence.sql: Dashboard → SQL Editor → celý soubor → Run.
-- Bezpečné spustit znovu.
--
-- * Turnaj je jen pro přihlášené s přezdívkou. Hráč je nejvýš v jednom turnaji naráz.
-- * Organizátor založí turnaj (dostane šestiznakový kód), ostatní se připojí kódem nebo
--   pozvánkou od kamaráda. Po spuštění se volná místa doplní AI (střední obtížnost)
--   a pavouk se vylosuje. Zápas AI proti AI se rozhodne hned (simulace).
-- * Každý zápas je best of 9. Zápas dvou hráčů hlásí OBA – při shodě vítěz postoupí,
--   při neshodě se zápas opakuje (potřetí rozhodne los). Zápas proti AI hlásí hráč sám.
-- * Kdo se 3 minuty neozve (zavřel hru), prohraje svůj zápas kontumací. Jediné hlášení
--   platí, jen když soupeř 3 minuty mlčí (je pryč). Zápas bez shody do 45 minut se počítá
--   jako neshoda – turnaj tak vždy doběhne. Skóre se uloží jen při shodě obou hlášení.
-- * Místnost zakládá horní hráč; když ji 2 minuty nezaloží (nebo nefunguje), smí dolní.
-- * Hraje se i o 3. místo (poražení semifinalisté).
-- * Tabulky RLS bez politik, přístup jen přes security definer funkce níže.

-- ---------------------------------------------------------------------------
-- Tabulky
-- ---------------------------------------------------------------------------

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  -- Po smazání účtu organizátora turnaj běží dál (bez organizátora).
  organizer uuid references auth.users (id) on delete set null,
  status text not null default 'lobby',
  size smallint,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  advanced_at timestamptz,
  constraint tournaments_code check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  constraint tournaments_status check (status in ('lobby', 'running', 'finished')),
  constraint tournaments_size check (size is null or size in (4, 8, 16))
);
create index if not exists tournaments_created on public.tournaments (created_at);

-- Účastníci: hráči (player) i AI (is_ai). Jméno se uloží při připojení.
create table if not exists public.tournament_entries (
  id bigint generated always as identity primary key,
  tournament uuid not null references public.tournaments (id) on delete cascade,
  -- Smazaný účet = null (v pavouku zůstane jméno, zápasy prohraje kontumací).
  player uuid references auth.users (id) on delete set null,
  is_ai boolean not null default false,
  -- Pozice v pavouku (0 … size-1); v lobby null.
  slot smallint,
  nickname text not null,
  tag smallint not null,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  left_at timestamptz,
  constraint tournament_entries_slot check (slot is null or slot between 0 and 15),
  constraint tournament_entries_ai check (not is_ai or player is null)
);
create unique index if not exists tournament_entries_player
  on public.tournament_entries (tournament, player) where player is not null;
create unique index if not exists tournament_entries_slot
  on public.tournament_entries (tournament, slot) where slot is not null;
create index if not exists tournament_entries_by_player
  on public.tournament_entries (player) where player is not null;

-- Zápasy pavouka: kolo 1 … R (R = finále), v kole R je idx 0 finále a idx 1 o 3. místo.
-- slot_a / slot_b = pozice účastníků; null = zatím se neví (čeká na vítěze).
create table if not exists public.tournament_matches (
  tournament uuid not null references public.tournaments (id) on delete cascade,
  round smallint not null,
  idx smallint not null,
  slot_a smallint,
  slot_b smallint,
  status text not null default 'waiting',
  ready_at timestamptz,
  -- Kód online místnosti, kterou založil hráč A (vidí ho jen hráči zápasu).
  room text,
  room_at timestamptz,
  winner smallint,
  score_a smallint,
  score_b smallint,
  how text,
  -- Hlášení obou hráčů (vítěz a skóre z pohledu A : B).
  rep_a smallint,
  rep_a_sa smallint,
  rep_a_sb smallint,
  rep_b smallint,
  rep_b_sa smallint,
  rep_b_sb smallint,
  first_report_at timestamptz,
  mismatches smallint not null default 0,
  primary key (tournament, round, idx),
  constraint tournament_matches_status check (status in ('waiting', 'ready', 'done')),
  constraint tournament_matches_room check (room is null or room ~ '^[A-HJ-NP-Z2-9]{5}$'),
  constraint tournament_matches_how check (how is null or how in ('played', 'ai', 'walkover', 'random'))
);

alter table public.tournament_matches add column if not exists room_at timestamptz;

create table if not exists public.tournament_invites (
  tournament uuid not null references public.tournaments (id) on delete cascade,
  sender uuid not null references auth.users (id) on delete cascade,
  recipient uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tournament, recipient),
  constraint tournament_invites_not_self check (sender <> recipient)
);
create index if not exists tournament_invites_recipient on public.tournament_invites (recipient);
create index if not exists tournament_invites_created on public.tournament_invites (created_at);

-- Záznam pokusů (založení, připojení kódem) – limity proti zkoušení kódů a spamu.
create table if not exists public.tournament_log (
  player uuid not null references auth.users (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now(),
  constraint tournament_log_action check (action in ('create', 'join'))
);
create index if not exists tournament_log_player on public.tournament_log (player, action, created_at);
create index if not exists tournament_log_created on public.tournament_log (created_at);

alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_invites enable row level security;
alter table public.tournament_log enable row level security;
revoke all on public.tournaments from anon, authenticated;
revoke all on public.tournament_entries from anon, authenticated;
revoke all on public.tournament_matches from anon, authenticated;
revoke all on public.tournament_invites from anon, authenticated;
revoke all on public.tournament_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Úklid rozšířený o turnaje
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
  delete from public.game_invites where created_at < now() - interval '10 minutes';
  delete from public.game_invite_log where created_at < now() - interval '1 day';
  update public.profiles set last_seen = null, in_match = false
    where last_seen < now() - interval '10 minutes';
  -- Nespuštěné lobby den, rozehraný turnaj 2 dny, dohraný týden.
  delete from public.tournaments
    where (status = 'lobby' and created_at < now() - interval '1 day')
       or (status = 'running' and started_at < now() - interval '2 days')
       or (status = 'finished' and finished_at < now() - interval '7 days');
  delete from public.tournament_invites where created_at < now() - interval '1 hour';
  delete from public.tournament_log where created_at < now() - interval '1 day';
$$;
revoke all on function public.myenemy_cleanup() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Vnitřní pomocné funkce (klient je volat nesmí)
-- ---------------------------------------------------------------------------

-- Turnaj, ve kterém hráč právě je (nejvýš jeden).
create or replace function public.tournament_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.tournament
  from public.tournament_entries e
  where e.player = p_user and e.left_at is null
  order by e.joined_at desc
  limit 1;
$$;
revoke all on function public.tournament_of(uuid) from public, anon, authenticated;

-- Dohrané turnaje, ze kterých hráč ještě neodešel, uzavřít (před založením / připojením).
create or replace function public.tournament_release(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tournament_entries e set left_at = now()
  where e.player = p_user and e.left_at is null
    and exists (
      select 1 from public.tournaments t where t.id = e.tournament and t.status = 'finished'
    );
$$;
revoke all on function public.tournament_release(uuid) from public, anon, authenticated;

-- Posun pavouku: rozhodne zápasy, které už rozhodnout jde (AI proti AI, kontumace,
-- shodná hlášení), a posune vítěze (a poražené semifinalisty) dál. Volá se pod zámkem
-- turnaje.
create or replace function public.tournament_advance(p_tournament uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  m record;
  ea record;
  eb record;
  rounds integer;
  changed boolean;
  v_winner smallint;
  v_loser smallint;
  v_sa smallint;
  v_sb smallint;
  v_how text;
  a_ai boolean;
  b_ai boolean;
  a_gone boolean;
  b_gone boolean;
  a_stale boolean;
  b_stale boolean;
  v_reset boolean;
  stale constant interval := interval '3 minutes';
begin
  select * into t from public.tournaments x where x.id = p_tournament;
  if not found or t.status <> 'running' then
    return;
  end if;
  rounds := case t.size when 4 then 2 when 8 then 3 else 4 end;
  loop
    changed := false;
    update public.tournament_matches x
      set status = 'ready', ready_at = now()
      where x.tournament = p_tournament and x.status = 'waiting'
        and x.slot_a is not null and x.slot_b is not null;
    if found then
      changed := true;
    end if;

    for m in
      select * from public.tournament_matches x
      where x.tournament = p_tournament and x.status = 'ready'
      order by x.round, x.idx
    loop
      select * into ea from public.tournament_entries e
        where e.tournament = p_tournament and e.slot = m.slot_a;
      select * into eb from public.tournament_entries e
        where e.tournament = p_tournament and e.slot = m.slot_b;
      a_ai := ea.is_ai;
      b_ai := eb.is_ai;
      a_gone := not ea.is_ai and (ea.player is null or ea.left_at is not null);
      b_gone := not eb.is_ai and (eb.player is null or eb.left_at is not null);
      a_stale := not a_ai and not a_gone and ea.last_seen < now() - stale;
      b_stale := not b_ai and not b_gone and eb.last_seen < now() - stale;
      v_winner := null;
      v_sa := null;
      v_sb := null;
      v_how := null;
      v_reset := false;

      if (a_ai or a_gone) and (b_ai or b_gone) then
        -- Žádný přítomný hráč: AI proti AI se nasimuluje, jinak kontumace / los.
        if a_gone and not b_gone then
          v_winner := m.slot_b;
          v_how := 'walkover';
        elsif b_gone and not a_gone then
          v_winner := m.slot_a;
          v_how := 'walkover';
        else
          v_winner := case when random() < 0.5 then m.slot_a else m.slot_b end;
          v_how := case when a_ai and b_ai then 'ai' else 'random' end;
        end if;
      elsif a_gone then
        v_winner := m.slot_b;
        v_how := 'walkover';
      elsif b_gone then
        v_winner := m.slot_a;
        v_how := 'walkover';
      elsif a_ai then
        -- Hráč B proti AI: platí jeho hlášení.
        if m.rep_b is not null then
          v_winner := m.rep_b;
          v_sa := m.rep_b_sa;
          v_sb := m.rep_b_sb;
          v_how := 'played';
        elsif b_stale and m.ready_at < now() - stale then
          v_winner := m.slot_a;
          v_how := 'walkover';
        end if;
      elsif b_ai then
        if m.rep_a is not null then
          v_winner := m.rep_a;
          v_sa := m.rep_a_sa;
          v_sb := m.rep_a_sb;
          v_how := 'played';
        elsif a_stale and m.ready_at < now() - stale then
          v_winner := m.slot_b;
          v_how := 'walkover';
        end if;
      elsif m.rep_a is not null and m.rep_b is not null then
        -- Dva hráči: rozhoduje shoda hlášení.
        if m.rep_a = m.rep_b then
          v_winner := m.rep_a;
          -- Skóre jen když se shoduje i ono (jinak by ho určil jeden hráč).
          if m.rep_a_sa = m.rep_b_sa and m.rep_a_sb = m.rep_b_sb then
            v_sa := m.rep_a_sa;
            v_sb := m.rep_a_sb;
          end if;
          v_how := 'played';
        elsif m.mismatches >= 2 then
          v_winner := case when random() < 0.5 then m.slot_a else m.slot_b end;
          v_how := 'random';
        else
          v_reset := true;
          update public.tournament_matches x
            set rep_a = null, rep_a_sa = null, rep_a_sb = null,
                rep_b = null, rep_b_sa = null, rep_b_sb = null,
                first_report_at = null, room = null, room_at = null,
                mismatches = x.mismatches + 1, ready_at = now()
            where x.tournament = p_tournament and x.round = m.round and x.idx = m.idx;
        end if;
      elsif m.rep_a is not null and m.rep_b is null and b_stale
            and m.first_report_at < now() - stale then
        -- Soupeř po zápase odešel (3 minuty se neozval): platí jediné hlášení.
        v_winner := m.rep_a;
        v_sa := m.rep_a_sa;
        v_sb := m.rep_a_sb;
        v_how := 'played';
      elsif m.rep_b is not null and m.rep_a is null and a_stale
            and m.first_report_at < now() - stale then
        v_winner := m.rep_b;
        v_sa := m.rep_b_sa;
        v_sb := m.rep_b_sb;
        v_how := 'played';
      elsif m.rep_a is null and m.rep_b is null and m.ready_at < now() - stale then
        if a_stale and not b_stale then
          v_winner := m.slot_b;
          v_how := 'walkover';
        elsif b_stale and not a_stale then
          v_winner := m.slot_a;
          v_how := 'walkover';
        elsif a_stale and b_stale and m.ready_at < now() - interval '10 minutes' then
          v_winner := case when random() < 0.5 then m.slot_a else m.slot_b end;
          v_how := 'random';
        end if;
      end if;

      -- Dva přítomní hráči se do 45 minut neshodli (nebo vůbec nehráli): jako neshoda,
      -- potřetí los – turnaj tak vždy doběhne.
      if v_winner is null and not v_reset and not (a_ai or b_ai or a_gone or b_gone)
         and m.ready_at < now() - interval '45 minutes' then
        if m.mismatches >= 2 then
          v_winner := case when random() < 0.5 then m.slot_a else m.slot_b end;
          v_how := 'random';
        else
          update public.tournament_matches x
            set rep_a = null, rep_a_sa = null, rep_a_sb = null,
                rep_b = null, rep_b_sa = null, rep_b_sb = null,
                first_report_at = null, room = null, room_at = null,
                mismatches = x.mismatches + 1, ready_at = now()
            where x.tournament = p_tournament and x.round = m.round and x.idx = m.idx;
        end if;
      end if;

      if v_winner is not null then
        v_loser := case when v_winner = m.slot_a then m.slot_b else m.slot_a end;
        if v_how = 'ai' then
          -- Simulace best of 9: vítěz 5 výher, poražený 0–4.
          if v_winner = m.slot_a then
            v_sa := 5;
            v_sb := floor(random() * 5)::smallint;
          else
            v_sa := floor(random() * 5)::smallint;
            v_sb := 5;
          end if;
        end if;
        update public.tournament_matches x
          set status = 'done', winner = v_winner, score_a = v_sa, score_b = v_sb,
              how = v_how, room = null, room_at = null
          where x.tournament = p_tournament and x.round = m.round and x.idx = m.idx;
        if m.round < rounds then
          if m.idx % 2 = 0 then
            update public.tournament_matches x set slot_a = v_winner
              where x.tournament = p_tournament and x.round = m.round + 1 and x.idx = m.idx / 2;
          else
            update public.tournament_matches x set slot_b = v_winner
              where x.tournament = p_tournament and x.round = m.round + 1 and x.idx = m.idx / 2;
          end if;
          if m.round = rounds - 1 then
            -- Poražení semifinalisté hrají o 3. místo.
            if m.idx % 2 = 0 then
              update public.tournament_matches x set slot_a = v_loser
                where x.tournament = p_tournament and x.round = rounds and x.idx = 1;
            else
              update public.tournament_matches x set slot_b = v_loser
                where x.tournament = p_tournament and x.round = rounds and x.idx = 1;
            end if;
          end if;
        end if;
        changed := true;
      end if;
    end loop;
    exit when not changed;
  end loop;

  if not exists (
    select 1 from public.tournament_matches x
    where x.tournament = p_tournament and x.round = rounds and x.status <> 'done'
  ) then
    update public.tournaments x set status = 'finished', finished_at = now()
      where x.id = p_tournament;
  end if;
  update public.tournaments x set advanced_at = now() where x.id = p_tournament;
end;
$$;
revoke all on function public.tournament_advance(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Funkce pro klienta
-- ---------------------------------------------------------------------------

-- Založit turnaj. Vrací kód turnaje, nebo: no-profile | busy (už jsem v jiném turnaji).
create or replace function public.tournament_create()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  prof record;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  new_code text;
  new_id uuid;
  bytes bytea;
  tries integer := 0;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tour-user:' || uid::text, 0));
  select p.nickname, p.tag into prof from public.profiles p where p.id = uid;
  if not found then
    return 'no-profile';
  end if;
  if (select count(*) from public.tournament_log l
        where l.player = uid and l.action = 'create'
          and l.created_at > now() - interval '1 day') >= 20 then
    raise exception 'limit' using errcode = 'MYE04';
  end if;
  insert into public.tournament_log (player, action) values (uid, 'create');
  perform public.myenemy_cleanup();
  perform public.tournament_release(uid);
  if public.tournament_of(uid) is not null then
    return 'busy';
  end if;
  loop
    -- Kód z bezpečně náhodných bajtů (gen_random_uuid), 32 znaků = bez zkreslení.
    bytes := uuid_send(gen_random_uuid());
    new_code := '';
    for i in 0..5 loop
      new_code := new_code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.tournaments t where t.code = new_code);
    tries := tries + 1;
    if tries > 10 then
      raise exception 'no free code' using errcode = '23505';
    end if;
  end loop;
  insert into public.tournaments (code, organizer) values (new_code, uid) returning id into new_id;
  insert into public.tournament_entries (tournament, player, nickname, tag)
    values (new_id, uid, prof.nickname, prof.tag);
  return new_code;
end;
$$;

-- Připojit se kódem. Vrací: joined | not-found | started | full | busy | no-profile.
create or replace function public.tournament_join(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  prof record;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_id uuid;
  v_status text;
  current uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tour-user:' || uid::text, 0));
  if (select count(*) from public.tournament_log l
        where l.player = uid and l.action = 'join'
          and l.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'limit' using errcode = 'MYE04';
  end if;
  insert into public.tournament_log (player, action) values (uid, 'join');
  perform public.myenemy_cleanup();
  select p.nickname, p.tag into prof from public.profiles p where p.id = uid;
  if not found then
    return 'no-profile';
  end if;
  if v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    return 'not-found';
  end if;
  select x.id into v_id from public.tournaments x where x.code = v_code;
  if not found then
    return 'not-found';
  end if;
  perform public.tournament_release(uid);
  current := public.tournament_of(uid);
  if current = v_id then
    return 'joined';
  end if;
  if current is not null then
    return 'busy';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tour:' || v_id::text, 0));
  select x.status into v_status from public.tournaments x where x.id = v_id;
  if v_status is distinct from 'lobby' then
    return 'started';
  end if;
  if (select count(*) from public.tournament_entries e where e.tournament = v_id) >= 16 then
    return 'full';
  end if;
  insert into public.tournament_entries (tournament, player, nickname, tag)
    values (v_id, uid, prof.nickname, prof.tag);
  delete from public.tournament_invites i where i.tournament = v_id and i.recipient = uid;
  return 'joined';
end;
$$;

-- Odejít: v lobby se hráč odhlásí (organizátor turnaj zruší), v rozehraném turnaji
-- prohraje zbývající zápasy kontumací, z dohraného turnaje se jen zavře.
create or replace function public.tournament_leave()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tid uuid;
  t record;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tour-user:' || uid::text, 0));
  tid := public.tournament_of(uid);
  if tid is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tour:' || tid::text, 0));
  select x.status, x.organizer into t from public.tournaments x where x.id = tid;
  if t.status = 'lobby' then
    if t.organizer = uid then
      delete from public.tournaments x where x.id = tid;
    else
      delete from public.tournament_entries e where e.tournament = tid and e.player = uid;
    end if;
  else
    update public.tournament_entries e set left_at = now()
      where e.tournament = tid and e.player = uid;
    perform public.tournament_advance(tid);
  end if;
end;
$$;

-- Spustit turnaj (jen organizátor, aspoň 2 hráči). Vrací: started | not-organizer |
-- too-few | not-lobby.
create or replace function public.tournament_start()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tid uuid;
  t record;
  humans integer;
  v_size integer;
  rounds integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tour-user:' || uid::text, 0));
  tid := public.tournament_of(uid);
  if tid is null then
    return 'not-lobby';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tour:' || tid::text, 0));
  select x.status, x.organizer into t from public.tournaments x where x.id = tid;
  if t.organizer is distinct from uid then
    return 'not-organizer';
  end if;
  if t.status <> 'lobby' then
    return 'not-lobby';
  end if;
  -- Záznamy smazaných účtů (player null) se nepočítají a před losem zmizí.
  delete from public.tournament_entries e where e.tournament = tid and e.player is null;
  select count(*) into humans from public.tournament_entries e where e.tournament = tid;
  if humans < 2 then
    return 'too-few';
  end if;
  v_size := case when humans <= 4 then 4 when humans <= 8 then 8 else 16 end;
  rounds := case v_size when 4 then 2 when 8 then 3 else 4 end;

  -- Los: hráči na náhodné pozice, zbytek doplní AI.
  with perm as (
    select s, row_number() over (order by random()) as rn from generate_series(0, v_size - 1) s
  ),
  hum as (
    select e.id, row_number() over (order by random()) as rn
    from public.tournament_entries e where e.tournament = tid
  )
  update public.tournament_entries e set slot = perm.s
    from hum join perm on perm.rn = hum.rn
    where e.id = hum.id;
  insert into public.tournament_entries (tournament, is_ai, slot, nickname, tag)
    select tid, true, s, 'AI', row_number() over (order by s)
    from generate_series(0, v_size - 1) s
    where not exists (
      select 1 from public.tournament_entries e where e.tournament = tid and e.slot = s
    );

  for r in 1..rounds loop
    insert into public.tournament_matches (tournament, round, idx, slot_a, slot_b)
      select tid, r, i,
        case when r = 1 then 2 * i end,
        case when r = 1 then 2 * i + 1 end
      from generate_series(0, (v_size >> r) - 1) i;
  end loop;
  insert into public.tournament_matches (tournament, round, idx) values (tid, rounds, 1);

  update public.tournaments x
    set status = 'running', size = v_size, started_at = now()
    where x.id = tid;
  delete from public.tournament_invites i where i.tournament = tid;
  update public.tournament_entries e set last_seen = now()
    where e.tournament = tid and not e.is_ai;
  perform public.tournament_advance(tid);
  return 'started';
end;
$$;

-- Stav mého turnaje (null = v žádném nejsem). Zároveň „jsem tady“ (kontumace po 3 min
-- ticha) a posun pavouku.
create or replace function public.tournament_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tid uuid;
  t record;
  my_slot smallint;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  tid := public.tournament_of(uid);
  if tid is null then
    return null;
  end if;
  -- Zápis jen když je turnaj volný (souběžné dotazy se jen čtou – nikdo nemůže
  -- dotazováním ve smyčce zdržovat ostatní).
  if pg_try_advisory_xact_lock(hashtextextended('tour:' || tid::text, 0)) then
    -- Zapisovat nejvýš jednou za 5 s (ochrana databáze před spamem).
    update public.tournament_entries e set last_seen = now()
      where e.tournament = tid and e.player = uid and e.last_seen < now() - interval '5 seconds';
    select * into t from public.tournaments x where x.id = tid;
    if t.status = 'running'
       and (t.advanced_at is null or t.advanced_at < now() - interval '3 seconds') then
      perform public.tournament_advance(tid);
    end if;
  end if;
  select * into t from public.tournaments x where x.id = tid;
  select e.slot into my_slot from public.tournament_entries e
    where e.tournament = tid and e.player = uid;
  return jsonb_build_object(
    'id', t.id,
    'code', t.code,
    'status', t.status,
    'size', t.size,
    'organizer', coalesce(t.organizer = uid, false),
    'me', my_slot,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slot', e.slot,
        'nickname', e.nickname,
        -- Kód za # (identifikátor pro žádost o přátelství) jen u mě, kamarádů a AI.
        'tag', case
          when e.is_ai or e.player = uid or exists (
            select 1 from public.friendships f
            where f.user_a = least(uid, e.player) and f.user_b = greatest(uid, e.player)
          ) then e.tag else 0 end,
        'ai', e.is_ai,
        'gone', not e.is_ai and (e.player is null or e.left_at is not null),
        -- Přítomnost podle přepínače „Ukazovat online“ (vypnutý = vždy jako offline).
        'online', e.is_ai or (e.player is not null and e.left_at is null
                              and e.last_seen > now() - interval '1 minute'
                              and coalesce((select p.show_online from public.profiles p
                                            where p.id = e.player), true)),
        'me', coalesce(e.player = uid, false),
        'organizer', coalesce(e.player = t.organizer, false)
      ) order by e.slot nulls last, e.joined_at)
      from public.tournament_entries e where e.tournament = tid
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'round', x.round,
        'idx', x.idx,
        'a', x.slot_a,
        'b', x.slot_b,
        'status', x.status,
        'winner', x.winner,
        'score_a', x.score_a,
        'score_b', x.score_b,
        'how', x.how,
        -- Kód místnosti a vlastní hlášení jen pro hráče zápasu.
        'room', case when my_slot is not null and my_slot in (x.slot_a, x.slot_b) then x.room end,
        'reported', case
          when my_slot is not null and my_slot = x.slot_a then x.rep_a is not null
          when my_slot is not null and my_slot = x.slot_b then x.rep_b is not null
          else false end,
        'replays', x.mismatches,
        -- Stáří zápasu a místnosti (s) – jen pro hráče zápasu (záložní založení místnosti).
        'ready_age', case when my_slot is not null and my_slot in (x.slot_a, x.slot_b)
          and x.ready_at is not null then floor(extract(epoch from now() - x.ready_at))::integer end,
        'room_age', case when my_slot is not null and my_slot in (x.slot_a, x.slot_b)
          and x.room_at is not null then floor(extract(epoch from now() - x.room_at))::integer end
      ) order by x.round, x.idx)
      from public.tournament_matches x where x.tournament = tid
    ), '[]'::jsonb)
  );
end;
$$;

-- Hráč A zápasu založil online místnost – kód uvidí soupeř a připojí se.
drop function if exists public.tournament_set_room(integer, integer, text);
create function public.tournament_set_room(p_round integer, p_idx integer, p_room text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tid uuid;
  my_slot smallint;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_room is null or p_room !~ '^[A-HJ-NP-Z2-9]{5}$' or p_round is null or p_idx is null then
    return false;
  end if;
  tid := public.tournament_of(uid);
  if tid is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tour:' || tid::text, 0));
  select e.slot into my_slot from public.tournament_entries e
    where e.tournament = tid and e.player = uid;
  update public.tournament_matches x set room = p_room, room_at = now()
    where x.tournament = tid and x.round = p_round and x.idx = p_idx
      and x.status = 'ready' and my_slot is not null
      and (x.slot_a = my_slot
           or (x.slot_b = my_slot and x.ready_at < now() - interval '2 minutes'
               and (x.room is null or x.room_at < now() - interval '2 minutes')));
  return found;
end;
$$;

-- Nahlásit výsledek mého zápasu (vítěz = pozice, skóre A : B).
-- Vrací: recorded | pending (čeká na soupeře) | replay (neshoda – hraje se znovu) | ignored.
create or replace function public.tournament_report(
  p_round integer, p_idx integer, p_winner integer, p_score_a integer, p_score_b integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tid uuid;
  my_slot smallint;
  m record;
  v_after record;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_round is null or p_idx is null or p_winner is null
     or p_score_a is null or p_score_b is null
     or p_score_a not between 0 and 5 or p_score_b not between 0 and 5 then
    return 'ignored';
  end if;
  tid := public.tournament_of(uid);
  if tid is null then
    return 'ignored';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tour:' || tid::text, 0));
  select e.slot into my_slot from public.tournament_entries e
    where e.tournament = tid and e.player = uid;
  select * into m from public.tournament_matches x
    where x.tournament = tid and x.round = p_round and x.idx = p_idx;
  if not found or m.status <> 'ready' or my_slot is null
     or my_slot not in (m.slot_a, m.slot_b) or p_winner not in (m.slot_a, m.slot_b) then
    return 'ignored';
  end if;
  if my_slot = m.slot_a then
    if m.rep_a is not null then
      return 'ignored';
    end if;
    update public.tournament_matches x
      set rep_a = p_winner, rep_a_sa = p_score_a, rep_a_sb = p_score_b,
          first_report_at = coalesce(x.first_report_at, now())
      where x.tournament = tid and x.round = p_round and x.idx = p_idx;
  else
    if m.rep_b is not null then
      return 'ignored';
    end if;
    update public.tournament_matches x
      set rep_b = p_winner, rep_b_sa = p_score_a, rep_b_sb = p_score_b,
          first_report_at = coalesce(x.first_report_at, now())
      where x.tournament = tid and x.round = p_round and x.idx = p_idx;
  end if;
  perform public.tournament_advance(tid);
  select x.status, x.mismatches into v_after from public.tournament_matches x
    where x.tournament = tid and x.round = p_round and x.idx = p_idx;
  if v_after.status = 'done' then
    return 'recorded';
  end if;
  if v_after.mismatches > m.mismatches then
    return 'replay';
  end if;
  return 'pending';
end;
$$;

-- Pozvat kamaráda do lobby mého turnaje. Vrací: sent | not-friends | not-lobby.
create or replace function public.tournament_invite(p_friend uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tid uuid;
  t_status text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_friend is null or p_friend = uid then
    return 'not-friends';
  end if;
  -- Stejný limit jako pozvánky do hry (30 za hodinu, společný záznam).
  perform pg_advisory_xact_lock(hashtextextended('gi-user:' || uid::text, 0));
  if (select count(*) from public.game_invite_log l
        where l.sender = uid and l.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'limit' using errcode = 'MYE04';
  end if;
  insert into public.game_invite_log (sender) values (uid);
  perform public.myenemy_cleanup();
  tid := public.tournament_of(uid);
  select x.status into t_status from public.tournaments x where x.id = tid;
  if tid is null or t_status <> 'lobby' then
    return 'not-lobby';
  end if;
  if not exists (
    select 1 from public.friendships f
    where f.user_a = least(uid, p_friend) and f.user_b = greatest(uid, p_friend)
  ) then
    return 'not-friends';
  end if;
  insert into public.tournament_invites as i (tournament, sender, recipient)
    values (tid, uid, p_friend)
    on conflict (tournament, recipient) do update
      set sender = excluded.sender, created_at = now()
      where i.created_at < now() - interval '30 seconds';
  return 'sent';
end;
$$;

-- Odmítnout pozvánku do turnaje.
create or replace function public.dismiss_tournament_invite(p_tournament uuid)
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
  delete from public.tournament_invites i where i.tournament = p_tournament and i.recipient = uid;
end;
$$;

revoke all on function public.tournament_create() from public, anon;
revoke all on function public.tournament_join(text) from public, anon;
revoke all on function public.tournament_leave() from public, anon;
revoke all on function public.tournament_start() from public, anon;
revoke all on function public.tournament_state() from public, anon;
revoke all on function public.tournament_set_room(integer, integer, text) from public, anon;
revoke all on function public.tournament_report(integer, integer, integer, integer, integer)
  from public, anon;
revoke all on function public.tournament_invite(uuid) from public, anon;
revoke all on function public.dismiss_tournament_invite(uuid) from public, anon;
grant execute on function public.tournament_create() to authenticated;
grant execute on function public.tournament_join(text) to authenticated;
grant execute on function public.tournament_leave() to authenticated;
grant execute on function public.tournament_start() to authenticated;
grant execute on function public.tournament_state() to authenticated;
grant execute on function public.tournament_set_room(integer, integer, text) to authenticated;
grant execute on function public.tournament_report(integer, integer, integer, integer, integer)
  to authenticated;
grant execute on function public.tournament_invite(uuid) to authenticated;
grant execute on function public.dismiss_tournament_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Upozornění rozšířená o pozvánky do turnaje (jen do lobby, od kamarádů, hodinu)
-- ---------------------------------------------------------------------------

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
    ), '[]'::jsonb),
    'tournaments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.tournament, 'nickname', x.nickname, 'tag', x.tag, 'code', x.code,
        'created_at', x.created_at) order by x.created_at desc)
      from (
        select i.tournament, p.nickname, p.tag, t.code, i.created_at
        from public.tournament_invites i
        join public.profiles p on p.id = i.sender
        join public.tournaments t on t.id = i.tournament
        where i.recipient = (select auth.uid())
          and t.status = 'lobby'
          and i.created_at > now() - interval '1 hour'
          and exists (
            select 1 from public.friendships f
            where f.user_a = least(i.sender, i.recipient) and f.user_b = greatest(i.sender, i.recipient)
          )
        order by i.created_at desc
        limit 10
      ) x
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.my_notifications() from public, anon;
grant execute on function public.my_notifications() to authenticated;

-- ---------------------------------------------------------------------------
-- Export dat rozšířený o turnaje
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
    ), '[]'::jsonb),
    'tournaments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', t.code, 'status', t.status, 'organizer', t.organizer = uid,
        'nickname', e.nickname, 'tag', e.tag, 'slot', e.slot, 'joined_at', e.joined_at, 'left_at', e.left_at,
        'last_seen', e.last_seen,
        'matches', coalesce((
          select jsonb_agg(jsonb_build_object(
            'round', x.round, 'idx', x.idx, 'status', x.status,
            'won', x.winner = e.slot, 'score_a', x.score_a, 'score_b', x.score_b,
            'how', x.how,
            'side', case when x.slot_a = e.slot then 'A' else 'B' end,
            'my_report', case when x.slot_a = e.slot
              then jsonb_build_object('winner_is_me', x.rep_a = e.slot,
                                      'score_a', x.rep_a_sa, 'score_b', x.rep_a_sb)
              else jsonb_build_object('winner_is_me', x.rep_b = e.slot,
                                      'score_a', x.rep_b_sa, 'score_b', x.rep_b_sb) end))
          from public.tournament_matches x
          where x.tournament = t.id and e.slot in (x.slot_a, x.slot_b)
        ), '[]'::jsonb)))
      from public.tournament_entries e join public.tournaments t on t.id = e.tournament
      where e.player = uid
    ), '[]'::jsonb),
    'tournament_invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'direction', case when i.sender = uid then 'sent' else 'received' end,
        'with', p.nickname || '#' || lpad(p.tag::text, 4, '0'),
        'created_at', i.created_at))
      from public.tournament_invites i
      left join public.profiles p
        on p.id = case when i.sender = uid then i.recipient else i.sender end
      where uid in (i.sender, i.recipient)
    ), '[]'::jsonb),
    'tournament_attempts_last_day', coalesce((
      select jsonb_object_agg(a.action, a.n)
      from (select l.action, count(*) as n from public.tournament_log l
            where l.player = uid group by l.action) a
    ), '{}'::jsonb)
  ) into result
  from auth.users u where u.id = uid;
  return result;
end;
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- Smazání účtu: jméno v turnajích nahradit pomlčkou a z turnajů odejít
-- (účast zůstane jen jako anonymní pozice v pavouku). Trigger to hlídá i při smazání
-- účtu jinou cestou (player → null přes on delete set null).
-- ---------------------------------------------------------------------------

create or replace function public.tournament_entry_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.player is null and old.player is not null and not new.is_ai then
    new.nickname := '—';
    new.tag := 0;
    new.left_at := coalesce(new.left_at, now());
  end if;
  return new;
end;
$$;
revoke all on function public.tournament_entry_anonymize() from public, anon, authenticated;
drop trigger if exists tournament_entries_anonymize on public.tournament_entries;
create trigger tournament_entries_anonymize
  before update of player on public.tournament_entries
  for each row execute function public.tournament_entry_anonymize();

create or replace function public.delete_my_account()
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
  -- Stejný zámek jako připojení do turnaje (nic se nepřipojí uprostřed mazání).
  perform pg_advisory_xact_lock(hashtextextended('tour-user:' || uid::text, 0));
  -- Moje nespuštěná lobby zrušit, z cizích lobby odejít.
  delete from public.tournaments t where t.organizer = uid and t.status = 'lobby';
  delete from public.tournament_entries e using public.tournaments t
    where e.player = uid and t.id = e.tournament and t.status = 'lobby';
  update public.tournament_entries e
    set nickname = '—', tag = 0, left_at = coalesce(e.left_at, now())
    where e.player = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
