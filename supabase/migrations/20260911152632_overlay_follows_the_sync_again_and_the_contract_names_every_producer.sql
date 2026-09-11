-- ROUTINE #9 🔬 PRODUCTION RED TEAM (2026-09-11) — a consumer is reading its producer's output
-- 14 minutes before that output is written, for the SECOND time, and the contract that exists to
-- prevent exactly this could only see one third of the dependencies it was meant to cover.
--
-- WHAT HAPPENED. ops_incident #143 (routine #11, today) correctly found that sync_search_listings_ar
-- reads listing_native_location_v2, a view built over the MATVIEW active_listing_ids_v2 which jobid 17
-- refreshes at :20 — so the sync at :14 consumed a snapshot an hour old. The repair moved the SYNC
-- from :14 to :36. That fixes the matview ordering and it is kept here.
--
-- But moving the sync moved it ACROSS a declared contract. migration 20260819062809 established
--     sync-search-listings-ar -> resolve-english-city-overlay, min_gap 5
-- because resolve_english_city_overlay() SELECTs FROM search_listings_ar, which the sync WRITES. The
-- overlay stayed at :22. Measured live today:
--     sync-search-listings-ar at :36 -> resolve-english-city-overlay at :22: gap -14 min
-- The detector saw it and raised alert_event 2387 (P2) at 14:29:00Z; it was still open, unacknowledged
-- and re-affirmed at 15:20:23Z when this run read it. This is alert 752 (2026-08-19, gap -8) again,
-- in the opposite direction: every newly ingested listing carrying a resolvable English city stays
-- unlocated for an extra full cycle, and while unlocated NO city/district Filter combination returns it.
--
-- THE FIX IS TO MOVE THE CONSUMER, not to undo #143's repair.
--   • :50 is the ONLY minute in [40,59] carrying fewer than 2 hourly jobs (it carries jobid 24 alone),
--     so the overlay lands there without tripping mon_detect_cron_minute_collision(), which raises P1
--     at >= 3 jobs on one minute. Trading a P2 for a P1 is not a fix.
--   • :59 is the other single-job minute and is deliberately NOT used: it is the detector sweep
--     (jobid 38), and migration 20260902162113 exists to stagger jobs OUT of that shadow.
--   • gap :36 -> :50 = 14 min = 840 s, against the sync's observed MAX runtime of 487.9 s
--     (167 runs, 7 days). Overlay max runtime is 21.1 s, so it still completes long before :52.
do $fix$
declare v_jobid bigint; v_before text;
begin
  select jobid, schedule into v_jobid, v_before from cron.job where jobname = 'resolve-english-city-overlay';
  if v_jobid is null then
    raise exception 'cron job resolve-english-city-overlay not found - refusing to guess';
  end if;
  perform cron.alter_job(v_jobid, schedule => '50 * * * *');
  raise notice 'resolve-english-city-overlay: % -> 50 * * * *', v_before;
end $fix$;

-- THE 5-MINUTE FLOOR WAS DERIVED FROM A RUNTIME THE SYNC NO LONGER HAS. 20260819062809 wrote
-- "Sync max runtime observed 245s over 168 runs, hence a 5 minute floor." Re-measured over the last
-- 7 days (167 runs): avg 127.5 s, MAX 487.9 s — 8.1 minutes. A 5-minute floor would now certify a
-- placement that lands INSIDE the producer's own tail. Raising the floor STRENGTHENS the contract
-- (PART 7: never make a check green by weakening it); the new :50 placement satisfies it with 14.
update public.ops_cron_ordering_contract
   set min_gap_minutes = 9,
       why = why || ' [2026-09-11, routine #9] Floor raised 5 -> 9: the sync''s max runtime was '
                 || 're-measured at 487.9s (8.1 min) over 167 runs in 7 days, up from the 245s the '
                 || 'original 5-minute floor was derived from. The consumer was moved :22 -> :50 the '
                 || 'same day, after #143''s repair moved the producer :14 -> :36 across this contract.'
 where upstream_job = 'sync-search-listings-ar'
   and downstream_job = 'resolve-english-city-overlay';

-- THE CONTRACT TABLE KNEW ABOUT ONE DEPENDENCY OUT OF THREE, WHICH IS WHY THIS COULD HAPPEN AT ALL.
-- #143's author had no declared record that anything ordered around the sync, so moving it looked
-- free. Both producers below are REAL and were verified from the LIVE definitions, not from a
-- migration file:
--   • sync_search_listings_ar reads listing_native_location_v2 (pg_get_viewdef: references
--     active_listing_ids_v2), which jobid 17 refreshes — #143's own mechanism, now written down.
--     NOTE the mechanism is the SYNC's source view, NOT prune_inactive_from_search(): that function's
--     live body prunes against each raw table's own `active` column and never reads the matview.
--   • sync_search_listings_ar reads loc_display_district_canon, which jobid 109 refreshes at :08
--     (PR #2019 placed it there for this reason, and never declared it).
-- Both are SATISFIED today (gaps 16 and 28), so this adds no alert — it makes the next schedule
-- change fail loudly instead of silently, which is the whole point of the table.
insert into public.ops_cron_ordering_contract (upstream_job, downstream_job, min_gap_minutes, why)
values
  ('refresh_listing_native_location_v1', 'sync-search-listings-ar', 7,
   'sync_search_listings_ar() selects from listing_native_location_v2, a VIEW whose definition '
   'references the MATVIEW active_listing_ids_v2; jobid 17 refreshes that matview. Until 2026-09-11 '
   'the sync ran at :14 and the refresh at :20, so the sync built the served index from an hour-old '
   'snapshot and a newly reactivated listing stayed invisible to search for up to a full cycle '
   '(ops_incident #143). Floor 7 min: jobid 17 max runtime 360.4s (6.0 min) over 168 runs in 7 days.'),
  ('refresh-district-display-canon', 'sync-search-listings-ar', 2,
   'sync_search_listings_ar() reads loc_display_district_canon, the ONE canonical user-visible '
   'district rendering per (city_id, normalised district) required by SEARCH_MATCH_QA_ENGINEER.md '
   '§42.1; jobid 109 rebuilds it. PR #2019 placed that job at :08 specifically so it runs BEFORE the '
   'sync that consumes it, but never declared the dependency, so the ordering survived only as a '
   'comment. Floor 2 min: jobid 109 max runtime 6.9s over 125 runs in 7 days.')
on conflict (upstream_job, downstream_job) do nothing;
