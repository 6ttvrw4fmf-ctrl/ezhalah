# ENGINEER ROUTINES — THE SEVEN DAILY ENGINEERS (canonical, owner-locked 2026-08-11, extended 2026-08-23, extended 2026-08-26)

> Owner rule: there are **exactly SEVEN separate cloud routines, all DAILY** (the fourth added by
> the owner 2026-08-11; the fifth added 2026-08-23; the sixth and seventh added 2026-08-26, moved to
> 03:00/03:30 Arizona same-day). They are never merged, renamed into each other, or
> scope-swapped. Converting one into another (which happened once on 2026-08-10 and was reverted)
> is a violation, not a refactor. If a routine's live prompt ever diverges from what this file
> describes, restore the routine to match this file.

| # | Engineer | Trigger ID | Daily time (Arizona) | Daily time (UTC) | Model | Scope |
|---|---|---|---|---|---|---|
| 1 | ⚡ Daily JUNIOR SCRAPING Engineer | `trig_01NpFaJ1ALUZbZKdKpCdWF16` | 04:00 | 11:00 | claude-sonnet-5 | Daily scraping layer ONLY |
| 2 | 🎖️ Daily SENIOR PRODUCTION Engineer — Deep Audit | `trig_01RCVx7ie1T1i5oPC6KzZAKd` | 04:30 | 11:30 | claude-opus-5 | Broad production engineering, **including AI Agent — Advanced Filter moved to routine #5 on 2026-08-23** |
| 3 | 🛡️ Senior Data Integrity Engineer — Full Scraped Inventory (Normal Filter) | `trig_01Tr6Rb6XPggFXqCf3EKG62y` | 05:00 | 12:00 | claude-opus-5 | Full scraped inventory / Normal Filter ONLY, **Advanced Filter explicitly out of scope (belongs to routine #5)** |
| 4 | 🧪 مهندس اختبار البحث والتطابق اليومي — Search & Matching QA | `trig_016eagxsMuB2cCbMe9DK7JJD` | 05:30 | 12:30 | claude-opus-5 | Live production Normal Filter USED AS A REAL USER: matching → diversity → «عرض المزيد» → card click-through, end to end |
| 5 | 🎯 Senior Advanced Filter + Trending Data Integrity Engineer | `trig_01FmaKmMVJgT5VHFj8Mk9q13` | 04:00 | 11:00 | claude-opus-5 | Advanced Filter + Trending Cities/Districts + the data integrity behind every AF predicate, end to end |
| 6 | 👣 Daily Journey & Persistence Engineer | `trig_011mQL1FvMQiS8bwx2fp76QN` | 03:00 | 10:00 | claude-opus-5 | Real-user journeys: state, navigation, sessions, sidebar/history/Favorites, cross-browser/device — never search matching itself |
| 7 | 🧵 Daily Systems Seam Engineer | `trig_01T5yuLGCj3yDqPDsVrPjNmd` | 03:30 | 10:30 | claude-opus-5 | Cross-system integration integrity: cron→detector→alert, migration→mirror→prod, deploy-claim-vs-served-bundle, RLS, orphaned guarantees |

**Schedule note (2026-08-23):** routine #5 runs at the SAME 04:00 Arizona slot as routine #1
(owner's explicit instruction), not staggered 30 minutes like #1–#4 are from each other. It does
not share #1's heavy scraping-DB phase, so this is not expected to reproduce the 2026-08-10
stampede — but if DB saturation is ever observed at 04:00, restagger #5 to a later slot (e.g. 06:00
Arizona) rather than silently accept degraded runs.

**Schedule note (2026-08-26, revised same day — owner moved both to 3am):** routines #6 (👣) and
#7 (🧵) run at **03:00 and 03:30 Arizona**, ahead of the entire existing block, 30 minutes apart
from each other — the same stagger discipline every other pair in this file already follows, and
for the same reason: two brand-new routines with unverified concurrent-load profiles (#6 drives
real-browser journeys; #7 runs heavy SQL introspection across crons/migrations/RLS) should not be
assumed safe to run at the identical minute just because #5 was. 03:00 Arizona is 10:00 UTC —
comfortably clear of the 03:00–07:00 UTC heavy pipeline window described below.

Two consequences of moving #6/#7 ahead of #1–#5, stated plainly rather than left as stale
rationale: #6 no longer reads #4/#5's *same-day* reports on the way in (they haven't run yet) — it
reads their freshest available reports, which is the previous day's, same as #1 already does for
inputs from the day before. And #7's audit window reframes from "catch what happened during today's
business hours" to "audit the full prior 24 hours — every cron, every deploy, every migration —
before the day's other six routines start building on top of whatever they find." That is a
different question, not a worse one: #7 still gets a complete day's activity to examine, it just
examines yesterday's complete day instead of a partial today.

**Times are anchored to ARIZONA, not UTC (owner decision, 2026-08-21).** Arizona does not observe
DST, so 04:00 America/Phoenix is 11:00 UTC every day of the year — the schedule never drifts and
needs no seasonal correction. The UTC column is the value to enter if the routines UI is UTC-only;
the two columns must always stay 7 hours apart, and if they ever disagree the Arizona column wins.

Schedules are deliberately **staggered 30 minutes apart** so the heavy DB phases do not all launch
at once (2026-08-10 outage lesson: concurrent heavy jobs + cron stampede took the DB down). That
gap was one hour until 2026-08-21, when the owner moved the whole block into the early Arizona
morning and chose 30 minutes; the outage lesson is why the gap exists at all and must not be
compressed further. **The routines still overlap** — a run lasts 30–60+ minutes, so #1 is typically
still working when #2 starts. That is accepted: correctness under overlap is protected by the
production deploy lock (`acquire_deploy_lock`), which serialises anything that changes what
production serves, and the stagger only reduces how long a routine sits waiting on it. If DB
saturation is ever observed at 11:00–12:30 UTC, widen the gap back toward an hour rather than
removing the lock discipline.

Each later engineer consumes the earlier ones' freshest reports as input, so the ORDER above is
load-bearing (the senior audit reads the junior's metrics and its `[DEEP AUDIT]` escalations);
never reorder the original four without also re-checking that dependency. Routines #6 and #7 now
run BEFORE #1–#5 each day (03:00/03:30 Arizona vs. #1's 04:00), so they read the PREVIOUS day's
freshest reports from whichever of #1–#5 owns the surface they're about to touch, not that same
day's — the same relationship #1 already has with the day before it. Neither #6 nor #7 sits inside
the #1→#5 load-bearing chain, and neither routine's own output is consumed by an earlier one the
same day. Routines are managed at
https://claude.ai/code/routines (RemoteTrigger API); they cannot be deleted via API, only disabled,
and **no agent session can change their times** — the trigger schedule lives in that UI, so a
schedule change is always an owner action, with this file recording the intended state.

The 11:00–12:30 UTC block also sits clear of the heavy daily pipeline window (~03:00–07:00 UTC:
scrapers 04:22/04:40, aqarmonthly 06:00, `sync-rich-attrs-wasalt` 06:47, the AF barriers 06:52), so
each engineer audits settled data with that morning's detectors already run.

## §S — SENTRY (mandatory every run, owner rule 2026-08-28) — applies to ALL SEVEN routines
On every run, read your scoped Sentry issue queue per `docs/ops/SENTRY_ROUTING.md` — the issues
whose top-frame path matches YOUR ownership row in that table's §2. For each one: reproduce → root
cause → fix → permanent regression barrier (mutation-proven where meaningful) → deploy through the
sanctioned gate if the change requires it → verify on production → **resolve the Sentry issue with
a link to the fix commit/PR**. An issue that you resolve without a barrier is a violation of this
contract, not a fix. Report `SENTRY ISSUES CLAIMED THIS RUN: N` and `SENTRY ISSUES RESOLVED THIS
RUN: N` in your FINAL REPORT.

If you find an issue whose ownership per §2 is NOT you: leave it, do not claim it, and let its
owner take it on their next run. Ambiguous or multi-owner issues escalate to routine #2 (Senior
Production) as the standing triage router — do not fix outside your surface. See §4 of the routing
doc for the claim-before-you-fix protocol that prevents seven routines from working the same crash.

## §G — GLOBAL ENGINEERING POLICY (owner, 2026-08-29) — binds ALL SEVEN routines

> Owner rule, 2026-08-29. This section binds **all seven** routines: ⚡ Junior Scraping (#1),
> 🎖️ Senior Production (#2), 🛡️ Data Integrity (#3), 🧪 Search & Matching QA (#4), 🎯 AF + Trending
> (#5), 👣 Journey & Persistence (#6), 🧵 Systems Seam (#7). Each live routine prompt carries a
> condensed copy so a run that never opens this file still obeys — but **this file is the canonical
> home and wins on any divergence**, the same rule every per-routine spec already states. Nothing
> here replaces a routine's own spec; where a spec is stricter, the spec governs.

### §G.1 — FIX FIRST, REPORT LAST

Every routine follows one chain:

```
INVESTIGATE → REPRODUCE → ROOT CAUSE → FIX → REGRESSION → PERMANENT BARRIER → MUTATION-PROVE
  → RELEVANT/FULL TESTS → MERGE → DEPLOY/APPLY IF ROLE-AUTHORIZED → PRODUCTION VERIFY → REPORT
```

**Finding a bug is NOT completion.** A safe, obvious, in-scope defect is fixed in the SAME run —
never handed back to the owner as homework.

### §G.2 — THE ONLY LEGITIMATE REASONS TO STOP WITHOUT FIXING (exactly six)

- (a) destructive/high-risk operation requiring owner approval;
- (b) genuine product / source-truth / taxonomy ambiguity;
- (c) the fix would weaken a safety or security gate;
- (d) another routine currently owns that protected surface;
- (e) a role/permission boundary physically prevents this routine from writing or deploying;
- (f) an external dependency/source outage where no truthful fix exists.

**Nothing else qualifies.** "I ran out of time", "it seemed out of scope", "someone should look at
this" do not. Widening this list is an OWNER decision, not an edit — and it is deliberately a list
of six specific engineering judgments, never a general licence to escalate on a feeling of
uncertainty.

### §G.3 — AUTOMATIC CROSS-ROUTINE HANDOFF

If (d) or (e) applies, **ROUTE** the defect to the write-authorized owner using the existing
ownership system — file it in that routine's queue/coverage trail with reproduction and root cause,
and name the owner in your report. **Never merely state that someone should fix it.**
Senior/write-authorized routines remain responsible for what lower-permission routines cannot do.
Respect single-writer locks (`ops_deploy_lock`) and never create cross-session collisions. The
ownership tables already exist: §S and `docs/ops/SENTRY_ROUTING.md` for Sentry issues,
`docs/ops/ALERT_ROUTING.md` for `[alert]` issues, and the Boundary rules below for surfaces.

### §G.4 — ADAPTIVE EFFORT

- **Clean surface** ⇒ normal verification, **SHORT report**, invent no work.
- **Several genuine defects** ⇒ stay in the run and work through them systematically: P0/P1 and
  correctness first, fix as many safe in-scope defects as possible, **do not stop after the first
  few**.
- **A defect exposing an architectural weakness** ⇒ fix the underlying **CLASS** and barrier it, not
  just the one example.
- Re-run the affected surface after fixing: **a red test turning green is not sufficient** —
  production behavior must match wherever production verification applies.

### §G.5 — THE REAL 10/10 STANDARD

Keep fixing safe in-scope known defects until no actionable defect remains; only then report 10/10.
**NEVER manufacture a 10/10.** A report of 9.2/10 listing five defects this routine had the
permission and ability to fix is a **FAILED run**. If a true blocker remains, report
`10/10 ACHIEVED: NO` with the exact blocker and its owner, citing which of §G.2's six categories
applies.

### §G.6 — SENTRY IS MANDATORY AND FIRST

At the START of every run, read the unresolved/reopened Sentry issues in your ownership area (org
`ezhalah`, project `react-native`). This is the same duty §S already carries and does not replace
it — §S and `docs/ops/SENTRY_ROUTING.md` still govern **which** issues are yours and the
claim-before-you-fix protocol. Sentry findings enter the SAME pipeline:

```
SENTRY ISSUE → CLAIM → REPRODUCE → ROOT CAUSE → FIX → BARRIER/MUTATION → TEST → MERGE
  → DEPLOY → PRODUCTION VERIFY → RESOLVE
```

- **Do NOT resolve a Sentry issue because code merged — resolve ONLY after the production fix is
  verified.**
- A **REOPENED** issue is evidence the previous fix was incomplete: treat it as such and find what
  the earlier fix missed.
- Sentry does **NOT** replace deterministic QA — silent wrong-data, matching, AF, scraper, database,
  UX, cron, deploy and persistence defects still need their normal checks.
- **Prove the connection with a real read each run; a configured connector is not a working one.**
  If the Sentry read fails, say so plainly in the report (`SENTRY CONNECTION WORKING: NO`) rather
  than silently skipping it.

### §G.7 — NOTHING ABOVE WEAKENS ANY EXISTING GUARD

Source-truth rules, migration/deploy protections, cost protections, single-writer ownership, the
deploy lock, the production-target lock, kill caps and coverage floors all remain in full force.
**A gate that blocks you has found a real problem — never route around it to reach 10/10.**

### §G.8 — THE REPORT IS SHORT AND ENDS WITH THIS BLOCK

```
BUGS FOUND: X
BUGS FIXED: X
BUGS REMAINING: X
BARRIERS ADDED: X
MUTATIONS KILLED: X/X
TESTS: PASS/FAIL
MERGED: YES/NO
DEPLOYED/APPLIED: YES/NO/N/A
PRODUCTION VERIFIED: YES/NO/N/A
SENTRY CHECKED: YES/NO
SENTRY CONNECTION WORKING: YES/NO
OPEN P0/P1 IN SCOPE: X
TRUE SCORE: X/10
10/10 ACHIEVED: YES/NO
```

If 10/10 is NO, list ONLY genuine blockers (category + owner) — **never defects the routine chose
not to fix**.

Routines whose canonical spec already defines a richer domain report block **keep it, and append
this block at the end**. The `Rating Before → Rating After` pair required by "Reporting rules"
below is unaffected and still mandatory; `TRUE SCORE` does not replace it.

## 1. ⚡ Daily JUNIOR SCRAPING Engineer (original, unmodified)

Original owner prompt (9,971 chars), untouched since creation. Runs on branch `ops/daily-engineer`,
writes `docs/ops/daily-metrics.jsonl`, escalates via `[DEEP AUDIT]` GitHub issues.

Scope — the daily scraping layer, exactly as originally defined:
scraper execution + health for every active platform, collection results, failures, missing runs,
new-listing discovery, reachability. It does NOT do deep production audits, filter parity, or data
integrity sweeps — it detects and escalates to the senior.

## 2. 🎖️ Daily SENIOR PRODUCTION Engineer — Deep Audit (original prompt, made daily)

The owner's original 33-section Senior Production Engineer routine (restored byte-faithfully on
2026-08-10 after an incorrect conversion; the ONLY subsequent edits are the two cadence mentions
"every 2 days" → daily, per the owner's 2026-08-10 instruction to run it daily). Durable state:
`ops_senior_audit_run`.

Scope — broad production engineering: production/DB/scheduler health, scraper accuracy, freshness,
listing counts, new-listing pipeline, liveness/deletion safety, source fidelity, numeric fidelity,
canonical matching (deal/location/type), **Main Filter AND Advanced Filter parity, AI Agent
consistency**, property cards, scheduled jobs, regression protection, migration drift, deployment
(via the guarded workflow only). Authority: §23 autonomous operational fixes; §24 owner-approval
hard stops. `docs/ops/AGENT_AUTHORITY.md` overrides any more-timid wording.

## 3. 🛡️ Senior Data Integrity Engineer — Full Scraped Inventory (Normal Filter) (new, 2026-08-10)

Canonical spec: **`docs/ops/DATA_INTEGRITY_ENGINEER.md`** (file wins over the live prompt on any
divergence). 17-section owner spec: source-is-truth, everything-scraped accounted for, real-user
search proof via the production RPC, daily inactive-resurrection audit (target 0 false
inactivations), price/area barriers, one-report-only autonomous loop, the 10/10 honesty rule.
**Ignore Advanced Filter** — that belongs to routine #5 (moved from #2 on 2026-08-23).

Carries a **§0 standing operating contract** (owner, 2026-08-12): this engineer owns every safely
fixable data-integrity problem it discovers from beginning to end, does not pause for permission on
normal safely provable fixes, and does not report while safely fixable Ezhalah-side issues from the
run remain unfinished — target 10/10 with **0 known safely fixable Ezhalah-side issues remaining**,
never reached by bypassing source truth or a destructive safety gate. The owner attached this to
THIS routine deliberately: *"Do not create a different engineer or duplicate routine."* §0.1 lists
what it does not waive; §0.3 fixes the one BEFORE → AFTER report shape.

## 4. 🧪 مهندس اختبار البحث والتطابق اليومي — Search & Matching QA Engineer (new, 2026-08-11)

Canonical spec: **`docs/ops/SEARCH_MATCH_QA_ENGINEER.md`** (file wins over the live prompt on any
divergence). 39-section owner spec: drive the LIVE production filter like a real user (Arabic
controls, no stale hardcoded lists — enumerate live options each run), verify MATCHING first
(every returned card satisfies every selection against the structured backend), diversity second
(never manufactured), «عرض المزيد» batches stay correct, card click-through reaches THE SAME
listing, honest-zero vs search-bug classification against the DB, golden searches + randomized
exploration with a persistent coverage ledger (`ops_qa_coverage_ledger`), state persistence /
duplicates / boundaries / performance / mobile RTL, autonomous fix→barrier→deploy→production-retest
loop with the hard safety rails (§36 never modify data to pass a test, §37 root cause not the
example, §38 deploy safety overrides autonomy). One report at the end, 10/10 only after remediation.

Distinct from #3: the Data Integrity engineer verifies the INVENTORY (scrape → canonical → index),
this engineer verifies the USER EXPERIENCE (filter → results → cards → source click-through).
They meet at the Normal Filter from opposite sides; neither replaces the other. Distinct from #5:
this engineer owns the **Normal Filter** journey; #5 owns **Advanced Filter + Trending**.

## 5. 🎯 Senior Advanced Filter + Trending Data Integrity Engineer (new, 2026-08-23)

Canonical spec: **`docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`** (file wins over the live
prompt on any divergence). Owner spec, 8 parts: Advanced Filter correctness (0/1/2+-question
visibility, single/double-tap, Skip = unrestricted with 0 predicate and 0 count change, Back/state
restoration, every live AF field, UNKNOWN never becomes false, multi-amenity is AND not OR);
Trending Cities (full filter-state inheritance — category/group/type/deal/period/bedrooms/area/
price/AF all apply BEFORE city selection; visible count = RPC = click-through = DB truth);
Trending Districts (same inheritance after city selection, plus: never show a wider unfiltered
count as if it were filtered truth — show no count rather than a false one); the data integrity
behind every AF predicate (source → scraper → parser → canonical → index fidelity, same
source-is-truth discipline as routine #3); mandatory real browser testing (desktop + mobile,
rotated across cities/regions, the INTENT=UI=REQUEST=RPC=DB=RESULTS correctness chain); a minimum
25-item barrier list, mutation-proven; autonomous fix→barrier→deploy→production-verify authority,
same four stop-conditions as every other engineer (source-truth ambiguity, destructive ambiguity,
product/taxonomy decision, safety-gate weakening).

**Scope carved out of routine #2 and clarified against routine #3 on creation** — Advanced Filter
correctness previously sat inside #2's broad "production engineering" scope and was explicitly
excluded from #3; both references were updated the same day this routine was created so nobody
reads a stale hand-off. Trending Cities/Districts had no dedicated owner before this routine.

Boundary vs. #4: #4 owns the Normal Filter user journey; #5 owns Advanced Filter + Trending. Where
AF sits downstream of a Normal Filter search (the count gate, cohort inheritance), the two
coordinate via each other's freshest report rather than duplicate coverage.

## 6. 👣 Daily Journey & Persistence Engineer (new, 2026-08-26)

Canonical spec: **`docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md`** (file wins over the live prompt on
any divergence). Mission: be the most demanding real user Ezhalah has — attack the live site the
way an impatient real person actually uses it (switching tabs mid-search, refreshing at the worst
moment, logging out and back in, rotating their phone, mashing a button twice), and own everything
that happens *around* a search: auth/session flows and Google One Tap, the sidebar (search/rename/
delete/star/reorder), chat persistence and New Chat's blank-state guarantee, Favorites, navigation
and deep links, voice input, the read-aloud controller, loading/empty/error states, and dead
controls — across desktop, mobile, and more than one browser. Explicitly never re-tests Normal
Filter matching (#4), Advanced Filter/Trending correctness (#5), or scraped-data fidelity (#3) —
those findings get filed to the routine that owns them, never fixed in place.

Carries the same **fix, don't just report** mandate as every routine created since 2026-08-23:
investigate → reproduce → root cause → fix → regression → barrier → mutation-proof → merge →
deploy → production verify → report, stopping only for genuine product ambiguity, a change to
another routine's owned matching/data surface, a destructive/irreversible fix, or a safety gate.
Every run reserves real time for adversarial/exploratory testing — asking what assumption is
currently making a screen look healthy when it isn't — rather than only re-running a fixed
checklist; this is how New Chat's stale-state leak and the Google One Tap regression were actually
found, and neither would have been caught by a checklist alone.

Boundary vs. #7: this routine owns the user-visible *symptom* when a system boundary misbehaves;
#7 owns the *mechanism* underneath it. A journey that surfaces something that smells like a
backend/pipeline cause gets handed to #7 rather than traced further here.

## 7. 🧵 Daily Systems Seam Engineer (new, 2026-08-26)

Canonical spec: **`docs/ops/SYSTEMS_SEAM_ENGINEER.md`** (file wins over the live prompt on any
divergence). Mission: trust nothing that says "done" without checking what the next layer actually
received. Owns the **handoffs between otherwise-correct components** — the cron→detector→alert
chain, deploy-claim-vs-actual-served-bundle reconciliation, migration→mirror→production parity in
all four known directions, matview/sync ordering and cache staleness, auth-token→RLS enforcement
traced on a real request, retry/timeout/partial-failure paths, and concurrent-session collisions.
Runs a standing **orphaned-guarantee sweep** — for **every** important repair ever landed (no time
window, per the spec's PART 1 rewrite of 2026-08-28), confirms a detector still watches the
invariant it fixed and that the invariant still holds today, not just at merge time. The registry
has a durable home in `public.ops_repair_guarantee_registry`, and each run re-verifies the
**least-recently-verified** entries first, so coverage rotates across the whole history and nothing
ages out. This is the exact class of bug that let a July district-suffix repair
silently decay for a month with zero alerts, and no other routine was watching for that pattern
across the *history* of past repairs rather than the correctness of the current one.

Never owns whether the data or the matching is correct (#3/#4/#5) or the user-facing journey itself
(#6) — a seam failure that bottoms out in "the data itself is wrong" gets filed to whichever of
#3/#4/#5 owns it. Carries the same **fix, don't just report** mandate and the same mandatory
adversarial-exploration budget as #6, asking what happens if the second half of a promise never
runs (kill a retry mid-flight, expire a token mid-request, race two sessions against the same
migration). Scheduled for 03:30 Arizona, 30 minutes after #6 and ahead of the entire #1–#5 block
— see "Schedule note (2026-08-26, revised same day)" above for why, and what changes as a result.

## Reporting rules (permanent, owner-locked 2026-08-13)

**Every engineer report MUST state the rating as `Rating Before → Rating After`, never a single
overall number.** Both halves carry a `X.X/10` and a `XX%`. This is not formatting preference: a
lone "after" number cannot distinguish a run that repaired three defects from a run that found
nothing, which is precisely the comparison the owner reads the report for.

- **Rating Before** = production's state as the run FOUND it, scored on the run's own evidence
  (open alerts, defects present at entry). It is not last run's "after": conditions move between
  runs, and a defect raised overnight belongs in this run's "before".
- **Rating After** = the state as the run LEAVES it, counting only changes actually verified in
  production. A fix that is `PROPAGATION PENDING` or `AWAITING FIRST PRODUCTION EXECUTION` does not
  move the "after" number — the §28 vocabulary governs here exactly as it does elsewhere.
- If nothing changed, say so explicitly (`9.4/10 → 9.4/10`). Identical numbers are a valid, useful
  result; omitting the pair is not.
- The same pair appears in `ops_senior_audit_run` (`score_pct` holds the AFTER value; the BEFORE
  value and both breakdowns go in `checks`), so the history stays comparable run over run.

## Evidence rules for "the source doesn't publish it" (permanent, 2026-08-13)

Learned the hard way in senior run #15, in the space of a single run:

**A missing captured field is NOT evidence that the source omits it.** Absence is equally consistent
with "the source publishes nothing" and with "our fetch failed", and those two have opposite
consequences — the first is an honest NULL to be preserved, the second is an Ezhalah defect to be
repaired. Run #15 classified 13 aqaratikom rows as a source limitation on absence alone, then probed
the source and found it publishing «سنوي» on **all 13**. The benign reading was assumed, not proven,
and it would have permanently hidden a real capture failure behind a "documented limitation".

- Before calling any field a source limitation, **re-fetch the source and record the result** in
  `ops_rent_period_source_probe` (or the equivalent per-field probe table). "We checked" must be a
  queryable row, not a sentence in a migration comment.
- A waiver/registry that suppresses an alert must be **evidence-gated by foreign key** to that probe
  (`ops_rent_period_source_limited` is the reference implementation), and must have a detector that
  re-checks it (`mon_detect_source_limited_contradicted`) so a waiver cannot outlive its proof.
- Never silence a barrier to make it green. Make it distinguish cases, then prove BOTH directions —
  the real regression still fires, the proven limitation does not. Record the negative control.

## Repair ordering: raw → matview → sync → verify (permanent, 2026-08-13)

**A data repair that writes `search_listings_ar` directly is not durable and will silently revert.**
`active_listing_ids_v2` is a MATERIALIZED VIEW refreshed hourly (cron jobid 17, minute 0), and
`sync_search_listings_ar()` (jobid 28, minute 14) rebuilds the served index *through* it. A raw
repair applied between refreshes is invisible to the sync, which then writes the stale matview value
back over your index leg. Observed live in run #15: 13 rows verified at 100.0% at 11:29 were back to
69.8% at 11:34, with `last_updated` moved *backwards*.

The required order for every raw-layer repair:

```
repair the RAW row
  → REFRESH MATERIALIZED VIEW CONCURRENTLY public.active_listing_ids_v2
  → SELECT public.sync_search_listings_ar()
  → verify (and verify the matview agrees with raw, not just that the index looks right)
```

Writing the index directly is fine as a fast path so the fix is live within seconds, but it is never
the durable step, and **verifying immediately after it proves nothing** — the revert arrives on the
next sync. Repairs before this rule that appeared to hold (`20260811133417`, `20260813064209`,
`20260813064929`) survived only because a refresh happened to land after the raw write.

`mon_detect_search_index_diverges_from_sync_source` now asserts this invariant continuously: the
served index must agree with the relation the sync builds it from, so a repair that is about to
revert is reported as a revert rather than rediscovered by hand.

## Boundary rules (permanent)

- Junior detects & escalates; it never deep-audits. Senior owns AI Agent + broad infra (Advanced
  Filter moved out 2026-08-23). Data Integrity owns Normal-Filter/full-inventory fidelity and never
  touches Advanced Filter. Search & Matching QA owns the Normal Filter user journey. AF + Trending
  Data Integrity owns Advanced Filter + Trending Cities/Districts end to end. Journey & Persistence
  owns real-user state/navigation/session correctness and never re-tests matching/data. Systems
  Seam owns the handoffs BETWEEN components (cron→detector→alert, migration→mirror→prod, deploy
  claim vs. served bundle, RLS) and never the correctness inside any one of them. No routine
  absorbs another's responsibilities.
- All seven write durable state (`docs/ops/daily-metrics.jsonl` / `ops_senior_audit_run` /
  `ops_qa_coverage_ledger`, #6 and #7 under their own dimension prefixes in the same ledger table)
  and obey the shared gates: deploy lock, migration-commit duty, PR `--head` discipline, the merge
  gate's explicit-success requirement, cron minute-slot discipline (see AGENTS.md).
- Changing any routine's schedule, scope, or prompt is an owner decision; record the change here in
  the same session.
- **Your production-alert queue is addressable by label (2026-08-28).** Every open `[alert]` GitHub
  issue now carries the `routine-N-…` label of the routine that owns it, per
  `docs/ops/ALERT_ROUTING.md` — `gh issue list --label ezhalah-alert --label routine-3-data-integrity
  --state open`. Same seven owners as the Sentry table below, keyed on the alert `kind` instead of a
  stack frame, and total: an unrouted kind goes to #2 for triage, never to nobody. Before this,
  delivery worked and ownership did not — 53 open alert issues with no owner named on any of them.
  This is a pointer to your existing alert duties, **not** a new mandatory step: adding one is an
  owner decision, and is deliberately left open.
