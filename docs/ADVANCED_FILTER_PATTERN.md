# Reusable advanced-filter pattern («خلّنا نحدد الطلب أكثر»)

The Property Age (عمر العقار) filter for Apartments is the **reference implementation** for every
future advanced-filter question. This doc is the playbook: copy it to add a new advanced question
(الواجهة / الحمامات / الفرش / رقم الدور / عرض الشارع …) or extend an existing one to a new property
type. Do not re-derive the mechanics — reuse them.

## The flow (fixed, owner-locked)

```
normal search → first 10 cards → «عرض المزيد» / «خلّنا نحدد الطلب أكثر»
   → (only «خلّنا نحدد الطلب أكثر», only in an eligible scope)
   → loading state → dynamic question card (options + live counts, unknown-count disclosed)
   → user picks ONE strict option → refreshed cards that ALL match that option
```

The age question is NOT a home-screen filter. It appears **only after** a search has returned
cards, and only from the «خلّنا نحدد الطلب أكثر» button.

## Core principles (permanent)

1. **Arabic is the source of truth** for locations and taxonomy. Numbers may stay in English.
2. **Match → Diversify → Return.** (a) Match a listing to the architecture (Arabic taxonomy,
   location hierarchy, deal, property type, filters); (b) diversify across platforms so no single
   trusted platform dominates when equally-relevant listings exist elsewhere; (c) return only
   relevant, correctly-matched listings.
3. **Match first, never guess.** Never fabricate, force, or default an unresolved value. Unknown
   stays unknown.
4. **Strict options.** Every card returned after an option is selected must *exactly* satisfy that
   option — no exceptions, no "close enough", no unknown-value bleed.
5. **Preserve raw listing data.** Never modify a listing's facts to fit a bucket.

## Where the machinery lives

| Concern | File / object |
|---|---|
| Question engine (config-driven, generic) | `src/data/advancedFilters.ts` → `ADVANCED_QUESTIONS[]` |
| One question's config | `AdvancedQuestionConfig` (`titleKey`, `fetchOptions`, `applyAnswer`) |
| Card UI (generic, never field-specific) | `src/components/AdvancedQuestionCard.tsx` |
| Eligibility gate | `isApartmentOnlyScope()` in `src/app/agent.tsx` |
| Flow orchestration | `startAgeFlow()` / `onAgeAnswer()` in `src/app/agent.tsx` |
| Scope resolution (shared w/ main search) | `resolveSearchScope()` in `src/data/remote.ts` |
| Live option counts | `fetchPropertyAgeOptionCounts()` → RPC `property_age_option_counts_ar` |
| Actual filtered search | RPC `location_search_candidates_ar` |

**To add a new advanced question:** add ONE `AdvancedQuestionConfig` object to `ADVANCED_QUESTIONS`
and (if it needs live counts) one counts-RPC. `AdvancedQuestionCard.tsx` and the agent orchestration
are fully config-driven — never add a field-specific branch to them.

## Eligibility gate (owner-locked)

The question triggers **only** when `category === 'Residential'` AND the selected type is *exactly*
one type equal to `'Apartment'` — `isApartmentOnlyScope(q)`:

```ts
const types = effectiveTypes(q);           // canonical ENGLISH keys, e.g. 'Apartment' (NOT 'شقة')
return q.category === 'Residential' && types.length === 1 && types[0] === 'Apartment';
```

Villas, Houses, Duplexes, Land, Commercial, Offices, Warehouses, and any multi-type selection that
merely *includes* Apartment all fail this gate → the age question never shows. (Gotcha, cost us a
live bug once: `effectiveTypes()` returns the English key, not the Arabic label.)

## Property Age — the 5 approved buckets (LOCKED)

`جديد` (property_age=0) · `1–2 سنوات` · `3–5 سنوات` · `6–9 سنوات` · `10+ سنوات`.
«أقل من سنة» was retired — its only signal was `property_age=0`, identical to «جديد».

**STRICT semantics:** an unknown-age listing (`property_age IS NULL`) matches **no** bucket, at both
count time (`property_age_option_counts_ar`) and search time
(`location_search_candidates_ar`'s `((p_age_min is null and p_age_max is null) or (s.property_age
is not null and s.property_age between …))` clause). Unknown-age is disclosed as a caption
(«العمر غير معروف لـ N من العقارات المطابقة»), never as a selectable option.

## Thresholds (config constants in `advancedFilters.ts`)

| Constant | Value | Purpose |
|---|---|---|
| `MIN_TOTAL_TO_SHOW` | 150 | Skip the whole question if the scope has < 150 total matching listings (not worth asking). Natural gap in real Buy/Rent × city data sits between ~112 and ~192–653. |
| `MIN_REAL_BUCKET_COUNT` | 5 | An option is only offered if its bucket has ≥ 5 listings. (Counts are already strict, so this is the true per-bucket signal.) |
| `MIN_OPTIONS_TO_SHOW` | 2 | If < 2 real options qualify, fall back to the plain refine-chip flow (a "choice" of 0–1 isn't a question). |

Re-validate these two data-grounded numbers (`150`, `5`) against live distributions before reusing
for a *different* advanced field — they were tuned for age specifically.

## Failure fallback (never freeze, never error)

`fetchPropertyAgeOptionCounts` has a 4s client timeout. On any RPC error / timeout / empty result →
returns `null` → the engine yields **empty options** → falls below `MIN_OPTIONS_TO_SHOW` →
`startAgeFlow` silently drops into the pre-existing generic refine-chip flow. The user never sees an
error and the UI never hangs. An unresolvable search scope returns all-zero counts (same fallback
path), so there is a single, uniform degrade path.

## Backend rules (learned the hard way)

- **Category purity:** both RPCs carry `p_category`, checked against the canonical
  `known_type_ar.macro` taxonomy — a Residential search can never surface a Commercial-macro row
  regardless of `p_types`. `resolveSearchScope()` sets `p_category` so the counts RPC and the search
  RPC stay in exact parity.
- **Arity-change trap:** `CREATE OR REPLACE FUNCTION` with a changed arg/return signature creates a
  SECOND overload instead of replacing — breaks callers with "function is not unique". After ANY
  arity/return change, `DROP` the old signature and immediately test-call the OLD shape. The deploy
  drift-gate (`ops_deploy_preflight_checks`) also flags `duplicate_overloads`.
- **Ingestion is automatic:** `sync_search_listings_ar()` (pg_cron job 28, hourly) copies
  `property_age` from `listing_native_location_v2` with zero transformation. A new listing's age
  (0=new / integer years / NULL=unknown) reaches the filter within an hour of scrape — no manual
  step, no backfill.
- **Wasalt age note:** wasalt's real age signal is `additional_info.completionYear` (parsed in
  `listing_extra_attrs`), not the mostly-NULL raw `property_age` column. This is correct, not a bug.

## Monitoring (end-of-pipeline coverage)

Detectors run hourly (pg_cron job 38 → `mon_run_all_detectors` → `mon_dispatch_alerts`), writing to
`alert_event` → `monitoring_dashboard` via `mon_raise`/`mon_resolve`. Coverage across
scrape → match → enrich → index → **searchable**:

- scrape/discovery: `mon_detect_silent_scraper_death`, `mon_detect_zero_new_stall`,
  `mon_detect_volume_drop`, `mon_detect_cron_health`
- enrichment/refresh: `mon_detect_stale_refresh`, wasalt enrich-backlog monitor
- activation/integrity: `mon_detect_stale_active_fraction`, `mon_detect_field_integrity`,
  `mon_detect_legacy_alert_tables`
- **final search-index freshness:** `mon_detect_search_index_freshness` (P2 >3h sync-gap or
  backlog>500; P1 >6h or backlog>5000; distinct P1 "no-advance" when the sync job succeeds but
  backlog persists; auto-resolves on recovery). Query `select public.search_index_freshness();`
  for a live snapshot (newest raw ts, last successful sync, lag minutes, backlog, affected
  platforms). **Do NOT** build freshness on `search_listings_ar.last_updated` — it is fed by the
  unmaintained `listing_location_canonical` and is permanently stale; use backlog + sync-advance.

## Testing checklist (run before every merge)

- [ ] `npx tsc --noEmit` — 0 new errors
- [ ] `npm test` — full suite green
- [ ] `npm run verify` — taxonomy + location-index gates pass
- [ ] `npx expo export --platform web` — clean build; grep the bundle to confirm the new
      field/constant is present and any removed field (e.g. `cnt_lt1`) is **absent**
- [ ] Live counts RPC returns the exact bucket columns the frontend destructures (no drift — a
      removed column silently reads `undefined` and quietly breaks an option)
- [ ] Strict proof: for each numeric bucket, join returned `location_search_candidates_ar` rows back
      to `search_listings_ar.property_age` and assert **every** row is in range and **none** is NULL
- [ ] Category purity: same call with a deliberately wrong `p_category` returns 0 rows
- [ ] Eligibility: apartment-only scope triggers; Villa/Land/Commercial/multi-type never do
- [ ] Fallback: simulate RPC failure → flow degrades to refine chips, no freeze/error
- [ ] No duplicate overloads on any changed RPC

## Deployment steps (guarded)

1. Apply backend SQL live via Supabase MCP `apply_migration`; **mirror it into a committed
   `supabase/migrations/*.sql`** so the deploy drift-gate stays satisfied (gate matches on migration
   **name** or version).
2. After any arity/return change: `DROP` the stale overload + test-call the old shape.
3. Commit → PR → squash-merge to `main`.
4. **Frontend change?** deploy via `scripts/safe-deploy.sh` (or MCP-held-lock mode:
   `DEPLOY_LOCK_MCP_HOLDER=<holder> bash scripts/safe-deploy.sh` after
   `acquire_deploy_lock('production', …)`; release with `release_deploy_lock` after verifying prod).
   Hold the deploy lock; only one session deploys at a time. **Backend-only change?** no Vercel
   deploy — landing the migration on `main` is the whole "deploy".
5. Verify on the real anon key (not privileged MCP), then confirm the served bundle.
