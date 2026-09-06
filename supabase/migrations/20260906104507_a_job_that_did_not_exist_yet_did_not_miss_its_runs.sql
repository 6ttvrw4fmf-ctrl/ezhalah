-- A cron job that did not EXIST yet did not MISS its runs.
--
-- `mon_detect_cron_health()` LIMB 5 (attendance) measures runs-started-in-24h against the number of
-- runs the SCHEDULE names in 24h. For a job created five minutes ago that denominator is a fiction:
-- an hourly job gets expected_24h = 24 and actual_24h = 0, so attendance reads 0% and LIMB 5 raises
-- `cron_absent:<jobid>` — a P2 whose own text says "pg_cron never STARTED these runs", about periods
-- that elapsed before the job existed. It then stands for ~22-24h, until enough real history
-- accumulates to cross the 90% threshold.
--
-- LIMBS 3 and 4 already solved exactly this for themselves: `ops_cron_job_first_seen` is the clock
-- that bounds LIMB 3's "never fired yet" exemption. LIMB 5 was written without it and is the only
-- limb whose window can start before the job did.
--
-- Measured, both instances confirmed against production:
--   alert 1660  cron_absent:109  refresh-district-display-canon  raised 2026-09-06 08:29:00.033744
--               first_seen_at    2026-09-06 08:29:00.033744  -- the SAME transaction. Still open.
--   alert 1431  cron_absent:105  mon-search-latency-sample      raised 2026-09-04 15:59:00.015389
--               first_seen_at    2026-09-04 15:59:00.015389  -- open 22h30m, resolved 09-05 14:29.
-- Every other cron_absent ever raised sits at 87.5-89.6% attendance on a long-established job:
-- those are genuine dips and this change does not touch them.
--
-- The cost is not only noise. While `cron_absent:<jobid>` is open on a false pretext, `mon_raise()`
-- returns 0 for that dedup_key, so a GENUINE attendance collapse on that same job during its first
-- day raises nothing and dispatches nothing — the suppression class AGENTS.md records as how nine
-- dark detectors read as a clean bill of health on 2026-08-10.
--
-- THE FIX IS THE DENOMINATOR, NOT THE THRESHOLD. The 90% floor, the >1-run shortfall guard and the
-- expected_24h >= 24 gate are all left exactly as they are; widening any of them is forbidden by
-- this detector's own `action` text and by the hard safety rails. What changes is that the window
-- is bounded by when the job was first OBSERVED, so the denominator counts periods the job could
-- actually have run in. For any job older than 24h the value is bit-identical to today's.

-- ---------------------------------------------------------------------------------------------
-- The denominator, extracted so a barrier can EXECUTE it rather than grep for it.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_cron_attendance_expected(
  p_schedule   text,
  p_first_seen timestamptz,
  p_now        timestamptz)
returns int
language sql
stable
set search_path to 'public'
as $function$
  select floor(
    public.mon_cron_minutes_in_hour(p_schedule)
    * extract(epoch from greatest(
        interval '0',
        least(interval '24 hours', p_now - coalesce(p_first_seen, p_now - interval '24 hours'))))
    / 3600.0
  )::int
$function$;

comment on function public.mon_cron_attendance_expected(text, timestamptz, timestamptz) is
  'Runs a schedule could have started in the last 24h, bounded by when the job was first observed. '
  'A NULL first_seen falls back to the full 24h window: a missing observation row must never create '
  'a blind spot, only ever the pre-existing behaviour.';

-- ---------------------------------------------------------------------------------------------
-- LIMB 5 needle-edit. Built from pg_get_functiondef() of the LIVE function at execution time, not
-- from a body captured earlier, so a concurrent session's edit to another limb is not dropped.
-- ---------------------------------------------------------------------------------------------
do $needle$
declare
  def text;
  a1_old constant text :=
    E'           public.mon_cron_minutes_in_hour(j.schedule) * 24 as expected_24h,';
  a1_new constant text :=
    E'           public.mon_cron_attendance_expected(j.schedule, s.first_seen_at, now()) as expected_24h,';
  a2_old constant text :=
    E'      from cron.job j\n     where j.active\n       and split_part(j.schedule, '' '', 2) = ''*''';
  a2_new constant text :=
    E'      from cron.job j\n      left join public.ops_cron_job_first_seen s on s.jobid = j.jobid\n     where j.active\n       and split_part(j.schedule, '' '', 2) = ''*''';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_cron_health';

  if def is null then
    raise exception 'mon_detect_cron_health() not found — refusing to guess at its body';
  end if;

  if position('mon_cron_attendance_expected' in def) > 0 then
    return;  -- idempotent: already carries the fix
  end if;

  if (length(def) - length(replace(def, a1_old, ''))) / length(a1_old) <> 1 then
    raise exception 'LIMB 5 denominator anchor is not present exactly once — refusing to edit blind';
  end if;
  if (length(def) - length(replace(def, a2_old, ''))) / length(a2_old) <> 1 then
    raise exception 'LIMB 5 from-clause anchor is not present exactly once — refusing to edit blind';
  end if;

  def := replace(def, a1_old, a1_new);
  def := replace(def, a2_old, a2_new);
  execute def;
end $needle$;

-- ---------------------------------------------------------------------------------------------
-- Barrier — and it EXECUTES the denominator against synthetic inputs rather than reading its text.
--
-- Every one of the five defects of 2026-09-04 had a barrier over the exact line, and every one of
-- those barriers was a source-TEXT tripwire that passed for the whole time the defect was live. So
-- this one calls mon_cron_attendance_expected() with the cases that matter and compares numbers.
-- Case 3 is the anti-weakening half: it fails if anyone shrinks the steady-state window, which is
-- the shape a "make the alert quieter" edit would take.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detect_cron_attendance_denominator()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t0   constant timestamptz := timestamptz '2026-09-06 12:00:00+00';
  fails jsonb := '[]'::jsonb;
  n int := 0;
begin
  -- 1. A job first observed THIS INSTANT has had zero periods, so the >= 24 gate cannot be reached
  --    and LIMB 5 cannot raise. This is the exact shape of alerts 1660 and 1431.
  if public.mon_cron_attendance_expected('8 * * * *', t0, t0) <> 0 then
    fails := fails || jsonb_build_object('case','brand_new_job','expected',0,
      'got', public.mon_cron_attendance_expected('8 * * * *', t0, t0));
  end if;

  -- 2. Partial history is counted honestly, not as a shortfall against a full day.
  if public.mon_cron_attendance_expected('8 * * * *', t0 - interval '2 hours', t0) <> 2 then
    fails := fails || jsonb_build_object('case','two_hours_observed','expected',2,
      'got', public.mon_cron_attendance_expected('8 * * * *', t0 - interval '2 hours', t0));
  end if;

  -- 3. ANTI-WEAKENING: an established hourly job still measures against the full 24 periods. If
  --    this ever returns less, attendance has been quietly made easier to pass and a real absence
  --    can hide behind it.
  if public.mon_cron_attendance_expected('8 * * * *', t0 - interval '30 hours', t0) <> 24 then
    fails := fails || jsonb_build_object('case','established_hourly_full_window','expected',24,
      'got', public.mon_cron_attendance_expected('8 * * * *', t0 - interval '30 hours', t0));
  end if;

  -- 4. Same, for a sub-hourly schedule: 6 minutes an hour x 24.
  if public.mon_cron_attendance_expected('*/10 * * * *', t0 - interval '30 hours', t0) <> 144 then
    fails := fails || jsonb_build_object('case','established_sub_hourly_full_window','expected',144,
      'got', public.mon_cron_attendance_expected('*/10 * * * *', t0 - interval '30 hours', t0));
  end if;

  -- 5. A missing ops_cron_job_first_seen row must degrade to the OLD behaviour (full window), never
  --    to silence. LIMB 5 left-joins that table, so this is a reachable input.
  if public.mon_cron_attendance_expected('8 * * * *', null, t0) <> 24 then
    fails := fails || jsonb_build_object('case','null_first_seen_falls_back_to_full_window',
      'expected',24, 'got', public.mon_cron_attendance_expected('8 * * * *', null, t0));
  end if;

  -- 6. LIMB 5 must actually USE it. A denominator function nobody calls is decoration, and the
  --    revert this barrier exists to catch is "put `* 24` back", which leaves cases 1-5 green.
  if not exists (
    select 1 from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
     where nsp.nspname = 'public' and p.proname = 'mon_detect_cron_health'
       and position('mon_cron_attendance_expected' in pg_get_functiondef(p.oid)) > 0)
  then
    fails := fails || jsonb_build_object('case','limb5_calls_the_denominator',
      'expected','mon_detect_cron_health() calls mon_cron_attendance_expected()',
      'got','it does not — LIMB 5 is measuring against the schedule again');
  end if;

  -- Every case above has been evaluated by the time we get here, so both the raise and the resolve
  -- sit on a path that genuinely ran the condition. Resolving from an early return is worse than
  -- not resolving at all (SYSTEMS_SEAM_ENGINEER.md PART 1, acknowledgment -> detector self-clear).
  if jsonb_array_length(fails) = 0 then
    perform public.mon_resolve_key('cron_attendance_denominator','cron_attendance_denominator');
    return 0;
  end if;

  n := public.mon_raise('P1','cron_attendance_denominator', null, 'cron_attendance_denominator',
    jsonb_build_object(
      'failures', fails,
      'why','mon_detect_cron_health() LIMB 5 divides runs-started by runs-the-schedule-names. That '
            'denominator is only honest once the job has existed for the whole window. When it is '
            'not, a newly created job raises cron_absent about periods that elapsed before it '
            'existed (alerts 1431 and 1660), and — worse — that open dedup_key makes mon_raise() '
            'return 0 for the same job, so a GENUINE attendance collapse during its first day '
            'raises nothing at all.',
      'fix','Restore mon_cron_attendance_expected() and LIMB 5''s call to it. Do NOT widen the 90% '
            'threshold, the >1-run shortfall guard or the expected_24h >= 24 gate to make this '
            'green: those are the parts that catch real absences, and a cron SCHEDULE change is '
            'owner-only.'));
  return n;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- Roster, in the SAME migration. A detector nothing calls is decoration and
-- mon_detect_orphaned_detectors() fires on it. Rewritten from the definition read at execution
-- time so a concurrent session's roster addition is not dropped; idempotent on re-run.
-- ---------------------------------------------------------------------------------------------
do $roster$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if def is null then
    raise exception 'mon_run_all_detectors() not found — roster entry cannot be added';
  end if;

  if position('mon_detect_cron_attendance_denominator' in def) = 0 then
    def := replace(def,
      '''mon_detect_cron_health''',
      '''mon_detect_cron_health'',' || chr(10) ||
      '    ''mon_detect_cron_attendance_denominator''');
    if position('mon_detect_cron_attendance_denominator' in def) = 0 then
      raise exception 'anchor mon_detect_cron_health not found in the roster — refusing to leave the new detector unreachable';
    end if;
    execute def;
  end if;
end $roster$;
