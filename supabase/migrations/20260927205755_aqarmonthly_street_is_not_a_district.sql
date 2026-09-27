-- Aqar's own empty «حي» label put the word "street" in the district — «حي شارع ابن هلال».
--
-- What a user saw. AQM6148228 is an ad in حي الرمال — Aqar's own `address` field says so — and both
-- its card district and its indexed district read «حي شارع ابن هلال», the word "street". Searching
-- إيجار → شهري → الرياض → حي الرمال therefore returns a card that disagrees with the search that
-- found it. Measured with the anon key 2026-09-27: 34 active rows (plus 2 inactive) carry a STREET
-- as their district; on 2 of them the district is the bare word «حي شارع». Found while fixing the
-- card's glued district (PR #4995) — this is an older, separate defect in the same capture.
-- Owner, 2026-09-27: «then if it is in حي الرمال, the card should say: حي الرمال».
--
-- Root cause, in the shared parser. Aqar builds the URI slug by joining its own address segments
-- with «-», and the FIRST segment is the district-TYPE label «حي» carrying NO value whenever the ad
-- names only a street:
--     address  «حي ، شارع ابن هلال الفلالي ، حي الرمال ، الرياض ، منطقة الرياض»
--     slug     «حي-شارع-ابن-هلال-الفلالي-حي-الرمال-الرياض-منطقة-الرياض-6148228»
-- `resolve_slug()` (scrapers/common/arabic_location.py) took the FIRST «حي» in the slug, so it
-- captured the street and ignored the real district named LATER in the same slug. Fixed forward in
-- the same PR: a capture that OPENS with a street marker (شارع/طريق/ممر — «مخطط» deliberately NOT
-- among them, because «حي مخطط المحمدية» is a real district on 313 aqar rows) is skipped and the
-- next «حي …» is read; the capture is a zero-width lookahead so a skipped 3-token window cannot eat
-- the district's own «حي» («حي شارع النرجس حي الصحافة …»). Pinned by 8 executed regression cases in
-- scrapers/common/tests/test_aqarmonthly_resolve_slug_district_suffix.py, all of which fail on the
-- pre-fix parser. This is NOT the defect PR #4995 fixed (that was the card column disagreeing with
-- the index); both columns agreed here, and both were the street.
--
-- Why this repair is not an invention. Every value below is what the FIXED parser returns from that
-- row's OWN slug, cross-checked against that row's OWN `address` field, which names the district
-- independently. Measured over all 1,801 active rows by running the real resolve_slug() before and
-- after: exactly these rows change, no city_id moves, and no other district is touched. AQM5728162
-- goes to NULL, not to a guess: its only «حي» is the empty label, no later «حي» exists, and its
-- address repeats the city where the district segment would be, so the catalog-validated address
-- fallback cannot confirm anything either — an honest NULL, per exact-location-only.
--
-- Both columns move together. `district_ar` feeds listing_native_location_v1 → search_listings_ar;
-- `neighborhood` is what ResultCard renders verbatim for an Arabic-raw platform (owner 2026-07-06).
-- Repair 20260927201934 made them one value; writing only one here would re-open that drift and
-- trip mon_detect_aqarmonthly_card_district_drift().
do $mig$
declare
  n_fix int;
  n_missing int;
  n_left int;
  n_drift int;
begin
  create temp table _street_district_repair (ad_number text primary key, district text) on commit drop;
  insert into _street_district_repair (ad_number, district) values
  ('AQM4236097', 'حي الدويخلة'),   -- was «حي شارع خالد بن»
  ('AQM4316859', 'حي الدويخلة'),   -- was «حي شارع خالد بن»
  ('AQM5008762', 'حي الصحافة'),   -- was «حي شارع الامير عبدالله»
  ('AQM5725850', 'حي الرمال'),   -- was «حي شارع عبدالفتاح راوه»
  ('AQM5728162', null::text),   -- was «حي شارع ابي الفتوح»
  ('AQM5728855', 'حي أم العراد'),   -- was «حي شارع ابراهيم البلالي»
  ('AQM5733444', 'حي الروابي'),   -- was «حي شارع زامل بن»
  ('AQM5733447', 'حي الروابي'),   -- was «حي شارع زامل بن»
  ('AQM5781411', 'حي المطل'),   -- was «حي شارع»
  ('AQM5794637', 'حي ظهرة لبن'),   -- was «حي شارع جبل الخال»
  ('AQM5794851', 'حي الصحافة'),   -- was «حي شارع محمد بن»
  ('AQM5813546', 'حي الصحافة'),   -- was «حي شارع النرجس حي»
  ('AQM5839371', 'حي النسيم الغربي'),   -- was «حي شارع جبل اجا»
  ('AQM5846610', 'حي العقيق'),   -- was «حي شارع الانتصار حي»
  ('AQM5855667', 'حي الزمرد'),   -- was «حي شارع علي بن»
  ('AQM5877160', 'حي الملك عبدالله'),   -- was «حي شارع العلمين حي»
  ('AQM6024705', 'حي الزهراء'),   -- was «حي شارع عبدالعزيز الخريجي»
  ('AQM6096079', 'حي الرمال'),   -- was «حي شارع حمزة بن»
  ('AQM6100200', 'حي الرمال'),   -- was «حي شارع حمزة بن»
  ('AQM6131957', 'حي أبحر الشمالية'),   -- was «حي شارع عابر القرات»
  ('AQM6133670', 'حي الرمال'),   -- was «حي شارع احمد بن»
  ('AQM6145620', 'حي جبره'),   -- was «حي شارع عبدالرحمن الافريقي»
  ('AQM6148228', 'حي الرمال'),   -- was «حي شارع ابن هلال»
  ('AQM6158953', 'حي الجزيرة'),   -- was «حي شارع سعيد بن»
  ('AQM6169884', 'حي الجزيرة'),   -- was «حي شارع سعيد بن»
  ('AQM6174378', 'حي السلامة'),   -- was «حي شارع الجسور حي»
  ('AQM6178318', 'حي الاندلس'),   -- was «حي شارع الشعاع حي»
  ('AQM6183028', 'حي حطين'),   -- was «حي شارع شقراء حي»
  ('AQM6201345', 'حي العقيق'),   -- was «حي شارع البحر المتوسط»
  ('AQM6212944', 'حي الغدير'),   -- was «حي شارع محمد المقدمي»
  ('AQM6240594', 'حي الشاطئ'),   -- was «حي شارع الامير فيصل»
  ('AQM6288645', 'حي مدينة العمال'),   -- was «حي شارع السادس عشر»
  ('AQM6384499', 'حي السلامة'),   -- was «حي شارع علي افندي»
  ('AQM6615673', 'حي العونية'),   -- was «حي شارع طلحة بن»
  ('AQM6693889', 'حي العونية'),   -- was «حي شارع طلحة بن»
  ('AQM6769574', 'حي العرين')   -- was «حي شارع»
  ;

  -- FAIL CLOSED on a stale list: every ad_number named here must still exist AND still be dirty. A
  -- typo, or a row already re-scraped clean, must stop the migration rather than silently no-op.
  select count(*) into n_missing
    from _street_district_repair r
   where not exists (
     select 1 from public.aqarmonthly_residential_listings t
      where t.ad_number = r.ad_number
        and t.district_ar ~ '^حي (شارع|طريق|ممر)');
  if n_missing > 0 then
    raise exception 'street-district repair list is stale: % of % rows are absent or already clean',
      n_missing, (select count(*) from _street_district_repair);
  end if;

  -- The guard on district_ar is the safety gate: this statement can only ever touch a row whose
  -- stored district still starts with a street marker.
  update public.aqarmonthly_residential_listings t
     set district_ar  = r.district,
         neighborhood = r.district
    from _street_district_repair r
   where t.ad_number = r.ad_number
     and t.district_ar ~ '^حي (شارع|طريق|ممر)';
  get diagnostics n_fix = row_count;

  raise notice 'aqarmonthly street-district repair: % rows realigned (of % listed)',
    n_fix, (select count(*) from _street_district_repair);

  select count(*) into n_left
    from public.aqarmonthly_residential_listings
   where district_ar ~ '^حي (شارع|طريق|ممر)' or neighborhood ~ '^حي (شارع|طريق|ممر)';
  if n_left > 0 then
    raise exception 'aqarmonthly still stores % district(s) that are a street', n_left;
  end if;

  select count(*) into n_drift
    from public.aqarmonthly_residential_listings
   where neighborhood is distinct from district_ar;
  if n_drift > 0 then
    raise exception 'card district drifted from the indexed district on % row(s) — repair 20260927201934''s invariant', n_drift;
  end if;
end $mig$;
