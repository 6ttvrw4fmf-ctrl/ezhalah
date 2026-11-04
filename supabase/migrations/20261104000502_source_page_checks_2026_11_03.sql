-- SOURCE-PAGE CHECKS, 2026-11-03 (owner «Yes, use your picks», task source-page-checks). Every row below was read on
-- its OWN source page in a real browser on 2026-11-03 ~22:30 UTC; nothing is repriced, nothing is hidden.
--
-- (a) ksaaqar 12225908 (price_eq_area_or_ppm): https://ksaaqar.com/ad/ارض-2/ prints «600.00ريال» as the ad's price and
--     «المساحه 600 متر» in the text. The advertiser typed the area into the price field; the site publishes 600 SAR,
--     so the stored 600 is SOURCE, not a parser leak (PRICE = SOURCE) → ops_price_eq_area_verified.
-- (b) dealapp_commercial 1274200 (district_contradicts_source): the page shows «مكة المكرمة, حي الشامية الجديد»; the
--     stored row's neighborhood and additional_info.district_ar both say «حي الشامية الجديد». «ولي العهد 3» appears only
--     inside the ad's free-text description. We served «حي ولي العهد» because the phasea arm of
--     listing_native_location_v1 carries no district and falls back to the frozen listings_arabic_locations snapshot,
--     whose row still holds an old «Waly Al Ahd Dist.» → «حي ولي العهد». Same recipe as 20261103134303 (its sibling
--     1274179 got the same «ولي العهد» snapshot): the snapshot takes the source word, the hourly v1 refresh (:20) and
--     sync (:22) carry it.
-- (c) تربه, منطقة حائل (city 2372): REAL, a different town from Makkah's تربه (2156). aqarcity 29743 publishes
--     schema.org addressLocality «تربة», addressRegion «منطقة حائل», geo 28.2351, 42.9102, breadcrumb state 4 (حائل)
--     → city 3747; aqarcity 30916 (حي النفود) the same. Makkah's Turbah sits near 21.19, 41.60 (wasalt 22278454 /
--     22481363 under 2156) — ~800 km away. 20261026013519's G4 rule retired 2372 as «duplicate of 2156, 1.4 km» because
--     loc_city_center is computed FROM the homes, and ~90 Hail-coordinate homes sit under 2156, pulling 2156's
--     "center" to 28.25, 42.93. The retirement is undone; retired_place_remap_rows then stops moving the 8 homes of 2372
--     (aqarcity ×2, muhaysini ×2, sakani ×4 — all at 28.23–28.27 N, 42.90–42.94 E) into منطقة مكة المكرمة. The ~90
--     Hail homes filed under 2156 by other resolvers are NOT moved here (a remap, not an undo — routed).
-- (d) aqarmonthly 13905878 / 13905804 / 13907063 / 13908860 / 13905933 (served_billion_price_unproven,
--     field_integrity_extreme_magnitude): the unit pages print no price until dates are chosen («اختر فترة الحجز لعرض
--     الأسعار»); the platform's own booking-price call the page makes (DailyRenting.getCalculatedBookingPriceWithDiscount,
--     30-day windows from 2026-11-10, +40 d, +80 d) answered the SAME figures the scraper stored, 3/3 windows each:
--     6629362 → 2,749,999,972.5 / 30 days; 6571818 → 1,650,000; 6670815 → 99,000; 6729795 → 1,374,999.9;
--     6555242 → 6,119,971.2 (stored 6,063,571.2 — host repriced, still the same order). Host-entered blocking prices, the
--     source's own numbers (PRICE = SOURCE; the card already prints no price for aqarmonthly) → ops_price_source_verified.
--     dealapp 21600559 (617103) and 22313488 (618167) are NOT recorded: both pages now serve dealapp's empty home shell
--     (no ad data) — UNKNOWN, left to dealapp's liveness oracle.
-- (e) adjudicated_reactivation: amaall commercial 10729213–10729218 are live on their own pages (HTTP 200, same price
--     and area as stored) and the source lists each as «أرض تجارية» (10729217 commercial only; the others «أرض سكنية,
--     أرض تجارية, تجاري, سكني»): exactly one card is served (the residential twin is retired) under a category the
--     source itself states → ops_adjudication_superseded. gathern 733938 (unit 176594) is live (HTTP 200, unit page,
--     100 م², المدينة المنورة) after its 11-02 404 retraction → superseded. gathern 964708 (unit 259013) redirected to
--     /ar?error=500 — UNKNOWN, not recorded, stays on the alarm.
do $src$
declare n int;
begin
  -- (a)
  insert into public.ops_price_eq_area_verified (source_table, listing_id, verified_price_total, verified_area_m2, evidence)
  select 'ksaaqar_residential_listings', 12225908, 600, 600,
         'source-page-checks 2026-11-03: live read of https://ksaaqar.com/ad/%d8%a7%d8%b1%d8%b6-2/ prints «600.00ريال» as the '
      || 'price and «المساحه 600 متر» in the text. SOURCE-REAL: the advertiser put the area in the price field; we serve the '
      || 'figure the page shows (PRICE = SOURCE).'
   where exists (select 1 from public.ksaaqar_residential_listings
                  where id = 12225908 and price_total = 600 and area_m2 = 600)
     and not exists (select 1 from public.ops_price_eq_area_verified
                      where source_table = 'ksaaqar_residential_listings' and listing_id = 12225908);
  get diagnostics n = row_count;
  if n <> 1 then raise exception '(a) expected 1 ksaaqar waiver, wrote %', n; end if;

  -- (b)
  update public.listings_arabic_locations l
     set district_ar = 'حي الشامية الجديد',
         raw_district = 'حي الشامية الجديد',
         review_reason = coalesce(l.review_reason, '')
                      || ' | 🔧 2026-11-03 source-page-checks: snapshot served «حي ولي العهد», source publishes «حي الشامية الجديد»'
   where l.source_table = 'dealapp_commercial_listings' and l.listing_id = 1274200 and l.platform = 'dealapp'
     and public.norm_district_tok(l.district_ar) = public.norm_district_tok('حي ولي العهد')
     and exists (select 1 from public.dealapp_commercial_listings d
                  where d.id = 1274200 and d.neighborhood = 'حي الشامية الجديد'
                    and d.additional_info->>'district_ar' = 'حي الشامية الجديد')
     and public.loc_display_district_ar(6, 'حي الشامية الجديد') = 'حي الشامية الجديد';
  get diagnostics n = row_count;
  if n <> 1 then raise exception '(b) expected 1 snapshot row, touched %', n; end if;

  -- (c)
  update public.loc_catalog_city
     set retired_at = null, retired_why = null
   where city_id = 2372 and region_id = 8 and city_norm = 'تربه'
     and retired_why = 'duplicate of city 2156 (تربه, 1.4 km) — homes to be remapped by the engineer';
  get diagnostics n = row_count;
  if n <> 1 then raise exception '(c) expected to un-retire city 2372 once, touched %', n; end if;

  -- (d)
  insert into public.ops_price_source_verified (source_table, listing_id, evidence)
  select 'aqarmonthly_residential_listings', v.id,
         'source-page-checks 2026-11-03: the unit page (' || v.ad || ') prints no price until dates are chosen; the '
      || 'platform''s own booking-price call (DailyRenting.getCalculatedBookingPriceWithDiscount, 30-day windows from '
      || '2026-11-10, +40 d, +80 d) answered ' || v.monthly || ' SAR per 30 days on 3/3 windows — the figure the scraper '
      || 'stored ×12. Host-entered price, the source''s own number (PRICE = SOURCE).'
    from (values (13905878, 'sa.aqar.fm ad 6629362', '2,749,999,972.5'),
                 (13905804, 'sa.aqar.fm ad 6555242', '6,119,971.2 (stored from 6,063,571.2)'),
                 (13907063, 'sa.aqar.fm ad 6571818', '1,650,000'),
                 (13908860, 'sa.aqar.fm ad 6670815', '99,000'),
                 (13905933, 'sa.aqar.fm ad 6729795', '1,374,999.9')) as v(id, ad, monthly)
   where exists (select 1 from public.aqarmonthly_residential_listings a where a.id = v.id and a.active)
     and not exists (select 1 from public.ops_price_source_verified p
                      where p.source_table = 'aqarmonthly_residential_listings' and p.listing_id = v.id);
  get diagnostics n = row_count;
  if n <> 5 then raise exception '(d) expected 5 aqarmonthly verifications, wrote %', n; end if;

  -- (e)
  insert into public.ops_adjudication_superseded (source_table, listing_id, superseded_at, evidence)
  select v.t, v.id, now(), v.ev
    from (values
      ('amaall_commercial_listings', 10729213::bigint, jsonb_build_object('why', 'own page read LIVE 2026-11-03 (HTTP 200, SAR46,545,800, 16,623.5 m²); source lists «أرض سكنية, أرض تجارية, تجاري, سكني»; residential twin 11559426 retired, one card served', 'task', 'source-page-checks')),
      ('amaall_commercial_listings', 10729214, jsonb_build_object('why', 'own page read LIVE 2026-11-03 (HTTP 200, SAR1,960,000, 741 m²); source lists «أرض سكنية, أرض تجارية, تجاري, سكني»; residential twin 11559428 retired, one card served', 'task', 'source-page-checks')),
      ('amaall_commercial_listings', 10729215, jsonb_build_object('why', 'own page read LIVE 2026-11-03 (HTTP 200, SAR750,000, 510 m²); source lists «أرض سكنية, أرض تجارية, تجاري, سكني»; residential twin 11559434 retired, one card served', 'task', 'source-page-checks')),
      ('amaall_commercial_listings', 10729216, jsonb_build_object('why', 'own page read LIVE 2026-11-03 (HTTP 200, SAR1,900,000, 408 m²); source lists «أرض سكنية, أرض تجارية, تجاري, سكني»; residential twin 11559436 retired, one card served', 'task', 'source-page-checks')),
      ('amaall_commercial_listings', 10729217, jsonb_build_object('why', 'own page read LIVE 2026-11-03 (HTTP 200, SAR4,000,000, 799 m²); source lists «أرض تجارية, تجاري» only; residential twin 11559437 retired, one card served', 'task', 'source-page-checks')),
      ('amaall_commercial_listings', 10729218, jsonb_build_object('why', 'own page read LIVE 2026-11-03 (HTTP 200, SAR6,000,000, 625 m²); source lists «أرض سكنية, أرض تجارية, تجاري, سكني»; residential twin 11559439 retired, one card served', 'task', 'source-page-checks')),
      ('gathern_residential_listings', 733938, jsonb_build_object('why', 'own page read LIVE 2026-11-03 after the 11-02 404 retraction (HTTP 200 on https://gathern.co/view/125434/unit/176594, full unit page, 100 m², المدينة المنورة - حي المبعوث)', 'task', 'source-page-checks'))
    ) as v(t, id, ev)
   where not exists (select 1 from public.ops_adjudication_superseded s where s.source_table = v.t and s.listing_id = v.id);
  get diagnostics n = row_count;
  if n <> 7 then raise exception '(e) expected 7 superseded rows, wrote %', n; end if;
end
$src$;
