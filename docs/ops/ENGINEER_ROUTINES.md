# ENGINEER ROUTINES — THE FOUR DAILY ENGINEERS (canonical, owner-locked 2026-08-11)

> Owner rule: there are **exactly FOUR separate cloud routines, all DAILY** (the fourth added by
> the owner 2026-08-11). They are never merged, renamed into each other, or scope-swapped.
> Converting one into another (which happened once on 2026-08-10 and was reverted) is a violation,
> not a refactor. If a routine's live prompt ever diverges from what this file describes, restore
> the routine to match this file.

| # | Engineer | Trigger ID | Daily time (Arizona) | Daily time (UTC) | Model | Scope |
|---|---|---|---|---|---|---|
| 1 | ⚡ Daily JUNIOR SCRAPING Engineer | `trig_01NpFaJ1ALUZbZKdKpCdWF16` | 04:00 | 11:00 | claude-sonnet-5 | Daily scraping layer ONLY |
| 2 | 🎖️ Daily SENIOR PRODUCTION Engineer — Deep Audit | `trig_01RCVx7ie1T1i5oPC6KzZAKd` | 04:30 | 11:30 | claude-opus-5 | Broad production engineering, **including Advanced Filter + AI Agent** |
| 3 | 🛡️ Senior Data Integrity Engineer — Full Scraped Inventory (Normal Filter) | `trig_01Tr6Rb6XPggFXqCf3EKG62y` | 05:00 | 12:00 | claude-opus-5 | Full scraped inventory / Normal Filter ONLY, **Advanced Filter explicitly out of scope** |
| 4 | 🧪 مهندس اختبار البحث والتطابق اليومي — Search & Matching QA | `trig_016eagxsMuB2cCbMe9DK7JJD` | 05:30 | 12:30 | claude-opus-5 | Live production Normal Filter USED AS A REAL USER: matching → diversity → «عرض المزيد» → card click-through, end to end |

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
never reorder the four without also re-checking that dependency. Routines are managed at
https://claude.ai/code/routines (RemoteTrigger API); they cannot be deleted via API, only disabled,
and **no agent session can change their times** — the trigger schedule lives in that UI, so a
schedule change is always an owner action, with this file recording the intended state.

The 11:00–12:30 UTC block also sits clear of the heavy daily pipeline window (~03:00–07:00 UTC:
scrapers 04:22/04:40, aqarmonthly 06:00, `sync-rich-attrs-wasalt` 06:47, the AF barriers 06:52), so
each engineer audits settled data with that morning's detectors already run.

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
**Ignore Advanced Filter** — that belongs to the senior (routine #2).

Carries a **§0 standing operating contract** (owner, 2026-08-12): this engineer owns every safely
fixable data-integrity problem it discovers from beginning to end, does not pause for permission on
normal safely provable fixes, and does not report while safely fixable Ezhalah-side issues from the
run remain unfinished — target 10/10 with **0 known safely fixable Ezhalah-side issues remaining**,
never reached by bypassing source truth or a destructive safety gate. The owner attached this to
THIS routine deliberately: *"Do not create a different engineer or duplicate routine."* §0.1 lists
what it does not waive; §0.3 fixes the one BEFORE → AFTER report shape.

## 4. 🧪 مهندس اختبار البحث والتطابق اليومي — Search & Matching QA Engineer (new, 2026-08-11)

Canonical spec: **`docs/ops/SEARCH_MATCH_QA_ENGINEER.md`** (file wins over the live prompt on any
divergence).

> **§0 THE BROWSER-FIRST MANDATE (owner, 2026-08-23) is the headline rule of this routine.** The
> core proof is what the real user clicks and sees; direct RPC testing stays but is SUPPLEMENTAL.
> **A backend function that works is not evidence that the feature works.** Every journey runs
> browser → observe the UI → capture the actual request → compare to the RPC → compare to
> independent DB truth, and records the §0.1 evidence record. The §0.3 list — Advanced Filter,
> Trending city + district picks, full-filter Trending parity, «مسح الكل», card → Back,
> non-Riyadh coverage, mixed Buy/Rent/period, mobile journeys, browser zero-result journeys, the
> 100-card cap, saved/restored state — is MANDATORY every run and may be reported untested only
> for a named technical blocker. Report block: §28.1.

48-section owner spec: drive the LIVE production filter like a real user (Arabic
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
They meet at the Normal Filter from opposite sides; neither replaces the other.

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

- Junior detects & escalates; it never deep-audits. Senior owns Advanced Filter + AI Agent + broad
  infra. Data Integrity owns Normal-Filter/full-inventory fidelity and never touches Advanced
  Filter. No routine absorbs another's responsibilities.
- All three write durable state (`docs/ops/daily-metrics.jsonl` / `ops_senior_audit_run`) and obey
  the shared gates: deploy lock, migration-commit duty, PR `--head` discipline, cron minute-slot
  discipline (see AGENTS.md).
- Changing any routine's schedule, scope, or prompt is an owner decision; record the change here in
  the same session.
