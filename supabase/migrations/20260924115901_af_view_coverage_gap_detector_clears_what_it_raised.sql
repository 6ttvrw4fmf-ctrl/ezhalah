-- mon_detect_af_view_coverage_gap() could raise a gap but never clear one (routine #5, 2026-09-24).
--
-- THE DEFECT. The detector's `else` branch — the one that runs when EVERY searchable platform has
-- AF attribute coverage — resolved only the `af_view_coverage_unanswerable` key. The GAP alert it
-- raises carries a dedup key that embeds the platform list
-- (`af_view_coverage_gap:<platforms>`), and nothing ever resolved it. So a gap that gets FIXED
-- leaves its P2 open forever.
--
-- MEASURED 2026-09-24: alert_event #3890, `af_view_coverage_gap:akariyoun`, open since 2026-09-18,
-- while `ops_af_attribute_coverage()` returns ZERO rows with a gap — the platform has been in both
-- attribute views for days. The alert has never been affirmed since it was raised.
--
-- WHY IT MATTERS TWICE. AGENTS.md's standing rule is to read `open_alerts`, not the sweep's return
-- count, because `mon_raise()` returns 0 on an already-open key. A detector that can raise but not
-- clear turns that rule against itself: the alert board carries a P2 describing a condition that is
-- no longer true, and — worse — if akariyoun regressed, the SAME key would dedup against the stale
-- row and the recurrence would raise nothing. A permanently-open alert is a permanently-deaf one.
--
-- THE FIX. On every clean sweep, resolve every open `af_view_coverage_gap` alert. On a sweep that
-- still finds gaps, resolve the ones whose key is not the CURRENT gap set, so a shrinking gap set
-- (three platforms fixed, one left) cannot leave two stale keys behind. The unanswerable path still
-- returns early and resolves nothing: UNKNOWN clears no alert.
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
  v_key text;
  r record;
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
    -- Unanswerable is a FINDING, never a pass — and it clears nothing.
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

  v_key := case when v_count > 0
    then 'af_view_coverage_gap:' || (select string_agg(g->>'platform', ',' order by g->>'platform')
                                     from jsonb_array_elements(v_gaps) g)
    else null end;

  if v_count > 0 then
    n := n + public.mon_raise('P2', 'af_view_coverage_gap', null, v_key,
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

  -- CLEAR WHAT IS NO LONGER TRUE. The gap key embeds the platform list, so every fixed gap left its
  -- own P2 open forever and deduped away its own recurrence.
  for r in
    select ae.dedup_key
      from public.alert_event ae
     where ae.kind = 'af_view_coverage_gap'
       and ae.resolved_at is null
       and ae.dedup_key <> 'af_view_coverage_unanswerable'
       and (v_key is null or ae.dedup_key <> v_key)
  loop
    perform public.mon_resolve_key('af_view_coverage_gap', r.dedup_key);
  end loop;

  return n;
end;
$function$;

-- SELFTEST — run the repaired detector and prove the stale row is gone. A detector whose clearing
-- path is never executed is the shape this migration exists to remove.
do $$
declare v_open int;
begin
  perform public.mon_detect_af_view_coverage_gap();
  select count(*) into v_open
    from public.alert_event
   where kind = 'af_view_coverage_gap' and resolved_at is null
     and dedup_key <> 'af_view_coverage_unanswerable';
  if v_open > 0 and exists (
        select 1 from public.ops_af_attribute_coverage() c
         where (not c.in_rich or not c.in_extra) and c.searchable_rows > 0) then
    raise notice 'af_view_coverage_gap: % open alert(s) and the gap is REAL — correct', v_open;
  elsif v_open > 0 then
    raise exception 'af_view_coverage_gap: % alert(s) still open with no gap in production', v_open;
  end if;
end $$;
