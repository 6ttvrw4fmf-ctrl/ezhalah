-- Senior run #25 (2026-08-17). The `rate_stored_as_total` branch of the price/size fidelity barrier
-- had NO evidence gate, while its sibling detector `mon_detect_price_eq_area_or_ppm` has honoured
-- `ops_price_eq_area_verified` since 20260813064650. Both fire on the SAME shape
-- (price_total = price_per_meter), so an adjudicated source-truth row could satisfy one and still
-- trip the other forever.
--
-- Why that is a real production risk and not cosmetics: mon_raise() returns 0 when its dedup key is
-- already open (run #24 finding). The key here is per (check, platform) —
-- 'price_size_contamination:rate_stored_as_total:aqar' — so ONE permanently-open source-truth row
-- suppresses every future raise on that key. A genuine rate-as-total corruption anywhere in aqar
-- would then raise nothing new and re-dispatch nothing: the platform goes dark on this defect class.
--
-- Live case: aqar 7922029 (ad 6820795). The aqar page's own price field publishes "price":208 with
-- "area":3500, and the seller's description states «سعر المتر 208 مساحه 3500» — the seller filled
-- aqar's price field with the per-metre rate. Ezhalah stored the source value verbatim. Owner rule:
-- weird is not wrong; preserve it. Evidence recorded in ops_price_eq_area_verified.
--
-- This does NOT weaken the barrier. The gate is an evidence table whose rows each carry a live
-- probe, it is the SAME table the sibling detector already trusts, and an unverified row of the
-- identical shape still fires (negative control proven both directions at apply time).
create or replace function public.mon_price_size_fidelity_barrier()
 returns table(check_name text, platform text, n bigint, detail text)
 language sql
 stable
as $function$
  select 'zero_in_inapplicable_price_column'::text, s.platform, count(*)::bigint,
         'a 0 standing in for "not applicable" — the honest value is NULL'::text
  from public.search_listings_ar s
  where (s.deal_ar='بيع' and s.price_annual = 0) or (s.deal_ar='إيجار' and s.price_total = 0)
  group by s.platform having count(*) > 0

  union all
  -- Evidence-gated (run #25): a row adjudicated source-real in ops_price_eq_area_verified is
  -- excluded here exactly as it already is in mon_detect_price_eq_area_or_ppm. Anything NOT in that
  -- table still fires.
  select 'rate_stored_as_total', s.platform, count(*)::bigint,
         'price_total/area_m2 < 100 SAR/m² — a rate wearing the total column'
  from public.search_listings_ar s
  where s.deal_ar='بيع' and s.price_total is not null and s.price_per_meter is not null
    and s.price_total = s.price_per_meter and s.area_m2 > 0
    and s.price_total::numeric / s.area_m2 < 100
    and not exists (select 1 from public.ops_price_eq_area_verified v
                    where v.source_table = s.source_table and v.listing_id = s.listing_id)
  group by s.platform having count(*) > 0

  union all
  -- AREA LEAKED INTO PRICE — now over BOTH aqar tables via a UNION of their captures. Three signals
  -- must agree before a row is reported: area = price exactly, the spec table publishes no area, and
  -- no currency-marked figure exists in the capture. aqar 6594767 is deliberately NOT caught (it
  -- publishes «سعر المتر 1», so total = area legitimately and the figure is printed on the page).
  select 'area_leaked_into_price', s.platform, count(*)::bigint,
         'area = price exactly, no spec-table area, no priced token in the capture'
  from public.search_listings_ar s
  join (
    select id, 'aqar_residential_listings'::text tbl, source_capture from public.aqar_residential_listings
    union all
    select id, 'aqar_commercial_listings',           source_capture from public.aqar_commercial_listings
  ) a on a.id = s.listing_id and a.tbl = s.source_table
  where s.area_m2 is not null and s.area_m2 > 1000
    and s.area_m2 in (s.price_total, s.price_annual)
    and (regexp_match(split_part(coalesce(a.source_capture->>'source_text',''),'تفاصيل الإعلان',2),
                      'المساحة[\s:]{0,4}([0-9][0-9,٬]{0,12})'))[1] is null
    and (regexp_match(split_part(coalesce(a.source_capture->>'source_text',''),'تفاصيل الإعلان',1),
                      '([0-9][0-9,]{2,})\s*[§﷼]'))[1] is null
  group by s.platform having count(*) > 0

  union all
  select 'index_price_differs_from_raw', 'aqar', count(*)::bigint,
         'search_listings_ar price_annual differs from aqar_residential_listings'
  from public.search_listings_ar s
  join public.aqar_residential_listings a on a.id = s.listing_id
  where s.source_table = 'aqar_residential_listings'
    and s.price_annual is distinct from a.price_annual
  having count(*) > 0

  union all
  select 'area_differs_from_spec_block', 'aqar', count(*)::bigint,
         'stored area_m2 disagrees with «المساحة» inside the spec block'
  from (
    select a.area_m2,
           (regexp_match(split_part(a.source_capture->>'source_text','تفاصيل الإعلان',2),
                         'المساحة[\s:]{0,4}([0-9][0-9,٬]{0,12})(?:\.[0-9]+)?\s*م'))[1] r
    from public.aqar_residential_listings a
    where a.active and a.area_m2 is not null
      and coalesce(a.source_capture->>'source_text','') like '%تفاصيل الإعلان%'
  ) q
  where q.r is not null and q.area_m2 <> replace(replace(q.r,',',''),'٬','')::bigint
  having count(*) > 0
$function$;
