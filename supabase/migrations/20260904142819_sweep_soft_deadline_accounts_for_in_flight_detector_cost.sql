-- WHY: mon_run_all_detectors already has a soft deadline (0.75 * budget) whose stated intent is
-- "Half a sweep plus a dispatched alert naming the gap beats a whole sweep rolled back in
-- silence." But it is only tested BEFORE a detector is called, so it cannot bound a detector that
-- is ALREADY RUNNING. A detector entering at 674s with 226s of budget left and a 230s runtime
-- still drives the sweep into the hard statement_timeout -- and because pg_cron runs the whole
-- sweep in ONE transaction, that rolls back every alert already raised, skips
-- mon_dispatch_alerts entirely, and even rolls back the ops_detector_timing rows that would have
-- shown where the time went. That is exactly what happened twice on 2026-09-04 (06:29Z, 06:59Z),
-- both killed at exactly 900.0s inside mon_detect_discarded_location_resolution.
--
-- FIX: before calling a detector, add its OWN expected cost to the elapsed time and refuse to
-- start it if that would not leave room to commit. Expected cost is the p90 of its last 7 days
-- of recorded runtimes -- data ops_detector_timing already collects. A detector with no history
-- (brand new) predicts 0 and therefore always runs; the pre-existing soft deadline still bounds
-- it. A reserve keeps room for mon_dispatch_alerts and the commit itself.
--
-- This does not silence anything: a detector skipped this way already takes the existing
-- ops_detector_timing(skipped=true) row and the existing P1 detector_sweep_budget alert naming
-- it. It converts a SILENT total rollback into a LOUD partial success, which is the documented
-- intent of the soft deadline.
--
-- Applied by string surgery on the live definition, with anchor assertions, specifically so the
-- 154-entry detector roster is preserved byte-for-byte. Retyping that array by hand is how a
-- detector silently leaves the roster and goes dark -- the exact failure class this repo has
-- been burned by before.

do $mig$
declare
  v_def text;
  v_new text;
  a_decl constant text := '  v_elapsed  numeric;';
  a_soft  constant text := '  v_soft_s := 0.75 * v_budget_s;';
  a_gate  constant text := '    if extract(epoch from clock_timestamp() - v_started) > v_soft_s then';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if v_def is null then
    raise exception 'mon_run_all_detectors() not found';
  end if;
  if position('v_pred_ms' in v_def) > 0 then
    raise notice 'already applied -- nothing to do';
    return;
  end if;
  if position(a_decl in v_def) = 0 then raise exception 'anchor missing: declarations'; end if;
  if position(a_soft in v_def) = 0 then raise exception 'anchor missing: soft deadline assignment'; end if;
  if position(a_gate in v_def) = 0 then raise exception 'anchor missing: soft deadline check'; end if;

  v_new := replace(v_def, a_decl, a_decl || $ins$
  v_cost      jsonb   := '{}'::jsonb;
  v_pred_ms   numeric;
  v_reserve_s numeric := 90;$ins$);

  v_new := replace(v_new, a_soft, a_soft || $ins$

  -- Expected per-detector cost, so the deadline below can account for the detector it is
  -- ABOUT to start rather than only for the time already spent. p90 over 7 days: high enough
  -- to respect a genuinely slow detector, resistant to a single pathological outlier
  -- permanently locking one out. Unknown detector -> no entry -> predicts 0 -> runs.
  select coalesce(jsonb_object_agg(detector, p90), '{}'::jsonb)
    into v_cost
    from (select detector,
                 percentile_disc(0.9) within group (order by elapsed_ms) as p90
            from public.ops_detector_timing
           where swept_at > now() - interval '7 days'
             and not skipped
             and coalesce(crashed, false) = false
           group by detector) s;$ins$);

  v_new := replace(v_new, a_gate, $ins$    v_pred_ms := coalesce((v_cost ->> fn)::numeric, 0);
    if extract(epoch from clock_timestamp() - v_started) > v_soft_s
       or (v_pred_ms > 0
           and extract(epoch from clock_timestamp() - v_started) + v_pred_ms / 1000.0
               > v_budget_s - v_reserve_s) then$ins$);

  execute v_new;
end
$mig$;
