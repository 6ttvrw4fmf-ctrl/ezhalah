-- last_liveness_probe_at: "a liveness mechanism LOOKED at this row" — whatever it concluded.
-- Owner directive 2026-09-24: every website must be re-checked regularly and no platform starved.
-- This column is what makes that physically possible.
--
-- THE THIRD FACT, AND WHY ITS ABSENCE STARVED 27,102 GATHERN LISTINGS
-- -------------------------------------------------------------------
-- Ezhalah already separates two facts, deliberately:
--   last_seen_at            — a crawl encountered this ad in a feed        (EvidenceKind.ABSENCE)
--   last_verified_alive_at  — the source PROVED it alive on a direct read  (EvidenceKind.DIRECT)
-- There is a third, and nothing recorded it: **when did we last LOOK at this row?**
--
-- A probe returning DEAD or UNKNOWN moves neither existing column. `last_seen_at` is a crawl fact
-- and a sweep is not a crawl; `last_verified_alive_at` only moves on ALIVE. So a row the sweep
-- probes every single day and finds dead is, in the database, indistinguishable from a row nothing
-- has ever looked at.
--
-- gathern's sweep selects work with `order by last_seen_at asc` — oldest sighting first. Measured
-- 2026-09-24: 28,639 active rows, and the SAME ~1,500 re-probed every run, producing an identical
-- `strike=1461` in the run notes on 09-16, 17, 18, 19, 20, 21 and 22. Those rows are dead but the
-- anomaly cap (correctly) refuses to kill ~1,400 at once, so they can never leave the head of the
-- queue — and the other 27,102 were never reached at all. Their oldest last_seen_at is still
-- 2026-07-27. Coverage read 0.4% verified-in-SLA, 94.6% never-verified, and no amount of extra
-- throughput would have changed it: a faster loop over a queue whose head cannot clear just
-- re-reads the same 1,500 rows more often.
--
-- That is a FAIRNESS bug, not a capacity bug, and it is invisible without this column. With it a
-- rotation orders `nulls first` — never-looked-at rows to the front — and a row drops to the back
-- the moment it is probed, whatever the verdict. Every platform's sweep gains this, so the fix is
-- fleet-general rather than a gathern special case.
--
-- WHAT THIS COLUMN IS NOT. It is NOT evidence of life and must never be read as any. A row probed
-- a minute ago and found 404, blocked or timing out has a fresh last_liveness_probe_at and is still
-- DEAD or UNKNOWN. Only last_verified_alive_at means alive, only via liveness_contract.py, and
-- nothing here changes that. Keeping the two apart is the whole lesson of last_seen_at vs
-- last_verified_alive_at, applied once more.
--
-- SAFETY. Purely additive, modelled on 20260830183939 (which added last_verified_alive_at the same
-- way): ADD COLUMN IF NOT EXISTS, nullable, no DEFAULT, no backfill, no UPDATE, no DELETE, nothing
-- that can flip `active`. A nullable column with no default is a catalog-only change in Postgres —
-- no table rewrite. Idempotent. Rollback is a plain DROP COLUMN per table and loses nothing,
-- because the column starts empty and earns values forward.
--
-- LOCK DISCIPLINE (learned applying this one, 2026-09-24). A bare loop of 143 ALTERs queued behind
-- a running mon_dispatch_p0_fast() sweep and sat in `wait_event_type = Lock`. A QUEUED ACCESS
-- EXCLUSIVE request blocks every reader that arrives after it, so the safe form sets a short
-- lock_timeout and SKIPS a busy table rather than waiting — a partial pass of an idempotent
-- additive change is harmless, a lock pile-up on the listings tables is not. Re-run until the
-- completeness check passes; that is exactly how this was applied.
--
-- NULL IS THE HONEST START, and here also the useful one: `nulls first` means the 27,102 rows
-- nothing has ever looked at are precisely what the next sweeps pick up. Backfilling from
-- last_seen_at would claim we had looked at rows we never looked at — the same conflation
-- 20260830183939 refused, for the same reason.
do $$
declare
  t text;
  n_tables int;
  n_after  int;
  skipped  int := 0;
begin
  set local lock_timeout = '5s';

  select count(*) into n_tables
    from pg_tables
   where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$';

  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
       and not exists (select 1 from information_schema.columns c
                        where c.table_schema = 'public' and c.table_name = pg_tables.tablename
                          and c.column_name = 'last_liveness_probe_at')
     order by tablename
  loop
    begin
      execute format(
        'alter table public.%I add column if not exists last_liveness_probe_at timestamptz', t);
    exception when lock_not_available then
      skipped := skipped + 1;
    end;
  end loop;

  select count(*) into n_after
    from information_schema.columns
   where table_schema = 'public' and column_name = 'last_liveness_probe_at'
     and table_name ~ '_(residential|commercial)_listings$';

  -- COVERAGE IS PROVEN, NOT ASSUMED. A migration that silently covered 142 of 143 would leave
  -- exactly the blind spot this exists to remove.
  if n_after <> n_tables then
    raise exception
      'last_liveness_probe_at reached %/% listing tables (% skipped on a busy lock) — re-run this '
      'migration; it is idempotent and will finish the remainder', n_after, n_tables, skipped;
  end if;

  raise notice 'last_liveness_probe_at present on %/% listing tables', n_after, n_tables;
end $$;

comment on column public.gathern_residential_listings.last_liveness_probe_at is
  'When a liveness mechanism last LOOKED at this row, whatever it concluded (alive, dead or '
  'unknown). NOT evidence of life — only last_verified_alive_at means that. Exists so a sweep can '
  'rotate fairly: order by this column NULLS FIRST and a never-looked-at row is picked before one '
  'already probed today. Without it gathern re-probed the same ~1,500 rows every run while 27,102 '
  'were never reached (measured 2026-09-24).';
