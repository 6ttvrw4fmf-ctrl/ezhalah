-- CALLING sync_search_listings_ar() BY ITSELF LEAVES THE INDEX HALF-BUILT.
--
-- FOUND BY CAUSING IT (2026-08-22, Data Integrity run #37b). After restoring 81 gathern listings I
-- wanted them searchable immediately rather than at the next hourly cron, so I ran
-- sync_search_listings_ar() on its own. The rows landed in search_listings_ar and were retrievable
-- through the production RPC -- and 30 minutes later mon_detect_gathern_rating_source_truth raised a
-- P1 on 44 rows whose rating / reviews_count / unit_subtype_ar disagreed with their own source.
-- All 44 were mine.
--
-- The cause is that cron jobid 28 ('sync-search-listings-ar', minute :14) is FIVE statements, not
-- one:
--     select * from public.sync_search_listings_ar();
--     select public.refresh_rnpl_flags();
--     select public.sync_payment_monthly();
--     select * from public.sync_all_rich_attrs();
--     select public.sync_gathern_native_attrs();
-- The first inserts the row; the last four populate attribute columns that are user-facing FILTERS
-- (gathern rating and reviews_count, unit_subtype_ar, RNPL flags, monthly payment). Run only the
-- first and the row is searchable but under-described: an Advanced Filter rating query silently
-- misses it, which is a searchability defect wearing the costume of a successful sync.
--
-- Repaired by running the remaining four (sync_gathern_native_attrs -> 44 rows,
-- sync_all_rich_attrs -> 44 gathern, refresh_rnpl_flags -> 960); the detector then resolved on its
-- own predicate. No barrier is added here because the existing one already caught this within one
-- sweep -- that detector working is precisely why this is a comment and not a new detector.
--
-- The rule this pins: an out-of-band sync must run the WHOLE job body, not the statement whose name
-- matches the job.

comment on function public.sync_search_listings_ar() is
  'Inserts/updates the searchable rows of search_listings_ar from active_listing_ids_v2. THIS IS '
  'STEP 1 OF 5. cron jobid 28 (sync-search-listings-ar, minute :14) also runs refresh_rnpl_flags(), '
  'sync_payment_monthly(), sync_all_rich_attrs() and sync_gathern_native_attrs(), which populate '
  'user-facing FILTER columns (gathern rating/reviews_count, unit_subtype_ar, RNPL, monthly '
  'payment). Calling this function alone makes rows searchable but under-described, so an Advanced '
  'Filter query on those columns silently misses them - observed 2026-08-22 on 44 restored gathern '
  'rows, caught by mon_detect_gathern_rating_source_truth. If you run this out of band, run all '
  'five statements in the same order.';
