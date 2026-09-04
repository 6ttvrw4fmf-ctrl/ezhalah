-- A PLATFORM MAY NEVER BE SEARCHABLE WHILE OUTSIDE THE MONITORING SCOPE (owner rule, 2026-09-04).
--
-- WHY THIS EXISTS. Two independent failures on two consecutive days, same shape:
--   * 2026-09-03 — five platforms went live in search_listings_ar while ops_qa_scope still held the
--     2026-08-20 harvest, so ten tables read as "stored, indexed and invisible".
--   * 2026-09-04 — muktamel reached 523 searchable rows while sitting in
--     liveness_policies.NOT_PRODUCTION_SEARCHABLE, so it had NO liveness strategy: 0 rows ever
--     verified alive, 4 already accruing strikes with no grace contract, and CI green throughout.
-- In both cases the monitoring scope was a HAND-MAINTAINED LIST and production had moved past it.
-- Every offline barrier compares lists to other lists; none of them can see production.
--
-- THE RULE THIS ENFORCES. The authoritative platform set is whatever is contributing searchable
-- listings RIGHT NOW — derived here as `split_part(source_table,'_',1)` over search_listings_ar
-- where production_ready. There is no platform list in this function and no count to update: a
-- platform added tomorrow is covered the moment its first row becomes production_ready, and a
-- platform that stops being searchable drops out on its own. That is the whole point — the previous
-- barriers failed precisely because they enumerated instead of deriving.
--
-- It grades that set against ops_liveness_registry, which verify-liveness-registry-mirror.ts pins
-- byte-for-byte to sql/mirrors/liveness_registry.json and to the latest seed migration, which in turn
-- must match scrapers/common/liveness_policies.py. So "registered here" transitively means "the
-- crawler has a declared strategy", and an entry in NOT_PRODUCTION_SEARCHABLE can no longer be a
-- claim nobody checks: the moment it is false, production says so within half an hour.
--
-- Search-scope coverage is the sibling half and is already enforced by
-- mon_detect_search_scope_unreachable_inventory() against ops_qa_scope; this one owns the
-- liveness/data-integrity half. Together they are the "searchability/data-integrity monitoring scope".
create or replace function public.mon_detect_platform_monitoring_scope_gap()
returns int language plpgsql as $$
declare v_n int := 0; r record; v_raised text[] := '{}'; k text;
begin
  -- FAIL CLOSED. An empty registry must never read as "every platform is covered" — that is the
  -- dark-detector shape this repo has been burned by. Raise and stand nothing down.
  if (select count(*) from public.ops_liveness_registry) = 0 then
    return public.mon_raise('P1', 'platform_monitoring_scope_gap', null,
      'platform_monitoring_registry_empty',
      jsonb_build_object(
        'why', 'ops_liveness_registry is EMPTY, so no platform can be graded as covered. Monitoring scope is unjudgeable, not clean.',
        'fix', 'Re-seed it from sql/mirrors/liveness_registry.json — scripts/verify-liveness-registry-mirror.ts holds the three copies equal.'));
  end if;

  for r in
    select split_part(s.source_table, '_', 1) as platform,
           count(*) as searchable_rows,
           count(distinct s.source_table) as tables
      from public.search_listings_ar s
     where s.production_ready
       and not exists (select 1 from public.ops_liveness_registry g
                        where g.platform = split_part(s.source_table, '_', 1))
     group by 1
  loop
    v_raised := v_raised || ('platform_monitoring_scope_gap:' || r.platform);
    v_n := v_n + public.mon_raise('P1', 'platform_monitoring_scope_gap', r.platform,
      'platform_monitoring_scope_gap:' || r.platform,
      jsonb_build_object(
        'platform', r.platform,
        'searchable_rows', r.searchable_rows,
        'tables', r.tables,
        'why', format('%s is serving %s production_ready listings to users but has NO row in ops_liveness_registry, so it has no declared liveness strategy: policy_for() raises for it, nothing can prove its listings alive, and nothing guarantees a blocked or empty crawl will not inactivate them.', r.platform, r.searchable_rows),
        'fix', 'Register the platform in scrapers/common/liveness_policies.py, sql/mirrors/liveness_registry.json and a NEW seed migration (all three, one change — verify-liveness-registry-mirror.ts enforces it). If it genuinely should not be searchable, stop it being production_ready; do NOT silence this by adding it to NOT_PRODUCTION_SEARCHABLE, which is what caused the muktamel gap.'));
  end loop;

  -- Stand down only on POSITIVE evidence: the platform is registered now, or it no longer serves
  -- searchable rows. Never because the detector merely did not look this time.
  for k in
    select a.dedup_key from public.alert_event a
     where a.kind = 'platform_monitoring_scope_gap'
       and a.resolved_at is null
       and a.dedup_key like 'platform\_monitoring\_scope\_gap:%'
       and not (a.dedup_key = any(v_raised))
  loop
    perform public.mon_resolve_key('platform_monitoring_scope_gap', k);
  end loop;

  if v_n = 0 then
    perform public.mon_resolve_key('platform_monitoring_scope_gap', 'platform_monitoring_registry_empty');
  end if;
  return v_n;
end $$;

comment on function public.mon_detect_platform_monitoring_scope_gap() is
  'Owner rule 2026-09-04: a platform contributing searchable listings must be inside the monitoring scope. Derives the platform set from search_listings_ar (production truth) — never an enumerated list — and grades it against ops_liveness_registry. ~40ms measured 2026-09-04.';

-- Roster entry in the SAME migration (mon_detect_orphaned_detectors flags anything nothing reaches).
-- GUARDED needle-edit of the LIVE body — never a hand-pasted rebuild.
do $$
declare v_def text; v_before text;
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;
  if position('''mon_detect_platform_monitoring_scope_gap''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''mon_detect_platform_monitoring_scope_gap'',' || E'\n' || anchor);
  end if;
  if v_def = v_before then
    raise notice 'roster already carries the detector';
    return;
  end if;
  execute v_def;
end $$;

-- MUTATION PROOF, both directions, on the live inventory.
do $$
declare v_n int; v_open int; v_rostered text;
begin
  -- (A) it is reachable from the sweep.
  select pg_get_functiondef(p.oid) into v_rostered
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_platform_monitoring_scope_gap''' in v_rostered) = 0 then
    raise exception 'detector is not on the roster — it would never run';
  end if;

  -- (B) CLEAN today: every searchable platform is registered.
  v_n := public.mon_detect_platform_monitoring_scope_gap();
  if v_n <> 0 then raise exception 'expected 0 monitoring-scope gaps, got %', v_n; end if;

  -- (C) NOT VACUOUS: remove muktamel from the registry inside a savepoint and the detector must
  -- raise for it. This is the exact 2026-09-04 defect, replayed. Rolled back immediately.
  begin
    delete from public.ops_liveness_registry where platform = 'muktamel';
    v_n := public.mon_detect_platform_monitoring_scope_gap();
    if v_n < 1 then
      raise exception 'MUTATION SURVIVED: unregistering a searchable platform raised nothing';
    end if;
    select count(*) into v_open from public.alert_event
     where kind = 'platform_monitoring_scope_gap'
       and dedup_key = 'platform_monitoring_scope_gap:muktamel' and resolved_at is null;
    if v_open <> 1 then raise exception 'mutation did not raise the muktamel key'; end if;
    raise exception 'rollback_mutation_probe';
  exception when others then
    if sqlerrm <> 'rollback_mutation_probe' then raise; end if;
  end;

  -- (D) and the mutation's alert must STAND DOWN once the registry is whole again.
  v_n := public.mon_detect_platform_monitoring_scope_gap();
  if v_n <> 0 then raise exception 'still raising after rollback: %', v_n; end if;
  select count(*) into v_open from public.alert_event
   where kind = 'platform_monitoring_scope_gap' and resolved_at is null
     and dedup_key like 'platform\_monitoring\_scope\_gap:%';
  if v_open <> 0 then raise exception '% gap keys still open on a clean registry', v_open; end if;
end $$;
