-- 🆕 New Listings Engineer 2026-10-12, backlog #379 / #393. NOTHING TRAPPED (rule 10): a Gathern unit page lists
-- «مطبخ مجهز» (an equipped kitchen) inside its «مرافق المطبخ» section (re-read run 38216215705, unit 196227).
-- The section was stored verbatim in additional_info.extra_sections by the detail backfill, yet `kitchen` stayed
-- NULL on every Gathern unit, so an Advanced Filter kitchen search never found one. LISTED = YES only: an
-- appliance list without the item, an empty block or a missing section stays NULL (never «no»). The scraper
-- writes the same value from now on (scrapers/gathern/run.py _kitchen_from_sections).
with fixed as (
  update public.gathern_residential_listings g
     set kitchen = true
   where g.kitchen is null
     and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(g.additional_info->'extra_sections') = 'array'
                                                         then g.additional_info->'extra_sections' else '[]'::jsonb end) s
                  where btrim(s->>'header') = 'مرافق المطبخ' and s->>'content' like '%مطبخ مجهز%')
  returning g.id, g.active)
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by,
                                                  last_verified_at, last_verdict, last_detail)
select to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), 'gathern_kitchen_from_unit_page',
       'No active Gathern unit whose own page lists «مطبخ مجهز» under «مرافق المطبخ» (additional_info.extra_sections) '
       || 'serves kitchen = NULL. Listed = yes; absent stays NULL, never no.',
       'mon_detect_gathern_kitchen_trapped', 'new_listings_engineer', now(), 'holds',
       jsonb_build_object('rows_repaired', count(*), 'active_rows_repaired', count(*) filter (where active),
                          'undo', 'set kitchen = null for repaired_ids (every one was NULL before)',
                          'repaired_ids', coalesce(jsonb_agg(id order by id), '[]'::jsonb),
                          'cause_fix', 'scrapers/gathern/run.py _kitchen_from_sections', 'detector_on_roster', true)
  from fixed
on conflict do nothing;

create or replace function public.mon_detect_gathern_kitchen_trapped()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_seen bigint; v_n bigint; v_ex bigint; n int := 0;
begin
  select count(*) into v_seen
    from public.gathern_residential_listings g
   where g.active and jsonb_typeof(g.additional_info->'extra_sections') = 'array';
  if v_seen = 0 then
    n := public.mon_raise('P2', 'gathern_kitchen_trapped', 'gathern', 'gathern_kitchen_trapped:BLIND',
      jsonb_build_object('blind', true, 'why', 'No active Gathern unit carries its unit-page sections, so this detector proves nothing.'));
    perform public.mon_resolve_stale_keys('gathern_kitchen_trapped', array['gathern_kitchen_trapped:BLIND']);
    return n;
  end if;
  select count(*), min(g.id) into v_n, v_ex
    from public.gathern_residential_listings g
   where g.active and g.kitchen is null
     and jsonb_typeof(g.additional_info->'extra_sections') = 'array'
     and exists (select 1 from jsonb_array_elements(g.additional_info->'extra_sections') s
                  where btrim(s->>'header') = 'مرافق المطبخ' and s->>'content' like '%مطبخ مجهز%');
  if coalesce(v_n, 0) = 0 then
    perform public.mon_resolve_stale_keys('gathern_kitchen_trapped', array[]::text[]);
    return 0;
  end if;
  n := public.mon_raise('P2', 'gathern_kitchen_trapped', 'gathern', 'gathern_kitchen_trapped:trapped',
    jsonb_build_object('rows', v_n, 'example', 'gathern_residential_listings:' || v_ex,
      'why', 'The unit page lists «مطبخ مجهز» under «مرافق المطبخ» but kitchen is NULL: an Advanced Filter kitchen '
          || 'search cannot find the unit (rule 10, nothing trapped).',
      'action', 'Check scrapers/gathern/run.py _kitchen_from_sections still runs in backfill_details; repair as the '
          || 'gathern_kitchen_from_unit_page migration did (listed = yes only).'));
  perform public.mon_resolve_stale_keys('gathern_kitchen_trapped', array['gathern_kitchen_trapped:trapped']);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_gathern_kitchen_trapped' in src) > 0 then
    raise notice 'mon_detect_gathern_kitchen_trapped already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_district_plan_number_stranded'',',
    E'    ''mon_detect_district_plan_number_stranded'',\n    ''mon_detect_gathern_kitchen_trapped'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Check block: the detector EXECUTES clean on the repaired table, and the roster carries it.
do $$
declare r int;
begin
  r := public.mon_detect_gathern_kitchen_trapped();
  if r <> 0 then raise exception 'mon_detect_gathern_kitchen_trapped returned % right after the repair', r; end if;
  if position('mon_detect_gathern_kitchen_trapped' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'detector not on the roster';
  end if;
end $$;
