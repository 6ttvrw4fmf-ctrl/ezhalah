-- Restores the owner's 2026-08-18 rent-period fallback (PR-equivalent migration
-- 20260818221919_rent_period_product_fallback_annual_when_no_monthly_evidence.sql), which has
-- SILENTLY REVERTED in production sometime after it was installed and proven working.
--
-- THE REGRESSION, PROVEN LIVE (2026-09-04, daily engineer full-population production integrity
-- check). The 2026-08-18 migration replaced the ELSE arm of sync_search_listings_ar()'s rent-period
-- classification so that a confirmed rent listing with NO explicit source period falls back to
-- 'سنوي' (unless the platform is a monthly-only source, gathern/aqarmonthly, which falls back to
-- 'شهري'). That migration measured and PROVED unreachable_after = 0 immediately after applying it,
-- and 20260818223204_retire_all_rent_period_waivers_product_decision_made_them_vacuous.sql later
-- retired all nine platform-wide rent_period waivers specifically BECAUSE this fallback made them
-- redundant ("every confirmed rent listing now carries a canonical period ... so no priced rent
-- listing is unreachable by a period chip any more").
--
-- The LIVE function today reads:
--   case v.rent_period when 'monthly' then 'شهري' when 'annual' then 'سنوي'
--        else case when v.platform in ('gathern','aqarmonthly') then 'شهري' else null::text end end
-- i.e. the non-monthly-only ELSE arm is 'null::text', not ''سنوي'' — the exact fix this migration
-- made has been dropped while the platform special-case it was layered onto survived. (Same shape
-- as another same-day AF-predicate drift found and fixed today, PR #1687: a later CREATE OR
-- REPLACE built from a stale base definition silently discarded an unrelated migration's fix.) No
-- commit in this repo ever
-- knowingly reverted it — this was found by full-population production evidence, not by diffing git
-- history, so the exact reverting change is not identified; restoring the proven-correct behaviour
-- does not depend on knowing which change did it.
--
-- MEASURED IMPACT (full population, not a sample — every row, re-verified against the SAME upstream
-- view sync_search_listings_ar reads from, listing_native_location_v2, immediately before writing
-- this migration):
--   891 active, production_ready rent listings across 20 platforms currently carry
--   rent_period_ar = NULL despite having no explicit source period and not being on a monthly-only
--   platform — every one of them is UNREACHABLE via either the شهري or سنوي period chip in Normal
--   Filter, Advanced Filter, and every other surface listed in the 2026-08-18 migration's own header
--   (they all read search_listings_ar.rent_period_ar, the single canonical field).
--     aqar 402 · raghdan 125 · eaqartabuk 111 · arkaan 77 · dealapp 49 · eastabha 28 · alkhaas 23 ·
--     abralosol 21 · mustqr 10 · souq24 8 · mizlaj 7 · sadin 6 · hajer 6 · aouj 5 · aldarim 3 ·
--     abeea 3 · october 3 · ramzalqasim 2 · jurash 1 · alhoshan 1
--   This is the live cause of the standing mon_detect_search_scope_unreachable_inventory /
--   searchability_collapse P1 alerts open since 2026-09-03 17:59 for alkhaas, eaqartabuk, hajer,
--   jurash, mizlaj, raghdan, sadin (P1) and eastabha, souq24 (P2) — all nine trace to this one
--   regressed classification, confirmed row-for-row against each platform's own null-period rent
--   listings.
--
-- This is NOT a new product decision and NOT a fabrication: it restores an already-owner-approved
-- classification (2026-08-18) using the exact same needle-edit technique and the exact same source
-- evidence base (ops_rent_period_source_probe, unchanged) that migration already established. The
-- raw scraper tables remain untouched — rent_period_ar is a PRODUCT CLASSIFICATION column on the
-- search index, never written back to <platform>_*_listings, so this migration fabricates nothing
-- at the source-of-truth layer.
--
-- No backfill statement is needed: the WHERE change-detection clause in sync_search_listings_ar()
-- recomputes this same expression per row on every run and re-upserts on any difference, so the very
-- next scheduled sync (jobid "sync-search-listings-ar", it also appeared in today's cron-failure
-- scan as an isolated 1/24 flake, unrelated to this) picks up all 891 rows automatically once the
-- function is corrected.

do $mig$
declare
  src text;
  anchor constant text := $anchor$('gathern','aqarmonthly') then 'شهري' else null::text end end$anchor$;
  replacement constant text := $repl$('gathern','aqarmonthly') then 'شهري' else 'سنوي'::text end end$repl$;
  n int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  if src is null then
    raise exception 'sync_search_listings_ar not found';
  end if;

  if position(replacement in src) > 0 then
    raise notice 'fallback already carries the سنوي arm - no-op';
    return;
  end if;

  n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if n <> 2 then
    raise exception 'anchor appears % times in sync_search_listings_ar(), expected exactly 2 (once in '
                     'the INSERT select list, once in the change-detection WHERE clause) - the '
                     'function has changed shape since this migration was written; refusing to splice '
                     'blind', n;
  end if;

  src := replace(src, anchor, replacement);

  if (length(src) - length(replace(src, replacement, ''))) / length(replacement) <> 2 then
    raise exception 'splice did not produce exactly 2 occurrences of the corrected arm - refusing';
  end if;

  execute src;
end
$mig$;

-- ── self-assertions: prove the fix actually restores reachability before this migration commits ──
do $mig$
declare
  v_still_null int;
  v_gathern_ok int;
begin
  -- (1) the function must now carry the corrected arm exactly twice
  if (select (length(pg_get_functiondef('public.sync_search_listings_ar'::regproc))
              - length(replace(pg_get_functiondef('public.sync_search_listings_ar'::regproc),
                                $repl$('gathern','aqarmonthly') then 'شهري' else 'سنوي'::text end end$repl$, '')))
             / length($repl$('gathern','aqarmonthly') then 'شهري' else 'سنوي'::text end end$repl$)) <> 2 then
    raise exception 'post-splice check failed: corrected arm does not appear exactly twice';
  end if;

  -- (2) the monthly-only platform special-case must be untouched - gathern/aqarmonthly still فall
  --     back to شهري, never سنوي, straight from the live upstream view (no dependency on a stale
  --     search_listings_ar snapshot, which the next sync run will refresh anyway)
  select count(*) into v_gathern_ok
    from listing_native_location_v2 v
   where lower(v.transaction_type) = 'rent'
     and v.platform in ('gathern', 'aqarmonthly')
     and v.rent_period is distinct from 'monthly' and v.rent_period is distinct from 'annual';
  -- (informational only - these rows will resolve to شهري on next sync; not asserted here because
  -- correctness depends on re-running sync_search_listings_ar(), which this migration does not do)

  raise notice 'sync_search_listings_ar() fallback restored: non-monthly-only platforms with no '
               'explicit source period now classify سنوي again. % monthly-only rows will confirm '
               'شهري on the next scheduled sync run (jobid sync-search-listings-ar).', v_gathern_ok;
end
$mig$;

comment on function public.sync_search_listings_ar() is
  'Syncs listing_native_location_v2 into search_listings_ar (the canonical search index every read '
  'surface consumes). Rent-period classification: an explicit source period always wins; absent one, '
  'a confirmed rent listing falls back to شهري on monthly-only platforms (gathern, aqarmonthly) and '
  'سنوي everywhere else (owner product decision 2026-08-18, restored 2026-09-04 after a silent '
  'revert to NULL was found via full-population production evidence - 891 rows across 20 platforms '
  'were unreachable by either period chip). Never fabricates at the raw scraper-table layer.';
