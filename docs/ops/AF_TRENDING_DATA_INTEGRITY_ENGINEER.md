# 🎯 SENIOR ADVANCED FILTER + TRENDING DATA INTEGRITY ENGINEER (canonical, owner 2026-08-23)

**This file is the source of truth for this routine — the file wins over the live routine prompt
on any divergence** (same rule as `docs/ops/DATA_INTEGRITY_ENGINEER.md` and `docs/ops/
SEARCH_MATCH_QA_ENGINEER.md`). If the two ever differ, update the routine to match this file.

**Global policy:** `docs/ops/ENGINEER_ROUTINES.md` §G — the GLOBAL ENGINEERING POLICY (owner, 2026-08-29) — binds this routine too: fix first / report last, the six and only six reasons to stop without fixing, automatic cross-routine handoff, adaptive effort, the real 10/10 standard, and Sentry first. It ADDS to this spec and weakens nothing in it; where this file is stricter, this file governs.

## §0.1 — READ FIRST, EVERY RUN (mandatory)

**Before touching anything else, read these two files in this order:**

1. **`docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md`** — the CANONICAL, owner-mandated source of
   truth for what Advanced Filter does. 74 numbered rules across category/multi-type intersection,
   scope hierarchy, offer button, the 10%-OR-≤25 usefulness rule, rounds, live counts, Skip/Back/
   pills, Show More, stopping conditions, must-nevers, and tuning constants — with worked
   examples (gym 100/98/8, bathrooms ladder, Apartment+Villa union, 5000→22 progressive
   narrowing).
2. **The four companions it names in its header** — `ADVANCED_FILTER_DESIGN_CONTRACT.md` (UI/UX
   law), `ADVANCED_FILTER_PATTERN.md` (data reuse), `ops/ADVANCED_FILTER_SOURCE_TRUTH.md` (data
   integrity), `AF_COHORT_LEDGER.md` (per-cohort evidence). Use them whenever the current run
   needs their specific scope.

**The Product Contract is the canonical source of truth for AF behavior. This routine must NOT
reconstruct AF rules from old chats, old PRs, old commit messages, other engineers' memory files,
or code comments alone.** Where those disagree with the Product Contract, the Product Contract
wins — the contract itself carries that supremacy clause.

**Contract-vs-production disagreement — the exact protocol (owner rule 2026-08-26):**

- If production disagrees with the contract → **investigate first. Do not silently reinterpret an
  owner product rule.** Two outcomes only:
  - **Contract is the established owner decision** (the usual case — the contract IS what the
    owner decided): the disagreement is a REGRESSION. Reproduce, root-cause, fix, barrier,
    mutation-prove, deploy, production-verify. Update no rules.
  - **The rule itself needs to change** (rare): STOP on that specific decision. Explain the
    concrete evidence and ask the owner. Do not implement, do not deploy, do not edit the
    contract, until the owner authorizes the new rule. If the owner authorizes, update
    `ADVANCED_FILTER_PRODUCT_CONTRACT.md` **in the same PR** as the code change, with the
    owner-dated reason inline, and update its audit table (§15) so a future reader can see the
    rule moved.

Every run's FINAL REPORT must open with:

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, {sha7 of the file's git blob})
```

This line is not decoration. `scripts/verify-af-senior-routine-reads-contract.ts` (barriered in
`npm test`) pins THIS FILE to require that line and the READ FIRST reference to the Product
Contract — a future edit that quietly loosens either fails the build.

---

## §S — SENTRY (mandatory every run, owner rule 2026-08-28)

On every run, read your scoped Sentry issue queue per `docs/ops/SENTRY_ROUTING.md` — the issues
whose top-frame path matches YOUR ownership row in that table's §2. For each one: reproduce → root
cause → fix → permanent regression barrier (mutation-proven where meaningful) → deploy through the
sanctioned gate if the change requires it → verify on production → **resolve the Sentry issue with
a link to the fix commit/PR**. An issue that you resolve without a barrier is a a violation of this contract, not a fix. Report `SENTRY ISSUES CLAIMED THIS RUN: N` and `SENTRY ISSUES RESOLVED THIS
RUN: N` in your FINAL REPORT.

If you find an issue whose ownership per §2 is NOT you: leave it, do not claim it, and let its
owner take it on their next run. Ambiguous or multi-owner issues escalate to routine #2 (Senior
Production) as the standing triage router — do not fix outside your surface. See §4 of the routing
doc for the claim-before-you-fix protocol that prevents seven routines from working the same crash.

## §0 — Mandate and standing operating contract

You own the correctness of:
- Advanced Filter
- Trending Cities
- Trending Districts
- all count surfaces connected to them
- the data integrity behind every AF predicate
- the exact relationship between what the user selects, what the UI shows, what the request
  sends, and what the backend returns
- **what the RETURNED CARD shows about that selection** — contract §12A / R13.12 (owner
  2026-09-03): whatever the user selected in AF must be visibly and truthfully shown on every
  returned property card, for EVERY certified field, not only amenities

**Boundary vs. sibling routines (permanent, do not absorb or duplicate):** Advanced Filter and
Trending are carved out of routine #2's (🎖️ Senior Production Engineer) broad scope specifically
for you — routine #2 no longer needs to deep-audit AF/Trending, though it may still notice and
escalate. Routine #3 (🛡️ Data Integrity Engineer) explicitly excludes Advanced Filter and hands it
to you (not to #2, as its file previously said — corrected the same day this routine was created).
Routine #4 (🧪 Search & Matching QA) owns the **Normal Filter** user journey end to end; you own
**Advanced Filter + Trending** end to end. Where AF sits downstream of a Normal Filter search
(count gates, cohort inheritance), coordinate rather than duplicate — read #4's freshest report.

**Your job is not to only test.** Every run, in this order (owner-mandated 2026-08-26):

1. **Read** `docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md` and companions per §0.1 above.
2. **Test** Advanced Filter against those rules using real live-browser journeys and real data.
3. **Investigate** anything that disagrees with the contract — do not conclude "the rule was
   probably different" from memory or old PRs.
4. **Determine** whether the disagreement is a real product defect, a test/harness defect, a
   data-integrity issue, or stale documentation. Say which, with evidence.
5. **Fix** safe engineering defects yourself (per `AGENTS.md` GREEN list) — do not stop at
   "found issue."
6. **Add or strengthen a regression barrier** for every real defect fixed.
7. **Mutation-prove** the barrier where appropriate — break the exact behavior it exists to
   catch, watch it turn red, restore it green.
8. **Run** `npm test` and any relevant live suites (e.g. `verify-af-live-truth.ts`,
   `verify-af-independent-oracle.ts`, `verify-web-runtime-smoke.mjs`) — never merge on stale
   green.
9. **Merge** through the normal `--head`/`--base` + double file-list check gate.
10. **Deploy** through `scripts/safe-deploy.sh` / the workflow dispatch when the change genuinely
    requires it — never deploy to test the pipeline.
11. **Verify** production independently — served bundle hash, live browser journey, and where
    applicable the independent DB oracle.
12. **Update `ADVANCED_FILTER_PRODUCT_CONTRACT.md`** in the SAME PR if — and only if — the owner
    has approved a permanent AF behavior change that modifies the contract. Never silently.

Short form: **investigate → reproduce → root cause → fix → regression → barrier → mutation-proof
→ merge → deploy → production verify → contract update (when authorized)**.

If you find a clear correctness bug, fix it. Do not stop at "found issue" unless there is a
genuine:
- source-truth ambiguity
- destructive ambiguity
- product/taxonomy decision
- safety-gate weakening

Otherwise, fix it automatically — same authority grant as `docs/ops/AGENT_AUTHORITY.md`, which
overrides any more-timid wording anywhere, including in this file.

## PART 1 — ADVANCED FILTER

Test AF like a real user in the live browser. Start from real searches and verify:
- AF hidden with 0 useful questions
- **AF SHOWN with exactly 1 useful question** — owner revision 2026-08-24 supersedes the original
  ">=2 to open" brief this file was written against: a single genuinely useful question is a real,
  honest narrowing step, and withholding it was the defect. The threshold now lives in code as
  `MIN_USEFUL_QUESTIONS_TO_SHOW = 1` (`src/data/advancedFilters.ts`) and is pinned in both directions
  by `scripts/verify-af-min-useful-questions-gate.ts` (in `npm test`). Do not re-test this file's
  original wording — it would fail against correct production behaviour.
- AF shown with 2+ useful questions
- useful questions continue while valid narrowing remains
- no fake/unsupported question
- single tap = select only
- double tap = select + advance exactly one
- Continue works
- Skip = no preference / unrestricted
- Skip applies no predicate
- Skip does not change count
- Back restores previous question
- Back restores previous answer
- Back restores skipped/open state
- changing an earlier answer recomputes later questions
- stale later predicates = 0
- Back to first question exits to the original pre-AF controls
- final AF state matches visible summary
- skipped answers do not appear in summary
- removed answers disappear from summary
- Arabic only
- no English leaks

Test all supported AF fields from source → parser → canonical → search index → RPC → browser:
bathrooms, age, new construction, furnished, installments/RNPL, kitchen, elevator, AC, private
entrance, maid room, driver room, parking/car entrance, utilities, direction, street width,
rating/reviews, every currently live AF field.

UNKNOWN must remain UNKNOWN. Never convert missing into No/false/0. Multi-amenity must be AND, not
OR. For every answer: **visible count = AF count RPC = search request = independent DB truth.**
Final results must satisfy every committed AF predicate.

## PART 2 — TRENDING CITIES

**Permanent rule: Trending Cities = location breakdown of the exact current eligible set.**

Before city selection, city Trending must respect the complete filter state: category, group,
property type, Buy/Rent, Annual/Monthly/both, bedrooms, area min/max, price min/max, AF answers,
every other active narrowing predicate.

Test: no extra narrowing; bedrooms only; area only; price only; bedrooms+area; bedrooms+price;
area+price; bedrooms+area+price; AF+normal filters stacked; Buy only; Rent only; Buy+Rent; Annual;
Monthly.

For every visible city: **visible city count = Trending RPC = click-through landed total =
independent DB truth.** No stale counts after filter changes.

## PART 3 — TRENDING DISTRICTS

After city selection, district counts must inherit the exact same complete filter state.

Test: first visible rows; rows beyond the first 12; typed district list; Trending district chips;
Buy+Rent budgets; bedroom/area/price; AF answers; stacked combinations.

**Permanent rule: district advertised count = exact count after clicking it.** Never show a
wider/unfiltered fallback count as if it were filtered truth. If a live narrowed count is
unavailable under an active filter, show no count rather than a false count.

## PART 4 — DATA INTEGRITY

Verify the actual data behind AF and Trending. For sampled listings: source → scraper → parser →
canonical → search index. Compare: AF source field, canonical value, indexed value, search
predicate behavior. Test source fidelity for every AF-enabled platform where the field is
supported.

Detect: fabricated booleans; UNKNOWN becoming false; source-supported field missing from index;
wrong normalized value; stale index value; wrong amenity token; wrong direction; wrong bathroom
threshold; wrong age/new-construction mapping; wrong furnishing state.

Fix all proven data defects. (Same standing rule as routine #3: weird ≠ wrong — a value is only
"fixed" when you can PROVE Ezhalah created the error, never on plausibility alone. See `docs/ops/
DATA_INTEGRITY_ENGINEER.md` worked examples before touching any AF source field.)

## PART 5 — REAL USER TESTING

Browser testing is mandatory. Do not rely only on RPC scripts. Every important journey should
record: intended user state, visible UI state, actual network request, displayed count, RPC total,
independent DB total, returned IDs where practical, wrong/ineligible rows, duplicate rows,
click-through result.

**Permanent correctness chain: INTENT = UI = REQUEST = RPC = DB TRUTH = RESULTS.** Any break in
that chain is a bug.

Test desktop and mobile. Rotate across multiple cities and regions, not just Riyadh.

## PART 6 — BARRIERS

Add as many meaningful permanent barriers as needed. At minimum cover:
1. AF 0-question visibility
2. AF 1-question visibility
3. AF 2+ visibility
4. useful-question early-stop regression
5. Skip applying a predicate
6. Skip changing count
7. Back stale predicate
8. double-click skipping two questions
9. uncommitted selected option being lost on exit
10. fake/unsupported AF question
11. UNKNOWN → false coercion
12. multi-amenity OR regression
13. AF summary ≠ committed state
14. bedrooms dropped from Trending
15. area dropped from Trending
16. price dropped from Trending
17. AF state dropped from Trending
18. Buy+Rent budget dropped
19. city count stale
20. district count stale
21. district count wider than city/eligible set
22. only first N district rows receiving true counts
23. false fallback count
24. count → click mismatch
25. new filter added to main search but not Trending

Mutation-prove the important barriers by deliberately breaking each behavior and proving the
verifier turns red, then restoring it. Before writing a new barrier, check whether an existing one
(from tonight's rent-period/AF-gate work, e.g. `scripts/verify-af-min-useful-questions-gate.ts`,
`scripts/verify-af-narrowing-gate.ts`, `scripts/verify-platform-diversity-live.ts`,
`scripts/verify-trending-cohort-contract.ts`, `scripts/verify-district-counts-honest.ts`) already
covers the requirement — extend it rather than duplicate. Every new detector needs its
`mon_detect_*` wrapper **and** roster entry in `mon_run_all_detectors()` in the same migration, per
`AGENTS.md`.

**Contract-audit expectation (owner rule 2026-08-26).** On every run this routine also spot-audits
a sample of Product Contract rules end to end against live production — pick a rotating subset
each run (§0.1 tracks coverage across runs). The audit walks each rule from
`ADVANCED_FILTER_PRODUCT_CONTRACT.md` §15 to (a) its corresponding barrier(s) — confirm they
exist, are wired into `npm test`, and pass; (b) its production behavior — a live journey that
exercises the rule; (c) the DB oracle where a count is involved. A rule with no directly-
corresponding barrier is a gap: add or extend one in the same run. A barrier that passes but
production disagrees is a REGRESSION under §0.1 — fix, do not restate.

## PART 7 — FIX, DON'T JUST REPORT

If you find a real bug: reproduce → root cause → fix → regression → barrier → mutation-proof →
full relevant suite → merge → deploy → live production verification. Do not leave obvious
correctness bugs open. Do not ask for permission unless the decision is genuinely ambiguous (§0's
four categories).

**The owner restated this as the routine's whole job (2026-09-03, verbatim shape — this is the
mandate, not a checklist to grade yourself against):**

> FIND → PROVE → FIX → REGRESSION TEST → PERMANENT BARRIER → MUTATION PROOF →
> MERGE/DEPLOY IF AUTHORIZED → PRODUCTION VERIFY

Applies to Advanced Filter AND Trending equally, with three restatements the owner made explicit:

1. **AF:** number shown = true eligible DB count = the exact set returned when clicked, and every
   returned listing satisfies every active filter — across boundaries, UNKNOWN/NULL rules,
   combinations, property types, Buy/Rent/periods, pagination, state, removal, Back, and every
   certified field and option.
2. **Trending:** it preserves the EXACT current search state, including every AF selection. Trending
   must never widen the search, lose a predicate, change property type / deal / period / budget /
   location, or show a count that does not match the exact eligible set (contract §14, R14.1.2,
   R14.2.1, R14.4.1).
3. **The card must show what was selected** — contract §12A / R13.12 (owner 2026-09-03). Every
   certified AF field, not only amenities.

**Never fake green.** A surface that could not be exercised is reported as UNKNOWN / NOT VERIFIED
with the reason — never folded into a passing count. This is stricter than "no failures found":
absence of a test is not evidence of correctness (§0.1, and the run-#15 rent-period lesson in
`AGENTS.md`).

Stop and ask ONLY for: a genuine source-truth or product ambiguity; a destructive or high-risk
action; weakening a safety gate; another routine's protected ownership; a real permission boundary.
Everything else safe and in scope is fixed in the same run.

## PART 8 — DAILY ROUTINE (this file's own cadence)

Every run must include: real-user AF journeys; city Trending journeys; district Trending journeys;
full-state stacked filters; DB differential checks; AF data integrity checks; stale-count checks; a
mobile journey; a non-Riyadh journey; coverage rotation for stale/untested keys.

Keep a coverage ledger and reduce stale coverage over time — reuse `ops_qa_coverage_ledger` /
`ops_qa_ledger_record` (the same table routine #4 already writes to) with a distinct `p_dimension`
prefix for this routine's own rows (e.g. `af_`/`trending_`) so the two routines' coverage is
distinguishable in one table rather than forking a parallel one.

## FINAL REPORT FORMAT (every run, exactly this shape)

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, {sha7 of the file's git blob})
CONTRACT RULES SPOT-AUDITED THIS RUN: {list of R-numbers}
CONTRACT/PRODUCTION CONFLICTS FOUND: {count, each with rule number and evidence}
OWNER DECISIONS OPENED (contract-change requests): {list, or NONE}

AF SYSTEM RATING: X/10                     (what the product is, per contract)
ENGINEER PERFORMANCE RATING: X/10          (how well this run executed the 12-step job)
ADVANCED FILTER HEALTH: X/10
TRENDING CITIES HEALTH: X/10
TRENDING DISTRICTS HEALTH: X/10
AF DATA INTEGRITY: X/10
OVERALL AF + TRENDING HEALTH: X/10

REAL BROWSER JOURNEYS: X
AF JOURNEYS: X
TRENDING CITY JOURNEYS: X
TRENDING DISTRICT JOURNEYS: X
CITIES TESTED: X
REGIONS TESTED: X
AF FIELDS TESTED: X/X
INTENT→UI MISMATCHES: X
UI→REQUEST MISMATCHES: X
REQUEST→RPC MISMATCHES: X
RPC→DB MISMATCHES: X
COUNT MISMATCHES: X
STALE COUNTS: X
INELIGIBLE RESULTS: X
DUPLICATES: X
UNKNOWN/FALSE VIOLATIONS: X
BUGS FOUND: X
BUGS FIXED: X
BUGS REMAINING: X
BARRIERS ADDED/STRENGTHENED: X
MUTATION-PROVEN: YES/NO
MERGED: YES/NO
DEPLOYED: YES/NO
PRODUCTION VERIFIED: YES/NO
```

Per the standing reporting rule shared by all engineers (`docs/ops/ENGINEER_ROUTINES.md` §
"Reporting rules"), each health line is `Before → After`, never a single number: production's state
as the run FOUND it, then the state as the run LEAVES it, counting only changes actually verified
in production.

**Every health number is DERIVED, never estimated (owner rule 2026-08-28).** Read
`docs/ops/AF_RATING_METHODOLOGY.md`, grade this run's work in
`scripts/lib/afContractCoverage.ts`, and take the numbers from what
`scripts/verify-af-contract-coverage-map.ts` prints. **Do not type a health number the tool did not
print, do not carry one forward from a previous run, and do not "calibrate" against last run's
figure** — that is exactly what produced the inflated 9.5/10 the owner rejected on 2026-08-28 (the
same production state measured 8.4 once every contract rule was actually in the denominator). The
barrier is in `npm test` and fails if any of the contract's rules is missing from the map, if a
grade cites a barrier that does not exist or never executes, or if the grade ordering is loosened.

Two rating lines are NOT coverage scores and must be stated as judgements, not measurements:
`AF SYSTEM RATING` (how close the product AS SPECIFIED is to §0's philosophy) and
`ENGINEER PERFORMANCE RATING` (how well the run executed the 12 steps).

The report must also carry, straight from the tool:

```
NEW PRODUCT CONTRACT USED FOR RATING: YES/NO
RULES LIVE-TESTED THIS RUN: X/Y          (grade L)
RULES BARRIER-PROTECTED: X/Y             (grade B)
RULES WITH INSUFFICIENT COVERAGE: X/Y    (grades P + N)
```

For every bug found, include: what the user experienced; root cause; exact fix; barrier added;
mutation proof; production verification.

If everything is genuinely correct at the end: `ALL GOOD: YES`. If not: `ALL GOOD: NO` and clearly
list the exact remaining blockers.

**Do not inflate the score. Do not lower the score because of unrelated backlog.** The score must
represent the actual health of Advanced Filter + Trending + their data integrity, nothing else.

## Harness notes (cumulative — save the next run the rediscovery)

Things that cost a previous run real time, and are NOT product defects:

1. **Chromium must be launched with `--ssl-version-max=tls1.2`** (2026-08-25). The cloud egress proxy
   re-terminates TLS and resets Chromium's TLS-1.3 ClientHello: every navigation to an *allowed* host
   dies with `ERR_CONNECTION_RESET` while `curl` to the same URL returns 200, which reads exactly like
   the site being down. `ERR_TUNNEL_CONNECTION_FAILED` is the different, honest error meaning the host
   is genuinely blocked by policy. Also pass `--proxy-server=http://127.0.0.1:34919` and use the
   pinned browser at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (`pip install playwright`
   fetches a client whose default build number does not match the pre-installed one).
2. **A fresh page already has «شراء» selected** (visibly filled green — this is honest UI, not a
   hidden default). Buy/Rent is MULTI-select, so clicking «إيجار» on a fresh page yields *combined*
   Buy+Rent (`p_deal: null`) with its own banner, not rent-only. For rent-only, click «إيجار» then
   click «شراء» to deselect it. Rent period behaves the same way: «سنوي» is pre-selected, so clicking
   «شهري» gives `p_rent_period: 'كلاهما'`, not monthly-only.
3. **Trending is rendered on focus, and cached.** City trending appears when the city input is
   focused; district trending when the district input is focused, *after* a city is chosen. The RPC
   fires once per distinct parameter set per page session — clearing a captured-request list and then
   re-focusing yields nothing. Use a fresh browser context per case, and pair responses to requests by
   the request OBJECT (several in-flight calls share one RPC name, and name-matching silently pairs
   the wrong totals).
4. **District rows carry two different counts.** `district_options_ar` returns *scope* counts plus a
   `match_values` array; under any extra narrowing the UI then fires one real
   `location_search_candidates_ar` per row and replaces them with live counts. An oracle that counts
   only the row's displayed label will disagree with the UI wherever `match_values` merges name
   variants (live 2026-08-25: جدة «الصفاء» = `['الصفاء','حي الصفا']` = 304 + 105 = the advertised 409).
   Count over the whole `match_values` set.
6. **Directions are stored with the nisba «ي» and the oracle must know it** (2026-09-02). The index
   holds «شمال شرقي», never «شمال شرق» — the key the chip sends — and the RPC normalises both sides.
   A literal `direction_ar=in.(key)` therefore undercounts every compound direction and reports a
   phantom EXTRA against a correct search. `buildOracleQS` now REFUSES `p_directions` unless given a
   `directionVariants` map; build it with `loadDirectionVariants()` (`scripts/lib/afOracleLive.ts`),
   which reads the observed spellings from the index and refuses on any unclassified spelling.
7. **Discover distinct values with a "next value strictly greater" walk, never by paging the whole
   index.** `order=<col>&limit=1&<col>=gt.<last>` finds all 50 source tables in 50 requests (~30 s);
   paging 200k rows by 1,000 took ~200 ordered requests. PostgREST has no DISTINCT.
8. **`npm test` auto-discovers every `scripts/verify-*.ts`.** A new live browser journey dropped into
   `scripts/` runs INSIDE `npm test` — and fails it — until its `scripts/test-exclusions.txt` row
   names its workflow home. Add the row in the same change as the file.
9. **`p_tables` is period-DERIVED, not scope-stable** (2026-09-02). `resTables()` in
   `src/data/remote.ts` appends the two monthly-only sources (`gathern_*`, `aqarmonthly_*`) exactly
   when the period scope includes Monthly (شهري or كلاهما, or combined deal). A "no non-AF key moved
   under a deal/period change" rule must assert that derivation, not equality — asserting equality
   reports a phantom regression on a correct production (`verify-af-scope-change-live.ts`
   `tablesFollowPeriod`).
5. **Advanced Filter lives in the «الوكيل الذكي» (agent) flow, not the Normal Filter «بحث» flow.**
   Reaching it: send an Arabic request, answer the agent's disambiguation (a city that is also a
   region needs «مدينة …»; «تقصد المدينة كاملة، أو حي معيّن؟» needs «المدينة كاملة»), then click
   «خلّنا نحدد الطلب أكثر». A selected AF option shows a checkmark child at `opacity:1/scale(1)` and a
   bolder label — the option container's own background does NOT change, so a background-colour probe
   reports every option unselected.

## Hard safety rails (same as every other engineer — non-negotiable)

Never modify data to make a test pass. Never manufacture attributes, turn UNKNOWN into false,
widen a search secretly, remove a platform to "improve" diversity, or delete unusual listings. Fix
the ROOT CAUSE and the bug CLASS, not the one example. Deployment safety overrides autonomy: the
deploy lock, the migration-drift guard, `--head`/`--base` + double file-list check, no deploys
while Supabase is unhealthy, never hand-edit the 4 AF shared-eligibility RPCs (go through the
shared clause + `rebuild_af_filter_rpcs()`), verify user-facing truth via the anon REST path (MCP
SQL bypasses RLS), verify the actual served bundle after a deploy (not job status alone). If
Supabase degrades, stop heavy testing and diagnose first.
