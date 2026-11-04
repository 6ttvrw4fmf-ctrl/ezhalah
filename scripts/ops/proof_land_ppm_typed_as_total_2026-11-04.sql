-- LIVE PROOF — land per-metre price typed into the total box (owner 2026-11-04). READ-ONLY: raises on the first failure.
-- Run it in the SQL editor (or the Supabase MCP execute_sql). Companion of scripts/verify-land-ppm-typed-as-total.ts.
do $proof$
declare r record; v numeric; n int;
begin
  -- 1. the five real plots are served at figure × area, flagged, and the platform table still holds the seller's figure
  for r in select * from (values
      ('abwbna_residential_listings',    10777645::bigint, 1700::numeric, 637500::numeric),
      ('abralosol_residential_listings', 10301815, 1700,  595000),
      ('alshawaf_commercial_listings',   12605926, 2400, 1468800),
      ('haraj_residential_listings',     22803608, 3400, 5950000),
      ('ksaaqar_residential_listings',   12225790, 9000, 20610000)) t(tbl, id, src, served)
  loop
    select s.price_total into v from public.search_listings_ar s
     where s.source_table = r.tbl and s.listing_id = r.id and s.ppm_typed_as_total and s.price_per_meter = r.src;
    if v is distinct from r.served then raise exception 'PROOF: %/% is served at %, expected %', r.tbl, r.id, v, r.served; end if;
    select (xpath('/row/p/text()', query_to_xml(format('select price_total p from public.%I where id = %s', r.tbl, r.id), false, true, '')))[1]::text::numeric into v;
    if v is distinct from r.src then raise exception 'PROOF: the platform table %/% no longer holds the source figure % (has %)', r.tbl, r.id, r.src, v; end if;
  end loop;

  -- 2. real cheap land and a real big-plot rent are untouched and not on the review list
  if not exists (select 1 from public.search_listings_ar where source_table = 'aqar_residential_listings' and listing_id = 6965212
                  and price_total = 15055 and not ppm_typed_as_total) then raise exception 'PROOF: الفوارة 13/m² was touched'; end if;
  if not exists (select 1 from public.search_listings_ar where source_table = 'aqar_residential_listings' and listing_id = 20793334
                  and price_annual = 25200 and not ppm_typed_as_total) then raise exception 'PROOF: ثادق 72,000 m² rent was touched'; end if;
  if exists (select 1 from public.land_price_unit_review_ar where listing_id in (6965212, 20793334) and source_table = 'aqar_residential_listings')
    then raise exception 'PROOF: real cheap land is on the review list'; end if;

  -- 3. the Makkah 185/yr plot is flagged for review, never auto-derived
  if not exists (select 1 from public.land_price_unit_review_ar where source_table = 'muktamel_residential_listings' and listing_id = 10306910
                  and reason = 'rent_tiny_for_plot') then raise exception 'PROOF: the Makkah 185/yr row is not on the review list'; end if;
  if exists (select 1 from public.search_listings_ar where source_table = 'muktamel_residential_listings' and listing_id = 10306910 and price_annual <> 185)
    then raise exception 'PROOF: the Makkah rent was changed'; end if;

  -- 4. a customer's land Buy search in الأحساء with a 500k–700k budget finds the abwbna plot
  select count(*) into n from public.location_search_candidates_ar(p_deal => 'بيع', p_cities => array['الاحساء'],
         p_types => array['أرض سكنية', 'أرض'], p_price_min => 500000, p_price_max => 700000, p_limit => 5000)
   where source_table = 'abwbna_residential_listings' and listing_id = 10777645;
  if n <> 1 then raise exception 'PROOF: the 500k–700k الأحساء land search does not find abwbna 10777645'; end if;

  -- 5. the guard has no residue: no row the rule fires on is still unrepaired
  select count(*) into n from public.search_listings_ar s
   where s.deal_ar = 'بيع' and not s.ppm_typed_as_total and s.type_ar like 'أرض%' and s.price_total > 0 and s.price_total < 20000 and s.area_m2 >= 100
     and public.land_ppm_typed_as_total_served_ar(s.source_table, s.listing_id, s.price_total, s.area_m2, s.price_per_meter, s.type_ar, s.city_ar, s.district_ar) is not null;
  if n <> 0 then raise exception 'PROOF: % rows still match the rule unrepaired', n; end if;

  raise notice 'LIVE PROOF OK: 5 plots served × area (source untouched), الفوارة + ثادق untouched, Makkah 185/yr on review, the 500k–700k الأحساء search finds the plot, no residue';
end
$proof$;
