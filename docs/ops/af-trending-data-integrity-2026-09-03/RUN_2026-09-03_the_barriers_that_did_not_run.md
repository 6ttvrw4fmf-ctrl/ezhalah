# Six live AF barriers did not run today, and the run that skipped them reported no failure

Routine #5 (🎯 Senior AF + Trending Data Integrity), 11:00 UTC run, 2026-09-03.

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, b148005)
CONTRACT RULES SPOT-AUDITED THIS RUN: R2.5.1, R4.3.1, R5.1.1, R5.3.1, R5.6.1, R5.6.2,
                                      R6.1.4, R7.1.2, R7.2.2, R8.1.2, R9.2.1-4, R11.1
CONTRACT/PRODUCTION CONFLICTS FOUND: 0
OWNER DECISIONS OPENED (contract-change requests): NONE
```

## The headline

**Production was correct on every surface this run touched. What was wrong was the machinery that
proves it.** Three separate barriers were red or dark against an app that was right, and the run
that was supposed to catch that reported nothing at all.

`.github/workflows/af-live-truth-check.yml` grew from 9 browser journeys to 20 steps inside ONE job
with `timeout-minutes: 30` that nobody re-measured. Today's scheduled run hit the cap in the middle
of step 15 and GitHub **cancelled** the job at 30:15:

| step | check | today |
|---|---|---|
| 15 | `verify-af-full-surface-differential` (region) | **cancelled mid-run**, 12m35s in |
| 16 | the same sweep, جدة city scope | skipped |
| 17 | `verify-af-option-card-truth-live` | skipped |
| 18 | `verify-af-remove-last-pill-live` | skipped |
| 19 | `verify-af-scope-change-live` | skipped |
| 20 | `verify-af-pill-removal-live` (mobile, non-Riyadh) | skipped |

Four of those were added the day before, by this routine. The same job on 2026-09-02 had 12 steps
and finished in 16m30s — the budget did not shrink, the work grew past it.

**Nothing went red.** A cancelled run is neither `success` nor `failure`. The `if: ${{ !cancelled() }}`
guard on every step is written so a *failing* step cannot hide the ones after it, and it does that
job well — but under a job-level cancellation `cancelled()` is true, so it skips exactly the steps
it exists to protect. This is the bug class `AGENTS.md` opens with: *a monitor that cannot fire
reads as clean.*

## The fix is structure, not a bigger number

A single serial chain with a shared budget always has a tail, and the tail is always the newest
work. So the chain is gone:

| job | contents | budget |
|---|---|---|
| `af-truth` | the 9 original journeys, agent CTA, trending ×2, property-type, combined budget, stale predicate, pill removal, oracle, strict-filter parity | 35 (measured 16m44s + ~1m setup) |
| `af-surface-region` | the region option sweep | 90 |
| `af-surface-city` | the جدة option sweep | 90 |
| `af-card-state` | option-card, remove-last-pill, scope-change, mobile pill removal | 45 |
| `af-matrix` | unchanged | 50 |
| `attendance` | `needs` all five, `if: always()` | 5 |

The two option sweeps got a job **each**, deliberately: chaining them behind one budget would have
made the جدة sweep the new tail. Each is an open-ended walk over the live pool — a local run of the
region sweep alone passed 897 checks with zero failures and was still going after an hour through
the cloud egress proxy. Those sizes are not knowable in advance, which is the argument for not
sharing a budget rather than for guessing a larger one.

`attendance` is what makes a cancellation loud: it fails unless every needed job concluded
`success`. It parses `toJSON(needs)` with **jq**, not grep, and refuses a zero-length needs map —
a text match that stops matching finds nothing and PASSES, which would have reproduced this exact
defect inside the thing built to catch it. Verified in all three directions.

## The barrier found two more dark barriers on its first run

`scripts/verify-live-check-workflow-attendance.ts` pins three things. The first found more than it
was written for.

`scripts/test-exclusions.txt` is `name | where it DOES run | why`, and `verify-test-registry-
complete.ts` checks that the named workflow **file exists** — not that it runs the script. Three
rows were false:

| script | row said | truth |
|---|---|---|
| `verify-strict-filter-parity-live.ts` | full-verification-ci.yml | **ran nowhere at all** |
| `verify-residential-misfile-recovery.ts` | full-verification-ci.yml | **ran nowhere at all** |
| `verify-web-runtime-smoke.mjs` | full-verification-ci.yml | runs in web-runtime-smoke.yml |

The only mention of the first two in any workflow is a comment in `full-verification-ci.yml` saying
they are *deliberately not run there*. A guard that accepts a comment as proof of execution is how
that survived.

Same loophole, second place: `verify-af-contract-coverage-map.ts` decided "no L/B grade rests on a
barrier that never executes" by substring-matching every workflow concatenated together. Checked
before tightening — **no grade was in fact resting on a comment-only barrier** — but a grade that
can be bought with prose is not a grade. `workflowInvokes()` now lives in `scripts/lib/
testRegistry.ts`, strips comments, and is the one answer to that question in the repo.

Rows corrected: strict-filter-parity → `af-live-truth-check.yml` (and wired in, REST-only, ~10s);
web-runtime-smoke → its real home; residential-misfile-recovery → `manual`, a one-off shadow proof
pinned to the 2026-07-10 expected delta. **Routed to routine #3** (🛡️ Data Integrity), whose surface
it is, to decide between a real home and retirement.

## Running the rescued check turned it red — and production was right

`verify-strict-filter-parity-live` on annual rent: **rpc 44,063 vs ground 44,062**, stable across
three reads, so not a write race.

The live annual arm is
`p_rent_period = 'سنوي' and (s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false)))`
— the owner's RNPL rule, which landed *after* the check was written. Measured:

| | rows |
|---|---|
| source-published annual | 44,062 |
| source-marked monthly + RNPL | 1 |
| **null-period rent rows** | **0** |
| RPC's answer | 44,063 ✓ |

Both disjuncts read a SOURCE-published fact, so the invariant the check exists for — no period
inferred from absence — holds exactly. **No data was touched.**

The check had also been silently **vacuous**: with zero monthly-RNPL rows the old equality held by
coincidence, and it only went red once a single such row appeared. Ground truth now states the real
meaning, and the no-inferred-period invariant is asserted separately — printed as
`SKIP … NOT EXERCISED` while the index holds no null-period rent rows, rather than passing on a case
it never tested.

## `verify-af-option-card-truth-live`: 21 failures, both halves harness

**A third private copy of the amenity vocabulary.** It hand-listed 13 tokens and never followed the
2026-08-31 rich set, so `balcony`, `laundry_room`, `optical_fibers`, `separate_electricity_meter`
and `separate_water_meter` failed as "unknown key" — correctly refusing to certify a chip it could
not express, against a production that was right. Five certified options had been unverifiable ever
since. The two *shared* maps (`afOracleFilter.AMENITY_TOKEN_COL`, `afMatrix.AMENITY_COL`) were both
current; only the private copy drifted. The token set is now **derived** from the shared map — every
certified token's column is `cnt_<token>`, verified against the live `apartment_guided_counts_ar`
for all 21 — so it is a rule, not a list. An unlabelled token is now a loud load-time failure
rather than a per-cohort surprise.

**The conjunction round assumed a question always follows an answer.** R4.3.1/R11.1 stop the
interview at ≤25. The harness picked the *narrowest* eligible option, so on جدة/فيلا it clicked
«غرفة سائق» (13), production correctly ended the interview and fired the search, and four checks
went red on contract-compliant behaviour. It now picks the narrowest option leaving **>25** when a
Q2 is required, and reports NOT EXERCISED when the cohort offers none.

**420 checks, 0 failures, 0 skips** after the fix — desktop الرياض/شقة and mobile 390×844 جدة/فيلا.

## Two contract rules that nothing tested

Both weight-2, both graded P for want of a direct test, both extended into
`verify-af-salience-orders-only.ts`, which already owns the R5.6.1 twin.

**§6 — R5.6.2, P→L.** `ASK_FIRST_TIER` is a sharper hazard than `SALIENCE`: salience multiplies
into the score so a bug still competes on score, whereas the tier is a *lexicographic* key ahead of
it. A tier that leaked one step earlier — into membership rather than order — would open every
Annual Rent interview with التقسيط regardless of whether installments narrow anything, with truthful
counts and no parity barrier noticing. The real `scoreQuestion` is executed over a 0..99 tier sweep
on every fixture (verdict and surviving options invariant); the rule's own sentence is asserted
directly (rnpl on a scope with no installment coverage is refused at every tier); §6.3 proves the
tier still bites on order, so the invariance is not passing because the tier is inert.

**§7 — R6.1.4, P→B.** Truncation and selection produce the same COUNT and differ only in WHICH
questions; take the first four in pool order and the interview still looks correct while the round's
most informative question is silently traded away. A pool enumerated **worst-first** must yield the
top-4 by (real `askTier`, score), with no outscored question dropped and no padding at 2. **B, not
L**, and the reason is stated rather than rounded up: `advancedFilters.ts` and `agent.tsx` are not
standalone-importable by a plain Node runner, so §7 executes the real `askTier` but assembles the
round itself. §7.1 pins the modelled comparator and the count-only cap to the production expressions
so the model cannot drift from what ships.

## What was already healthy

- **Trending** — CI's `verify-trending-live-four-way-truth` (Riyadh Buy/Apartment, جدة Buy/Villa with
  a 3M ceiling, Riyadh stacked price+area, **mobile 390×844 Dammam**, and an AF re-entry carrying
  `property_age`) and `verify-trending-filter-state-live` both passed today. Not re-run: they are
  green on the live bundle and each run drives paid production agent messages.
- **DB-side detectors** — all 20 AF/Trending `mon_detect_*` are reachable. Two
  (`trending_cohort_drift`, `district_resolution`) are absent from `mon_run_all_detectors` but have
  their own **active** cron jobs, both succeeded, 0 failures in 3 days. Not orphans — checked
  because this is the same bug class as the workflow finding.
- `verify-af-remove-last-pill-live` and `verify-af-scope-change-live`, the other two CI skipped
  today, re-run clean against production.

## Mutation proofs — 13/13

| mutant | result |
|---|---|
| M1-M6 (self-proofs inside the new barrier, run every time) | all RED / M6 correctly GREEN |
| M-A gate stops needing `af-card-state` (real file) | RED «does not need [af-card-state]» |
| M-B `af-surface` loses its budget (real file) | RED |
| M-C rescued row points back at a workflow that never runs it | RED «the check runs NOWHERE» |
| M-D a certified amenity token loses its label | RED, `FATAL … no EXPECTED_LABEL entry` |
| M1′ ask-tier becomes an inclusion gate in `afRanking.ts` | RED §6.1 |
| M2′ the round truncates in pool order | RED §7 |
| M3′ the production comparator loses its tier key | RED §7.1 |

Each restored green.

## Ratings (tool-derived, `verify-af-contract-coverage-map.ts`)

```
ADVANCED FILTER HEALTH:        8.6/10 → 8.6/10
TRENDING CITIES HEALTH:        9.6/10 → 9.6/10
TRENDING DISTRICTS HEALTH:     9.6/10 → 9.6/10
AF DATA INTEGRITY:             9.4/10 → 9.4/10
OVERALL AF + TRENDING HEALTH:  8.7/10 → 8.8/10

NEW PRODUCT CONTRACT USED FOR RATING: YES
RULES LIVE-TESTED THIS RUN:      70/142   (grade L, was 69)
RULES BARRIER-PROTECTED:         53/142   (grade B, was 52)
RULES WITH INSUFFICIENT COVERAGE: 19/142  (grades P+N — P 12, was 14 · N 7)
```

**On the drop from yesterday's 9.2.** Nothing regressed. The owner added §12A and R13.12 to the
contract on 2026-09-03 — seven new rules, weights 3+2+3+2+3+2+3 — and all seven are graded N because
nothing implements or tests them yet. The denominator grew; the product did not get worse. Measured
against yesterday's 135 rules the same production would still read 9.1. This is the methodology
working as intended (`AF_RATING_METHODOLOGY.md`, owner 2026-08-28: never calibrate against last
run's figure).

**§12A is the single largest open item on this surface and it is NOT mine to land unilaterally.**
PR #1526 carries a drafted implementation, explicitly marked do-not-merge, depending on
`feat/af-matrix-truth-barrier` (now on origin, no PR) and on an unapplied migration that adds
`af_canon` to the results RPC. That is a new product surface plus a schema change plus a frontend
deploy — an owner decision, not an ordinary bug fix. Left open deliberately.

## Harness notes (cumulative)

- **A cancelled GitHub job reports neither success nor failure, and `if: ${{ !cancelled() }}` skips
  every step behind it.** If a workflow's value depends on its later steps running, it needs an
  attendance job (`needs:` all, `if: always()`, fail on any non-success) — a step guard cannot
  express this.
- **`npm ci` is not enough to run `npm test` here.** Four checks shell out to Python; without
  `curl_cffi`, `python-dotenv` and `scrapers/requirements.txt` they fail in a way that reads exactly
  like four broken barriers. `pip install --ignore-installed PyJWT -r scrapers/requirements.txt`
  (the Debian-installed PyJWT has no RECORD file and blocks the upgrade).
- **A per-file private copy of a shared vocabulary is the drift this surface keeps paying for.**
  Two shared amenity maps were current and a third, inside one journey, was three months behind.
  Derive from the shared map; where a translation genuinely cannot be derived, reconcile the two at
  load time and fail loudly.
- **Pick the AF option that leaves >25 when the journey needs another question.** The narrowest
  option is the sharpest proof of the *answer*, and the surest way to end the interview (R11.1)
  before the *next* question can be tested.
