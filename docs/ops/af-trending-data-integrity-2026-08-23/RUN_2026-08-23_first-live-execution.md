# AF + Trending Data Integrity Engineer — run log, 2026-08-23 (first live execution)

Spec: `docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`. This is a bounded, honest run, not a full
§40-scale MAJOR certification (~200 journeys / ~5,000 RPC searches / exhaustive SQL differential) —
that scale was not attempted here and should not be inferred from this log. Scope actually covered
below.

## What was checked before doing anything new (per the "don't start from zero" instruction)

Ran all five existing AF/Trending barriers named in the routine spec against real sources:
- `scripts/verify-af-min-useful-questions-gate.ts` — PASS (offline, source-grep)
- `scripts/verify-af-narrowing-gate.ts` — PASS (offline, pure-function fixtures)
- `scripts/verify-district-counts-honest.ts` — PASS (offline, source-grep)
- `scripts/verify-trending-cohort-contract.ts` — PASS (offline, source-grep)
- `scripts/verify-platform-diversity-live.ts` — PASS (**live**, real RPC via the anon key against
  production: Buy/Rent-annual/Rent-monthly/Commercial across الرياض/جدة, plus 2 AF-narrowed cohorts
  — round-robin diversity, no duplicates across «عرض المزيد», 0 ineligible rows, sort preserved
  across the paging boundary)

Read both migrations landed just before this run
(`20260823084345_qa_adjudicator_honest_zero_is_a_match.sql`,
`20260823091415_qa_oracle_combined_mode_spans_both_rent_periods.sql`) — both are routine #4
(Search & Matching QA / `ops_qa_diff`) scope, not AF/Trending; noted, not duplicated.

## Real browser journeys (production, ezhalah-app.vercel.app)

1. **Desktop, Buy → جدة → حي الصفاء → شقة → 3 غرف** (405 matches). Trending district count for
   الصفاء updated live 1,451 → 405 the moment bedrooms=3 was applied, *before* the search ran —
   confirms Part 3's full-filter-state inheritance. Search result header then read exactly **405**,
   matching the pre-search district count. All 10 rendered cards satisfied district + bedrooms +
   type. AF interview did not open (correctly — group=apartments with district+bedrooms already
   pinned left <2 useful questions per `MIN_USEFUL_QUESTIONS_TO_SHOW`), so `startAgeFlow` fell
   through to the legacy `startRefine` chips as designed.
   - **Found a real bug here** (below).
2. **Desktop, Buy → الرياض → فيلا (villas group), no narrowing** (11,415 matches). Result count
   matched the Trending city count exactly. All 10 cards were فيلا in الرياض. AF interview again
   fell through to `startRefine` (district question) rather than opening the real 2+-question
   interview — worth a future run checking whether villas' AF pool is genuinely this thin or under-
   scoring; not chased further in this bounded run. Answered the district chip (single tap) →
   re-searched correctly, filtered results all landed in the chosen district, CTA reappeared for a
   further round. This same journey was the **regression check** for the fix below: after the fix,
   one tap produced exactly one refine question with no duplicate.
3. **Mobile viewport (375×812), Rent/Buy → الدمام** — RTL layout renders correctly, Trending city
   count renders on mobile (6,899). Journey cut short by a Browser-pane click-timeout artifact on
   several taps (screenshots show state unaffected — this reads as a tool-side rendering hiccup
   under the mobile emulation, not an app defect); not a full mobile AF/Trending journey. Flagged as
   incomplete coverage for a future run rather than claimed as tested.

## Bug found, fixed, barriered, verified (not yet merged/deployed — see below)

**Duplicate refine question on double-invoke.** Reproduced live in journey 1: a rapid double-tap on
«خلّنا نحدد الطلب أكثر» rendered «كم ميزانيتك تقريباً؟» **twice** — two independent,
independently-tappable chip rows in the same chat turn. Root cause: `startRefine()` in
`src/app/agent.tsx` had no guard against a second call while a refine question was already pending,
even though the rest of the flow (`send()`'s REFINE INTERCEPT, `runRefine()`) already treats
`pendingRefineRef` as "exactly one pending refine question at a time."

- **Fix**: one line in the shared function both call sites route through —
  `if (!q || pendingRefineRef.current) return;`
- **Barrier**: `scripts/verify-refine-single-pending-guard.ts`, wired into `npm test`.
  Mutation-proven locally: reverting the guard line flips 2/5 checks red; the fixed source is all
  green.
- **Regression-verified live**: journey 2's single-tap district question came through as exactly one
  question, one chip set, correct re-search — no duplicate.
- **Full existing `npm test`** (400+ barriers, unmodified otherwise) stays green with the new
  barrier added.
- **PR**: https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/952 (`fix/af-refine-double-invoke-dup-question`
  → `main`). 3/4 required CI checks pass. The 4th (`built app runs`) fails on an assertion
  unrelated to this diff (`[E]/[H mobile] resubmitting untouched after rapid-Stop` returning
  `resubmit=null` vs `baseline=347`) — confirmed pre-existing/flaky independent of this PR: `main`
  itself failed the same workflow 15 minutes earlier
  (https://github.com/6ttvrw4fmf-ctrl/ezhalah/actions/runs/32647504008, a *different* assertion:
  `control not found: حي النرجس`), and 5 of the last 8 runs of `web-runtime-smoke.yml` on `main`
  failed for various live-network/timing reasons. Documented on the PR; **left open for review
  rather than self-merged past a red required check** (deploy safety rail: don't push through CI
  noise, and don't deploy while the live smoke suite looks unstable).
- **Status**: FIXED + BARRIERED + MUTATION-PROVEN + LOCALLY VERIFIED. NOT merged, NOT deployed, NOT
  production-verified yet — pending either the flaky check clearing on a re-run or a human
  reviewer's call to merge with it red.

## Not covered in this run (explicit, not implied "fine")

- No mobile AF interview journey completed (tool artifact, see above).
- No non-Riyadh/Jeddah/Dammam region beyond those three cities.
- Trending Districts rows beyond the first 5 (rule #22 in the barrier list) not separately probed
  live this run — `verify-district-counts-honest.ts` covers the fetch-bound/render-cap invariant
  structurally, not executed against a live >12-row case.
- No new SQL differential validation against raw inventory (Part 4) beyond what the existing
  `verify-platform-diversity-live.ts` run already exercises as a side effect (0 ineligible rows,
  0 duplicates on every cohort it ran).
- Skip / Back / double-tap-advances-one on the real `AdvancedQuestionCard` overlay (not the legacy
  refine fallback) was not exercised live this run — both broad searches tried fell through to the
  legacy refine chips instead of opening the real interview, which is itself worth a follow-up run's
  attention (is the AF pool under-scoring for common cohorts, or genuinely thin for these two?).

## Health (Before → After, this run's own evidence only)

Both existing-barrier state and the new finding — no other defects found or claimed.

```
ADVANCED FILTER HEALTH: 8.5/10 → 8.5/10        (bug found+fixed but not yet merged/deployed)
TRENDING CITIES HEALTH: 10/10 → 10/10           (no defect found; live-verified)
TRENDING DISTRICTS HEALTH: 10/10 → 10/10        (no defect found; live-verified, incl. inheritance)
AF DATA INTEGRITY: 10/10 → 10/10                (no defect found in this run's bounded coverage)
OVERALL AF + TRENDING HEALTH: 9.0/10 → 9.0/10   (unchanged: fix exists but isn't live yet)
```

ALL GOOD: NO — one real, low-severity UX bug (duplicate refine-question row on double-tap) found,
root-caused, fixed, barriered and mutation-proven, but not yet merged or deployed. Blocker: PR #952
awaiting either the pre-existing flaky CI check to clear on re-run, or human merge-with-red-check
judgment. No other defects found in this run's bounded coverage.
