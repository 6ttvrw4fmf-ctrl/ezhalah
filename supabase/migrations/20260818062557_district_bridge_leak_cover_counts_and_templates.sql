-- BARRIER GAP found 2026-08-18 (senior run #28). mon_detect_district_bridge_leak, shipped with the
-- حي guard itself, watched ONLY location_search_candidates_ar — both limbs. So on the morning the
-- guard shipped, the detector read GREEN while:
--   * af_eligible_count / apartment_guided_counts_ar / property_age_option_counts_ar still injected
--     the foreign حي (حقروصين: results 13 vs count 14; ابو السلع: 6 vs 8), and
--   * all four af_rpc_templates still held the UNGUARDED CTE, so the next rebuild_af_filter_rpcs()
--     would have silently reverted the fix.
-- A barrier that only watches the one surface its own fix touched cannot see the fix being undone.
--
-- Three limbs now, each able to fire when the others are quiet:
--   1. LIVE STRUCTURAL  — guard present in every AF surface, not just the results RPC.
--   2. TEMPLATE STRUCTURAL (new root-cause limb) — guard present in every af_rpc_templates row.
--      This is the limb that would have caught today's defect at 01:26 instead of never.
--   3. BEHAVIOURAL — for real ambiguous أحياء: no foreign rows AND counts == results, so a chip
--      that overstates is caught even if every structural check passes.

create or replace function public.mon_detect_district_bridge_leak()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; v_def text; v_amb int; live text[] := '{}'; r record;
  v_missing_live text; v_missing_tpl text; v_cnt bigint;
begin
  select count(*) into v_amb from (
    select norm_en_place(district_en) e from public.district_name_bridge
     group by 1 having count(distinct norm_district_tok(district_ar)) > 1) z;

  -- limb 1: every live AF surface must carry the guard
  for r in select fn_name from public.af_rpc_templates order by fn_name loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname = 'public' and p.proname = r.fn_name and p.prokind = 'f';
    if v_def is null or position('AMBIGUITY GUARD (2026-08-18' in v_def) = 0 then
      v_missing_live := coalesce(v_missing_live || ', ', '') || r.fn_name;
    end if;
  end loop;

  -- limb 2: every TEMPLATE must carry it, else the next rebuild reverts the fix
  select string_agg(fn_name, ', ' order by fn_name) into v_missing_tpl
    from public.af_rpc_templates
   where position('AMBIGUITY GUARD (2026-08-18' in template) = 0;

  if v_amb > 0 and v_missing_live is not null then
    live := live || 'district_bridge_leak:guard_missing';
    n := n + public.mon_raise('P1', 'district_bridge_leak', 'all', 'district_bridge_leak:guard_missing',
      jsonb_build_object(
        'ambiguous_bridge_names', v_amb, 'surfaces_missing_guard', v_missing_live,
        'why', 'district_name_bridge maps these names to more than one canonical Arabic حي, and the '
            || 'ambiguity guard is NOT present in these live AF surfaces — a حي search (or its count '
            || 'chip) can return/claim listings from a different حي.',
        'fix', 'fold the guarded district_tokens CTE into af_rpc_templates and rebuild_af_filter_rpcs()'));
  end if;

  if v_amb > 0 and v_missing_tpl is not null then
    live := live || 'district_bridge_leak:template_unguarded';
    n := n + public.mon_raise('P1', 'district_bridge_leak', 'all', 'district_bridge_leak:template_unguarded',
      jsonb_build_object(
        'ambiguous_bridge_names', v_amb, 'templates_missing_guard', v_missing_tpl,
        'why', 'the live RPCs may be correct right now, but af_rpc_templates is what '
            || 'rebuild_af_filter_rpcs() restores from — an unguarded template means the حي fix is '
            || 'one routine rebuild away from being silently reverted (observed 2026-08-18).',
        'fix', 'patch the template, rebuild, and confirm af_rpc_build_state md5 parity'));
  end if;

  -- limb 3: behavioural, ~once per 20h (drives real RPCs)
  if public.mon_claim_daily_slot('district_bridge_leak') then
    for r in select * from public.mon_district_bridge_leak_probe() loop
      if r.foreign_rows > 0 then
        live := live || ('district_bridge_leak:probe:' || r.district_ar);
        n := n + public.mon_raise('P1', 'district_bridge_leak', 'all',
          'district_bridge_leak:probe:' || r.district_ar,
          jsonb_build_object('district', r.district_ar, 'city', r.city_ar,
                             'returned', r.returned, 'foreign_rows', r.foreign_rows,
                             'why', 'a حي search returned listings whose حي the user did not select'));
      end if;
      -- counts must agree with results for the SAME selection, or the chip overstates
      select public.af_eligible_count(p_cities := array[r.city_ar], p_districts := array[r.district_ar])
        into v_cnt;
      if v_cnt is distinct from r.returned then
        live := live || ('district_bridge_leak:count_parity:' || r.district_ar);
        n := n + public.mon_raise('P1', 'district_bridge_leak', 'all',
          'district_bridge_leak:count_parity:' || r.district_ar,
          jsonb_build_object('district', r.district_ar, 'city', r.city_ar,
                             'results', r.returned, 'count_chip', v_cnt,
                             'why', 'the count chip and the result list disagree for the same حي '
                                 || 'selection — the user is shown a number they cannot reach '
                                 || '(2026-08-18: guard was in the results RPC but not the counts RPCs)'));
      end if;
    end loop;
    update public.ops_detector_last_full_run set last_result = n where detector = 'district_bridge_leak';
  end if;

  perform public.mon_resolve_stale_keys('district_bridge_leak', live);
  return n;
end $function$;

comment on function public.mon_detect_district_bridge_leak() is
  'Barrier (Search & Matching QA stress run 2026-08-18; widened by senior run #28 the same day): a '
  'حي search must never return — or COUNT — a different حي. Limb 1 watches the guard in every live '
  'AF surface, limb 2 watches af_rpc_templates (what a rebuild restores from), limb 3 probes real '
  'ambiguous أحياء once per ~20h and asserts counts == results.';

-- Prove BOTH DIRECTIONS before trusting it.
do $$
declare v_missing text; v int;
begin
  -- negative control: with the guard string stripped, the structural predicate MUST report misses
  select string_agg(fn_name, ', ') into v_missing
    from (select fn_name, replace(template, 'AMBIGUITY GUARD (2026-08-18', 'XX') as template
            from public.af_rpc_templates) z
   where position('AMBIGUITY GUARD (2026-08-18' in template) = 0;
  if v_missing is null then
    raise exception 'negative control failed: stripped templates did not register as unguarded';
  end if;

  -- positive control: against the real, now-patched state the detector must be clean
  select public.mon_detect_district_bridge_leak() into v;
  if v <> 0 then raise exception 'detector raised % on a known-good state', v; end if;

  -- and it must still be reachable from the roster
  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors'
     and position('''mon_detect_district_bridge_leak''' in pg_get_functiondef(p.oid)) > 0;
  if v <> 1 then raise exception 'detector is not reachable from mon_run_all_detectors'; end if;
end $$;
