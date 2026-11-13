-- THE MAP CARD'S NIGHTLY CHECK (owner 2026-11-13: «we can't have mistakes … strong barrier»). Every night, right after the
-- box's own check, 15 random map views are recounted ANOTHER way and the card must agree: its ads and its month of new
-- ads equal the box's (same filter), the windows only grow (أمس ≤ أسبوع ≤ شهر ≤ 3 أشهر), its price per metre for the month
-- and its median price equal a separate recount of the same type, nothing is shown before its log covers it, and every
-- price is in sane bounds. One mismatch switches the facts off (ops_feature_flags.map_view_facts — the box AND the card)
-- until a clean night, and mon_detect_map_view_facts pages on the audit row.
create or replace function public.audit_map_view_card()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare
  r record; c jsonb; fc jsonb; why text[]; checked int := 0; failed int := 0; ex jsonb := '[]'::jsonb;
  mp numeric; md numeric; v_log_start timestamptz; v_day0 timestamptz; t text;
begin
  select min(cr.run_at) into v_log_start from public.map_fact_capture_run cr where cr.ok;
  v_day0 := ((date_trunc('day', now() at time zone 'Asia/Riyadh')) at time zone 'Asia/Riyadh') - interval '1 day';
  for r in (select s.latitude::float8 as lat, s.longitude::float8 as lng, s.type_ar
            from public.map_fact_points_snapshot s where s.deal = 'buy' and s.type_ar is not null and s.type_ar <> 'أرض خام'
            order by random() limit 10)
           union all
           (select s.latitude::float8, s.longitude::float8, null::text
            from public.map_fact_points_snapshot s where s.deal = 'buy' order by random() limit 5)
  loop
    checked := checked + 1; why := '{}'; mp := null; md := null;
    c := public.map_view_card_core(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null,
                                   case when r.type_ar is null then null else array[r.type_ar] end);
    fc := public.map_view_facts_core(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null,
                                     case when r.type_ar is null then null else array[r.type_ar] end);
    if (c ->> 'any') is distinct from (fc ->> 'any') then why := why || 'any'; end if;
    if (c -> 'table' -> 'm' ->> 'new') is distinct from (fc ->> 'new30') then why := why || 'new_month'; end if;
    if not ((c -> 'table' -> 'y' ->> 'new')::bigint <= (c -> 'table' -> 'w' ->> 'new')::bigint
            and (c -> 'table' -> 'w' ->> 'new')::bigint <= (c -> 'table' -> 'm' ->> 'new')::bigint
            and (c -> 'table' -> 'm' ->> 'new')::bigint <= (c -> 'table' -> 'q' ->> 'new')::bigint
            and (c -> 'table' -> 'q' ->> 'new')::bigint <= (c ->> 'any')::bigint) then why := why || 'new_windows'; end if;
    -- nothing shown before its log covers the window
    if v_log_start > now() - interval '7 days' and (c -> 'table' -> 'w' ->> 'gone') is not null then why := why || 'gone_week_early'; end if;
    if v_log_start > now() - interval '30 days' and ((c -> 'table' -> 'm' ->> 'gone') is not null or (c ->> 'stay_days') is not null) then why := why || 'gone_month_early'; end if;
    if v_log_start > now() - interval '90 days' and (c -> 'table' -> 'q' ->> 'gone') is not null then why := why || 'gone_quarter_early'; end if;
    if v_log_start > v_day0 and (c -> 'table' -> 'y' ->> 'gone') is not null then why := why || 'gone_yesterday_early'; end if;
    -- the price type: the picked one when the view holds only it
    t := c ->> 'price_type';
    if r.type_ar is not null and t is not null and t <> r.type_ar and (fc ->> 'one_type')::boolean then why := why || 'price_type'; end if;
    -- the month's price per metre and the median price, recounted separately (same type, copies once, default pins out)
    if t is not null then
      with box as materialized (
        select coalesce(p.price_total_effective, p.price_total) as price, p.platform, p.area_m2, p.posted_at,
               coalesce(p.city_ar, '') as city, coalesce(p.district_ar, '') as district
        from public.map_listing_points_ar p
        where p.deal_ar = 'بيع' and p.type_ar = t and coalesce(p.price_total_effective, p.price_total) > 0
          and p.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
          and p.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric
          and not exists (select 1 from public.ops_default_pin_register d
                          where d.source_table = p.source_table and d.lat = round(p.latitude::numeric, 5) and d.lng = round(p.longitude::numeric, 5))),
      mine as (
        select y.* from (select a.*, min(a.platform) over (partition by a.price, a.area_m2, a.city, a.district) as first_site from box a) y
        where y.area_m2 is null or y.platform = y.first_site)
      select percentile_cont(0.5) within group (order by mine.price / mine.area_m2)
               filter (where mine.area_m2 > 0 and mine.posted_at >= now() - interval '30 days' and mine.posted_at < now() + interval '1 day'),
             percentile_cont(0.5) within group (order by mine.price)
        into mp, md from mine;
      if (c -> 'table' -> 'm' ->> 'ppm') is not null and abs((c -> 'table' -> 'm' ->> 'ppm')::numeric - round(mp)) > 1 then why := why || 'ppm_month'; end if;
      if (c ->> 'median_price') is not null and abs((c ->> 'median_price')::numeric - round(md)) > 1 then why := why || 'median_price'; end if;
    end if;
    -- sanity: nothing impossible is ever served
    if exists (select 1 from jsonb_each(c -> 'table') w where (w.value ->> 'ppm') is not null and (w.value ->> 'ppm')::numeric not between 10 and 200000) then why := why || 'ppm_bounds'; end if;
    if (c -> 'nb' -> 'month' ->> 'ppm') is not null and (c -> 'nb' -> 'month' ->> 'ppm')::numeric not between 10 and 200000 then why := why || 'nb_ppm_bounds'; end if;
    if exists (select 1 from jsonb_array_elements(coalesce(c -> 'nb' -> 'by_district', '[]'::jsonb)) d where (d ->> 'ppm') is not null and (d ->> 'ppm')::numeric not between 10 and 200000) then why := why || 'nb_district_bounds'; end if;
    if (c -> 'top_type' ->> 'pct')::numeric > 100 or (c -> 'top_rooms' ->> 'pct')::numeric > 100 then why := why || 'pct_over_100'; end if;
    if (c ->> 'price_low')::numeric > (c ->> 'price_high')::numeric then why := why || 'range_upside_down'; end if;
    if cardinality(why) > 0 then
      failed := failed + 1;
      if jsonb_array_length(ex) < 5 then
        ex := ex || jsonb_build_object('card', true, 'lat', r.lat, 'lng', r.lng, 'type', r.type_ar, 'why', to_jsonb(why),
                                       'ppm_month_recount', mp, 'median_recount', md, 'card_any', c -> 'any', 'facts_any', fc -> 'any');
      end if;
    end if;
  end loop;
  insert into public.map_view_facts_audit (checked, failed, examples) values (checked, failed, ex);
  if failed > 0 then
    update public.ops_feature_flags set enabled = false, changed_at = now(),
           reason = 'audit: the nightly card checker could not reproduce ' || failed || ' of ' || checked || ' map cards on ' || now()::date || ' — the map box facts and card are hidden until a clean night.'
     where name = 'map_view_facts' and enabled;
  end if;
  return jsonb_build_object('checked', checked, 'failed', failed, 'examples', ex);
end
$function$;
revoke all on function public.audit_map_view_card() from public, anon, authenticated;

-- nightly, right after the box's own check (same job, same slot — the command gains one step)
select cron.schedule('map-view-facts', '11 22 * * *', $cmd$set statement_timeout to '900s'; select public.map_fact_capture_removals(); select public.audit_map_view_facts(); select public.audit_map_view_card();$cmd$);
