-- Fixes a re-raise/instant-resolve churn introduced by 20260809153239's self-heal.
--
-- EVIDENCE (2026-08-10, daily engineer): gathern's single aborted cleanup run from 2026-08-09
-- 03:00:21 (cleanup_runs id 6, "301 candidates > threshold 300") produced 40 separate
-- alert_event rows between 2026-08-09 03:20 and 2026-08-10 10:50 — every one P1 'deletion_spike',
-- every one created AND resolved in the same instant (created_at = resolved_at). Root cause:
--   1. mon_detect_deletion_spike()'s main loop scans EVERY cleanup_runs row from the last 2 days
--      on EVERY run (it runs inside mon_run_all_detectors, roughly every 30 minutes) and calls
--      mon_raise() for every aborted row it finds — including one it already alerted on 27+ hours
--      ago. The aborted row stays in that 2-day window the whole time.
--   2. mon_raise() only dedupes against an OPEN row (`resolved_at is null`) for the dedup_key. The
--      self-heal block added in 20260809153239 closes the ABORTED alert as soon as a later
--      successful gathern cleanup run exists (it does: id 10, 2026-08-09 13:47:34) — so by the next
--      detector sweep, no open row remains, and mon_raise() unconditionally INSERTs a fresh one.
-- Net effect for up to 2 days after any single abort: raise -> self-heal -> raise -> self-heal,
-- every ~30 minutes, ~48 times, for an event that was correctly handled once. Not dangerous (0 rows
-- were ever deleted; the safety gate did its job) but it is alert noise that could bury a genuine
-- future spike, and it silently self-terminates only when the row ages out of the 2-day window —
-- not a real fix.
--
-- FIX: the dedup_key already encodes the specific cleanup_runs.id
-- ('deletion_spike:<platform>:<id>'), so there is never a reason to alert on the same aborted run
-- more than once, resolved or not. Skip the mon_raise() call entirely if ANY alert_event row
-- (open OR already resolved) already exists for that exact dedup_key. The self-heal block and the
-- SPIKE branch are both left exactly as they were: a SPIKE stays a distinct historical fact per run
-- (already keyed by its own id, so this same guard makes it single-fire too, which is strictly
-- correct — a resolved SPIKE alert should never have re-fired either), and self-heal still clears
-- opens created before this fix ships.
create or replace function public.mon_detect_deletion_spike()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare rec record; n int := 0; med numeric; thresh numeric; floor_n int; factor numeric; v_dedup text;
begin
  for rec in
    select r.*, p.anomaly_floor, p.anomaly_factor
    from public.cleanup_runs r
    left join public.platform_retention_policy p on p.platform = r.platform
    where r.ran_at > now() - interval '2 days' and not r.dry_run
  loop
    floor_n := coalesce(rec.anomaly_floor, 300);
    factor  := coalesce(rec.anomaly_factor, 4);
    if rec.aborted then
      v_dedup := 'deletion_spike:'||rec.platform||':'||rec.id::text;
      -- Alert once per aborted run, full stop — resolved or still open, never re-raise it.
      if not exists (select 1 from public.alert_event where dedup_key = v_dedup) then
        n := n + public.mon_raise('P1','deletion_spike', rec.platform, v_dedup,
          jsonb_build_object('event','ABORTED','reason',rec.abort_reason,'candidates',rec.candidates,'ran_at',rec.ran_at));
      end if;
      continue;
    end if;
    select coalesce(percentile_cont(0.5) within group (order by h.deleted),0) into med
      from public.cleanup_runs h
     where h.platform = rec.platform and not h.dry_run and h.ran_at < rec.ran_at and h.ran_at > rec.ran_at - interval '30 days';
    thresh := greatest(floor_n, factor * med);
    if rec.deleted > thresh then
      v_dedup := 'deletion_spike:'||rec.platform||':'||rec.id::text;
      if not exists (select 1 from public.alert_event where dedup_key = v_dedup) then
        n := n + public.mon_raise('P1','deletion_spike', rec.platform, v_dedup,
          jsonb_build_object('event','SPIKE','deleted',rec.deleted,'threshold',round(thresh),'median_30d',round(med),'ran_at',rec.ran_at));
      end if;
    end if;
  end loop;

  -- SELF-HEAL: an ABORTED alert clears once that platform has had a later successful real run.
  -- Scoped by detail->>'event' so a SPIKE alert is never silently closed. Unchanged from
  -- 20260809153239 — still needed for opens created before this fix, and harmless as a no-op
  -- afterwards since the loop above no longer reopens what it just closed.
  update public.alert_event a set resolved_at = now()
  where a.kind = 'deletion_spike'
    and a.resolved_at is null
    and a.detail->>'event' = 'ABORTED'
    and exists (
      select 1 from public.cleanup_runs c
      where c.platform = a.platform
        and not c.dry_run
        and not c.aborted
        and c.ran_at > (a.detail->>'ran_at')::timestamptz);

  return n;
end $function$;

-- Regression guard, self-cleaning, safe to run on production: proves the fixed function does NOT
-- re-raise for an aborted cleanup run that already has a resolved alert, and still DOES raise for
-- a genuinely new aborted run with no prior alert_event row at all. Mirrors the
-- mon_selftest_raise_escalates() pattern from 20260809155328.
create or replace function public.mon_selftest_deletion_spike_no_rereise() returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_platform constant text := '__selftest__deletion_spike';
  v_run_id bigint;
  v_dedup text;
  v_count_after_first int;
  v_count_after_second int;
  v_ok boolean := true;
begin
  delete from public.cleanup_runs where platform = v_platform;
  delete from public.alert_event where platform = v_platform and kind = 'deletion_spike';

  insert into public.cleanup_runs(platform, ran_at, dry_run, aborted, deleted, candidates, abort_reason)
  values (v_platform, now() - interval '1 hour', false, true, 0, 999, 'selftest abort')
  returning id into v_run_id;
  v_dedup := 'deletion_spike:'||v_platform||':'||v_run_id::text;

  -- 1. first sweep: must raise exactly once
  perform public.mon_detect_deletion_spike();
  select count(*) into v_count_after_first from public.alert_event where dedup_key = v_dedup;
  if v_count_after_first <> 1 then v_ok := false; end if;

  -- 2. resolve it the way self-heal would (a later successful run exists)
  insert into public.cleanup_runs(platform, ran_at, dry_run, aborted, deleted, candidates)
  values (v_platform, now(), false, false, 5, 5);
  perform public.mon_detect_deletion_spike();  -- this sweep both self-heals AND must not re-raise
  select count(*) into v_count_after_second from public.alert_event where dedup_key = v_dedup;
  -- pre-fix: this would be 2 (the self-heal resolves row 1, then the loop inserts a fresh row 2).
  if v_count_after_second <> 1 then v_ok := false; end if;
  if not exists (select 1 from public.alert_event where dedup_key = v_dedup and resolved_at is not null) then
    v_ok := false;  -- self-heal must still have actually resolved it
  end if;

  -- 3. a third sweep (nothing changed) must still not add a second row
  perform public.mon_detect_deletion_spike();
  if (select count(*) from public.alert_event where dedup_key = v_dedup) <> 1 then v_ok := false; end if;

  delete from public.cleanup_runs where platform = v_platform;
  delete from public.alert_event where platform = v_platform and kind = 'deletion_spike';
  return v_ok;
end $function$;

comment on function public.mon_selftest_deletion_spike_no_rereise() is
  'Regression guard: proves mon_detect_deletion_spike() alerts an aborted cleanup run exactly '
  'once, even across a self-heal resolution and repeated sweeps. Returns false on the pre-2026-08-10 '
  'implementation (40 duplicate gathern alerts in ~31h). Self-cleaning; safe to run on production.';

do $do$
begin
  if not public.mon_selftest_deletion_spike_no_rereise() then
    raise exception 'deletion_spike no-rereise self-test FAILED against the live function — refusing to ship the guard green';
  end if;
end $do$;
