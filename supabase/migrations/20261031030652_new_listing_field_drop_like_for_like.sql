-- new_listing_field_drops(): compare like with like, so a change in WHAT a site lists is not read as
-- the site losing a field.
--
-- Why (2026-10-30): the first version compared a site's whole day of new listings with its whole
-- baseline. Haraj fired P1s for price (65% vs 96.5%) and area (66% vs 97.5%) with nothing broken:
-- its baseline was a one-time catch-up of ~10,000 sale listings (land and homes, nearly always
-- priced and sized), and that week brought many holiday rest houses and chalets for rent, which
-- Haraj sellers almost never size or price (rest-house rentals: ~10% area at baseline too). Live
-- posts missing a size were read on the source; the size is not written anywhere in them.
--
-- Now each of today's listings is compared with the baseline rate of ITS OWN cell (property type ×
-- deal), and the expected rate is the average over today's rows. A real parser break lowers the
-- rate inside every cell and still fires (aqar rent_period: 58.6% vs 95.6% expected); a mix shift
-- moves both sides together and does not (haraj price 67.8% vs 76.1%, area 67.8% vs 78.0%).
-- Cells with fewer than 20 baseline rows are left out: a type the site never listed before has no
-- normal to fall from. type_deal is NOT split by cell (a listing that lost its type would land in a
-- '?' cell whose normal is 0% and could never fire).
-- Same signature and thresholds; base_pct is now the mix-adjusted expected rate.

create or replace function public.new_listing_field_drops()
returns table(platform text, field text, today_n bigint, today_pct numeric, base_n bigint, base_pct numeric)
language sql stable set search_path to 'public' as $function$
  with w as (
    select s.platform,
           coalesce(s.type_ar, '?') || '|' || coalesce(s.deal_ar, '?') as cell,
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
              select w.platform, w.win, w.cell, 'rent_period'::text as field, w.has_period as ok from w where w.priced_rent and w.win is not null
    union all select w.platform, w.win, w.cell, 'price',     w.has_price     from w where w.win is not null
    union all select w.platform, w.win, w.cell, 'area',      w.has_area      from w where w.win is not null
    union all select w.platform, w.win, w.cell, 'district',  w.has_district  from w where w.win is not null
    union all select w.platform, w.win, w.cell, 'city',      w.has_city      from w where w.win is not null
    union all select w.platform, w.win, ''::text, 'type_deal', w.has_type_deal from w where w.win is not null),
  b as (
    select f.platform, f.field, f.cell, count(*) as bn, avg(f.ok::int) as rate
      from f where f.win = 'base' group by 1, 2, 3 having count(*) >= 20),
  t as (
    select f.platform, f.field, f.cell, f.ok, b.rate
      from f join b using (platform, field, cell) where f.win = 'today'),
  g as (
    select t.platform, t.field,
           count(*) as today_n,
           round(100.0 * avg(t.ok::int), 1) as today_pct,
           (select sum(b2.bn)::bigint from b b2
             where b2.platform = t.platform and b2.field = t.field
               and b2.cell in (select t2.cell from t t2 where t2.platform = t.platform and t2.field = t.field)) as base_n,
           round(100.0 * avg(t.rate), 1) as base_pct
      from t group by 1, 2)
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
        'today_new', r.today_n, 'today_pct', r.today_pct, 'baseline_new', r.base_n, 'expected_pct', r.base_pct,
        'why', 'New listings from this site carry this field far less often than the site''s own new listings of the SAME '
            || 'property type and deal did 8-45 days ago (expected_pct is that rate for today''s mix). '
            || 'The usual cause is the site changing its page so our parser stops matching (aqar 2026-10-18: «ريال» beside «/سنوي»).',
        'action', 'Open two of today''s affected listings on the source site. If the source shows the field, fix the parser and '
            || 'add a test from the live markup; if it does not, record the source change. Never default a value to clear this.'));
  end loop;
  perform public.mon_resolve_stale_keys('new_listing_field_drop', live);
  return n;
end
$function$;

-- ── Proofs ──────────────────────────────────────────────────────────────────────────────────────
-- 1. aqar rent_period (the break that earned the alarm) is still named while it is still broken.
-- 2. haraj price and area (a mix shift, nothing broken) are not.
-- 3. healthy dealapp is not.
do $proof$
declare hit int; aqar_now numeric; haraj int; healthy int;
begin
  select round(100.0 * avg((s.rent_period_ar is not null)::int), 1) into aqar_now
    from public.search_listings_ar s
   where s.platform = 'aqar' and s.first_seen_at > now() - interval '24 hours'
     and s.deal_ar = 'إيجار' and coalesce(s.price_total, s.price_annual) is not null;
  select count(*) into hit from public.new_listing_field_drops() d where d.platform = 'aqar' and d.field = 'rent_period';
  if coalesce(aqar_now, 100) < 75 and hit <> 1 then
    raise exception 'PROOF: aqar rent_period is at % percent today but not named — the barrier lost the case that earned it', aqar_now;
  end if;
  select count(*) into haraj from public.new_listing_field_drops() d where d.platform = 'haraj' and d.field in ('price', 'area');
  if haraj <> 0 then raise exception 'PROOF: haraj mix shift still named % time(s)', haraj; end if;
  select count(*) into healthy from public.new_listing_field_drops() d where d.platform = 'dealapp';
  if healthy <> 0 then raise exception 'PROOF: healthy dealapp named % time(s)', healthy; end if;
end $proof$;
