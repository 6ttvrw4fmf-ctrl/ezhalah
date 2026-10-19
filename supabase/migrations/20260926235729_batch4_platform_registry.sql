-- platform_registry rows for wave 3 batch 4. Each note records what was MEASURED, including the traps
-- that would have mis-onboarded the platform, so the next engineer does not rediscover them.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values
  ('dallali', 'active', 'source', 24, 7,
   'دلّالي (dallali.com) — a property-management SaaS storefront; the site is an empty SPA shell over an open '
   'JSON API (p1.dallali.com/listings/public). 7 listings. TRAP: the REGA licence describes the BUILDING '
   '(«مجمع», 3,658 m²) while the page headline is the UNIT being let («مكتب», 81.14 m², 178,508/yr) — type '
   'and area come from the unit. Land licence propertyPrice is PER m²; listings.price is the total. The '
   'licence names the responsible employee, his mobile and the deed number — never stored.'),
  ('muajarh', 'active', 'source', 24, 7,
   'مؤاجرة (muajarh.com) — Riyadh rentals; JSON API admin.muajarh.com/api/v1/properties. TRAP: 7 of the 18 '
   'feed rows are the platform''s own demo records («Store Review Demo Property …») — exactly the rows with no '
   'REGA licence, which are skipped. The site''s own city counter (7) counts ONLY the demos. Amenity dropdowns '
   'mix text labels with bare index numbers; only labels are read.'),
  ('mobasher', 'active', 'source', 24, 7,
   'مباشر (mobasher.sa) — DIRECT-SALE real estate only (owner 2026-09-25 «keep»); the auction feed is a '
   'separate endpoint and is never called. TRAP: type/area/usage are nested in searchableAttributes, not on '
   'the row. Land type from the structured usage list; 2 plots that are BOTH residential and commercial are '
   'held for an owner decision. The page''s propertyAge 0 is a form default (NULL).'),
  ('nafithh', 'active', 'source', 24, 7,
   'معرض نافذة (nafithh.sa) — server-rendered REGA blocks (Yii2). TRAPS: (1) for LAND «سعر الوحدة» is the '
   'METRE rate (ad 217: 7,900 × 1,902.5 = its own stated 15,029,750) and the page headline repeats it — stored '
   'as price_per_meter, never a total. (2) The site''s footer text is pasted inside ~7 ads'' prose; nothing '
   'cuts on it. (3) No card period: the ad''s own words decide (title «للايجار الشهري» on ad 178).'),
  ('opensooq', 'active', 'source', 24, 7,
   'السوق المفتوح (sa.opensooq.com) — real-estate vertical only (78). The SERP carries the whole vertical as '
   'inline JSON (__NEXT_DATA__). TRAPS: age chips are RANGES (only «0 - 11 شهر» is exact); 2 «قيد الإنشاء» '
   'skipped; 1 filed for sale but titled for rent skipped; the same office is sometimes posted twice (same '
   'licence + district + price + area → one row). Member name and masked phone never stored.')
on conflict (platform) do update
  set status = excluded.status, kind = excluded.kind,
      expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes;

do $verify$
declare n int;
begin
  select count(*) into n from public.platform_registry
   where platform in ('dallali','muajarh','mobasher','nafithh','opensooq') and status = 'active' and kind = 'source';
  if n <> 5 then
    raise exception 'expected 5 active source rows for wave-3 batch 4, found %', n;
  end if;
  raise notice 'wave-3 batch 4 is registered active+source';
end $verify$;