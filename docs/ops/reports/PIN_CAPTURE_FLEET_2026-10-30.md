# Pin capture, fleet-wide — 2026-10-30

**Owner order:** «this needs serious investigation, fix, and never ever happen again» — map pins (latitude/longitude)
the source publishes but we never captured. rakez: 3,660 ads, 0 pins, six weeks.

## What was done

1. **Investigated** every platform below 90 % served pins (the served index `search_listings_ar`, `production_ready`):
   2–3 real ad pages per platform opened in a rendered headless Chromium (Playwright, the same engine as the browser
   pane), looking in all four places — the ad page, its embedded JSON / data attributes / network calls, a site-wide map
   or list feed, the parent project/compound page. 80 platforms, 146 pages. The raw HTML of every «publishes» hit was
   re-read with curl to find the shape the scraper must parse (a rendered `maps?ll=` link is often Google's JS drawing
   a pair that lives elsewhere in the raw page — or nowhere, when it geocoded the address).
2. **Fixed** 9 capture bugs in three scrapers-only PRs (auto-merge): rakez (#9503), compoundin + mustqr (#9507),
   alkhaas + awal + hajer + daryusuf + shatri + wslnaa (#9508). Each writes `pin_absent: true` when the page was read
   and carries no pin, and nothing when the page or hop failed (`tg_keep_stored_pin` keeps yesterday's pair). Nothing
   is geocoded, ever.
3. **Built the lock** (this PR): `data/pin-sources.json` — every active platform (149 rows) declares `pin_source`
   ∈ ad-page · page-json · feed · project-page · partial · none, a proof URL, the date and a coverage floor;
   `scripts/verify-pin-capture-declared.ts` fails `npm test` for an undeclared platform, a publishing site at floor 0,
   a `none` with a floor, a row no migration carries (mutation-proven, 10 mutants); launch checklist **box 10**;
   `ops_pin_source_declared` + `pin_coverage_by_platform()` + the rostered detector
   `mon_detect_pin_coverage_below_floor()` (P1 hourly: below floor, or declared publishing and serving 0, or launched
   undeclared — judged at ≥ 50 served ads; self-test plants a floor above what we serve and must catch it); the
   «📊 Pins» line in the Quality & Repair report; a lesson line in the Scraping and New-Listings engineer briefs.

## The verdict table (served pins before today's fixes; «after» is filled by the detector's first hours)

| platform | ads | pins before | verdict | where the pin lives | proof |
|---|---:|---:|---|---|---|
| rakez | 3,602 | 0 (0 %) | **BUG → fixed #9503** | site map feed `/ar/wp-json/hs-map/v1/projects?lang=en`, keyed by the English project id units name; 185/230 projects on the map | https://rakez.sa/ar/projects-map/ · https://rakez.sa/ar/project/27454/ (no map on the page) |
| haraj | 15,587 | 12,765 (81.9 %) | partial | the seller's Maps link, when set; GraphQL carries no pair for pinless ads | https://haraj.com.sa/11191638006 (pin) · 11191640369, 11191637649 (none) |
| abralosol | 2,972 | 275 (9.3 %) | partial (not a bug) | Maps place link only when the broker added one; `pin_absent` written otherwise | https://abralosol.com/6570 (pin) · 7981, 8018 (none) |
| ialqarawi | 2,618 | 2,145 (81.9 %) | partial (scraper's read; site refused the headless browser today) | Maps link «q= LAT,LNG» | https://ialqarawi.com/index.php?router=card&id=1999&catid=45 |
| nofodh | 2,556 | 1,811 (70.9 %) | partial | `maps?q=` frame only on ads that have one; JSON-LD geo = office, map-selector centre = default, never read | https://www.nofodh.sa/listings/326117 (pin) · 612433, 560136 (office only) |
| bossbih | 1,544 | 406 (26.3 %) | partial | the ad's own maps/place link; the embed is the office 25.361896,49.631982 on every page | https://bossbihoffice.com.sa/13298 (pin) · 13709, 14477 |
| ksaaqar | 1,448 | 383 (26.5 %) | partial (scraper's read; pages timed out in the headless browser) | raw pinless page: Maps JS, no pair | — |
| mustqr | 1,340 | 0 (0 %) | **partial, capture gap → fixed #9507** | the Maps link a broker pastes into the ad text (14 descriptions + raw_text bodies); API lat/lng restricted; JSON-LD geo = office 27.5114,41.7208 on every ad | https://mustqr.sa/property/3083 |
| aqalemhajer | 1,022 | 624 (61.1 %) | partial | maps.app.goo.gl short link, followed | https://aqalemhajer.com/4721 (pin) · 4001, 5359 (none) |
| alshawaf | 1,009 | 465 (46.1 %) | partial | the ad's own «الموقع» maps/place row; other ads' links + office embed 25.3841505,49.5916303 never read | https://alshawaf.com.sa/22379 (pin) · 21660, 21877 |
| eaqartabuk | 574 | 204 (35.5 %) | partial | real pins read; pinless ads print the site default 28.392151,36.57399 (Tabuk Park Mall), registered + stripped | …/property/…-971/ (pin) |
| sirdab | 563 | 304 (54.0 %) | partial | JSON + Maps link + short link when present | https://marketplace.sirdab.co/ar/ads/5f70019b-e5a3-4ef2-a9c7-6133b9f102cb |
| therc | 457 | 269 (58.9 %) | partial | Maps link when present | https://therc.aqar.digital/properties/fyla-llaygar-fy-sharaa-3212-hy-alnthym-mdyn-alryad-mntk-alryad |
| compoundin | 286 | 0 (0 %) | **BUG → fixed #9507** | inline `cinMapMarkers = [{marker:{position:{lat,lng}}}]` on the compound page (one marker = the compound) | https://compoundin.com/compounds/riyadh/azure-al-reem |
| eilmalriyada | 285 | 59 (20.7 %) | partial | Maps link + `api.eilmalriyada.com/api/recent/<id>` when present | https://eilmalriyada.com/real-estate/view/566 |
| daryusuf | 258 | 0 (0 %) | **BUG → fixed #9508** | Elementor iframe `maps?q=24°27'59.8"N 39°39'44.9"E` (DMS) per ad | https://daryusuf.com/en/portfolio/villa-for-rent-al-khalidiyah-district-madinah/ |
| alkhaas | 209 | 0 (0 %) | **BUG → fixed #9508** | «الذهاب إلى موقع الإعلان» → `google.com/maps?q=LAT,LNG` per ad (JS fallback lat 26.117342 never read) | https://alkhaas.net/ads/1003, 997, 1004 |
| aldarim | 156 | 140 (89.7 %) | partial | JSON + Maps link + short link when present | https://www.aldarim.sa/en/properties/48548 |
| shomou | 141 | 26 (18.4 %) | partial | Maps link (DMS shape) when present | https://shomoalaqar.com.sa/8308 |
| abwbna | 136 | 103 (75.7 %) | partial | JSON + Maps link when present | https://www.abwbna.com/properties/45172 |
| hajer | 124 | 0 (0 %) | **BUG → fixed #9508** | `var rem_property_map = {"latitude","longitude"}` per ad | https://hajerhouses.com/property/… (3 ads, distinct pairs) |
| thousand | 119 | 74 (62.2 %) | partial | own `maps?q=LAT,LNG` frame; pinless ads carry an address-text frame + the site's shared short link | https://1000.com.sa/property/cmnh40ocy00h110i8axa8h7ye |
| rawasidark | 101 | 1 (1.0 %) | partial | Maps link, rarely | https://www.rawasi-dark.com/properties/cmnscv80b0000jj04lxkq9s4m |
| alobid | 101 | 30 (29.7 %) | partial | Maps link when present | https://www.alobidoffice.com/properties/27673 |
| jazwtn | 97 | 0 | **proven silent** | no pair, no map library, no link, no feed (2/2 rendered ads) | https://jazwtn.sa/projects/… |
| aljassim | 91 | 23 (25.3 %) | partial | Maps link when present | https://aljassimaqar.com/4607 |
| albdah | 90 | 28 (31.1 %) | partial | Maps link + embed when present | https://albdah.sa/property/22Uec/details/ |
| opensooq | 88 | 71 (80.7 %) | partial | JSON + Maps link when present | https://sa.opensooq.com/ar/search/288663068 |
| remal | 81 | 0 | **proven silent** | rendered `maps?ll=` is Google's JS geocoding the ADDRESS (raw page: no pair; two ads 25 m apart); one office goo.gl link on every page | https://www.remalre.com/Real-estate/villas/makkah-moukarma/for-sale-villa-in-public-housing-in-ruseifa/ |
| suwar | 78 | 0 | unverified (403 + timeout to both clients) | provisional `none` | — |
| justsa | 73 | 0 | **proven silent** | nothing on 3/3 rendered ads | https://just.sa/l/727 |
| macsaib | 63 | 2 (3.2 %) | partial | the only embed is the office 26.361853,43.9304608 on every ad (never read) | https://macsaib.sa/property/fyla-hy-alrhab |
| wslnaa | 61 | 17 (27.9 %) | **capture gap → fixed #9508** | the tRPC API's `mapUrl` short link per unit, followed | https://wslnaa.com/properties/nada-avenue-apartment-22 |
| bahadhabab | 53 | 11 (20.8 %) | partial | JSON pair when present | https://www.bahadhabab-res.com/properties/38741 |
| awal | 51 | 0 (0 %) | **BUG → fixed #9508** | `<div class="marker" data-latitude data-longitude>` per ad (office JSON never read) | https://awaalun.com/property/… (3 ads, distinct pairs) |
| shatri | 50 | 0 (0 %) | **BUG → fixed #9508** | Houzez `data-map='{"latitude","longitude"}'` on the ad PAGE (not in the REST post) | https://shatrirealestate.com/property/apartments-sale-alsafa-jeddah-3-rooms/ |

Below the 50-ad detector line (45 small platforms, 1 rendered ad each): proven silent — alajlan, almotmkenah, alqasem,
alrifai, alsidra (prints the KSA centroid 23.8859,45.0792), aqaralriyadh, aqarnajran, azdad, azure, ego, eydah, fkralemar,
marksa, hasaad (plus-code place embed), qmra (text place embed), squares, remaxsa, tamyaz (one office embed);
partial by the scraper's own read — eightfloor, october, hazim, nawafeth, holoul, jawher, jurash, mobasher, arsh,
nowaisiry; **capture gaps queued as backlog #1111** (declared publishing, floor 1, 0 % served) — albukaeri, daraa, flow,
livingcompound, alta, amaall, aqaralsaudia, sodasyat, souq24, safa, superoffice, tawia, sqcc; **unverified** (403 /
timeout to curl and the headless browser, provisional `none`) — suwar, aalbarrak, fahadalshahri, gudai, masar, safera,
shmoualshmal.

Platforms at ≥ 90 % were not re-opened today; their rows are classified from the scraper's read path with a ratchet
floor just under today's number and a served ad that carries the pin as proof.

## Bugs fixed (both halves)

| site | ads | before | fix | backfill |
|---|---:|---:|---|---|
| rakez | 3,602 | 0 | feed once per crawl; unit inherits its project's pin, `pin_scope: project`; 40 projects / 431 units proven absent from the map → `pin_absent` | targeted `small-sources-sync source=rakez` after #9503 merged, then the :22 sync — numbers below |
| compoundin | 286 | 0 | `cinMapMarkers` marker, `pin_scope: compound` | after #9507 |
| mustqr | 1,340 | 0 | Maps link in the ad text, read before `ad_body()` drops it | after #9507 (a few % — partial at source) |
| alkhaas | 209 | 0 | `maps?q=` link | after #9508 |
| awal | 51 | 0 | marker data attributes | after #9508 |
| hajer | 124 | 0 | `rem_property_map` | after #9508 |
| daryusuf | 258 | 0 | DMS iframe via `page_pin` | after #9508 |
| shatri | 50 | 0 | Houzez `data-map`, one GET per row | after #9508 |
| wslnaa | 61 | 17 | API `mapUrl` short link followed | after #9508 |

### After (filled as the backfills land)

AFTER_PLACEHOLDER

## Still open

- Apply + mirror the detector migration once every fixed site serves ≥ 1 pin (its proof refuses to apply while a
  declared publisher serves 0 — that is the rule working, not a bug); raise the floors of the 8 fixed sites after
  their first re-crawl (two-place edit: `data/pin-sources.json` + a `*_pin_source*` migration).
- Backlog #1111: the 13 small capture gaps above.
- Re-open the 7 unverified sites from a residential IP; re-declare any that publish.
- rakez: 40 projects (431 units) are on neither feed — listed in every crawl log; nothing to do unless the site maps them.
