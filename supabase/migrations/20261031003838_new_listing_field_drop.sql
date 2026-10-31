-- New listings lose a field a site used to fill → alert on day 1, per site and per field.
--
-- Why (2026-10-30): on 2026-10-18 aqar added «ريال» between the price and «/سنوي» and stopped
-- sending rent_period in its payload. New aqar rentals with a period fell 95% → ~55% overnight and
-- ~7,200 priced rows dropped out of the «سنوي» filter for 12 days. The one alarm that counted them,
-- mon_detect_rent_period_unreachable, raises ONE fleet-wide key that had been open since 2026-09-03,
-- so aqar growing inside it from a handful to 5,720 rows raised nothing (mon_raise dedups an open key).
--
-- This compares each site's NEW listings (first seen in the last 24 h) with that same site's new
-- listings 8-45 days ago, field by field, and raises one P1 per (site, field) when the fill rate
-- falls 20+ points. The baseline skips the last week so a regression cannot become its own normal
-- within days. Daily (mon_claim_daily_slot); dry run on 2026-10-30 named aqar rent_period
-- (94.6% → 55.4%) and haraj price / area (~97% → ~66%), nothing else.

create or replace function public.new_listing_field_drops()
returns table(platform text, field text, today_n bigint, today_pct numeric, base_n bigint, base_pct numeric)
language sql stable set search_path to 'public' as $function$
  with w as (
    select s.platform,
           case when s.first_seen_at > now() - interval '24 hours' then 'today'
                when s.first_seen_at <= now() - interval '8 days' then 'base' end as win,
           s.deal_ar = 'إيجار' and coalesce(s.price_total, s.price_annual) is not null as priced_rent,
           s.rent_period_ar is not null as has_period,
           coalesce(s.price_total, s.price_annual, s.price_per_meter) is not null as has_price,
           s.area_m2 is not null as has_area,
           s.district_ar is not null as has_district,
           s.city_id is not null as has_city,
           (s.type_ar is not null and s.deal_ar is not null) as has_type_deal
      from public.search_listings_ar s
     where s.first_seen_at > now() - interval '45 days'),
  f as (
              select w.platform, w.win, 'rent_period'::text as field, w.has_period as ok from w where w.priced_rent and w.win is not null
    union all select w.platform, w.win, 'price',     w.has_price     from w where w.win is not null
    union all select w.platform, w.win, 'area',      w.has_area      from w where w.win is not null
    union all select w.platform, w.win, 'district',  w.has_district  from w where w.win is not null
    union all select w.platform, w.win, 'city',      w.has_city      from w where w.win is not null
    union all select w.platform, w.win, 'type_deal', w.has_type_deal from w where w.win is not null),
  g as (
    select f.platform, f.field,
           count(*) filter (where f.win = 'today') as today_n,
           round(100.0 * avg(f.ok::int) filter (where f.win = 'today'), 1) as today_pct,
           count(*) filter (where f.win = 'base') as base_n,
           round(100.0 * avg(f.ok::int) filter (where f.win = 'base'), 1) as base_pct
      from f group by 1, 2)
  select g.platform, g.field, g.today_n, g.today_pct, g.base_n, g.base_pct
    from g
   where g.today_n >= 30 and g.base_n >= 100 and g.base_pct >= 50 and g.base_pct - g.today_pct >= 20
$function$;

create or replace function public.mon_detect_new_listing_field_drop()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; live text[] := '{}'; r record; k text;
begin
  if not public.mon_claim_daily_slot('mon_detect_new_listing_field_drop') then
    return 0;
  end if;
  for r in select * from public.new_listing_field_drops() loop
    k := 'new_listing_field_drop:' || r.platform || ':' || r.field;
    live := live || k;
    n := n + public.mon_raise('P1', 'new_listing_field_drop', r.platform, k,
      jsonb_build_object('platform', r.platform, 'field', r.field,
        'today_new', r.today_n, 'today_pct', r.today_pct, 'baseline_new', r.base_n, 'baseline_pct', r.base_pct,
        'why', 'New listings from this site carry this field far less often than the site''s own new listings did 8-45 days ago. '
            || 'The usual cause is the site changing its page so our parser stops matching (aqar 2026-10-18: «ريال» beside «/سنوي»).',
        'action', 'Open two of today''s affected listings on the source site. If the source shows the field, fix the parser and '
            || 'add a test from the live markup; if it does not, record the source change. Never default a value to clear this.'));
  end loop;
  perform public.mon_resolve_stale_keys('new_listing_field_drop', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_new_listing_field_drop' in src) > 0 then return; end if;
  out_def := replace(src,
    E'    ''mon_detect_pin_share_drop'',',
    E'    ''mon_detect_pin_share_drop'',\n    ''mon_detect_new_listing_field_drop'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- ── Proofs ──────────────────────────────────────────────────────────────────────────────────────
-- 1. The case that earned this: aqar's rent period is named, with the drop it really had.
-- 2. A healthy site with the most new listings (dealapp, ~99% on every field) is not named.
-- 3. The detector is on the roster.
do $proof$
declare hit int; healthy int;
begin
  select count(*) into hit from public.new_listing_field_drops() d where d.platform = 'aqar' and d.field = 'rent_period';
  if hit <> 1 then raise exception 'PROOF: aqar rent_period not named (got % rows) — the barrier cannot see the case that earned it', hit; end if;
  select count(*) into healthy from public.new_listing_field_drops() d where d.platform = 'dealapp';
  if healthy <> 0 then raise exception 'PROOF: healthy dealapp named % time(s)', healthy; end if;
  if position('mon_detect_new_listing_field_drop' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: detector missing from the roster';
  end if;
end $proof$;
