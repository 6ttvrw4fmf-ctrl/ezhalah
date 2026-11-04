-- field_integrity sweep, 2026-11-03 (non-wasalt): each flagged row read LIVE on its own page; these 33 carry
-- exactly the number the source publishes, so they are recorded as source-verified (mon_detect_field_integrity's register),
-- never repriced. Not included: 4 dealapp rows serving dealapp's empty shell (left to liveness), 5 aqarmonthly booking rows
-- (the source shows no price until dates are chosen), 1 sakani row (unreadable from here), 3 haraj rows our parser
-- mis-scaled (repaired in their own migration).
insert into public.ops_price_source_verified (source_table, listing_id, evidence)
select v.t, v.id, 'Price/area fidelity 2026-11-03 (field_integrity sweep). Read live from the listing''s own page: ' || v.e
from (values
  ('aqar_residential_listings', 17455824, 'sa.aqar.fm ad 6916685 shows «1,006,360 م²» for this villa = the stored area_m2. The advertiser''s figure; kept (SOURCE IS TRUTH).'),
  ('aqar_residential_listings', 1364029, 'sa.aqar.fm ad 6523922 title reads «1,080,200 م²» = the stored area_m2. The advertiser''s figure; kept.'),
  ('aqar_residential_listings', 14838857, 'sa.aqar.fm ad 6895067 title reads «2,000,000 م²» = the stored area_m2. The advertiser''s figure; kept.'),
  ('dwelleo_residential_listings', 13929879, 'dwelleo.sa property 20204: its structured floorSize and «المساحة 1,250,000 m²» = the stored area_m2 (its prose says 312.5 m²; the structured field is what the site states and what we read). Kept, never recomputed.'),
  ('aqarcity_residential_listings', 13634535, 'aqarcity.net/property/30898 JSON-LD price 10,000,000,000 (monthly rent) = the stored price_annual 120,000,000,000 / 12 (fleet monthly x12 convention). Source-published; kept.'),
  ('ksaaqar_commercial_listings', 14119335, 'ksaaqar.com hotel ad shows «550,000,000.00 ريال» = the stored price. Source-published; kept.'),
  ('bossbih_residential_listings', 12602186, 'bossbihoffice.com.sa/14291 carries 570000000 = the stored price. Source-published; kept.'),
  ('gomenassat_residential_listings', 12590476, 'gomenassat.com/ar/offer/656 carries 537,510,906 and 1,791,703 = the stored price and area. Source-published; kept.'),
  ('reinvest_residential_listings', 21664000, 'reinvest.sa ard-llbyaa-1775 carries 4,773,972,000 and 1,037 = the stored price and area. Source-published; kept.'),
  ('reinvest_residential_listings', 21490317, 'reinvest.sa ard-llaygar-249 carries 1,635,400,000 and 1,258 = the stored price and area. Source-published; kept.'),
  ('haraj_residential_listings', 18924462, 'haraj.com.sa/11186685251 carries 100000000 = the stored price. Source-published; kept.'),
  ('haraj_residential_listings', 19673799, 'haraj.com.sa/11191056226 carries 6666666667 and 450 = the stored price and area. Source-published; kept.'),
  ('haraj_residential_listings', 18814812, 'haraj.com.sa/11187652697 licence block «سعر الوحدة: 1000000000», monthly rent = the stored price_annual / 12. Source-published; kept.'),
  ('muhaysini_residential_listings', 17578893, 'backend.aqaralmuhaysini.com/api/properties/retrieve record carries the stored price and area verbatim. Source-published; kept.'),
  ('muhaysini_residential_listings', 14819973, 'backend.aqaralmuhaysini.com/api/properties/retrieve record carries the stored price and area verbatim. Source-published; kept.'),
  ('muhaysini_residential_listings', 17867051, 'backend.aqaralmuhaysini.com/api/properties/retrieve record carries the stored price and area verbatim. Source-published; kept.'),
  ('muhaysini_residential_listings', 15378186, 'backend.aqaralmuhaysini.com/api/properties/retrieve record carries the stored price and area verbatim. Source-published; kept.'),
  ('muhaysini_residential_listings', 17865724, 'backend.aqaralmuhaysini.com/api/properties/retrieve record carries the stored price and area verbatim. Source-published; kept.'),
  ('muhaysini_residential_listings', 17577142, 'backend.aqaralmuhaysini.com/api/properties/retrieve record carries the stored price and area verbatim. Source-published; kept.'),
  ('muhaysini_residential_listings', 17865726, 'backend.aqaralmuhaysini.com/api/properties/retrieve record carries the stored price and area verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 20296446, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 21152244, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 23282062, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 23282083, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 23281688, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 21450302, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 19347660, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 9111704, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 17548847, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 21397554, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 14908006, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 18987757, 'dealapp.sa ad-details page carries the stored price verbatim. Source-published; kept.'),
  ('dealapp_residential_listings', 1038943, 'dealapp.sa/ar/ad-details/414833 carries 2,600,000 (monthly) = the stored price_annual 31,200,000 / 12. Source-published; kept.')
) as v(t, id, e)
on conflict (source_table, listing_id) do nothing;