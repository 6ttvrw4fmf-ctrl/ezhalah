# Platform launch checklist — the "not ready yet" lock

**Owner brief, 2026-09-06 ("build the lock"). A platform is not launched when its `platform_registry`
row turns `status='active', kind='source'` — it is launched when it is present in every layer below.**
Twice in one week a platform reached "active" with a layer unfinished (amaall shipped with no
image-coverage baseline; amaall/remal were active before `listing_location_index` carried their arms),
and each time the gap was invisible until a barrier tripped after the fact.

This file is the single place the requirement is discoverable **before** you flip a platform live.
Every box is also machine-enforced by the barrier named beside it — so a skipped box fails CI or a
live check, never passes silently. The barriers are the lock; this list is the key ring.

## Before you set `status='active', kind='source'`, every box must be true

| # | Box | What "done" means | Enforced by |
|---|-----|-------------------|-------------|
| 1 | **Raw tables exist** | `<platform>_residential_listings` / `_commercial_listings` present and populated by the scraper | scraper run + `scrape_runs` |
| 2 | **Liveness strategy declared** | an entry in `scrapers/common/liveness_policies.py` (or CI fails) — never `CRAWL_PRESENCE_ONLY` by omission | `verify-liveness-registry-mirror.ts`, `verify-liveness-claims-are-earned.ts` |
| 3 | **Search index arms** | rows in `listing_location_index` (feeds `listing_location_canonical` and the name bridges) | `verify-location-index-covers-every-searchable-platform.ts` (+ live half) |
| 4 | **Searchable** | rows in `search_listings_ar`, and the client scope (`p_tables`/`p_tables2`) sends its tables | `verify-searchable-scope-matches-inventory.ts` |
| 5 | **Monitored** | the per-platform detectors read it — i.e. its registry row is genuinely `active`+`source`, not `dormant` | `verify-searchable-platforms-are-monitored.ts` |
| 6 | **Image monitor can see it** | present in the newest `mon_snapshot_image_coverage()` snapshot (so its floor is actually checked) | `verify-active-platform-image-coverage-not-blind.ts` ← the gap this brief closed |
| 7 | **Image coverage declared** | an entry in `scripts/image-coverage-baseline.json` (a real `floor_pct`, or `imageless_at_source` with a reason) | `verify-image-coverage-ratchet.ts` (+ live half) |
| 8 | **AF attribute views cover it** | present in both Advanced-Filter attribute views | `verify-af-attribute-views-cover-every-platform.ts` (+ live half) |
| 9 | **Loader roster** | appears in `loader_active_platforms_ar()` so the SearchLoader advertises it | `verify-loader-platforms-match-active.ts` |

## Why boxes 6 and 7 are separate

Box 6 is "the monitor can *see* the platform at all"; box 7 is "its coverage is *declared and held*".
They fail differently: a platform absent from the snapshot (box 6) is **invisible** to the ratchet —
its floor is never checked and its absence reads as "nothing to report", the silent-zero shape. A
platform in the snapshot but not the baseline (box 7) is **loud** — the ratchet's onboarding gate
names it. Box 6 existed with no lock until 2026-09-06; the snapshot cron runs infrequently, so a
platform launched between runs was blind to the image monitor for the whole gap. `mon_snapshot_image_coverage()`
can be run on demand the moment a platform goes live to close that window immediately.

## The rule this encodes

`active+source` ⟹ present in **every** layer above. The barriers enforce each arrow; boxes 3→7 chain
so that `active ⟹ in index ⟹ searchable ⟹ in snapshot ⟹ in baseline`. None of these may be
weakened to make a launch pass — a red box is a launch that is not finished, not a barrier to relax
(AGENTS.md, §"NOTHING ABOVE WEAKENS ANY EXISTING GUARD").
