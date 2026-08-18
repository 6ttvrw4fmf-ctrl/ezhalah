-- Data Integrity run #29, RETRACTION of this run's own 20260818075438.
--
-- That migration gave jobid 63 (mon-aqar-ppm-as-total) an explicit 120 s statement_timeout, on the
-- stated reasoning that the job had been cancelled at 07:25 under an inherited default it could
-- outgrow. The reasoning was wrong and the change was a no-op:
--
--   pg_settings: statement_timeout = 120000 (source: configuration file)
--   cron.job_run_details, the 07:25 failure: duration exactly 120.0 s
--
-- The job already had 120 s. Setting it to 120 s changed nothing. The real explanation is simpler
-- and is this run's own doing: at 07:25 this session was running full listing_native_location_v2
-- scans and a 3.6 s detector in a loop, and the 21 s query lost the race. Left alone it recovered
-- immediately — 08:25 succeeded in **26.8 s**, against measurements of 22.1 s (06:25) and 20,989 ms
-- on an idle database. A 27 s query under a 120 s ceiling has ~4x headroom and needs no fix.
--
-- So the cron command goes back exactly as it was. What is KEPT is the measured cost on the view's
-- comment, because that part was true and is the number a future run should compare against: if
-- this detector ever reads 60 s+, that is a real regression rather than the contention seen today.
--
-- The rule this pins, and the reason this retraction is a migration rather than a quiet revert:
-- **a fix whose premise was never verified is not a fix.** "The job has no explicit timeout" was
-- assumed from reading the cron command; one look at pg_settings would have refuted it before the
-- change was applied. Check the value the system actually resolves, not the value its call site
-- fails to mention. (Same shape as §23b: kill_cap=150 *looked* computed.)

select cron.alter_job(63, command => $cmd$select public.mon_detect_aqar_ppm_as_total();$cmd$);

comment on view public.mon_aqar_ppm_as_total is
  'aqar Buy rows whose stored price_total equals the page''s published سعر المتر while a labelled '
  '«السعر: N ريال» in the same capture says otherwise - i.e. the rate stored as the total. '
  'EXPENSIVE BY NATURE: aqar_published_ppm() plus an Arabic-digit regex over every active aqar Buy '
  'source_text. Measured 2026-08-18: 20,989 ms idle, 22.1 s and 26.8 s in scheduled runs, against '
  'the cluster''s 120 s statement_timeout - roughly 4x headroom, so no timeout override is needed. '
  'The single cancellation at 07:25 that day was contention from the data-integrity run itself, not '
  'a config gap (run #29 briefly "fixed" it with an explicit 120 s that was already the default, and '
  'retracted that in 20260818082... ). If this ever reads 60 s+, treat it as a real regression.';
