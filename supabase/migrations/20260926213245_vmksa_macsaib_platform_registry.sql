-- platform_registry rows for wave 3's second batch. Each note records what was MEASURED, including
-- the traps that would have mis-onboarded the platform, so the next engineer does not rediscover them.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values
  ('vmksa', 'active', 'source', 24, 7,
   'المسوق الافتراضي (vm-ksa.com). Next.js App Router; index /ar/ads?page=N declares its own '
   'pagination {total:163,lastPage:11}; a "stop at the first page with nothing new" walk found only '
   '120 because the order shifts mid-walk, so the scraper walks 1..lastPage and unions. Each ad page '
   'carries the REGA licence block as NAMED options (نوع العقار, غرض الاعلان, مساحة العقار, عمر العقار, '
   'واجهة العقار, عرض الشارع, الحي / كود الحي …). FOUR TRAPS: (1) RSC text rows are `<id>:T<hexlen>,` '
   'with NO newline, so a line reader never resolves "description":"$37" — rows are parsed '
   'sequentially over UTF-8 bytes. (2) The category name is a PLURAL nav bucket («مكاتب للبيع» held '
   'ads whose enum, licence purpose and «/شهري» price all say rent) — type comes from «نوع العقار», '
   'deal from the enum cross-checked against «غرض الاعلان». (3) For LAND the headline price is PER '
   'm² (ad 844: «SAR 1,550» on 600 m²); the licence states the total («أجمالي سعر بيع الأرض» 930,000), '
   'which is stored — never a product we compute. (4) PDPL: the block carries the ad officer''s name '
   'and mobile («مسؤول الاعلان», «رقم مسؤول الاعلان») and the deed number; none is stored. Measured '
   '2026-09-26: 163 ads → 160 rows (99 office rents), 2 skipped as «تحت الإنشاء», 1 «مجمع» unmapped. '
   'Weekly rents (2) carry no annual figure (no bucket), per normalize.rent_period_and_annual.'),
  ('macsaib', 'active', 'source', 24, 7,
   'مكسب العقارية (macsaib.sa), a Buraydah agency on the Taearif tenant platform. Data is Taearif''s '
   'public JSON: api.taearif.com/api/v1/tenant-website/macsaib.sa/properties (pagination.total 77, '
   'last_page 4; 48 sale + 29 rent; all `available`). TRAPS: (1) `property_type` is a USAGE class '
   '(«سكني»/«تجاري», null on 48) — the TYPE exists only as the category the agency filed it under, '
   'learned by walking category_ids= (the 20 categories partition the 77 exactly). (2) 71 of 77 print '
   'price "0" — stored NULL, never 0; two plots print «750» on ~570 m² and the page itself shows 750, '
   'so it is stored as published. (3) 72 records share one default pin (lat 24.766317 — Riyadh, for a '
   'Buraydah agency), so coordinates are stored only for specific addresses. (4) Location: only '
   'explicit statements count («حي X - بريدة», «مدينة بريدة», a bare-city address); «حي الخضر» would '
   'resolve to the TOWN الخضر (Makkah) and «حي البصر بريدة» is ambiguous (البصر is its own '
   'settlement) — 13 of 76 stay unlocated rather than guessed.')
on conflict (platform) do update
  set status = excluded.status, kind = excluded.kind,
      expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes;

do $verify$
declare n int;
begin
  select count(*) into n from public.platform_registry
   where platform in ('vmksa','macsaib') and status='active' and kind='source';
  if n <> 2 then
    raise exception 'expected 2 active source rows for vm-ksa and macsaib, found %', n;
  end if;
  raise notice 'vm-ksa and macsaib are registered active+source';
end $verify$;