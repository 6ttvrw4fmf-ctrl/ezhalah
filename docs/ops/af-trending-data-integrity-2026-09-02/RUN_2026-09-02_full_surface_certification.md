# The whole certified Advanced Filter surface, option by option, against independent DB truth (2026-09-02)

Routine #5 (🎯 Senior AF + Trending Data Integrity), owner-directed FULL correctness certification.

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, 0be0a1d)
CONTRACT RULES SPOT-AUDITED THIS RUN: R1.6.1, R2.2.4, R2.3.1, R2.4.1, R2.4.2, R2.5.1, R2.5.2, R5.1.1, R5.3.1,
  R5.5.1, R5.5.2, R7.1.1, R7.1.2, R7.1.3, R7.2.1, R7.2.2, R7.4.1, R7.5.1, R8.1.1, R8.1.2, R8.1.3, R9.2.x,
  R10.1.1, R11.2, R11.3, R13.3, R13.6
CONTRACT/PRODUCTION CONFLICTS FOUND: 0
OWNER DECISIONS OPENED (contract-change requests): NONE
```

## The owner's definition, and what was measured against it

> Whatever number and option Advanced Filter shows must equal the real database truth, and clicking
> that option must return exactly the correct listings — not one more, not one fewer, and no
> listing that fails the filter.

That is five witnesses per option, all of which must agree, and it is now measured for **every
option of every certified cohort**, not a sample:

| witness | what it is |
|---|---|
| chip | the number ON THE CARD — the `cnt_*` column of the count RPC the app calls, with the app's request shape |
| applied | `af_eligible_count()` with the option applied |
| search total | `location_search_candidates_ar` `total_count` with the option applied — what «بحث» lands |
| paged ID set | that call paged to exhaustion — the cards the user can scroll to |
| oracle | PostgREST filters on `search_listings_ar` (shares no SQL with our RPCs); its rows then re-evaluated in JavaScript on their own column values |

The comparisons are pure (`scripts/lib/afSurfaceJudge.ts`) and mutation-proven offline in `npm test`
(`verify-af-surface-judge.ts`), so the live sweep cannot pass vacuously: chip ±1, a wrong total, an
EXTRA, a MISSING, a duplicate, a short page, a NULL reaching a strict set, a row failing its own
predicate, an OR implemented as AND (and the reverse), a fabricated unknown caption and a rendered
option under the floor are each rejected.

## The surface, enumerated from the live catalog

39 certified cohorts = `COHORT_QUESTIONS` (the runtime gate the product executes) × leg, cross-checked
against the certification registry mirror (production rows md5 `e24bc3e6…`, 59 rows, all enabled).
The sweep FAILS if a certified question id has no catalog arm, and `verify-af-full-surface-catalog.ts`
(npm test) pins the catalog to `COHORT_QUESTIONS`, the `GuidedCounts`/`AgeOptionCounts` columns, the
keys `rpcAdvancedFilterParams()` can emit, the columns the clause filters, the card's option vocabulary
and the workflow wiring — a new question or chip cannot fall out of the sweep silently.

## Results — `verify-af-full-surface-differential.ts`

| | Riyadh region (all stages) | جدة city (single-type stages) |
|---|---|---|
| cohorts | 39 | 39 |
| option chips verified (5 witnesses each) | **931** | **577** |
| chat-only amenity predicates (no chip) | 88 | 88 |
| zero-result options (zero everywhere) | 92 | 126 |
| same-field OR unions (directions, footer = union) | 18 | 17 |
| cross-field AND intersections, each with the round-2 chip priced inside the first answer | 150 | 134 |
| full stacks (every certified question at once) | 25 | 21 |
| multi-type pairs (certified intersection executed) | 150 | — |
| combined Buy∪Rent options | 24 | — |
| both-period (كلاهما) options | 31 | — |
| unknown captions = DB NULL count | 53 | 52 |
| boundaries exercised (a row ON the threshold present) | 337 | 202 |
| **MISSING / EXTRA / DUPLICATES / COUNT MISMATCHES** | **0 / 0 / 0 / 0** | **0 / 0 / 0 / 0** |
| **NULL→value leaks / row violations** | **0 / 0** | **0 / 0** |
| oracle refusals | 0 | 0 |
| checks | 1,443 | 928 |

Nationwide (no location, the unlocated carve-out the PostgREST oracle cannot model): the DB-side
`ops_af_option_truth_sweep` (chip = `af_eligible_count` per registry cohort × option) completed its
own daily rotation clean at 00:41 today; 11 of 40 slices were re-executed during this run with 0
disagreements; no alert of kind `af_option_count_truth` has ever been raised.

## Two oracle gaps found and closed on the way in

Both are places where the *independent* oracle would have reported a phantom defect against a
correct production — the opposite failure, but a failure of the ruler all the same:

1. **Directions are stored with the nisba «ي».** The index holds «شمال شرقي» (3,992 rows), never
   «شمال شرق» — the key the chip sends — and the RPC normalises both sides. A literal
   `direction_ar=in.(key)` undercounts every compound direction. `buildOracleQS` now REFUSES
   `p_directions` unless handed a variants map built from the observed spellings by Arabic
   morphology alone (`directionVariantsFrom`, `loadDirectionVariants`), and refuses on any
   unclassified spelling. Mutation-proven.
2. **`p_rent_period = 'كلاهما'`** was unhandled. It is now translated verbatim from the clause
   (`payment_monthly OR annual OR monthly-labelled-with-RNPL`) — never "no period filter", so a rent
   row whose source published no period stays out. A period under a non-Rent deal is refused.

## The real path, in a real browser

| journey | what it proves |
|---|---|
| `verify-af-option-card-truth-live` (new) | every rendered option's pill = the captured `cnt_*` = the oracle; label ↔ key (the checkmark glyph is not a label); the baseline request IS the intended scope; chip unchanged by every Skip; the unknown caption = DB NULL count; click → landed count = RPC = oracle, ID sets identical; «عرض المزيد» past the 1,500-row buffer: a real network page (`p_offset=1500`) with the same whole predicate, no duplicate across pages, every card ⊆ the oracle set; a second answer = the conjunction, priced inside the first. Desktop الرياض/شقة/Buy: 330 checks, option «1+» = 2,281 rows, 16 clicks to the first network page, 2,000 rows walked, 0 duplicates. Mobile 390×844 جدة/فيلا: 299 checks. |
| `verify-af-remove-last-pill-live` (new) | a DECOY search in another city first, then the real baseline: removing the LAST pill returns byte-exactly to the pre-AF request (zero AF keys, same non-AF keys, and provably not the decoy), the same count, no pill, the same question re-offered; the rows the APP received on the restored turn ⊆ the oracle set with page 0 complete, and the turn RENDERED exactly the first page of cards |
| `verify-af-scope-change-live` (new) | Buy → Rent-Annual → both periods → Monthly after committing answers: exactly the answers `cohortAllows()` certifies for the NEW scope survive with the same values, the rest are absent, nothing appears that was never committed, every count = oracle. Gate-independent structure on the wire: the both-period body = Annual ∩ Monthly, only drops, no unknown wire key, no non-AF key moved except deal/period, and `p_tables` follows its documented derivation (the two monthly-only sources join exactly when the scope includes Monthly — `resTables()`). |
| `verify-af-pill-removal-live` (this morning) | removing one of several pills drops exactly that predicate |
| `verify-af-stale-predicate-live` | property-type change drops every uncertified answer |
| `verify-af-live-truth` | 9 journeys incl. Skip / Back / zero-result / mobile / non-Riyadh |
| `verify-trending-live-four-way-truth` | Trending entry + re-entry carrying AF answers, click-through = advertised |

All green against `https://ezhalah-app.vercel.app`, desktop and mobile (390×844), الرياض and جدة.

## Ratings (tool-derived, `verify-af-contract-coverage-map.ts`)

```
ADVANCED FILTER HEALTH:        9.0/10 (90%) → 9.1/10 (91%)
TRENDING CITIES HEALTH:        9.6/10 (96%) → 9.6/10 (96%)
TRENDING DISTRICTS HEALTH:     9.6/10 (96%) → 9.6/10 (96%)
AF DATA INTEGRITY:             9.4/10 (94%) → 9.4/10 (94%)
OVERALL AF + TRENDING HEALTH:  9.1/10 (91%) → 9.2/10 (92%)

NEW PRODUCT CONTRACT USED FOR RATING: YES
RULES LIVE-TESTED THIS RUN:      69/135   (grade L, was 62)
RULES BARRIER-PROTECTED:         52/135   (grade B, was 56)
RULES WITH INSUFFICIENT COVERAGE: 14/135  (grades P+N, was 17 — P 14 · N 0)
```

The remaining P grades are cross-references and worked examples (weight 1) plus two weight-2
structural negatives (R5.6.2 ask-order-only, R6.1.4 never-truncated-for-cap) and D5, the
`af_field_stuck_no_variance` adjudication that needs the source pages.

## Harness notes (cumulative)

- `npm test` auto-discovers `scripts/verify-*.ts`: a new live browser journey FAILS `npm test` until
  its `test-exclusions.txt` row exists. Add the row with the file.
- Discover distinct values with a next-greater walk (`order=col&limit=1&col=gt.<last>`), not by
  paging the index — 50 tables in ~30 s instead of ~200 ordered pages.
- «عرض المزيد» is served from a 1,500-row page-0 buffer; a pagination proof needs a clicked option
  with more than 1,500 rows, and up to 16 clicks to reach the first network page.
- `p_tables` is NOT scope-stable across a period change: `resTables()` (src/data/remote.ts) appends
  `gathern_residential_listings` + `aqarmonthly_residential_listings` whenever the period scope
  includes Monthly (owner feature 2026-08-14). A "no non-AF key moved" rule must assert the
  derivation, not equality — the first scope-change run went red on exactly this (harness, not product).
- The «بناءً على» summary block shows facet labels («+١ حمامات 🚿»), not the literal prefix; assert
  its disappearance by exact leaf text paired with `pills === 0`.
- The subagent quota was exhausted mid-run (reset 21:00 UTC); the option-card fix round and the
  two remaining adversarial reviews were completed in the main session. Six adversarial reviews in
  all; every finding they raised is closed in the shipped files (decoy-query origin proof, app-received
  rows and rendered cards on the restored turn, gate-independent wire structure, search selection by
  shape rather than recency, SKIP → non-zero exit, direction domain fails closed, pagination past the
  buffer actually exercised).
```
ALL GOOD: YES
```
