# Derived-store freshness — proposal to remove the stale-snapshot risk permanently

> **Status: PROPOSAL. Nothing here is implemented.** Written 2026-08-31 by the Data Integrity
> routine at the owner's request, after two frozen snapshots were found serving listings in the
> wrong city and the wrong district on the same day. It proposes an architecture and asks for a
> decision; it changes no behaviour. Taxonomy and wasalt deletion behaviour are explicitly
> untouched per the owner's instruction of 2026-08-31.

## 1. The bug class is not "a missing cron job"

That was my first reading and it is wrong. The accurate statement:

> **Every per-listing derived row in the location pipeline is written once, when the listing is
> first seen unresolved, and is never reconciled against the source again. Nothing in the system
> asks "does this stored row still match what the source says today?"**

"No refresh job" is the extreme case of that, not the disease. `listings_arabic_locations` *has*
six scheduled writers and still went stale, because every one of them is gated on the listing being
**unresolved**:

```sql
-- resolve_english_city_overlay(), the generic overlay
where s.city_id is null            -- ← only listings with no city yet
on conflict (index_id) do update
  set city_ar = ..., region_ar = ...   -- ← city/region only; never raw_district/district_ar
```

So a listing that was resolved once is invisible to the resolver forever, however much its source
changed. The district fields are never updated by any writer at all. Two further sharp edges in the
same function:

- `exception when others then null` swallows per-table failures silently — a platform whose overlay
  errors every run looks identical to one with nothing to do.
- The overlay excludes `aqar_` and `deal_` tables by name, so those platforms depend entirely on
  their own stores.

## 2. Inventory — what actually feeds live location resolution

`listing_native_location_v1` (matview, hourly jobid 17) → `..._v2` → `sync_search_listings_ar` →
`search_listings_ar` → the Normal Filter RPC. These are the **per-listing derived stores** in that
chain. Curated geography catalogs (`loc_catalog_*`, `loc_*_map`, `loc_city_alias_ar`) are *not* in
scope — they describe Saudi Arabia, not listings, and being static is correct for them.

| store | rows | writer | evidence of drift |
|---|---:|---|---|
| `listings_arabic_locations` | 261,597 | 6 scheduled fns, all gated `city_id is null`; district never written | **6 rows served a district the source never published** (repaired 2026-08-31). 6,781 of 21,172 active gathern rows carry raw fields that no longer match the live source |
| `aqar_shadow_resolved` | 141,539 | **none** | 18,275 rows reference aqar listings that no longer exist; 2,606 active rows where its own `parsed_city_id` ≠ `today_city_id`, and v1 serves the *parsed* one |
| `phasea_src_arabic` | 23,252 | **none** | **3 rows served the wrong city** (repaired 2026-08-31), incl. a Jeddah apartment served as Abha |
| `district_recovery` | 42,172 | 1 scheduled fn | not investigated |
| `ops_location_inference_flags` | 1 | none | negligible |

Why it stayed invisible: `search_listings_ar` agreed with `v2`, which agreed with `v1` — all wrong
together — and `mon_search_index_city_drift` compares the index against **the resolver's own
output**, so it is structurally incapable of catching a resolver that is confidently wrong. The one
monitor that did ask the right question, `mon_district_contradicts_source`, was a **view with no
detector function and no roster entry**: it read 6 for weeks while every barrier was green.
(`mon_detect_orphaned_detectors()` fires on a detector nothing reaches, but not on a view that never
became one.)

## 3. Why "just refresh the snapshots" is the wrong fix

This is the most important finding in the investigation, and it is why the proposal below is
conservative.

`aqar_shadow_resolved` carries both `city_ar_parsed` (snapshot-time) and `today_city` (a
re-derivation) — the schema already anticipates reconciliation. On 2,606 active listings the two
disagree. If `today_city` were truth, "reconcile to today" would be a one-line fix. It is not:

| disagreement | n | what it tells us |
|---|---:|---|
| «الاحساء» → «الهفوف» | 496 | the reserved taxonomy question — **owner's decision, untouched** |
| «الدمام» → «الظهران» | 81 | |
| «الخبر» → «الدمام» | 79 | **both directions between the same cities** — this is proximity/geocode drift, not source truth |
| «الدمام» → «الخبر» | 58 | |
| «البدائع» → «البدائع» | 79 | **identical name, different city_id** — a duplicate-catalog artefact, not a location disagreement at all (191 duplicate city names exist in `loc_catalog_city`) |
| «جدة» → «ثول», «أبها» → «خميس مشيط», … | rest | adjacent towns; unresolvable without per-listing source evidence |

A bulk reconciliation would move ~2,606 aqar listings on evidence that is demonstrably unreliable in
at least three distinct ways. **`today_city` must never be treated as truth.** This is the same
lesson as 2026-08-30's kill-spike and today's own two false readings: the measurement is the likelier
defect.

## 4. Proposed architecture

Four layers, each independently useful and shippable. The ordering matters: 1–2 are pure
observability and carry no behaviour change.

### Layer 1 — a registry, enforced like `liveness_policies.py`

This repo already solved this shape once: every production-searchable platform must declare a
liveness strategy or CI fails. Mirror it.

`ops_derived_store_registry`: one row per per-listing derived store, naming the source table, the
source columns it derives from, its writer, its **max age**, and its **staleness policy**. A store
that feeds live resolution and is not registered → CI red. A registered store with no writer and no
expiry → CI red. This alone makes "frozen store nobody remembers" structurally impossible.

### Layer 2 — provenance, so staleness is computable rather than guessed

Each derived row gains `captured_at` and `source_fingerprint` — a hash of exactly the source fields
it was derived from. Then "is this row stale?" stops being a judgement call: **fingerprint mismatch
means the source changed since capture.** Cheap, exact, and it needs no re-fetch.

Backfill is safe: rows without a fingerprint are simply `UNKNOWN`, which Layer 4 treats
conservatively rather than trusting.

### Layer 3 — one parameterised contradiction detector, registry-driven

Generalise the two detectors added on 2026-08-31
(`mon_detect_phasea_snapshot_stale_vs_source`, `mon_detect_district_contradicts_source`) into a
single detector that walks the registry and, for each store, counts rows where the fingerprint no
longer matches the live source **and** the row currently affects what a user is served.

Critically, it measures **user-visible contradiction, never raw drift**. That distinction is
load-bearing: 6,781 gathern rows carry raw differences but only 6 contradicted the published
district. A detector keyed on raw drift would raise thousands of unclearable findings and invite
exactly the bulk rewrite §3 shows to be unsafe — the `mon_detect_unresolvable_alert_kinds` failure
mode this repo already knows.

This satisfies *"stale snapshot contradictions should alert before affecting user-visible search"*.

### Layer 4 — precedence inversion, with a safe failure direction

The rule the owner asked for — **live source outranks a frozen snapshot** — expressed so it can
never invent data:

| live source | snapshot | resolution |
|---|---|---|
| present, unambiguous | agrees | serve it (unchanged) |
| present, unambiguous | **contradicts** | **serve the live source**; log the correction |
| present, ambiguous | anything | **resolve to NULL** (§6: never guess) |
| absent | present, within max age | snapshot may fill in, marked as snapshot-derived |
| absent | present, **past max age** | **demote to unresolved** |

The demotion is safe because the failure direction is already load-bearing in production: 440 rows
are currently served through the **unlocated fallback** (`city_id IS NULL`), and
`reachable_by_nothing = 0`. A demoted listing therefore stays searchable — it simply stops asserting
a city it can no longer justify. **Nothing is deleted, deactivated, or hidden.** That is what makes
expiry acceptable here where it would not be elsewhere.

Repairs stay per-row and evidence-backed, using the adjudication-ledger pattern already proven by
`ops_res_com_collision_adjudication` — **no broad re-resolution or mass rewrite without source
proof.**

## 5. Suggested phasing

| phase | change | risk | reversible |
|---|---|---|---|
| 0 | *(done 2026-08-31)* two contradiction detectors + roster entries | none — observability | yes |
| 1 | registry + CI gate | none — no runtime behaviour | yes |
| 2 | `captured_at` / `source_fingerprint` columns + backfill | none — additive columns | yes |
| 3 | generalised detector replaces the two point detectors | none — observability | yes |
| 4a | precedence inversion for **contradiction** (live wins) | **behaviour change** — needs owner sign-off and a measured blast radius first | yes |
| 4b | expiry → demote-to-unresolved | **behaviour change** — same | yes |

Phases 1–3 are safely inside this routine's GREEN authority (monitors, detectors, ops metadata) and
could ship without an owner decision. **Phases 4a and 4b change what users are served and should
not ship without explicit approval**, including a measured count of affected listings per store
published before the change — which Layer 3 produces as a side effect.

## 6. What this proposal deliberately does not do

- **No taxonomy decision.** «الاحساء» → «الهفوف» (496 aqar + 29 phasea rows) is preserved exactly as
  it is until source/taxonomy truth is settled by the owner.
- **No wasalt change.** The 3,364-row backlog stays untouched; UNKNOWN stays UNKNOWN; the anomaly
  gate is not weakened. Nothing in Layer 4 touches liveness or deactivation — demotion affects
  *location confidence only* and never `active`.
- **No bulk re-resolution.** §3 is the argument against it.
- **No re-opening of the 2026-08-31 repairs.** Those are complete and production-verified.

## 7. Open questions for the owner

1. **Approve phases 1–3?** Pure observability; makes a frozen store impossible to forget and
   produces the blast-radius numbers phase 4 needs.
2. **Max age per store** — what is an acceptable age for a location derivation before it must be
   revalidated or demoted? This is a product judgement about staleness tolerance, not an engineering
   one.
3. **Is demote-to-unresolved acceptable** as the expiry behaviour, given it keeps the listing
   searchable via the unlocated fallback but drops it out of city/district-filtered results?
4. **Duplicate catalog cities** — 191 duplicate names in `loc_catalog_city`, visible here as
   «البدائع» → «البدائع» across 79 listings. Out of scope for this proposal; flagged because it
   will distort any reconciliation built on city ids.

## 8. Related

- `docs/ops/DATA_INTEGRITY_ENGINEER.md` §6 (never guess a location), §9 (search-index parity)
- `docs/ops/LISTING_LIVENESS.md` — the three-valued model this proposal borrows for freshness
- `scrapers/common/liveness_policies.py` — the registry-enforced-by-CI precedent Layer 1 copies
- Migrations `20260831080856`, `20260831092750` — the two point detectors Layer 3 would generalise
