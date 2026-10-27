-- The new-listing capture detector runs AFTER the Rule B word checker, not before it (🔬 AF engineer, 2026-10-27).
-- mon_af_new_listing_readiness() §B compares the SERVED amenity columns of fresh (48 h) listings with all-time.
-- Since Rule B (owner 2026-10-25) the served column is af_rule_b(box, text fact), and the text facts for new ads are
-- written by the nightly word checker, pg_cron gh-facts-words-nightly at 07:05 UTC, applied by the 07:22 sync. Job 69
-- ran the detector at 06:52, so every morning it compared fresh rows the word checker had not read yet with an
-- all-time rate that includes the text facts. 10-27 06:52 raised 7 aqar alerts (parking on sale apartments 22 % fresh
-- vs 46 % all-time); at 09:20 the same 506 fresh rows, now read, served parking on 41 % vs 48 %. Measuring tool,
-- not data. mon_rich_attrs_barrier() keeps its 06:52 slot (it must follow job 68 at 06:46); only the readiness
-- detector moves, to 08:52, after the 07:05 word checker and the 07:22 and 08:22 syncs.
select cron.alter_job(69, command := $$set statement_timeout to '600s'; select public.mon_rich_attrs_barrier();$$);
select cron.schedule('mon-af-new-listing-readiness', '52 8 * * *',
                     $$set statement_timeout to '600s'; select public.mon_af_new_listing_readiness();$$);
