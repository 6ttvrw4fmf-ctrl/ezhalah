-- TWO P0-CAPABLE DETECTORS WERE ONLY EVER EVALUATED INSIDE THE LONG SWEEP TRANSACTION.
--
-- P1 alert 1428 (detector_sweep_vs_p0_slo) named them: mon_detect_alert_queue_unworked and
-- mon_detect_stalled_incident. Confirmed independently here rather than taken from the payload —
-- exactly 12 public mon_detect_* functions can raise 'P0', and mon_run_p0_detectors() listed 10.
--
-- WHY THAT COSTS THE SLO. alert_event.created_at defaults to now() = TRANSACTION START, and the row
-- is invisible to any dispatcher until that transaction commits. A P0 raised only inside
-- mon_run_all_detectors() therefore spends the entire sweep runtime before dispatch can begin.
-- Measured over the 24h to 2026-09-05: 48 sweeps, avg 241s, max 731s, and 11 of 48 already exceed
-- the whole 300s P0 budget on their own. A P0 born in one of those breaches on arrival.
--
-- Detectors ON the lane do not have this problem: mon-p0-fast-lane (jobid 86) calls
-- mon_run_p0_detectors() in its own short transaction on 24 minute-slots (worst gap 3 min) under a
-- 45s statement_timeout. Measured effect, same 24h: every P0 actually raised was delivered in
-- 15-26s against the 300s SLO.
--
-- THE FIX IS THE CHEAP ONE, AND IT CHANGES NO SCHEDULE. Both detectors are added to the lane's
-- roster. Measured cost before adding: mon_detect_alert_queue_unworked 8 ms,
-- mon_detect_stalled_incident 2 ms — 10 ms onto a lane whose measured cost is ~6 ms per run against
-- a 45s budget. No cron schedule is touched (jobid 86 already exists and already runs), the 300s SLO
-- is NOT widened, no detector is weakened, and the full sweep still calls both as before. They now
-- simply also evaluate every ~3 minutes in a transaction that commits immediately.
--
-- WHY THIS DRIFTED IN THE FIRST PLACE, AND THE HALF THAT ACTUALLY PREVENTS IT RECURRING.
-- mon_run_p0_detectors()'s own comment says the list "is machine-checked against reality by
-- scripts/verify-p0-fast-lane-detection.ts, which enumerates every public mon_detect_* whose body
-- can raise 'P0' and FAILS if one is missing here." That script was never written — it is one of the
-- KNOWN_GAPS entries in scripts/verify-ops-remediation-scripts-exist.ts, routed to routine-7-seam.
-- So the guarantee that was supposed to stop exactly this drift did not exist, and two detectors
-- added later inherited the slow path silently. This migration ships the reader that barrier needs:
-- ops_p0_detectors_off_fast_lane(), computed from pg_proc — production's own truth — so the check
-- can EXECUTE the invariant instead of reading the roster's source text and believing it.
--
-- ANON-SAFE: returns function names and a reason string. No listing data, no user data, no counts
-- of anything private. Same shape and rationale as ops_searchable_platforms_unmonitored().

create or replace function public.ops_p0_detectors_off_fast_lane()
returns table (detector text, why text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_p0_detectors';

  -- FAIL CLOSED. A missing lane is strictly worse than one detector missing from it, and an empty
  -- result here means "all P0 detectors are on the lane" — so silence must never be the answer to
  -- "the lane is gone".
  if v_def is null then
    return query select
      'mon_run_p0_detectors'::text,
      ('the fast-lane roster function does not exist at all, so EVERY P0-capable detector now '
       || 'evaluates only inside the twice-hourly sweep transaction and inherits its full runtime '
       || 'before dispatch can begin')::text;
    return;
  end if;

  return query
    select p.proname::text,
           ('raises P0 but is not named in mon_run_p0_detectors(), so it is only evaluated inside '
            || 'mon_run_all_detectors(). alert_event.created_at is transaction start and the row is '
            || 'invisible until that transaction commits, so a P0 it raises spends the entire sweep '
            || 'runtime before dispatch begins. Add it to the lane roster — do not widen the SLO.')::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname like 'mon\_detect\_%'
       and pg_get_functiondef(p.oid) ~ '''P0'''
       and position('''' || p.proname || '''' in v_def) = 0
     order by 1;
end $function$;

comment on function public.ops_p0_detectors_off_fast_lane() is
  'Every public mon_detect_* that can raise P0 but is not on the mon_run_p0_detectors() fast-lane '
  'roster. Computed from pg_proc, never from a hand-kept list, so a detector added tomorrow is '
  'covered without anyone remembering. Zero rows is the healthy state; it fails closed if the lane '
  'function itself is missing. Read by scripts/verify-p0-fast-lane-detection.ts.';

revoke all on function public.ops_p0_detectors_off_fast_lane() from public;
grant execute on function public.ops_p0_detectors_off_fast_lane() to anon, authenticated, service_role;

-- ── Add the two missing detectors, by needle-editing the LIVE definition ─────────────────────────
-- Never a full-body replace from a snapshot: concurrent sessions edit this same roster, and
-- re-creating it from a stale copy would silently drop their additions.
do $$
declare v_def text; v_after text; v_off int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_p0_detectors';
  if v_def is null then
    raise exception 'REFUSING: mon_run_p0_detectors() not found';
  end if;

  if position('''mon_detect_alert_delivery''' in v_def) = 0
     or position('''mon_detect_silent_scraper_death''' in v_def) = 0 then
    raise exception 'REFUSING: roster anchors not found — refusing to guess where to insert';
  end if;

  if position('''mon_detect_alert_queue_unworked''' in v_def) = 0 then
    v_def := replace(v_def, '''mon_detect_alert_delivery'',',
      '''mon_detect_alert_delivery'',' || chr(10) || '    ''mon_detect_alert_queue_unworked'',');
  end if;
  if position('''mon_detect_stalled_incident''' in v_def) = 0 then
    v_def := replace(v_def, '''mon_detect_silent_scraper_death'',',
      '''mon_detect_silent_scraper_death'',' || chr(10) || '    ''mon_detect_stalled_incident'',');
  end if;

  execute v_def;

  -- Prove the rewrite took, against the live catalog rather than the string we just built.
  select pg_get_functiondef(p.oid) into v_after
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_p0_detectors';
  if position('''mon_detect_alert_queue_unworked''' in v_after) = 0
     or position('''mon_detect_stalled_incident''' in v_after) = 0 then
    raise exception 'REFUSING: roster rewrite did not take';
  end if;

  -- THE INVARIANT, asserted through the new reader: nothing P0-capable is left off the lane.
  select count(*) into v_off from public.ops_p0_detectors_off_fast_lane();
  if v_off <> 0 then
    raise exception 'REFUSING: % P0-capable detector(s) still off the fast lane', v_off;
  end if;

  raise notice 'fast lane now carries every P0-capable detector; off-lane count = 0';
end $$;
