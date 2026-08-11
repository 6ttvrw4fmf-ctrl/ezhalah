-- A priced Rent listing with no rent period is reachable by NEITHER the annual nor the monthly
-- Filter. It sits in search_listings_ar looking healthy, it is counted as searchable by every
-- count-parity check, and the only way a user ever sees it is by leaving the period chip unset.
--
-- mon_source_is_truth_violations() has carried this check ("rent_period_missing_on_priced_rent")
-- since it was written, but NOTHING CALLS THAT FUNCTION — it is a manual barrier. Verified
-- 2026-08-11: no pg_proc body other than its own references it, so 77 unreachable priced rent
-- listings had never raised a single alert. Per AGENTS.md §11a a barrier nothing reaches is
-- decoration; this wires the check to the roster so it can page.
--
-- Known population at ship time (2026-08-11): aqar 75 (64 residential + 11 commercial) + october 1.
-- The aqar cohort is a PROVEN Ezhalah-side defect, not a source limitation: those rows carry the
-- June `backfill.v1` stub capture whose missing «تفاصيل الإعلان» block means every label-anchored
-- parser reads nothing, while aqar itself publishes «سنوي» (scrapers/aqar/recover_stubs.py, which
-- exists for exactly this). They are being re-enriched separately. Nothing here writes listing data.
create or replace function public.mon_detect_rent_period_unreachable()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  total bigint;
  by_platform jsonb;
  n int := 0;
begin
  select count(*), coalesce(jsonb_object_agg(platform, c), '{}'::jsonb)
    into total, by_platform
  from (
    select platform, count(*) c
    from public.search_listings_ar
    where deal_ar = 'إيجار'
      and (price_annual is not null or price_total is not null)
      and (rent_period_ar is null or rent_period_ar not in ('سنوي','شهري'))
    group by platform
  ) s, lateral (select 1) _;

  -- recompute the scalar honestly (the aggregate above counts platforms, not rows)
  select coalesce(sum(c), 0) into total from (
    select count(*) c from public.search_listings_ar
    where deal_ar = 'إيجار'
      and (price_annual is not null or price_total is not null)
      and (rent_period_ar is null or rent_period_ar not in ('سنوي','شهري'))
    group by platform
  ) t(c);

  if total > 0 then
    n := public.mon_raise('P2', 'rent_period_unreachable', 'all',
      'rent_period_unreachable',
      jsonb_build_object(
        'unreachable_priced_rent_rows', total,
        'by_platform', by_platform,
        'why', 'Priced Rent listings whose rent_period_ar is neither «سنوي» nor «شهري». They are '
               'in search_listings_ar and counted as searchable, but the annual and monthly Filter '
               'branches both exclude them — a user only reaches them with no period chip set. '
               'Do NOT fix by defaulting the period: that would invent a source fact. Re-enrich the '
               'row so the period comes from the platform (aqar: scrapers/aqar/recover_stubs.py), '
               'or confirm the source genuinely publishes no period and record it.'));
  else
    perform public.mon_resolve_key('rent_period_unreachable');
  end if;

  return n;
end $function$;

-- ── ROSTER WIRING: NOT REPRODUCED HERE (amended 2026-08-11) ──────────────────────────────────
-- As APPLIED, this migration also wired the detector into mon_run_all_detectors() by pasting a full
-- hand-written body. That is the pattern scripts/verify-detector-roster-edits-are-guarded.ts
-- forbids, and it failed CI on this branch — correctly. The roster has been lost at least four times
-- to exactly that move (20260804113911, 20260810175245, 20260810202219, repaired by 20260810222259);
-- this migration's own header quoted that history and then repeated it, on the reasoning that an
-- explicit 32-detector survival assertion made it safe. It made that one edit safe. It does not make
-- the pattern safe: an assertion only protects the entries the author thought to list, while a
-- needle-edit cannot drop what it never read.
--
-- The guard's grandfather list states that it "must never grow", so exempting this file was not an
-- option. The wiring was therefore REDONE the sanctioned way — read the live body with
-- pg_get_functiondef(), anchor, splice only if absent — by:
--
--     20260811124301_rewire_rent_period_detector_via_needle_edit.sql
--
-- and the offending block is omitted from this file so the tree contains no wholesale roster rewrite.
-- PROVENANCE: the SQL as actually applied is recorded verbatim in
-- supabase_migrations.schema_migrations where version = '20260811073933'
-- (md5 of statements[1] = 6b6b8d13f18baf5f601547477d38ee7b). Nothing about the live roster changed;
-- only the pattern the repository sanctions for editing it.
