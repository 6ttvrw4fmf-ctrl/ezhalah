-- 🦅 falcon 2026-11-06: price_fidelity() judges a land per-metre total by the RULE, not only by the flag.
--
-- alert_event 13118/13119 (price_drift, P2, open since 11-04 23:47): propertyfinder 23816559 and wasalt 16234339,
-- the same 268 m² plot in ريع اذاخر, مكة المكرمة. Source re-read run 42278365468: Property Finder's page publishes
-- salePrice 4999 with averageSalePricePerSqm 19, a per-metre figure typed into the total box. The index serves
-- 1,340,000 / 1,339,732 = figure × area, exactly what land_ppm_typed_as_total_served_ar() returns for the source row,
-- and the card shows the same ≈ total (src/lib/landPerMeterTotal.ts recognises the shape). Search and card are right.
-- The two rows carry ppm_typed_as_total = false: enforce_price_size_sanity() clears the flag on any UPDATE that
-- changes the price without the rule firing on the NEW figure, so a row written already-multiplied loses it, and
-- price_fidelity() exempted only flagged rows, so it called the owner's own rule «drift» for two days.
--
-- 1. price_fidelity(): a needle edit on the LIVE body (fails closed if the line moved): the exemption also holds
--    when the served total IS the rule's answer for the source figure.
-- 2. The flag is restored on exactly the rows where the served total equals the rule's answer (2 rows today).
--    Watched by mon_detect_price_fidelity (it re-raises price_drift if the served total and the rule ever part).
do $mig$
declare d text; n int;
  old_line constant text := 'and not (s.ppm_typed_as_total and s.price_total = x.src_total * s.area_m2))';
  new_line constant text := 'and not (s.price_total = x.src_total * s.area_m2'
    || ' and (s.ppm_typed_as_total or s.price_total = public.land_ppm_typed_as_total_served_ar('
    || 's.source_table, s.listing_id, x.src_total, s.area_m2, null::numeric, s.type_ar, s.city_ar, s.district_ar))))';
begin
  d := pg_get_functiondef('public.price_fidelity()'::regprocedure);
  n := (length(d) - length(replace(d, old_line, ''))) / length(old_line);
  if n <> 1 then
    raise exception 'price_fidelity(): expected the land-rule exemption line exactly once, found % — the live body moved', n;
  end if;
  execute replace(d, old_line, new_line);
end
$mig$;

update public.search_listings_ar s
   set ppm_typed_as_total = true
  from public.listing_native_location_v2 v
 where v.source_table = s.source_table and v.listing_id = s.listing_id
   and s.deal_ar = 'بيع'
   and not coalesce(s.ppm_typed_as_total, false)
   and v.price_total > 0 and v.price_total < 20000 and s.area_m2 >= 100
   and s.price_total = v.price_total * s.area_m2
   and s.price_total = public.land_ppm_typed_as_total_served_ar(s.source_table, s.listing_id, v.price_total, s.area_m2,
                                                                v.price_per_meter, s.type_ar, s.city_ar, s.district_ar);
