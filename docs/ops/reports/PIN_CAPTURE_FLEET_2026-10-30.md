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

Measured in `search_listings_ar` (production_ready) after the 02:22 UTC sync on 2026-10-31:

| site | served ads | pins before | pins after | note |
|---|---:|---:|---:|---|
| rakez | 3,536 | 0 (0 %) | **3,032 (85.7 %)** | 185 project points; 536 units under 40 projects proven absent from both feeds |
| compoundin | 286 | 0 (0 %) | **262 (91.6 %)** | |
| alkhaas | 209 | 0 (0 %) | **195 (93.3 %)** | |
| daryusuf | 258 | 0 (0 %) | **253 (98.1 %)** | |
| hajer | 124 | 0 (0 %) | **116 (93.5 %)** | additional_info is now `{rows, latitude, longitude}` (the legacy bare list could never carry a pin) |
| awal | 51 | 0 (0 %) | **48 (94.1 %)** | |
| shatri | 50 | 0 (0 %) | **49 (98.0 %)** | |
| mustqr | 1,345 | 0 (0 %) | 1 (0.1 %) | partial at source; the brokers' links are goo.gl short links and Google answers the runner's hop with a 200 script page — the stored value is honest, the gain needs the browser hop lane |
| wslnaa | 61 | 17 (27.9 %) | 17 (27.9 %) | same hop block on the API's short links; the stored commercial pins stay |

**Fleet:** 405,425 / 425,042 served ads with a pin (95.38 %) before → **408,753 / 424,365 (96.32 %)** after, **+3,328 pins** in one night.

**The lock is live:** migration `20261031023715_pin_source_declared_and_detector` applied 02:37 UTC — 149 declared rows,
`pin_coverage_by_platform()` reports 0 platforms below floor, `mon_detect_pin_coverage_below_floor()` rostered (returned 0
on its first run, not orphaned). Floors of the six re-crawled sites were raised in the same change (compoundin, alkhaas,
hajer 85 · daryusuf, shatri 90 · awal 85).

## Still open

- mustqr 1/1,345 and wslnaa 17/61 — ROOT CAUSE: their pins are `maps.app.goo.gl` short links (mustqr ids 2923, 3876,
  3877 …; every wslnaa unit) and Google answers the runner's plain and proxy hops with a 200 script page, so the scrapers
  wrote nothing (honest: neither a pin nor `pin_absent`). Fixed in #9509: both sources now run on the `browser: true` lane
  of `small-sources-sync.yml` (PIN_BROWSER_HOP=1, the 2026-10-20 lane that resolved the three small sites). Proof = the
  next crawl + sync; then raise their floors (backlog #1112, scraping-engineer).
- The mirror PR #9520 cannot go green on its own: the migration cites `scripts/verify-pin-capture-declared.ts`, which
  lives in the lock PR, and `verify-ops-remediation-scripts-exist.ts` refuses a claim to a file not on that branch. The
  lock PR #9509 carries the byte-exact migration too, so it is the one that lands the mirror; #9520 is closed after it.
- The app draws Ezhalah's own ad page (and its pin) only for IN_APP_PREVIEW_HOSTS; rakez and the other fixed sites open
  the SOURCE framed, and `/map` is still the placeholder — the pin is served but not yet drawn for them. Owner call.
- Backlog #1111: the 13 small capture gaps above.
- Re-open the 7 unverified sites from a residential IP; re-declare any that publish.
- rakez: 40 projects (431 units) are on neither feed — listed in every crawl log; nothing to do unless the site maps them.

## Appendix — every platform, its verdict and proof (149 rows = `data/pin-sources.json`; nothing skipped)

Verdict words: **publishes · <where>** (the scraper reads it; «BUG fixed» = it did not until tonight), **partial** (the site shows a pin only on some ads; the scraper reads it when present), **proven silent** (the URL shows no pin in any of the four places), **UNVERIFIED** (the site answered 403 / timed out to both curl and the headless browser tonight — declared `none` provisionally, to re-open from a residential IP), **capture gap** (the page publishes, the scraper does not read it yet; below the 50-ad detector line; backlog #1111), **not re-opened today** (≥ 90 % served; classified from the scraper's read path with a ratchet floor).

| platform | served ads | pins before (share) | verdict | floor | proof URL |
|---|---:|---:|---|---:|---|
| aqar | 179,392 | 178,995 (99.8 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://sa.aqar.fm/6943435 |
| wasalt | 89,288 | 89,241 (99.9 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://wasalt.sa/en/property/duplex-315-sqm-facing-west-with-6-bedrooms-5927297 |
| dealapp | 46,303 | 46,120 (99.6 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://dealapp.sa/ar/ad-details/581109 |
| muhaysini | 19,816 | 19,812 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://aqaralmuhaysini.com/propertydetails/17910 |
| haraj | 15,587 | 12,765 (81.9 %) | partial (pin only on some ads) | 75 | https://haraj.com.sa/11191638006 |
| gathern | 15,117 | 15,103 (99.9 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://gathern.co/view/65814/unit/99257 |
| dwelleo | 4,517 | 4,484 (99.3 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://www.dwelleo.sa/ar/properties/9000-sqm-office-space-for-rent-in-al-suwaidi-riyadh |
| muktamel | 3,892 | 3,892 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://www.muktamel.com/real-estates/34319 |
| aqarmonthly | 3,678 | 3,618 (98.4 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://sa.aqar.fm/6828618 |
| rakez | 3,602 | 0 (0.0 %) | publishes · feed/API — BUG fixed | 80 | https://rakez.sa/ar/wp-json/hs-map/v1/projects?lang=en |
| tuba | 3,409 | 3,407 (99.9 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://tuba.com.sa/property/office-for-rent-in-riyadh-100 |
| abralosol | 2,972 | 275 (9.3 %) | partial (pin only on some ads) | 5 | https://abralosol.com/6570 |
| ialqarawi | 2,618 | 2,145 (81.9 %) | partial (pin only on some ads) | 75 | https://ialqarawi.com/index.php?router=card&id=1999&catid=45 |
| nofodh | 2,556 | 1,811 (70.9 %) | partial (pin only on some ads) | 60 | https://www.nofodh.sa/listings/326117 |
| sakan | 2,478 | 2,345 (94.6 %) | publishes · ad page — not re-opened today (scraper read path) | 89 | https://sa.sakan.co/ar/property/details/86163 |
| aqarcity | 2,100 | 2,095 (99.8 %) | publishes · ad page — not re-opened today (scraper read path) | 95 | https://www.aqarcity.net/property/27803 |
| arkaan | 1,934 | 1,877 (97.1 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://arkaanalaqar.com/property/1907 |
| sakani | 1,873 | 1,873 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://sakani.sa/app/market-unit/24501 |
| sadiqeltajer | 1,738 | 1,709 (98.3 %) | publishes · ad page — not re-opened today (scraper read path) | 95 | https://sadiq-eltajer.sa/ads/llaygar-mhlyn-shrk-bryd-hy-aldahy-alsharaa-alaaam-almsah-120mtr |
| bossbih | 1,544 | 406 (26.3 %) | partial (pin only on some ads) | 15 | https://bossbihoffice.com.sa/13298 |
| ksaaqar | 1,448 | 383 (26.5 %) | partial (pin only on some ads) | 15 | https://ksaaqar.com/ad/%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d8%b4%d9%82%d8%a9-%d8%b9%d8%a7%d8%a6%d9%84%d9%8a%d9%87-%d9%81%d8%a7%d8%ae%d8%b1%d8%a9-%d9%81-%d8%a3%d8%a8%d8%ad%d8%b1-%d8%a7%d9%84%d8%b4%d9%85%d8%a7%d9%84/ |
| mustqr | 1,340 | 0 (0.0 %) | partial (pin only on some ads) — BUG fixed | 1 | https://mustqr.sa/property/3083 |
| aqalemhajer | 1,022 | 624 (61.1 %) | partial (pin only on some ads) | 50 | https://aqalemhajer.com/4721 |
| alshawaf | 1,009 | 465 (46.1 %) | partial (pin only on some ads) | 35 | https://alshawaf.com.sa/22379 |
| wahadat | 998 | 994 (99.6 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://wahadat.sa/project/%D9%88%D8%B4%D8%A7%D8%AD-%D8%A7%D9%84%D9%86%D8%B1%D8%AC%D8%B3 |
| reinvest | 929 | 929 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://reinvest.sa/for-rent/showrooms/explore/riyadh/west-al-uraija/maard-llaygar-405 |
| rightcompound | 885 | 881 (99.5 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://rightcompound.com/compounds/khobar/palm-springs-compound |
| sanadak | 849 | 847 (99.8 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://sanadak.sa/property-details/7200775576 |
| manzo | 795 | 793 (99.7 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://manzo.com.sa/ar/property/long_term_rent-140m2-86yb8vWa |
| ashab | 623 | 623 (100.0 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://ashab.sa/properties/166463 |
| eaqartabuk | 574 | 204 (35.5 %) | partial (pin only on some ads) | 25 | https://eaqartabuk.com/property/%d9%81%d9%8a%d9%84%d8%a7-%d8%b1%d9%88%d9%81-%d8%b9%d9%84%d9%88%d9%8a-%d9%85%d8%b3%d8%aa%d9%82%d9%84-%d8%ad%d9%8a-%d8%a7%d9%84%d9%8a%d9%88%d8%a7%d8%af%d9%8a-971/ |
| sirdab | 563 | 304 (54.0 %) | partial (pin only on some ads) | 45 | https://marketplace.sirdab.co/ar/ads/5f70019b-e5a3-4ef2-a9c7-6133b9f102cb |
| therc | 457 | 269 (58.9 %) | partial (pin only on some ads) | 50 | https://therc.aqar.digital/properties/fyla-llaygar-fy-sharaa-3212-hy-alnthym-mdyn-alryad-mntk-alryad |
| abaad | 446 | 446 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://app.abaadapp.sa/details/601 |
| raghdan | 401 | 393 (98.0 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://raghdan.sa/ar/property/522621620527/ |
| sokok | 400 | 400 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://sokok.sa/piece/234329030/show |
| nufouth | 326 | 326 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://nufouth.com/latest-offers?ads-N4310=1 |
| akariyoun | 325 | 324 (99.7 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://akariyoun.sa/properties/msnaa-llaygar-fy-hy-almsfa |
| alsaedan | 325 | 300 (92.3 %) | publishes · ad page — not re-opened today (scraper read path) | 87 | https://alsaedan.com/sales/unit/3396 |
| goldendeal | 318 | 308 (96.9 %) | publishes · ad page — not re-opened today (scraper read path) | 91 | https://www.goldendeal.sa/properties/49174 |
| compoundin | 286 | 0 (0.0 %) | publishes · parent page — BUG fixed | 1 | https://compoundin.com/compounds/riyadh/azure-al-reem |
| amlakalahsa | 285 | 267 (93.7 %) | publishes · feed/API — not re-opened today (scraper read path) | 88 | https://amlakalahsa.com/land/%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%a7%d8%b1%d8%b6-%d9%81%d9%8a-%d8%a7%d9%84%d9%88%d8%b1%d9%88%d8%af-%d8%a7%d9%84%d8%ba%d8%b1%d8%a8%d9%8a/ |
| eilmalriyada | 285 | 59 (20.7 %) | partial (pin only on some ads) | 10 | https://eilmalriyada.com/real-estate/view/566 |
| sukna | 285 | 280 (98.2 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://sukna.app/unit-details?id=658 |
| daryusuf | 258 | 0 (0.0 %) | publishes · ad page — BUG fixed | 1 | https://daryusuf.com/en/portfolio/villa-for-rent-al-khalidiyah-district-madinah/ |
| maqrat | 235 | 235 (100.0 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://maqrat.com/Property/Details/60 |
| alkhaas | 209 | 0 (0.0 %) | publishes · ad page — BUG fixed | 1 | https://alkhaas.net/ads/1003 |
| ebriza | 203 | 203 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://ebriza.com.sa/for_sell/626/%D8%A3%D8%A8%D9%87%D8%A7/%D8%A7%D9%84%D8%B4%D8%B1%D9%82%D9%8A%D8%A9/%D8%A7%D8%B1%D8%B6-%D8%A8%D9%8A%D8%B9 |
| vmksa | 195 | 194 (99.5 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://vm-ksa.com/ar/ads/763 |
| gomenassat | 177 | 175 (98.9 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://gomenassat.com/ar/offer/792 |
| abeea | 176 | 176 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://abeea.com.sa/en/property/five-shop-openings-for-rent-in-al-muhandeseen-plan/ |
| eastabha | 168 | 164 (97.6 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://eastabha.sa/estate_property/4001/ |
| aldarim | 156 | 140 (89.7 %) | partial (pin only on some ads) | 80 | https://www.aldarim.sa/en/properties/48548 |
| ibaax | 153 | 152 (99.3 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://ibaax.sa/ar/advertisements/763 |
| shomou | 141 | 26 (18.4 %) | partial (pin only on some ads) | 10 | https://shomoalaqar.com.sa/8308 |
| aqargate | 140 | 139 (99.3 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://aqargate.com/property/%d9%85%d9%83%d8%aa%d8%a8-%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%85%d9%86%d8%b7%d9%82%d8%a9-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6-62/ |
| abwbna | 136 | 103 (75.7 %) | partial (pin only on some ads) | 65 | https://www.abwbna.com/properties/45172 |
| aqaratikom | 125 | 123 (98.4 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://nawait.sa/real-estate/6dbb596f-4df9-4b67-a984-41f92133ffa7 |
| hajer | 124 | 0 (0.0 %) | publishes · ad page — BUG fixed | 1 | https://hajerhouses.com/property/%d8%a8%d9%8a%d8%aa-%d9%85%d9%83%d9%88%d9%86-%d9%85%d9%86-%d8%af%d9%88%d8%b1-%d9%88%d8%ab%d9%84%d8%a7%d8%ab-%d8%b4%d9%82%d9%82-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84/ |
| thousand | 119 | 74 (62.2 %) | partial (pin only on some ads) | 50 | https://1000.com.sa/property/cmnh40ocy00h110i8axa8h7ye |
| ramzalqasim | 109 | 109 (100.0 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://ramzalqasim.com/x/223 |
| alobid | 101 | 30 (29.7 %) | partial (pin only on some ads) | 20 | https://www.alobidoffice.com/properties/27673 |
| rawasidark | 101 | 1 (1.0 %) | partial (pin only on some ads) | 1 | https://www.rawasi-dark.com/properties/cmnscv80b0000jj04lxkq9s4m |
| jazwtn | 97 | 0 (0.0 %) | proven silent | 0 | https://jazwtn.sa/projects/%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%82%d8%b7%d8%b9%d8%a9-%d8%b1%d9%82%d9%85-1006-%d9%81%d9%8a-%d9%85%d8%ae%d8%b7%d8%b7-482-%d8%a8%d8%ad%d9%8a-%d8%a7%d9%84%d8%b1%d9%88%d8%a7%d8%a8%d9%8a-%d8%b6%d8%a7/ |
| aljassim | 91 | 23 (25.3 %) | partial (pin only on some ads) | 15 | https://aljassimaqar.com/4607 |
| albdah | 90 | 28 (31.1 %) | partial (pin only on some ads) | 20 | https://albdah.sa/property/22Uec/details/ |
| opensooq | 88 | 71 (80.7 %) | partial (pin only on some ads) | 70 | https://sa.opensooq.com/ar/search/288663068 |
| remal | 81 | 0 (0.0 %) | proven silent | 0 | https://www.remalre.com/Real-estate/villas/makkah-moukarma/for-sale-villa-in-public-housing-in-ruseifa/ |
| suwar | 78 | 0 (0.0 %) | proven silent — UNVERIFIED | 0 | https://suwar.sa/property/%d9%85%d8%b4%d8%b1%d9%88%d8%b9-%d8%b1%d9%82%d9%85-955-%d9%81%d9%8a%d9%84%d8%a7-%d8%aa%d9%85%d9%84%d9%8a%d9%83-%d8%a7%d9%84%d9%85%d9%88%d9%82%d8%b9-%d9%85%d9%83%d8%a9-%d8%a7%d9%84%d9%86%d9%88%d8%a7/ |
| manafe | 77 | 72 (93.5 %) | publishes · page JSON — not re-opened today (scraper read path) | 88 | https://manafe.com.sa/manafemar/project/285 |
| aouj | 75 | 69 (92.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 87 | https://aoujestates.com/ar/properties/%D8%AF%D8%A8%D9%84%D9%83%D8%B3%D9%8A%D9%86-%D9%81%D9%8A-%D8%AD%D9%8A-%D8%A7%D9%84%D8%B4%D8%B1%D8%A7%D8%B9 |
| justsa | 73 | 0 (0.0 %) | proven silent | 0 | https://just.sa/l/727 |
| satel | 69 | 69 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://listings.satel.sa/property/C0066 |
| macsaib | 63 | 2 (3.2 %) | partial (pin only on some ads) | 1 | https://macsaib.sa/property/fyla-hy-alrhab |
| wslnaa | 61 | 17 (27.9 %) | publishes · feed/API — BUG fixed | 20 | https://wslnaa.com/properties/nada-avenue-apartment-22 |
| earthapp | 57 | 57 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://map.earthapp.com.sa/offers/2662819 |
| bahadhabab | 53 | 11 (20.8 %) | partial (pin only on some ads) | 10 | https://www.bahadhabab-res.com/properties/38741 |
| awal | 51 | 0 (0.0 %) | publishes · ad page — BUG fixed | 1 | https://awaalun.com/property/%d8%a7%d8%b1%d8%b6-%d9%85%d8%b3%d9%88%d8%b1%d9%87/ |
| expattrusted | 50 | 49 (98.0 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://expattrustedhousingriyadh.com/p/en/property/al-bustan-village |
| shatri | 50 | 0 (0.0 %) | publishes · ad page — BUG fixed | 1 | https://shatrirealestate.com/property/apartments-sale-alsafa-jeddah-3-rooms/ |
| wajaf | 48 | 48 (100.0 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://wajaf.sa/properties/28/unit/66 |
| souq24 | 46 | 0 (0.0 %) | publishes · ad page — capture gap (backlog #1111) | 1 | https://24.com.sa/1099/x |
| erapulse | 45 | 44 (97.8 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://erapulse.sa/property/buraydah-land-sale-ref-msrx3eyl-07fd9 |
| safa | 44 | 0 (0.0 %) | publishes · ad page — capture gap (backlog #1111) | 1 | https://safainv.sa/units/rental?page=1&property_id=12914 |
| jawher | 42 | 35 (83.3 %) | partial (pin only on some ads) | 75 | https://www.jawher2030.com/properties/52519 |
| maqam | 42 | 38 (90.5 %) | publishes · feed/API — not re-opened today (scraper read path) | 85 | https://property.maqamco.sa/properties/51641 |
| mobasher | 40 | 32 (80.0 %) | partial (pin only on some ads) | 70 | https://mobasher.sa/direct/realestate/%D8%A7%D8%B1%D8%B6-%D8%B2%D8%B1%D8%A7%D8%B9%D9%8A%D8%A9-%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6-%D8%A7%D9%84%D8%B9%D9%85%D8%A7%D8%B1%D9%8A%D8%A9--1785325075506 |
| aqarnajran | 39 | 0 (0.0 %) | proven silent | 0 | https://aqarnajran.com/%d8%a8%d9%8a%d8%aa-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%b2%d9%88%d8%b1-%d8%a7%d9%84%d8%b9%d9%85%d8%a7%d8%b1%d9%8a-%d9%86%d8%ac%d8%b1%d8%a7%d9%86%d8%8c-%d9%85%d8%b3%d8%a7%d8%ad/ |
| superoffice | 39 | 0 (0.0 %) | publishes · parent page — capture gap (backlog #1111) | 1 | https://superoffice.sa/branch/as-suwaidi/unit/H19 |
| m3tmd | 37 | 36 (97.3 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://www.m3tmd.com/properties/37109 |
| mizlaj | 33 | 33 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://mizlaj.com.sa/guest/listings/aakar-371961m2-llbyaa-almdyn-almnor-4tcrzkwY |
| amaall | 32 | 0 (0.0 %) | publishes · page JSON — capture gap (backlog #1111) | 1 | https://www.amaall.com/projects/%d8%a3%d8%b1%d8%b6-%d8%b3%d9%83%d9%86%d9%8a%d8%a9-%d8%a8%d9%85%d9%83%d8%a9-%d8%a7%d9%84%d9%85%d9%83%d8%b1%d9%85%d8%a9-%d8%ad%d9%8a-%d8%a7%d9%84%d8%b9%d8%b2%d9%8a%d8%b2%d9%8a%d8%a9/ |
| azure | 32 | 0 (0.0 %) | proven silent | 0 | https://azure.sa/compounds/al-reem |
| holoul | 30 | 14 (46.7 %) | partial (pin only on some ads) | 35 | https://app.holoul.io/units/10a9d527-6534-4915-abcb-4298d7e30aa0 |
| alsidra | 29 | 0 (0.0 %) | proven silent | 0 | https://alsidra.com.sa/property/%d8%b4%d9%82%d8%a9-%d9%81%d8%a7%d8%ae%d8%b1%d8%a9-%d9%84%d9%84%d8%a7%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%ad%d8%b2%d8%a7%d9%85-%d8%a7%d9%84%d8%b0%d9%87%d8%a8%d9%8a-%d8%a7/ |
| alhoshan | 27 | 27 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://www.alhoshan.sa/properties/1002 |
| sqcc | 27 | 2 (7.4 %) | partial (pin only on some ads) | 1 | https://sqcc.sa/realestate/%d8%b9%d9%85%d8%a7%d8%b1%d9%87-%d9%84%d9%84%d8%a8%d9%8a%d8%b9/ |
| nafithh | 26 | 26 (100.0 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://nafithh.com/web/gallery/266 |
| alqasem | 23 | 0 (0.0 %) | proven silent | 0 | https://alqasem.com.sa/property/%d8%af%d9%88%d8%b1-vip-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-g2b/ |
| almotmkenah | 22 | 0 (0.0 %) | proven silent | 0 | https://almotmkenah.com/annonce/%D9%85%D8%B4%D8%B1%D9%88%D8%B9_%D8%A7%D8%B1%D8%A8%D8%B9_%D9%81%D9%84%D9%84_%D9%85%D8%B3%D8%AA%D9%82%D9%84%D9%87_%D9%84%D9%84%D8%A8%D9%8A%D8%B9_%D9%81%D9%8A_%D8%AD%D9%8A_%D8%A7%D9%84%D8%AC%D9%86%D8%A7%D8%AF%D8%B1%D9%8A%D8%A9-3 |
| arsh | 21 | 17 (81.0 %) | partial (pin only on some ads) | 70 | https://www.arshglobal.com.sa/%D8%A3%D8%B1%D8%B6-%D8%AA%D8%AC%D8%A7%D8%B1%D9%8A%D8%A9 |
| ego | 21 | 0 (0.0 %) | proven silent | 0 | https://ego-aqar.com/unit-details/2409 |
| nowaisiry | 21 | 11 (52.4 %) | partial (pin only on some ads) | 40 | https://alnowaisiry.com/lands/%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%a7%d8%b1%d8%b6-360-%d9%85%d8%aa%d8%b1-%d9%81%d9%8a-%d9%85%d8%ae%d8%b7%d8%b7-%d8%a7%d9%84%d8%ae%d9%8a%d8%b1-%d8%a7%d9%84%d8%a3%d9%85%d8%b1%d8%a7%d8%a1-3541/ |
| albukaeri | 20 | 0 (0.0 %) | publishes · ad page — capture gap (backlog #1111) | 1 | https://albukaeri.sa/property/69d220c494242c82c5bc7686 |
| azdad | 20 | 0 (0.0 %) | proven silent | 0 | https://www.azdadalaqaria.com/property/e0b35c05-9b14-42d0-997b-1a857566a825 |
| flow | 20 | 0 (0.0 %) | publishes · ad page — capture gap (backlog #1111) | 1 | https://flow.life/en/properties/riyadh-narjis/available-homes/tihama-3-bedroom/fid/o6j2UXkv0Lr9J0YjzDDL |
| maktab | 20 | 20 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://maktab.sa/details/91 |
| rawaf | 19 | 19 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://rawaf.ai/project/114 |
| razre | 18 | 18 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://www.razre.sa/projects/raz-55/ |
| ryadah | 18 | 18 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://ryadah.com.sa/property/%d9%85%d8%b3%d8%aa-%d8%b3%d9%83%d9%88%d9%8a%d8%b1/ |
| alrifai | 17 | 0 (0.0 %) | proven silent | 0 | https://alrifai.com.sa/index.php?page=property-detail&id=92 |
| livingcompound | 17 | 0 (0.0 %) | publishes · ad page — capture gap (backlog #1111) | 1 | https://livingcompound.com/property/2-bedroom-fully-furnished-apartment-for-rent-al-fayha-jeddah/ |
| aqaralsaudia | 16 | 0 (0.0 %) | publishes · page JSON — capture gap (backlog #1111) | 1 | https://aqaralsaudia.com/property/%d8%b4%d9%82%d8%a9-%d9%81%d8%a7%d8%ae%d8%b1%d8%a9-%d8%a7%d8%b1%d8%b6%d9%8a%d8%a9-%d8%a8%d8%ad%d9%8a-%d9%84%d8%a8%d9%86-%d8%b1%d9%82%d9%85-1/ |
| squares | 16 | 0 (0.0 %) | proven silent | 0 | https://squares.com.sa/property/%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a%d9%84%d8%a7-%d8%a7%d9%84%d8%a8%d8%b3%d8%a7%d8%aa%d9%8a%d9%86-%d9%81%d9%8a-%d9%85%d8%af%d9%8a%d9%86%d8%a9-%d8%a8%d8%b1%d9%8a%d8%af%d8%a9/ |
| jurash | 15 | 13 (86.7 %) | partial (pin only on some ads) | 80 | https://jurash.sa/property/97/ |
| nawafeth | 15 | 9 (60.0 %) | partial (pin only on some ads) | 50 | https://nawafethalwatan.com/Advserments/GetAdvsertismentDetail?advsertismentId=173 |
| tamyaz | 15 | 0 (0.0 %) | proven silent | 0 | https://www.tamyaz-sa.com/#property-prop-mv6vu14g89g7 |
| aqaralriyadh | 14 | 0 (0.0 %) | proven silent | 0 | https://aqaralriyadh.com/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%a3%d9%86%d8%af%d9%84%d8%b3-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6/ |
| dallali | 14 | 14 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://dallali.com/advertisements/property/fa37876f-451b-45a4-92a1-b4cccfd0941c |
| sodasyat | 13 | 0 (0.0 %) | publishes · ad page — capture gap (backlog #1111) | 1 | https://sodasyat.sa/single/2722 |
| gudai | 12 | 0 (0.0 %) | proven silent — UNVERIFIED | 0 | https://gudai.inblaj.net/property/%d8%a3%d8%b1%d8%b6-%d8%b3%d9%83%d9%86%d9%8a%d8%a9-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d9%81%d9%8a%d8%ad%d8%a7%d8%a1-%d8%a7%d9%84%d8%af%d9%85%d8%a7%d9%85/ |
| hasaad | 12 | 0 (0.0 %) | proven silent | 0 | https://hasaadestate.com/projects/%d8%ac%d9%88%d8%a7%d8%b1-19/ |
| villassa | 12 | 12 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://villas-sa.com/real/estate/ads/100 |
| alajlan | 11 | 0 (0.0 %) | proven silent | 0 | https://alajlan-re.com/ |
| muajarh | 11 | 11 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://muajarh.com/properties/property-1785346629908 |
| fkralemar | 10 | 0 (0.0 %) | proven silent | 0 | https://www.fkralemar.com/offers/apartment-for-sale |
| safera | 10 | 0 (0.0 %) | proven silent — UNVERIFIED | 0 | https://safera.inblaj.net/property/%d8%a7%d8%b3%d8%aa%d8%b1%d8%a7%d8%ad%d8%a9-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%b4%d9%85%d8%a7%d9%84-%d8%a8%d8%b1%d9%8a%d8%af%d8%a9-%d8%ad%d9%8a-%d8%a7%d9%84%d9%86%d9%88%d8%b1/ |
| aalbarrak | 9 | 0 (0.0 %) | proven silent — UNVERIFIED | 0 | https://aalbarrak.com/property/%d9%81%d9%8a%d9%84%d8%a7-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d8%b4%d8%a7%d8%b1%d8%b9-%d8%a7%d9%84%d9%85%d9%86%d8%aa%d8%b5%d8%b1-%d8%ad%d9%8a-%d8%a7%d9%84%d9%86/ |
| fursaghyr | 8 | 8 (100.0 %) | publishes · feed/API — not re-opened today (scraper read path) | 95 | https://fursaghyr.com/property/%d8%b9%d9%85%d8%a7%d8%b1%d8%a9-%d8%a8%d9%8a%d8%b9-%d9%85%d9%86%d8%b7%d9%82%d8%a9-%d8%a7%d9%84%d9%85%d8%af%d9%8a%d9%86%d8%a9-%d8%a7%d9%84%d9%85%d9%86%d9%88%d8%b1%d8%a9/ |
| alta | 7 | 0 (0.0 %) | publishes · page JSON — capture gap (backlog #1111) | 1 | https://alta.com.sa/estate_property/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%85%d9%83%d8%a9-%d8%a7%d9%84%d9%85%d9%83%d8%b1%d9%85%d8%a9-%d8%ad%d9%8a-%d8%a8%d8%b7%d8%ad%d8%a7%d8%a1-%d9%82%d8%b1%d9%8a%d8%b4/ |
| daraa | 7 | 0 (0.0 %) | publishes · ad page — capture gap (backlog #1111) | 1 | https://daraa.sa/projects/205048 |
| marksa | 7 | 0 (0.0 %) | proven silent | 0 | https://mar-ksa.com/ar/property/showitem/881 |
| remaxsa | 7 | 0 (0.0 %) | proven silent | 0 | https://www.remax.sa/en/listings/apartment/for-sale/الرياض/113033009-19 |
| wadod | 7 | 7 (100.0 %) | publishes · ad page — not re-opened today (scraper read path) | 95 | https://wadod.sa/property/93 |
| shmoualshmal | 6 | 0 (0.0 %) | proven silent — UNVERIFIED | 0 | https://shmoua-alshmal.com/property/%d9%81%d9%8a%d9%84%d8%a7-%d9%85%d9%88%d8%af%d8%b1%d9%86-6-%d8%ba%d8%b1%d9%81/ |
| yameen | 6 | 6 (100.0 %) | publishes · page JSON — not re-opened today (scraper read path) | 95 | https://www.yameen.sa/properties/52351 |
| fahadalshahri | 5 | 0 (0.0 %) | proven silent — UNVERIFIED | 0 | https://fahadalshahri.com/product/%d8%b4%d9%82%d9%82-%d8%a8%d8%ad%d9%8a-%d8%a7%d9%84%d8%b1%d9%88%d8%b6%d9%87/ |
| hazim | 5 | 1 (20.0 %) | partial (pin only on some ads) | 10 | https://hazim.sa/properties/6a24951be68e1d79e10e7787 |
| october | 5 | 1 (20.0 %) | partial (pin only on some ads) | 10 | https://www.1october.com.sa/properties/44236 |
| qmra | 5 | 0 (0.0 %) | proven silent | 0 | https://qmra.sa/property/%d9%82%d9%85%d8%b1%d8%a7-11/ |
| tawia | 4 | 0 (0.0 %) | publishes · page JSON — capture gap (backlog #1111) | 1 | https://tawia.sa/properties/af75d047-cb1c-449c-9a81-4f77af87653e |
| eightfloor | 2 | 1 (50.0 %) | partial (pin only on some ads) | 40 | https://www.8floor.sa/properties/37975 |
| eydah | 2 | 0 (0.0 %) | proven silent | 0 | https://eydah.com/offers/Ey-1001.html |
| masar | 1 | 0 (0.0 %) | proven silent — UNVERIFIED | 0 | https://masaraqarat.com/aqar/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-4/ |
| almuteb | 0 | 0 (—) | publishes · feed/API — dormant, 0 served | 1 | https://almuteb.sa |
| moftah | 0 | 0 (—) | publishes · feed/API — dormant, 0 served | 1 | https://moftah-aleaqar.com |
| sadin | 0 | 0 (—) | publishes · page JSON — dormant, 0 served | 1 | https://www.sadin.com.sa |
| senan | 0 | 0 (—) | publishes · feed/API — dormant, 0 served | 1 | https://www.senanrealestate.sa |
| snam | 0 | 0 (—) | publishes · feed/API — dormant, 0 served | 1 | https://snam.sa |
