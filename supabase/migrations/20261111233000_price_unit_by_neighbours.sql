-- A TINY PRICE IS JUDGED BY ITS NEIGHBOURS (owner 2026-11-11: «check the displayed price … land price … the ones beside it»,
-- then «make it a guard and rule applies to properties … it's a must»).
--
-- Two rules already read a tiny sale/rent figure the way the seller meant it, from the ad's own words and a price band:
-- land_ppm_typed_as_total_served_ar() (2026-11-04: «1,350» on a 750 m² plot = 1,350 a metre) and
-- price_in_thousands_served_ar() (2026-11-06: «614» = 614,000). When BOTH readings fall inside the band and the ad says
-- nothing, both rules stood aside and the row went to land_price_unit_review_ar as «per-m² or thousands» — 98 land plots
-- and 127 homes on 2026-11-11, shown at their raw figure («1,350 ﷼» for a whole plot).
--
-- The tie-breaker the owner asked for: compare each reading with what the SAME neighbourhood normally costs (the median
-- of the source's own prices, district first, city second — the same rows the band is built from). A reading wins only
-- when it sits within ½×–2× of that median AND is clearly closer than the other reading (log distance ≥ 0.2, i.e. ≈ 22 %
-- nearer). Anything closer stays on the review list, as the source wrote it. Measured that day on the 98 land plots:
-- 53 per metre (e.g. abwbna اليمامة «1,350», 750 m², neighbours ≈ 1,400 a metre), 15 in thousands (abralosol الراشدية
-- «614», 307 m², neighbours ≈ 1,900 a metre → 614,000), 30 left alone.
--
-- 1. land_sale_ppm_band / price_thousands_band gain `med` (the neighbours' median). Both refreshes now build only from
--    figures the SOURCE published — a row either rule already rewrote is excluded from both bands (no feedback loop).
-- 2. price_unit_by_neighbours_ar(per-m² reading, thousands reading, median) — the pure judge.
-- 3. price_unit_neighbour_verdict_ar(deal, figure, area, type, city, district) — looks up the band and asks the judge ONLY
--    where the band cannot decide: land — both readings inside the band; homes/business units — both inside (any deal),
--    or, on a sale, only the per-m² reading inside (it was never served before).
-- 4. Both served wrappers ask it only when the ad's own words are silent (the words always win). Same verdict, same
--    inputs, so the per-metre rule and the thousands rule can never both fire. The land rule's own guards
--    (land_ppm_typed_as_total_ar, price_in_thousands_ar) are NOT redefined.
-- 5. Homes and business units (owner: «applies to properties») may now be served per metre on a SALE — only on the
--    neighbours' clear verdict, never on the band alone; area ≥ 100 and figure < 10,000, as the thousands rule.
--    The card already follows the index for every type (src/lib/landPerMeterTotal.ts, src/data/remote.ts).
-- 6. mon_detect_land_ppm_typed_as_total() re-judges every sale (not only land) and raises P1
--    price_unit_neighbour_median_missing when a band refresh leaves every median empty — a blind tie-breaker would
--    otherwise read as «nothing to decide».
-- 7. The rows the neighbours can decide are re-judged now (a no-op update fires enforce_price_size_sanity()).

set local lock_timeout = '5s';

alter table public.land_sale_ppm_band add column if not exists med numeric;
alter table public.price_thousands_band add column if not exists med numeric;

create or replace function public.refresh_land_sale_ppm_band()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare n int;
begin
  delete from public.land_sale_ppm_band;
  insert into public.land_sale_ppm_band (city_ar, district_ar, lo, hi, med, n, refreshed_at)
  select city_ar, case when g = 1 then '' else d end, lo, hi, med, cnt, now()
    from (select h.city_ar, h.d, count(*)::int cnt, grouping(h.d) g,
                 greatest(100, 0.75 * percentile_cont(0.1) within group (order by h.ppm)) lo,
                 1.5 * percentile_cont(0.9) within group (order by h.ppm) hi,
                 percentile_cont(0.5) within group (order by h.ppm) med
            from (select s.city_ar, coalesce(s.district_ar, '') d, s.price_total / s.area_m2 ppm
                    from public.search_listings_ar s
                   where s.deal_ar = 'بيع' and s.production_ready and not s.ppm_typed_as_total and not s.price_in_thousands
                     and s.type_ar like 'أرض%' and s.type_ar not like '%زراع%' and s.city_ar is not null
                     and s.price_total >= 20000 and s.area_m2 between 100 and 1000000
                     and s.price_total / s.area_m2 >= 50) h
           group by grouping sets ((h.city_ar, h.d), (h.city_ar))) b
   where (g = 0 and d <> '' and cnt >= 20) or (g = 1 and cnt >= 30);
  get diagnostics n = row_count;
  return n;
end
$function$;

create or replace function public.refresh_price_thousands_band()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare n int;
begin
  delete from public.price_thousands_band where true;
  insert into public.price_thousands_band (deal_ar, type_ar, city_ar, district_ar, lo, hi, med, n, refreshed_at)
  select deal_ar, type_ar, city_ar, case when g = 1 then '' else d end, lo, hi, med, cnt, now()
    from (select h.deal_ar, h.type_ar, h.city_ar, h.d, count(*)::int cnt, grouping(h.d) g,
                 0.75 * percentile_cont(0.1) within group (order by h.p) lo,
                 1.5  * percentile_cont(0.9) within group (order by h.p) hi,
                 percentile_cont(0.5) within group (order by h.p) med
            from (select s.deal_ar, s.type_ar, s.city_ar, coalesce(s.district_ar, '') d,
                         case when s.deal_ar = 'إيجار' then s.price_annual else s.price_total end p
                    from public.search_listings_ar s
                   where s.production_ready and not s.price_in_thousands and not s.ppm_typed_as_total and s.city_ar is not null
                     and public.price_in_thousands_type_ok_ar(s.type_ar)
                     and s.platform not in ('gathern', 'aqarmonthly')
                     and ((s.deal_ar = 'بيع' and s.price_total between 10000 and 500000000)
                       or (s.deal_ar = 'إيجار' and s.rent_period_ar is not null and s.price_annual between 1000 and 500000000))) h
           group by grouping sets ((h.deal_ar, h.type_ar, h.city_ar, h.d), (h.deal_ar, h.type_ar, h.city_ar))) b
   where (g = 0 and d <> '' and cnt >= 20) or (g = 1 and cnt >= 30);
  get diagnostics n = row_count;
  return n;
end
$function$;

-- The pure judge. Both readings are in the median's unit (a price per m² for land, a whole price for a home).
create or replace function public.price_unit_by_neighbours_ar(per_m2_reading numeric, thousands_reading numeric, neighbour_median numeric)
 returns text
 language sql
 immutable
as $function$
  select case
    when neighbour_median is null or neighbour_median <= 0 then null
    when per_m2_reading > 0 and per_m2_reading between 0.5 * neighbour_median and 2 * neighbour_median
     and (thousands_reading is null or thousands_reading <= 0
          or abs(ln(per_m2_reading / neighbour_median)) + 0.2 <= abs(ln(thousands_reading / neighbour_median))) then 'per_meter'
    when thousands_reading > 0 and thousands_reading between 0.5 * neighbour_median and 2 * neighbour_median
     and (per_m2_reading is null or per_m2_reading <= 0
          or abs(ln(thousands_reading / neighbour_median)) + 0.2 <= abs(ln(per_m2_reading / neighbour_median))) then 'thousands'
  end
$function$;

-- The served verdict: the judge is asked ONLY where the band cannot decide by itself.
create or replace function public.price_unit_neighbour_verdict_ar(p_deal text, p numeric, area integer, p_type text, p_city text, p_district text)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_lo numeric; v_hi numeric; v_med numeric; v_pm numeric; v_k numeric;
begin
  if p is null or p <= 0 or area is null or area <= 0 or p_type is null or p_city is null
     or p_deal is null or p_deal not in ('بيع', 'إيجار') then
    return null;
  end if;
  if p_type like 'أرض%' then
    if p_type like '%زراع%' or p_deal <> 'بيع' or area < 100 or p >= 20000 or p / area >= 50 then return null; end if;
    select b.lo, b.hi, b.med into v_lo, v_hi, v_med
      from public.land_sale_ppm_band b
     where b.city_ar = p_city and b.district_ar in (coalesce(p_district, ''), '')
     order by (b.district_ar = '') limit 1;
    v_pm := p;                    -- the figure as a price per m²
    v_k  := p * 1000 / area;      -- the figure in thousands, as a price per m²
    if v_lo is null or not (v_pm between v_lo and v_hi and v_k between v_lo and v_hi) then return null; end if;
  elsif public.price_in_thousands_type_ok_ar(p_type) then
    if (p_deal = 'بيع' and p >= 10000) or (p_deal = 'إيجار' and p >= 300) then return null; end if;
    select b.lo, b.hi, b.med into v_lo, v_hi, v_med
      from public.price_thousands_band b
     where b.deal_ar = p_deal and b.type_ar = p_type and b.city_ar = p_city
       and b.district_ar in (coalesce(p_district, ''), '')
     order by (b.district_ar = '') limit 1;
    v_pm := p * area;             -- the figure as a price per m², as a whole price
    v_k  := p * 1000;             -- the figure in thousands, as a whole price
    if v_lo is null then return null; end if;
    if v_k between v_lo and v_hi then
      if not (v_pm between v_lo and v_hi) then return null; end if;      -- «thousands» alone: the band already decides
    elsif not (p_deal = 'بيع' and v_pm between v_lo and v_hi) then
      return null;
    end if;
  else
    return null;
  end if;
  return public.price_unit_by_neighbours_ar(v_pm, v_k, v_med);
end
$function$;

create or replace function public.land_ppm_typed_as_total_served_ar(p_source_table text, p_listing_id bigint, p numeric, area integer, ppm numeric, p_type text, p_city text, p_district text)
 returns numeric
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_lo numeric; v_hi numeric; v_pm boolean; v_k boolean; v_nb text;
begin
  if p is null or area is null or p <= 0 or area < 100 or p_type is null or p_city is null then
    return null;
  end if;
  select e.says_per_m2, e.says_thousands into v_pm, v_k
    from public.land_price_unit_text_evidence e
   where e.source_table = p_source_table and e.listing_id = p_listing_id;
  if p_type like 'أرض%' then
    if p >= 20000 or p / area >= 50 or p_type like '%زراع%' then return null; end if;
    select b.lo, b.hi into v_lo, v_hi
      from public.land_sale_ppm_band b
     where b.city_ar = p_city and b.district_ar in (coalesce(p_district, ''), '')
     order by (b.district_ar = '') limit 1;
    -- the ad's own words first; when they are silent and the band cannot decide, the neighbours do (owner 2026-11-11)
    if not coalesce(v_pm, false) and not coalesce(v_k, false) then
      v_nb := public.price_unit_neighbour_verdict_ar('بيع', p, area, p_type, p_city, p_district);
      v_pm := v_nb = 'per_meter';
      v_k  := v_nb = 'thousands';
    end if;
    return public.land_ppm_typed_as_total_ar(p, area, ppm, v_lo, v_hi, v_pm, v_k);
  end if;
  -- a home or business unit (owner 2026-11-11 «applies to properties»): per metre ONLY on the neighbours' clear verdict
  if not public.price_in_thousands_type_ok_ar(p_type) or p >= 10000 or abs(p - area) <= 1 or p * area > 500000000
     or (ppm is not null and abs(ppm * area - p) <= 0.05 * p) or coalesce(v_k, false) then
    return null;
  end if;
  if public.price_unit_neighbour_verdict_ar('بيع', p, area, p_type, p_city, p_district) = 'per_meter' then
    return p * area;
  end if;
  return null;
end
$function$;

create or replace function public.price_in_thousands_served_ar(p_source_table text, p_listing_id bigint, p_deal text, p numeric, area integer, ppm numeric, p_type text, p_city text, p_district text, p_platform text)
 returns numeric
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_land boolean; v_rent boolean; v_lo numeric; v_hi numeric; v_pm boolean; v_k boolean; v_nb text;
begin
  if p is null or p <= 0 or p >= 20000 or p_type is null or p_city is null or p_deal not in ('بيع', 'إيجار') then
    return null;
  end if;
  v_rent := p_deal = 'إيجار';
  v_land := p_type like 'أرض%' and p_type not like '%زراع%';
  if v_land then
    if v_rent or area is null or area < 100 or p / area >= 50 then return null; end if;   -- land rents stay on review
    select b.lo, b.hi into v_lo, v_hi
      from public.land_sale_ppm_band b
     where b.city_ar = p_city and b.district_ar in (coalesce(p_district, ''), '')
     order by (b.district_ar = '') limit 1;
  elsif public.price_in_thousands_type_ok_ar(p_type) and coalesce(p_platform, '') not in ('gathern', 'aqarmonthly') then
    if (v_rent and p >= 300) or (not v_rent and p >= 10000) then return null; end if;
    select b.lo, b.hi into v_lo, v_hi
      from public.price_thousands_band b
     where b.deal_ar = p_deal and b.type_ar = p_type and b.city_ar = p_city
       and b.district_ar in (coalesce(p_district, ''), '')
     order by (b.district_ar = '') limit 1;
  else
    return null;
  end if;
  select e.says_per_m2, e.says_thousands into v_pm, v_k
    from public.land_price_unit_text_evidence e
   where e.source_table = p_source_table and e.listing_id = p_listing_id;
  -- the ad's own words first; when they are silent and the band cannot decide, the neighbours do (owner 2026-11-11)
  if not coalesce(v_pm, false) and not coalesce(v_k, false) then
    v_nb := public.price_unit_neighbour_verdict_ar(p_deal, p, area, p_type, p_city, p_district);
    v_pm := v_nb = 'per_meter';
    v_k  := v_nb = 'thousands';
  end if;
  return public.price_in_thousands_ar(p, v_land, v_rent, area, ppm, v_lo, v_hi, v_pm, v_k);
end
$function$;

create or replace function public.mon_detect_land_ppm_typed_as_total()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare n int := 0; v_healed bigint; v_left bigint; v_review bigint; v_by jsonb; v_sample jsonb;
  v_land_bands bigint; v_land_nomed bigint; v_k_bands bigint; v_k_nomed bigint;
begin
  perform public.refresh_land_sale_ppm_band();
  perform public.refresh_land_price_unit_text_evidence();

  -- THE NEIGHBOURS MUST BE ABLE TO SPEAK (owner 2026-11-11). A band refresh that leaves every median empty makes the
  -- tie-breaker silent, and a silent tie-breaker reads exactly like «nothing to decide».
  select count(*), count(*) filter (where med is null) into v_land_bands, v_land_nomed from public.land_sale_ppm_band;
  select count(*), count(*) filter (where med is null) into v_k_bands, v_k_nomed from public.price_thousands_band;
  if (v_land_bands > 0 and v_land_nomed = v_land_bands) or (v_k_bands > 0 and v_k_nomed = v_k_bands) then
    n := n + public.mon_raise('P1', 'price_unit_neighbour_median_missing', 'search_index', 'price_unit_neighbour_median_missing:fleet',
      jsonb_build_object('land_bands', v_land_bands, 'land_without_median', v_land_nomed,
                         'home_bands', v_k_bands, 'home_without_median', v_k_nomed,
        'why', 'the price bands were refreshed without their neighbourhood median, so price_unit_neighbour_verdict_ar() cannot judge a tiny price as per-metre or thousands and every such ad stays at its raw figure.',
        'fix', 'refresh_land_sale_ppm_band() / refresh_price_thousands_band() must fill med (percentile_cont(0.5)). Never clear this by deleting bands.'));
  else
    perform public.mon_resolve_key('price_unit_neighbour_median_missing', 'price_unit_neighbour_median_missing:fleet');
  end if;

  -- REPAIR FIRST (owner 2026-10-31). A no-op update fires enforce_price_size_sanity(), which applies the rule.
  -- Every sale, not only land: homes and business units are read per metre on the neighbours' verdict (owner 2026-11-11).
  update public.search_listings_ar s set price_total = s.price_total
   where s.deal_ar = 'بيع' and not s.ppm_typed_as_total
     and s.price_total > 0 and s.price_total < 20000 and s.area_m2 >= 100
     and public.land_ppm_typed_as_total_served_ar(s.source_table, s.listing_id, s.price_total, s.area_m2, s.price_per_meter,
                                                  s.type_ar, s.city_ar, s.district_ar) is not null;
  get diagnostics v_healed = row_count;
  if v_healed = 0 then
    perform public.mon_resolve_key('land_ppm_typed_as_total_self_healed', 'land_ppm_typed_as_total_self_healed:fleet');
  else
    n := n + public.mon_raise('P2', 'land_ppm_typed_as_total_self_healed', 'search_index', 'land_ppm_typed_as_total_self_healed:fleet',
      jsonb_build_object('count', v_healed,
        'why', 'sale rows whose total is really a per-metre price were served × area by this run (the trigger did it on the no-op update). Expected in small numbers: the ad''s own words, the price band and the neighbourhood median are refreshed daily, so a row that needed them waits for this run. A large count means rows reached the index past enforce_price_size_sanity().'));
  end if;

  select count(*) into v_left
    from public.search_listings_ar s
   where s.deal_ar = 'بيع' and not s.ppm_typed_as_total
     and s.price_total > 0 and s.price_total < 20000 and s.area_m2 >= 100
     and public.land_ppm_typed_as_total_served_ar(s.source_table, s.listing_id, s.price_total, s.area_m2, s.price_per_meter,
                                                  s.type_ar, s.city_ar, s.district_ar) is not null;
  if v_left = 0 then
    perform public.mon_resolve_key('land_ppm_typed_as_total_served', 'land_ppm_typed_as_total_served:fleet');
  else
    n := n + public.mon_raise('P1', 'land_ppm_typed_as_total_served', 'search_index', 'land_ppm_typed_as_total_served:fleet',
      jsonb_build_object('count', v_left,
        'why', 'a sale still shows a per-metre price as its TOTAL after this detector re-judged it, so enforce_price_size_sanity() did not apply land_ppm_typed_as_total_served_ar(): the trigger is disabled, replaced, or no longer calls it.',
        'fix', 'Check trg_price_size_sanity is enabled on search_listings_ar and enforce_price_size_sanity() still calls land_ppm_typed_as_total_served_ar(). Never hide the row or edit the platform table to clear this.'));
  end if;

  select coalesce(sum(c), 0), coalesce(jsonb_object_agg(reason, c), '{}'::jsonb) into v_review, v_by
    from (select reason, count(*) c from public.land_price_unit_review_ar group by reason) q;
  if v_review = 0 then
    perform public.mon_resolve_key('land_price_unit_review', 'land_price_unit_review:fleet');
  else
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_sample
      from (select * from public.land_price_unit_review_ar order by reason, platform, listing_id limit 15) t;
    n := n + public.mon_raise('P2', 'land_price_unit_review', 'search_index', 'land_price_unit_review:fleet',
      jsonb_build_object('count', v_review, 'by_reason', v_by, 'sample', v_sample,
        'why', 'land prices the rule refuses to guess: per-metre OR thousands with the neighbourhood median too close to call, the ad''s words say «الف», the area copied into the price box, outside the district/city band, no band, tiny land rents for an urban-size plot, and Property Finder offices whose area dwarfs the rent (square feet). They stay as the source wrote them. Full list: select * from land_price_unit_review_ar.'));
  end if;
  return n;
end
$function$;

-- The judge, executed on the real ads that defined it (a wrong edit fails the apply, not a customer).
do $proof$
begin
  if public.price_unit_by_neighbours_ar(1350, 1350000.0 / 750, 1400) is distinct from 'per_meter' then
    raise exception 'neighbour judge: abwbna اليمامة «1,350» on 750 m² (neighbours 1,400/m²) must read per metre';
  end if;
  if public.price_unit_by_neighbours_ar(614, 614000.0 / 307, 1900) is distinct from 'thousands' then
    raise exception 'neighbour judge: abralosol الراشدية «614» on 307 m² (neighbours 1,900/m²) must read in thousands';
  end if;
  if public.price_unit_by_neighbours_ar(9100, 9100000.0 / 816, 10000) is not null then
    raise exception 'neighbour judge: wasalt الملقا «9,100» on 816 m² (neighbours 10,000/m²) is too close to call';
  end if;
  if public.price_unit_by_neighbours_ar(1350, 1800, null) is not null then
    raise exception 'neighbour judge: no neighbours, no verdict';
  end if;
  if public.price_unit_by_neighbours_ar(300, 300000.0 / 450, 1597) is not null then
    raise exception 'neighbour judge: a reading outside ½×–2× of the neighbours never wins';
  end if;
end
$proof$;

-- Bands with their medians, then the rows the neighbours can decide are re-judged by the trigger.
select public.refresh_land_sale_ppm_band();
select public.refresh_price_thousands_band();
update public.search_listings_ar s set price_total = s.price_total
  from public.land_price_unit_review_ar r
 where r.source_table = s.source_table and r.listing_id = s.listing_id
   and r.reason in ('sale_per_m2_or_thousands', 'tiny_price_thousands_unclear', 'tiny_price_reads_per_m2');
