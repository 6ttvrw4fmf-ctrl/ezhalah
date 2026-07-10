# Location resolution architecture (permanent, 2026-07-10)

This is the canonical reference for how a listing's city/region/district gets resolved, and the
PERMANENT rule that prevents the "Other" sentinel bug (see
`project_location-other-sentinel-audit-2026-07-10.md` in project memory for the full incident) from
recurring in any form, on any field.

## The rule

> No scraper may implement its own placeholder/fallback logic for a location (or any other) field.
> An unresolved value is ALWAYS `None` — never `"Other"`, `"Unknown"`, `"N/A"`, a hardcoded
> default, or any other invented value. If the source gives a real `city_ar`/`district_ar`, it is
> always preserved. If a location can't be resolved with confidence, it stays unresolved — never
> guessed, never overwritten once correct.

## The three layers (defense in depth — each is independently sufficient, together they're durable)

1. **Resolution** — `scrapers/common/arabic_location.py`'s `resolve()` (new) / `to_catalog()` /
   `resolve_slug()` (pre-existing, unchanged) are the ONLY sanctioned way to turn a source's raw
   city/district text into a catalog id. Never-guess by construction: a twin city name (ambiguous
   across regions) only resolves via a `region_hint` or (new) a matching `district_ar` that narrows
   the candidate set to exactly one city — never a coin-flip. `PLACEHOLDER_TOKENS`/`is_placeholder()`
   (in the dependency-free `scrapers/common/placeholder_tokens.py`, imported by both this module and
   `db.py` with zero circular-import risk) mean a placeholder value showing up as raw input is
   treated as absent, never "resolved" to itself.

2. **Enforcement (the backstop)** — `scrapers/common/db.py`'s `_reject_placeholder_location()` runs
   on every UPSERT path (`_wasalt_batch`, used by ~30 platforms' `upsert_<platform>_*_batch`
   wrappers, plus the 3 dedicated `upsert_aqar_*`/`upsert_wasalt_residential` functions). Even if a
   scraper's own code regresses (reintroduces a fallback string, or a new platform is added without
   routing through the shared resolver), a placeholder can never actually reach the database via
   these paths — it's nulled at the last possible moment, and the catch is logged to
   `location_pipeline_alerts` so it surfaces immediately rather than silently.

   **This is NOT the only write path — confirmed by adversarial review, 2026-07-10.** Several
   scripts write location fields via a direct `sb().table(...).update(...)` that bypasses the
   upsert helpers entirely: `scrapers/wasalt/enrich_ar.py` (writes `city_ar`/`district_ar`/
   `region_id`, on a **daily schedule**) is the confirmed, now-fixed gap — it now calls the public
   `db.guard_location_update(upd, table=..., ref=...)` explicitly before its own `.update()` call.
   `scrapers/wasalt/recover_other.py` also writes `city`/`region` directly, but is structurally safe
   by construction (it only ever writes a value from its own curated `RAW_TO_CANONICAL`/
   `CITY_TO_REGION` maps, explicitly skipping — never placeholder-defaulting — anything it can't
   map) and is a manually-run one-off recovery script, not a scheduled job; left unguarded but
   documented here rather than silently assumed safe. **Any new direct-write script touching
   city/region/city_ar/district_ar/neighborhood MUST call `guard_location_update()` on its own
   update dict** — there is no way to enforce this at a single chokepoint the way the upsert
   helpers do, so this is a discipline/code-review requirement, not a fully automatic guarantee.

3. **Monitoring** — two independent, complementary checks, both required (see item 6 of the
   2026-07-10 owner directive):
   - **Code-level**: `scrapers/common/tests/` (pytest, hermetic, no network) — guards the
     resolver's never-guess logic and the DB guard's nulling behavior. Runs on every push/PR
     touching `scrapers/common/**` via `.github/workflows/common-location-tests.yml`. Fails the
     build if either regresses.
   - **Data-level**: `scripts/check_placeholder_locations.py` — checks LIVE production data against
     a committed baseline (`scripts/placeholder_location_baseline.json`) of already-known legacy
     placeholder rows (existing before this redesign; not yet backfilled). Fails when any
     `(table, column)` pair's placeholder count EXCEEDS its baseline — i.e. a scraper wrote NEW
     placeholder rows since the baseline was captured. Deliberately NOT a time-window check ("rows
     written in the last N hours") — `last_seen_at` is bumped on every re-scrape of a listing
     regardless of whether ITS placeholder field changed, so a time window can't distinguish
     long-standing unfixed junk from a genuine new regression; a baseline diff can. Runs on a
     schedule via `.github/workflows/location-placeholder-monitor.yml`.

## Existing (pre-redesign) parallel resolution mechanisms — do not build a 4th

As of 2026-07-10 there are THREE pre-existing, overlapping ways a location can already end up
resolved, discovered during this redesign. Any new work must fit into ONE of these, not add a 4th:

- **Native per-platform columns** (`alhoshan`/`aldarim`/`aqarmonthly`/`aqargate`/`sanadak`/`hajer`/
  `wasalt`/`aqar` each carry their own first-class `city_id`/`city_ar` columns, read directly by
  `listing_native_location_v1`'s `native` CTE — priority 1, highest trust).
- **`phasea_shadow_resolution`** (fed from `phasea_src_arabic`) — a substantial existing Arabic-text
  resolution snapshot covering ~19,450 Gathern rows and partial coverage on aqarcity/eastabha/
  raghdan/fursaghyr/mizlaj/sadin/dealapp/abeea/alkhaas/mustqr/satel/jazwtn/jurash/ramzalqasim/
  eaqartabuk/aqaratikom/awal/nowaisiry/october/toor and more (see the 2026-07-10 audit for exact
  counts). **CONFIRMED FROZEN, not live** — two independent investigations agree, the second with
  stronger evidence: `phasea_shadow_resolution` is actually a VIEW (not a table), recomputed live
  from `listing_location_canonical_mv` (refreshed nightly) joined against the static
  `phasea_src_arabic` table — which is why it superficially looks current. But `phasea_src_arabic`
  itself: all 23,252 rows share one Postgres `xmin` (one INSERT transaction), `pg_stat_user_tables`
  shows zero updates/deletes since the 2026-05-22 stats reset, and a direct cutoff test shows every
  `gathern_residential_listings` row matching into it has `scraped_at` ≤ 2026-06-25 04:55, with
  every row scraped after that date unmatched, continuously, through today. No cron/trigger/function/
  workflow references it anywhere. Its ~19,450+ already-correct Gathern resolutions (and other
  platforms') MUST be left untouched — they're correct history — but it is not "the resolver" going
  forward, and its matching approach (not its stale data) is what a successor job should reuse.
- **`resolve_english_city_overlay()`** (`supabase/migrations/20260709_english_city_resolver_overlay.sql`)
  — a live, hourly-scheduled (`pg_cron`, `:50` past the hour) SQL function that fills
  `listings_arabic_locations` for non-Aqar platforms whose raw `city` column is a REAL (if
  unmapped-by-that-platform's-own-dict) English city name, via `loc_city_map` → the same
  `loc_catalog_city`/`loc_catalog_city_alias` catalog `arabic_location.py` uses. It correctly and
  honestly skips a placeholder `city` value (no `loc_city_map` entry for "other") — this was never
  the bug, and needs no change.

**Recommended target state (needs owner sign-off before building — a scope/ownership decision, not
a technical one):** a NEW, PERMANENTLY SCHEDULED SQL function — structurally a sibling of
`resolve_english_city_overlay()`, reading each platform's captured raw Arabic text (wherever it
lives — `additional_info->>'city_ar'` for gathern/aqarcity/eastabha/raghdan/fursaghyr/mizlaj/sadin;
a first-class column for the "native" platforms) — becomes the ONE go-forward mechanism, explicitly
credited as phasea's successor rather than a duplicate. This redesign ships the resolver module +
enforcement gate + tests/monitoring first; the SQL overlay is the next phase, gated on this decision.

## For a new scraper (or migrating an existing one)

1. Extract whatever raw location signal the source gives you (`city_ar`, `district_ar`, an English
   city label, a slug — whatever shape the source actually provides).
2. Call `arabic_location.resolve(city_ar, district_ar=..., region_hint=...)` — or `to_catalog()`/
   `resolve_slug()` if you're working with one of the 6 platforms already using those exact APIs.
   NEVER write your own `X or "SomeDefault"` fallback for a location field.
3. Write whatever the resolver returns, including `None` fields, directly to your row dict. Do not
   second-guess it with your own default.
4. `scrapers/common/db.py`'s upsert path enforces this regardless — but don't rely on the backstop
   as your primary correctness mechanism; it exists for defense in depth, not as a substitute for
   calling the resolver.
5. If your table has a `city`/`region` scraper-specific storage type mismatch with the resolver's
   Arabic-canonical output (e.g. legacy English-label columns), store the resolver's richer result
   (`city_id`, `region_id`, `confidence`) into `additional_info` alongside your existing columns
   rather than skipping the call — see `scrapers/gathern/run.py`'s `info["resolved_*"]` fields for
   the established pattern. A full column-schema cutover is a separate, larger migration decision.
6. **Do NOT blanket-migrate every scraper to `resolve()` in one pass.** Adversarial review
   (2026-07-10) found this is genuinely per-scraper risk, not universal: `scrapers/wasalt/run.py`'s
   own `city` field comes from Wasalt's ENGLISH API, resolved via a 150+-entry hand-curated
   `CITY_MAP` that fixes real upstream transliteration bugs ("Sibya'"→"Sabya", "Earear"→"Arar").
   `loc_catalog_city_alias` has only 6 rows, all Arabic, zero Latin-script entries — the new
   resolver would find NOTHING for Wasalt's raw signal at scrape time (its `city_ar` is filled
   later, out-of-band, by `enrich_ar.py`, and is currently NULL for 1,280 Riyadh + 468 Jeddah rows
   in production). Migrating Wasalt's own resolution blindly would regress its highest-volume table.
   Sequence migration scraper-by-scraper, starting with already-Arabic-native ones (sanadak, hajer,
   aldarim, aqargate, alhoshan, aqarmonthly — already call `to_catalog()` today), and design an
   explicit English-bridge (or defer entirely) for Wasalt rather than swapping it blind.

## District-based disambiguation — a known limitation, not a defect

`resolve()`'s district-based twin-city disambiguation (see `_pick_candidate()`) re-checks
uniqueness against the SPECIFIC ambiguous candidate set on every call — proven safe even under an
adversarial collision by `test_district_collision_across_unrelated_candidates_never_guesses`
(two synthetic twin candidates sharing an identical district name correctly stay unresolved).
Adversarial review (2026-07-10) additionally found: Saudi district names are highly non-unique
GLOBALLY (`حي الروضة` appears under 59 different `city_id`s in `loc_catalog_district`; `حي العزيزية`
under 53), and only 25 of 1,024 twin-city rows currently have ANY district data at all — for every
twin group with data today, only one member has any rows to compare against. So the "exactly one
candidate matches" case that fires today does so partly because district coverage for AMBIGUOUS
cities specifically is still sparse, not because collisions are structurally impossible. The
algorithm itself is safe (it will correctly refuse to pick when two candidates both have data and
both match), but its practical HIT RATE will be lower than "district coverage exists" alone would
suggest, and will need re-verification as district coverage for twin cities improves.

## Other-field placeholder audit (owner directive item 7)

The SAME bug shape (`X = <lookup> or "<placeholder>"`) was found on **70 other fields across 33
platforms** — 17 of them confirmed currently firing on real production data, most seriously on
`rent_period` (defaults to `"annual"` with zero source evidence on aqaratikom, aldarim, aqar, awal,
mustqr, deal, wasalt, alnokhba, satel — some demonstrably mislabeling real monthly rentals as
annual) and `property_type`/`transaction_type` (defaults to `"Residential Land"`/`"Buy"` on
eaqartabuk, eastabha, hajer, erapulse, sanadak, raghdan, jazwtn, sadin, and more — several confirmed
live mislabeling real apartments/rentals as land or Buy). Three platforms (`deal`, `ramzalqasim`,
`alnokhba`) were ALSO found to still have the exact `city = ... or "<placeholder>"` shape the
2026-07-10 location fix addressed elsewhere — missed because the first audit's per-platform sweep
either errored (ramzalqasim) or characterized a dormant branch as clean (alnokhba) without static
analysis catching the still-present code. Full findings (platform, field, file:line, exact
placeholder value, severity, live-data verification) are in project memory
(`project_location-placeholder-architecture-redesign-2026-07-10.md`) — **identified, not yet fixed**;
remediating all 70 is a separate, follow-up decision on scope/priority, not part of this redesign's
shipped changes.
