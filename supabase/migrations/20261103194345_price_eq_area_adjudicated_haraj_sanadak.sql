-- price_eq_area_or_ppm, the rows price_read_from_source_total() cannot clear, adjudicated from what we already store.
--
-- haraj 18362394 — OUR parse error, repaired. The seller wrote «عرض حصري استراحة مجهزة للبيع 5الف بالرحمانية الخرج»
-- over a body that says «المساحة الكلية: 5,000 متر مربع» and «للتعرف على التفاصيل، السعر … لا تتردد في التواصل»: 5الف is
-- the size and the price is on contact. scrapers/haraj/prose.py:asking_price() read the bare «للبيع 5الف» as a
-- 5,000 SAR price (price_evidence.raw = «للبيع 5الف بالرحمانيه»). Fixed in the parser in the same change (a bare
-- «للبيع/ب» figure equal to the post's own stated area is not a price). The honest value is NULL — «السعر عند الطلب».
--
-- sanadak 14741450 — SOURCE-REAL, recorded. The stored sanadak API record publishes price = 291424.5 and
-- lotSize = 291424.5 for the same listing (adNumber 9190): the source's own number coinciding with its own area.
update public.haraj_residential_listings
   set price_total = null
 where id = 18362394 and price_total = 5000 and area_m2 = 5000
   and source_capture->'price_evidence'->>'raw' = 'للبيع 5الف بالرحمانيه';

insert into public.ops_price_eq_area_verified (source_table, listing_id, evidence, verified_price_total, verified_area_m2)
select 'sanadak_residential_listings', 14741450,
       'Data fidelity 2026-11-03 (alert price_eq_area_or_ppm). SOURCE-REAL: the stored sanadak API record of '
       || 'https://sanadak.sa/property-details/أرض-للبيع-في-دوبح-دوبح-7100326473 (adNumber 9190) publishes price = 291424.5 '
       || 'and lotSize = 291424.5. Both figures are the source''s; Ezhalah did not create the coincidence (PRICE = SOURCE).',
       291424, 291424
where exists (select 1 from public.sanadak_residential_listings
               where id = 14741450 and price_total = 291424 and area_m2 = 291424
                 and (source_capture->>'price')::numeric = 291424.5
                 and (source_capture->>'lotSize')::numeric = 291424.5)
on conflict (source_table, listing_id) do nothing;
