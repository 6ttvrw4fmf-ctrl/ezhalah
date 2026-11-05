# Five sources (owner order 2026-11-05) — STAGED, and the one switch that launches them

Keller Williams (kwsaudiarabia.com) · Almajdiah rentals (almajdiah.com) · Asas Makeen (asasmakeen.com) ·
Al Rajhi Development (mrajhi.com.sa) · STeam Residence (steam-realestate.com). Every ad is **stored and invisible**
until the owner says launch. Same pattern as Property Finder (docs/ops/PROPERTYFINDER_LAUNCH.md).

## What is live now (staged)

| Layer | State |
|---|---|
| Crawlers | `scrapers/{kellerwilliams,almajdiah,asasmakeen,mrajhi,steam}/run.py` through `scrapers/common/honest_fetch.py`: honest UA `Ezhalah-bot/1.0`, ≤ 1 req/s, only what robots.txt allows (each crawler's `_allowed`), any 401/403/429/503/CAPTCHA stops the run. Workflow `five-sources-staged-sync.yml` — manual dispatch only, no schedule. |
| Tables | `<site>_residential_listings` / `<site>_commercial_listings` ×5 + `asasmakeen_offplan_units` (migration 20261105031000): **no anon / authenticated read at all**. |
| Registry | 5 `platform_registry` rows `status='retired'` (same migration) — out of every search scope, never auto-flipped. |
| Search / map / loader / logo | **Not wired.** No arm of `listing_native_location_v1` / `active_listing_ids_v2`, so no row reaches `search_listings_ar`, `map_pins_ar`, the loader or Trending. `src/` has only the inert card matchers the registration barrier requires (badge `null`, host, Arabic name) — no `platforms.ts` entry, no logo. |
| Liveness / readers | the five are in `NOT_PRODUCTION_SEARCHABLE` (liveness_policies.py), so the liveness monitors **and the facts-words reader** (`scrapers/facts/words.py all_tables`) skip them until launch. |

## THE SWITCH

Tell any Claude session: **«Launch the five sources — follow docs/ops/FIVE_SOURCES_LAUNCH.md.»**
(One site only: «Launch Keller Williams only — follow docs/ops/FIVE_SOURCES_LAUNCH.md»; drop the other four from every
list below.) That session does, in order, each step self-verifying:

1. **Merge the launch PR** (draft, «DO NOT MERGE — owner launch switch», named in the staged PR). It adds the
   `src/data/platforms.ts` entries (Buy+Rent for Keller Williams and Asas Makeen; Rent only for Almajdiah, Al Rajhi,
   STeam), the `SOURCE_LIST_PRESENCE` policies (removed from `NOT_PRODUCTION_SEARCHABLE` — this is what puts them under
   the liveness monitors AND the facts-words reader), `sql/mirrors/liveness_registry.json`, `scrapers/lifecycle-gaps.txt`
   lines, `data/pin-sources.json` (KW `page-json` list API, Almajdiah `page-json` unit_map_url, Al Rajhi `ad-page` map
   embed, Asas Makeen `project-page` (proof asasmakeen.com/ar/مشاريعنا/مكين-90, all 14 projects of the 507 units draw the
   building's pin; 4 older ones are found through sitemap-projects-ar.xml), STeam `none`), `scripts/image-coverage-baseline.json`, the five `small-sources-sync.yml` matrix
   lines, and deletes `five-sources-staged-sync.yml`.
2. **Apply the launch SQL** `docs/ops/owner-apply/five-sources-launch/` in file order through `apply-migration.yml`
   (01 grants + registry active → 02 wiring, outside :20/:22 → 03 location index → 04 extra attrs → 05 rich attrs →
   06 internal views private → 07 views read-only). Each is the APPLIED Property Finder launch file with the platform
   list changed and refuses if the live shape moved. Then, generated at launch time because they read the live roster:
   the `ops_liveness_registry` reseed from the json, the `ops_sql_mirror_expected` md5 for
   `listing_native_location_v1` (+ `sql/mirrors/listing_native_location_v1.sql`), and `ops_platform_one_sided` rows for
   the three rent-only sites (proof URLs: almajdiah.com/view/rentals/list — sales ON HOLD by the owner; mrajhi.com.sa/units;
   steam-realestate.com/property/). Mirror every applied file byte-exact.
3. **Regenerate** `SEARCHABLE_TABLES` (`scripts/gen-searchable-tables.ts`) and deploy through `safe-deploy.sh`.
4. **Crawl + read every description** (owner 2026-11-05: rooms, baths, furnished, maid room, pool, payment terms,
   «للمتر» … read from the text into the Advanced-Filter fields):
   `gh workflow run small-sources-sync.yml -f source=kellerwilliams,almajdiah,asasmakeen,mrajhi,steam` (ONE dispatch),
   then `facts-words.yml` with `platforms=kellerwilliams,almajdiah,asasmakeen,mrajhi,steam` (word reader, free), then
   `facts-extract.yml` `mode=backlog` with the same `platforms` (AI reader, inside the ai_spend_gate cap — ~830 ads,
   well under a dollar at the PF rate of $0.62 for 4,543 ads).
5. **Customer proof** (AGENTS «LIVE = tested like a real user»), per site: a real search in the app shows its cards on
   every side it has; the count equals the cards you can reach; one card opens the same ad on the source with the
   same price, period, area and district; one Advanced-Filter answer that came ONLY from the description (Asas Makeen
   bathrooms «3 دورات مياة»; STeam «الشقة مخدومة بالمصعد» = elevator; Al Rajhi «مسبح خاص» = pool; KW «سنوي» rent period;
   Almajdiah «سطح خاص») shows on the card.

To undo after launch: set the registry rows back to `retired` and re-run the wiring with the arms removed (an
`active=false` mass update is NOT an undo — ask the owner).

## Per-site facts and the owner's open calls

| Site | Stored on 2026-11-05 | Notes / open calls for the owner |
|---|---|---|
| Keller Williams | the list API's 159 ads → 155 mapped (2 «Off Market», 1 land type not stated, skipped) + 20 multi-use land twins (owner 2026-09-27 rule: «متعددة الاستخدامات» = both tables) | pins on all; 19 ads carry a KW-internal «MA000…» code in `mls_number`, not a 10-digit REGA licence → licence NULL (**owner: show them?**). Rent period stated by the text on 8 of 24; 16 silent → judged at launch. Area: the ad page prints the LOT size; a flat / floor stores its living area (its «lot» is the building plot), every other type the lot the page prints (**owner: OK?**). The list total wobbles (155 → 88 → 161 within an hour on 2026-11-05): prune_unseen's 30 % collapse guard + 3 strikes absorb a short list. |
| Almajdiah | 59 rent units (35 projects + 3 outer); 54 carry a 10-digit licence, 5 a placeholder («--») → NULL | price = «دفعة» (one payment); «دفعتين» + التأمين kept; no period word anywhere → silent (judged سنوي at launch). Type: the API has no type word; every unit is «المبنى · الوحدة · الطابق» → Apartment (**owner: OK?**). www.almajdiah.com is self-signed — links use almajdiah.com. Sales ON HOLD. |
| Asas Makeen | 507 listings (445 sale + 62 rent) + 47 off-plan hidden (طليعة المشرقية) = the sitemap's 554 | no licence; the unit page has no pin but its PROJECT page does (directions link) → every unit carries its building's pin (`pin_scope: project`); the 28 units of مكين 90 name no city in the title → the project's own text («شرق مدينة الرياض»). Bathrooms only in the feature lines; 2 rent units show no price → price on request. **Owner:** 8 rents show a source price under 100 («63ريال», «85ريال» — PRICE = SOURCE, stored as written) and ASM2723 is badged «تأجير» at 1,619,000 (a sale price under a rent badge) — the weird-price detector will raise them at launch; مكين 90's directions pin and its map centre disagree by ~3.8 km (the directions pin is used). |
| Al Rajhi | 39 yearly rents | 38 also on Property Finder: owner KEEP BOTH. Guard name + phone never read. 8 units state no district (city only), 17 have no pin of their own. |
| STeam | 10 rents | the price field is empty on all 10; 3 descriptions write a figure («السعر 65.000») — prose, never a price (owner 2026-08-04) → all price on request (**owner: keep that rule here?**). |
