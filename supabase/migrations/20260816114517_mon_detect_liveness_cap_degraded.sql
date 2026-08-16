-- A DESTRUCTIVE THRESHOLD THAT SILENTLY DEGRADES (DIE run #24, 2026-08-16)
--
-- gathern's liveness anomaly guard sizes itself as max(150, 2% of currently-active). It read that
-- denominator with a head=True count, which returns .count = 0 on the pinned client
-- (supabase 2.10.0 / postgrest 0.18.0). Measured against production that day:
--   head=True  -> .count = 0      -> resolve_kill_cap(0)     = 150   <-- what production used
--   head=False -> .count = 29335  -> resolve_kill_cap(29335) = 586   <-- what was designed
-- So the cap sat on its floor on EVERY run since the code shipped, roughly 4x tighter than
-- designed, and every run logged a bare "kill_cap=150" that looked computed. The 06:41 sweep on
-- 2026-08-16 then refused a 173-row batch as an anomaly that the designed cap would have accepted,
-- leaving source-dead units served to users behind an alert nobody could action.
--
-- The code half is fixed (scrapers/gathern/liveness.py) and pinned offline by
-- scripts/verify-liveness-kill-cap-denominator.ts. This is the LIVE half: the offline guard proves
-- the source no longer says head=True, but only production can say what cap a real run actually
-- used. That is the gap this detector closes.
--
-- IT MUST DISTINGUISH TWO CASES, NOT SILENCE ONE (AGENTS.md: never silence a barrier to make it
-- green -- make it distinguish cases, and prove both directions):
--   * an EXPLICIT --kill-cap override, which the run now records as "[override active=NNNNN]".
--     That is a deliberate, reviewed decision -- currently an owner-pending HOLD on the 172-row
--     backlog -- and must NOT raise.
--   * a cap that claims to be computed ("[auto=...]", or legacy notes with no provenance marker at
--     all) yet sits below what its own active count implies. That is the silent degradation, and it
--     must raise every time.
create or replace function public.mon_detect_liveness_cap_degraded()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  n int := 0;
  v_notes text;
  v_started timestamptz;
  v_logged int;
  v_active bigint;
  v_expected int;
begin
  -- the most recent gathern liveness sweep that actually recorded a cap
  select notes, started_at into v_notes, v_started
    from public.scrape_runs
   where platform = 'gathern_liveness' and notes ~ 'kill_cap=[0-9]+'
   order by started_at desc
   limit 1;

  if v_notes is null then
    perform public.mon_resolve_key('liveness_cap_degraded', 'liveness_cap_degraded:gathern');
    return 0;
  end if;

  -- An explicit override is a reviewed decision, not a degradation. Leave it alone.
  if v_notes ~ '\[override' then
    perform public.mon_resolve_key('liveness_cap_degraded', 'liveness_cap_degraded:gathern');
    return 0;
  end if;

  v_logged := (regexp_match(v_notes, 'kill_cap=([0-9]+)'))[1]::int;
  select count(*) into v_active
    from public.gathern_residential_listings
   where active and source = 'Gathern';
  v_expected := greatest(150, (v_active * 2 / 100)::int);

  if v_logged < v_expected then
    n := public.mon_raise('P2', 'liveness_cap_degraded', 'gathern',
      'liveness_cap_degraded:gathern',
      jsonb_build_object(
        'logged_cap', v_logged, 'expected_cap', v_expected, 'active_rows', v_active,
        'run_started_at', v_started, 'notes', v_notes,
        'why', 'The last gathern liveness sweep used a kill cap BELOW what its own active-row count '
            || 'implies, and did not record an explicit override -- so the cap is claiming to be '
            || 'computed while sitting on its floor. This is the 2026-08-16 class: the denominator '
            || 'was read with head=True, which returns .count = 0 on supabase 2.10.0, so '
            || 'resolve_kill_cap(0) yielded the 150 floor on every run for days while the log looked '
            || 'normal. A cap that is too TIGHT is not harmless: it quarantines legitimate batches '
            || 'as anomalies, and source-dead listings stay served to real users. FIX: check the '
            || 'count query in scrapers/gathern/liveness.py (it must NOT use head=True) rather than '
            || 'raising the floor. If the tighter cap is deliberate, pass --kill-cap so the run '
            || 'records "[override ...]" and this detector correctly stays quiet.'));
  else
    perform public.mon_resolve_key('liveness_cap_degraded', 'liveness_cap_degraded:gathern');
  end if;
  return n;
end $fn$;

comment on function public.mon_detect_liveness_cap_degraded() is
  'Catches a destructive liveness cap that silently degrades to its floor (DIE #24, 2026-08-16: a '
  'head=True count returned 0 on supabase 2.10.0, pinning the cap at 150 instead of 586 for days). '
  'Deliberate --kill-cap overrides record "[override ...]" and are correctly ignored.';

-- roster it (guarded needle-edit -- never a pasted body)
do $mig$
declare
  v_def text;
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing -- refusing to guess at the array shape';
  end if;
  if position('''mon_detect_liveness_cap_degraded''' in v_def) > 0 then
    raise notice 'already rostered'; return;
  end if;
  v_def := replace(v_def, anchor,
    '    ''mon_detect_liveness_cap_degraded'',' || E'\n' || anchor);
  execute v_def;
end $mig$;

-- prove it, in the same transaction
do $mig$
declare v_def text; fn text; missing text[] := '{}';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  -- the new entry, plus CONTROLS that predate this migration (a stale-copy rebuild would lose them)
  foreach fn in array array[
    'mon_detect_liveness_cap_degraded',
    'mon_detect_unresolvable_detector',
    'mon_detect_price_size_contamination','mon_detect_orphaned_detectors',
    'mon_detect_silent_scraper_death','mon_detect_deploy_lock_misuse'] loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster lost or never gained: %', array_to_string(missing, ', ');
  end if;
  if position('open_alerts' in v_def) = 0 then
    raise exception 'roster return no longer reports standing open alerts';
  end if;
  -- the detector itself must be resolvable (mon_detect_unresolvable_detector would catch it, but
  -- shipping a new barrier that trips another barrier is not acceptable)
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='mon_detect_liveness_cap_degraded'
                    and p.prosrc ~* '(mon_resolve|resolved_at\s*=\s*now\(\))') then
    raise exception 'the new detector has no resolve path';
  end if;
end $mig$;
