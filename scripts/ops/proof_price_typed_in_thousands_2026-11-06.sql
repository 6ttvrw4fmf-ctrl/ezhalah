-- LIVE PROOF — a price typed in thousands (owner 2026-11-06, option A). READ-ONLY: raises on the first failure.
-- Run it in the SQL editor (or the Supabase MCP execute_sql). Companion of scripts/verify-price-typed-in-thousands.ts.
do $proof$
declare r record; v numeric; n int;
begin
  -- 1. the real ads are served at figure × 1000, flagged, and the platform table still holds the site's figure
  for r in select * from (values
      ('asasmakeen_residential_listings', 24218839::bigint, 'price_annual', 75::numeric, 75000::numeric),   -- سنا مكين — حي القيروان
      ('haraj_residential_listings',      18706322,         'price_total',  750,          750000)          -- «السوم 750 ألف»
    ) t(tbl, id, col, src, served)
  loop
    execute format('select %I from public.search_listings_ar where source_table = $1 and listing_id = $2 and price_in_thousands', r.col)
       into v using r.tbl, r.id;
    if v is distinct from r.served then raise exception 'PROOF: %/% is served at %, expected %', r.tbl, r.id, v, r.served; end if;
    select (xpath('/row/p/text()', query_to_xml(format('select %I p from public.%I where id = %s', r.col, r.tbl, r.id), false, true, '')))[1]::text::numeric into v;
    if v is distinct from r.src then raise exception 'PROOF: the platform table %/% no longer holds the site figure % (has %)', r.tbl, r.id, r.src, v; end if;
  end loop;

  -- 2. the Asas Makeen unit is a YEARLY rent now (the silent-period judge read 75,000), so the yearly button shows it
  if not exists (select 1 from public.search_listings_ar where source_table = 'asasmakeen_residential_listings' and listing_id = 24218839
                  and rent_period_ar = 'سنوي') then raise exception 'PROOF: the Asas Makeen unit is not in the yearly pool'; end if;

  -- 3. real cheap land is untouched (الفوارة 13/m², the site's box agrees) and nothing it touched is double-read
  if not exists (select 1 from public.search_listings_ar where source_table = 'aqar_residential_listings' and listing_id = 6965212
                  and price_total between 15000 and 15100 and not price_in_thousands and not ppm_typed_as_total) then raise exception 'PROOF: الفوارة 13/m² was touched'; end if;
  if exists (select 1 from public.search_listings_ar where price_in_thousands and ppm_typed_as_total) then raise exception 'PROOF: a row carries both readings'; end if;

  -- 4. a customer's Riyadh yearly rent search 70k–80k finds the «75» unit
  select count(*) into n from public.location_search_candidates_ar(p_deal => 'إيجار', p_cities => array['الرياض'], p_rent_period => 'سنوي',
         p_price_min => 70000, p_price_max => 80000, p_platforms => array['asasmakeen'], p_limit => 500)
   where source_table = 'asasmakeen_residential_listings' and listing_id = 24218839;
  if n <> 1 then raise exception 'PROOF: the Riyadh 70k–80k yearly search does not find Asas Makeen 24218839'; end if;

  -- 5. no residue: no row the rule fires on is still served at its tiny figure
  select count(*) into n from public.search_listings_ar s
   where not s.price_in_thousands
     and ((s.deal_ar = 'بيع' and s.price_total > 0 and s.price_total < 20000) or (s.deal_ar = 'إيجار' and s.price_annual > 0 and s.price_annual < 300))
     and public.price_in_thousands_served_ar(s.source_table, s.listing_id, s.deal_ar,
           case when s.deal_ar = 'إيجار' then s.price_annual else s.price_total end,
           s.area_m2, s.price_per_meter, s.type_ar, s.city_ar, s.district_ar, s.platform) is not null;
  if n <> 0 then raise exception 'PROOF: % rows still match the rule unrepaired', n; end if;

  raise notice 'LIVE PROOF OK: Asas Makeen 75 → 75,000 yearly, haraj «750 ألف» → 750,000 (platform tables untouched), الفوارة untouched, the 70k–80k Riyadh search finds the unit, no residue';
end
$proof$;
