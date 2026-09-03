# ALERT ROUTING (canonical, 2026-08-28)

**Who owns a production alert.** Sibling of `docs/ops/SENTRY_ROUTING.md`, which does the same job
for the other queue. Same two rules, deliberately: **one owner per item**, and **routine #2 is the
standing triage router** for anything ambiguous.

## §0 — Why this exists

The delivery chain was completed on 2026-08-26: `mon_run_all_detectors()` raises into
`alert_event`, `.github/workflows/alert-dispatch.yml` files ONE GitHub issue per `dedup_key`, the
issue auto-closes when the alert resolves, and an assignee on the issue writes back
`acknowledged_at`. That chain worked.

It still delivered to **nobody in particular**. Measured 2026-08-28, two days after delivery was
fixed:

| | |
|---|---|
| open `[alert]` issues | 55 |
| of those, carrying an owner | **0** |
| open P1 alerts with `acknowledged_at IS NULL` | **18** |
| oldest of them | 2026-08-11 |

An issue nobody owns is the same silence as an alert nobody receives, moved one step later in the
chain. `mon_detect_unacknowledged_p0()` already pages when a **P0** goes unacknowledged for 4h —
so the P0 case was covered — but nothing named who was supposed to answer it.

## §1 — The mapping

**`scripts/lib/alertRouting.ts` is the single source of truth, and the workflow EXECUTES it.**
It is not mirrored into bash, into SQL, or into this document. That is on purpose: the 41-day P0
blackout of 2026-07-16 → 2026-08-26 happened because the workflow restated a contract
(`severity=in.(P1,P2)`) that everything else stated differently, and nothing compared the copies.
A mapping with exactly one implementation cannot disagree with itself.

This section describes the shape; read the file for the table.

- `routineForKind(kind)` is **total** — every string returns a routine. There is no "unrouted"
  state, because an alert with no owner is exactly the hole this closes.
- Rules are **ordered, first match wins**. Order is load-bearing:
  - **#7 (seam) is evaluated first**, because seam kinds collide with the broad data patterns —
    `stale_no_remediation_path` is a seam failure that `^stale_` in #3 would otherwise swallow.
  - **#3 (data integrity) is evaluated last** before the fallback, because its patterns
    (`price`, `district`, `^stale_`, `^legacy_`) are the widest. Anything more specific must claim
    first.
- Unmatched → **routine #2 (🎖️ Senior Production)**, which holds the triage mandate. A fallback is
  a real owner, not a bin.

### Distribution over the 103 kinds present in `alert_event` on 2026-08-28

| routine | kinds | examples |
|---|---:|---|
| 1 ⚡ Junior Scraping | 19 | `silent_scraper_death`, `run_killed_by_timeout`, `proxy_contention` |
| 2 🎖️ Senior Production (**fallback**) | 1 | `duplicate_card_surface_routed` — genuinely spans two surfaces, so it triages |
| 3 🛡️ Data Integrity | 45 | `price_source_mismatch`, `rent_period_contract`, `quarantine_growth` |
| 4 🧪 Search & Matching QA | 8 | `searchability_collapse`, `card_link_identity` |
| 5 🎯 AF + Trending | 6 | `af_null_to_false_conversion`, `trending_district` |
| 6 👣 Journey & Persistence | 2 | `transcript_shrank`, `filter_state_lost_after_refresh` |
| 7 🧵 Systems Seam | 23 | `alert_delivery`, `migration_drift`, `cron_health`, `ai_cost_health` |

**One kind falling back is the healthy number, not a gap.** If that column grows, #2 is silently
inheriting everyone's backlog and the patterns need extending — that is the drift to watch for.

## §2 — How it reaches the issue

`alert-dispatch.yml` step **"Route each alert issue to its owning engineer routine"** adds a
`routine-N-…` label to every open `[alert]` issue that has none. It is a separate idempotent sweep
rather than a `--label` on the create call, which buys three things:

- it **backfilled** all 55 pre-existing issues with no migration and no hand-editing;
- it **self-heals** an issue whose label was removed, or one filed by a run that died mid-loop;
- it is **one mechanism**, so there is no create-path/backfill-path skew to keep in sync.

Issues that already carry a `routine-*` label are left alone, so **a human re-routing an issue by
hand wins** and is not fought over on the next tick.

Routing keys on the alert's **`kind`**, not its `dedup_key`: the key carries the instance
(platform, id, table), the kind names the failing surface, and ownership is a property of the
surface. If the `alert_event` row no longer exists, the issue title is used instead — worse input,
still an owner.

## §3 — What each routine does with its label

Nothing new. Each routine already has a daily mandate; this makes its queue addressable:

    gh issue list --label ezhalah-alert --label routine-3-data-integrity --state open

Same loop as Sentry (`SENTRY_ROUTING.md` §3): reproduce → root cause → fix → permanent barrier →
deploy through the sanctioned gate → verify on production. **Then assign yourself to the issue** —
that assignment is what writes `acknowledged_at` back into `alert_event` on the next dispatch tick,
and what stops `mon_detect_unacknowledged_p0()` re-paging. Resolution itself stays in the database:
closing an issue by hand does not resolve the alert, and a persisting condition re-raises.

## §4 — Adding a detector

Add its kind to `ROUTING_RULES` in the same change that adds the detector. Skipping this is not an
error — the kind lands on #2 — but it makes #2 the owner of your surface by default, which is how a
triage router stops being read.

## §5 — Barrier

`scripts/verify-alert-routing-wired.ts` (in `npm test`) proves:

- routing is **total** — no input, including empty string and unicode, returns a non-routine;
- all seven routines exist, with **distinct** labels, and `ALERT_ROUTINE_LABELS` lists every one;
- the **fallback is a real routine** (#2), not a sentinel;
- the workflow actually **executes** the shim (`scripts/alert-routing-label.ts`), **creates** the
  routine labels, and **applies** one with `gh issue edit --add-label` — checked against the
  workflow's executable text with comments stripped, because this file's own prose quotes those
  commands and a naive matcher would read the documentation instead of the code;
- the ordering invariants hold: #7 before #3 (`stale_no_remediation_path` → 7) and #5 before #3.
