# AF post-deploy certification — 2026-08-22/23

Post-deploy certification of #908 (MIN_USEFUL_QUESTIONS_TO_SHOW=2 gate) and #914
(narrowing-gate eligibility fix), per owner brief. Verification only — one real gap
found and closed (barrier #11), no product-behavior change.

## Production state verified

- Repo: `6ttvrw4fmf-ctrl/ezhalah`. #908 merge `1d72151`, #914 merge `6227193` — both
  confirmed ancestors of `origin/main` and of the live Vercel deployment.
- Live deployment (Vercel API, `get_deployment` on `ezhalah-app.vercel.app`):
  `dpl_8Jj9amqYC39KpJp7bqbDNeC9gwL3`, state READY, commit `e2e992d` (#921), which is a
  descendant of #908/#914/#917/#918/#919/#920. Bundle
  `entry-0f6919e20baae29ea3a7648c339d30b3.js`, last-modified 2026-08-22T23:59:51Z —
  matches the deployment's `ready` timestamp. NOTE: production moved through at least
  3 legitimate redeploys while this cert was running (bundle hash changed twice);
  each redeploy re-checked against origin/main and against Vercel's own deployment
  record, not assumed stable.
- Local working tree at `/Users/yusufalnashwan/Downloads/design_handoff_ezhalah/ezhalah-app`
  (branch `main`, HEAD `f741c3b`) is STALE — does NOT contain #908/#914 as ancestors
  and has unrelated uncommitted changes from other work. Not used for verification;
  all source inspection and script runs were done against a throwaway `git worktree`
  checked out at `origin/main` instead (left untouched otherwise).

## Barrier scripts re-run against live production (anon REST + live source)

All run from a clean worktree at the true `origin/main` HEAD:

- `scripts/verify-af-min-useful-questions-gate.ts` — 12/12 PASS.
- `scripts/verify-af-narrowing-gate.ts` — 8/8 PASS.
- `scripts/verify-af-independent-oracle.ts` — PASS across 9 cohort/predicate cases,
  live against production DB via anon key.

## Gap found and closed: requirement #11 (diversification vs AF-narrowed eligibility)

`scripts/verify-platform-diversity-live.ts` already proved diversity purity for BASE
search (deal-filter only). No existing case layered a real AF predicate on top of the
diversity round-robin, so an AF+diversity interaction defect could pass green CI.

Added two AF-narrowed live cases (Villa/Buy bathrooms>=3, Apartment/Rent-Annual
furnished — same predicates `verify-af-independent-oracle.ts` already proved correct
in isolation) plus a generic `afRest` eligibility check reusing the existing
`countIdsMatching` oracle. Ran live: PASS, matched=150/150 both cases. Mutation-proved
by weakening `bathrooms>=3` to `bathrooms>=4` live against production → check
correctly FAILED (matched=140/150) → restored → re-ran green.

Shipped as PR #922 (`fix/af-diversity-narrowed-eligibility-barrier`), squash-merged
`6bb42cd`, all 3 required CI checks passed before merge. Test-file only, no product
code touched, not wired into `npm test` (matches the file's existing convention —
runs from the scheduled workflow + daily audit).

## Live browser journeys (real clicks against ezhalah-app.vercel.app)

### 1. Villa · Buy · Riyadh — large cohort, ANSWER-ALL

Filter tab → Riyadh → Buy → Residential → Villa → Search.

| Step | Question | Answer | Live count after |
|---|---|---|---|
| start | — | — | 11,413 |
| Q1 | street width | 15m+ (single-select) | 10,639 |
| Q2 | property age | new (single-select) | 7,712 |
| Q3 | direction | east (multi-select, 1 chip) | 2,472 |
| Q4 | bathrooms | 4+ (single-select) | 235 |
| Q5 | amenities | AC only (multi-select, lopsided: 19/235 = 8%) | 19 |

Interview stopped after Q5 (19 < stop threshold). Final message: "لقينا 19 إعلان...
بناءً على: ١٥ م فأكثر · جديد · شرق · +٤ · تكييف" — chips match all 5 answers exactly,
no extra/missing predicate. The lopsided Q5 option (8% selectivity) was offered and
used without being dropped — direct live proof of requirement #4.

### 2. Apartment · Rent-or-Buy (combined) · Jeddah — large cohort, SKIP-ALL

Filter tab → Jeddah → Rent → Residential → Apartment → Search → combined Buy+Rent
scope (25,017), exercising the buy/rent-combined AF gating path.

- Start: 25,017.
- Q1 (bathrooms) → Skip → count still 25,017, advanced to Q2.
- Q2 (amenities) → Skip → count still 25,017, interview correctly ended (no further
  eligible question for this cohort; no results message posted, unrestricted set
  unchanged).
- Skip changed count: 0, across both questions.

First attempt at this journey used eyeballed screen coordinates for "تخطي" and
mis-clicked (closed the modal instead of skipping) — caught immediately by checking
that the reopened flow started over at Q1 rather than continuing, and corrected by
locating the exact DOM node and dispatching the click via JS (matches the standing
"Browser pane click artifact" rule to click by text+cursor:pointer, not eyeballed
coordinates). Documenting the miss for the record rather than silently discarding it.

### 3. Same cohort — MIXED answer + skip

Reopened AF on the same 25,017 Jeddah/Apartment cohort:
- Q1 (bathrooms) → answered "2+" → count 6,709.
- Q2 (amenities) → skipped.
- Final: "لقينا 6,709 إعلان ... بناءً على: +٢" — chip list contains ONLY the answered
  bathrooms predicate; the skipped amenities question does not appear. Final count
  (6,709) exactly matches the live count shown at the moment of answering Q1.

### 4. Villa · Buy · Riyadh · حي النرجس (single district) — thin cohort, AF shown

670 listings. AF opened correctly (>=2 useful questions available) and its FIRST
question was amenities (not street-width, which led the citywide Villa run) — direct
live evidence that question ranking/eligibility is recomputed per cohort, not cached
from a prior search.

### AF hidden (0 or 1 question) — NOT independently reproduced live this session

Two attempts at a maximally narrow natural-language query (chalet in a single Riyadh
district; then apartment in a single Riyadh district via the AI Agent path) hit an
unrelated "يجري تحميل الإعلانات — حاول مرة ثانية" retry loop in the AI Agent's own
district-disambiguation flow — not an AF code path, out of this task's scope
(AI Agent work is explicitly untouched per the standing rules), not chased further.
Coverage for the 0/1-hide gate itself rests on `verify-af-min-useful-questions-gate.ts`
(12/12 PASS, mutation-proved against 4 independent breaks per #908, independently
re-run above against the live source) rather than a live click-through of that exact
edge — noted honestly rather than claimed as browser-verified.

## Deploy lock

Checked twice, both times via direct `select * from ops_deploy_lock` (privileged
Supabase SQL — appropriate here since this is an internal ops table, not user-facing
search truth):

- First check: table EMPTY. Nothing to release (the holder the orchestrating session
  observed earlier had already self-expired or been released by the time this session
  looked).
- Second check (after merging #922 and observing two unrelated deploy-workflow
  "failures"): table shows lock HELD by `safe-deploy:runner@runnervm76f27-2494`,
  acquired 2026-08-22T23:58:07Z, expires 2026-08-23T00:28:07Z, server_now
  00:16:25Z — genuinely active, ~12 minutes of TTL remaining, different holder id
  than the one the orchestrating session flagged earlier tonight. Confirmed via the
  Vercel API that this holder corresponds to a REAL, currently-READY production
  deployment (commit e2e992d, #921) — not a stuck/orphaned process. The two
  GH-Actions-driven deploy runs that failed in between (#921's own CI-triggered
  attempt, and #915's) failed with "REFUSING TO DEPLOY: lock 'production' is held by
  another session right now" — i.e. the lock's own safety guard working exactly as
  designed, not a defect. NOT released: it does not belong to this session, and it is
  not stale. Left for its own TTL/holder to clear.

## Requirement -> barrier mapping (11 total)

1. 0-question cohort must hide AF — `scripts/verify-af-min-useful-questions-gate.ts` (existing, re-verified PASS).
2. 1-question cohort must hide AF — same file, same PASS (asserts `< MIN_USEFUL_QUESTIONS_TO_SHOW`, i.e. 0 or 1).
3. 2+ useful questions must allow AF — same file, PASS; also live-verified 3x (journeys 1, 2, 4 above).
4. Useful question must not be dropped for being lopsided — `scripts/verify-af-narrowing-gate.ts` (existing, PASS); also live-verified (journey 1, Q5, 8% selectivity, not dropped).
5. True no-op question must still be rejected — same file, PASS ("every option ties at N" case).
6. Skip must serialize no predicate — live-verified directly (journey 3: skipped amenities absent from final "based on" chips).
7. Skip must leave eligible count unchanged — live-verified directly (journey 2: 25,017 unchanged across 2 skips).
8. AF must not stop while valid useful questions remain — live-verified (journey 1: kept asking 5 questions while count stayed >> stop threshold, `presentGuided`'s own re-rank loop, distinct code path from the opening gate).
9. Unsupported/source-unsafe questions must never be exposed — `scripts/verify-af-independent-oracle.ts` (existing, PASS: RPC total == independent PostgREST count, unknown never passes, for 9 real predicate cases).
10. Final result set must satisfy every answered AF predicate — live-verified (journeys 1 and 3: final chip list and count match answers exactly) + `verify-af-independent-oracle.ts` at the RPC level.
11. Diversification must not introduce an ineligible listing (AF-narrowed case) — GAP FOUND, CLOSED: PR #922 adds 2 AF-narrowed live cases to `scripts/verify-platform-diversity-live.ts`, mutation-proved, merged `6bb42cd`. (Base-search-only diversity purity was already covered by the same file pre-existing.)

10/11 already covered by existing, still-passing barriers; 1/11 (#11, AF-narrowed
diversification specifically) was a genuine gap, now closed and mutation-proven.
