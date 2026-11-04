-- 🆕 2026-11-04 guard for migration gathern_pool_from_own_amenity_list: gathern's own amenity list names a pool, the served index row says nothing.
-- Before that migration 0 of gathern's pool answers came from its structured list (only the seller's prose «بمسبح»
-- reached the index), so an Advanced Filter «مسبح» search missed every chalet whose seller did not also write it.
-- Rows indexed in the last 2 hours are skipped: the hourly :22 sync carries listing_rich_attrs into the index.
create or replace function public.mon_detect_gathern_pool_trapped()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_seen bigint; v_n bigint; v_ex bigint; n int := 0;
begin
  select count(*) into v_seen
    from public.gathern_residential_listings g
   where g.active and jsonb_typeof(g.additional_info->'amenities') = 'array';
  if v_seen = 0 then
    n := public.mon_raise('P2', 'gathern_pool_trapped', 'gathern', 'gathern_pool_trapped:BLIND',
      jsonb_build_object('blind', true, 'why', 'No active Gathern unit carries its amenity list, so this detector proves nothing.'));
    perform public.mon_resolve_stale_keys('gathern_pool_trapped', array['gathern_pool_trapped:BLIND']);
    return n;
  end if;
  select count(*), min(g.id) into v_n, v_ex
    from public.search_listings_ar s
    join public.gathern_residential_listings g
      on s.source_table = 'gathern_residential_listings' and s.listing_id = g.id
   where g.active and s.pool is null
     and s.first_seen_at < now() - interval '2 hours'
     and jsonb_typeof(g.additional_info->'amenities') = 'array'
     and exists (select 1 from jsonb_array_elements_text(g.additional_info->'amenities') a(l)
                  where a.l like 'مسبح%' and a.l not like '%مفرغ%');
  if coalesce(v_n, 0) = 0 then
    perform public.mon_resolve_stale_keys('gathern_pool_trapped', array[]::text[]);
    return 0;
  end if;
  n := public.mon_raise('P2', 'gathern_pool_trapped', 'gathern', 'gathern_pool_trapped:trapped',
    jsonb_build_object('rows', v_n, 'example', 'gathern_residential_listings:' || v_ex,
      'why', 'Gathern''s own amenity list names a pool («مسبح …») but the served pool is NULL: an Advanced Filter '
          || '«مسبح» search cannot find the unit (rule 10, nothing trapped).',
      'action', 'Check listing_rich_attrs'' gathern branch still maps amenities «مسبح%» to pool (migration '
          || 'gathern_pool_from_own_amenity_list) and that the :22 sync ran.'));
  perform public.mon_resolve_stale_keys('gathern_pool_trapped', array['gathern_pool_trapped:trapped']);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_gathern_pool_trapped' in src) > 0 then
    raise notice 'mon_detect_gathern_pool_trapped already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'''mon_detect_gathern_kitchen_trapped'',',
    E'''mon_detect_gathern_kitchen_trapped'',\n    ''mon_detect_gathern_pool_trapped'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end
$$;
