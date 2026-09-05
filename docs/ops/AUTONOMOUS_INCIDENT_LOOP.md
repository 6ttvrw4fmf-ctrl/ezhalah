# The autonomous incident loop

**This file is the source of truth for how a finding becomes a fix without the owner in the middle.**
If a routine prompt and this file ever differ, update the routine to match this file. It sits above
the seven engineer routines and below `docs/ops/AGENT_AUTHORITY.md` — it does not widen GREEN, narrow
RED, or replace any routine's own spec. It states the one thing none of those files could state on
their own: **what happens to a finding between "someone noticed it" and "production is verified."**

Owner brief, 2026-09-04, in his words: *"Production bug happens → system detects it → correct
engineer owns it → reproduces it → finds root cause → fixes it → adds regression barrier/mutation →
tests it → merges/deploys if authorized → verifies production → resolves alert → gives me one final
report."* And: *"I should not need to be Ezhalah's QA engineer anymore."*

---

## §1 — Why this exists (measured, not assumed)

The detection layer was never the problem. On the day this was written the system had 344 offline
barriers, 160 rostered detectors, 19 scheduled production checks, and an alert router that is a
*total* function from alert kind to owning routine. What it did not have was a way to finish.

Four measurements, all taken on 2026-09-04:

| Measurement | Value | What it means |
|---|---|---|
| `alert_event` rows raised, all time | 1,014 | detection works |
| …ever acknowledged | **2** | the chain has effectively never closed |
| Open alerts right now / acknowledged | 106 / **0** | oldest 24 days, nobody claimed any of it |
| `mon_detect_unacknowledged_p0()` scope | `severity = 'P0'` | there are **no open P0s** — the one watchdog was watching an empty set |
| Scheduled workflows that raise no alert on failure | **17 of 19** | issue #1349: "ui-parity failed 5 nights, zero alerts" |
| Sentry issues in 90 days | 7 (6 of them our own test events) | the app throws almost nothing |
| Real users generating signal | 7 total, 5 active in 7 days | **there is no user traffic to learn from** |

That last row is the one that decides the architecture. Ezhalah is pre-launch: the owner *is* the
traffic. No amount of better error routing helps, because there are almost no errors to route — and
the bugs he actually finds (dark mode wrong, New Chat not blank, a card showing `0` for a NULL, sign-out
leaving state behind, One Tap silently failing) throw no exception, violate no database invariant, and
pass every one of the 344 barriers. They are **semantic**: the app works and shows the wrong thing.

So the missing layer is not a better funnel for errors. It is **a robot that uses the app the way he
does, every day, on every surface, and checks what it SEES against what is TRUE** — plus somewhere for
what it finds to live until it is genuinely finished.

## §2 — The two halves

**Half one: eyes.** `e2e/guardian/` drives production in a real browser, desktop and mobile, on the
surfaces that had zero live coverage. It asserts product invariants (shape, contrast, presence,
honesty) rather than pixels or hourly-changing counts. See §6.

**Half two: a spine.** `ops_incident` (migration `20260904144004`) is where a finding lives. It is not
a replacement for `alert_event` — the two answer different questions, and conflating them is why the
gap existed:

- **`alert_event` answers "is this CONDITION true right now."** Dedup-keyed, detector-raised,
  self-healing. Perfect for "the scraper is down." Useless for "who is fixing this, and did they add
  a barrier."
- **`ops_incident` answers "who owns this FINDING, what has been done, what is it waiting on."**
  Owner-assigned, state-machined, and — the whole point — **impossible to close without evidence.**

## §3 — The state machine

```
                    ┌──────────────── handed_off ────────────────┐
                    │        (re-owned, never dropped)           │
                    ▼                                            │
  open ──▶ investigating ──▶ reproduced ──▶ fixed ──▶ verifying ──▶ resolved
    │                                                             ▲
    ├──▶ blocked    (needs the owner — must cite §G.2 a/b/c/f)     │
    └──▶ wont_fix   (not a bug — must say why)      barrier + production verification
```

`reproduced` is deliberately its own state. "I could not reproduce it" is a real, honest outcome —
routine #6's spec already names it `UNDETERMINED` — and it must stay visible rather than be laundered
into either "fixed" or "still broken."

### §3.1 — Resolution is EARNED, and the database enforces it

```sql
constraint ops_incident_resolution_is_earned check (
  state <> 'resolved' or (barrier_script is not null and production_verified_at is not null)
)
```

The owner's standing rule — *every real bug produces a permanent regression barrier so the class
cannot silently return* — used to depend on an agent remembering it at the end of a long run. It is
now a CHECK constraint. It holds against `incident_resolve()` **and** against a raw `UPDATE` that
tries to walk around the function; both refusals were executed against production before this file
was written.

There is no fourth way out. An incident that should not be fixed exits through `wont_fix` with a
reason. One that genuinely needs the owner exits through `blocked` — and `blocked` must cite which of
`ENGINEER_ROUTINES.md` §G.2's six legitimate stop reasons applies. Categories (d) *another routine
owns it* and (e) *a permission boundary* are **refused outright**, because §G.3 says those must be
ROUTED, not parked.

## §4 — Ownership is total

`incident_route_owner(surface)` maps every surface to one of the seven routine slugs, falling back to
routine #2 (the standing triage router). A fallback is a real owner, not a bin.

| surface | owner |
|---|---|
| `advanced_filter`, `trending` | #5 AF + Trending |
| `search`, `matching`, `normal_filter`, `pagination`, `result_card` | #4 Search & Matching QA |
| `auth`, `session`, `sidebar`, `chat_persistence`, `navigation`, `theme`, `voice`, `loading_states`, `modal` | #6 Journey & Persistence |
| `data_integrity`, `price`, `location`, `listing` | #3 Data Integrity |
| `scraper`, `ingestion` | #1 Junior Scraping |
| `deploy`, `monitoring`, `alerting`, `cron`, `seam`, `migration` | #7 Systems Seam |
| anything else | #2 Senior Production (triage) |

Those seven slugs must equal the ones `scripts/lib/alertRouting.ts` uses.
`scripts/verify-incident-spine.ts` executes both and fails if they diverge — two independent copies of
a seven-name list is exactly the drift this repo has been burned by, and a renamed routine would send
incidents to a label no `gh issue list` will ever select.

## §5 — What every routine must now do

This is the part that turns a table into a loop. It is additive to each routine's existing spec.

1. **At the start of every run**, read your queue:
   ```sql
   select id, severity, title, surface, state, last_progress_at, detail
     from ops_incident
    where owner_routine = '<your slug>' and state not in ('resolved','wont_fix')
    order by severity, last_progress_at;
   ```
   Per `AGENT_AUTHORITY.md`, an open item is work, not wallpaper. Age confers no immunity.

2. **Drive each to a terminal state in the same run**, using §G.1's chain. The four terminal
   outcomes are the same four `AGENT_AUTHORITY.md` already defines for alerts: fix it, prove it was
   already fixed, prove truth cannot be established, or escalate a genuine owner decision.

3. **When you find something outside your lane — ROUTE IT, never drop it.** This is the mechanism
   §G.3 requires and the specs did not have. Instead of "file it in that routine's coverage trail"
   (which named no table, no schema, and no inbox), call:
   ```sql
   select incident_open('<stable fingerprint>', '<what is wrong>', '<surface>', 'P1', 'agent',
                        '<where you saw it>', '{"repro": "...", "expected": "...", "found": "..."}'::jsonb);
   ```
   It routes to the right owner automatically. If you already own an incident that turns out to
   belong elsewhere, `incident_handoff(id, '<new owner>', '<why>')`.

4. **Record progress as you go**, so a stalled item is distinguishable from an untouched one:
   `incident_advance(id, 'investigating' | 'reproduced' | 'fixed' | 'verifying', root_cause, fix_pr)`.

5. **Close only when it is earned**: `incident_resolve(id, 'scripts/verify-<the barrier>.ts', now())`.

6. **Report** `INCIDENTS WORKED / RESOLVED / HANDED OFF / BLOCKED` in your run's report block,
   alongside the existing Sentry lines.

## §6 — The eyes: `e2e/guardian/`

Production journeys, real browser, desktop **and** mobile, run daily and after every successful
deploy. They are read-only against production: never sign in, never submit the support form, no
writes of any kind through the UI.

Two rules keep them worth having:

- **A journey that cries wolf is worse than no journey.** This system already has that failure — the
  post-deploy bundle gate reported `failure` on 11 consecutive deploys that all shipped correctly,
  which in turn silently skipped the 9 AF journeys chained to a successful deploy. So every assertion
  polls rather than sleeps, and asserts shape and invariants rather than counts or listings that
  change hourly.
- **A harness failure is not a product bug.** A navigation timeout, a network error, or a 5xx means
  the run is `UNDETERMINED`: the workflow goes red, but **no product incident is filed against a
  routine**. Only a page that loaded fine and then violated an invariant files an incident.

**A passing journey never resolves an incident.** It appends `last_passed_at` as evidence and leaves
the state alone. "It stopped reproducing" is not "it is fixed with a barrier" — and §3.1 means the
database would refuse anyway.

## §7 — What reaches the owner

Exactly one thing, and it is not a stream: `ops_loop_health()` returns the whole loop in one call —
open incidents by state and owner, the alert backlog, and the only list that should routinely require
him, `needs_owner_decision` (every incident in `blocked`, with its §G.2 category and reason).

Everything else is the system's own work. Per `AGENT_AUTHORITY.md`, the owner is interrupted only for
category 4: a genuine product, business, or cost decision.

## §8 — What this deliberately does NOT do

- **It does not auto-rollback a deploy.** No rollback automation exists at any layer today; detection
  blocks, remediation is still a human typing a deployment id. Adding one is a real gap, and it is an
  owner decision because an automatic revert is not easily reversible (RED #7).
- **It does not weaken any existing gate.** Every P0 rule in `AGENTS.md` stands unchanged.
- **It does not replace Sentry.** When the DSN is provisioned, §G.6 and `SENTRY_ROUTING.md` still
  govern; a Sentry issue simply becomes another `source` an incident can be opened from.
- **It cannot make a cloud routine read its own spec.** The seven routine prompts live at claude.ai,
  outside this repo. This file is canonical and each spec says the file wins — but a routine whose
  prompt never loads it will not work its queue. `mon_detect_stalled_incident()` makes that failure
  loud and attributable rather than silent, which is the most the repo can do on its own.

## §9 — Barriers over this file

| Barrier | Pins |
|---|---|
| `scripts/verify-incident-spine.ts` | resolution stays earned; ownership stays total; SQL slugs == `alertRouting.ts` slugs; the nine states; both detectors rostered |
| `scripts/verify-scheduled-checks-alert-on-failure.ts` | every scheduled workflow raises an alert on failure, with reasoned exemptions |
| `scripts/verify-guardian-journeys.ts` | every journey declares a routable surface, covers both viewports, never resolves an incident, never submits the support form |
| `scripts/verify-deploy-bundle-check-pipeline.ts` | the post-deploy bundle assertion can never again fail because it passed |
