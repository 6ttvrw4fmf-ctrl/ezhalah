-- Wave 2's four join platform_registry. Liveness was reseeded in 20260926 above (all three mirror
-- arms at once). AGE: none of the four publishes a property-age field measured, so none joins
-- age_source_registry — registering one would claim a column it never fills.
insert into public.platform_registry (platform, status, expected_cadence_hours, window_days, notes, kind, updated_at)
values
  ('ibaax','active',24,7,
   'iBaax (ibaax.sa; API api.ibaax.sa). 160 mapped (150 residential + 10 commercial), zero skipped. *** THE FLEET-DEFAULT Accept-Language HEADER BREAKS THIS PLATFORM *** ar,en flips the entire feature vocabulary this mapper keys on to Arabic; en,ar;q=0.5 is required or the type mapper sees the wrong language and skips 100% of rows. Removal oracle is the detail endpoint''s OWN status code: 200 = live, 422 = gone (40/40 gap ids, 0 counter-examples). listing_url = https://ibaax.sa/ar/advertisements/<id> — a REAL rendered per-listing page, found in the compiled Nuxt router and confirmed live in a browser (a curl fetch cannot tell it from a fabricated id; both return the identical pre-hydration shell). Land carries a source-published per-metre rate that must never be multiplied into a total.',
   'source', now()),
  ('remaxsa','active',24,7,
   'RE/MAX Saudi (remax.sa; global Azure Cognitive Search backend, TenantId=6 scoped to MacroRegionId=113). 7 real listings (6 Apartment + 1 Villa) of 21 in the source''s own index — 14 carry a structured Off-Plan status and are excluded. 0 Rent listings live for this tenant/region today. *** A PLAIN GET OF ANY DETAIL URL RETURNS THE IDENTICAL 2,589-BYTE SHELL *** live, sold or fabricated — there is no page body to read a signal from, so the oracle re-queries the listing''s own index record by exact MLSID. RentalPriceGranularityUID is a direct structured period field, no prose parsing. HidePricePublic is the source''s own statement of price absence.',
   'source', now()),
  ('qmra','active',24,7,
   'Qmra (qmra.sa; WordPress REST, wp-json/wp/v2/property). 6 ready units (4 Floor + 2 Apartment) of 19 posts — 13 correctly excluded (8 sold, 3 under-construction, 1 rented, 1 presale), gated on the site''s own property-status taxonomy term, never a title/description regex. *** A SOLD-OUT UNIT KEEPS SERVING 200 FOREVER *** its status term just changes underneath it (measured live on 3 units that sold mid-session). No price field exists anywhere on this source — it is a "reserve your interest" developer form, not a priced listing; price_total/annual/per_meter stay unset. A photo-misattribution defect was caught and fixed: two ready units'' pages inline a DIFFERENT post''s photos via a stale post_parent, corrected by verifying true ownership before keeping a media id.',
   'source', now()),
  ('alajlan','active',24,7,
   'Al Ajlan Real Estate (alajlan-re.com; data at /data/projects.json, fetched client-side). 11 active listings (10 rent + 1 investment resort) of 13 total across all 3 categories (تأجير/استثمار/بيع) — 3 status:false rows correctly excluded. *** NO PER-LISTING URL EXISTS ON THIS SITE AT ALL — CONFIRMED EXHAUSTIVELY, NOT ASSUMED *** every "view details" control is a same-page Bootstrap accordion (checked: no URL/hash change, no query-param or hash route anywhere in the compiled bundle). Owner-approved 2026-09-26: every row''s listing_url is the bare homepage (https://alajlan-re.com/), deliberately — a constructed #fragment/?id= the site does not read would look like a real deep link and silently fail, which is worse than an honest shared URL. Removal oracle is the crawl''s own seen-set: a unit keeping status:true, flipping to status:false, or dropping from the array is the complete liveness signal — no separate detail endpoint exists to re-probe.',
   'source', now())
on conflict (platform) do update
  set status = excluded.status, expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes, kind = excluded.kind,
      updated_at = now();

DO $verify$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.platform_registry
   WHERE platform IN ('ibaax','remaxsa','qmra','alajlan')
     AND status = 'active' AND kind = 'source' AND coalesce(btrim(notes),'') <> '';
  IF n <> 4 THEN RAISE EXCEPTION 'expected 4 wave-2 platform_registry rows with notes, found %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.age_source_registry
              WHERE source_table ~ '^(ibaax|remaxsa|qmra|alajlan)_') THEN
    RAISE EXCEPTION 'a wave-2 platform that publishes no age was registered as an age source';
  END IF;
  RAISE NOTICE 'wave-2: 4 platform_registry rows, 0 age sources (none publish age)';
END $verify$;
