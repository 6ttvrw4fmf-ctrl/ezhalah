-- Where each platform's map pin lives, declared — and the served index held to it every hour (owner 2026-10-30:
-- «this needs serious investigation, fix, and never ever happen again»).
--
-- rakez served 3,660 ads with 0 pins for six weeks. Its project page draws no map, so nobody looked further; the site's
-- map page had been calling a JSON feed with every project's lat/lng the whole time. Nothing failed anywhere: a pinless
-- row is valid at every layer. The same sweep found compoundin (286 ads, marker in an inline script) and mustqr (1,340
-- ads, the Maps link in the ad text was being dropped). The only honest guard is a DECLARATION per platform — made after
-- looking in all four places (ad page · embedded JSON / network calls · site-wide map or list feed · parent project
-- page) — and a detector that measures what we SERVE against it. The repo copy is data/pin-sources.json (launch
-- checklist box 10, scripts/verify-pin-capture-declared.ts proves every row here appears there and vice versa).
create table if not exists public.ops_pin_source_declared (
  platform    text primary key,
  pin_source  text not null check (pin_source in ('ad-page', 'page-json', 'feed', 'project-page', 'partial', 'none')),
  floor_pct   int  not null check (floor_pct between 0 and 100),
  proof_url   text not null,
  proven_on   date not null,
  note        text,
  declared_at timestamptz not null default now(),
  constraint pin_floor_matches_source check ((pin_source = 'none') = (floor_pct = 0))
);
comment on table public.ops_pin_source_declared is
  'Per platform: where the source publishes its map pin (or none, with the URL proven silent) and the served-coverage floor. Mirror of data/pin-sources.json (owner 2026-10-30). Raise a floor by migration; never lower one to clear a red.';
alter table public.ops_pin_source_declared enable row level security;
revoke all on public.ops_pin_source_declared from public, anon, authenticated;
grant select on public.ops_pin_source_declared to service_role;

insert into public.ops_pin_source_declared (platform, pin_source, floor_pct, proof_url, proven_on, note) values
  ('aalbarrak', 'none', 0, 'https://aalbarrak.com/property/%d9%81%d9%8a%d9%84%d8%a7-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d8%b4%d8%a7%d8%b1%d8%b9-%d8%a7%d9%84%d9%85%d9%86%d8%aa%d8%b5%d8%b1-%d8%ad%d9%8a-%d8%a7%d9%84%d9%86/', date '2026-10-30', 'UNVERIFIED 2026-10-30: 403/timeout to both clients; provisional none — re-open from a residential IP. Served 0/9 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('abaad', 'feed', 95, 'https://app.abaadapp.sa/details/601', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 446/446 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('abeea', 'feed', 95, 'https://abeea.com.sa/en/property/five-shop-openings-for-rent-in-al-muhandeseen-plan/', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 176/176 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('abralosol', 'partial', 5, 'https://abralosol.com/6570', date '2026-10-30', 'Partial: the ad page carries a Maps place link only when the broker added one (6570 yes; 7981, 8018 no — pin_absent written). Scraper reads it when present. Served 275/2972 (9.3%) on 2026-10-30 before today''s fixes.'),
  ('abwbna', 'partial', 65, 'https://www.abwbna.com/properties/45172', date '2026-10-30', 'Partial: pinned ad has the pair in JSON + a Maps link; 27904 and 54320 show no map at all. Served 103/136 (75.7%) on 2026-10-30 before today''s fixes.'),
  ('akariyoun', 'page-json', 95, 'https://akariyoun.sa/properties/msnaa-llaygar-fy-hy-almsfa', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 324/325 (99.7%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('alajlan', 'none', 0, 'https://alajlan-re.com/', date '2026-10-30', 'Proven silent: ads have no page of their own (listing_url is the home page); the only map is the office embed 24.719608,46.646210. Served 0/11 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('albdah', 'partial', 20, 'https://albdah.sa/property/22Uec/details/', date '2026-10-30', 'Partial: pinned ad has a Maps link + embed; 94qyR and 19kWW show nothing. Served 28/90 (31.1%) on 2026-10-30 before today''s fixes.'),
  ('albukaeri', 'ad-page', 1, 'https://albukaeri.sa/property/69d220c494242c82c5bc7686', date '2026-10-30', 'CAPTURE GAP (20 ads, 0%): the raw page carries a maps.app.goo.gl short link per ad; the scraper does not follow it. Below the 50-ad detector line; backlog. Served 0/20 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('aldarim', 'partial', 80, 'https://www.aldarim.sa/en/properties/48548', date '2026-10-30', 'Partial: pinned ad has JSON + Maps link + short link; 39826 and 40691 show nothing. Served 140/156 (89.7%) on 2026-10-30 before today''s fixes.'),
  ('alhoshan', 'feed', 95, 'https://www.alhoshan.sa/properties/1002', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 27/27 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('aljassim', 'partial', 15, 'https://aljassimaqar.com/4607', date '2026-10-30', 'Partial: 4912 and 2806 show nothing (rendered); 4607 timed out in the headless browser today but serves a pin read by the scraper''s Maps-link path. Served 23/91 (25.3%) on 2026-10-30 before today''s fixes.'),
  ('alkhaas', 'ad-page', 1, 'https://alkhaas.net/ads/1003', date '2026-10-30', 'BUG fixed #9508: «الذهاب إلى موقع الإعلان» → google.com/maps?q=LAT,LNG per ad (3/3 rendered ads, distinct pairs). The JS fallback lat 26.117342 is the same on every ad and is never read. Raise the floor after the first re-crawl. Served 0/209 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('almotmkenah', 'none', 0, 'https://almotmkenah.com/annonce/%D9%85%D8%B4%D8%B1%D9%88%D8%B9_%D8%A7%D8%B1%D8%A8%D8%B9_%D9%81%D9%84%D9%84_%D9%85%D8%B3%D8%AA%D9%82%D9%84%D9%87_%D9%84%D9%84%D8%A8%D9%8A%D8%B9_%D9%81%D9%8A_%D8%AD%D9%8A_%D8%A7%D9%84%D8%AC%D9%86%D8%A7%D8%AF%D8%B1%D9%8A%D8%A9-3', date '2026-10-30', 'Proven silent on 1 rendered ad (no pair, no map, no link). 22 ads. Served 0/22 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('almuteb', 'feed', 1, 'https://almuteb.sa', date '2026-10-30', '0 served rows on 2026-10-30; classified from the scraper''s read path (feed). Floor 1 = «publishes»; measure on relaunch.'),
  ('alobid', 'partial', 20, 'https://www.alobidoffice.com/properties/27673', date '2026-10-30', 'Partial: pinned ad has a Maps link; 41120 and 40610 show nothing. Served 30/101 (29.7%) on 2026-10-30 before today''s fixes.'),
  ('alqasem', 'none', 0, 'https://alqasem.com.sa/property/%d8%af%d9%88%d8%b1-vip-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-g2b/', date '2026-10-30', 'Proven silent on 1 rendered ad. 23 ads. Served 0/23 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('alrifai', 'none', 0, 'https://alrifai.com.sa/index.php?page=property-detail&id=92', date '2026-10-30', 'Silent on 1 rendered ad: loads Maps JS but prints no pair, link or frame. 17 ads. Served 0/17 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('alsaedan', 'ad-page', 87, 'https://alsaedan.com/sales/unit/3396', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (ad-page); not re-opened in a browser today. Served 300/325 (92.3%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('alshawaf', 'partial', 35, 'https://alshawaf.com.sa/22379', date '2026-10-30', 'Partial: the ad''s own «الموقع» row carries a maps/place link only on some ads (22379 yes; 21660 and 21877 only list OTHER ads'' links and the office embed 25.3841505,49.5916303 — never read). Served 465/1009 (46.1%) on 2026-10-30 before today''s fixes.'),
  ('alsidra', 'none', 0, 'https://alsidra.com.sa/property/%d8%b4%d9%82%d8%a9-%d9%81%d8%a7%d8%ae%d8%b1%d8%a9-%d9%84%d9%84%d8%a7%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%ad%d8%b2%d8%a7%d9%85-%d8%a7%d9%84%d8%b0%d9%87%d8%a8%d9%8a-%d8%a7/', date '2026-10-30', 'Silent: the Leaflet config prints 23.8859,45.0792 — the centre of Saudi Arabia, a default, not a pin. 29 ads. Served 0/29 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('alta', 'page-json', 1, 'https://alta.com.sa/estate_property/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%85%d9%83%d8%a9-%d8%a7%d9%84%d9%85%d9%83%d8%b1%d9%85%d8%a9-%d8%ad%d9%8a-%d8%a8%d8%b7%d8%ad%d8%a7%d8%a1-%d9%82%d8%b1%d9%8a%d8%b4/', date '2026-10-30', 'CAPTURE GAP (7 ads, 0%): the page prints 21.373688,39.827813 in JSON + a Maps link (1 ad seen; per-ad vs default not yet distinguished). Backlog. Served 0/7 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('amaall', 'page-json', 1, 'https://www.amaall.com/projects/%d8%a3%d8%b1%d8%b6-%d8%b3%d9%83%d9%86%d9%8a%d8%a9-%d8%a8%d9%85%d9%83%d8%a9-%d8%a7%d9%84%d9%85%d9%83%d8%b1%d9%85%d8%a9-%d8%ad%d9%8a-%d8%a7%d9%84%d8%b9%d8%b2%d9%8a%d8%b2%d9%8a%d8%a9/', date '2026-10-30', 'CAPTURE GAP (32 ads, 0%): the page prints 21.488419,39.934998 in JSON (Leaflet) + a short link (1 ad seen). Backlog. Served 0/32 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('amlakalahsa', 'feed', 88, 'https://amlakalahsa.com/land/%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%a7%d8%b1%d8%b6-%d9%81%d9%8a-%d8%a7%d9%84%d9%88%d8%b1%d9%88%d8%af-%d8%a7%d9%84%d8%ba%d8%b1%d8%a8%d9%8a/', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 267/285 (93.7%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('aouj', 'feed', 87, 'https://aoujestates.com/ar/properties/%D8%AF%D8%A8%D9%84%D9%83%D8%B3%D9%8A%D9%86-%D9%81%D9%8A-%D8%AD%D9%8A-%D8%A7%D9%84%D8%B4%D8%B1%D8%A7%D8%B9', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 69/75 (92.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('aqalemhajer', 'partial', 50, 'https://aqalemhajer.com/4721', date '2026-10-30', 'Partial: pinned ad carries a maps.app.goo.gl short link (followed); 4001 and 5359 show nothing. Served 624/1022 (61.1%) on 2026-10-30 before today''s fixes.'),
  ('aqar', 'page-json', 95, 'https://sa.aqar.fm/6943435', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 178995/179392 (99.8%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('aqaralriyadh', 'none', 0, 'https://aqaralriyadh.com/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%a3%d9%86%d8%af%d9%84%d8%b3-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6/', date '2026-10-30', 'Proven silent on 1 rendered ad. 14 ads. Served 0/14 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('aqaralsaudia', 'page-json', 1, 'https://aqaralsaudia.com/property/%d8%b4%d9%82%d8%a9-%d9%81%d8%a7%d8%ae%d8%b1%d8%a9-%d8%a7%d8%b1%d8%b6%d9%8a%d8%a9-%d8%a8%d8%ad%d9%8a-%d9%84%d8%a8%d9%86-%d8%b1%d9%82%d9%85-1/', date '2026-10-30', 'CAPTURE GAP (16 ads, 0%): the page prints 24.636784,46.596677 in JSON (Leaflet) + a short link (1 ad seen). Backlog. Served 0/16 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('aqaratikom', 'feed', 95, 'https://nawait.sa/real-estate/6dbb596f-4df9-4b67-a984-41f92133ffa7', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 123/125 (98.4%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('aqarcity', 'ad-page', 95, 'https://www.aqarcity.net/property/27803', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (ad-page); not re-opened in a browser today. Served 2095/2100 (99.8%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('aqargate', 'feed', 95, 'https://aqargate.com/property/%d9%85%d9%83%d8%aa%d8%a8-%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%85%d9%86%d8%b7%d9%82%d8%a9-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6-62/', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 139/140 (99.3%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('aqarmonthly', 'feed', 95, 'https://sa.aqar.fm/6828618', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 3618/3678 (98.4%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('aqarnajran', 'none', 0, 'https://aqarnajran.com/%d8%a8%d9%8a%d8%aa-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%b2%d9%88%d8%b1-%d8%a7%d9%84%d8%b9%d9%85%d8%a7%d8%b1%d9%8a-%d9%86%d8%ac%d8%b1%d8%a7%d9%86%d8%8c-%d9%85%d8%b3%d8%a7%d8%ad/', date '2026-10-30', 'Proven silent on 1 rendered ad. 39 ads. Served 0/39 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('arkaan', 'feed', 95, 'https://arkaanalaqar.com/property/1907', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 1877/1934 (97.1%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('arsh', 'partial', 70, 'https://www.arshglobal.com.sa/%D8%A3%D8%B1%D8%B6-%D8%AA%D8%AC%D8%A7%D8%B1%D9%8A%D8%A9', date '2026-10-30', 'Partial: goo.gl short links per ad, read when present (17 of 21 served). Served 17/21 (81.0%) on 2026-10-30 before today''s fixes.'),
  ('ashab', 'page-json', 95, 'https://ashab.sa/properties/166463', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 623/623 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('awal', 'ad-page', 1, 'https://awaalun.com/property/%d8%a7%d8%b1%d8%b6-%d9%85%d8%b3%d9%88%d8%b1%d9%87/', date '2026-10-30', 'BUG fixed #9508: <div class=marker data-latitude data-longitude> per ad (3/3 rendered ads, distinct pairs); the «Al Rabwa, Ar Ar» JSON is the office. Raise the floor after the first re-crawl. Served 0/51 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('azdad', 'none', 0, 'https://www.azdadalaqaria.com/property/e0b35c05-9b14-42d0-997b-1a857566a825', date '2026-10-30', 'Proven silent on 1 rendered ad. 20 ads. Served 0/20 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('azure', 'none', 0, 'https://azure.sa/compounds/al-reem', date '2026-10-30', 'Silent on 1 rendered page: loads Maps JS but prints no pair, link or frame. 32 ads. Served 0/32 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('bahadhabab', 'partial', 10, 'https://www.bahadhabab-res.com/properties/38741', date '2026-10-30', 'Partial: pinned ad has the pair in JSON; 39029 and 38777 show nothing. Served 11/53 (20.8%) on 2026-10-30 before today''s fixes.'),
  ('bossbih', 'partial', 15, 'https://bossbihoffice.com.sa/13298', date '2026-10-30', 'Partial: the ad''s own maps/place link only on some ads (13298 yes); 13709/14477 show only the office embed 25.361896,49.631982 (never read) and other ads'' links. Served 406/1544 (26.3%) on 2026-10-30 before today''s fixes.'),
  ('compoundin', 'project-page', 1, 'https://compoundin.com/compounds/riyadh/azure-al-reem', date '2026-10-30', 'BUG fixed #9507: the compound page''s inline `cinMapMarkers = [{marker:{position:{lat,lng}}}]` (one marker = the compound; measured on 3 compounds). Raise the floor after the first re-crawl. Served 0/286 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('dallali', 'feed', 95, 'https://dallali.com/advertisements/property/fa37876f-451b-45a4-92a1-b4cccfd0941c', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 14/14 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('daraa', 'ad-page', 1, 'https://daraa.sa/projects/205048', date '2026-10-30', 'CAPTURE GAP (7 ads, 0%): two maps.app.goo.gl short links on the rendered page; not followed. Below the 50-ad line; backlog. Served 0/7 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('daryusuf', 'ad-page', 1, 'https://daryusuf.com/en/portfolio/villa-for-rent-al-khalidiyah-district-madinah/', date '2026-10-30', 'BUG fixed #9508: the Elementor iframe maps.google.com/maps?q=24°27''59.8"N 39°39''44.9"E (DMS) per ad (3/3 rendered ads, distinct pairs). Raise the floor after the first re-crawl. Served 0/258 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('dealapp', 'feed', 95, 'https://dealapp.sa/ar/ad-details/581109', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 46120/46303 (99.6%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('dwelleo', 'feed', 95, 'https://www.dwelleo.sa/ar/properties/9000-sqm-office-space-for-rent-in-al-suwaidi-riyadh', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 4484/4517 (99.3%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('eaqartabuk', 'partial', 25, 'https://eaqartabuk.com/property/%d9%81%d9%8a%d9%84%d8%a7-%d8%b1%d9%88%d9%81-%d8%b9%d9%84%d9%88%d9%8a-%d9%85%d8%b3%d8%aa%d9%82%d9%84-%d8%ad%d9%8a-%d8%a7%d9%84%d9%8a%d9%88%d8%a7%d8%af%d9%8a-971/', date '2026-10-30', 'Partial: ads without their own pin print the site''s default 28.392151,36.57399 (Tabuk Park Mall) in JSON-LD and the Leaflet config — registered in ops_default_pin_register and stripped; real pins (971) are read. Served 204/574 (35.5%) on 2026-10-30 before today''s fixes.'),
  ('earthapp', 'feed', 95, 'https://map.earthapp.com.sa/offers/2662819', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 57/57 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('eastabha', 'feed', 95, 'https://eastabha.sa/estate_property/4001/', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 164/168 (97.6%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('ebriza', 'feed', 95, 'https://ebriza.com.sa/for_sell/626/%D8%A3%D8%A8%D9%87%D8%A7/%D8%A7%D9%84%D8%B4%D8%B1%D9%82%D9%8A%D8%A9/%D8%A7%D8%B1%D8%B6-%D8%A8%D9%8A%D8%B9', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 203/203 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('ego', 'none', 0, 'https://ego-aqar.com/unit-details/2409', date '2026-10-30', 'Proven silent on 1 rendered ad. 21 ads. Served 0/21 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('eightfloor', 'partial', 40, 'https://www.8floor.sa/properties/37975', date '2026-10-30', 'Partial by the scraper''s own read (1 of 2 served); the pinless rendered ad shows nothing. Served 1/2 (50.0%) on 2026-10-30 before today''s fixes.'),
  ('eilmalriyada', 'partial', 10, 'https://eilmalriyada.com/real-estate/view/566', date '2026-10-30', 'Partial: pinned ad has a Maps link + short links and api.eilmalriyada.com/api/recent/566 carries the pair; 473 and 510 show nothing. Served 59/285 (20.7%) on 2026-10-30 before today''s fixes.'),
  ('erapulse', 'feed', 95, 'https://erapulse.sa/property/buraydah-land-sale-ref-msrx3eyl-07fd9', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 44/45 (97.8%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('expattrusted', 'page-json', 95, 'https://expattrustedhousingriyadh.com/p/en/property/al-bustan-village', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 49/50 (98.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('eydah', 'none', 0, 'https://eydah.com/offers/Ey-1001.html', date '2026-10-30', 'Proven silent on 1 rendered ad. 2 ads. Served 0/2 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('fahadalshahri', 'none', 0, 'https://fahadalshahri.com/product/%d8%b4%d9%82%d9%82-%d8%a8%d8%ad%d9%8a-%d8%a7%d9%84%d8%b1%d9%88%d8%b6%d9%87/', date '2026-10-30', 'UNVERIFIED 2026-10-30: 403/timeout to both clients; provisional none. Served 0/5 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('fkralemar', 'none', 0, 'https://www.fkralemar.com/offers/apartment-for-sale', date '2026-10-30', 'Proven silent on 1 rendered page. 10 ads. Served 0/10 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('flow', 'ad-page', 1, 'https://flow.life/en/properties/riyadh-narjis/available-homes/tihama-3-bedroom/fid/o6j2UXkv0Lr9J0YjzDDL', date '2026-10-30', 'CAPTURE GAP (20 ads, 0%): the rendered page prints a Maps link 24.900543,46.636600 (Mapbox map). Below the 50-ad line; backlog. Served 0/20 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('fursaghyr', 'feed', 95, 'https://fursaghyr.com/property/%d8%b9%d9%85%d8%a7%d8%b1%d8%a9-%d8%a8%d9%8a%d8%b9-%d9%85%d9%86%d8%b7%d9%82%d8%a9-%d8%a7%d9%84%d9%85%d8%af%d9%8a%d9%86%d8%a9-%d8%a7%d9%84%d9%85%d9%86%d9%88%d8%b1%d8%a9/', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 8/8 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('gathern', 'feed', 95, 'https://gathern.co/view/65814/unit/99257', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 15103/15117 (99.9%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('goldendeal', 'ad-page', 91, 'https://www.goldendeal.sa/properties/49174', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (ad-page); not re-opened in a browser today. Served 308/318 (96.9%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('gomenassat', 'feed', 95, 'https://gomenassat.com/ar/offer/792', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 175/177 (98.9%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('gudai', 'none', 0, 'https://gudai.inblaj.net/property/%d8%a3%d8%b1%d8%b6-%d8%b3%d9%83%d9%86%d9%8a%d8%a9-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d9%81%d9%8a%d8%ad%d8%a7%d8%a1-%d8%a7%d9%84%d8%af%d9%85%d8%a7%d9%85/', date '2026-10-30', 'UNVERIFIED 2026-10-30: 403/timeout to both clients; provisional none. Served 0/12 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('hajer', 'ad-page', 1, 'https://hajerhouses.com/property/%d8%a8%d9%8a%d8%aa-%d9%85%d9%83%d9%88%d9%86-%d9%85%d9%86-%d8%af%d9%88%d8%b1-%d9%88%d8%ab%d9%84%d8%a7%d8%ab-%d8%b4%d9%82%d9%82-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84/', date '2026-10-30', 'BUG fixed #9508: var rem_property_map = {latitude, longitude} per ad (3/3 rendered ads, distinct pairs). Raise the floor after the first re-crawl. Served 0/124 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('haraj', 'partial', 75, 'https://haraj.com.sa/11191638006', date '2026-10-30', 'Partial: the seller sets a pin on most ads (a Maps link on 11191638006); 11191640369 and 11191637649 show none, and the page''s GraphQL responses carry no pair for them. Served 12765/15587 (81.9%) on 2026-10-30 before today''s fixes.'),
  ('hasaad', 'none', 0, 'https://hasaadestate.com/projects/%d8%ac%d9%88%d8%a7%d8%b1-19/', date '2026-10-30', 'Silent: the only map is a place embed whose q= is a short plus code + address text (J44X+G42, As Salamah, Jeddah) — resolving it is geocoding, which we never do. 12 ads. Served 0/12 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('hazim', 'partial', 10, 'https://hazim.sa/properties/6a24951be68e1d79e10e7787', date '2026-10-30', 'Partial by the scraper''s own read (1 of 5 served); the pinless rendered ad shows nothing. Served 1/5 (20.0%) on 2026-10-30 before today''s fixes.'),
  ('holoul', 'partial', 35, 'https://app.holoul.io/units/10a9d527-6534-4915-abcb-4298d7e30aa0', date '2026-10-30', 'Partial: the API''s location object, read when present (14 of 30 served); the rendered pinless unit shows the map centre 24.500621,46.735823 only. Served 14/30 (46.7%) on 2026-10-30 before today''s fixes.'),
  ('ialqarawi', 'partial', 75, 'https://ialqarawi.com/index.php?router=card&id=1999&catid=45', date '2026-10-30', 'Partial by the scraper''s own read (Maps link with «q= LAT,LNG», 81.9% served); the site refused the headless browser and curl today (HTTP/2 error) — re-open from a residential IP. Served 2145/2618 (81.9%) on 2026-10-30 before today''s fixes.'),
  ('ibaax', 'feed', 95, 'https://ibaax.sa/ar/advertisements/763', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 152/153 (99.3%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('jawher', 'partial', 75, 'https://www.jawher2030.com/properties/52519', date '2026-10-30', 'Partial by the scraper''s own read (35 of 42 served); a pinless rendered ad still printed a pair in JSON + a Maps link — re-check whether it is a default. Served 35/42 (83.3%) on 2026-10-30 before today''s fixes.'),
  ('jazwtn', 'none', 0, 'https://jazwtn.sa/projects/%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%82%d8%b7%d8%b9%d8%a9-%d8%b1%d9%82%d9%85-1006-%d9%81%d9%8a-%d9%85%d8%ae%d8%b7%d8%b7-482-%d8%a8%d8%ad%d9%8a-%d8%a7%d9%84%d8%b1%d9%88%d8%a7%d8%a8%d9%8a-%d8%b6%d8%a7/', date '2026-10-30', 'Proven silent: 2/2 rendered ads carry no pair, no map library, no short link, no map feed. Served 0/97 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('jurash', 'partial', 80, 'https://jurash.sa/property/97/', date '2026-10-30', 'Partial: the ad''s iframe maps?q=18°24''54.0,42°41''44.1 (DMS) read when present (13 of 15 served). Served 13/15 (86.7%) on 2026-10-30 before today''s fixes.'),
  ('justsa', 'none', 0, 'https://just.sa/l/727', date '2026-10-30', 'Proven silent: 3/3 rendered ads carry no pair, no map library, no short link. Served 0/73 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('ksaaqar', 'partial', 15, 'https://ksaaqar.com/ad/%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d8%b4%d9%82%d8%a9-%d8%b9%d8%a7%d8%a6%d9%84%d9%8a%d9%87-%d9%81%d8%a7%d8%ae%d8%b1%d8%a9-%d9%81-%d8%a3%d8%a8%d8%ad%d8%b1-%d8%a7%d9%84%d8%b4%d9%85%d8%a7%d9%84/', date '2026-10-30', 'Partial by the scraper''s own read (26.5% served); the raw page of a pinless ad has no pair and loads Maps JS only; pages timed out in the headless browser today. Served 383/1448 (26.5%) on 2026-10-30 before today''s fixes.'),
  ('livingcompound', 'ad-page', 1, 'https://livingcompound.com/property/2-bedroom-fully-furnished-apartment-for-rent-al-fayha-jeddah/', date '2026-10-30', 'CAPTURE GAP (17 ads, 0%): the rendered page prints a Maps link 21.509731,39.203042. Below the 50-ad line; backlog. Served 0/17 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('m3tmd', 'feed', 95, 'https://www.m3tmd.com/properties/37109', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 36/37 (97.3%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('macsaib', 'partial', 1, 'https://macsaib.sa/property/fyla-hy-alrhab', date '2026-10-30', 'Partial: the only embed on every ad is the office 26.361853,43.9304608 (identical on 3/3 rendered ads, never read); 2 served pins come from ads that stated one. Served 2/63 (3.2%) on 2026-10-30 before today''s fixes.'),
  ('maktab', 'feed', 95, 'https://maktab.sa/details/91', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 20/20 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('manafe', 'page-json', 88, 'https://manafe.com.sa/manafemar/project/285', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 72/77 (93.5%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('manzo', 'feed', 95, 'https://manzo.com.sa/ar/property/long_term_rent-140m2-86yb8vWa', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 793/795 (99.7%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('maqam', 'feed', 85, 'https://property.maqamco.sa/properties/51641', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 38/42 (90.5%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('maqrat', 'page-json', 95, 'https://maqrat.com/Property/Details/60', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 235/235 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('marksa', 'none', 0, 'https://mar-ksa.com/ar/property/showitem/881', date '2026-10-30', 'Proven silent on 1 rendered ad. 7 ads. Served 0/7 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('masar', 'none', 0, 'https://masaraqarat.com/aqar/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-4/', date '2026-10-30', 'UNVERIFIED 2026-10-30: 403/timeout to both clients; provisional none (1 ad). Served 0/1 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('mizlaj', 'feed', 95, 'https://mizlaj.com.sa/guest/listings/aakar-371961m2-llbyaa-almdyn-almnor-4tcrzkwY', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 33/33 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('mobasher', 'partial', 70, 'https://mobasher.sa/direct/realestate/%D8%A7%D8%B1%D8%B6-%D8%B2%D8%B1%D8%A7%D8%B9%D9%8A%D8%A9-%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6-%D8%A7%D9%84%D8%B9%D9%85%D8%A7%D8%B1%D9%8A%D8%A9--1785325075506', date '2026-10-30', 'Partial by the scraper''s own read (32 of 40 served); the pinless rendered ad printed a Maps link at 24.734276,46.671277 — re-check whether it is a default. Served 32/40 (80.0%) on 2026-10-30 before today''s fixes.'),
  ('moftah', 'feed', 1, 'https://moftah-aleaqar.com', date '2026-10-30', '0 served rows on 2026-10-30; classified from the scraper''s read path (feed). Floor 1 = «publishes»; measure on relaunch.'),
  ('muajarh', 'feed', 95, 'https://muajarh.com/properties/property-1785346629908', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 11/11 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('muhaysini', 'feed', 95, 'https://aqaralmuhaysini.com/propertydetails/17910', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 19812/19816 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('muktamel', 'feed', 95, 'https://www.muktamel.com/real-estates/34319', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 3892/3892 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('mustqr', 'partial', 1, 'https://mustqr.sa/property/3083', date '2026-10-30', 'Partial at source (BUG fixed #9507): the API''s lat/lng columns are restricted to the office; the page''s JSON-LD geo is the office (27.5114,41.7208) on every ad; show_location true on 11/1,348 rows. The only published pin is the Google Maps link a broker pastes into the ad text — 14 descriptions + some raw_text bodies (≈1–3%), which ad_body() used to drop. Served 0/1340 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('nafithh', 'page-json', 95, 'https://nafithh.com/web/gallery/266', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 26/26 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('nawafeth', 'partial', 50, 'https://nawafethalwatan.com/Advserments/GetAdvsertismentDetail?advsertismentId=173', date '2026-10-30', 'Partial by the scraper''s own read (9 of 15 served); the pinless rendered ad shows nothing. Served 9/15 (60.0%) on 2026-10-30 before today''s fixes.'),
  ('nofodh', 'partial', 60, 'https://www.nofodh.sa/listings/326117', date '2026-10-30', 'Partial: a Maps frame maps?q=LAT,LNG only on ads that have one; the JSON-LD geo (office 24.728956,46.7436311) and the map-selector centre are never read (612433, 560136 carry only those). Served 1811/2556 (70.9%) on 2026-10-30 before today''s fixes.'),
  ('nowaisiry', 'partial', 40, 'https://alnowaisiry.com/lands/%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%a7%d8%b1%d8%b6-360-%d9%85%d8%aa%d8%b1-%d9%81%d9%8a-%d9%85%d8%ae%d8%b7%d8%b7-%d8%a7%d9%84%d8%ae%d9%8a%d8%b1-%d8%a7%d9%84%d8%a3%d9%85%d8%b1%d8%a7%d8%a1-3541/', date '2026-10-30', 'Partial: a maps.app.goo.gl short link per ad (raw page), read when present (11 of 21 served); the site answered the headless browser 403. Served 11/21 (52.4%) on 2026-10-30 before today''s fixes.'),
  ('nufouth', 'feed', 95, 'https://nufouth.com/latest-offers?ads-N4310=1', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 326/326 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('october', 'partial', 10, 'https://www.1october.com.sa/properties/44236', date '2026-10-30', 'Partial by the scraper''s own read (1 of 5 served); the pinless rendered ad shows nothing. Served 1/5 (20.0%) on 2026-10-30 before today''s fixes.'),
  ('opensooq', 'partial', 70, 'https://sa.opensooq.com/ar/search/288663068', date '2026-10-30', 'Partial: pinned ad has JSON + Maps link; 287995454 and 287440508 show nothing. Served 71/88 (80.7%) on 2026-10-30 before today''s fixes.'),
  ('qmra', 'none', 0, 'https://qmra.sa/property/%d9%82%d9%85%d8%b1%d8%a7-11/', date '2026-10-30', 'Silent: the only map is a place embed with q=قمرا 11 (text). 5 ads. Served 0/5 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('raghdan', 'page-json', 95, 'https://raghdan.sa/ar/property/522621620527/', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 393/401 (98.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('rakez', 'feed', 80, 'https://rakez.sa/ar/wp-json/hs-map/v1/projects?lang=en', date '2026-10-30', 'BUG fixed #9503: the project page draws no map; /ar/projects-map/ calls this feed with every project''s lat/lng (keyed by the English post id units name). 185 of 230 active projects are on the map (3,229 units); 40 projects / 431 units proven absent from both feeds. Served 0/3602 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('ramzalqasim', 'page-json', 95, 'https://ramzalqasim.com/x/223', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 109/109 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('rawaf', 'feed', 95, 'https://rawaf.ai/project/114', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 19/19 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('rawasidark', 'partial', 1, 'https://www.rawasi-dark.com/properties/cmnscv80b0000jj04lxkq9s4m', date '2026-10-30', 'Partial: pinned ad has a Maps link; cmnrbh42u… and cmnmad9t6… show nothing (1% served). Served 1/101 (1.0%) on 2026-10-30 before today''s fixes.'),
  ('razre', 'feed', 95, 'https://www.razre.sa/projects/raz-55/', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 18/18 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('reinvest', 'feed', 95, 'https://reinvest.sa/for-rent/showrooms/explore/riyadh/west-al-uraija/maard-llaygar-405', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 929/929 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('remal', 'none', 0, 'https://www.remalre.com/Real-estate/villas/makkah-moukarma/for-sale-villa-in-public-housing-in-ruseifa/', date '2026-10-30', 'Proven silent at source: the rendered maps?ll= link is drawn by Google''s JS from the ADDRESS (the raw page has no pair; two different ads sit 25 m apart) and the only short link is the office''s goo.gl on every page. A geocoded address is not a pin. Served 0/81 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('remaxsa', 'none', 0, 'https://www.remax.sa/en/listings/apartment/for-sale/الرياض/113033009-19', date '2026-10-30', 'Silent on 1 rendered ad: Leaflet loaded, no pair, link or frame; the page''s settings.json carries no pair. 7 ads. Served 0/7 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('rightcompound', 'feed', 95, 'https://rightcompound.com/compounds/khobar/palm-springs-compound', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 881/885 (99.5%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('ryadah', 'feed', 95, 'https://ryadah.com.sa/property/%d9%85%d8%b3%d8%aa-%d8%b3%d9%83%d9%88%d9%8a%d8%b1/', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 18/18 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('sadin', 'page-json', 1, 'https://www.sadin.com.sa', date '2026-10-30', '0 served rows on 2026-10-30; classified from the scraper''s read path (page-json). Floor 1 = «publishes»; measure on relaunch.'),
  ('sadiqeltajer', 'ad-page', 95, 'https://sadiq-eltajer.sa/ads/llaygar-mhlyn-shrk-bryd-hy-aldahy-alsharaa-alaaam-almsah-120mtr', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (ad-page); not re-opened in a browser today. Served 1709/1738 (98.3%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('safa', 'ad-page', 1, 'https://safainv.sa/units/rental?page=1&property_id=12914', date '2026-10-30', 'CAPTURE GAP (44 ads, 0%): the rendered page carries a maps.app.goo.gl short link; not followed. Backlog. Served 0/44 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('safera', 'none', 0, 'https://safera.inblaj.net/property/%d8%a7%d8%b3%d8%aa%d8%b1%d8%a7%d8%ad%d8%a9-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%b4%d9%85%d8%a7%d9%84-%d8%a8%d8%b1%d9%8a%d8%af%d8%a9-%d8%ad%d9%8a-%d8%a7%d9%84%d9%86%d9%88%d8%b1/', date '2026-10-30', 'UNVERIFIED 2026-10-30: timeout in the headless browser; provisional none (10 ads). Served 0/10 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('sakan', 'ad-page', 89, 'https://sa.sakan.co/ar/property/details/86163', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (ad-page); not re-opened in a browser today. Served 2345/2478 (94.6%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('sakani', 'feed', 95, 'https://sakani.sa/app/market-unit/24501', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 1873/1873 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('sanadak', 'page-json', 95, 'https://sanadak.sa/property-details/7200775576', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 847/849 (99.8%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('satel', 'feed', 95, 'https://listings.satel.sa/property/C0066', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 69/69 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('senan', 'feed', 1, 'https://www.senanrealestate.sa', date '2026-10-30', '0 served rows on 2026-10-30; classified from the scraper''s read path (feed). Floor 1 = «publishes»; measure on relaunch.'),
  ('shatri', 'ad-page', 1, 'https://shatrirealestate.com/property/apartments-sale-alsafa-jeddah-3-rooms/', date '2026-10-30', 'BUG fixed #9508: Houzez data-map=''{latitude, longitude}'' + JSON-LD geo on the ad PAGE (not in the REST post); one rendered ad read (the other timed out). Raise the floor after the first re-crawl. Served 0/50 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('shmoualshmal', 'none', 0, 'https://shmoua-alshmal.com/property/%d9%81%d9%8a%d9%84%d8%a7-%d9%85%d9%88%d8%af%d8%b1%d9%86-6-%d8%ba%d8%b1%d9%81/', date '2026-10-30', 'UNVERIFIED 2026-10-30: timeout in the headless browser; provisional none (6 ads). Served 0/6 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('shomou', 'partial', 10, 'https://shomoalaqar.com.sa/8308', date '2026-10-30', 'Partial: pinned ad has a Maps link (DMS shape handled); 8432 and 8436 show nothing. Served 26/141 (18.4%) on 2026-10-30 before today''s fixes.'),
  ('sirdab', 'partial', 45, 'https://marketplace.sirdab.co/ar/ads/5f70019b-e5a3-4ef2-a9c7-6133b9f102cb', date '2026-10-30', 'Partial: pinned ad has JSON + Maps link + short link; 9574c3f5… and 0e592431… show nothing. Served 304/563 (54.0%) on 2026-10-30 before today''s fixes.'),
  ('snam', 'feed', 1, 'https://snam.sa', date '2026-10-30', '0 served rows on 2026-10-30; classified from the scraper''s read path (feed). Floor 1 = «publishes»; measure on relaunch.'),
  ('sodasyat', 'ad-page', 1, 'https://sodasyat.sa/single/2722', date '2026-10-30', 'CAPTURE GAP (13 ads, 0%): the rendered page prints a Maps link 21.593931,39.215316 (1 ad seen). Backlog. Served 0/13 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('sokok', 'feed', 95, 'https://sokok.sa/piece/234329030/show', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 400/400 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('souq24', 'ad-page', 1, 'https://24.com.sa/1099/x', date '2026-10-30', 'CAPTURE GAP (46 ads, 0%): the rendered page prints a Maps link 16.8374,42.6478 (1 ad seen; Jazan). Backlog. Served 0/46 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('sqcc', 'partial', 1, 'https://sqcc.sa/realestate/%d8%b9%d9%85%d8%a7%d8%b1%d9%87-%d9%84%d9%84%d8%a8%d9%8a%d8%b9/', date '2026-10-30', 'Partial by the scraper''s own read (2 of 27 served); the pinless rendered ad printed a Maps link 26.412465,50.022384 — re-check whether the scraper misses it. Backlog. Served 2/27 (7.4%) on 2026-10-30 before today''s fixes.'),
  ('squares', 'none', 0, 'https://squares.com.sa/property/%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a%d9%84%d8%a7-%d8%a7%d9%84%d8%a8%d8%b3%d8%a7%d8%aa%d9%8a%d9%86-%d9%81%d9%8a-%d9%85%d8%af%d9%8a%d9%86%d8%a9-%d8%a8%d8%b1%d9%8a%d8%af%d8%a9/', date '2026-10-30', 'Silent on 1 rendered ad: Leaflet loaded, no pair, link or frame. 16 ads. Served 0/16 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('sukna', 'feed', 95, 'https://sukna.app/unit-details?id=658', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 280/285 (98.2%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('superoffice', 'project-page', 1, 'https://superoffice.sa/branch/as-suwaidi/unit/H19', date '2026-10-30', 'CAPTURE GAP (39 ads, 0%): the unit page''s Google embed is the BRANCH building (24.594860,46.695216) the unit sits in — one pair per branch, like a project pin. Below the 50-ad line; backlog. Served 0/39 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('suwar', 'none', 0, 'https://suwar.sa/property/%d9%85%d8%b4%d8%b1%d9%88%d8%b9-%d8%b1%d9%82%d9%85-955-%d9%81%d9%8a%d9%84%d8%a7-%d8%aa%d9%85%d9%84%d9%8a%d9%83-%d8%a7%d9%84%d9%85%d9%88%d9%82%d8%b9-%d9%85%d9%83%d8%a9-%d8%a7%d9%84%d9%86%d9%88%d8%a7/', date '2026-10-30', 'UNVERIFIED 2026-10-30: 403 to curl and a timeout in the headless browser (shared CDN challenge); the scraper reads no pin. Provisional none — re-open from a residential IP. Served 0/78 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('tamyaz', 'none', 0, 'https://www.tamyaz-sa.com/#property-prop-mv6vu14g89g7', date '2026-10-30', 'Silent: a single-page site whose ads are hash anchors; the only map is one site-wide embed 21.577807,39.246215 (the office). 15 ads. Served 0/15 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('tawia', 'page-json', 1, 'https://tawia.sa/properties/af75d047-cb1c-449c-9a81-4f77af87653e', date '2026-10-30', 'CAPTURE GAP (4 ads, 0%): the page''s JSON prints 27.019223,49.644855 and a goo.gl short link (1 ad seen). Backlog. Served 0/4 (0.0%) on 2026-10-30 before today''s fixes.'),
  ('therc', 'partial', 50, 'https://therc.aqar.digital/properties/fyla-llaygar-fy-sharaa-3212-hy-alnthym-mdyn-alryad-mntk-alryad', date '2026-10-30', 'Partial: pinned ad has a Maps link; two pinless ads show nothing. Served 269/457 (58.9%) on 2026-10-30 before today''s fixes.'),
  ('thousand', 'partial', 50, 'https://1000.com.sa/property/cmnh40ocy00h110i8axa8h7ye', date '2026-10-30', 'Partial: pinned ad has its own maps?q=LAT,LNG frame; pinless ads carry an address-text frame (q=الرياض - الازدهار) and the site''s shared short link 5f7vuTKUChEwCnt5A — neither is a pin. Served 74/119 (62.2%) on 2026-10-30 before today''s fixes.'),
  ('tuba', 'feed', 95, 'https://tuba.com.sa/property/office-for-rent-in-riyadh-100', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 3407/3409 (99.9%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('villassa', 'feed', 95, 'https://villas-sa.com/real/estate/ads/100', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 12/12 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('vmksa', 'page-json', 95, 'https://vm-ksa.com/ar/ads/763', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 194/195 (99.5%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('wadod', 'ad-page', 95, 'https://wadod.sa/property/93', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (ad-page); not re-opened in a browser today. Served 7/7 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('wahadat', 'feed', 95, 'https://wahadat.sa/project/%D9%88%D8%B4%D8%A7%D8%AD-%D8%A7%D9%84%D9%86%D8%B1%D8%AC%D8%B3', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 994/998 (99.6%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('wajaf', 'page-json', 95, 'https://wajaf.sa/properties/28/unit/66', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 48/48 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('wasalt', 'feed', 95, 'https://wasalt.sa/en/property/duplex-315-sqm-facing-west-with-6-bedrooms-5927297', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (feed); not re-opened in a browser today. Served 89241/89288 (99.9%). Floor = ratchet below today''s number; raise it, never lower it.'),
  ('wslnaa', 'feed', 20, 'https://wslnaa.com/properties/nada-avenue-apartment-22', date '2026-10-30', 'BUG fixed #9508: the tRPC API''s mapUrl is a maps.app.goo.gl short link per unit (3/3 rendered ads carry it; the three sampled units share their compound''s link); followed through page_pin. Served 17/61 (27.9%) on 2026-10-30 before today''s fixes.'),
  ('yameen', 'page-json', 95, 'https://www.yameen.sa/properties/52351', date '2026-10-30', 'Classified 2026-10-30 from the scraper''s read path (page-json); not re-opened in a browser today. Served 6/6 (100.0%). Floor = ratchet below today''s number; raise it, never lower it.')
on conflict (platform) do update set pin_source = excluded.pin_source, floor_pct = excluded.floor_pct,
  proof_url = excluded.proof_url, proven_on = excluded.proven_on, note = excluded.note, declared_at = now();

-- What we serve, per platform, beside what we declared. Judged only at >= 50 served ads (a 9-ad site at 0/9 is a
-- question for the engineer's report, not a P1); an UNDECLARED platform at >= 50 ads is itself a finding.
create or replace function public.pin_coverage_by_platform()
returns table(platform text, ads bigint, pins bigint, pct numeric, pin_source text, floor_pct int, below_floor boolean, why text)
language sql stable security definer set search_path to 'public' as $$
  select s.platform, count(*) ads, count(s.latitude) pins,
         round(100.0 * count(s.latitude) / count(*), 1) pct, d.pin_source, d.floor_pct,
         -- floor 1 means «publishes: at least one served pin» (a 1-of-101 site is not below a 1 % floor); floor 0 is `none`.
         count(*) >= 50 and (d.platform is null
                             or (d.pin_source <> 'none' and count(s.latitude) = 0)
                             or (d.floor_pct > 1 and 100.0 * count(s.latitude) / count(*) < d.floor_pct)) as below_floor,
         case when count(*) < 50 then null
              when d.platform is null then 'undeclared: no row in data/pin-sources.json'
              when d.pin_source <> 'none' and count(s.latitude) = 0 then 'declared ' || d.pin_source || ' but serves 0 pins (the rakez shape)'
              when d.floor_pct > 1 and 100.0 * count(s.latitude) / count(*) < d.floor_pct then 'below its declared floor' end as why
    from public.search_listings_ar s
    left join public.ops_pin_source_declared d on d.platform = s.platform
   where s.production_ready
   group by s.platform, d.platform, d.pin_source, d.floor_pct
   order by 2 desc;
$$;
revoke all on function public.pin_coverage_by_platform() from public, anon, authenticated;
grant execute on function public.pin_coverage_by_platform() to service_role;

create or replace function public.mon_detect_pin_coverage_below_floor()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows bigint; v_by jsonb; v_open boolean; r int := 0;
begin
  select count(*), coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'ads', ads, 'pins', pins, 'pct', pct,
                                                          'declared', pin_source, 'floor', floor_pct, 'why', why) order by ads desc), '[]'::jsonb)
    into v_rows, v_by
    from public.pin_coverage_by_platform() where below_floor;
  v_open := exists (select 1 from public.alert_event where dedup_key = 'pin_coverage_below_floor' and resolved_at is null);
  if v_rows = 0 then
    if v_open then perform public.mon_resolve('pin_coverage_below_floor', 'location'); end if;
  elsif not v_open then
    r := public.mon_raise('P1', 'pin_coverage_below_floor', 'location', 'pin_coverage_below_floor',
      jsonb_build_object('platforms', v_rows, 'per_platform', v_by, 'for', '⚡',
        'why', 'A platform serves fewer map pins than its declaration in data/pin-sources.json allows (or is declared as '
            || 'publishing pins and serves none, or is launched with no declaration). The source publishes them: find where '
            || '(the ad page, its embedded JSON / network calls, a site-wide map or list feed, the parent project page), fix '
            || 'the scraper, re-crawl, and let the :22 sync carry them. Never geocode an address into a pin, never lower the '
            || 'floor to clear this; a site proven silent is re-declared «none» with the URL you proved it on.'));
  end if;
  return r;
end $function$;
revoke all on function public.mon_detect_pin_coverage_below_floor() from public, anon, authenticated;
grant execute on function public.mon_detect_pin_coverage_below_floor() to service_role;

-- Roster (an unrostered detector is decoration). Needle-edit of the LIVE body, read in this same step.
do $roster$
declare d text; anchor text := '''mon_detect_district_carries_ad_block_text'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_pin_coverage_below_floor''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_pin_coverage_below_floor'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_pin_coverage_below_floor''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF: every declared floor holds today; a planted drop (one floor raised above what we serve) is caught, inside a
-- rolled-back sub-transaction; the detector is rostered, not orphaned.
do $proof$
declare base bigint; planted bigint; victim text; v_floor int;
begin
  select count(*) into base from public.pin_coverage_by_platform() where below_floor;
  if base <> 0 then
    raise exception 'PROOF: % platform(s) already below their declared floor — fix or re-declare before applying: %', base,
      (select string_agg(platform || ' ' || pct || '% < ' || coalesce(floor_pct::text, 'undeclared'), ', ') from public.pin_coverage_by_platform() where below_floor);
  end if;
  select platform, floor_pct into victim, v_floor from public.pin_coverage_by_platform()
   where ads >= 50 and pin_source <> 'none' and pct < 100 order by ads desc limit 1;
  if victim is null then raise exception 'PROOF: no platform to plant a drop on'; end if;
  begin
    update public.ops_pin_source_declared set floor_pct = 100 where platform = victim;
    select count(*) into planted from public.pin_coverage_by_platform() where below_floor;
    if planted <> base + 1 then raise exception 'PROOF: the planted floor on % was not caught (% vs %)', victim, planted, base; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  if (select floor_pct from public.ops_pin_source_declared where platform = victim) is distinct from v_floor then
    raise exception 'PROOF: the planted floor was not rolled back';
  end if;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_pin_coverage_below_floor') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: every declared pin floor holds; a planted drop on % is caught; rostered', victim;
end $proof$;
