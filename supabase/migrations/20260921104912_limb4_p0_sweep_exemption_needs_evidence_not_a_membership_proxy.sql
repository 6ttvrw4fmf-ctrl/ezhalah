-- Systems Seam Engineer, 2026-09-21.
--
-- DEFECT (a seam, not a component bug). mon_detect_detector_sweep_budget() LIMB 4
-- (`detector_sweep_vs_p0_slo`) is exempted from raising by mon_p0_sweep_exposure_should_raise(),
-- whose condition (2) — added 20260901104521 — concludes that a P0 can no longer be born inside
-- the long sweep transaction, and therefore that sweep duration is "no longer a term in its
-- delivery latency at all".
--
-- The evidence it rests on is a SET-MEMBERSHIP PROXY: every P0-capable detector also appears in
-- mon_run_p0_detectors()'s list, so the fast lane (jobid 86) is assumed to observe every P0 first,
-- in its own 45s transaction. That inference does not hold. The sweep (jobid 38) still runs every
-- one of those detectors too (`sweep_still_has_them`), so the raise is won by whichever caller
-- first observes the condition true — mon_raise() dedups, first observer wins. Membership in the
-- lane's list does not stop the sweep from getting there first.
--
-- PRODUCTION EVIDENCE (2026-09-21), the part the proxy cannot see:
--
--   * THE LANE DOES NOT RUN DURING SWEEPS AT ALL. Over the last 24h: 48 sweeps totalling 12,823s
--     = 14.8% of the day. Lane runs that STARTED inside a sweep window: 0. Expected from the
--     lane's own observed cadence (556 runs/24h): 82.5. Coverage ratio 0.000.
--     Over 7 days: 312 long sweeps (avg 475.4s), 824 lane slots expected inside them, 10 actual
--     (1.2%). pg_cron here does not start a job while the sweep's backend holds the scheduler —
--     the same mechanism mon_detect_cron_starvation_risk() reports (alert 3844, open since
--     2026-09-18, which names mon-p0-fast-lane as a victim of hog 38 at minutes 1,4,7,10,31,34,
--     35,38,40). So for ~15% of the clock the P0 fast lane is dark, and any condition that flips
--     in that window is first observed by the SWEEP.
--
--   * WHEN THAT HAPPENS THE SLO IS BREACHED EVERY TIME. Of P0s raised since the 2026-08-30
--     decoupling, matched to the sweep by created_at falling within the sweep run's own
--     start_time (alert_event.created_at defaults to now() = TRANSACTION START):
--       - born in the lane:  58 alerts, avg 28.3s, worst 249s, 0 breaches.
--       - born in the sweep:  3 alerts. One (2698) was raised and resolved inside the same sweep
--         transaction and never needed delivery. The two that outlived their sweep — 1166
--         (2026-08-30, 371s) and 4392 (2026-09-21, 665s) — BOTH breached the 300s SLO. 2 of 2.
--     LIMB 4 read green through both, which is precisely the failure LIMB 3 of
--     mon_detect_p0_delivery_sla() was added to prevent one layer up: a path that delivers late
--     while the forecast that exists to warn about it is structurally unable to fire.
--
--   * WORKED EXAMPLE, alert 4392 (P0 alert_queue_unworked:__systemic__). Sweep jobid 38 started
--     06:29:00.025 and ran 516.5s. The alert's created_at is 06:29:00.026 — the sweep's
--     transaction start. The lane's :31, :34 and :35 slots produced NO run rows at all (not
--     failures — no rows), and the lane next ran at 06:38:00, after the sweep committed at
--     06:37:36. Issue filed 06:40:05. Total 665s against a 300s SLO.
--
-- WHY THIS IS THE DANGEROUS SHAPE. While the exemption stands, LIMB 4 cannot raise no matter how
-- slow the sweep gets. mon_detect_p0_delivery_sla() LIMB 3 did catch the consequence (alert 4396),
-- but on a 24h rolling window — it auto-resolves tomorrow when 4392 ages out, while the structural
-- cause (475-700s sweeps plus a lane that is starved for 15% of the day) persists untouched and
-- everything reads green again until the next sweep-born P0 breaches. That is the
-- orphaned-guarantee shape: the barrier survives, its premise does not.
--
-- FIX: DISCRIMINATE, DO NOT WIDEN — and make the exemption carry EVIDENCE rather than a proxy.
-- The 300s SLO and the 40s overhead constant are untouched, and no existing raise path is
-- narrowed; this change can only make LIMB 4 raise MORE often. The exemption now additionally
-- requires that the lane actually executes during sweep windows, which is the measurable fact the
-- set-membership proxy was standing in for. Both directions preserved, and every unreadable
-- direction still fails SAFE (raises).
--
-- NEVER widen c_sla (300), the 40s overhead, or this coverage threshold to quiet the limb. If it
-- raises, either a P0-capable detector is genuinely off the lane (put it on the lane) or the lane
-- is being starved by the sweep (make the sweep faster, or ask the OWNER for a re-slot — cron
-- schedule changes are owner-only and this migration deliberately makes none).

-- ---------------------------------------------------------------------------------------------
-- GUARD: refuse to replace a body that is not the one this migration was written against, so a
-- concurrent session's edit is never silently dropped (AGENTS.md: build from the LIVE definition).
do $guard$
declare
  v_pred text;
  v_con  text;
begin
  select pg_get_functiondef('public.mon_p0_sweep_exposure_should_raise(numeric,jsonb)'::regprocedure)
    into v_pred;
  select pg_get_functiondef('public.ops_p0_lane_contract()'::regprocedure)
    into v_con;

  if v_pred !~ 'p0_capable_detectors' or v_pred !~ 'lane_runs_24h' then
    raise exception 'mon_p0_sweep_exposure_should_raise() is not the body this migration was '
      'written against — re-read the LIVE definition before replacing it';
  end if;
  if v_con !~ 'sweep_still_has_them' or v_con !~ 'lane_runs_24h' then
    raise exception 'ops_p0_lane_contract() is not the body this migration was written against — '
      're-read the LIVE definition before replacing it';
  end if;
  if v_pred ~ 'lane_sweep_coverage_ratio' then
    raise exception 'this migration has already been applied';
  end if;
end $guard$;

-- ---------------------------------------------------------------------------------------------
-- The contract gains the measured fact. Additive: every existing key keeps its meaning, so any
-- other reader is unaffected.
create or replace function public.ops_p0_lane_contract()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with stripped as (
    -- Executable source only. Stripping whole-line comments is load-bearing, not tidiness: the
    -- rationale comments in these functions quote severities constantly, and matching raw text
    -- would report half the roster as P0-capable.
    select p.proname,
           (select coalesce(string_agg(l, E'\n' order by o), '')
              from regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') with ordinality t(l, o)
             where l !~ '^\s*--') as src
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname like 'mon\_detect\_%'
  ),
  p0 as (
    -- Conservative by design -- see the header. A P0 literal anywhere in executable source, in a
    -- function that can raise. Catches the `sev := case ... 'P0' ... end; mon_raise(sev, ...)`
    -- shape that a severity-argument regex cannot follow.
    select proname from stripped
     where src ~ '''P0''' and src ~ 'mon_raise'
  ),
  lane as (
    select (select coalesce(string_agg(l, E'\n' order by o), '')
              from regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') with ordinality t(l, o)
             where l !~ '^\s*--') as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mon_run_p0_detectors'
  ),
  lane_names as (
    select m[1] as proname
      from lane, regexp_matches(lane.src, '''(mon_detect_[a-z0-9_]+)''', 'g') m
  ),
  sweep as (
    select (select coalesce(string_agg(l, E'\n' order by o), '')
              from regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') with ordinality t(l, o)
             where l !~ '^\s*--') as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mon_run_all_detectors'
  ),
  job as (
    select schedule, command, active from cron.job where jobid = 86
  ),
  runs as (
    select count(*)::int as n,
           count(*) filter (where status <> 'succeeded')::int as failed,
           round(max(extract(epoch from (end_time - start_time)))::numeric, 3) as max_s
      from cron.job_run_details
     where jobid = 86 and start_time > now() - interval '24 hours'
  ),
  -- ── NEW (2026-09-21): does the lane actually RUN while the sweep holds the scheduler? ────────
  -- The set-membership keys above say a P0 *should* be born in the lane. This says whether the
  -- lane is even executing in the window where that matters. Resolved by JOB NAME, not a
  -- hardcoded id, so a re-created sweep job does not silently blind the measurement.
  sweep_job as (
    select jobid from cron.job where jobname = 'mon-detectors-and-dispatch'
  ),
  sweep_runs as (
    select r.start_time, r.end_time,
           extract(epoch from (r.end_time - r.start_time)) as secs
      from cron.job_run_details r, sweep_job sj
     where r.jobid = sj.jobid
       and r.status = 'succeeded'
       and r.end_time is not null
       and r.start_time > now() - interval '24 hours'
  ),
  sweep_cov as (
    select
      coalesce(sum(sr.secs), 0)::numeric as total_sweep_s,
      coalesce(sum((select count(*)
                      from cron.job_run_details l
                     where l.jobid = 86
                       and l.start_time > sr.start_time
                       and l.start_time < sr.end_time)), 0)::numeric as inside_n
      from sweep_runs sr
  ),
  sweep_cov_calc as (
    -- Expected lane runs inside sweep windows, derived from the lane's OWN observed cadence
    -- (runs_24h / 24 per hour) rather than by parsing its cron minute list. AGENTS.md and the
    -- spec both warn that hand-rolling pg_cron minute expansion undercounts (`*/N` and comma
    -- lists), and this avoids the question entirely.
    select sc.total_sweep_s,
           sc.inside_n,
           round(sc.total_sweep_s * ((select n from runs)::numeric / 24.0) / 3600.0, 2) as expected_n
      from sweep_cov sc
  )
  select jsonb_build_object(
    'p0_capable_detectors', (select coalesce(jsonb_agg(proname order by proname), '[]'::jsonb) from p0),
    'lane_detectors',       (select coalesce(jsonb_agg(distinct proname), '[]'::jsonb) from lane_names),
    'lane_schedule',        (select schedule from job),
    'lane_command',         (select command from job),
    'lane_active',          (select active from job),
    'lane_runs_24h',        (select n from runs),
    'lane_failures_24h',    (select failed from runs),
    'lane_max_runtime_s',   (select max_s from runs),
    'sweep_still_has_them', (select bool_and((select src from sweep) like '%' || proname || '%') from p0),
    'sweep_total_s_24h',            (select round(total_sweep_s) from sweep_cov_calc),
    'lane_runs_inside_sweeps',      (select inside_n   from sweep_cov_calc),
    'lane_runs_expected_inside_sweeps', (select expected_n from sweep_cov_calc),
    -- NULL when there is not even one lane slot's worth of sweep time to expect: that is
    -- "unmeasurable", not "starved", and condition (1) of the predicate already gates on a slow
    -- sweep so nothing is lost.
    'lane_sweep_coverage_ratio', (select case
                                           when expected_n >= 1
                                           then round(inside_n / expected_n, 3)
                                           else null end
                                    from sweep_cov_calc)
  );
$function$;

-- ---------------------------------------------------------------------------------------------
-- The predicate. SAME SIGNATURE (numeric, jsonb) — a CREATE OR REPLACE with a different argument
-- list would be a new overload, not a replacement. Still IMMUTABLE and pure, so both directions
-- stay unit-testable against synthetic contracts with no dependence on live state.
create or replace function public.mon_p0_sweep_exposure_should_raise(
  p_max_sweep_s numeric,
  p_contract    jsonb
) returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select
    -- (1) Is the sweep slow enough that a P0 BORN INSIDE IT would breach the 300s SLO?
    --     Unchanged: 300s SLO, 40s assumed filing overhead.
    coalesce(p_max_sweep_s, 0) + 40 > 300
    and
    -- (2) ...and could a P0 still be born inside it? Fail SAFE: anything unreadable counts as
    --     exposed, so a broken contract raises rather than silently disabling the limb.
    (
         p_contract is null
      or coalesce((p_contract->>'lane_active')::boolean, false) is not true
      or coalesce((p_contract->>'lane_runs_24h')::int, 0) <= 0
      or coalesce(jsonb_typeof(p_contract->'p0_capable_detectors'), 'null') <> 'array'
      or coalesce(jsonb_typeof(p_contract->'lane_detectors'), 'null') <> 'array'
      or exists (
           select 1
             from jsonb_array_elements_text(p_contract->'p0_capable_detectors') d
            where not (p_contract->'lane_detectors' ? d)
         )
      -- (2c) NEW 2026-09-21 — EVIDENCE, NOT A PROXY.
      -- Everything above establishes only that a P0 *ought* to be observed by the lane first.
      -- It is defeated when the lane does not execute during the sweep window at all: pg_cron
      -- will not start the lane while the sweep's backend holds the scheduler, so a condition
      -- that flips mid-sweep is first observed by the SWEEP and is born with the sweep's whole
      -- runtime already charged against the 300s SLO. Measured 2026-09-21: coverage ratio 0.000
      -- (0 lane runs inside 48 sweeps totalling 14.8% of the day, against 82.5 expected), and
      -- 2 of 2 sweep-born P0s that outlived their sweep breached the SLO while this limb was
      -- exempt. A missing key is UNREADABLE and therefore exposed, like every other branch here.
      or not (p_contract ? 'lane_sweep_coverage_ratio')
      or (
              (p_contract->>'lane_sweep_coverage_ratio') is not null
          and (p_contract->>'lane_sweep_coverage_ratio')::numeric < 0.5
         )
    )
$function$;

-- ---------------------------------------------------------------------------------------------
-- EXECUTED PROOF, both directions, at apply time. The repo's standing lesson is that a
-- source-TEXT tripwire passes for exactly as long as the defect is live; this block RUNS the
-- predicate against synthetic contracts instead. A failure here aborts the migration.
do $verify$
declare
  healthy jsonb := jsonb_build_object(
    'lane_active', true,
    'lane_runs_24h', 556,
    'p0_capable_detectors', '["a","b"]'::jsonb,
    'lane_detectors',       '["a","b"]'::jsonb,
    'lane_sweep_coverage_ratio', 1.0);
  starved jsonb;
  j jsonb;
begin
  -- Direction A: healthy lane that genuinely covers the sweep window -> still EXEMPT (no raise),
  -- which is the 20260901104521 behaviour this change must not undo.
  if public.mon_p0_sweep_exposure_should_raise(700, healthy) then
    raise exception 'REGRESSION: a healthy, sweep-covering lane must remain exempt';
  end if;

  -- Direction B: the defect this migration fixes. Same healthy contract, but the lane is proven
  -- not to run during sweeps -> exposure is real -> RAISE.
  starved := healthy || jsonb_build_object('lane_sweep_coverage_ratio', 0.0);
  if not public.mon_p0_sweep_exposure_should_raise(700, starved) then
    raise exception 'FIX DID NOT TAKE: a starved lane must defeat the exemption';
  end if;

  -- Threshold behaves on both sides.
  if not public.mon_p0_sweep_exposure_should_raise(700, healthy || jsonb_build_object('lane_sweep_coverage_ratio', 0.49)) then
    raise exception 'threshold: 0.49 must raise';
  end if;
  if public.mon_p0_sweep_exposure_should_raise(700, healthy || jsonb_build_object('lane_sweep_coverage_ratio', 0.51)) then
    raise exception 'threshold: 0.51 must not raise';
  end if;

  -- Fail-safe: a contract with no coverage key at all is UNREADABLE, therefore exposed.
  j := healthy - 'lane_sweep_coverage_ratio';
  if not public.mon_p0_sweep_exposure_should_raise(700, j) then
    raise exception 'fail-safe: a missing coverage key must raise';
  end if;

  -- Unmeasurable (json null) is not starvation: condition (1) already gates on a slow sweep.
  if public.mon_p0_sweep_exposure_should_raise(700, healthy || jsonb_build_object('lane_sweep_coverage_ratio', null)) then
    raise exception 'an unmeasurable coverage ratio must not by itself raise';
  end if;

  -- Condition (1) is untouched: a FAST sweep cannot breach, however starved the lane is.
  if public.mon_p0_sweep_exposure_should_raise(100, starved) then
    raise exception 'REGRESSION: condition (1) must still gate on sweep duration';
  end if;

  -- Pre-existing directions all still hold.
  if not public.mon_p0_sweep_exposure_should_raise(700, null) then
    raise exception 'REGRESSION: a null contract must raise';
  end if;
  if not public.mon_p0_sweep_exposure_should_raise(700,
       healthy || jsonb_build_object('p0_capable_detectors', '["a","b","c"]'::jsonb)) then
    raise exception 'REGRESSION: a P0 detector off the lane must raise';
  end if;
  if not public.mon_p0_sweep_exposure_should_raise(700,
       healthy || jsonb_build_object('lane_active', false)) then
    raise exception 'REGRESSION: an inactive lane must raise';
  end if;
  if not public.mon_p0_sweep_exposure_should_raise(700,
       healthy || jsonb_build_object('lane_runs_24h', 0)) then
    raise exception 'REGRESSION: a lane with no runs must raise';
  end if;

  -- And the LIVE contract must now carry the key, or the limb is permanently in fail-safe.
  if not (public.ops_p0_lane_contract() ? 'lane_sweep_coverage_ratio') then
    raise exception 'ops_p0_lane_contract() did not gain lane_sweep_coverage_ratio';
  end if;
end $verify$;
