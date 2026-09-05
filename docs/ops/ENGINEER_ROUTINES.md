# ENGINEER ROUTINES — THE ELEVEN DAILY ENGINEERS (canonical, owner-locked 2026-08-11; extended 2026-08-23, 2026-08-26, and 2026-09-04)

> Owner rule: there are **exactly ELEVEN separate cloud routines, all DAILY** (the fourth added by
> the owner 2026-08-11; the fifth added 2026-08-23; the sixth and seventh added 2026-08-26, moved to
> 03:00/03:30 Arizona same-day; the eighth through eleventh added 2026-09-04). They are never merged, renamed into each other, or
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
| 8 | 🔴 Daily REGRESSION HUNTER | _owner to create_ | 07:00 | 14:00 | claude-opus-5 | **The GAPS BETWEEN owned surfaces**, and fixes that did not hold. Adversarial, cross-boundary, assumes every previous fix is incomplete |
| 9 | 🔬 Daily PRODUCTION RED TEAM | _owner to create_ | 08:00 | 15:00 | claude-opus-5 | **The AGREEMENT between layers on production**: action = request = RPC params = DB truth = displayed count = returned ids = card evidence. Distrusts every harness |
| 10 | 🧱 Daily BUG PREVENTION & BARRIER | _owner to create_ | 06:30 | 13:30 | claude-opus-5 | **The VERIFICATION APPARATUS itself**, never the product: barriers that assert the bug, checks with no mutation proof, tests that pass while production is wrong |
| 11 | ♻️ Daily LISTING LIFECYCLE | _owner to create_ | 07:30 | 14:30 | claude-opus-5 | **A listing AFTER its source confirms it is gone**: inactive → unsearchable → 30 days → deleted, and every way a dead listing can still be seen, counted or resurrected |

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

**Schedule note (2026-09-04) — the second block, 06:30–08:00 Arizona.** Routines #10 (🧱), #8 (🔴),
#11 (♻️) and #9 (🔬) run at **06:30, 07:00, 07:30 and 08:00 Arizona** (13:30–15:00 UTC), 30 minutes
apart, AFTER the whole #6→#4 block has finished. Three reasons, all checked against the live cron
topology before choosing:

1. **No contention.** The database's own heavy jobs cluster at :00–:20 of each hour and in the
   03:00–07:00 UTC pipeline window (aqar liveness 01:00, stale-listings-mark 04:00, wasalt enrich
   05:00, aqarmonthly 06:00, auto-recover-false-inactive 05:20). 13:30–15:00 UTC is clear of both
   that window and the 10:00–12:30 UTC routine block.
2. **The order is a dependency chain, not a queue.** 🧱 goes first because it repairs the
   VERIFICATION APPARATUS, and every routine after it hunts with instruments it has just checked.
   🔴 hunts next, with better instruments. ♻️ then walks the lifecycle. 🔬 runs LAST and deliberately
   distrusts everything the day produced — including the other ten routines' own green reports.
3. **They read the same day, not the previous one.** Unlike #6/#7, this block runs after #1–#5, so
   its input is today's freshest reports. That is the point: #8 and #9 exist to find what the
   surface owners just missed, which is only possible if they read what those owners just did.

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

## §S — SENTRY (mandatory every run, owner rule 2026-08-28) — applies to ALL ELEVEN routines
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

## §G — GLOBAL ENGINEERING POLICY (owner, 2026-08-29) — binds ALL ELEVEN routines

> Owner rule, 2026-08-29, extended 2026-09-04. This section binds **all eleven** routines: ⚡ Junior Scraping (#1),
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

**The queue this rule needs now exists (2026-09-04).** Until then, "file it in that routine's
queue/coverage trail" named a destination that only existed for the two cases above: a finding that
was neither a Sentry issue nor an `alert_event` kind — a journey seeing a card render wrong, a visual
regression, a dead control — had no row to create, so the honest reading of this rule was to drop it.
The rule is unchanged; its mechanism is now concrete. Route with:

```sql
select incident_open('<stable fingerprint>', '<what is wrong>', '<surface>', 'P1', 'agent',
                     '<where you saw it>',
                     '{"repro":"...","expected":"...","found":"..."}'::jsonb);
-- already own it and it turns out to be someone else's?
select incident_handoff(<id>, '<their routine slug>', '<why it is not yours>');
```

`incident_route_owner(surface)` is total, so the finding lands on a real owner without you choosing
one. `mon_detect_stalled_incident()` then makes an unworked queue loud and attributable. Full
contract: **`docs/ops/AUTONOMOUS_INCIDENT_LOOP.md`** — read it before routing anything.

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

### §G.6b — YOUR INCIDENT QUEUE IS READ AT THE START, LIKE SENTRY (2026-09-04)

Sentry is read first because an error nobody looked at is not being handled. The same is true of a
finding another routine routed to you — and unlike Sentry, that queue is never empty by accident.
Immediately after §G.6, read it:

```sql
select id, severity, title, surface, state, last_progress_at, detail
  from ops_incident
 where owner_routine = '<your routine slug>' and state not in ('resolved','wont_fix')
 order by severity, last_progress_at;
```

Every row is work, exactly as an open alert is (`AGENT_AUTHORITY.md`: *"an open alert is work, not
wallpaper… age confers no immunity"*). Drive each to a terminal state this run using §G.1's chain:

- `incident_advance(id, 'investigating'|'reproduced'|'fixed'|'verifying', root_cause, fix_pr)` as you go;
- `incident_resolve(id, 'scripts/verify-<barrier>.ts', now())` — refused without a barrier AND a
  production verification, so §G.1's "PERMANENT BARRIER" step is no longer something you can forget;
- `incident_handoff(id, '<their slug>', '<why>')` for §G.2 (d)/(e) — the ownership and permission
  boundaries §G.3 says to ROUTE;
- `incident_block(id, '<a|b|c|f>', '<what you need>')` only for a genuine owner decision;
- `incident_wont_fix(id, '<why this is not a bug>')` when it is not one.

Report `INCIDENTS WORKED / RESOLVED / HANDED OFF / BLOCKED` in your §G.8 block.
`mon_detect_stalled_incident()` raises a P1 naming any routine whose queue stops moving inside its
severity SLA (P0 4h, P1 24h, P2 72h, P3 14d), so an unworked queue is attributable rather than
anonymous. Full contract: `docs/ops/AUTONOMOUS_INCIDENT_LOOP.md`.

### §G.2b — "A HUMAN COULD APPROVE THIS" IS NOT A REASON TO ASK (owner, 2026-09-04)

The six reasons above are the whole list, and they are about the NATURE of the change, not about who
is technically entitled to authorise it. The owner's words: *"I do not want obvious safe bugs routed
back to me just because a human could technically approve them."*

So: **if a fix is safe, in-scope, reversible, and crosses none of the six, fix it.** Do not escalate
because the fix touches several files, because it is in a file you did not write, because it is
"arguably product", because you would like a second opinion, or because escalating feels safer than
deciding. §G.2(a) says *destructive or high-risk*, and a defect repair that is reversible by a normal
revert is neither, however important the surface. A run that returns a safe, provable, in-scope fix
as a question has failed §G.1, not been careful.

Reversibility is the practical test to apply, in this order:
- Can a plain `git revert` undo it, or does it also need a data or schema rollback?
- Does it change what a SUCCESSFUL path returns, or only what a FAILING one reports?
- Is anything about it irreversible for a real user (a deletion, a sent message, a charge)?
If the answers are revert-only / failing-path-only / nothing-irreversible, that is GREEN and you own it.

### §G.9 — WHAT "CLOSED" MEANS (owner, 2026-09-04)

**A bug is not closed because the symptom disappeared.** The owner's standing complaint is the loop
this rule ends: *bug found → partial fix → a related bug appears later → another routine finds it →
repeat.* That pattern is not bad luck; it is what happens when a symptom is treated as the defect.

All seven of these must be true, and the report must say so for each:

1. **Root cause fixed** — you can name the mechanism that produced the wrong behaviour, not the line
   that displayed it.
2. **Related variants checked** — the same mechanism hunted everywhere else it exists. If the diff
   key was wrong for one field, every field on that payload was checked; if one fetcher conflated
   failure with emptiness, its siblings were read.
3. **A permanent detector or barrier exists** — the class cannot return unnoticed.
4. **A mutation proves the barrier can catch recurrence** — the defect was RE-INTRODUCED and the
   barrier was watched to go red, then restored. A barrier nobody has seen fail is a comment that runs.
5. **The regression suite passes** — the full one, not the file you touched.
6. **Production behaviour is verified** — through the real path a user hits. A green unit test is not
   production, and a successful deploy is not verification.
7. **No equivalent hidden path remains** — you looked for the same shape behind a different name and
   said what you found, including "none".

If any of the seven cannot be met, the honest state is UNKNOWN with the reason — never "fixed".

### §G.10 — EVERY REPORT CARRIES BEFORE/AFTER AND ENDS WITH THE SAME BLOCK (owner, 2026-09-04)

Each report opens with what was true when you arrived and closes with what is true now.

**BEFORE:** bugs found · broken behaviours · failed checks · affected listings/users/surfaces.
**AFTER:** bugs fixed · barriers added · mutations added · tests passed · production verification ·
remaining bugs · final score.

And every report — all eleven routines, every run, clean or not — ENDS with exactly this block:

```
BUGS FOUND:
BUGS FIXED:
BUGS REMAINING:
ROOT CAUSES ELIMINATED:
BARRIERS ADDED:
MUTATIONS PASSED:
REGRESSION TESTS:
MERGED:
DEPLOYED/APPLIED:
PRODUCTION VERIFIED:
OPEN P0:
OPEN P1:
UNKNOWN/UNVERIFIED:
BEFORE SCORE:
AFTER SCORE:
DONE: YES/NO
```

`DONE: YES` requires §G.9's seven conditions on every bug the run touched. Anything unproven goes in
`UNKNOWN/UNVERIFIED` — that field existing is what makes the rest of the block trustworthy, so an
empty one on a run that hit anything ambiguous is itself the defect. **No fake 10/10, no "looks
good", no hand-waving.** A truthful 8.7 with named gaps is worth more than a 10 nobody can check.

### §G.11 — TOKENS ARE NOT THE CONSTRAINT (owner, 2026-09-04)

*"I do not care if the next runs burn a lot more tokens or take longer. I care about eliminating bugs
properly and permanently."* Optimise these runs for correctness and permanent bug reduction, not for
cost. Investigate deeply, check related surfaces, run the full suite, verify production. The token
discipline in AGENTS.md is about not dumping whole files into context to answer a question you could
grep — it was never a licence to stop early, and it does not override this.

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

## §R — WHY THERE ARE ELEVEN (reviewed 2026-09-04, owner decision the same day)

### §R.0 — What the analysis said, and what the owner decided

A 74-agent audit (`wf_01c03538-2c0`) hunted ten surfaces in parallel, confirmed 15 defects through
2-of-3 independent adversarial refutation, and put the question of adding engineers to three judges
reasoning separately from coverage, from ownership clarity, and from operational cost. **All three
recommended adding none**, on this evidence:

| Owner | Confirmed defects that run |
|---|---|
| #6 Journey & Persistence | 8 |
| #4 Search & Matching QA | 5 |
| #3 Data Integrity | 2 |
| #1, #2, #5, #7 | 0 |
| **a surface no routine owned** | **0** |

Their argument: the defects went undiscovered because nobody was LOOKING at those screens, which is
throughput, not ownership — and the marginal cost of a routine is not its run, it is its BOUNDARY.

**The owner read that and decided to add four anyway, on 2026-09-04.** That decision stands and this
section records it honestly rather than quietly deleting the analysis. His reasoning, which the
judges did not weigh: the mechanism that actually found those 15 — parallel adversarial hunting —
existed only as an ad-hoc session. Making it a ROUTINE is what makes it recur without him asking.
The judges measured whether a new owner would receive work the seven already own; he was answering a
different question, which is whether the work happens at all when nobody is watching.

The four were also chosen so they do NOT split a surface. That is the part that answers the judges'
strongest objection: **#8–#11 own a different OBJECT, not a narrower topic.** Splitting a surface
creates a boundary dispute; giving a routine a different object does not.

| # | Owns the… | So it can never collide with a surface owner because… |
|---|---|---|
| 🔴 8 | **gaps BETWEEN owned surfaces**, and fixes that did not hold | a defect living entirely inside one surface is ROUTED to that owner, never kept |
| 🔬 9 | **agreement BETWEEN layers on production** | its finding is a *disagreement*, which by definition spans layers no single owner sees end to end |
| 🧱 10 | **verification apparatus itself** | its target is a guard that cannot fail — never the product. A product bug found here is ROUTED |
| ♻️ 11 | **a listing AFTER its source says it is gone** | #1 owns whether the crawl ran, #3 owns the field truth of a LIVE listing; #11 starts where both stop |

### §R.1 — The measurement that would justify splitting #6

#6 owns nine routed surfaces and took 53% of that audit's defects. That is the one genuine capacity
argument, and it is still NOT acted on. **Trigger, to measure rather than re-argue:** if over any
14-day window #6-owned surfaces produce more than half of all confirmed defects AND fewer than a
third of those were found by #6's own runs, split it — #6a keeps auth / session / One Tap / sidebar /
chat persistence / favorites / navigation; #6b takes voice, read-aloud, share, feedback, theme, the
modals, mobile hit targets and the cross-browser matrix. Nothing moves out of #3/#4/#5/#7.

### §R.2 — Proposals still rejected, so they are not re-litigated

- **Frontend/Visual QA** — wholly inside #6's charter. The share-sheet dark-mode defect proved that
  surface is under-exercised, not unowned.
- **Mobile / RTL** — mobile is an AXIS, not a surface: a mobile AF bug would belong to #5 and to the
  mobile engineer simultaneously, on every surface. The measured gap is CONFIG (a second Playwright
  project, two unset env vars, two hardcoded viewports), not capacity.
- **A "failure-path" engineer** — the largest defect class (5 of 15) and the most tempting proposal.
  A cross-cutting CLASS is what a BARRIER is for, not an owner: ownership here is keyed on surface, so
  a class-owner would collide with every surface owner at once. Replaced by
  `scripts/verify-failure-paths-stay-covered.ts` and the AGENTS.md rule "A FAILED FETCH IS NOT AN
  EMPTY ANSWER". #10 🧱 now owns keeping that registry growing.

### §R.3 — The gap no engineer can close

**Automation cannot sign in.** Production auth is Google + Apple OAuth only (owner ruling
2026-09-01), so every synthetic journey is permanently a guest. The entire signed-in half of the
product — sidebar history lifecycle, favorites, rename, reorder, account menu, devices, deletion,
appearance/dark mode — has no live coverage and cannot get any until a non-OAuth QA session exists.
That is an owner decision (§G.2(a)/(b)): either anonymous sign-in enabled for a dedicated test
identity, or a QA account whose credentials live in GitHub Actions secrets. **Adding a routine does
not help — routines #8 through #11 are guests too.**

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
canonical matching (deal/location/type), **Main Filter parity, AI Agent consistency**, property
cards, scheduled jobs, regression protection, migration drift, deployment
(via the guarded workflow only). Authority: §23 autonomous operational fixes; §24 owner-approval
hard stops. `docs/ops/AGENT_AUTHORITY.md` overrides any more-timid wording.

> **Advanced Filter is NOT in #2's scope** (corrected 2026-09-04). It moved to routine #5 on
> 2026-08-23 — as the table above and the boundary rules below both already said — but this
> paragraph still read "Main Filter AND Advanced Filter parity", so #2 and #5 could each read
> themselves as the owner, or neither could. `agent` findings route to #2 explicitly (see
> `incident_route_owner()`); AF and the guided interview route to #5.

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
