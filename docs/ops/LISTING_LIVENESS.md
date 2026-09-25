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

### 5.1 A working contract does not make a platform verifiable — dealapp, measured

The first production dealapp liveness run (2026-08-30, dry, 300 probes) reported:

```
DRY-RUN scanned=300 alive=37 dead=0 unknown=263 verified=0 sitemap_ids=56726
       | QUARANTINED: verified-rate too low, no deactivation written
```

Read it in two halves.

**The contract worked perfectly.** 263 shells classified `UNKNOWN`, not `DEAD`. Zero strikes, zero
deactivations, zero verification stamps. A naive "it returned 200, so it's alive" rule would have
manufactured 300 verifications out of nothing; a naive "we couldn't read it, so it's gone" rule
would have killed 263 live listings. The trust gate then quarantined the whole run on its own,
before any write, because 12.3% verified is not an environment whose 404s can be believed.

**And dealapp is still not verifiable from CI.** ~88% shells matches the 78–83% measured
2026-08-26: dealapp serves a listing-less page to GitHub Actions egress while an ordinary network
gets the full schema for ~89% of the same ids at the same moment. At a 12% alive rate the job
quarantines every run and covers ~36 of 15,899 rows per pass. Scheduling it was necessary and is
not sufficient.

**This is a coverage problem, and coverage problems are never solved by loosening the classifier.**
Lowering `MIN_ALIVE_RATE_FOR_TRUST` so runs stop quarantining, or treating a shell as death, would
convert a visible gap into invisible false deaths. The fix is egress: dealapp needs a route to the
source that behaves like an ordinary network, as wasalt already has via `WASALT_PROXY_URL`. That
proxy is a shared, capacity-limited resource (§20 rule 14 in `docs/ARCHITECTURE.md`), so adding a
consumer to it is an owner decision, not a code change.

Until then the ramp monitor is what keeps this honest: dealapp coverage will not increase, the
monitor will say so, and nobody has to remember.

### 5.2 The proxy was measured, not assumed — and it is not the answer

The obvious repair is the Saudi residential proxy wasalt uses. Owner, 2026-08-30: *"I would not
blindly give Dealapp the Saudi proxy yet because Wasalt already uses that shared limited resource.
First measure whether there is enough headroom."* Both halves were measured.

**Headroom (7 days of `scrape_runs`): safe.** Peak concurrent proxy runs 10 against a detector cap
of 16 and the ~34-run cliff of 2026-08-17; mean 2.37; zero samples at ≥12. UTC hours 01–03 carried
**zero** proxy runs on all 7 days, and dealapp liveness is scheduled 02:40 with a 6.5-minute run.
`liveness_run.py` has no thread pool — a sequential loop behind a 0.35s throttle — so it adds
exactly **one** concurrent session.

Before measuring, one real blocker had to be fixed: `mon_detect_proxy_contention()` counted
`wasalt%` and `souq24` only, so a dealapp proxy consumer would have been invisible to the one
monitor guarding the pool. It now counts `dealapp_liveness_proxy` (migration `20260830215434`,
cap unchanged at 16), and the runner uses that label when — and only when — it routes through the
pool.

**The bounded run, same limit and same cohort as the CI baseline:**

| | CI egress | proxy |
|---|---|---|
| scanned | 300 | 300 |
| alive | 37 (**12.3%**) | 71 (**23.7%**) |
| unknown | 263 | 229 |
| **dead** | **0** | **0** |
| trusted? | no — quarantined | yes, 23.7% clears the 20% floor |
| wasalt runs overlapping | — | 0 |
| rows written | 0 | 0 |

**Read it carefully, because it is not the win it looks like.** The verified rate roughly doubles
and the run stops quarantining — but **across 600 probes on two different egress paths, dealapp
has produced ZERO dead verdicts.** The cohort is ordered sitemap-absent first, so these 300 are
drawn from the 3,244 rows dealapp's own sitemap no longer lists — the rows most likely to be gone.
For 229 of them the source returned a shell rather than a 404. Dealapp does not appear to expose a
death signal on the listing URL at all, on any egress.

So the proxy buys **coverage**, not **discrimination**, and it buys a modest amount: at 23.7% it
would take ~112 days to positively verify the population once at 600 probes/day. That is still far
under the 50% SLA floor, and it costs a permanent slot on a shared capacity-limited resource.

**Therefore: not attached to the schedule.** `--proxy` is dispatch-only and cannot be reached by
the cron path. The 23.7% figure is a FLOOR, not a representative rate — it was measured on the
worst cohort by construction — so the next measurement worth doing is the same bounded run against
**sitemap-present** rows. If those verify at a high rate, the proxy becomes worth its slot; if they
do not, dealapp needs a different signal entirely (an internal API, a status field, a feed) and no
amount of egress will fix it.

### 5.3 Wasalt's oracle ran for the first time — and found nothing dead

Wasalt's `served_after_source_gone` alert has read *"3,367 rows carry the full strike grace"* for
weeks, and it is easy to misread that as 3,367 confirmed-gone listings still being served. It is
not. On 2026-08-31 the sweep was run for the first time in the platform's history — GitHub Actions
reported `run_number: 1`, which is itself the proof that the oracle had never once executed, so
`last_verified_alive_at` was NULL on all ~54k active rows and those strikes came from **crawl
absence alone**.

Dispatched `only_struck=true, report_only=true` (~1.3 GB against the struck cohort, not the ~22 GB
full sweep). All eight residential shards, the **entire** struck backlog probed by direct fetch:

| | total |
|---|---:|
| scanned | **3,367** — exactly the struck cohort |
| proven alive | **94** |
| **dead verdicts** | **0** |
| transient | 3,273 (**97.2%**) |
| rows deactivated | **0** |

The counts reconcile independently, which is worth stating because it is what makes them
believable: `scanned` equals the struck cohort exactly, the runner's `refreshed=94` equals the 94
distinct rows the database now shows with a non-NULL `last_verified_alive_at`, the struck count fell
by exactly 94 (3,367 → 3,273), and `active`/`inactive` ended at 53,025/12,165 — identical to the
pre-run baseline.

**Zero dead verdicts is the finding.** `--report-only` suppresses the *write* but still increments
`killed`/`pending_kill` with the verdict it would have reached, so `killed=0 pending_kill=0` on
every shard means zero rows were *classified* dead — not merely zero written. Nothing in that
backlog has been shown to be gone. The 94 alive rows are the first direct-fetch verifications
wasalt has ever carried, and they came out of the cohort most assumed to be dead.

**Read the 97% before drawing any conclusion from the 2.8%.** By §5's own standard this run is not
a trustworthy oracle — dealapp quarantines below a 20% verified rate and this is far under it.
Shard 7 reached 15% while the other six reached 0–2%, and shard 7 also finished first. That spread
tracks proxy capacity, not listing state: eight shards were hammering one shared metered residential
proxy simultaneously. **The next run should use 1–2 shards, not 8.** The cohort is identical, so it
costs no more bandwidth — it just stops the sweep from competing with itself.

Two things this does NOT license. It is not evidence the backlog is alive either — 3,273 rows
remain honestly **UNKNOWN**, which is the correct state and still forbids deactivation. And it does
not retire the alert: `served_after_source_gone` is doing its job by staying loud about rows nothing
has verified.

One gap this surfaced, recorded rather than fixed: `scrapers/aqar/liveness.py` — the runner shared
by aqar **and** wasalt — has no trust gate and no kill cap, unlike
`dealapp/liveness.py::environment_is_trustworthy()`. §5 states the rule ("a run that cannot be
trusted may not kill") but only dealapp implements it, and the deactivation is a direct PostgREST
`update({"active": False})` with no guarding RPC or trigger behind it. This is defence-in-depth
rather than an active bug — a transient read never strikes, which is why a 97%-degraded run still
killed nothing — but a source that answers misleadingly under degradation (dealapp's shells are the
known shape) would not be caught. Choosing the threshold needs aqar's baseline verified rate and
changes deactivation semantics, so it is an owner decision, not a drive-by.

### 5.4 Gathern proved §5 the hard way — and expresses blocking as `404`

§5 said "a run that cannot be trusted may not kill" from 2026-08-30, but only dealapp implemented
it. On 2026-09-01 gathern showed what the missing half costs. Its oracle alive-rate:

```
08-23 .. 08-31   66 74 79 72 77 72 76 84 62 %     nine healthy days
09-01  3.8%      09-02  0.7%      09-03  0.5%     the collapse
```

Inventory does not fall from 75% alive to 0.5% overnight. What changed was the *source*, not the
listings — and the damage landed before anyone looked: **302 rows inactivated on 09-01, 106 on
09-02**. Only on 09-03 did the batch (1,016) finally exceed the anomaly cap and quarantine.

**Why the anomaly cap was not enough, and why both guards must exist.** The cap is a batch-SIZE
guard: *is this batch too big to believe?* The 09-02 batch was 106 against a cap of 585, so it
sailed through — while every verdict in that run was unreliable. Size and trustworthiness are
different questions. The run-level gate (`scrapers/common/liveness_trust.py`, floor 0.20, same
constants as dealapp) asks the second one and is evaluated **before** the cap.

**The trap specific to this platform: gathern expresses blocking as `404`, not `429`.** The contract
correctly treats 403/429/5xx as UNKNOWN, but a source that answers a throttled or unwelcome client
with its own application-rendered 404 defeats a 404-means-dead oracle entirely. Proven the same day:
one listing returned **200 to the GitHub-Actions oracle at 10:51 and 404 to a datacenter probe
minutes later** — same URL, same hour, two answers. A URL that returns 200 to one client and 404 to
another is not a not-found. A probe of 12 rows the oracle had just verified alive returned 404 on
**12/12** from datacenter egress: a 100% false-death rate.

Three consequences worth carrying forward:

1. **Strikes must be deferred, not written in the loop.** They used to land per-row, so by the time
   a run's alive-rate was known they were already durable. Nothing could take them back.
2. **Restorative writes are never gated.** A block cannot manufacture a live 200, so an alive
   reading stays trustworthy even in a degraded run (same posture as `DELETION_SAFETY.md` §2.4).
3. **An aggregate rate is a lagging signal.** The sharper instrument for a source like this is an
   in-run positive control: probe a handful of known-alive canaries; if the canaries 404, the run is
   blocked, whatever the rest of the batch says.

   **Built 2026-09-06, on sanadak, where it matters most.** `scrapers/sanadak/run.py::
   set_liveness_canaries()` arms the oracle with listings THAT SAME RUN already fetched and parsed;
   `_canary_ok()` re-probes one before ANY 'gone' verdict is issued, and the verdict degrades to
   'unknown' — with the reason recorded — if the canary no longer renders its own listing. It fails
   CLOSED: no canary supplied means no removal at all. sanadak needs it more than gathern did,
   because on that platform "gone" IS an HTTP 200 app shell, so a source that started serving shells
   to our egress the way dealapp does (§5.1) would otherwise deactivate every probed row. Asserted
   and mutation-proven in `scripts/verify-sanadak-absence-cannot-deactivate.ts`
   (`removed_canary_shell`, `removed_canary_500`, `removed_no_canary`).

`mon_detect_liveness_oracle_untrustworthy()` (migration `20260903162156`) makes the degraded state
visible, as a regression against each table's own 2–14d baseline rather than an absolute — which is
what keeps dealapp's structural ~12% (§5.1) out of the cohort while catching gathern's 75% → 0.5%.

**The rows inactivated inside that window are not confirmed dead.** They are UNKNOWN and must be
recovered through `liveness --recheck-dead`, which restores only on a live 200 — and only once the
oracle reaches an egress gathern answers truthfully. Routing gathern through the shared Saudi
residential proxy is an **owner decision** (§5.1), not a code change.

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

---

## 9. THE CHAIN MUST BE PROVEN TO RUN, AND ITS SILENCE MUST BE AN ALARM

**Owner rule, 2026-09-21. This section is canonical and binds every platform, every routine and every
future onboarding.** It was given after the owner's own family found a dead gathern listing on the
live site, and after this run measured why.

> **1. Source removes a listing → Ezhalah detects it → safely verifies it → deactivates it.**
> **2. If the liveness checker or its scheduled job stops working, Ezhalah must detect THAT failure
>    too, instead of silently accumulating stale listings.**
>
> *"Use production evidence and controlled tests. Do not mark a platform as covered merely because
> code exists. Prove the full chain actually runs."* — the owner, 2026-09-21

### 9.1 "Covered" is a measured claim about PRODUCTION, never about the repository

A platform is **NOT** covered because a scraper has an oracle, because a workflow file exists,
because a cron row exists, or because a barrier is green. Every one of those was true of platforms
serving dead inventory on the day this rule was written. A platform is covered only when the whole
chain is observable in production data:

| link | what proves it, in production |
|---|---|
| the job fired | a `cron.job_run_details` row, `status = 'succeeded'` |
| the job actually DID its work | a `scrape_runs` row whose `rows_seen` is in family with its own history |
| the source was asked about the listing | an `ops_stale_inactivation_probe` row, or `last_verified_alive_at` moving |
| the verdict was earned | a DIRECT verdict at full grace, through `liveness_contract.py` |
| the listing left the user's screen | absent from `search_listings_ar` after one completed refresh+sync cycle |

If any link cannot be shown from production, the honest state is **UNKNOWN**, and it is reported as
UNKNOWN — never as covered. This is `ENGINEER_ROUTINES.md` §G.9 applied to a platform rather than to
a bug.

### 9.2 A GREEN JOB THAT DOES NOTHING IS THE DEFAULT FAILURE MODE, NOT AN EDGE CASE

Measured 2026-09-21, and the reason half this rule exists. wasalt's enumeration was **dead for seven
days** (2026-09-12 → 09-19): the workflow was dispatched on schedule, ran for three and a half hours,
and reported `conclusion: success` every time — while enumerating **96 rows instead of ~105,000**.
`run.py` had moved to a real browser in PR #3129 but the enum step still called the transport
wasalt.sa null-routed on 2026-08-17, so every page came back blocked and the walk ended early.

Nothing alerted. It was found by a human reading `scrape_runs` by hand. Downstream, the strike step's
coverage guard correctly refused to prune all week — so the guard worked, the job "succeeded", and
**~3,900 dead listings stayed active and clickable**. Every barrier was green.

**Two specific blind spots this exposed, both now closed — do not reintroduce either:**

1. **Absence cannot be compared.** `mon_detect_silent_partial_success()` measures a platform's
   last-24h `rows_seen` against its own 18-day median, which is the right question — but its
   candidate set is *runs that exist*. A job that stops producing runs **entirely** contributes no
   row, so there is nothing to compare and nothing fires. Silence was indistinguishable from health.
   **A liveness job must therefore be watched for EXPECTED-BUT-ABSENT runs, on its own declared
   cadence, not only for short ones.**
2. **A shared `platform` label hides a collapse inside another job's baseline.** The enum wrote under
   `platform='wasalt'`, the same bucket as the ordinary crawl, which is sharded into hundreds of
   small slices (runs of 2, 8, 91, 96 rows are normal there). A 96-row enum was statistically
   unremarkable against that median. **A job with its own cadence and its own expected volume needs
   its own run label** — PR #3241 gave the shards `wasalt_enum_shard` and that is the pattern.

### 9.3 What may be concluded from a job that did not run

Nothing about the listings. This is §1 restated at the JOB layer, and it is the same asymmetry:

- A liveness job that did not run, ran short, or could not reach the source leaves every listing it
  would have touched **UNKNOWN**. It may never strike, deactivate, or start a deletion clock.
- The correct response to a stalled checker is to **fix the checker**, never to widen a kill, lower a
  coverage floor, raise a cap, or treat the backlog it created as evidence of death. §7 already
  forbids that and this section does not soften it.
- **A restorative write is still never gated** (§0 corollary 2): a job that proves listings alive may
  run and heal them even while the destructive half stays frozen.

### 9.4 Onboarding a platform, and re-certifying one

Before a platform may be described as covered — in a report, a routine's output, a doc table or
`ops_platform_liveness_coverage` commentary — the chain in §9.1 must be walked **from the egress the
job really uses**, which is usually a GitHub Actions runner and is **not** a cloud routine's
container. Measured the same day: probing gathern from a cloud-routine egress returned 404 on **10 of
12 listings the crawl had served alive two hours earlier** (an 83% false-death rate), while the CI
egress got clean HTTP 200 on 10/10 canaries in the same period. **An "EGRESS BLOCKED" note in
`scrapers/absence-only-prune.txt` is a statement about the container that wrote it, and is not
evidence about the platform.** Re-measure from CI before believing it.

Each platform is validated and enabled **independently**, with interleaved known-alive controls
(§4.2 lesson 1), before any automated deactivation is allowed to write.

### 9.5 The genuinely-hard platforms are named, never quietly counted as covered

Where no reliable signal exists on the listing page, the platform is reported as an explicit gap with
**what information is missing** stated, and the next step is to look for a real source-supported
signal — an API, a status endpoint, a sitemap, a feed. Inventing a page-text heuristic to close the
gap is the fursaghyr mistake (§4.2: «غير متاح» was a registration-form string and «مؤجر» was
advertising prose; gating on either would have deactivated live inventory). **Report before
implementing anything risky.**

### 9.6 A TIER IS A MECHANISM. COVERAGE IS EVIDENCE. NEVER READ ONE AS THE OTHER

*(owner rule, 2026-09-21; `ops_incident` #248 / #578. Measured across the whole fleet the day it
was written.)*

The registry grades **what a platform runs**. `ops_platform_liveness_coverage` measures **what that
has actually produced**. They answer different questions, and the day this was written the fleet had
them fused into one wrong answer:

| | platforms | active listings |
|---|---|---|
| had ever written a single `last_verified_alive_at` | **4** (aqar, gathern, dealapp, wasalt) | — |
| had never written one, ever | **63** | **34,763** |
| ran a real direct oracle but were declared `CRAWL_PRESENCE_ONLY` | **29** | — |
| had already produced direct verdicts under that false label | **9** | 267 LIVE on rakez alone |

**One discarded patch caused all of it.** `db.prune_unseen()`'s self-heal — the branch reached only
after an oracle fetched a listing's own URL and read it ALIVE — wrote `{missing_count, last_seen_at}`
and stopped. §3's whole point is that `last_seen_at` means "a crawl encountered this row" and says
nothing about the source's opinion, so the strongest evidence this system can obtain was spent at
the instant it was obtained. `last_verified_alive_at` then stayed NULL no matter how well any oracle
ran; coverage read 0% everywhere; `CRAWL_PRESENCE_ONLY` looked like the honest tier; and
`mon_detect_liveness_coverage_ramp` — whose entire job is *"either its liveness job is not running,
or it is running and writing nothing"* — filters on
`strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT')` and therefore never looked at one of the 29.
A self-consistent blind spot: every layer confirmed every other layer, and all of them were wrong.

The two axes are now kept apart deliberately:

* **Mechanism** — the tier, in `liveness_policies.py` / `sql/mirrors/liveness_registry.json` /
  `ops_liveness_registry`, all three in one change. A platform that hands `verify_gone=` to
  `prune_unseen` **is** `CANDIDATE_PLUS_DIRECT` by this file's own definition ("an absence signal
  selects candidates cheaply; each candidate then gets a DIRECT re-fetch"). Declaring it below that
  is not modesty, it is a false statement that switches monitors off.
* **Evidence** — has the chain ever produced a verdict in production? Kept in
  `scrapers/oracle-never-observed.txt` (a shrink-only ledger, `verify-oracle-observation-ledger.ts`)
  and recomputed every sweep by `mon_detect_oracle_chain_never_observed()`, which raises per platform
  and clears itself the moment the chain leaves a trace.

**A tier is never a coverage claim, and it is never permission.** 20 of the 29 have still never been
seen to run: muktamel is the sharp case — 3,864 active listings, 381 already under strike and
queueing for the oracle, zero verdicts ever. Its alert says so in those words, and distinguishes it
from the benign case (a small stable catalogue where no candidate has ever reached grace) by
`under_strike`. Both are **UNPROVEN**; only one is broken; neither is *covered*.

**A tier claim has to be cashed in code, and there are exactly two ways.** Either the platform owns
`scrapers/<p>/liveness{,_run}.py` calling `direct_alive_patch()` / `verification_patch()`, or its
`run.py` wires `verify_gone=` into `prune_unseen` **and** `prune_unseen` stamps through the contract.
`verify-liveness-registry-mirror.ts` §4 asserts the shared branch **separately**, so deleting that
one stamp un-cashes all 29 claims at once. It asks the stripped source for the spread
`**direct_alive_patch(...)` that actually reaches the database: an earlier version tested the raw
file and a planted mutant proved it worthless — deleting both the import and the call left it GREEN,
because the comment above the self-heal *names* the function. A comment is not a code path.

### 9.7 AN ORACLE THAT READS RENDERED MARKUP DIES WHEN THE SOURCE CHANGES ITS RENDERER — aqar, measured 2026-09-25

§9.2 says a green job that does nothing is the default failure mode. This is that failure one level
down, and one degree more deceptive: the job ran, on schedule, at full volume, **and it kept
killing listings the whole time** — 8,845 kills and 17,190 strikes in the 30 days to 2026-09-25.
What had died was one of its two death routes, and the surviving route's healthy output is exactly
what made the dead one invisible.

`looks_dead()` reaches DEAD on a 200 by two independent paths: a `DEAD_MARKERS` phrase in the body,
or `looks_closed()`. The marker path was never affected and produced every one of those kills. The
soft-close path could not return True for any page — **and aqar's soft-closed pages carry no
DEAD_MARKER**, so that cohort escaped both routes and was certified ALIVE. Measuring the oracle by
its kill count would have reported it healthy on every day it was half-blind; only a per-page test
of `looks_closed()` itself could see it.

`scrapers/aqar/liveness.py::looks_closed()` is aqar's SOFT-CLOSE detector — aqar does not 404 a
closed ad, it serves HTTP 200, and an ad it closes carries no removal phrase, so this predicate is
the only thing that can retire it. The 2026-08-04 design was deliberately two-factor: a «مغلق» badge
in the markup **and** a missing offers node, because the bare word «مغلق» also appears in live ads'
own descriptions («مطبخ مغلق» = closed kitchen). Badge-alone was measured 0/77 live and 17/17 closed.

aqar then moved the listing page to **client-side rendering**. The closed banner is now painted by
JS from the payload, so no badge markup reaches the HTML at all. What does reach it is an i18n label
bundle shipped to **every** page, live ones included, carrying «مغلق» as a dictionary value
(`listing_status.closed`, `closed_banner.title`). So on 2026-09-25 the word-presence pre-check was
true on live pages and the badge regex was false on closed ones: **`looks_closed()` could not return
True for any page in existence.**

**The failure was not silence — it was an affirmative false ALIVE.** A page that fails `looks_dead()`
falls through to the ALIVE branch, which writes `last_verified_alive_at` via `direct_alive_patch()`.
Rows 874 and 882 were certified ALIVE that morning while aqar served them `closed:true` with
`price`, `area`, `content` and `create_time` all null. This is the §3 distinction inverted: not a
crawl sighting mistaken for proof of life, but our own per-listing oracle *manufacturing* the proof.

Measured that day, by direct fetch of each listing's own URL, with a live control arm in the same
session (the control matters — an all-null payload read from one container is otherwise
indistinguishable from the egress facts §9 warns about):

| arm | n | result |
|---|---|---|
| random active rows, never re-enriched | 75 | 71 live with a price matching ours exactly, **4 closed at source and still served (5.3%)** |
| source-confirmed closed ads | 6 | 6/6 scored `badge_match=false` — the oracle could not fire |
| live controls | 2 | structured price read back exactly (9,000,000 and 295,000) |
| pages carrying `closed:true` beside a published price | 0 | the two factors never disagreed |

**The repair keys factor 1 on aqar's own state flag** (`"closed": true`, escaped in the streamed
payload) instead of on markup we have to guess at, keeping factor 2 unchanged. aqar states what the
flag means in that same bundle: a closed ad «يظهر هذا الإعلان في صفحة حسابك فقط (لا يظهر على الخريطة
أو عند البحث)» — it is gone from the source's own search. The «طلب تسويق» exemption is preserved and
is now *stronger*: it is enforced by reading the flag rather than by the absence of a price, so an
open ad that merely withholds its price can never be killed.

**It ships DISARMED, and that is a deliberate reading of the RED list, not timidity.** Deactivating
on the repaired factor 1 is a BULK listing operation (order 2,500 rows at the measured rate), which
AGENTS.md puts behind owner approval. So a soft-closed page is treated as **UNKNOWN**: per §1 that
neither deactivates the row nor certifies it alive, which is already strictly better than the state
it replaces, where the same page had `last_verified_alive_at` written onto it. The verdict is
recorded every sweep (`aqar_liveness_detail.verdict = 'unknown_soft_closed'`, migration
`20260925072159`) and counted in the run summary, so the disarmed oracle cannot be mistaken for a
silent one. `AQAR_SOFT_CLOSE_ARMED=1` lets it strike and kill under aqar's declared 3-strike / 48h
grace once the owner has approved the volume.

**The general rule this platform paid for: a liveness oracle that parses RENDERED MARKUP has a
silent expiry date set by someone else's frontend team.** Prefer the source's own state field.
Where markup is genuinely the only signal, the barrier must EXECUTE the predicate against a stored
real page of each kind — `scripts/verify-aqar-soft-close-oracle-can-fire.ts` does exactly that, with
fixtures that deliberately retain the adversarial i18n bundle, and three mutants including a restore
of the dead badge regex. A source-text tripwire over `looks_closed()` would have stayed green for
every day the oracle was dead.
