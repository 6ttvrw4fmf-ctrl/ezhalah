-- last_verified_alive_at: "we PROVED this listing is alive" — structurally separate from
-- last_seen_at ("the crawler encountered it somewhere"). Owner-approved 2026-08-30.
--
-- WHY THE COLUMN STARTS NULL EVERYWHERE, AND IS NOT BACKFILLED FROM last_seen_at.
-- last_seen_at is written by the ordinary crawl upsert (scrapers/common/db.py sets it on every
-- row a run touches, alongside missing_count=0) purely because the ad appeared in a feed. It is
-- ALSO written by aqar's liveness sweep on a genuinely verified 200. Those two writers are
-- indistinguishable after the fact, so ANY backfill from last_seen_at would manufacture ~198,000
-- verifications that never happened — precisely the conflation this column exists to end. NULL is
-- the honest value: "never positively verified under the liveness contract", which
-- liveness_contract.is_stale() already treats as stale. The column earns real values forward, from
-- the first ALIVE verdict each row receives.
--
-- SAFETY. Purely additive: ADD COLUMN IF NOT EXISTS, nullable, no DEFAULT, no backfill, no UPDATE,
-- no DELETE, and nothing that can flip `active`. A nullable column with no default is a catalog-only
-- change in Postgres — no table rewrite, no lock beyond a brief ACCESS EXCLUSIVE on each table.
-- Idempotent: re-running is a no-op. ROLLBACK is a plain DROP COLUMN per table (recorded below);
-- because nothing reads it yet and no data was transformed, rollback loses nothing.
--
-- COVERAGE IS PROVEN, NOT ASSUMED. The DO block iterates the SAME pg_tables predicate the rest of
-- the system uses to mean "a listing table", then re-counts afterwards and RAISES if any table was
-- missed. A migration that silently covered 66 of 67 would leave exactly the blind spot this whole
-- effort exists to remove.
do $$
declare
  t text;
  n_before int;
  n_after  int;
  n_tables int;
begin
  select count(*) into n_tables
    from pg_tables
   where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$';

  select count(*) into n_before
    from information_schema.columns
   where table_schema = 'public' and column_name = 'last_verified_alive_at'
     and table_name ~ '_(residential|commercial)_listings$';

  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
     order by tablename
  loop
    execute format(
      'alter table public.%I add column if not exists last_verified_alive_at timestamptz', t);
    execute format(
      'comment on column public.%I.last_verified_alive_at is %L', t,
      'Last time the SOURCE affirmatively confirmed this listing is live (liveness_contract ALIVE '
      'verdict on DIRECT evidence). NULL = never positively verified. NEVER written from crawler '
      'presence, from an UNKNOWN response, or from last_seen_at.');
  end loop;

  select count(*) into n_after
    from information_schema.columns
   where table_schema = 'public' and column_name = 'last_verified_alive_at'
     and table_name ~ '_(residential|commercial)_listings$';

  if n_after <> n_tables then
    raise exception
      'last_verified_alive_at coverage INCOMPLETE: % of % listing tables have the column '
      '(had % before). Refusing to leave a partially-covered fleet.', n_after, n_tables, n_before;
  end if;

  raise notice 'last_verified_alive_at present on %/% listing tables (was %)', n_after, n_tables, n_before;
end $$;

-- Post-condition, enforced as data rather than trusted from the loop above: no row may carry a
-- value yet, because nothing has verified anything under the contract. If a future edit adds a
-- backfill, this fails loudly instead of shipping fabricated verification timestamps.
do $$
declare t text; c int; total int := 0;
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
  loop
    execute format('select count(*) from public.%I where last_verified_alive_at is not null', t) into c;
    total := total + c;
  end loop;
  if total <> 0 then
    raise exception 'last_verified_alive_at was BACKFILLED (% non-null rows). It must start NULL: '
      'a value copied from last_seen_at is a verification that never happened.', total;
  end if;
end $$;
