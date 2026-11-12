-- Myenemy – sledování turnajových zápasů (spectate).
-- Spustit po 20261112120000_tournaments.sql: Dashboard → SQL Editor → celý soubor → Run.
-- Bezpečné spustit znovu.
--
-- * Kdo zápas řídí (hostitel online místnosti, nebo hráč proti AI), zapíše k zápasu
--   náhodný token kanálu sledování a veřejný klíč, kterým podepisuje snímky. Přepsat ho
--   smí jen on; při opakování zápasu (neshoda) se kanál zahodí.
-- * Pozor: opětovné spuštění 20261112120000_tournaments.sql vrátí starou tournament_state
--   bez sledování – pak spusť znovu i tento soubor.
-- * Token a klíč vrací tournament_state všem účastníkům turnaje, jen u rozehraných
--   zápasů. Kód místnosti hráčů diváci dál nevidí – do hry nic poslat nemůžou.
-- * Samotné snímky jdou přes Supabase Realtime Broadcast, nikde se neukládají.

alter table public.tournament_matches add column if not exists watch text;
alter table public.tournament_matches add column if not exists watch_key text;
-- Kdo kanál založil – přepsat ho smí jen on (soupeř nemůže divákům podstrčit vlastní).
alter table public.tournament_matches add column if not exists watch_by uuid;
alter table public.tournament_matches drop constraint if exists tournament_matches_watch;
alter table public.tournament_matches add constraint tournament_matches_watch check (
  (watch is null or watch ~ '^[A-Za-z0-9_-]{22}$')
  and (watch_key is null or watch_key ~ '^[A-Za-z0-9_-]{87}$')
);

-- Hráč rozehraného zápasu zapíše kanál sledování. Vrací true, pokud se zapsal.
create or replace function public.tournament_set_watch(
  p_round integer, p_idx integer, p_watch text, p_key text
)
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
  if p_round is null or p_idx is null
     or p_watch is null or p_watch !~ '^[A-Za-z0-9_-]{22}$'
     or p_key is null or p_key !~ '^[A-Za-z0-9_-]{87}$' then
    return false;
  end if;
  tid := public.tournament_of(uid);
  if tid is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tour:' || tid::text, 0));
  select e.slot into my_slot from public.tournament_entries e
    where e.tournament = tid and e.player = uid;
  update public.tournament_matches x set watch = p_watch, watch_key = p_key, watch_by = uid
    where x.tournament = tid and x.round = p_round and x.idx = p_idx
      and x.status = 'ready' and my_slot is not null and my_slot in (x.slot_a, x.slot_b)
      and (x.watch_by is null or x.watch_by = uid)
      and x.watch is distinct from p_watch;
  return found;
end;
$$;

revoke all on function public.tournament_set_watch(integer, integer, text, text) from public, anon;

-- Zápas se kvůli neshodě hraje znovu: starý kanál sledování zahodit (nový založí hostitel
-- nové místnosti).
create or replace function public.tournament_match_reset_watch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.mismatches is distinct from old.mismatches then
    new.watch := null;
    new.watch_key := null;
    new.watch_by := null;
  end if;
  return new;
end;
$$;
revoke all on function public.tournament_match_reset_watch() from public, anon, authenticated;
drop trigger if exists tournament_matches_reset_watch on public.tournament_matches;
create trigger tournament_matches_reset_watch
  before update of mismatches on public.tournament_matches
  for each row execute function public.tournament_match_reset_watch();
grant execute on function public.tournament_set_watch(integer, integer, text, text)
  to authenticated;

-- Stav turnaje rozšířený o kanál sledování.
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
          and x.room_at is not null then floor(extract(epoch from now() - x.room_at))::integer end,
        -- Sledování: kanál a podpisový klíč živého zápasu (vidí všichni účastníci turnaje).
        'watch', case when x.status = 'ready' then x.watch end,
        'watch_key', case when x.status = 'ready' then x.watch_key end
      ) order by x.round, x.idx)
      from public.tournament_matches x where x.tournament = tid
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.tournament_state() from public, anon;
grant execute on function public.tournament_state() to authenticated;
