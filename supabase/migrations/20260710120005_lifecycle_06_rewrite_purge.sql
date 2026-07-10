-- =====================================================================================================
-- Ezhalah owner-locked 7-day listing lifecycle — STEP 6 / 6
-- Rewrite purge_inactive_listings(): 7-day clock on deactivated_at, ARCHIVE-FIRST then delete.
-- =====================================================================================================
--
-- CHANGES vs the live function
--   1. grace_days 14 -> 7                       (policy point 4).
--   2. Retention clock is deactivated_at, NOT last_seen_at (policy point 3) — the whole reason
--      deactivated_at exists: last_seen_at refreshes on sold-pin rows the source still shows, so it
--      would never elapse for them.
--   3. ARCHIVE FIRST, then delete the SAME rows (policy points 6 & 7 — never hard-delete without a
--      full copy). Both happen in ONE statement via data-modifying CTEs, so it is impossible to
--      archive-without-deleting or delete-without-archiving (see the atomicity note below).
--   4. EXCLUDE wasalt_% tables entirely (owner: wasalt excluded from purge until enumeration-liveness
--      ships). This is IN ADDITION to the per-row price-guard exclusion.
--
-- THE DELETE GATE — ALL of these must hold (every one is a safety rail):
--   active = false                         -> only hidden rows
--   coalesce(missing_count,0) >= 3         -> confirmed gone (3-strike / sold-pin / patched mark_stale);
--                                             one bad crawl (mc<3) can never qualify
--   deactivated_at IS NOT NULL             -> must have a real hide timestamp
--   deactivated_at < now() - 7 days        -> hidden for the full 7-day window
--   NOT price-guarded                      -> price-typo rows (kept forever, tied to the separate
--                                             pending price-fidelity decision) are EXCLUDED
--   table NOT LIKE 'wasalt_%'              -> wasalt excluded wholesale (loop filter)
--
-- ATOMICITY (why archive set == delete set, byte-identically)
--   `doomed` snapshots the exact id set. `archived` INSERTs those rows into the archive and RETURNs
--   their listing_id. The DELETE removes only ids returned by `archived`, which forces `archived` to
--   execute and ties the two sets together. All CTEs see one consistent snapshot, the whole thing is
--   a single statement in one implicit transaction, and it is wrapped in the per-table exception
--   handler — so if anything raises, BOTH the insert and the delete roll back together. A row can
--   never be archived-but-not-deleted or deleted-but-not-archived.
--
-- get diagnostics n = row_count reads the final DELETE's affected-row count = rows archived = rows
-- deleted for that table. The function returns the running total across all tables.
--
-- FILES ONLY. Not applied. Cron jobid 11 (this function) STAYS DISABLED — this migration does NOT
-- enable it or change any schedule.
-- =====================================================================================================

CREATE OR REPLACE FUNCTION public.purge_inactive_listings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t text;
  n int;
  total int := 0;
  grace_days constant int := 7;   -- policy point 4: 14 -> 7
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'wasalt\_%'   -- owner: wasalt excluded from purge until enum-liveness ships
  loop
    begin
      execute format($f$
        with doomed as (
          select *
          from public.%1$I
          where active = false
            and coalesce(missing_count, 0) >= 3
            and deactivated_at is not null
            and deactivated_at < now() - %2$L::interval
            and not ( coalesce(price_total, 0)     > 1000000000
                   or coalesce(price_per_meter, 0) > 300000
                   or coalesce(price_annual, 0)    > 100000000 )
        ),
        archived as (
          insert into public.purged_listings_archive
            (source_table, listing_id, row_data, missing_count, deactivated_at, deletion_reason)
          select %3$L, d.id, to_jsonb(d), d.missing_count, d.deactivated_at, %4$L
          from doomed d
          returning listing_id
        )
        delete from public.%1$I x
        where x.id in (select listing_id from archived)
      $f$,
        t,                          -- %1$I  table identifier (used twice)
        (grace_days || ' days'),    -- %2$L  interval literal, e.g. '7 days'
        t,                          -- %3$L  source_table value stored in the archive
        '7d-confirmed-inactive'     -- %4$L  deletion_reason
      );
      get diagnostics n = row_count;
      total := total + n;
    exception when others then
      raise notice 'purge skip %: %', t, sqlerrm;
    end;
  end loop;
  return total;
end
$function$;
