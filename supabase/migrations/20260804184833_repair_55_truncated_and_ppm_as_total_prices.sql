-- 2026-08-04 — repair 55 Buy prices proven NOT to match what the source displays.
-- Owner rule: we copy what the platform shows. These 55 did not; each new value below was read
-- from the source by the auditor AND independently re-fetched before writing (48/48 aqar pages
-- agreed to the digit; the 7 wasalt values come from the captured payload's own
-- propertyInfo.salePrice, verified in-database).
--
-- CLASS A — aqar (48): the `backfill.v1` capture path ate the thousands separator
--   («المطلوب 520.000 ريال» → 520) and, on some land ads, stored سعر المتر as the total.
--   Their price_per_meter was then re-derived from the already-broken total (46 of 48 hold an
--   absurd 0–9), so it is nulled rather than replaced — an honest null, never a fabricated rate;
--   the next crawl repopulates it from the source if the source publishes one.
--   Two rows' pages display sub-riyal decimals (174857 «2,921,568.1», 185813 «520,041.38»);
--   the raw column is bigint, so they store the integer — identical under truncation or rounding.
-- CLASS B — wasalt (7): all أرض سكنية; price_total held propertyInfo.averageSalePricePerSqm
--   instead of propertyInfo.salePrice. Repaired to salePrice, with the source's own per-sqm
--   figure moved into price_per_meter where it belongs.
-- Every UPDATE is guarded by the current wrong value → idempotent, cannot clobber a re-crawl.

-- ── CLASS A: aqar raw ────────────────────────────────────────────────────────────────────────
with fix(id, old_v, new_v) as (values
  (59747,4,1890000),(171395,40,41760),(162278,50,980000),(55341,50,1050000),(174857,85,2921568),
  (174663,150,455000),(91061,150,1150000),(55522,190,1080000),(174681,200,1200000),(90426,200,855000),
  (76087,200,550000),(55354,200,1200000),(90921,250,2250000),(55345,250,1250000),(86899,300,6300000),
  (61131,350,1640664),(167962,400,200000),(55276,400,1400000),(79604,420,510000),(74901,440,440000),
  (92218,450,1500000),(60630,450,450000),(55421,450,1300000),(91045,500,1800000),(90706,500,2500000),
  (90180,500,2300000),(88660,500,1500000),(60288,500,34500000),(185813,520,520041),(168964,550,225000),
  (54740,550,1550000),(2107699,560,398000),(84148,635,635000),(55006,639,639000),(172481,650,650000),
  (90474,650,3900000),(83612,660,660000),(84020,700,700000),(55149,740,740000),(92431,770,770000),
  (90709,800,1850000),(81572,800,1800000),(54884,839,839000),(4097256,850,800000),(70773,850,850000),
  (185065,880,880200),(165144,900,900000),(88120,900,8900000))
update aqar_residential_listings t
   set price_total = f.new_v,
       price_per_meter = null
  from fix f
 where t.id = f.id and t.price_total = f.old_v;

-- ── CLASS B: wasalt raw ──────────────────────────────────────────────────────────────────────
with fix(id, old_v, new_total, src_ppm) as (values
  (442835,136,40188,136),(442836,113,68000,113),(442996,535,206071,535),(444044,468,300000,469),
  (444358,525,300300,525),(2407204,450,473760,450),(4076834,358,250600,358))
update wasalt_residential_listings t
   set price_total = f.new_total,
       price_per_meter = f.src_ppm
  from fix f
 where t.id = f.id and t.price_total = f.old_v;

-- ── canonical search surface: same values, same guards ───────────────────────────────────────
with fix(id, old_v, new_v) as (values
  (59747,4,1890000),(171395,40,41760),(162278,50,980000),(55341,50,1050000),(174857,85,2921568),
  (174663,150,455000),(91061,150,1150000),(55522,190,1080000),(174681,200,1200000),(90426,200,855000),
  (76087,200,550000),(55354,200,1200000),(90921,250,2250000),(55345,250,1250000),(86899,300,6300000),
  (61131,350,1640664),(167962,400,200000),(55276,400,1400000),(79604,420,510000),(74901,440,440000),
  (92218,450,1500000),(60630,450,450000),(55421,450,1300000),(91045,500,1800000),(90706,500,2500000),
  (90180,500,2300000),(88660,500,1500000),(60288,500,34500000),(185813,520,520041),(168964,550,225000),
  (54740,550,1550000),(2107699,560,398000),(84148,635,635000),(55006,639,639000),(172481,650,650000),
  (90474,650,3900000),(83612,660,660000),(84020,700,700000),(55149,740,740000),(92431,770,770000),
  (90709,800,1850000),(81572,800,1800000),(54884,839,839000),(4097256,850,800000),(70773,850,850000),
  (185065,880,880200),(165144,900,900000),(88120,900,8900000))
update search_listings_ar s
   set price_total = f.new_v
  from fix f
 where s.source_table = 'aqar_residential_listings' and s.listing_id = f.id
   and s.price_total = f.old_v;

with fix(id, old_v, new_total) as (values
  (442835,136,40188),(442836,113,68000),(442996,535,206071),(444044,468,300000),
  (444358,525,300300),(2407204,450,473760),(4076834,358,250600))
update search_listings_ar s
   set price_total = f.new_total
  from fix f
 where s.source_table = 'wasalt_residential_listings' and s.listing_id = f.id
   and s.price_total = f.old_v;