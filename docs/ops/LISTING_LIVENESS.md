# Listing liveness — the architectural rule

**Owner decision, 2026-08-30. This file is canonical.** It supersedes any per-platform habit and any
routine prompt that says something weaker. `docs/ARCHITECTURE.md` §20 rule 9 points here.

> "We would rather temporarily keep an uncertain listing than incorrectly delete a live one, but
> once we have affirmative evidence a listing is dead, it must stop being searchable quickly."
>
> "We never inflate our listing count by knowingly showing dead inventory, and we never remove live
> inventory merely because we failed to verify it."
>
> "Do not optimize for listing count. Optimize for real live inventory."
>
> — the owner, 2026-08-30

---

## 0. Why this exists

Until 2026-08-30, liveness was 26 platforms' worth of independent local habits. Nobody had decided
that 26 of 29 production-searchable platforms would infer "alive" purely from crawl presence — it
just happened, one scraper at a time. Two consequences, both measured:

- **aqar** served closed ads as HTTP 200 with a «مغلق» badge and no `offers` node. The dead-marker
  check returned False, so the *alive* branch ran — refreshing `last_seen_at` **and resetting
  `missing_count`**. Closed ads could never accumulate strikes. ~14.8% of the active population
  reported healthy forever.
- **dealapp** shipped with no liveness mechanism at all: 15,899 active listings, 65% unseen by any
  crawl in 48h, and a listing URL that returns an identical ~131KB Angular shell for a real id and
  a bogus one alike — so the obvious rule ("it loaded, so it's alive") manufactures verification
  out of nothing.

Neither was a bug in one scraper. Both were the absence of a rule.

---

## 1. The law: liveness is THREE-valued, never two

```
ALIVE     the source affirmatively said this listing exists
DEAD      the source affirmatively said it does not
UNKNOWN   we did not get an answer we can believe
```

**There is no fourth value and there is no default.** Everything that is not a believable
affirmative answer is `UNKNOWN`, and:

> **UNKNOWN NEVER DEACTIVATES ANYTHING.**

Concretely, all of these are `UNKNOWN` and none of them may ever produce a strike, a deactivation,
or a verification stamp:

| condition | why it is not death |
|---|---|
| timeout / connection reset / DNS failure | we never reached the source |
| 401, 402, **403**, 407, 408, **429** | we were blocked or throttled — that is about us |
| any 5xx | the source is broken, not the listing |
| a 200 whose body we cannot interpret | we fetched something; we did not read an answer |
| an unresolved redirect | we do not know where we landed |
| **absence from our own crawl** | see §3 |

The canonical implementation is `scrapers/common/liveness_contract.py::classify_response()`. It is
mutation-proven in `scrapers/common/tests/test_liveness_contract_mutations.py` and statically pinned
by `scripts/verify-liveness-contract.ts`.

## 2. Only DIRECT evidence may kill, and only at full grace

`EvidenceKind` has three members and exactly one of them can end in a deactivation:

- **`DIRECT`** — we fetched *this listing's own URL* and read an answer. The only kind that can
  deactivate.
- **`ABSENCE`** — the listing is missing from a feed, sitemap, or enumeration. Candidate signal
  only; `decide()` returns `action="none"` for it, always.
- **`ADJUDICATED`** — a human or a recorded adjudication decided. Never auto-reactivates.

A `DEAD` verdict on DIRECT evidence adds **one strike**. Deactivation happens only when strikes
reach the platform's `grace` (3 everywhere today) — i.e. **three consecutive direct dead readings**,
never one. `decide()` is the single origin of every deactivation, and it writes an auditable reason
string (`source_confirmed_dead:direct:strikes=3/3`).

## 3. "Seen by the crawler" and "proven alive" are different facts, stored in different columns

| column | means |
|---|---|
| `last_seen_at` | a crawl encountered this row. Says nothing about the source's opinion. |
| `last_verified_alive_at` | **the source affirmatively told us this listing is alive**, on DIRECT evidence, at that moment. |

Migration `20260830183939` added `last_verified_alive_at` to all 67 listing tables, all-NULL — no
backfill, because backfilling it would have been inventing verification that never happened.
`scripts/verify-listing-tables-carry-verification-column.ts` fails CI if a new listing table omits
it.

**Only the contract writes that column** — `verification_patch()` (from a `Decision`) or
`direct_alive_patch()` (from a branch that has already established DIRECT + ALIVE). A sweep that
sets it by hand can stamp a row it never read, which is *worse* than the blind spot the column was
added to remove: it puts a confident, recent-looking timestamp on inventory nobody checked.
`scripts/verify-liveness-registry-mirror.ts` fails on any hand-written stamp under `scrapers/`.

`presence_patch()` exists for the one case where a platform's source presence is *explicitly
defined* as positive evidence. No platform declares that today, and `LivenessPolicy` raises if
`absence_is_candidate_only` is disabled.

## 4. Every production-searchable platform must declare a strategy

`scrapers/common/liveness_policies.py` is the registry. A platform without an entry raises
`KeyError` — there is **no silent default**, so a new platform cannot be onboarded with its liveness
question left unanswered. `scripts/verify-liveness-contract.ts` fails CI when a non-retired scraper
directory has no policy.

| tier | meaning | satisfies the owner rule? |
|---|---|---|
| `DIRECT_REVISIT` | we periodically re-fetch each listing's own URL | **yes**, if coverage keeps up |
| `CANDIDATE_PLUS_DIRECT` | an absence signal picks candidates cheaply; each gets a DIRECT confirm before anything is deactivated | **yes** |
| `CRAWL_PRESENCE_ONLY` | we only know the ad was in the crawl | **no — recorded as a KNOWN GAP** |

`CRAWL_PRESENCE_ONLY` is not an approved design. It is an honest label on 25 small platforms
(~8,400 active rows) so monitoring can *see* the gap instead of counting them as healthy. Rows there
are reported as unverified, never as verified-alive.

## 5. A run that cannot be trusted may not kill

Where a source can degrade in a way that mimics death, the runner must prove its own environment
before it deactivates anything. `scrapers/dealapp/liveness.py::environment_is_trustworthy()` is the
reference shape: if a run's positively-verified rate collapses, **every** deactivation in that run
is quarantined — because if the source is serving us shells, that run's 404s are degraded too and
none of its deaths are believable.

Related, and non-negotiable: **anomaly and kill caps stay.** A sweep that suddenly wants to
deactivate far more than its trailing norm has more likely broken than found a mass delisting.

## 6. Ezhalah must know its own liveness state without being asked

A rule nothing measures is a wish. Migration `20260830191646`:

- `ops_liveness_registry` — the SQL mirror of the Python registry (pinned by
  `scripts/verify-liveness-registry-mirror.ts`; the two cannot drift).
- `ops_liveness_coverage_snapshot` — hourly per-table census (cron `liveness-coverage-snapshot`).
- **`ops_platform_liveness_coverage`** — the dashboard. Per platform: `active`, `verified_in_sla`,
  `verified_ever`, `never_verified`, `under_strike`, `pct_verified_in_sla`, and the strategy tier
  that says what those numbers are worth.

```sql
select * from ops_platform_liveness_coverage;
```

Two detectors, in the `mon_run_all_detectors` roster:

- **`mon_detect_liveness_coverage_ramp`** — TEMPORARY, retires **2026-10-15**. It does not alert on
  low coverage (day one is 0% everywhere by construction). It alerts when coverage **stops
  increasing while still short of target**, and it watches its own census, because a monitor that
  cannot see is not a clean bill of health. On expiry it clears its own alerts.
- **`mon_detect_liveness_verification_sla`** — PERMANENT, dormant until **2026-09-13**, then P1 on
  any tier-1/2 platform whose in-SLA verified share is below the floor.

**Read the SLA alert correctly.** It says *the verification system is unhealthy*, not *the inventory
is dead*. The remedy is to find why that platform's sweep is not covering its population — not
scheduled, quarantined by a trust gate, blocked proxy, or a probe rate too low for the population.
**Never respond to it by deactivating rows**: absence of verification is UNKNOWN.

## 7. What this does NOT permit

- It does not authorise bulk or destructive listing operations. `docs/ops/DELETION_SAFETY.md` and
  the RED list in `docs/ops/AGENT_AUTHORITY.md` are unchanged.
- It does not permit raising a kill cap, anomaly floor, or destructive threshold to drain a backlog.
  A backlog that will not drain is evidence about the *verifier*, not permission to delete faster.
- It does not permit silencing a barrier to make coverage look better. Make the barrier distinguish
  cases and prove both directions.
- It does not weaken any existing gate (deploy lock, production target lock, preflight, taxonomy
  gate, source-fidelity rules).

## 8. Where the pieces live

| what | where |
|---|---|
| the three-valued law, `decide()`, the stamps | `scrapers/common/liveness_contract.py` |
| per-platform strategy + SLA registry | `scrapers/common/liveness_policies.py` |
| JSON mirror (the pivot between Python and SQL) | `sql/mirrors/liveness_registry.json` |
| mutation proof of the law | `scrapers/common/tests/test_liveness_contract_mutations.py` |
| static + registry barrier | `scripts/verify-liveness-contract.ts` |
| registry ↔ SQL ↔ stamping barrier | `scripts/verify-liveness-registry-mirror.ts` |
| new-table column barrier | `scripts/verify-listing-tables-carry-verification-column.ts` |
| the column, fleet-wide | migration `20260830183939` |
| dashboard + monitors | migration `20260830191646` |
