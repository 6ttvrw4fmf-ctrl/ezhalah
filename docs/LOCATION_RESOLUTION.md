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
  the bug, and needs no change. **Verified 2026-07-10 it cannot silently re-corrupt the Ramz Al
  Qassim fix**: it keys off `lower(btrim(raw.city))` via a `JOIN LATERAL ... ON true`, so a row
  whose raw `city` is `NULL` (the 69-row fix's exact state) produces zero lateral rows and is
  excluded from the overlay's insert/update entirely — confirmed by manually invoking the function
  right after the fix and re-checking all 47 affected active rows were still unresolved afterward.

**Latent trap found during the Ramz Al Qassim fix (2026-07-10), not fixed here — flag for whoever
touches `listing_native_location_v1` next:** for a platform with NO "native" columns (like
Ramzalqasim), `v1`'s `legacy` CTE is its ONLY source, and that CTE is gated
`WHERE listings_arabic_locations.city_ar IS NOT NULL`. Setting a row's `city_ar` to `NULL` there
(the correct, intentional fix for an unresolved location) makes the row **entirely absent** from
`v1` — not present-with-a-null-city, just gone. The listing still shows up correctly as unresolved
in the app's actual search path (`search_listings_ar`, via `listing_native_location_v2`'s separate
`unresolved_catchall` UNION branch, which independently re-adds anything in
`active_listing_ids_v2` missing from `v1`) — so this does **not** affect what users see today. But
any FUTURE code that queries `listing_native_location_v1` directly, expecting it to hold every
active listing (resolved or not), would silently miss these rows rather than see them as
unresolved. Worth a `LEFT JOIN`/coalesce fix in `v1`'s "legacy" CTE if it ever becomes a direct
dependency for anything else.

**Recommended target state (needs owner sign-off before building — a scope/ownership decision, not
a technical one):** a NEW, PERMANENTLY SCHEDULED SQL function — structurally a sibling of
`resolve_english_city_overlay()`, reading each platform's captured raw Arabic text (wherever it
lives — `additional_info->>'city_ar'` for gathern/aqarcity/eastabha/raghdan/fursaghyr/mizlaj/sadin;
a first-class column for the "native" platforms) — becomes the ONE go-forward mechanism, explicitly
credited as phasea's successor rather than a duplicate. This redesign ships the resolver module +
enforcement gate + tests/monitoring first; the SQL overlay is the next phase, gated on this decision.

## `city_ar`/`district_ar` are NOT universal columns — verified table-by-table (2026-07-16)

**Only 6 platforms / 11 tables genuinely have first-class `city_ar` and `district_ar` columns** —
confirmed 2026-07-16 via a direct `information_schema.columns` query, not inference:
`aldarim`, `alhoshan`, `aqargate`, `aqarmonthly` (residential only — no commercial table exists),
`hajer`, `sanadak`, `wasalt` (`wasalt`'s `city_ar` is filled out-of-band by `enrich_ar.py`, per
above — the column exists but can be NULL). **Every other platform's `*_residential_listings` /
`*_commercial_listings` table does not have these columns at all** — their resolved Arabic location
(where it exists) lives in `additional_info->>'city_ar'` / `->>'district_ar'` (JSONB, not a real
column) or in the derived tables below. `SELECT city_ar, district_ar FROM <any other platform's raw
table>` fails with `column ... does not exist` — this is not a bug to fix, it is the actual schema.

**Always go through `listing_native_location_v2`** (a plain VIEW, safe by construction — the 7
native tables read their real columns, `souq24` is special-cased on `neighborhood`, and every other
platform gets an explicit `NULL::text AS city_ar/district_ar` catch-all) instead of querying a raw
platform table's `city_ar`/`district_ar` directly. Any new script, function, or ad-hoc query that
needs a listing's resolved Arabic location — cron job, Edge Function, or a one-off SQL check run
through an MCP tool — should read `listing_native_location_v2`, never assume the raw table has the
column.

**Known undocumented/orphaned tables (found 2026-07-16, left as-is per owner decision):**
`buy_location_index` (114,787 rows), `rent_location_index` (68,210 rows), and
`listing_location_canonical` (184,134 rows, distinct from the *matview* `listing_location_canonical_mv`
described in `docs/LOCATION_SYSTEM.md` §1) all exist in production with real data, but **no
committed migration, Postgres function, or application code builds or maintains any of them** — the
only repo reference is a design-intent comment at `src/data/remote.ts:637` that was never
implemented. Their origin is unknown (most likely ad-hoc SQL run directly against production,
possibly by a concurrent session prototyping the `buy_location_index`/`rent_location_index` routing
design described in that comment). **Do not assume these are dead or safe to query/rely on** — they
are untracked infra. If you pick up the `remote.ts:637` design and build this out for real, replace
this section with the real architecture and delete the orphaned tables once the real ones (or these,
formally adopted) are in place.

**The 2026-07-16 incident:** a one-time, ~52-second burst of `column city_ar/district_ar does not
exist` errors hit ~19 non-native platforms' tables (alphabetically, `deal_*` → `toor_*`), with no
matching `pg_cron` job, Postgres function, trigger, or Edge Function anywhere — consistent with an
ad-hoc script (most likely built to populate the orphaned tables above) assuming every `*_listings`
table has these columns. No data was corrupted (a `column does not exist` error aborts before any
write executes) and no search-index drift resulted (`location_pipeline_alerts` recorded zero
`search_v2_drift`/`v2_duplicate_pk` entries in the following 24h). Full investigation trail: project
memory `project-city-ar-district-ar-root-cause-2026-07-16` (Supabase project `aannarbkwcymrotzwdbo`).

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

## Universal city-default rule (owner directive, 2026-07-10 follow-up)

Following the Ramz Al Qassim 69-row backfill, the owner made the city-specific case of the rule
above explicit and permanent:

> No scraper may default a missing or unresolved location to a specific real city. If the source
> does not provide enough evidence for an exact catalog match, store it as unresolved.

A repo-wide sweep for this exact shape (`city = "<CapitalizedWord>"`, a `*CITY`-named constant fed
into `city =`, `DEFAULT_CITY`, `city.setdefault`, `city or "<CapitalizedWord>"`) found, beyond the
three already fixed above (Deal, Ramzalqasim, Al Nokhba):

- **Nowaisiry — fixed.** `city = "Riyadh"` was the base default before a `CITY_TOKENS` scan. Since
  `CITY_TOKENS` explicitly recognizes BOTH Riyadh-area (`الخير`, `مخطط الخير`, `حي الخير`) and
  Hail-area (`الجلة`, `الجله`, `الأجفر`, `الاجفر`) plan names, the scraper is demonstrably
  multi-city — an unrecognized plan name silently became "Riyadh" even for a real Hail listing.
  Now unresolved (`None`) when no token matches.
- **Awal — partially fixed.** `LOC_DEFAULT_CITY.get(loc_slug or "", "Sakaka")` guessed "Sakaka" for
  the `jouf` RTCL taxonomy slug whenever the structured city field/text scan failed, and for ANY
  other/unknown slug. Now unresolved in both cases. The `arar` → `Arar` branch is **intentionally
  untouched** — see "Known accepted single-city/region constants" below.
- **Mustqr — NOT fixed, pending stronger evidence.** See below.
- **Souq24 — confirmed not a violation.** `TOWN_TO_CITY.get(...)` falls through to `None` cleanly;
  no hardcoded final default anywhere in the chain.

**Enforcement:** `scrapers/common/tests/test_no_hardcoded_city_default.py` is a repo-wide static
sweep (same regex shape as the manual sweep above) that fails the build if a NEW, unallowlisted
instance of this pattern is introduced anywhere in `scrapers/`. Mutation-tested 2026-07-10
(temporarily reintroduced the Nowaisiry violation; confirmed the test catches it, then restored the
fix and confirmed green again — independently reproduced 2026-07-10 by an adversarial-review agent
with two DIFFERENT injected violations (souq24, deal), both caught, both cleanly reverted). This is
a static-analysis gate, distinct from and complementary to the runtime `guard_location_update()`
DB-write gate: that gate only catches known PLACEHOLDER tokens ("Other"/"Unknown"/...) at write
time; it cannot catch a scraper hardcoding an assumed-real city name (e.g. "Riyadh", "Sakaka") as a
fallback, which is the bug shape this test exists to close.

**Blind spot fixed (2026-07-10).** The original design suppressed an entire line if it contained
`city_map`/`city_ar`/`city_id`/etc. anywhere in it — so a new violation sharing a line with an
existing safe identifier (e.g. `city = CITY_MAP.get(raw) or "Riyadh"`) slipped through undetected.
Rewritten as two independently-evaluated pattern classes: a literal quoted-string default
(`city = "X"` / `city = <anything> or "X"`) is now **never** suppressed by a nearby safe identifier
— it's dangerous regardless of what else is on the line — while an identifier-shaped match
(`*CITY`-named dict/constant) is suppressed only when a safe identifier's own match **span
overlaps that specific match** (position-aware), not merely appears somewhere else on the line.
Verified: an end-to-end mutation test injecting the exact `city = CITY_MAP.get(raw_city) or
"Riyadh"` line into a real scraper file (`scrapers/deal/run.py`, using its own real `CITY_MAP`
identifier) is caught by the guard, then cleanly reverted with the full suite green again. A
placeholder-value exclusion ("Other"/"Unknown"/etc. are a different, already-covered bug class) and
a docstring/prose-line exclusion were added alongside it, both needed once the literal-string
detection got strict enough to also start matching prose examples in this file's own docstring and
`scrapers/wasalt/recover_other.py`'s root-cause writeup.

**Newly discovered by the fix itself (2026-07-10) — NOT fixed, NOT independently verified, flagged
here so the guard passes today without silently missing them.** The original regex never reliably
matched `city = <a .get(...) call> or "RealCity"` — a function call between `city =` and `or` broke
its adjacency assumption. Making the literal-default detection robust to that surfaced 4 more
platforms with this exact bug shape, beyond Deal/Ramzalqasim/AlNokhba/Nowaisiry/Awal above:

- **Jazwtn → `"Jazan"`.** Comment claims the brokerage operates only in the Jazan *region* (not
  explicitly city). Unverified.
- **Hajer → `"Hofuf"`.** Project memory already describes Hajer as an Al-Ahsa-area boutique
  brokerage (Hofuf is Al-Ahsa's largest city) — plausible, but not verified against this specific
  default the way Ramzalqasim's region constant was.
- **Jurash → `"Khamis Mushait"`.** No single-city claim found nearby in the code. Least evidence of
  the four that this is a legitimate constant rather than a bug.
- **Satel → `"Riyadh"`.** **Higher concern than the other three.** Its own comment says
  "overwhelmingly Riyadh" — explicitly *not* a single-city claim — and the condition defaults to
  Riyadh whenever the Arabic city field is merely non-empty, regardless of what it actually says:
  a real, different Arabic city name paired with noisy English text would be silently overridden.
  This looks more like the Nowaisiry/Deal bug shape than a legitimate brokerage constant.
  **Recommend prioritizing this one first** if/when this list is worked through.

### Known accepted single-city/region constants (allowlisted, cited in the test file)

A hardcoded value is **not** automatically a violation when it expresses "this whole brokerage
operates in exactly one real city/region" (a business fact) rather than "guess a city per-row when
the source is unclear" (the actual bug). Ramzalqasim's fixed `region = "Qassim"` (Scope 1, above) is
the precedent for this distinction. The claims below exist and are allowlisted, but **none has been
independently verified** — do not treat presence in the allowlist as proof of correctness, and do
not extend the pattern to a new platform without the same live verification already done for
Ramzalqasim's region constant:

- **Awal `"arar"` → `"Arar"`.** Code comment claims every RTCL `arar`-taxonomy listing is genuinely
  in Arar city. Owner directive 2026-07-10: "do not change the Arar branch until it is independently
  verified." No live verification has been performed.
- **Mustqr `DEFAULT_CITY = "Hail"`.** Code comment claims Mustqr is a single-city Hail-based
  brokerage. A live sample of 20 distinct neighborhood names showed nothing obviously non-Hail, but
  a direct check against Mustqr's own source Supabase REST API failed (no valid API key available)
  and was not retried. Owner directive 2026-07-10: "Do not change Mustqr yet. First obtain stronger
  evidence that it is truly single-city." **Not fixed — still unconditionally assigns
  `city = "Hail"` to every row.** Whoever picks this up next needs either a valid credential to
  query Mustqr's own taxonomy directly, or another independent source (e.g. their public site's
  city/area filter options) to confirm or refute the single-city claim before this can be closed out
  either way.
- **Jazwtn, Hajer, Jurash, Satel** — see "Newly discovered" above; same treatment, not yet worked
  through.

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
