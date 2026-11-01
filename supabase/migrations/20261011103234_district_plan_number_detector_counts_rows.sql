-- 🔬 AF engineer 2026-10-11: mon_detect_district_plan_number_stranded reported rows = 1 while by_platform said
-- hajer 25 — it counted the per-platform groups, not the rows. Same body as 20261011093718 with sum(c).
create or replace function public.mon_detect_district_plan_number_stranded()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n bigint; v_by jsonb; v_seen bigint; n int := 0;
begin
  select count(*) into v_seen from public.search_listings_ar where production_ready and district_ar is not null;
  if v_seen = 0 then
    n := public.mon_raise('P2', 'district_plan_number_stranded', 'search_index', 'district_plan_number_stranded:BLIND',
      jsonb_build_object('blind', true, 'why', 'No served listing has a district, so this detector proves nothing.'));
    perform public.mon_resolve_stale_keys('district_plan_number_stranded', array['district_plan_number_stranded:BLIND']);
    return n;
  end if;
  select sum(c), jsonb_object_agg(platform, c) into v_n, v_by
    from (select platform, count(*) c from public.search_listings_ar
           where production_ready and district_ar ~ '[0-9٠-٩]+\s*/\s*[0-9٠-٩]+' group by 1) x;
  if coalesce(v_n, 0) = 0 then
    perform public.mon_resolve_stale_keys('district_plan_number_stranded', array[]::text[]);
    return 0;
  end if;
  n := public.mon_raise('P2', 'district_plan_number_stranded', 'search_index', 'district_plan_number_stranded:stranded',
    jsonb_build_object('rows', v_n, 'by_platform', v_by,
      'why', 'A served district carries a subdivision plan number such as (1100/4). norm_district_tok() keeps it, '
          || 'so no district option reaches these listings: a customer who picks the district never sees them.',
      'action', 'Drop only the plan number from district_ar in the platform''s parser and repair the rows as '
          || '20261011 hajer did; neighborhood keeps the verbatim string for the card (owner rule 2026-09-14).'));
  perform public.mon_resolve_stale_keys('district_plan_number_stranded', array['district_plan_number_stranded:stranded']);
  return n;
end
$function$;
