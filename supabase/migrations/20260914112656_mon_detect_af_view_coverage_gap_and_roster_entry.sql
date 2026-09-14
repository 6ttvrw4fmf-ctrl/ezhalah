-- A DETECTOR FOR THE CLASS: a searchable platform with no AF attribute coverage, and an
-- ops_af_attribute_coverage() that cannot answer at all.
--
-- WHY THIS EXISTS. Both halves of this were live on production and neither reached anyone:
--   * FOUR platforms (amlakalahsa, suwar, rakez, aqaralsaudia — 4,145 searchable listings) had no
--     branch in listing_rich_attrs, so every attribute their scrapers captured was stranded behind
--     Advanced Filter. ops_incident #230 filed the first of them on 2026-09-13; three more arrived
--     while it sat unworked.
--   * The RPC that answers the question had regressed into an exponential dependency walk and could
--     not return inside 60s, so the only guard that asks it (a 6-hourly workflow) could not get an
--     answer either.
-- The existing guard is a GitHub workflow. A workflow failure is a red X in a tab; it does not enter
-- alert_event, so it does not reach the dashboard, the routing sweep, or the incident loop. Four
-- consecutive red runs proved that. This detector gives the finding a home where it is actually read.
--
-- IT EXECUTES, IT DOES NOT GREP. It calls the real RPC over the real definition. A source-text
-- tripwire would have passed throughout both defects — the repo's standing lesson (AGENTS.md:
-- "Barriers for this class must EXECUTE the function against an injected failure").
--
-- IT FAILS CLOSED. If the call errors or exceeds 20s, that raises its own alert rather than being
-- swallowed as "no gaps found": a failed fetch is not an empty answer. The 20s cap is ~20x the
-- measured 0.62-1.45s anon latency, so it fires on a genuine regression, not on load.
--
-- MUTATION PROOF (2026-09-14, run inside a transaction that was rolled back): the rakez arm was
-- surgically removed from listing_rich_attrs and the detector raised
-- P2 af_view_coverage_gap:rakez naming exactly that platform; after rollback it returned 0 with no
-- open alerts and all 3,769 rakez rows present.
create or replace function public.mon_detect_af_view_coverage_gap()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  v_gaps jsonb;
  v_count int;
begin
  begin
    set local statement_timeout = '20s';

    select coalesce(jsonb_agg(jsonb_build_object(
             'platform', c.platform, 'in_rich', c.in_rich,
             'in_extra', c.in_extra, 'searchable_rows', c.searchable_rows)
             order by c.searchable_rows desc), '[]'::jsonb),
           count(*)
      into v_gaps, v_count
    from public.ops_af_attribute_coverage() c
    where (not c.in_rich or not c.in_extra) and c.searchable_rows > 0;

  exception when others then
    -- Unanswerable is a FINDING, never a pass.
    n := n + public.mon_raise('P2', 'af_view_coverage_gap', null,
      'af_view_coverage_unanswerable',
      jsonb_build_object(
        'what', 'ops_af_attribute_coverage() did not return within 20s',
        'sqlstate', SQLSTATE, 'message', SQLERRM,
        'why_it_matters',
          'This RPC is the only answer to "does every searchable platform have AF attribute '
          'coverage". Unanswerable reads as an outage to the live barriers that call it over the '
          'anon path, and fails unrelated work. Regressed exactly this way before 2026-09-14: an '
          'exponential recursive dependency walk (849,118 rows by depth 4 over 105 distinct '
          'relations).',
        'fix_shape',
          'Check the deps CTE in ops_af_attribute_coverage still uses UNION with no depth column - '
          'dedup is what bounds the walk.'));
    return n;
  end;

  if v_count > 0 then
    n := n + public.mon_raise('P2', 'af_view_coverage_gap', null,
      'af_view_coverage_gap:' || (select string_agg(g->>'platform', ',' order by g->>'platform')
                                  from jsonb_array_elements(v_gaps) g),
      jsonb_build_object(
        'what', v_count || ' searchable platform(s) missing from listing_rich_attrs and/or '
                        || 'listing_extra_attrs',
        'gaps', v_gaps,
        'user_impact',
          'Every AF attribute the platform''s scraper captured is stranded: Advanced Filter cannot '
          'see it, so an amenity answer silently under-counts and the eligible set excludes rows '
          'that genuinely match.',
        'fix_shape',
          'Re-run the self-healing splice (migration 20260914111548) - it clones the october arm for '
          'any searchable standard-template table with no branch. UNKNOWN stays NULL; nothing is '
          'invented.'));
  else
    perform public.mon_resolve_key('af_view_coverage_gap', 'af_view_coverage_unanswerable');
  end if;

  return n;
end;
$function$;

-- ROSTER ENTRY, SAME MIGRATION (AGENTS.md: a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors() fires on any detector the roster does not reach).
do $$
declare def text; anchor constant text := '''mon_detect_af_coverage_cliff''';
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if def is null then
    raise exception 'mon_run_all_detectors not found - refusing to guess';
  end if;

  if position('mon_detect_af_view_coverage_gap' in def) > 0 then
    raise notice 'roster already reaches mon_detect_af_view_coverage_gap';
    return;
  end if;

  if position(anchor in def) = 0 then
    raise exception 'roster anchor % not found - shape changed, refusing to splice', anchor;
  end if;

  def := replace(def, anchor, anchor || ',' || E'\n    ' || '''mon_detect_af_view_coverage_gap''');
  execute def;

  -- prove the roster really reaches it now
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_af_view_coverage_gap' in def) = 0 then
    raise exception 'roster splice did not take';
  end if;
end $$;
