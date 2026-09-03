-- THE STANDING P1 THAT MADE ITS OWN BUG CLASS UN-PAGEABLE (Search & Matching QA, 2026-08-29).
--
-- `mon_detect_city_resolution_ignores_region()` has held an OPEN P1 continuously since
-- 2026-08-20 08:59 UTC. Both limbs measured today:
--   * behavioural limb            → 0 listings (no row is resolved off its published region)
--   * structural limb             → EXACTLY ONE object: public.ops_qa_search_differential
-- So the alert was never about production location data. It was the structural LINT flagging the
-- QA differential oracle, which was built on 2026-08-20 — two days AFTER the exemption list was
-- written (2026-08-18) — and was never added to it.
--
-- WHY THAT IS NOT COSMETIC. `mon_raise()` returns 0 while a dedup key is already open, so for nine
-- days a GENUINE city-resolution regression (the behavioural limb going non-zero, or a real
-- offender appearing in the structural limb) would have raised 0, kept the roster count at 0, and
-- never re-dispatched. The class was dark exactly the way AGENTS.md warns: an all-zero detector
-- sweep sitting on top of an open alert reads as a clean bill of health.
--
-- WHY THE ORACLE IS EXEMPT AND NOT BROKEN. ops_qa_search_differential is an independent
-- reimplementation of location_search_candidates_ar's row gate — and that RPC is already exempt,
-- for precisely this reason: it CONSUMES the caller's p_cities / p_region_ids and filters rows,
-- it never derives a canonical city from a name. The structural limb is a lint that cannot tell
-- "derives a canonical city from a name" (the real risk) from "filters on a client-supplied name
-- with the region enforced separately on the row" (safe). Region-scoping the oracle's city CTE
-- would make it DIVERGE from the very RPC it exists to mirror, which is worse than no oracle
-- (SEARCH_MATCH_QA_ENGINEER.md §41.15: an oracle that accuses the product for its own imprecision).
-- This analysis was already written down in scripts/verify-region-scoped-city-live.ts on
-- 2026-08-26 ("WHY THERE IS NO CODE FIX HERE"); the exemption row is the half that was missed.
--
-- THE EXEMPTION IS EARNED, NOT ASSERTED — measured on production today, both directions:
--   * الهفوف is ambiguous (city_id 12 / region 5 الشرقية, and city_id 501 / region 1 الرياض).
--     RPC and oracle, شقة/بيع, agree as SETS, not merely as counts:
--       region 5      → 26 rows, md5 b1ed241287dc1bbc08c4d5c95676ff4a  (both sides)
--       region-free   → 26 rows, md5 b1ed241287dc1bbc08c4d5c95676ff4a  (both sides)
--       region 1      →  0 rows                                        (both sides)
--   * scripts/verify-region-scoped-city-live.ts, run green today, proves the same equivalence over
--     six ambiguous cities (القويعية ×2 regions, البدائع ×2, بيش ×2) plus the unscoped-union case
--     (334 + 8 = 342) and the NULL-table-scope self-check.
-- That check previously ran only by hand; this change is landed together with a scheduled workflow
-- so the equivalence that justifies this row is re-proven continuously rather than once.

insert into public.ops_city_resolution_exempt (object_name, reason)
values (
  'ops_qa_search_differential',
  'QA differential oracle (SEARCH_MATCH_QA_ENGINEER.md §39.1): an independent reimplementation of '
  'location_search_candidates_ar''s row gate, which is exempt for the same reason. Consumes the '
  'caller''s p_cities/p_region_ids and filters; never derives a canonical city from a name. '
  'Region-scoping its city CTE would make it diverge from the RPC it exists to mirror. Equivalence '
  'on ambiguous cities is proven live by scripts/verify-region-scoped-city-live.ts (scheduled: '
  '.github/workflows/region-scoped-city-live-check.yml), and set-identically on الهفوف 2026-08-29.'
)
on conflict (object_name) do update set reason = excluded.reason;

-- Close the standing alert by RE-EVALUATING the detector, never by hand-resolving the key: if any
-- limb is still non-zero this leaves the alert exactly where it is.
select public.mon_detect_city_resolution_ignores_region();
