-- Senior Production Engineer run #32 (2026-08-20).
--
-- DEFECT. mon_price_size_fidelity_barrier()'s index_price_differs_from_raw check compares
-- search_listings_ar (an HOURLY snapshot, written by sync-search-listings-ar at :14) against
-- aqar_residential_listings (rewritten CONTINUOUSLY by the sweep, liveness, enrich and deep-fill
-- jobs), with no staleness guard at all. Any aqar row whose price is re-captured between the last
-- sync and the detector's run reads as an index/raw disagreement -- so ordinary propagation lag
-- raises a P1 named "price contamination".
--
-- OBSERVED: alert 766 (P1, 2026-08-19 16:29) reported 13 such rows. The detector ran at :29, 15
-- minutes after the :14 sync, and 233 aqar rows carry raw_captured_at inside that exact 15-minute
-- window -- an enrich pass was mid-write. By the following sync the barrier read 0 rows, and it
-- reads 0 now across ALL platforms and all three fields (price_annual, price_total, area_m2 vs
-- listing_native_location_v2: 0/196,004). No corruption ever existed.
--
-- WHY IT MATTERS MORE THAN A NUISANCE, AND WHY IT IS GETTING WORSE. mon_raise() returns 0 for an
-- already-open dedup key, so for as long as this false P1 sits open (the detector is 20h-gated, so
-- up to 20 hours) a GENUINE aqar price corruption raises nothing, dispatches nothing, and shows
-- nothing new on the roster. The window is widening fast: aqar rows re-captured inside the :14->:29
-- gap ran 50 (08-18), 302 (08-19), 415 (08-20 by 06:00) as aqar re-capture volume climbed
-- 1,857 -> 5,810 -> 11,926 rows/day.
--
-- FIX -- made to DISCRIMINATE, not to go quiet (AGENTS.md: never silence a barrier to make it
-- green). The check now ignores only rows the sync provably has not had its turn on yet: those
-- physically written within the last 90 minutes (one full hourly sync cycle plus a 30-minute
-- margin). A row that has been quiet for longer and STILL disagrees with the index is exactly the
-- corruption class this check exists for, and still fires at full P1. Nothing else about the
-- predicate changes; no row is excluded by value, platform or magnitude.

do $$
declare v_def text; v_new text; v_old text; v_rep text; n int;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'mon_price_size_fidelity_barrier';

  v_old := '    and s.price_annual is distinct from a.price_annual
  having count(*) > 0';

  v_rep := '    and s.price_annual is distinct from a.price_annual
    -- LAG GUARD (senior run #32, 2026-08-20): search_listings_ar is an hourly snapshot and
    -- aqar_residential_listings is rewritten continuously, so a row physically re-captured since the
    -- last sync has not had its turn yet and its "disagreement" is propagation, not contamination.
    -- 90 minutes = one hourly sync cycle (:14) + 30 min margin. A row quiet for longer that still
    -- disagrees IS the corruption class and still fires at P1.
    and greatest(coalesce(a.raw_captured_at, ''epoch''::timestamptz),
                 coalesce(a.last_seen_at,    ''epoch''::timestamptz),
                 coalesce(a.scraped_at,      ''epoch''::timestamptz)) < now() - interval ''90 minutes''
  having count(*) > 0';

  n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if n <> 1 then raise exception 'REFUSED: index_price_differs_from_raw anchor not found exactly once (found %)', n; end if;

  v_new := replace(v_def, v_old, v_rep);
  if v_new = v_def then raise exception 'REFUSED: no change'; end if;
  execute v_new;
end $$;
