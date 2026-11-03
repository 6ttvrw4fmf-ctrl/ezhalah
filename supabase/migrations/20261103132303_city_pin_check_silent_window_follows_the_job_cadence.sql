-- THE PIN-CITY «SILENT» ALARM FOLLOWS THE JOB'S OWN CADENCE (🔧 2026-11-03, alert 12863 city_pin_check_silent).
-- pin-city-correction (cron job 202) runs at 00:50, 04:50, 18:50 and 20:50 UTC, so the longest HEALTHY gap between
-- two decision passes is 14 h (04:50 → 18:50). mon_detect_city_pin_mismatch() raised city_pin_check_silent after 8 h,
-- so every day from ~12:50 to 18:50 the sweep read a job that had simply not been scheduled yet as «gone silent»
-- (11-03 12:59: last decision 04:50:00, every run of job 202 succeeded, next slot 18:50). The window becomes 15 h:
-- one missed scheduled slot still raises within the hour after it was due. In-place text edit of the live function,
-- raising if the expected text is absent (never retype a live function: 🔧 lesson 2026-10-30).
do $mig$
declare
  d text := pg_get_functiondef('public.mon_detect_city_pin_mismatch()'::regprocedure);
  old_ constant text := $o$v_last < now() - interval '8 hours'$o$;
  new_ constant text := $n$v_last < now() - interval '15 hours'$n$;
begin
  if position(old_ in d) = 0 then
    raise exception 'mon_detect_city_pin_mismatch: the 8-hour window was not found — read the live function first';
  end if;
  execute replace(d, old_, new_);
  if position(new_ in pg_get_functiondef('public.mon_detect_city_pin_mismatch()'::regprocedure)) = 0 then
    raise exception 'mon_detect_city_pin_mismatch: the 15-hour window did not land';
  end if;
end
$mig$;

-- Proof at apply time: the detector's own evaluated path closes 12863 (last decision 04:50 is inside 15 h) and
-- keeps the P3 title-conflict row, which this change does not touch.
select public.mon_detect_city_pin_mismatch();
