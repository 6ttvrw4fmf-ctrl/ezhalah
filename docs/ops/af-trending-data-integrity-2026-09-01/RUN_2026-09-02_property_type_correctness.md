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

## Defect 2 — `bothDeals` certified against one leg while searching both (this branch's fix)

Same bug class as Defect 1, found by the fleet's AI-handoff dimension:

```
src/data/remote.ts:653   p_deal: (q.bothDeals || q.dealCombined) ? null : …
src/lib/afCohorts.ts     if (q.dealCombined) return cohortAllowsCombined(...)
```

The **request boundary** treats the two fields as one concept — `af_eligibility_clause()` reads
`p_deal IS NULL` as Buy ∪ Rent(any period) — while the **certification gate** treated them as two.
So the AI-chat fallback (`bothDeals`: the agent could not tell Buy from Rent from free text)
certified questions against a SINGLE leg while the search spanned both. Strict-NULL-excluding
predicates then amputate the leg the question was never validated against. Exactly R2.2.2.

One condition, a pure narrowing (Buy ∩ RentAnnual ∩ RentMonthly ⊆ any single leg). Measured on
Apartment: a `bothDeals` scope now withholds property_age / direction / furnished / rnpl and keeps
amenities / bathrooms — identical to `dealCombined`. Mutation-proven.

## The fix I withdrew, and why

I first built `pruneUncertifiedAdvanced()` — a sweep at the request boundary dropping every answer
the new scope does not certify. **It was withdrawn before merge.** Three things, in the order I
learned them:

1. **The manual Filter home does not leak.** `setCategory()` clears 13 fields and none of the 11 AF
   answers, which reads like a defect — but a real browser journey on production showed the
   Apartment answers dying anyway on the way to a أرض سكنية search, with no prune involved. The
   AF-refined query is handed to `runQuery()` per search and never written back into the store query
   `index.tsx` edits. **The browser disproved my code reading.**
2. **My own fix was inert on the search path**, and the fleet caught it, not me. All eleven AF params
   are spread onto `baseRpcParams` at the call site off `fetchListingsForQuery`'s own `q`;
   `rpcFilterParams()` contributes none of them. My barrier passed because it asserted the prune was
   *called*, not that the params derived from it — the protects-nothing shape this whole audit is
   about.
3. **It was redundant, and worse than what already existed.** PR #1477 had already shipped
   `certifyAfOnMergedState()`, whose step 4 does exactly the same sweep, wired into both chat merge
   sites with a 201-line barrier. It also **announces** each dropped filter through `rejected`, where
   mine binned them silently — its own comment argues the point against my approach: *"Trading a
   silent wrong filter for a silent missing one would be no better."*

Keeping it would have added a second certification authority at the request boundary — the precise
antipattern this audit exists to remove, and the one that produced the `property_age` divergence.

## Defect 3 — a Buy floor deleted every rent card the server had correctly returned

PR [#1485](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/1485), found in the follow-up pass over the
findings #1481 recorded but did not fix. Not an AF predicate — a NORMAL-filter one — but the same
question the owner's brief asks: does the user get what they selected?

Combined شراء+إيجار carries TWO budgets, and the RPC splits them by the row's own deal
(`location_search_candidates_ar`, `p_deal IS NULL`: 'بيع' → `p_price_min/max` on `price_total`,
'إيجار' → `p_price_min_rent/max_rent` on `price_annual`). `priceFilter()` applied the **Buy** pair to
every row, rent included, and never read the rent pair at all. `Buy 500k–2M + Rent 20k–60k` returned
a correct server set and then deleted every rent card in it. The headline count, which comes from the
RPC, still counted them — and `hasClientOnlyNarrowing()` never declared this narrower, so the count
was not suppressed either. Reproduced against the real predicate: three rent rows inside the stated
rent budget, **zero** returned.

Same shape as Defects 1 and 2: two layers holding different opinions about one concept, with the
divergence invisible from any single search's results.

### Defect 3, proven and re-proven in a real browser

The offline barrier proves the predicate. It cannot prove what the owner actually asked about, so a
live journey does — Riyadh · شقة · both deals · a 500,000 Buy floor typed in, Rent box left empty.
Same journey, same cohort, run twice against `https://ezhalah-app.vercel.app`:

| | bundle | rent rows handed to the app | of those, under the Buy floor | rent cards on screen |
|---|---|---|---|---|
| before | `entry-974d0d5d…` | 1,166 of 1,500 | 1,155 | **0** |
| after | `entry-2880b17a…` | 1,166 of 1,500 | 1,155 | **6** (3 «/سنوياً» + 3 «/شهرياً») |

The backend never changed between those two runs. Only the client's price net did.

Two harness notes, both cases of the test being wrong before production was — the same lesson the
711 phantom commercial "leaks" taught below:

- the candidate RPC returns KEYS ONLY (`source_table, listing_id, platform, …`) with **no deal
  column**. A first draft filtered its rows on `deal_ar` and "found" 0 rent rows in a 1,500-row
  response. The rows the app will actually render arrive in the hydration GETs, which carry
  `transaction_type` and `rent_period`; those are what the journey counts.
- the "some are priced BELOW the Buy floor" assertion is not decoration. Without such a row the
  floor would not bite, and the journey could not tell fixed code from broken code.

Also checked and clean: all four count/search RPCs (`location_search_candidates_ar`,
`top_cities_by_deal_ar`, `apartment_guided_counts_ar`, `property_age_option_counts_ar`) already
accept `p_price_min_rent`/`p_price_max_rent`, so the defect was the client net alone — no second
instance on the Trending or option-count surfaces.

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

## Barriers added (mutation-proven 6/6)

| barrier | proves | mutations |
|---|---|---|
| `verify-af-question-gate-is-one-predicate.ts` | R2.1.1 executed over 93 cells × 9 ids; no question may carry a private gate; a second type→macro map can never grow back; **and `bothDeals` certifies exactly like `dealCombined`** | 6/6 |
| `verify-af-property-type-differential.ts` | 157/157 certified cohorts, exact ID sets, self-configuring from the live catalog | live |
| `verify-af-stale-predicate-live.ts` | a real browser type change, asserting the request body | live |
| `verify-combined-deal-budget-split.ts` | each combined-mode budget binds only its own deal; an empty box is never a 0 bound; single-deal search unchanged. Lifts the REAL predicate, never a copy | 7/7 |

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

## Ratings

```
ADVANCED FILTER HEALTH:        8.9/10 (89%) → 8.9/10 (89%)
TRENDING CITIES HEALTH:        9.3/10 (93%) → 9.6/10 (96%)
TRENDING DISTRICTS HEALTH:     9.3/10 (93%) → 9.6/10 (96%)
AF DATA INTEGRITY:             9.4/10 (94%) → 9.4/10 (94%)
OVERALL AF + TRENDING HEALTH:  9.0/10 (90%) → 9.0/10 (90%)
```

Derived by `scripts/verify-af-contract-coverage-map.ts` over 135 graded contract rules
(L 58 · B 59 · P 18 · N 0), not asserted.

**Three defects fixed and deployed, and OVERALL did not move.** That is the honest reading, not a
failure to report one. The map grades `ADVANCED_FILTER_PRODUCT_CONTRACT.md` rules, and the combined
Buy+Rent budget is a NORMAL-filter field with no rule of its own; the two certification-gate fixes
landed on rules already graded B. Writing new contract rules for surfaces I had just fixed would
have raised my own score by editing the ruler — AGENTS.md forbids manufacturing a 10/10, and this is
the shape that would do it.

## Post-deploy production verification

Deployed `c5918ae`; served bundle moved `entry-974d0d5d…` → `entry-2880b17a…`, read by direct
`curl` rather than believed from job status. All five suites green against that bundle:

| suite | result |
|---|---|
| `verify-af-live-truth` | 9 journeys, exact ID diffs — all checks passed |
| `verify-af-stale-predicate-live` | no stale AF predicate crosses a property-type change |
| `verify-af-property-type-differential` | every certified cohort returns only its own type, satisfying every AF answer |
| `verify-trending-filter-state-live` | 22 live assertions + 3 mutation proofs |
| `verify-combined-budget-live` | a combined Buy+Rent search shows both sides |

## Still open at end of run

- **`migration_drift` (P1) is red at 11 migrations, and it is an UNMERGED-PR backlog, not unmirrored
  SQL.** Verified: PR #1426 carries 4 of the 11, PR #1455 carries 2, and #1462's title names a
  seventh. The four `20260902*_af_option_*` were applied ~2h before this run by a concurrent
  session, which owns mirroring them. Opening a twelfth mirror PR would only deepen the pile —
  #1399, #1386, #956 and #858 are all still open. Policy says these stay open for human review, so
  clearing the barrier is an owner merge decision.
- **P1 gathern studio labelling** — 9,076 rows the source labels «استديو» served as شقة. Needs
  source adjudication; routine #3's territory.
- **P2 alert 781 `af_field_stuck_no_variance`** — triaged this run and routed, not fixed. Its four
  stuck pairs are two different shapes and the alert text does not distinguish them: wasalt
  driver_room 0/74 is unremarkable against a 5.9% platform-wide base rate, while satel
  air_conditioner 42/0, satel kitchen 42/0 and sanadak maid_room 35/0 are all-TRUE and cannot
  manufacture a No. Deciding either needs the source page, and the source hosts are egress-blocked
  from this container.
- **P2 sidebar chat-reopen** may carry the previous conversation's type + AF answers forward;
  unverified against `certifyAfOnMergedState()` coverage.
