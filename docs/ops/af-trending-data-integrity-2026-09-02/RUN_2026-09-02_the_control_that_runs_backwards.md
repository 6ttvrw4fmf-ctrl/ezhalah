# The one AF control that runs backwards had never been tested against production (2026-09-02)

Routine #5 (🎯 Senior AF + Trending Data Integrity), 11:00 UTC run.

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, 0be0a1d)
CONTRACT RULES SPOT-AUDITED THIS RUN: R9.1.1, R9.2.1, R9.2.2, R9.2.3, R2.5.1, R2.5.2, R11.2, R13.6
CONTRACT/PRODUCTION CONFLICTS FOUND: 0
OWNER DECISIONS OPENED (contract-change requests): NONE
```

## The headline

**Production was already correct. What was missing was any proof of it.**

Every AF control narrows — except one. Removing a committed pill widens, and it is the only
interaction that rebuilds the query from scratch rather than adding to it. Until this run the whole
of contract §9.2 rested on `verify-af-cross-round-carry.ts`, which reasons over `removeGuidedFacet`'s
inputs and outputs **offline**. R9.2.2's own half — *«the search re-runs without that predicate, the
count may WIDEN, a new results turn lands below, nothing above is rewritten»* — was graded **P** in
`scripts/lib/afContractCoverage.ts` with the note "not directly asserted."

That gap matters more than its weight suggests. `removeGuidedFacet` rebuilds the query from the
interview's `baseQ` by **replaying** every surviving facet through its own question's `apply()`; it
never un-applies the removed one. That is the correct design (owner 2026-08-23: a hand-written
un-apply is what silently widens a search) — but it means a stale `baseQ`, a facet whose question id
no longer resolves, or a predicate leaking in from outside the replay all produce the *same*
user-visible symptom: a plausible-looking number that is not the search the user asked for. A count
cannot tell those apart. Only the request body can.

## What the live journey found

`scripts/verify-af-pill-removal-live.ts` walks a real round on `ezhalah-app.vercel.app`, removes one
pill, and asserts on the request the browser actually sends. Run twice:

| | desktop 1440×900 · الرياض · شقة | mobile 390×844 · جدة · فيلا |
|---|---|---|
| baseline | 10,698 | 3,607 |
| after one AF round (4 answers) | 155 | 122 |
| committed predicates | `p_bath_min`, `p_is_new_construction`, `p_amenities`, `p_directions` | `p_bath_min`, `p_is_new_construction`, `p_amenities`, `p_street_width_min` |
| pill removed | `p_bath_min` | `p_is_new_construction` |
| after removal | **237** | **265** |
| anon REST replay of the same body | 237 | 265 |
| earlier headlines still on screen | 2/2 unchanged | 2/2 unchanged |

Every assertion passed on both. Survivors came through byte-identical, nothing was invented, the
normal-filter scope (city / type / deal / period / beds / price / area) did not move, the count only
widened, a new turn landed below carrying that exact number, and «تحديد أكثر» was back on the new
turn — so the removed dimension was not burned out of the asked carry (R9.2.3).

**No defect. The value delivered is the proof, not a fix** — and the grades move on evidence that
now exists, not on a judgement call: R9.1.1 B→L, R9.2.1 B→L, **R9.2.2 P→L**, R9.2.3 B→L.

## Mutation proofs — 7/7

A live journey is the easiest place in this repo to write a vacuous assertion by accident, because
the happy path passes whether the assertion is sharp or not. So the six load-bearing comparisons are
pure functions (`R.droppedExactlyOne`, `R.survivorsIntact`, `R.nothingInvented`, `R.scopeUntouched`,
`R.widenedOrHeld`, `R.nothingAboveRewritten`) and the file calls each one on a deliberately corrupted
copy of what production actually did, requiring it to return false.

The seventh is a **real RPC**, because the DB-truth claim must not be provable by logic alone: drop
the surviving predicate from the captured body and require the backend to answer differently
(`p_bath_min` removed: 265 → 468). If it answered the same, the DB-truth check would pass no matter
what the client sent.

**One mutation caught the barrier's own author.** The moved-city mutation hard-coded `p_cities:
['جدة']`; on the جدة run that equals the real value, so the "mutation" was a no-op and the proof was
vacuous — it went red on the mobile run and is now derived from the captured body. Recording it
because it is the exact shape of the thing this file exists to prevent, found by the file itself.

## Also verified clean against production this run

| suite | result |
|---|---|
| `verify-af-live-truth` | 9 journeys — UI = count RPC = result RPC = independent oracle, exact ID sets |
| `verify-af-property-type-differential` | **157/157 certified cohorts** · MISSING = EXTRA = DUPES = 0 |
| `verify-trending-filter-state-live` | 22 live assertions + 3 mutation proofs |
| `verify-combined-budget-live` | combined شراء+إيجار shows both sides; each budget binds its own deal |
| `verify-af-contract-coverage-map` | 135 rules graded, every cited barrier real and executing |
| `npm test` | **290/290** |

## Sentry

Queue read live (org `ezhalah`, project `react-native`): **1 unresolved issue**, `REACT-NATIVE-7`
("Error: pa", culprit `_.ok(gsi/client)`) — Google Identity Services third-party script noise, which
`SENTRY_ROUTING.md` §2.1 places on the unownable/ignore list owned by routine #7 (and which PR #1505
has just built the ignore list for). Zero issues whose top frame is in any of this routine's files.
Not claimed, not resolved.

`ops_record_sentry_heartbeat('af-trending', …)` called (id 16) — this routine's own P1
`routine_sentry_silent` alert (1257, open since 09-01 17:29) was the heartbeat never being recorded,
not a Sentry check never being run. It clears on the next detector sweep.

## Routed, not fixed — alert 1274 `af_new_listing_capture_regression` (gathern · bathrooms)

**Owner: routine #1 (⚡ junior scraping).** Reproduction and root-cause analysis, so the next run
does not start from zero:

- gathern non-studio rows, bathroom coverage by sweep: **08-26 78–92% → 08-29 41% (Riyadh) → 09-01
  27–29%**. Studios have always sat at 0–22% and are not the cause — the non-studio segment is what
  collapsed.
- **Not a code regression.** `scrapers/gathern/run.py::_bathrooms` has no change; it entered git on
  08-31 only as a mirror of an untracked file. A code break would be a cliff; this is a gradual
  decline across three sweeps.
- **The item payload is still arriving.** The sibling `features`-derived amenity path populates
  normally on the same rows (161/192 carry `additional_info.amenities`; elevator 131). Only the
  `amenities[]` `bathtub-01.png` icon path lost values.
- **Why I did not adjudicate it:** `source_capture` stores a summary and `raw_html_key` is NULL, so
  the raw amenities array is not recoverable from our own data, and AGENTS.md permanent rule #2
  forbids calling this source silence without a live probe. The gathern hosts are egress-blocked from
  this container — §G.2(f), and the scraper is #1's surface, §G.2(d).
- **Advanced Filter is not lying in the meantime.** The served cohort (شقة/إيجار/شهري) is
  16,922 of 28,425 known with **11,503 reported as unknown** — never folded into a rung, exactly what
  R2.5.1/R2.5.2 require. This is a leading indicator of certification rot, not a present-tense
  searchability defect.

Filed in `ops_qa_coverage_ledger` under `af_data_integrity / gathern.bathrooms.capture_regression`.

## Ratings

```
AF SYSTEM RATING:              9.5/10  (judgement: the product AS SPECIFIED is close to §0's philosophy)
ENGINEER PERFORMANCE RATING:   9.0/10  (judgement: a real P→L gap closed and mutation-proven; one
                                        adjudication routed rather than resolved)

ADVANCED FILTER HEALTH:        8.9/10 (89%) → 9.0/10 (90%)
TRENDING CITIES HEALTH:        9.6/10 (96%) → 9.6/10 (96%)
TRENDING DISTRICTS HEALTH:     9.6/10 (96%) → 9.6/10 (96%)
AF DATA INTEGRITY:             9.4/10 (94%) → 9.4/10 (94%)
OVERALL AF + TRENDING HEALTH:  9.0/10 (90%) → 9.1/10 (91%)

NEW PRODUCT CONTRACT USED FOR RATING: YES
RULES LIVE-TESTED THIS RUN:      62/135   (grade L, was 58)
RULES BARRIER-PROTECTED:         56/135   (grade B, was 59)
RULES WITH INSUFFICIENT COVERAGE: 17/135  (grades P+N, was 18 — P 17 · N 0)
```

Derived by `scripts/verify-af-contract-coverage-map.ts`, not asserted. R9.2.4 is deliberately left at
P: it is a pure cross-reference, not an independently testable claim, and moving it would be editing
the ruler.

## Still open at end of run (unchanged owners)

- `migration_drift` (P1, alert 1229) — an unmerged-PR backlog, not unmirrored SQL. Policy keeps
  those PRs open for human review; clearing the barrier is an owner merge decision.
- P1 gathern studio labelling (9,076 «استديو» rows served as شقة) — routine #3, source adjudication.
- P2 alert 781 `af_field_stuck_no_variance` — needs the source pages; hosts egress-blocked.
- P2 alert 1232 `age_resolver_platform_gap` — 2 `eastabha_residential_listings` rows undecided;
  same egress blocker, and the fix is an `age_source_registry` adjudication, not an engineering one.

## Harness notes for the next run

- `npm test` is green on `main` (290/290) but needs three Python packages this image does not ship:
  `curl_cffi`, `python-dotenv`, `supabase` (install the last with `--ignore-installed PyJWT`).
  Without them `verify-abeea-identity-supersession`, `verify-cleanup-anomaly-gate` and
  `verify-scrape-run-finalized-on-kill` fail closed — correctly, since they cannot prove what they
  exist to prove — and read exactly like three product defects. They are not.
- `walkOneRound` returning false must never be treated as a crash: a missing offer button is R11.2
  and R4.4.1 behaving correctly. One round already leaves four pills on the Riyadh/Apartment cohort,
  so a second round is usually unnecessary.
```
ALL GOOD: YES
```
