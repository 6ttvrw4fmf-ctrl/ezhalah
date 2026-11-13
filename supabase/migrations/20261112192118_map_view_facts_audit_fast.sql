-- The map pill checker took over 2 minutes on its first run (cancelled): its median recount asked the whole map view
-- once per ad («is there a copy on another site?»). It now reads the box once (a materialized set) and compares inside
-- it — measured 112 ms per view — and picks its 25 sample spots from last night's snapshot table instead of the view.
-- What it checks is unchanged.
create or replace function public.audit_map_view_facts()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare
  r record; c jsonb; w jsonb; m numeric; gn bigint; checked int := 0; failed int := 0; ex jsonb := '[]'::jsonb; why text[];
  v_ready boolean := public.map_view_facts_gone_ready();
begin
  for r in select s.latitude::float8 as lat, s.longitude::float8 as lng, s.type_ar
           from public.map_fact_points_snapshot s
           where s.deal = 'buy' and s.type_ar is not null and s.type_ar <> 'أرض خام'
           order by random() limit 25
  loop
    checked := checked + 1; why := '{}';
    c := public.map_view_facts_core(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null, array[r.type_ar]);
    w := public.map_posted_window_counts_ar(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null, array[r.type_ar]);
    if (c ->> 'any') is distinct from (w ->> 'any') then why := why || 'any'; end if;
    if (c ->> 'new30_raw') is distinct from (w ->> 'd30') then why := why || 'new30_raw'; end if;
    if (c ->> 'new30')::bigint > (c ->> 'new30_raw')::bigint or (c ->> 'new30')::bigint < 0 then why := why || 'new30_bounds'; end if;
    -- the median, written separately: sale ads of this type in the box, minus copies on another site
    with box as materialized (
      select p.price_total, p.platform, p.area_m2, p.city_ar, p.district_ar
      from public.map_listing_points_ar p
      where p.deal_ar = 'بيع' and p.type_ar = r.type_ar and p.price_total > 0
        and p.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
        and p.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric
        and not exists (select 1 from public.ops_default_pin_register d
                        where d.source_table = p.source_table and d.lat = round(p.latitude::numeric, 5) and d.lng = round(p.longitude::numeric, 5)))
    select percentile_cont(0.5) within group (order by a.price_total) into m
    from box a
    where a.area_m2 is null
       or not exists (select 1 from box q
                      where q.price_total = a.price_total and q.area_m2 = a.area_m2
                        and q.city_ar is not distinct from a.city_ar and q.district_ar is not distinct from a.district_ar
                        and q.platform < a.platform);
    if (c ->> 'median') is not null and abs((c ->> 'median')::numeric - round(m)) > 1 then why := why || 'median'; end if;
    if v_ready then
      select count(*) into gn from public.map_fact_removal x
      where x.deal = 'buy' and x.type_ar = r.type_ar and x.left_at >= now() - interval '30 days'
        and x.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
        and x.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric;
      if (c ->> 'gone30')::bigint > gn then why := why || 'gone30_bounds'; end if;
    elsif (c ->> 'gone30') is not null then
      why := why || 'gone30_shown_before_ready';
    end if;
    if cardinality(why) > 0 then
      failed := failed + 1;
      if jsonb_array_length(ex) < 5 then
        ex := ex || jsonb_build_object('lat', r.lat, 'lng', r.lng, 'type', r.type_ar, 'why', to_jsonb(why), 'facts', c, 'windows', w, 'median_recount', m);
      end if;
    end if;
  end loop;
  insert into public.map_view_facts_audit (checked, failed, examples) values (checked, failed, ex);
  if failed > 0 then
    update public.ops_feature_flags set enabled = false, changed_at = now(),
           reason = 'audit: the nightly checker could not reproduce ' || failed || ' of ' || checked || ' map views on ' || now()::date || ' — the second line is hidden until a clean night.'
     where name = 'map_view_facts' and enabled;
  else
    update public.ops_feature_flags set enabled = true, changed_at = now(),
           reason = 'owner 2026-11-12: the map pill''s second line. Turned back on by a clean nightly check on ' || now()::date || '.'
     where name = 'map_view_facts' and not enabled and reason like 'audit:%';
  end if;
  return jsonb_build_object('checked', checked, 'failed', failed, 'examples', ex);
end
$function$;
revoke all on function public.audit_map_view_facts() from public, anon, authenticated;
