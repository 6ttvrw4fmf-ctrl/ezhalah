-- Senior audit run #3 (2026-08-03): the PR#256 contract says mon_unverified_inactivations_24h MUST
-- be 0, and the nightly Audit-invariants CI job checks it — but no DB-side detector was wired, so
-- today's breach (9 dealapp rows unverified-killed at 04:28 UTC) raised no alert_event and sat
-- invisible on the dashboard until CI failed at 06:18. Wire the invariant into the existing
-- mon_run_all_detectors framework (jobid38, :20/:50) so a breach raises a P1 within ~20 minutes.
-- Detect-only; changes no listing data.
create or replace function public.mon_detect_unverified_inactivation()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; cnt int;
begin
  select unverified_inactivations_24h into cnt from public.mon_unverified_inactivations_24h;
  if coalesce(cnt, 0) > 0 then
    -- Day-scoped dedup key: one alert per breach-day; a resolved alert never blocks a new day's breach.
    n := public.mon_raise('P1', 'unverified_inactivation', 'all',
      'unverified_inactivation:' || current_date,
      jsonb_build_object('count_24h', cnt,
        'contract', 'mark-stale detect-only (PR#256): time-based sweeps must never flip active on unverified rows',
        'hint', 'query per-row detail: recent active=false with missing_count=0 and deactivated_at≈last_seen_at'));
  end if;

  -- Point-in-time events: auto-resolve after ~2 days, same pattern as mass_inactivation.
  update public.alert_event set resolved_at = now()
   where kind = 'unverified_inactivation' and resolved_at is null
     and created_at < now() - interval '2 days';

  return n;
end $function$;

-- Wire into mon_run_all_detectors via guarded needle-edit of the LIVE def (never a repo copy).
do $mig$
declare src text; out text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  if position('mon_detect_unverified_inactivation' in src) > 0 then
    raise notice 'already wired — skipping';
    return;
  end if;
  out := replace(src,
    'declare a int; b int; c int; d int; e int; f int; g int; h int; i int; j int; k int; l int; m int; nn int;',
    'declare a int; b int; c int; d int; e int; f int; g int; h int; i int; j int; k int; l int; m int; nn int; oo int;');
  out := replace(out,
    'nn := public.mon_detect_deletion_spike();',
    'nn := public.mon_detect_deletion_spike();
  oo := public.mon_detect_unverified_inactivation();');
  out := replace(out,
    '''deletion_spike'',nn,''ran_at'',now());',
    '''deletion_spike'',nn,''unverified_inactivation'',oo,''ran_at'',now());');
  if out = src or position('oo := public.mon_detect_unverified_inactivation()' in out) = 0
     or position('''unverified_inactivation'',oo' in out) = 0 then
    raise exception 'mon_run_all_detectors: needle-edit did not apply cleanly — aborting';
  end if;
  execute out;
end
$mig$;
