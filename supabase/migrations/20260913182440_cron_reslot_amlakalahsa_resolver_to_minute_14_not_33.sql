-- CORRECTS THE PREVIOUS MIGRATION'S SLOT CHOICE. :33 was not free (routine #7, 2026-09-13).
--
-- 20260913182248 moved resolve-amlakalahsa-locations off the 3-job :25 collision onto :33, on a
-- count that was WRONG. The count was made with an ad-hoc query matching only a literal minute and
-- a comma list. mon_detect_cron_minute_collision() expands FIVE minute-field shapes, and two of them
-- land on :33:
--
--   resolve-dealapp-districts    3-59/10 * * * *              -> 3,13,23,33,43,53
--   mon-search-latency-sample    2,6,9,12,14,23,30,33,40,...  -> includes 33
--
-- So :33 already held 2, and the move took it to 3 — trading the :25 collision for an identical
-- :33 one. Measured immediately after applying: collisions "min 33 -> 3 jobs", and alert 2725 stayed
-- OPEN. Its dedup key was never released, which is why the detector still returned 0: mon_raise()
-- returns 0 on an already-open key, so "0 raised" did NOT mean "no collision". That is the exact
-- reading this routine's own spec warns about, and it is the only reason the mistake was caught in
-- the same run rather than read as success.
--
-- THE LESSON, recorded because the next session will be tempted the same way: the DETECTOR'S
-- expansion is the authority on which minutes are occupied, not a hand-rolled count. Ask it, or
-- reuse its CTE verbatim. SYSTEMS_SEAM_ENGINEER.md's "49 of 60 minutes sit at <= 1" is a 2026-08-30
-- measurement and is now stale: re-measured today with the detector's own logic, exactly ONE minute
-- (:32) carries zero hourly jobs, and only nine carry <= 1.
--
-- :14 chosen on that corrected measurement: one counted hourly job (mon-search-latency-sample, a
-- cheap probe), no non-hourly job on the same minute, and clear of every reserved slot — :00
-- (matview refresh), :09/:39 (alert-dispatch), :13/:43 (the enrollment guard's own GitHub schedule),
-- :24/:42 (the two existing backstops), :29/:59 (the detector sweep), and all 24 minutes of
-- mon-p0-fast-lane. Command preserved byte-exact; this is a slot move only.
select cron.schedule('resolve-amlakalahsa-locations', '14 * * * *',
  $$select resolve_amlakalahsa_locations();$$);

do $verify$
declare
  v_sched text;
  v_cmd   text;
  v_bad   text;
  v_open  int;
begin
  select schedule, command into v_sched, v_cmd
    from cron.job where jobname = 'resolve-amlakalahsa-locations';
  if v_sched is distinct from '14 * * * *' then
    raise exception 'resolve-amlakalahsa-locations did not move to :14 (got %)', v_sched;
  end if;
  if v_cmd is distinct from 'select resolve_amlakalahsa_locations();' then
    raise exception 'command changed — expected byte-exact, got %', v_cmd;
  end if;

  -- Re-run the detector's OWN expansion rather than trusting its return value, precisely because
  -- an already-open dedup key makes that return value 0 either way.
  with hourly_jobs as (
    select jobid, split_part(schedule,' ',1) as min_f
    from cron.job where active and split_part(schedule,' ',2) = '*'
  ),
  expanded as (
    select j.jobid, m.minute
    from hourly_jobs j cross join generate_series(0,59) m(minute)
    where (j.min_f = '*')
       or (j.min_f ~ '^\d+$' and m.minute = j.min_f::int)
       or (j.min_f ~ '^\d+(,\d+)+$' and m.minute::text = any(string_to_array(j.min_f,',')))
       or (j.min_f ~ '^\*/\d+$' and m.minute % split_part(j.min_f,'/',2)::int = 0)
       or (j.min_f ~ '^\d+-59/\d+$' and m.minute >= split_part(j.min_f,'-',1)::int
           and (m.minute - split_part(j.min_f,'-',1)::int) % split_part(j.min_f,'/',2)::int = 0)
  )
  select string_agg(format('min %s -> %s jobs', minute, c), '; ') into v_bad
  from (select minute, count(*) c from expanded group by minute
         having count(*) >= 3 or (minute = 0 and count(*) > 1)) x;

  if v_bad is not null then
    raise exception 'still colliding after the move: %', v_bad;
  end if;

  -- and the detector must now actually RELEASE the key, not merely return 0
  perform public.mon_detect_cron_minute_collision();
  select count(*) into v_open from public.alert_event
    where dedup_key = 'cron_minute_collision' and resolved_at is null;
  if v_open <> 0 then
    raise exception 'collision cleared but alert 2725 did not resolve — the detector''s resolve path did not fire (% still open)', v_open;
  end if;
end $verify$;
