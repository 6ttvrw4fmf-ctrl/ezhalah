-- PRICE + SIZE FIDELITY BARRIER (Filter audit, 2026-08-10).
--
-- Detects OUR fabrications only. A weird value the source really publishes is NOT a finding — that
-- is the owner's permanent rule, and three separate "defects" during this audit turned out to be
-- the source being odd or my own oracle being wrong:
--   • 18 aqar rows where price_total = price_per_meter — aqar itself prints the total inside its
--     «سعر المتر» slot (6630081: total 600,000 over 600 m², page says rate "600,000"). Source-odd,
--     kept, and not user-visible (the card renders a rate only when there is no total).
--   • 3,453 apparent area mismatches — my oracle was reading «المساحة» out of the seller's PROSE and
--     out of «المساحة للقطعة رقم 29», the plot NUMBER. Anchored to the spec block, aqar area is
--     67,483/67,483 = 100.00% exact.
--   • 6,891 apparent Buy price mismatches — aqar prints the pre-discount price first and the current
--     price second; we correctly store the second in price_total and the first in price_original,
--     with discount_pct agreeing. Measured properly, 39,688/40,200 = 98.73% of stored Buy prices
--     appear verbatim in the captured page.
-- Each returned row is a QUESTION to verify against source, never a licence to rewrite a value.
create or replace function public.mon_price_size_fidelity_barrier()
returns table(check_name text, platform text, n bigint, detail text)
language sql
stable
as $function$
  -- 1. "Not applicable" must be NULL, never 0. A Buy listing has no annual rent; a Rent listing has
  --    no sale total. A source-published 0 in the APPLICABLE column is legitimate and NOT flagged
  --    (ramzalqasim RQ226/252/253 publish price_total = 0 and stay searchable).
  select 'zero_in_inapplicable_price_column'::text, s.platform, count(*)::bigint,
         'a 0 standing in for "not applicable" — the honest value is NULL'::text
  from public.search_listings_ar s
  where (s.deal_ar='بيع' and s.price_annual = 0) or (s.deal_ar='إيجار' and s.price_total = 0)
  group by s.platform having count(*) > 0

  union all
  -- 2. A per-m² RATE stored as the whole asking price. Decided by the IMPLIED rate, not by looking
  --    small: under 100 SAR/m² a "total" is a rate. (aqargate/hajer/eastabha shipped this class.)
  select 'rate_stored_as_total', s.platform, count(*)::bigint,
         'price_total/area_m2 < 100 SAR/m² — a rate wearing the total column'
  from public.search_listings_ar s
  where s.deal_ar='بيع' and s.price_total is not null and s.price_per_meter is not null
    and s.price_total = s.price_per_meter and s.area_m2 > 0
    and s.price_total::numeric / s.area_m2 < 100
  group by s.platform having count(*) > 0

  union all
  -- 3. AREA LEAKED INTO PRICE: the stored price equals the area exactly AND that number appears
  --    nowhere as a currency-marked figure in our own capture. Two independent signals, so this is
  --    not a coincidence filter. (aqar 6594767 is deliberately NOT caught: its price DOES appear on
  --    the page and equals the area only because aqar publishes «سعر المتر 1».)
  select 'area_leaked_into_price', s.platform, count(*)::bigint,
         'price = area_m2 exactly and that figure is not a priced token in the capture'
  from public.search_listings_ar s
  join public.aqar_residential_listings a
    on a.id = s.listing_id and s.source_table = 'aqar_residential_listings'
  where s.area_m2 is not null and s.area_m2 > 1000
    and coalesce(s.price_total, s.price_annual) = s.area_m2
    and (regexp_match(split_part(a.source_capture->>'source_text','تفاصيل الإعلان',1),
                      '([0-9][0-9,]{2,})\s*[§﷼]'))[1] is null
  group by s.platform having count(*) > 0

  union all
  -- 4. PROPAGATION LOSS: the search index must carry exactly what the raw row holds. Anything else
  --    means a listing is priced differently in search than in the source of record.
  select 'index_price_differs_from_raw', 'aqar', count(*)::bigint,
         'search_listings_ar price_annual differs from aqar_residential_listings'
  from public.search_listings_ar s
  join public.aqar_residential_listings a on a.id = s.listing_id
  where s.source_table = 'aqar_residential_listings'
    and s.price_annual is distinct from a.price_annual
  having count(*) > 0

  union all
  -- 5. AREA PARSE INTEGRITY: stored area must equal the figure in aqar's own spec block. Anchored
  --    AFTER «تفاصيل الإعلان» so seller prose and plot numbers cannot masquerade as the area.
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

comment on function public.mon_price_size_fidelity_barrier() is
  'Price/size fidelity barrier (owner rule, 2026-08-10). Flags OUR fabrications only — a weird value '
  'the source really publishes is never a finding. Every row is a QUESTION to verify against source, '
  'never a licence to rewrite. Calibrated against three false-positive classes that fooled the audit '
  'itself: aqar printing a total inside its «سعر المتر» slot, «المساحة» appearing in seller prose and '
  'in «المساحة للقطعة رقم N», and aqar printing the pre-discount price before the current one.';