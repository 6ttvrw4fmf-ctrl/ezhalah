# ENGINEER ROUTINES — THE FOUR DAILY ENGINEERS (canonical, owner-locked 2026-08-11)

> Owner rule: there are **exactly FOUR separate cloud routines, all DAILY** (the fourth added by
> the owner 2026-08-11). They are never merged, renamed into each other, or scope-swapped.
> Converting one into another (which happened once on 2026-08-10 and was reverted) is a violation,
> not a refactor. If a routine's live prompt ever diverges from what this file describes, restore
> the routine to match this file.

| # | Engineer | Trigger ID | Daily time (UTC) | Model | Scope |
|---|---|---|---|---|---|
| 1 | ⚡ Daily JUNIOR SCRAPING Engineer | `trig_01NpFaJ1ALUZbZKdKpCdWF16` | 05:00 | claude-sonnet-5 | Daily scraping layer ONLY |
| 2 | 🎖️ Daily SENIOR PRODUCTION Engineer — Deep Audit | `trig_01RCVx7ie1T1i5oPC6KzZAKd` | 06:00 | claude-opus-5 | Broad production engineering, **including Advanced Filter + AI Agent** |
| 3 | 🛡️ Senior Data Integrity Engineer — Full Scraped Inventory (Normal Filter) | `trig_01Tr6Rb6XPggFXqCf3EKG62y` | 07:00 | claude-opus-5 | Full scraped inventory / Normal Filter ONLY, **Advanced Filter explicitly out of scope** |
| 4 | 🧪 مهندس اختبار البحث والتطابق اليومي — Search & Matching QA | `trig_016eagxsMuB2cCbMe9DK7JJD` | 08:00 | claude-opus-5 | Live production Normal Filter USED AS A REAL USER: matching → diversity → «عرض المزيد» → card click-through, end to end |

Schedules are deliberately **staggered one hour apart** so the heavy DB phases never launch
simultaneously (2026-08-10 outage lesson: concurrent heavy jobs + cron stampede took the DB down).
Each later engineer consumes the earlier ones' freshest reports as input. Routines are managed at
https://claude.ai/code/routines (RemoteTrigger API); they cannot be deleted via API, only disabled.

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
They meet at the Normal Filter from opposite sides; neither replaces the other.

## Boundary rules (permanent)

- Junior detects & escalates; it never deep-audits. Senior owns Advanced Filter + AI Agent + broad
  infra. Data Integrity owns Normal-Filter/full-inventory fidelity and never touches Advanced
  Filter. No routine absorbs another's responsibilities.
- All three write durable state (`docs/ops/daily-metrics.jsonl` / `ops_senior_audit_run`) and obey
  the shared gates: deploy lock, migration-commit duty, PR `--head` discipline, cron minute-slot
  discipline (see AGENTS.md).
- Changing any routine's schedule, scope, or prompt is an owner decision; record the change here in
  the same session.
