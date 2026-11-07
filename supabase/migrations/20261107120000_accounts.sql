-- Myenemy – účty (část A): profil s přezdívkou a #kódem, export dat, smazání účtu.
-- Spustit jednou v Supabase: Dashboard → SQL Editor → vložit celý soubor → Run.
-- Bezpečné spustit znovu (if not exists / or replace).
--
-- Zásady:
-- * Tabulky mají zapnuté RLS. Klient smí jen ČÍST svůj profil; zapisuje se výhradně
--   přes funkce níže (security definer), které hlídají pravidla.
-- * Funkce mají prázdný search_path a plně kvalifikovaná jména (ochrana proti podvržení).
-- * Nepřihlášený (anon) klient nesmí volat nic.
-- * Ve zdrojáku nejsou doslovně žádné neviditelné znaky – jen \uXXXX v regexech.

-- ---------------------------------------------------------------------------
-- Výchozí práva ve schématu public: nové tabulky a funkce NEJSOU automaticky
-- přístupné klientům (Supabase je jinak dává anon/authenticated). Každá tabulka
-- a funkce musí práva dostat výslovně – zapomenuté RLS tak nic nezveřejní.
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------------
-- Profily
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  -- Kód za přezdívkou (Pepa#0042) – rozliší stejné přezdívky, jako na Discordu.
  tag smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Kdy se přezdívka naposledy změnila (omezení častých změn).
  nickname_changed_at timestamptz not null default now(),
  constraint profiles_tag_range check (tag between 1 and 9999),
  constraint profiles_nickname_length check (char_length(nickname) between 2 and 16)
);

alter table public.profiles
  add column if not exists nickname_changed_at timestamptz not null default now();

-- Dvojice přezdívka + kód je jedinečná; velikost písmen a „ozdobné“ varianty znaků
-- se nerozlišují.
create unique index if not exists profiles_handle_key
  on public.profiles (lower(normalize(nickname, NFKC)), tag);

alter table public.profiles enable row level security;

-- Číst jen vlastní profil (kamarádi přibudou v části B).
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

-- Klient smí jen číst vybrané sloupce; zápisy jen přes funkce.
revoke all on public.profiles from anon, authenticated;
grant select (id, nickname, tag) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Kontrola přezdívky na serveru – stejná pravidla jako klient (src/core/nickname.ts):
-- 2–16 znaků, písmena z JEDNÉ abecedy (latinka se středoevropskou diakritikou,
-- azbuka, řečtina), číslice 0–9, mezera a _ . -; bez dvojitých mezer a „ozdobných“
-- variant znaků (NFKC). Whitelist vyloučí i neviditelné a směrové znaky.
-- ---------------------------------------------------------------------------

create or replace function public.nickname_is_valid(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value is not null
    and char_length(value) between 2 and 16
    and value = normalize(value, NFKC)
    and value = btrim(value, ' ')
    and value !~ ' {2,}'
    and (
         value ~ '^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u0130\u0132-\u0137\u0139-\u0148\u014A-\u017E0-9 _.-]+$'
      or value ~ '^[\u0400-\u0481\u048A-\u052F0-9 _.-]+$'
      or value ~ '^[\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03FF\u1F00-\u1FBC\u1FC2-\u1FCC\u1FD0-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FFC0-9 _.-]+$'
    );
$$;

-- ---------------------------------------------------------------------------
-- Nastavení přezdívky (první přihlášení i změna)
-- ---------------------------------------------------------------------------

create or replace function public.set_nickname(new_nickname text)
returns table (nickname text, tag smallint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  wanted text;
  current_nickname text;
  current_tag smallint;
  changed_at timestamptz;
  candidate smallint;
  attempt int := 0;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Obří vstup ani nenormalizovat.
  if new_nickname is null or char_length(new_nickname) > 64 then
    raise exception 'invalid nickname' using errcode = '22023';
  end if;
  wanted := normalize(btrim(new_nickname, ' '), NFC);
  if not public.nickname_is_valid(wanted) then
    raise exception 'invalid nickname' using errcode = '22023';
  end if;

  select p.nickname, p.tag, p.nickname_changed_at
    into current_nickname, current_tag, changed_at
    from public.profiles p where p.id = uid;

  -- Beze změny: nic neukládat (a nepočítat do limitu).
  if current_nickname = wanted then
    return query select p.nickname, p.tag from public.profiles p where p.id = uid;
    return;
  end if;
  -- Změna nejvýš jednou za 10 minut (první volba přezdívky je bez omezení).
  if current_nickname is not null and changed_at > now() - interval '10 minutes' then
    raise exception 'too soon' using errcode = 'MYE01';
  end if;

  loop
    attempt := attempt + 1;
    -- Nejdřív zkusit ponechat dosavadní kód, pak náhodný.
    if attempt = 1 and current_tag is not null then
      candidate := current_tag;
    elsif attempt <= 60 then
      candidate := (floor(random() * 9999) + 1)::smallint;
    else
      -- Skoro všechny kódy pro tuto přezdívku obsazené – vzít první volný.
      select s::smallint into candidate
        from generate_series(1, 9999) s
        where not exists (
          select 1 from public.profiles p
          where lower(normalize(p.nickname, NFKC)) = lower(normalize(wanted, NFKC))
            and p.tag = s and p.id <> uid
        )
        limit 1;
      if candidate is null then
        raise exception 'nickname full' using errcode = '23505';
      end if;
    end if;

    begin
      insert into public.profiles as p (id, nickname, tag, nickname_changed_at)
        values (uid, wanted, candidate, now())
        on conflict (id) do update
          set nickname = excluded.nickname,
              tag = excluded.tag,
              updated_at = now(),
              nickname_changed_at = now();
      return query select p.nickname, p.tag from public.profiles p where p.id = uid;
      return;
    exception when unique_violation then
      if attempt > 61 then
        raise;
      end if;
      -- kód je obsazený – zkusit jiný
    end;
  end loop;
end;
$$;

revoke all on function public.set_nickname(text) from public, anon;
grant execute on function public.set_nickname(text) to authenticated;
revoke all on function public.nickname_is_valid(text) from public, anon;
grant execute on function public.nickname_is_valid(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Export vlastních dat (GDPR – právo na přístup)
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
    )
  ) into result
  from auth.users u where u.id = uid;
  return result;
end;
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- Smazání účtu (GDPR) – smaže uživatele a s ním profil (cascade) i přihlášení.
-- Záznamy auditu přihlášení (auth.audit_log_entries) spravuje Supabase zvlášť.
-- ---------------------------------------------------------------------------

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
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Kontrola po spuštění (má vrátit 0 řádků = všechny tabulky v public mají RLS):
-- select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
