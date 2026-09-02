# Property-type → Advanced Filter → results: the full audit (2026-09-02)

Routine #5 (🎯 Senior AF + Trending Data Integrity), owner-priority property-type audit.
PR [#1481](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/1481).

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, 0be0a1d)
```

## The headline

**The results layer was already correct, and is now provable.** Every certified
(clean type × deal × period) cohort × every question that cohort certifies, RPC ID set vs
independent DB truth: **157/157 non-empty cases, MISSING = 0, EXTRA = 0, DUPLICATES = 0, counts
exact.** A type leak would appear as an EXTRA by construction, because the oracle encodes
`type_ar IN (…)` **and** the AF predicate in one query.

What was actually broken was one layer up — **which questions may be asked**, and **which answers
survive a scope change**. Neither is visible from the results of a single search, which is why a
count-only audit would have called this surface clean.

## What the live catalog says (re-queried, not assumed)

51 live `known_type_ar` rows; 59 enabled `af_cohort_registry` cohorts over 34 types; 21 clean types
carry a shipping `COHORT_QUESTIONS` entry. The registry is a certification record and a monitor
scope selector — **not** a runtime gate; the code config is the only live gate.

## Defect 1 — `property_age` was the one question that skipped certification

Eight of nine AF questions gated on `cohortAllows(q, id)`. `property_age` gated on
`isAgeFilterScope()` in the manual UI and on `cohortAllows()` in the AI chat. Executing both over
the full 51-type × 3-leg matrix: **they disagreed on 16 of 93 cells** — Room/Buy offered an age
question `COHORT_QUESTIONS` does not certify (R2.1.1), and 15 cohorts had the chat applying an age
filter the manual card could never offer.

**A second routine found and fixed this in the same window, and landed first.** Its direction is
better than mine and this branch adopts it wholesale:

| | approach |
|---|---|
| mine | keep both gates, intersect them in a new `afQuestionAllowed()` |
| **main's (taken)** | **DELETE `src/lib/ageFilterTypes.ts`; `cohortAllows()` becomes the single registry** |

The duplicate type→macro map *was* the defect, not the thing to preserve. Intersecting would have
kept a second opinion alive and permanently withheld `property_age` from 15 cohorts that certify it.
Deleting it also settles a contract tension this audit surfaced independently: **R2.2.3** lists
`property_age` in the Apartment+Villa intersection, but the old single-type-only age gate refused
every multi-type scope. With the map gone, `cohortAllows()`'s own safe intersection handles it.

So `afQuestionAllowed()` is gone from this branch. What survives is the **barrier**, rewritten onto
the surviving architecture — because its value was never which fix won.

## Defect 2 — eleven AF answers survived every scope change (this branch's own fix)

`SearchQuery` carries 11 AF answer fields. Nothing re-validated any of them against the new cohort
on a scope change.

**Where that is reachable is not where reading the code suggested**, and this is worth recording:

- **NOT the manual Filter home.** `setCategory()` resets 13 fields and none of the 11; the type
  toggle resets six and none of the 11 — which reads exactly like a leak. A real browser journey on
  production proved otherwise: the Apartment answers `p_bath_min` / `p_is_new_construction` /
  `p_amenities` all **die** on the way to a أرض سكنية search, on the un-deployed bundle, with no
  prune involved. The reason is structural — the AF-refined query is handed to `runQuery()` per
  search and never written back into the store query `index.tsx` edits. **Reported as safe, not as
  fixed.**
- **THE CHAT is where it reaches a user.** `mergeConversationState()` carries every established
  `STICKY_FIELD` forward, and all 11 AF answer fields are on that list right beside `type` and
  `category`, with no cohort re-validation in the merge. «ابغى شقة بثلاث دورات مياه» then «خلها أرض»
  keeps `bathMin: 3` on a land search. Land rows have NULL bathrooms against a strict-NULL-excluding
  clause, so the result set is silently amputated.

**Fix:** `pruneUncertifiedAdvanced()` drops every answer the new scope does not certify — token by
token for amenities (a chip can go stale while the question stays certified), with `rnpl` judged by
its own gate since it writes into the same array. It runs in `rpcFilterParams()` **and**
`rpcCountFilterParams()`: the one choke point every search, count, Trending click-through and
Load-More page shares, so the manual, chat, sidebar-reopen and pagination paths are covered at once
instead of each having to remember.

## What the audit confirmed as CORRECT (equally important)

- **AND/OR semantics — all six hold exactly, zero row-level violations.** Multi-amenity is AND (one
  conjunct per token); `p_directions` / `p_bath_exact` / `p_unit_subtypes` / `p_types` are IN;
  different fields AND. The owner's worked example — `Villa AND street_width ≥ 15 AND direction IN
  (N,W) AND pool = YES` — returns only rows satisfying all four.
- **NULL/UNKNOWN is genuinely three-valued.** The index preserves NULL for every AF attribute (no
  ETL coalesce: elevator 121,926 NULL / 41,527 false / 32,570 true), every AF predicate is
  strict-NULL-excluding, and AF option counts report unknown separately and exactly — no unknown is
  ever folded into a Yes or a No bucket.
- **Category purity under the dual `عمارة` label.** For a Commercial search, scope B excludes
  `عمارة` deliberately, because in a residential table it means Residential Building. My harness got
  this backwards first and "found" 711 phantom leaks; **production was right and the harness was
  wrong.**
- **`jurash.floor_number`** — yesterday's OPEN item, now closed and production-verified: 5 of 11
  rows carry floor values 2–3.

## Barriers added (mutation-proven 10/10)

| barrier | proves | mutations |
|---|---|---|
| `verify-af-question-gate-is-one-predicate.ts` | R2.1.1 executed over 93 cells × 9 ids; no question may carry a private gate; **and a second type→macro map can never grow back** beside the registry | 5/5 |
| `verify-af-answers-die-with-their-scope.ts` | every named transition + **3,588 ordered cohort pairs**; SAFETY *and* LIVENESS (so a prune-everything cannot pass); executes the real `mergeConversationState` | 5/5 |
| `verify-af-property-type-differential.ts` | 157/157 certified cohorts, exact ID sets, self-configuring from the live catalog | live |
| `verify-af-stale-predicate-live.ts` | a real browser type change, asserting the request body | live |

Two existing barriers caught defects in **my own** work on the way in — `verify-af-oracle-soundness`
rejected an unordered `Range` page in the district reference fetch, and
`verify-live-checks-self-sufficient` caught the new journey depending on a repo secret, the exact
way two barriers once silently never ran. Both worth recording: the guards did their job on the
person adding guards.

## Latent findings, deliberately not changed

- `p_has_license := false` turns an UNKNOWN licence into a confirmed "no licence" — the only
  non-tri-state predicate in the clause. **Unreachable**: no shipped client sends it (zero hits in
  `src/`). Changing clause semantics for an unreachable parameter is a product decision, not a fix.
- A NULL element inside `p_amenities` mutates the filter into "must have EVERY amenity" (returns 0).
  Fail-closed, and unreachable from the UI vocabulary.
- Array cardinality caps cover 5 parameters but not `p_amenities` / `p_directions` /
  `p_unit_subtypes` / `p_bath_exact` / `p_beds_exact`.

## Routed, not fixed

- **Rent period asserted where the source is silent** (~778 rows served as confirmed «سنوي»).
  Structurally confirmed here: `search_listings_ar` has **zero** NULL `rent_period_ar` among 77,345
  production_ready rent rows, so an unknown period cannot be represented as unknown at all. Not
  adjudicated: AGENTS.md rule #2 forbids asserting what a source publishes without a live probe, and
  the hosts are egress-blocked from this container. An open `manufactured_rent_period` P2 already
  covers the class. Routed to routine #3; recorded in the coverage ledger.

## Owner decision requested

None blocking. One worth knowing: with `ageFilterTypes.ts` deleted, `property_age` is now offered on
15 commercial/rural cohorts that certify it but that the old gate's 150-row counts==search parity
floor had never cleared. That is main's deliberate choice and it satisfies R2.1.2 (cohort entries
are added only after profiling). Flagging it only because the two gates encoded genuinely different
facts and one of them is now gone.
