-- The independent checker, v2 — for the final purchase-first lines (owner 2026-10-22: «create someone that checks»).
-- It recounts EVERY fact from the listings by town ID with its own code, its own copy of the duplicate rule and the
-- settled-site rule, on the same snapshot the builder read; any fact it cannot reproduce exactly is removed before a
-- user sees it, and mon_detect_welcome_insights_audit raises the disagreement.
set local statement_timeout = '5min';

create or replace function public.audit_welcome_insights()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  d date := (select max(day) from public.welcome_insight);
  t0 timestamptz; wk timestamptz; y0 timestamptz; y1 timestamptz; gate boolean;
  r record; x numeric; y numeric; tc numeric; why text; grp text; pred_ok boolean;
  checked int := 0; failed int := 0; reasons jsonb := '{}'; ex jsonb := '[]';
begin
  t0 := (select built_at from public.welcome_insight_build where day = d);
  if d is null or t0 is null then return jsonb_build_object('day', d, 'error', 'no build stamp for the latest day'); end if;
  wk := t0 - interval '7 days';
  y0 := (date_trunc('day', t0 at time zone 'Asia/Riyadh') - interval '1 day') at time zone 'Asia/Riyadh';
  y1 := date_trunc('day', t0 at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
  gate := (select count(*) from public.welcome_insight_audit c where c.day >= d - 3 and c.day < d and c.failed = 0) < 3;

  drop table if exists a_b, a_shared, a_steady;
  create temp table a_b on commit drop as
    select s.listing_id::text listing_id, s.platform, s.region_ar, s.city_ar, s.city_id,
           nullif(nullif(trim(s.district_ar), ''), 'غير معروف') dist, s.deal_ar, s.type_ar,
           s.price_annual, s.price_total, s.price_per_meter, s.area_m2, s.property_age,
           s.latitude::float8 lat, s.longitude::float8 lng,
           coalesce(s.first_seen_at >= f.first_ever + interval '7 days' and s.first_seen_at >= wk, false) is_new,
           coalesce(s.first_seen_at >= f.first_ever + interval '7 days' and s.first_seen_at >= wk - interval '7 days' and s.first_seen_at < wk, false) is_lw,
           coalesce(s.first_seen_at >= f.first_ever + interval '7 days' and s.first_seen_at >= y0 and s.first_seen_at < y1, false) is_yday,
           coalesce(s.first_seen_at >= f.first_ever + interval '7 days' and s.first_seen_at >= t0 - interval '30 days', false) is_m1,
           coalesce(s.first_seen_at >= f.first_ever + interval '7 days' and s.first_seen_at >= t0 - interval '60 days' and s.first_seen_at < t0 - interval '30 days', false) is_m0,
           f.first_ever + interval '7 days' <= wk - interval '7 days' long_read
      from public.search_listings_ar s
      join (select platform, min(first_seen_at) first_ever from public.search_listings_ar group by 1) f on f.platform = s.platform
     where s.production_ready and s.city_ar is not null and s.city_ar <> 'غير معروف' and s.region_ar is not null;
  -- the owner's duplicate rule, written again: an exact copy on another site (pins close when both have one) goes
  delete from a_b x where exists (
    select 1 from a_b y
     where y.city_id = x.city_id and y.dist = x.dist and y.deal_ar = x.deal_ar and y.type_ar = x.type_ar
       and coalesce(y.price_total, y.price_annual) = coalesce(x.price_total, x.price_annual) and y.area_m2 = x.area_m2
       and y.platform <> x.platform and (y.platform, y.listing_id) < (x.platform, x.listing_id)
       and (x.lat is null or y.lat is null
            or power((x.lat - y.lat) * 111000, 2) + power((x.lng - y.lng) * 111000 * cos(radians(x.lat)), 2) < 40000));
  create index on a_b (city_id, dist);
  analyze a_b;
  create temp table a_shared on commit drop as
    select c.city_ar from public.loc_catalog_city c group by c.city_ar having count(distinct c.city_id) > 1
    union select s.city_ar from public.search_listings_ar s where s.production_ready group by s.city_ar having count(distinct s.city_id) > 1;
  -- sites whose crawl was steady both weeks (new ads within a factor of 1.5)
  create temp table a_steady on commit drop as
    select platform from a_b where long_read group by platform
    having count(*) filter (where is_new) >= 20 and count(*) filter (where is_lw) >= 20
       and count(*) filter (where is_new) * 3 >= count(*) filter (where is_lw) * 2
       and count(*) filter (where is_new) * 2 <= count(*) filter (where is_lw) * 3;

  for r in select * from public.welcome_insight where day = d loop
    checked := checked + 1; why := null; x := null; y := null;
    if r.city_ar is not null and exists (select 1 from a_shared z where z.city_ar = r.city_ar) then why := 'town_name_shared';
    elsif public.welcome_name_is_messy(r.district_ar) or public.welcome_name_is_messy(r.district2_ar) then why := 'messy_district_name';
    elsif not exists (select 1 from public.welcome_template t where t.kind = r.kind and t.active) then why := 'no_active_line';
    elsif r.city_id is not null and exists (select 1 from a_b b where b.city_id = r.city_id and b.region_ar <> r.region_ar) then why := 'town_in_two_regions';
    elsif r.district_ar is not null and not exists (select 1 from a_b b where b.city_id = r.city_id and b.dist = r.district_ar) then why := 'district_not_in_town';
    elsif gate and r.city_id is not null and (select count(*) from a_b b where b.city_id = r.city_id) < 300 then why := 'small_town_not_yet';
    end if;

    if why is null then
      case
      when r.kind in ('city_land', 'city_sale', 'city_bld_sale', 'week_land', 'week_apt_sale', 'week_bld_sale') then
        with c as (
          select b.dist, count(*) n from a_b b
           where b.city_id = r.city_id and case r.kind
             when 'city_land' then b.type_ar like 'أرض%'
             when 'city_sale' then b.deal_ar = 'بيع'
             when 'city_bld_sale' then b.deal_ar = 'بيع' and b.type_ar = 'عمارة'
             when 'week_land' then b.is_new and b.deal_ar = 'بيع' and b.type_ar like 'أرض%'
             when 'week_apt_sale' then b.is_new and b.deal_ar = 'بيع' and b.type_ar = 'شقة'
             else b.is_new and b.deal_ar = 'بيع' and b.type_ar = 'عمارة' end
           group by b.dist)
        select (select sum(n) from c), (select n from c where dist = r.district_ar),
               (select max(n) from c where dist is not null and dist is distinct from r.district_ar) into x, y, tc;
        if coalesce(y, 0) < 3 or coalesce(y, 0) <= coalesce(tc, 0) then why := 'not_the_top_district'; end if;
        y := null;
      when r.kind ~ '^wow_(land|apt_sale|bld)_(up|down)$' then
        grp := regexp_replace(r.kind, '^wow_(.*)_(up|down)$', '\1');
        select count(*) filter (where b.is_new), count(*) filter (where b.is_lw) into tc, y
          from a_b b where b.city_id = r.city_id and b.platform in (select platform from a_steady) and b.deal_ar = 'بيع'
           and case grp when 'land' then b.type_ar like 'أرض%' when 'apt_sale' then b.type_ar = 'شقة' else b.type_ar = 'عمارة' end;
        if tc < 30 or y < 30 then why := 'below_threshold';
        else
          x := abs(round(100.0 * (tc - y) / y));
          if x < 10 then why := 'below_threshold';
          elsif (tc > y) <> (r.kind like '%_up') then why := 'direction_differs'; end if;
          y := tc;
        end if;
      when r.kind in ('apt_sale_ppm', 'villa_price', 'bld_price', 'month_apt_ppm') then
        select percentile_cont(0.5) within group (order by case when r.kind in ('apt_sale_ppm', 'month_apt_ppm') then b.price_total / b.area_m2 else b.price_total end)
                 filter (where r.kind <> 'month_apt_ppm' or b.is_m1),
               percentile_cont(0.5) within group (order by b.price_total / b.area_m2) filter (where r.kind = 'month_apt_ppm' and b.is_m0),
               count(*) filter (where r.kind <> 'month_apt_ppm' or b.is_m1), count(*) filter (where b.is_m0)
          into x, y, tc, grp
          from a_b b where b.city_id = r.city_id and b.dist = r.district_ar and b.deal_ar = 'بيع'
           and case when r.kind in ('apt_sale_ppm', 'month_apt_ppm') then b.type_ar = 'شقة' and b.price_total between 100000 and 20000000 and b.area_m2 between 30 and 1000
                    when r.kind = 'villa_price' then b.type_ar = 'فيلا' and b.price_total between 200000 and 50000000
                    else b.type_ar = 'عمارة' and b.price_total between 300000 and 200000000 end;
        if r.kind = 'month_apt_ppm' then
          if tc < 20 or grp::int < 20 or abs(x - y) * 100 < y * 3 then why := 'below_threshold'; end if;
        elsif tc < (case r.kind when 'bld_price' then 15 else 20 end) then why := 'below_threshold';
        end if;
      when r.kind in ('month_land_ppm', 'month_bld_ppm') then
        select percentile_cont(0.5) within group (order by case when r.kind = 'month_land_ppm' then b.price_per_meter else b.price_total / b.area_m2 end) filter (where b.is_m1),
               percentile_cont(0.5) within group (order by case when r.kind = 'month_land_ppm' then b.price_per_meter else b.price_total / b.area_m2 end) filter (where b.is_m0),
               count(*) filter (where b.is_m1), count(*) filter (where b.is_m0)
          into x, y, tc, grp
          from a_b b where b.city_id = r.city_id and b.deal_ar = 'بيع'
           and case when r.kind = 'month_land_ppm' then b.type_ar like 'أرض%' and b.price_per_meter between 10 and 50000
                    else b.type_ar = 'عمارة' and b.price_total between 300000 and 200000000 and b.area_m2 between 100 and 20000 end;
        if tc < 20 or grp::int < 20 or abs(x - y) * 100 < y * 3 then why := 'below_threshold'; end if;
      when r.kind = 'city_new_districts' then
        select count(distinct b.dist) into x from a_b b where b.city_id = r.city_id and b.is_new and b.dist is not null;
      when r.kind = 'land_ppm_city' then
        select percentile_cont(0.5) within group (order by b.price_per_meter) into x from a_b b
         where b.city_id = r.city_id and b.deal_ar = 'بيع' and b.type_ar like 'أرض%' and b.price_per_meter between 10 and 50000;
      when r.kind = 'land_share' then
        select round(100.0 * count(*) filter (where b.type_ar like 'أرض%') / nullif(count(*), 0)) into x from a_b b where b.city_id = r.city_id;
      when r.kind = 'land_gap' then
        select percentile_cont(0.5) within group (order by b.price_per_meter) filter (where b.dist = r.district_ar),
               percentile_cont(0.5) within group (order by b.price_per_meter) filter (where b.dist = r.district2_ar) into x, y
          from a_b b where b.city_id = r.city_id and b.deal_ar = 'بيع' and b.type_ar like 'أرض%' and b.price_per_meter between 10 and 50000;
      when r.kind in ('rent_apt', 'rent_gap') then
        select percentile_cont(0.5) within group (order by b.price_annual) filter (where b.dist = r.district_ar),
               percentile_cont(0.5) within group (order by b.price_annual) filter (where b.dist = r.district2_ar) into x, y
          from a_b b where b.city_id = r.city_id and b.deal_ar = 'إيجار' and b.type_ar = 'شقة'
           and b.price_annual between 6000 and 500000 and b.platform not in ('gathern', 'aqarmonthly');
        if r.kind = 'rent_apt' then y := null; end if;
      when r.kind = 'villa_area' then
        select percentile_cont(0.5) within group (order by b.area_m2) into x from a_b b
         where b.city_id = r.city_id and b.dist = r.district_ar and b.type_ar = 'فيلا' and b.area_m2 between 100 and 5000;
      when r.kind = 'new_build' then
        select round(100.0 * count(*) filter (where b.property_age = 0) / nullif(count(*), 0)) into x from a_b b
         where b.city_id = r.city_id and b.dist = r.district_ar and b.property_age is not null;
      when r.kind = 'shop_rent' then
        select percentile_cont(0.5) within group (order by b.price_annual) into x from a_b b
         where b.city_id = r.city_id and b.dist = r.district_ar and b.deal_ar = 'إيجار' and b.type_ar = 'محل' and b.price_annual between 3000 and 2000000;
      when r.kind = 'hot_district' then
        select count(*) filter (where b.is_new), round(100.0 * count(*) filter (where b.is_new) / nullif(count(*), 0)) into x, y
          from a_b b where b.city_id = r.city_id and b.dist = r.district_ar;
      when r.kind = 'yesterday' then
        select count(*), count(*) filter (where b.city_id = r.city_id) into x, y from a_b b where b.is_yday;
      else
        why := 'unknown_kind';
      end case;
    end if;

    if why is null and (x is null or round(x) <> r.a or (r.b is not null and (y is null or round(y) <> r.b))) then
      why := 'number_differs';
    end if;
    if why is not null then
      failed := failed + 1;
      reasons := jsonb_set(reasons, array[why], to_jsonb(coalesce((reasons ->> why)::int, 0) + 1));
      if jsonb_array_length(ex) < 25 then
        ex := ex || jsonb_build_object('why', why, 'kind', r.kind, 'city', r.city_ar, 'district', r.district_ar,
                                       'district2', r.district2_ar, 'fact_a', r.a, 'fact_b', r.b, 'checker_a', round(x), 'checker_b', round(y));
      end if;
      delete from public.welcome_insight where id = r.id;
    end if;
  end loop;

  insert into public.welcome_insight_audit(day, checked, failed, by_reason, examples, audited_at)
  values (d, checked, failed, reasons, ex, now())
  on conflict (day) do update set checked = excluded.checked, failed = excluded.failed, by_reason = excluded.by_reason,
    examples = excluded.examples, audited_at = excluded.audited_at;
  return jsonb_build_object('day', d, 'checked', checked, 'failed', failed, 'by_reason', reasons);
end
$function$;
revoke execute on function public.audit_welcome_insights() from public, anon, authenticated;

do $proof$
begin
  if position('a_steady' in pg_get_functiondef('public.audit_welcome_insights()'::regprocedure)) = 0 then
    raise exception 'PROOF: the checker was not replaced';
  end if;
end $proof$;
