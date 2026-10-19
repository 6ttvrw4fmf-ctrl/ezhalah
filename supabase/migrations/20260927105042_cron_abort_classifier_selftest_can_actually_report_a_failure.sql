-- THE SELF-TEST ADDED IN 20260927104904 COULD NOT REPORT A FAILURE (routine-7-seam, 2026-09-27).
--
-- Found by the mandatory mutation proof (§G.9.4) minutes after it shipped, which is the entire reason
-- that step is not discretionary. `v_bad text[] := '{}'` followed by
--     v_bad := v_bad || 'some message'
-- does NOT append an element: an untyped literal next to a text[] resolves to the array||array
-- operator, so Postgres tries to parse the sentence as an array literal and the function ERRORS:
--     22P02 malformed array literal: "the real alert_event row-lock abort ... "
--
-- The happy path never touches that line, so the self-test returned 0 and read perfectly healthy.
-- It would have thrown 22P02 the first time the classifier actually broke -- and a detector that
-- throws inside mon_run_all_detectors() lands in `failed`, it does not raise its own alert. So the
-- barrier built to stop LIMB 2 silently returning to the harmful remedy was itself unable to fire:
-- the same "a monitor that cannot fire reads as clean" shape AGENTS.md records for the nine dark
-- detectors of 2026-08-10, reproduced inside a brand-new barrier.
--
-- FIX: array_append(), which is unambiguous, plus a scalar cast on every message. Nothing else
-- changes -- the six assertions and their captured production messages are byte-identical.

create or replace function public.mon_detect_cron_abort_classifier_selftest()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  v_bad text[] := '{}';
  -- REAL messages, captured from production cron.job_run_details on 2026-09-27.
  c_lock_wait text := E'ERROR:  canceling statement due to statement timeout\nCONTEXT:  while updating tuple (526,7) in relation "alert_event"\nSQL statement "update public.alert_event\n     set detail          = coalesce(p_detail, a.detail)"';
  c_work      text := E'ERROR:  canceling statement due to statement timeout\nCONTEXT:  SQL statement "select count(*)             from public.mon_aqar_ppm_as_total"\nPL/pgSQL function mon_detect_aqar_ppm_as_total() line 12 at SQL statement';
  c_locking   text := E'ERROR:  canceling statement due to statement timeout\nCONTEXT:  while locking tuple (1,2) in relation "listing_location_canonical_mv"';
  c_decoy     text := E'ERROR:  canceling statement due to statement timeout\nCONTEXT:  SQL statement "select relation from pg_locks where relation is not null and tuple is not null"';
begin
  if not public.mon_cron_abort_is_lock_wait(c_lock_wait) then
    v_bad := array_append(v_bad, 'the real alert_event row-lock abort (jobid 86, 07:51Z) was classified as expensive work'::text);
  end if;
  if public.mon_cron_abort_lock_relation(c_lock_wait) is distinct from 'alert_event' then
    v_bad := array_append(v_bad, 'the blocked relation was not extracted from the real row-lock abort'::text);
  end if;
  if not public.mon_cron_abort_is_lock_wait(c_locking) then
    v_bad := array_append(v_bad, 'a SELECT-FOR-UPDATE style "while locking tuple" abort was not recognised as a lock wait'::text);
  end if;
  if public.mon_cron_abort_is_lock_wait(c_work) then
    v_bad := array_append(v_bad, 'a genuine expensive-work abort (mon-aqar-ppm-as-total) was misread as a lock wait'::text);
  end if;
  if public.mon_cron_abort_is_lock_wait(c_decoy) then
    v_bad := array_append(v_bad, 'a message merely containing the words relation and tuple was misread as a lock wait'::text);
  end if;
  if public.mon_cron_abort_is_lock_wait(null) then
    v_bad := array_append(v_bad, 'a NULL return_message was classified as a lock wait (absence is not evidence)'::text);
  end if;

  if array_length(v_bad, 1) > 0 then
    n := n + public.mon_raise('P1', 'cron_abort_classifier_broken', null,
      'cron_abort_classifier_broken',
      jsonb_build_object(
        'failures', to_jsonb(v_bad),
        'why', 'mon_cron_abort_is_lock_wait()/mon_cron_abort_lock_relation() no longer classify the '
            || 'REAL production messages they were built from. mon_detect_cron_timeout_headroom() '
            || 'LIMB 2 uses them to choose which remedy to prescribe, so while this is broken that '
            || 'detector is back to telling whoever responds to raise a budget that must NOT be '
            || 'raised (the P0 fast lane, where a bigger budget lengthens the lock wait and spends '
            || 'the 300 s P0 SLO), or to hunt a lock holder that does not exist.',
        'action', 'Fix the classifier. Do NOT delete or weaken this self-test to make a sweep read '
            || 'clean: it executes the predicate against captured messages precisely so it cannot '
            || 'pass over a predicate that no longer works.'));
  else
    perform public.mon_resolve_key('cron_abort_classifier_broken', 'cron_abort_classifier_broken');
  end if;
  return n;
end $function$;
