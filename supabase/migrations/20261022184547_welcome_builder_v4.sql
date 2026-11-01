-- The headline builder, v4 (owner 2026-10-22: «be confident with all answers», purchase first, city then district).
-- 20261022171740 already made "new" mean settled sites, dropped stay-length prices from rent medians and silenced
-- shared/messy town names. This adds the purchase lines and the owner's duplicate rule.
-- And the owner's rules: the same property on several sites counts once (same district, deal, type, price and
-- area on a DIFFERENT site; pins within ~200 m when both carry one); week-against-week only over sites whose crawl
-- was steady both weeks; month-against-month asking prices shown only when they moved 3% or more; big and medium
-- cities first — small towns join after 3 clean nights of the checker.
set local statement_timeout = '5min';

create or replace function public.welcome_name_is_messy(p text)
returns boolean language sql immutable set search_path to 'public' as $function$
  select p is not null and (
    p ~ '[-–()/\\,،:؛0-9٠-٩A-Za-z]'
    or regexp_replace(trim(p), '^حي\s+', '') ~ '\sو'
    or regexp_replace(trim(p), '^حي\s+', '') ~ '^(مجمع|كمبوند|مخطط)'
  )
$function$;

create table if not exists public.welcome_insight_build (day date primary key, built_at timestamptz not null);
alter table public.welcome_insight_build enable row level security;
create table if not exists public.welcome_insight_audit (
  day date primary key, checked int not null, failed int not null,
  by_reason jsonb not null default '{}', examples jsonb not null default '[]', audited_at timestamptz not null default now());
alter table public.welcome_insight_audit enable row level security;

-- a city's total for one kind of ad, and its busiest district (a clear winner, at least 3)
create or replace function public.welcome_city_top_district(p_day date, p_kind text, p_pred text, p_min int)
returns void language plpgsql set search_path to 'public' as $function$
begin
  execute format($q$
    insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
    select %L::date, %L, region_ar, city_ar, city_id, top, total
      from (select city_ar, min(region_ar) region_ar, min(city_id) city_id, sum(n) total,
                   (array_agg(district_ar order by n desc) filter (where district_ar is not null))[1] top,
                   (array_agg(n order by n desc) filter (where district_ar is not null))[1] n1,
                   coalesce((array_agg(n order by n desc) filter (where district_ar is not null))[2], 0) n2
              from (select city_ar, region_ar, city_id, district_ar, count(*) n from w_b where %s group by 1, 2, 3, 4) c
             group by city_ar) t
     where total >= %s and n1 >= 3 and n1 > n2$q$, p_day, p_kind, p_pred, p_min);
end
$function$;

-- this week against last week for one kind of ad, per city, over steady sites only
create or replace function public.welcome_wow(p_day date, p_group text, p_pred text, p_wk timestamptz)
returns void language plpgsql set search_path to 'public' as $function$
begin
  execute format($q$
    with steady as (
      select b.platform from w_b b join w_pf p on p.platform = b.platform
       where p.settled_at <= %2$L::timestamptz - interval '7 days'
       group by b.platform
      having count(*) filter (where b.first_seen_at >= %2$L::timestamptz) >= 20
         and count(*) filter (where b.first_seen_at >= %2$L::timestamptz - interval '7 days' and b.first_seen_at < %2$L::timestamptz) >= 20
         and count(*) filter (where b.first_seen_at >= %2$L::timestamptz) * 3
             >= count(*) filter (where b.first_seen_at >= %2$L::timestamptz - interval '7 days' and b.first_seen_at < %2$L::timestamptz) * 2
         and count(*) filter (where b.first_seen_at >= %2$L::timestamptz) * 2
             <= count(*) filter (where b.first_seen_at >= %2$L::timestamptz - interval '7 days' and b.first_seen_at < %2$L::timestamptz) * 3),
    c as (
      select city_ar, min(region_ar) region_ar, min(city_id) city_id,
             count(*) filter (where first_seen_at >= %2$L::timestamptz) tw,
             count(*) filter (where first_seen_at >= %2$L::timestamptz - interval '7 days' and first_seen_at < %2$L::timestamptz) lw
        from w_b where platform in (select platform from steady) and (%3$s)
       group by city_ar)
    insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, a, b)
    select %1$L::date, 'wow_' || %4$L || case when tw > lw then '_up' else '_down' end, region_ar, city_ar, city_id,
           abs(round(100.0 * (tw - lw) / lw)), tw
      from c where tw >= 30 and lw >= 30 and abs(round(100.0 * (tw - lw) / lw)) >= 10$q$,
    p_day, p_wk, p_pred, p_group);
end
$function$;

-- a district's median asking figure for one kind of ad
create or replace function public.welcome_district_median(p_day date, p_kind text, p_pred text, p_expr text, p_min int)
returns void language plpgsql set search_path to 'public' as $function$
begin
  execute format($q$
    insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
    select %L::date, %L, min(region_ar), city_ar, min(city_id), district_ar,
           round(percentile_cont(0.5) within group (order by (%s))::numeric)
      from w_b where district_ar is not null and (%s)
     group by city_ar, district_ar having count(*) >= %s$q$, p_day, p_kind, p_expr, p_pred, p_min);
end
$function$;

-- this month's new ads against last month's: median asking figure, shown only when it moved 3% or more
create or replace function public.welcome_month(p_day date, p_kind text, p_by_district boolean, p_pred text, p_expr text, p_now timestamptz)
returns void language plpgsql set search_path to 'public' as $function$
begin
  execute format($q$
    insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a, b)
    select %1$L::date, %2$L, region_ar, city_ar, city_id, dist, round(m1::numeric), round(m0::numeric)
      from (select city_ar, min(region_ar) region_ar, min(city_id) city_id, %3$s dist,
                   percentile_cont(0.5) within group (order by (%5$s)) filter (where first_seen_at >= %6$L::timestamptz - interval '30 days') m1,
                   percentile_cont(0.5) within group (order by (%5$s)) filter (where first_seen_at >= %6$L::timestamptz - interval '60 days' and first_seen_at < %6$L::timestamptz - interval '30 days') m0,
                   count(*) filter (where first_seen_at >= %6$L::timestamptz - interval '30 days') n1,
                   count(*) filter (where first_seen_at >= %6$L::timestamptz - interval '60 days' and first_seen_at < %6$L::timestamptz - interval '30 days') n0
              from w_b where (%4$s) %7$s
             group by city_ar %8$s) z
     where n1 >= 20 and n0 >= 20 and abs(m1 - m0) * 100 >= m0 * 3$q$,
    p_day, p_kind, case when p_by_district then 'district_ar' else 'null::text' end, p_pred, p_expr, p_now,
    case when p_by_district then 'and district_ar is not null' else '' end,
    case when p_by_district then ', district_ar' else '' end);
end
$function$;
revoke execute on function public.welcome_city_top_district(date, text, text, int) from public, anon, authenticated;
revoke execute on function public.welcome_wow(date, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.welcome_district_median(date, text, text, text, int) from public, anon, authenticated;
revoke execute on function public.welcome_month(date, text, boolean, text, text, timestamptz) from public, anon, authenticated;

do $m$
declare src text; out_def text; a text;
  anchors text[] := array[
    $p$  insert into public.welcome_insight(day, kind, region_ar, a, b)
  select d, 'yesterday', region_ar, (select count(*) from w_b where first_seen_at >= y0 and first_seen_at < y1), c
    from (select region_ar, count(*) c from w_b where first_seen_at >= y0 and first_seen_at < y1 group by 1) z where c >= 5;$p$,
    $p$  -- each region's centre = the median of its own pins$p$,
    $p$  -- never speak through a name two towns share, a messy district name, or a retired line
$p$,
    $p$  insert into public.welcome_insight_build(day, built_at)$p$];
begin
  src := pg_get_functiondef('public.build_welcome_insights()'::regprocedure);
  if position('welcome_month' in src) > 0 then return; end if;
  foreach a in array anchors loop
    if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then
      raise exception 'builder anchor not found exactly once — refusing to guess: %', left(a, 60);
    end if;
  end loop;
  out_def := src;
  out_def := replace(out_def, anchors[1], $p$  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, a, b)
  select d, 'yesterday', region_ar, city_ar, city_id, (select count(*) from w_b where first_seen_at >= y0 and first_seen_at < y1), c
    from (select city_ar, min(region_ar) region_ar, min(city_id) city_id, count(*) c
            from w_b where first_seen_at >= y0 and first_seen_at < y1 group by 1) z where c >= 20;$p$);
  out_def := replace(out_def, anchors[2], $p$  -- the same property on several sites counts once (owner 2026-10-22): same town, district, deal, type, price
  -- and area on a DIFFERENT site, and pins within ~200 m when both carry one
  delete from w_b x using w_b y
   where x.city_id = y.city_id and x.district_ar = y.district_ar and x.deal_ar = y.deal_ar and x.type_ar = y.type_ar
     and coalesce(x.price_total, x.price_annual) = coalesce(y.price_total, y.price_annual) and x.area_m2 = y.area_m2
     and x.platform <> y.platform and (x.platform, x.listing_id::text) > (y.platform, y.listing_id::text)
     and (x.lat is null or y.lat is null
          or power((x.lat - y.lat) * 111000, 2) + power((x.lng - y.lng) * 111000 * cos(radians(x.lat)), 2) < 40000);
$p$ || anchors[2]);
  out_def := replace(out_def, anchors[3], $p$  -- purchase first: land, apartments, buildings — a city, then its busiest district (owner + their dad, 2026-10-22)
  perform public.welcome_city_top_district(d, 'city_land', 'type_ar like ''أرض%''', 20);
  perform public.welcome_city_top_district(d, 'city_sale', 'deal_ar = ''بيع''', 100);
  perform public.welcome_city_top_district(d, 'city_bld_sale', 'deal_ar = ''بيع'' and type_ar = ''عمارة''', 20);
  perform public.welcome_city_top_district(d, 'week_land', format('first_seen_at >= %L and deal_ar = ''بيع'' and type_ar like ''أرض%%''', wk), 15);
  perform public.welcome_city_top_district(d, 'week_apt_sale', format('first_seen_at >= %L and deal_ar = ''بيع'' and type_ar = ''شقة''', wk), 15);
  perform public.welcome_city_top_district(d, 'week_bld_sale', format('first_seen_at >= %L and deal_ar = ''بيع'' and type_ar = ''عمارة''', wk), 10);
  perform public.welcome_wow(d, 'land', 'deal_ar = ''بيع'' and type_ar like ''أرض%''', wk);
  perform public.welcome_wow(d, 'apt_sale', 'deal_ar = ''بيع'' and type_ar = ''شقة''', wk);
  perform public.welcome_wow(d, 'bld', 'deal_ar = ''بيع'' and type_ar = ''عمارة''', wk);
  perform public.welcome_district_median(d, 'apt_sale_ppm', 'deal_ar = ''بيع'' and type_ar = ''شقة'' and price_total between 100000 and 20000000 and area_m2 between 30 and 1000', 'price_total / area_m2', 20);
  perform public.welcome_district_median(d, 'villa_price', 'deal_ar = ''بيع'' and type_ar = ''فيلا'' and price_total between 200000 and 50000000', 'price_total', 20);
  perform public.welcome_district_median(d, 'bld_price', 'deal_ar = ''بيع'' and type_ar = ''عمارة'' and price_total between 300000 and 200000000', 'price_total', 15);
  perform public.welcome_month(d, 'month_apt_ppm', true, 'deal_ar = ''بيع'' and type_ar = ''شقة'' and price_total between 100000 and 20000000 and area_m2 between 30 and 1000', 'price_total / area_m2', now());
  perform public.welcome_month(d, 'month_land_ppm', false, 'deal_ar = ''بيع'' and type_ar like ''أرض%'' and price_per_meter between 10 and 50000', 'price_per_meter', now());
  perform public.welcome_month(d, 'month_bld_ppm', false, 'deal_ar = ''بيع'' and type_ar = ''عمارة'' and price_total between 300000 and 200000000 and area_m2 between 100 and 20000', 'price_total / area_m2', now());
$p$ || anchors[3]);
  out_def := replace(out_def, anchors[4], $p$  -- big and medium cities first; small towns join after 3 clean nights of the checker (owner 2026-10-22)
  if (select count(*) from public.welcome_insight_audit c where c.day >= d - 3 and c.day < d and c.failed = 0) < 3 then
    delete from public.welcome_insight w where w.day = d and w.city_id is not null
       and w.city_id not in (select b.city_id from w_b b where b.city_id is not null group by b.city_id having count(*) >= 300);
  end if;
$p$ || anchors[4]);
  execute out_def;
end $m$;

do $proof$
declare src text;
begin
  src := pg_get_functiondef('public.build_welcome_insights()'::regprocedure);
  if position('welcome_month' in src) = 0
     or position('delete from w_b x using w_b y' in src) = 0 or position('welcome_insight_build' in src) = 0 then
    raise exception 'PROOF: the builder was not patched';
  end if;
  if not public.welcome_name_is_messy('حي هجره الذيبيه وخضراء') or not public.welcome_name_is_messy('حي الحمراء و ام الجود')
     or public.welcome_name_is_messy('حي ولي العهد') or public.welcome_name_is_messy('حي وسط المدينة') then
    raise exception 'PROOF: the messy-name rule misjudges a known name';
  end if;
end $proof$;
