-- Data Integrity run #29 (2026-08-18): a price-fidelity detector one busy minute from going dark.
--
-- jobid 63 (mon-aqar-ppm-as-total, hourly at :25) failed at 07:25 with
--   ERROR: canceling statement due to statement timeout
--   CONTEXT: "select count(*) from public.mon_aqar_ppm_as_total"
-- having succeeded at 04:25, 05:25 and 06:25. The trigger was contention from this run's own work,
-- but the fragility is not: measured immediately afterwards on an idle database the detector takes
-- **20,989 ms**, because mon_aqar_ppm_as_total runs aqar_published_ppm() plus a second Arabic-digit
-- regex over the source_text of EVERY active aqar Buy listing. A 21 s query under an inherited
-- default timeout does not need much company to be cancelled.
--
-- That matters because of what this detector protects: the aqar "price-per-meter stored as the
-- total" class. A cancelled detector raises nothing, counts 0 in nobody's sweep, and looks exactly
-- like a clean bill of health — the §11a/§23a failure mode.
--
-- Minimal fix, nothing about the check itself changes: give the job an explicit, generous
-- statement_timeout, the same shape jobs 16 and 17 already use for their heavy refreshes. Cadence,
-- predicate, thresholds and the raised alert are all untouched. Deliberately NOT "gate it to a
-- daily slot": the cheap fix keeps hourly coverage, and dropping to daily would be trading real
-- protection for tidiness.

select cron.alter_job(63, command => $cmd$set statement_timeout to '120s'; select public.mon_detect_aqar_ppm_as_total();$cmd$);

comment on view public.mon_aqar_ppm_as_total is
  'aqar Buy rows whose stored price_total equals the page''s published سعر المتر while a labelled '
  '«السعر: N ريال» in the same capture says otherwise - i.e. the rate stored as the total. '
  'EXPENSIVE BY NATURE: aqar_published_ppm() plus an Arabic-digit regex over every active aqar Buy '
  'source_text, measured 20,989 ms on an idle database (run #29). That is normal, not a regression - '
  'jobid 63 carries an explicit 120 s statement_timeout because the inherited default cancelled it '
  'on 2026-08-18 07:25 under ordinary contention, and a cancelled detector protects nothing.';
