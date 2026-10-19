-- Wave 1's ten join platform_registry, and the five that publish a property age join
-- age_source_registry. Liveness was reseeded in 20260925170134 (all three mirror arms at once).
--
-- PLATFORM REGISTRY. `notes` records the removal oracle each one MEASURED, because not one of the ten
-- can use "is it 200?": every one either keeps serving a de-listed listing, or serves a soft-404 shell
-- for ids that never existed, or both. The full evidence per platform is in
-- scrapers/common/liveness_policies.py; the note here is what an operator reads at 3am.
--
-- AGE. age_source_registry is the ONLY route by which an age reaches the Advanced Filter:
-- listing_native_location_v2 takes property_age from listing_age_resolved, which
-- rebuild_age_producer() (pg_cron 46, hourly at :44) regenerates from THIS registry alone, so an arm
-- without a row here is wiped within the hour (the akariyoun lesson, 20260919014424). Only the FIVE
-- platforms whose parser actually writes property_age are registered — alsaedan, nofodh, razre, safa
-- and sokok publish no age at all, and registering them would claim a column they never fill.
insert into public.platform_registry (platform, status, expected_cadence_hours, window_days, notes, kind, updated_at)
values
  ('alsaedan','active',24,7,
   'آل سعيدان (alsaedan.com). 332 available units of 2,374 cards. *** NOT A STATUS CODE *** an unavailable unit STOPS HAVING A PAGE: /sales/unit/<id> answers 302 to its PROJECT page, which then answers 200, so an "is it 200?" oracle following redirects calls every sold unit alive forever. The oracle is the PATH CHANGE: 302 to another path → gone (14/14), 404 → gone (3/3), 200 on the unit''s own path with its own aup-h1 block → live (6/6). PUBLISHES NO PRICE on any unit and NO REGA ad licence on any of its 332 pages — both are commercial/compliance conversations, not scraper bugs.',
   'source', now()),
  ('ego','active',24,7,
   'إيجو عقار (ego-aqar.com; API egoagar-backend.com). 33 live listings — the onboarding brief said ~5,415, which is a LIFETIME count: the unfiltered cursor walk exhausts at 33, adType sell+rent gives 23+10, and 54 city/type filter walks surface nothing outside them. *** THE WEB URL IS NOT AN ORACLE *** /unit-details/<anything> serves the same shell with 200 (verified on fabricated 999999). API: 200 with data.id == the id → live (33/33), 409 «This unit is inactive» → gone (40/40), 404 → gone. Id 2415 publishes price 42949672.95 — exactly the unsigned 32-bit ceiling in halalas — while its own REGA block says 656250000; the RENDERED PAGE SHOWS 42,949,672.95, so that is what is stored, with the disagreement flagged in additional_info rather than repaired.',
   'source', now()),
  ('muhaysini','active',24,7,
   'أحمد المحيسني العقارية (aqaralmuhaysini.com; API backend.aqaralmuhaysini.com). 2,827 live of ids 10-4,071. *** THE LISTING PAGE IS WORTHLESS AS AN ORACLE *** client-rendered SPA: /propertydetails/<id>, /robots.txt and /anything-at-all all return the SAME 200 with the same 3,399-byte shell. The oracle is the API record the page itself loads: HTTP 400 with error_number 229 «لم يتم العثور على العقار» → gone (17/17 incl. fabricated 0 / 4,200 / 999,999), 200 with property.id == the id → live. Three rows call THEMSELVES under construction in their own prose while the platform publishes them as ordinary available sales with full REGA licences (3220, 3697, 2231) — an owner question, and a prose regex measured 3 of 9 is not a substitute for a construction-stage field.',
   'source', now()),
  ('nofodh','active',24,7,
   'نفوذ للاستثمار العقاري (nofodh.sa). 2,556 mapped of 2,601. *** A 200 IS NOT PROOF OF LIFE *** a SOLD unit KEEPS its page: id 531729 answers 200 with full content, «حالة العقار: مباع», and its «السعر» row simply gone. The oracle is the state the page prints about itself, from the platform''s OWN «حالة البيع» enum read off its filter checkboxes: real 404 → gone (7/7, identical 23,648-byte page, no soft-404 shell exists), 200 + للبيع/للإيجار → live, 200 + مباع/مؤجر/محجوز/مدفوع → gone. 734 of the 2,556 carry NO price because the source prints «السعر 0» — stored priceless rather than dropped, and whether search should rank, filter or badge a priceless row is an owner decision affecting nearly a third of this platform.',
   'source', now()),
  ('razre','active',24,7,
   'راز العقارية (razre.sa). 57 mapped of 924 unit records — the rest are not available units. Sale-side developer: the parser never emits a Rent row. ROW GRAIN IS THE UNIT, listing_url IS THE PROJECT PAGE (the azure/rightcompound shape), read back from the row''s own stored url because the _id alone does not name the project. Oracle: 404/410 on the project page → gone (4/4 fabricated, 0 of 35 real), unit present with «متاح» → live, present with «مباع»/«محجوز» → gone. HAVEN 1 names no city anywhere, so its 22 available units are held back as city_unstated — one field from the developer recovers all 22.',
   'source', now()),
  ('reinvest','active',24,7,
   'ري إنفست (reinvest.sa; API api.reinvest.sa). 782 mapped of 814. Oracle is the detail API, which states removal in words: 404 «هذا الاعلان لم يعد متوفر» or «لم يتم العثور على البيانات» → gone (4/4 ads that left mid-capture, 16/16 never-existed slugs), 200 with a data object → live (20/20), 200 WITHOUT one → UNKNOWN (an unmeasured shape says nothing). Verdict comes from the STATUS, the message is only recorded, so a third message could never turn a 404 into a life. REFUSES to write price_per_meter: selling_meter_price equals floor(price / int(total_area)) on 813/813, i.e. the platform''s own quotient, not a published rate.',
   'source', now()),
  ('safa','active',24,7,
   'صفا للاستثمار (safainv.sa). 41 mapped of 162 cards. *** THE SHEET ENDPOINT IS NOT AN ORACLE *** /unit/details answers 200 with a complete sheet for units the site publishes nowhere (12828, a SOLD SF050 unit at 762,000, plus 12236/12237/13208/14149/19222), so "the sheet still loads" would resurrect sold inventory forever. The oracle is the SURFACE''S OWN ROSTER: a DIRECT walk of every page of the list named by the row''s stored listing_url — card present → live, card absent with the whole surface walked → gone, any page non-200 or empty body → UNKNOWN. An id the ERP never held answers HTTP 500, and a 5xx can never kill a row anyway. 3 real, priced, ready flats are lost to type_missing; the unit code''s -APT/-VIL/-DPX suffix would recover them, which is an owner decision, not a guess.',
   'source', now()),
  ('sokok','active',24,7,
   'صكوك العقارية (sokok.sa). 398 «متاحة» pieces of 3,824. Sale-side developer of its own subdivided land: the parser never emits a Rent row. Oracle is the status the detail page prints about ITSELF, which agreed with the list endpoint on all five statuses measured: 404 → gone (99999 and 999999999, while id 1 is a REAL piece and answers 200 — which is what proves the 404 is about the id, not the route), 200 + «متاحة» → live, 200 + مباعة/محجوزة/قريباً/موقفة من الشركة → gone, 200 with no status → UNKNOWN. STORES BOTH published figures verbatim (price and meter_price) after proving neither derives from the other: price == meter_price × area on 0/280 and price ÷ area == meter_price on 0/280. Plot 18''s 3 available pieces carry license_number 0 and are held out on the REGA requirement — an owner decision.',
   'source', now()),
  ('sukna','active',24,7,
   'سكنة (suknamdn.sa → sukna.app). 290 mapped of 597. Sale-side: the parser never emits a Rent row. *** THE RENDERED PAGE CANNOT BE THE ORACLE *** sukna.app/unit-details?id=<anything> answers 200 with the full app shell (fabricated 0 and 999999 both did) because the route is client-rendered — a soft-404 that would resurrect every dead row forever. API: 404 «resource not found» → gone, 200 + case == 2 → gone (the source''s own «مباعة», and absent from its own sitemap on 227/227), 200 + case in (0,1) → live, no readable case → UNKNOWN. Note id 1 answers HTTP 500 on a null property — a missing record, not a death. Stores «سعر الوحدة» (the page''s own schema.org offers.price); the site''s CARDS show a VAT-inclusive total_amount that is stale on 149 rows and LOWER than the unit price alone on 17, so card parity with the source is an explicit owner decision, not something to derive.',
   'source', now()),
  ('tuba','active',24,7,
   'طوبة العقارية (tuba.com.sa). 4,417 mapped of 4,424 — the largest of wave 1. *** A DE-LISTED AD KEEPS ITS PAGE AND ANSWERS 200 WITH FULL CONTENT *** so "is it 200?" retires nothing and "200 means live" resurrects the dead. The oracle is a banner the page prints about itself: «هذا العقار لم يعد متاحًا.» with «منتهي الصلاحية» → gone; 200 with the banner absent → live. Built with NO fabricated ids (the slug is not derivable): 55 gap slugs from the platform''s own sequential families answered 200 + banner, 55/55, against 40/40 interleaved live controls with the banner absent. REFUSES land_total_price, which equals property_price × property_area exactly on 69/71 — the platform''s own arithmetic, so the total stays UNKNOWN. bedrooms is NULL on ALL 4,424 rows: the source labels a 3,000 m² office as having 150 «غرف النوم», so its room count is not a bedroom count — an owner decision, and the column stays honestly empty until it is taken.',
   'source', now())
on conflict (platform) do update
  set status = excluded.status, expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes, kind = excluded.kind,
      updated_at = now();

insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
select t, 'canonical_column', true,
       'TRUSTED 2026-09-25 (wave 1): the source''s own age field through the shared normalize.parse_property_age(); an open bound stays NULL rather than becoming its floor. Only the five wave-1 platforms whose parser actually writes property_age are registered — alsaedan, nofodh, razre, safa and sokok publish no age at all.',
       now()
from unnest(array[
  'ego_residential_listings','ego_commercial_listings',
  'muhaysini_residential_listings','muhaysini_commercial_listings',
  'reinvest_residential_listings','reinvest_commercial_listings',
  'sukna_residential_listings','sukna_commercial_listings',
  'tuba_residential_listings','tuba_commercial_listings']) t
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted, note = excluded.note, updated_at = now();

DO $verify$
DECLARE n int; m int;
BEGIN
  SELECT count(*) INTO n FROM public.platform_registry
   WHERE platform IN ('alsaedan','ego','muhaysini','nofodh','razre','reinvest','safa','sokok','sukna','tuba')
     AND status = 'active' AND kind = 'source' AND coalesce(btrim(notes),'') <> '';
  IF n <> 10 THEN RAISE EXCEPTION 'expected 10 wave-1 platform_registry rows with notes, found %', n; END IF;
  SELECT count(*) INTO m FROM public.age_source_registry
   WHERE source_table ~ '^(ego|muhaysini|reinvest|sukna|tuba)_(residential|commercial)_listings$' AND trusted;
  IF m <> 10 THEN RAISE EXCEPTION 'expected 10 wave-1 age_source_registry rows, found %', m; END IF;
  IF EXISTS (SELECT 1 FROM public.age_source_registry
              WHERE source_table ~ '^(alsaedan|nofodh|razre|safa|sokok)_') THEN
    RAISE EXCEPTION 'a platform that publishes no age was registered as an age source';
  END IF;
  RAISE NOTICE 'wave-1: 10 platform_registry rows, 10 age sources, 0 false age claims';
END $verify$;
