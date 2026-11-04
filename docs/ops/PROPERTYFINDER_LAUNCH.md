# Property Finder Saudi — STAGED, and the one switch that launches it

Owner approved propertyfinder.sa as a source on 2026-11-04 («approved, legal») and launches it himself.
Until then every Property Finder ad is **stored and invisible**.

## What is live now (staged)

| Layer | State |
|---|---|
| Crawler | `scrapers/propertyfinder/{crawl,run}.py`, workflow `propertyfinder-sync.yml` (manual dispatch only, no schedule). Four Arabic category pages + `?page=N`, honest UA `Ezhalah-bot/1.0`, ≤ 1 req/s, any wall stops the run. Single-ad `/plp/` pages are never fetched. |
| Tables | `propertyfinder_residential_listings`, `propertyfinder_commercial_listings` (migration 20261104101815): **no anon / authenticated read at all**. Off-plan ads: `propertyfinder_offplan_units` (20261104102110), never a listing. |
| Registry | `platform_registry` row `status='retired'` (20261104101823) — the registry's "deliberately out of search scope" value: exempt from the unreachable-table and registry-orphan detectors, kept out of the app's search scope by `gen-searchable-tables.ts`, and never auto-flipped (`set_platform_status` refuses a retired row; `reactivate_recovered_dormant_platforms` only reads `dormant`, which is why `dormant` was NOT used — it would self-launch on the first ok crawl, and `map_pins_ar` does not read `production_ready`). |
| Search / map / loader / logo | **Not wired.** The tables are no arm of `listing_native_location_v1` / `active_listing_ids_v2`, so no row can reach `search_listings_ar`, `map_pins_ar`, the loader strip or Trending. `src/` has no Property Finder entry: no logo, no name, no card. |
| Liveness policy | `propertyfinder` stays in `NOT_PRODUCTION_SEARCHABLE` (liveness_policies.py) — so the nightly word reader and the liveness monitors do not grade it yet. |

## THE SWITCH

Tell any Claude session: **«Launch Property Finder — follow docs/ops/PROPERTYFINDER_LAUNCH.md.»**
That session does the steps below in this order, each one self-verifying, and reports the customer proof.
(Launch PR with the code half: see the PR linked from the staging PR's description.)

1. **Merge the launch PR** (frontend entry + liveness policy). It is inert on its own: with the DB still
   staged no Property Finder row is in `search_listings_ar`, so there is nothing for the new code to show.
   It adds: `src/data/platforms.ts` entry (`allowsBuy` AND `allowsRent` true — both sides are live at the
   source), SourceBadge / sourceHost / sourceName branches (badge `return null` until the owner supplies the
   official logo file), `inAppViewer` allowlist, the `SOURCE_LIST_PRESENCE` policy (removed from
   `NOT_PRODUCTION_SEARCHABLE`), `sql/mirrors/liveness_registry.json`, `scripts/image-coverage-baseline.json`,
   `data/pin-sources.json` (`page-json`: every ad carries `location.coordinates` on the category page).
2. **Apply the launch SQL** in `docs/ops/owner-apply/propertyfinder-launch/` in file order (each is the Haraj
   2026-10-16 migration of the same name with the platform changed; each refuses if the live shape moved):
   `01_grants_and_registry_active.sql` → `02_wiring_into_search.sql` (outside :20/:22) →
   `03_listing_location_index.sql` → `04_extra_attrs.sql` → `05_rich_attrs.sql`; then, generated at launch
   time because they read the live roster: the `ops_liveness_registry` reseed from
   `sql/mirrors/liveness_registry.json`, the `ops_sql_mirror_expected` md5 for `listing_native_location_v1`
   (+ `sql/mirrors/listing_native_location_v1.sql`), and the daily pg_cron dispatch of `propertyfinder-sync.yml`
   (pick a free minute with the cron-ordering contract). Mirror every applied file byte-exact.
3. **Regenerate** `SEARCHABLE_TABLES` (`scripts/gen-searchable-tables.ts`) and deploy the frontend through
   `safe-deploy.sh`.
4. **Dispatch** `propertyfinder-sync.yml`, then the `facts-words` reader for `platforms=propertyfinder`.
5. **Customer proof** (AGENTS «LIVE = tested like a real user»): a real search in the app shows Property Finder
   cards in both Buy and Rent, the count equals the cards you can reach, one card opens the same ad on
   propertyfinder.sa with the same price, period, area and district.

To undo after launch: set the registry row back to `retired` and re-run the wiring with the arms removed
(or simply `update ... set active=false` is NOT an undo — it is a mass hide; ask the owner).

## Coverage, PDPL and badge rules (enforced by `scrapers/common/tests/test_propertyfinder_staged_ingest.py`)

- PRICE = SOURCE (`price.value` verbatim); PERIOD = SOURCE (sell / yearly → annual / monthly → monthly ×12
  storage convention; weekly / daily → no bucket, price kept in `price_evidence`); `is_hidden` → price on request.
- No phone, email or person name is stored: `agent`, `broker`, `client`, `contact_options` are dropped before
  storage; description phones are redacted by the shared `pii.redact_pii` + the `zz_redact_pii` trigger.
- PF badges (`is_great_value`, `is_high_demand`, `is_price_drop`, `is_verified`, …) are stored raw in
  `source_capture.badges` only — `source_capture` is never granted to anon — and never become a column.
- Cross-platform duplicates: the fleet keeps each site's own copy (Haraj ↔ DealApp are both kept); there is no
  cross-site merge to plug into. `license_number` (REGA «rera») is stored on 4,670 of 4,671 ads, the key any
  future cross-site match would use.
