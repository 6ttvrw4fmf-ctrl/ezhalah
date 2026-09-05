# LISTING LIFECYCLE ENGINEER — routine #11 ♻️

**This file is the source of truth for routine #11 (♻️ Daily LISTING LIFECYCLE Engineer), daily
07:30 Arizona / 14:30 UTC, `claude-opus-5`.** The live cloud routine prompt carries a condensed
copy; if the prompt and this file ever differ, **update the routine to match this file**. Owner
authorised this routine 2026-09-04; the roster row, the schedule note and the ordering rationale
live in `docs/ops/ENGINEER_ROUTINES.md` (row 11 and the "Schedule note (2026-09-04) — the second
block"). This file adds a routine spec; it does not widen GREEN, narrow RED, or restate any rule in
`docs/ops/LISTING_LIVENESS.md`, `docs/ops/DELETION_SAFETY.md`, `docs/ops/AGENT_AUTHORITY.md` or
`docs/ops/AUTONOMOUS_INCIDENT_LOOP.md` in weaker words. Where any of those is stricter, it governs.

---

## §0 — THE RULE THAT OUTRANKS EVERYTHING ELSE IN THIS FILE

> # **UNKNOWN IS NOT DEAD.**

A timeout. A blocked source. A proxy failure. A parser failure. A crawl that did not run. A
temporary 403, 429, 408 or any 5xx. A 200 whose body we cannot interpret. An unresolved redirect.
Absence from our own crawl, a sitemap, a feed or an enumeration.

**None of those may remove a listing from anything, and none of them may start the 30-day deletion
clock.** Only real, source-confirmed inactivity may — DIRECT evidence, on the listing's own URL, at
full strike grace, through `scrapers/common/liveness_contract.py`. This is not a new rule; it is
`docs/ops/LISTING_LIVENESS.md` §1–§3, which is canonical and owner-locked, restated because this
routine is the one whose actions are irreversible.

**Say the consequence out loud, because it is the whole reason this routine is careful:** starting
the clock on an UNKNOWN is a data-loss bug of the worst kind. Everything downstream of it —
unsearchable, uncounted, then permanently deleted from the database and every dependent table — is
correct behaviour applied to a listing that was never dead. Thirty days later the row is gone, and
`docs/ops/DELETION_SAFETY.md` §5 measured what "gone" means: of 21,371 rows a legacy age-and-strike
deleter removed, **10,617 left no source key at all** and are permanently unknowable in either
direction. A false deactivation is recoverable. A false deletion, thirty days later, is not.

Two corollaries this routine may never trade away:

1. **The safe direction is asymmetric and always the same.** Preserving an uncertain listing is a
   recoverable error. Deleting a live one is not. When the evidence is ambiguous, preserve — and
   record the ambiguity as UNKNOWN rather than resolving it in either direction.
2. **A restorative write is never gated; a destructive one always is.** A block cannot manufacture
   a live 200, so an ALIVE reading stays trustworthy even inside a degraded run
   (`LISTING_LIVENESS.md` §5.4; `DELETION_SAFETY.md` §2.4). Reactivation may proceed where
   deactivation and deletion must stop.

If a run cannot tell UNKNOWN from DEAD for a cohort, the honest output is `UNKNOWN/UNVERIFIED` in
the §G.10 block — never a deletion, never a clock start, and never a claim that the cohort is clean.

---

## §1 — WHAT THIS ROUTINE OWNS, AND WHAT IT DOES NOT

### §1.1 The object

**What happens to a listing AFTER its source confirms it is gone.** The owner's rule, in his words:

> *If a source-confirmed listing is inactive/removed, the user must stop seeing it in Ezhalah
> immediately.*

That is the whole object: the passage from *source-confirmed dead* → *invisible on every surface* →
*30 days of audit custody* → *permanently deleted, consistently, everywhere* — plus every way a dead
listing can still be **seen**, **counted**, or **resurrected** along that path.

### §1.2 The three-way boundary that keeps this non-overlapping

This is the owner's explicit requirement and the reason a fourth routine at this layer does not
create a boundary dispute (migration `20260905022312`, header comment):

| Routine | Owns the question |
|---|---|
| **#1 ⚡ Junior Scraping** | **Did the CRAWL RUN?** Fetch health, proxies, egress, `scrape_runs` rows, shard coverage, enumeration completeness. |
| **#3 🛡️ Data Integrity** | **Is the FIELD TRUTH of a listing that is ALIVE correct?** Price, period, area, location, type, amenities, and whether an inactivation was *earned*. |
| **#11 ♻️ Listing Lifecycle** | **Given that the source has confirmed the listing is GONE — does it actually disappear, stay gone, and get deleted correctly at 30 days?** |

**The three meet at a listing and never at the same question.** A crawl that failed is #1's. A live
listing showing the wrong price is #3's. A source-confirmed-dead listing still on screen is #11's.

### §1.3 Where #11 and #3 genuinely touch, and how the tie is broken

`DATA_INTEGRITY_ENGINEER.md` §4 ("Inactive listings — prove they are really inactive"), §5
("Dumped / removed listings") and §15 ("Inactive resurrection audit") already own the *evidence
quality of the inactivation decision* and the *restoration of false inactivations*. Those sections
are unchanged and #11 does not absorb them.

**The operational tie-breaker is the alert router, not prose.** `scripts/lib/alertRouting.ts` is
already explicit, and it is the boundary:

- **Stays with #3** — `unverified_inactivation`, `mass_inactivation`, `stale_*`, `prune_*`,
  `cleanup_evidence_gap`, `deletion_spike`, `served_after_source_gone`, `deleted_but_source_live`,
  `unledgered_hard_delete`, `orphaned_search_row`, `inactivation`.
- **Belongs to #11** — `inactive_still_searchable`, `inactive_still_counted`, `false_resurrection`,
  `unknown_treated_as_dead`, `deletion_clock_*`, `orphan_after_delete`, `lifecycle_*`.
- **Incident surfaces** — `incident_route_owner()` maps `lifecycle` and `inactive_listing` to
  `routine-11-lifecycle`. Those two surfaces are this routine's queue (§G.6b).

If #11 finds a defect whose kind routes to #3, it **routes it** with `incident_open(...)` and says
so in its report (§G.3). It does not fix it silently and it does not merely note it.

### §1.4 One line on #4

A **dead listing still returned by search is #11's finding** — the failure is that a confirmed-gone
row is reachable, which is this routine's object regardless of which layer leaked it. It is routed
to **#4 🧪 Search & Matching QA** only when the root cause turns out to be **the matching predicate
itself** (the RPC returning a row it should not have matched on the *filter's* semantics, rather
than on the row's *aliveness*). Aliveness leaks stay here; predicate bugs go there.

### §1.5 Explicitly NOT this routine's

- Whether a crawl ran, why a proxy failed, or whether an egress path is trustworthy — **#1**.
- Whether a live listing's fields are right — **#3**.
- Whether the Advanced Filter's predicates mean what they claim — **#5**.
- The verification apparatus itself (a barrier that asserts the bug) — **#10**.
- Enabling a platform in `platform_retention_policy`, changing retention windows, or draining the
  standing aqar/wasalt cleanup backlog — **owner decisions**, see §5.3.

---

## §2 — THE CHAIN, LINK BY LINK

Every name below was verified to exist in this repository before it was written down. Names this
routine could **not** verify are in §8 and are marked UNKNOWN rather than guessed.

### §2.1 Source → verdict

| Piece | Where |
|---|---|
| The three-valued law, `classify_response()`, `decide()`, `EvidenceKind.{DIRECT, ABSENCE, ADJUDICATED}`, `verification_patch()`, `direct_alive_patch()`, `presence_patch()`, `Decision.action ∈ {deactivate, strike, reset, none}` | `scrapers/common/liveness_contract.py` |
| Per-platform strategy + SLA registry; `policy_for()` (raises `KeyError`, no silent default), `strategy_for()`; tiers `DIRECT_REVISIT` / `CANDIDATE_PLUS_DIRECT` / `CRAWL_PRESENCE_ONLY`; `LivenessPolicy.grace = 3` | `scrapers/common/liveness_policies.py` |
| Run-level trust gate: `environment_is_trustworthy()`, `canary_environment_ok()`, `MIN_ALIVE_RATE_FOR_TRUST = 0.20`, `MIN_PROBES_FOR_TRUST = 25` | `scrapers/common/liveness_trust.py` |
| Coverage dashboard — `active`, `verified_in_sla`, `verified_ever`, `never_verified`, `under_strike`, `pct_verified_in_sla`, strategy tier | view `ops_platform_liveness_coverage` |
| Registry mirror / hourly census | `ops_liveness_registry`, `ops_liveness_coverage_snapshot` |

**"Source-confirmed" has exactly one definition** and it is the contract's, not this file's: a
`DEAD` verdict from `classify_response()` on **`EvidenceKind.DIRECT`** — a fetch of *this listing's
own URL* — accumulated to the platform's full `grace` (3 everywhere today), producing a `Decision`
with `action = 'deactivate'` and an auditable reason string of the shape
`source_confirmed_dead:direct:strikes=3/3`. `ABSENCE` returns `action = 'none'`, always. Only the
contract may write `last_verified_alive_at`; `last_seen_at` ("a crawl encountered this row") is a
different fact and proves nothing about the source's opinion (`LISTING_LIVENESS.md` §3).

### §2.2 Verdict → DB active state

Per-platform tables `<platform>_residential_listings` / `<platform>_commercial_listings`, carrying
`active`, `missing_count`, `last_seen_at`, `deactivated_at` and `last_verified_alive_at`
(migration `20260830183939`, all 67 tables, all-NULL, deliberately not backfilled).

Writers into the inactive state:

| Writer | Where | Behaviour |
|---|---|---|
| `prune_unseen()` | `scrapers/common/db.py` | Soft-inactivation only, never deletes. 3-strike grace, reset on re-seen. Guards: 0-seen skip (returns `-1`), collapse guard `max_prune_frac = 0.30`, coverage floor `PRUNE_MIN_COVERAGE` (default `0.80`), shard-scoped, and the `verify_gone` source oracle. Evidence to `ops_stale_inactivation_probe`. |
| Platform liveness runners | `scrapers/aqar/liveness.py` (aqar **and** wasalt), `scrapers/dealapp/liveness_run.py`, `scrapers/gathern/liveness.py`, `scrapers/wasalt/liveness.py` | The DIRECT path. Workflows: `aqar-liveness.yml` (pg_cron `gh-aqar-liveness`, `0 1 * * *`), `dealapp-liveness.yml` (`40 2 * * *`), `gathern-liveness.yml` (`0 6 * * *`), `wasalt-enum-liveness.yml`, `wasalt-liveness.yml` (deliberately unscheduled). |
| `mark_stale_listings_inactive(7)` | pg_cron `stale-listings-mark`, `0 4 * * *`, jobid 13 | **Detect-only since `20260728200000`** — raises P2, never writes `active = false`. Circuit breaker `mon_stale_breaker_state`; population floor `act >= 30` (`scripts/verify-stale-breaker-min-population.ts`). |
| `auto_recover_false_inactive()` | pg_cron `auto-recover-false-inactive`, `20 5 * * *`, jobid 30 | The restore leg. `active = false` AND `missing_count = 0` AND recently seen → `active = true`. Guarded by `ops_adjudicated_listing` (never undoes an adjudication) and the sibling-supersession guard (`20260902071952`). |

### §2.3 DB active state → the served index

```
<platform>_*_listings (active = true)
  → active_listing_ids_v2          MATERIALIZED VIEW; each arm is "... WHERE <table>.active IS TRUE"
                                   refreshed hourly, pg_cron jobid 17, minute :00
  → listing_native_location_v1 → listing_native_location_v2   (per-listing derived stores)
  → listing_location_index
  → sync_search_listings_ar()      pg_cron jobid 28 'sync-search-listings-ar', minute :14
                                   *** STEP 1 OF 5 *** (see below)
  → search_listings_ar             THE SERVED INDEX
```

Three properties of this leg that matter more here than anywhere else in the system:

1. **Inactivation is not immediate on the served index.** `location_search_candidates_ar` has **no
   `active` predicate of its own** — aliveness is enforced entirely upstream, by the matview's
   `WHERE active IS TRUE` and by the sync's delete leg. A row deactivated at 12:05 stays served
   until the :00 refresh and the :14 sync have both run. **That window is normal, and it is the
   thing this routine measures.** "Immediately" in the owner's rule means *by the next completed
   propagation*, and a leak that outlives one full refresh+sync cycle is a defect, not latency.
2. **The sync's DELETE leg can abort.** `sync_search_listings_ar()` counts rows absent from
   `listing_native_location_v2`; if that count exceeds `greatest(2000, 15% of the index)` it writes
   a `sync_delete_circuit_breaker` row to `location_pipeline_alerts` and **deletes nothing**. A
   genuine mass delisting therefore leaves confirmed-dead rows searchable until a human looks. That
   is a deliberate safety trade, and detecting when it has fired is this routine's job.
3. **`prune_inactive_from_search()` is the second remover**, added to `v_deleted` after that branch
   — the safety net for rows whose table row went `active = false`.

**Out-of-band syncs must run all five statements**, in order (comment on
`public.sync_search_listings_ar()`, migration `20260822140704`):

```sql
select * from public.sync_search_listings_ar();
select public.refresh_rnpl_flags();
select public.sync_payment_monthly();
select * from public.sync_all_rich_attrs();
select public.sync_gathern_native_attrs();
```

And the repair ordering rule in `ENGINEER_ROUTINES.md` ("Repair ordering: raw → matview → sync →
verify") applies in full: **a write directly into `search_listings_ar` is not durable and will be
reverted by the next sync.**

### §2.4 The served index → every user-visible surface

| Surface | Real name | Reads |
|---|---|---|
| Normal Search results | `location_search_candidates_ar(...)` | `search_listings_ar` |
| Advanced Filter results | the same RPC, with the AF predicate arguments | `search_listings_ar` |
| Pagination / «عرض المزيد» | the same RPC, `p_offset` | `search_listings_ar` |
| Guided / option counts | `apartment_guided_counts_ar(...)`, `property_age_option_counts_ar(...)` | `search_listings_ar` |
| District counts | `district_options_ar(...)` | `search_listings_ar` |
| Trending cities | `top_cities_by_deal_ar(...)` (materialized `total` CTE) | `search_listings_ar` |
| Platform loader | `loader_active_platforms_ar(...)` | `search_listings_ar` |
| Result card / deep link | the card's own `listing_url` → the partner site | the row returned above |

**One resolver, one scope.** A count surface must share the results scope — same resolver, same
arguments including `p_tables` — never a second copy. A dead listing excluded from results but still
inside a count is exactly the failure this routine names `inactive_still_counted`.

### §2.5 The deletion tier

| Piece | Where |
|---|---|
| **The only sanctioned deleter** — `run(platform, *, dry_run, force, bounded_cap)`, `verdict(status, body, dead_marker)`, `main()` (`python -m scrapers.common.cleanup`) | `scrapers/common/cleanup.py` |
| Policy defaults — `min_inactive_days: 30`, `min_missing_count: 3`, `require_source_recheck: True`, `max_delete_per_run: 500`, `anomaly_floor: 300`, `anomaly_factor: 4`, `enabled: False`, `max_eligible_frac: 0.10`; `FRAC_GUARD_MIN_ROWS = 500` | `DEFAULT_POLICY` in the same file, per-platform overrides in `platform_retention_policy` |
| Run-level inconclusive freeze — `_FREEZE_MIN_SAMPLE = 20`, `_FREEZE_MAX_INCONCLUSIVE_RATE = 0.30` | same file |
| Platform-health gate — `_HEALTH_GATE_ALERT_KINDS = ("scraper_failure_step_change", "silent_scraper_death")` | same file |
| Per-row audit trail, written BEFORE the delete | `cleanup_deletion_log`; run rows in `cleanup_runs` |
| Barrier 14 — archives the complete row on any delete, from any entrypoint | trigger `trg_archive_hard_delete` → `purged_listings_archive` |
| Post-delete re-probe | `scrapers/common/verify_deletions.py`, workflow `verify-deletions.yml` (`Verify deletions (post-delete spot-check)`), pg_cron `gh-verify-deletions` `0 5 * * 0`; tables `cleanup_deletion_verification`, `ops_hard_deleted_listing_backaudit` |
| Cleanup entrypoints | `platform-cleanup.yml` (dispatch), `aqar-cleanup.yml` (pg_cron `gh-aqar-cleanup`, `0 2 * * 0`), `wasalt-cleanup.yml` (`gh-wasalt-cleanup`, `30 2 * * 0`), `gathern-cleanup.yml`, `aqarcity-cleanup.yml` |
| Retired paths register | `ops_retired_deletion_path` |

**`enabled = true` for two platforms only** (aqarcity, gathern). Everything else is
soft-inactivation only. Turning a platform on is a retention-policy change — RED #4, owner decision.

### §2.6 The detectors that already watch parts of this chain

`mon_detect_served_after_source_confirmed_gone` (kind `served_after_source_gone`) ·
`mon_detect_deleted_but_source_live` · `mon_detect_unledgered_hard_delete` ·
`mon_detect_deletion_spike` · `mon_detect_cleanup_evidence_gap` ·
`mon_detect_deletion_on_inconclusive_evidence` · `mon_detect_mass_inactivation` ·
`mon_detect_unverified_inactivation` (kind `unverified_inactivation`) ·
`mon_detect_prune_kill_without_source_verdict` (kind `prune_kill_unverified`) ·
`mon_detect_prune_verdict_unevidenced` · `mon_detect_orphaned_search_row` ·
`mon_detect_stale_active_fraction` · `mon_detect_stale_no_remediation_path` ·
`mon_detect_liveness_oracle_untrustworthy` · `mon_detect_liveness_verification_sla` ·
`mon_detect_liveness_coverage_ramp`.

Read them; do not re-derive what they already answer.
`select * from ops_platform_liveness_coverage;` is the standing answer to "do we have dead
listings?" and `mon_run_all_detectors()`'s `open_alerts` — not its all-zero counts — is what says
whether anything is currently wrong (`AGENTS.md`).

---

## §3 — THE 30-DAY LIFECYCLE, AS A STATE MACHINE

Owner-approved 2026-09-04, and it is the policy the engine already implements
(`DEFAULT_POLICY.min_inactive_days = 30`). Because it is approved, **executing it is not a RED
item for this routine** (§5.3). Because it ends in an irreversible delete, every transition into it
is evidence-gated.

```
                      ┌──────────────────────── UNKNOWN ────────────────────────┐
                      │  timeout · 403/429/5xx · shell body · parser failure ·  │
                      │  missing crawl · absence from feed/sitemap/enumeration  │
                      │  → NO strike, NO deactivation, NO clock. Stays ACTIVE.  │
                      └─────────────────────────────────────────────────────────┘

  ACTIVE ──DIRECT DEAD ×1,×2──▶ UNDER_STRIKE ──DIRECT DEAD at grace(3)──▶ SOURCE_CONFIRMED_INACTIVE
     ▲                                │                                          │
     │                                │ DIRECT ALIVE  →  reset strikes           │ clock starts here
     │                                ▼                                          ▼
     └──────── RESTORED ◀── source proves ALIVE (200, no dead marker) ──── AUDIT_CUSTODY (30 days)
                  ▲          cancels the clock; row returns to search             │
                  │                                                               │ still SOURCE-CONFIRMED
                  │                                                               │ inactive at day 30
                  └───────────────── never from an UNKNOWN ─────────▶  DELETION_ELIGIBLE
                                                                                  │
                                                        fresh per-row DIRECT re-probe (§2.5)
                                                     ├─ live        → RESTORE (self-heal), never delete
                                                     ├─ inconclusive→ SKIP, clock keeps running
                                                     └─ dead        → PERMANENTLY_DELETED
```

### §3.1 The transitions, stated so they cannot be read loosely

| Transition | The only thing that may cause it |
|---|---|
| `ACTIVE → UNDER_STRIKE` | a `DEAD` verdict on `EvidenceKind.DIRECT`. `ABSENCE` never strikes. |
| `UNDER_STRIKE → SOURCE_CONFIRMED_INACTIVE` | strikes reaching `LivenessPolicy.grace`, inside a run that passed `environment_is_trustworthy()` and the kill/anomaly cap. |
| anything `→ UNKNOWN` | everything else. UNKNOWN is the default for every non-answer and has no downstream effect at all. |
| `SOURCE_CONFIRMED_INACTIVE → AUDIT_CUSTODY` | the same event; the 30-day clock starts at the *source-confirmed deactivation*, not at last crawl contact. |
| `AUDIT_CUSTODY → RESTORED` | a live 200 with no dead marker, on the listing's own URL, before day 30. Cancels the clock. Restoration is never gated by a degraded run. |
| `AUDIT_CUSTODY → DELETION_ELIGIBLE` | 30 continuous days SOURCE-CONFIRMED inactive, with the confirmation never having lapsed into UNKNOWN-and-assumed. |
| `DELETION_ELIGIBLE → PERMANENTLY_DELETED` | a **fresh** per-row DIRECT re-probe returning authoritatively dead, after the platform-health gate, the anomaly + `max_eligible_frac` breakers, the run-level inconclusive freeze, `max_delete_per_run`, and the `cleanup_deletion_log` row **written before the delete**. |
| `DELETION_ELIGIBLE → RESTORED` | that same re-probe returning live. Self-heal, `{"active": True, "missing_count": 0}`. This is the expected outcome for a meaningful fraction: one real aqar run reactivated 4 of 4; a gathern run 73 of 300. |

### §3.2 Restore-and-cancel, in detail

A restore is a *complete* return to the searchable population, not a flag flip:

1. Set `active = true`, `missing_count = 0` on the raw row. Never rebuild a listing from a probe —
   re-ingest through the normal scraper (`DELETION_SAFETY.md` §5).
2. Cancel the deletion clock: the row must not remain eligible on a stale `last_seen_at`.
3. Propagate: `REFRESH MATERIALIZED VIEW CONCURRENTLY public.active_listing_ids_v2`, then **all five**
   sync statements from §2.3, then verify — against the matview and the raw row, not only the index.
4. Confirm on the real user path (results, counts, Trending, the card) that it is back.
5. Never restore on an inconclusive verdict. Inconclusive is not permission in either direction
   (`DELETION_SAFETY.md` §1); and `auto_recover_false_inactive()`'s adjudication guard must never be
   walked around.

### §3.3 The clock's known weak point — record it, watch it, do not paper over it

The engine's candidate predicate is `active = false AND missing_count >= pol["min_missing_count"]
AND last_seen_at < cutoff`, and `_age_days()` measures age from **`last_seen_at`**. `missing_count`
is accumulated by `prune_unseen()` from **crawl absence** — `EvidenceKind.ABSENCE`.

So, stated precisely: **the eligibility clock is not evidence-gated; the deletion is.** The
`require_source_recheck: True` fresh per-row DIRECT probe is what stands between an
absence-accumulated candidate and an irreversible delete, and it is doing that job (the reactivation
rates in §3.1 are the measurement). But a listing can enter AUDIT_CUSTODY on evidence that §0
forbids as a *death* verdict, and the state machine above describes the intended contract, which the
implementation reaches only at the final gate.

This routine's position: **the final gate is not permission to leave the clock unguarded.** §4's
`deletion_clock_unearned` barrier exists precisely for this, and closing the gap in the predicate
itself (keying eligibility on the source-confirmed deactivation rather than on `last_seen_at`)
changes deactivation/deletion semantics for every platform — so it is proposed with evidence and
**blocked to the owner** under §G.2(a), not shipped on this routine's own judgement.

---

## §4 — THE BARRIERS THIS ROUTINE ADDS AND MAINTAINS

**How a barrier is added:** create `scripts/verify-<name>.ts`. That is the whole procedure —
`scripts/lib/testRegistry.ts` discovers every `scripts/verify-*.{ts,mjs}` **by existence** and
`scripts/run-tests.mjs` runs them in sorted order. **Do not edit `package.json`**; do not prove your
own wiring by string-matching it (use `npmTestRuns(root, 'verify-my-thing')`).

**Every new barrier must carry an executable mutation proof.** `scripts/verify-new-barriers-are-
mutation-proven.ts` is a ratchet: everything on `scripts/mutation-proof-grandfathered.txt` is
grandfathered, that list may only shrink, and a new barrier without a `mustCatch(...)` /
`mutation(...)` call against a deliberately broken input — or an explicit
`// MUTATION-PROOF-EXEMPT: <reason>` — fails the suite. `mustCatch('...', true)` is rejected as a
fake proof. **Prose describing a mutation is not a mutation.**

And per `AGENTS.md`: a barrier that reads source as TEXT can pass for the entire time the defect is
live. Where the defect is behavioural, **execute the real function** — lift it with
`scripts/lib/liftSymbols.ts` and run it against an injected failure. Never test a copy.

Below, one barrier per failure mode the owner named. Each row states what it **asserts** and what
its **mutation** re-introduces. None of these ten alert kinds currently has a detector behind it
(§8), so the detector is part of the barrier, added in the same migration as its
`mon_run_all_detectors` roster entry — a detector outside the roster is decoration
(`mon_detect_orphaned_detectors` fires on one).

| # | Barrier | Asserts | Its mutation re-introduces |
|---|---|---|---|
| 1 | `verify-inactive-listing-is-not-searchable.ts` + `mon_detect_inactive_still_searchable` (kind `inactive_still_searchable`) | No `(source_table, listing_id)` whose raw row is `active = false` with a source-confirmed deactivation reason is returned by `location_search_candidates_ar` after one completed refresh+sync cycle; the set difference is exactly empty, measured on the **served** RPC, not on `search_listings_ar` alone. | A row left in `search_listings_ar` after its raw row went `active = false` — i.e. `prune_inactive_from_search()` removed from the sync body. The barrier must go red. |
| 2 | `verify-inactive-listing-is-not-in-advanced-filter.ts` | The same emptiness holds with every AF predicate argument populated — the AF path is the same resolver with more arguments, so a dead row must not survive by entering through an AF-scoped branch (`p_tables2`/`p_types2`, the AF cohort clauses). | An AF branch that widens `p_tables2` without re-applying the aliveness scope, so a confirmed-dead row reappears under an AF selection but not under the plain one. |
| 3 | `verify-inactive-listing-is-not-in-trending.ts` | `top_cities_by_deal_ar`'s cohort and its materialized `total` both exclude confirmed-dead rows, and its numbers reconcile against the results scope for the same arguments. A city total may never exceed what the results resolver can deliver for that scope. | Trending counting a table the results resolver excludes — the exact shape of the الهفوف incident (2,478 promised / 109 delivered). |
| 4 | `verify-inactive-listing-is-not-counted.ts` (kind `inactive_still_counted`) | `apartment_guided_counts_ar`, `property_age_option_counts_ar`, `district_options_ar` and `loader_active_platforms_ar` all resolve the same scope as the results RPC, `p_tables` included — one resolver, never a second copy. The count equals the cardinality of the returned id set for the same arguments. | A count path keeping its own copy of the scope clause, so a confirmed-dead row is excluded from results but still inflates the count. |
| 5 | `verify-no-false-resurrection.ts` (kind `false_resurrection`) | A row deactivated on DIRECT source-confirmed evidence is not returned to `active = true` by `auto_recover_false_inactive()`, by a re-seen crawl, by `prune_unseen()`'s reset-on-seen, or by pagination/Back/navigation replaying a cached page. Only DIRECT ALIVE evidence, or a recorded adjudication, may restore it. | Removing `auto_recover_false_inactive()`'s adjudication or sibling-supersession guard; and, on the client leg, a cached results page re-rendering a card whose row is now inactive. |
| 6 | `verify-unknown-never-becomes-inactive.ts` (kind `unknown_treated_as_dead`) | **Executes** `classify_response()` against every UNKNOWN shape — timeout, 401/402/403/407/408/429, every 5xx, an uninterpretable 200 body, an unresolved redirect — and asserts `UNKNOWN`; then executes `decide()` with `EvidenceKind.ABSENCE` and asserts `action = 'none'`; then asserts no code path under `scrapers/` writes `active = false` or `last_verified_alive_at` outside the contract. | Any one status moved out of `_BLOCKED_OR_THROTTLED`; `decide()` letting ABSENCE strike; a hand-written `last_verified_alive_at` stamp. (`scripts/verify-liveness-contract.ts` and `scripts/verify-liveness-registry-mirror.ts` already hold the static half — this barrier must add the executed half and must not duplicate them.) |
| 7 | `verify-deletion-clock-is-earned.ts` (kind `deletion_clock_unearned`) | No row is in `DELETION_ELIGIBLE` unless its deactivation carries a DIRECT source-confirmed reason **and** 30 full days have elapsed since that confirmation. A day-29 row is not eligible; a 400-day row deactivated on absence alone is not eligible either. Boundary asserted at 29 / 30 / 31 days. | `min_inactive_days` lowered, the comparison flipped to `<=`, or eligibility keyed on `last_seen_at` with no source-confirmed reason required (§3.3 — the mutation the current predicate would *survive*, which is why this barrier asserts the invariant and not the implementation). |
| 8 | `verify-confirmed-inactive-30d-rows-are-deleted.ts` (kind `deletion_clock_stalled`) | The other direction: rows that HAVE been source-confirmed inactive for 30+ days on an `enabled` platform do not accumulate unboundedly. Reports the eligible backlog per platform with the reason each run is not draining it (breaker tripped, health gate open, freeze, cap) — so a permanently stuck queue is visible and attributable rather than silent. | A run that reports success while deleting nothing, and a backlog that grows with no named reason. **This barrier never authorises raising a threshold** to make itself green (`LISTING_LIVENESS.md` §7, `DELETION_SAFETY.md` §6). |
| 9 | `verify-no-orphan-after-delete.ts` (kind `orphan_after_delete`) | After a delete, no `(source_table, listing_id)` survives in `search_listings_ar`, `active_listing_ids_v2`, `listing_native_location_v1`/`v2`, `listing_location_index`, or any AF attribute view — and `purged_listings_archive` holds the archived row with a matching `cleanup_deletion_log` entry. Deletion is complete and consistent, or it did not happen. | Deleting the raw row without propagating, leaving an index row pointing at nothing — the shape `mon_detect_orphaned_search_row` already watches from one side only. |
| 10 | `verify-no-stale-cross-table-duplicate.ts` (kind `lifecycle_duplicate_stale_copy`) | Where the same source listing exists in more than one table (the residential/commercial URL collision repaired by `20260830140110`, and the `retire_superseded_siblings()` path), a confirmed-dead listing is dead in **every** copy. No superseded sibling remains searchable, and no recovery routine revives one. | Removing the sibling-supersession guard from `auto_recover_false_inactive()`, or repairing only the copy the incident named while its twin stays served. |

Two standing rules over all ten:

- **Assert the INVARIANT, not the current implementation.** A barrier that pins today's predicate
  goes green on the day someone writes a *different* correct implementation, and red on the day
  someone writes a different *wrong* one only by luck. Barrier 7 is the worked example.
- **A green barrier may be asserting the bug.** After writing each one, re-mutate: break the
  behaviour a second, different way and confirm it still goes red. If it does not, the barrier is
  narrower than it reads.

---

## §5 — AUTHORITY

### §5.1 Fix first, report last

`ENGINEER_ROUTINES.md` §G binds this routine in full and this section **adds to §G; §G wins on any
divergence.** The chain is §G.1's:

```
INVESTIGATE → REPRODUCE → ROOT CAUSE → FIX → REGRESSION → PERMANENT BARRIER → MUTATION-PROVE
  → RELEVANT/FULL TESTS → MERGE → DEPLOY/APPLY IF ROLE-AUTHORIZED → PRODUCTION VERIFY → REPORT
```

Finding a leak is not completion. Read Sentry first (§S, §G.6) and the `ops_incident` queue for
`owner_routine = 'routine-11-lifecycle'` immediately after (§G.6b), driving each row to a terminal
state with `incident_advance` / `incident_resolve` / `incident_handoff` / `incident_block` /
`incident_wont_fix`. Effort scales with what is found (§G.4). Never manufacture a 10/10 (§G.5).
Tokens are not the constraint (§G.11). Nothing here weakens any existing guard (§G.7).

### §5.2 The six reasons, and §G.2b

The only legitimate reasons to stop without fixing are §G.2's six: (a) destructive/high-risk needing
owner approval, (b) genuine product/source-truth/taxonomy ambiguity, (c) the fix would weaken a
safety gate, (d) another routine owns the surface, (e) a permission boundary, (f) an external
outage with no truthful fix. (d) and (e) are **routed**, never parked (§G.3).

**§G.2b applies here exactly as everywhere else:** *"a human could approve this"* is not a reason to
ask. A safe, in-scope, reversible fix that crosses none of the six gets fixed — revert-only,
failing-path-only, nothing irreversible for a real user is GREEN and this routine owns it. A run
that returns a safe provable fix as a question has failed §G.1.

### §5.3 The one carve-out this routine has, and its exact edges

**GREEN — the 30-day rule is already owner-approved policy, so executing it is not RED #4.**
`AGENT_AUTHORITY.md` RED #4 reads *"hard deletion **beyond the documented policy**"*; the documented
policy is `DELETION_SAFETY.md` plus `ARCHITECTURE.md` §14 (owner approval 2026-07-26 making
`scrapers/common/cleanup.py` the retention policy), and 30 days is `DEFAULT_POLICY`'s own
`min_inactive_days`. So running the sanctioned engine on an already-`enabled` platform, within its
own caps and gates, is GREEN for routine #11.

**Everything outside that is RED and stops for the owner:**

| Action | Why |
|---|---|
| Any deletion outside the approved rule — a different window, a different evidence bar, a one-off script | RED #4; `scripts/verify-no-unguarded-deleter.ts` also blocks it in CI |
| **Any bulk operation** — mass activate/inactivate, bulk field rewrite, a sweep over thousands of rows | RED #4, unbounded blast radius |
| Setting `platform_retention_policy.enabled = true` for a new platform, or changing any retention window | retention-policy change, RED #4 |
| Raising `anomaly_floor`, `max_eligible_frac`, `max_delete_per_run`, `MIN_ALIVE_RATE_FOR_TRUST`, a kill cap, or a coverage floor **to make a run go green** | RED #8, and `LISTING_LIVENESS.md` §7 forbids it explicitly: *a backlog that will not drain is evidence about the verifier, not permission to delete faster* |
| Draining the standing aqar/wasalt cleanup backlog (~4,921 / ~4,416 eligible, aborting on the anomaly breaker every run since 2026-08-22/23) | `DELETION_SAFETY.md` §6 — owner-decided, Senior Production owns the surface, and *"both platforms keep aborting on this backlog, deleting nothing"* is the **correct expected state**, not a defect to clear |
| Changing the eligibility predicate itself (§3.3) | changes deactivation/deletion semantics fleet-wide — §G.2(a), `incident_block(id, 'a', ...)` |
| Retiring or silencing any barrier or detector in §2.6 | RED #8 |

And the execution gates GREEN work still obeys, unchanged: the deploy lock (`ops_deploy_lock`,
identity `production`), `safe-deploy.sh` as the only frontend deploy path, the migration-mirror duty
(a migration applied to production owns its matching git file **in the same change**),
`scripts/safe-pr-merge.ts` as the only merge path — and that command **merges**, it is never a
readiness check.

---

## §6 — WHAT "CLOSED" MEANS (§G.9)

A lifecycle bug is not closed because the listing stopped showing up. All seven of §G.9's conditions
must be true and **the report must say so for each**:

1. **Root cause fixed** — name the mechanism, not the surface that displayed it. "The card rendered
   a dead listing" is a symptom; "the sync's delete leg aborted on the circuit breaker and nothing
   reported it" is a cause.
2. **Related variants checked** — the same mechanism hunted on every surface in §2.4. If results
   leaked, counts, Trending, pagination, the deep link and the AF path were all checked. If one
   platform leaked, its siblings were read.
3. **A permanent detector or barrier exists** — from §4, rostered in `mon_run_all_detectors` if it
   is a detector.
4. **A mutation proves the barrier can catch recurrence** — the defect was re-introduced, the
   barrier was watched to go red, then restored. Executable, not prose.
5. **The regression suite passes** — the full one.
6. **Production behaviour is verified** — through the real path a user hits, per
   `docs/ops/VERIFYING_PRODUCTION.md`. A green unit test is not production; a successful deploy is
   not verification; and for this routine specifically, **verify after a completed refresh+sync
   cycle**, because verifying immediately after a raw repair proves nothing.
7. **No equivalent hidden path remains** — the same shape under a different name, and say what was
   found, including "none".

If any of the seven cannot be met, the honest state is **UNKNOWN with the reason** — never "fixed".
`incident_resolve()` will refuse without a barrier and a production verification anyway; the CHECK
constraint holds against a raw `UPDATE` too.

**A passing check never resolves an incident.** "It stopped reproducing" is not "it is fixed with a
barrier" — and for this routine the distinction is sharp, because a leak that depends on sync timing
disappears on its own every hour.

---

## §7 — THE REPORT

Per §G.10, the report **opens** with BEFORE and **closes** with AFTER, then the mandatory block.

**BEFORE:** bugs found · broken behaviours · failed checks · affected listings/users/surfaces.
**AFTER:** bugs fixed · barriers added · mutations added · tests passed · production verification ·
remaining bugs · final score.

The `Rating Before → Rating After` pair required by "Reporting rules" in `ENGINEER_ROUTINES.md`
remains mandatory and is not replaced by `TRUE SCORE`.

### §7.1 Routine-specific lines (append before the mandatory block)

```
LISTINGS SOURCE-CONFIRMED INACTIVE THIS RUN:
REMOVED FROM ALL SURFACES (results · AF · Trending · counts · pagination · card):
STILL LEAKING (surface + count + which link of §2's chain):
DELETION-ELIGIBLE (30d source-confirmed, per platform):
DELETED THIS RUN (per platform, with cleanup_deletion_log row count):
RESTORED THIS RUN (with the source evidence that justified it):
UNKNOWN PROTECTED FROM THE CLOCK (count + what the source actually returned):
ORPHANS CLEANED (index/matview/attribute-view rows removed after a delete):
INCIDENTS WORKED / RESOLVED / HANDED OFF / BLOCKED:
```

`REMOVED FROM ALL SURFACES` is a claim about all nine links; if a surface was not checked, say so on
the `STILL LEAKING` line as *not checked*, never as clean. `UNKNOWN PROTECTED FROM THE CLOCK` is
this routine's most important number when it is non-zero and its most important number when it is
zero — a zero on a day the sources were degraded means the protection was not exercised, not that it
worked.

### §7.2 The mandatory final block, verbatim

Every report — all eleven routines, every run, clean or not — ENDS with exactly this block:

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
`UNKNOWN/UNVERIFIED` — **an empty one on a run that hit anything ambiguous is itself the defect.**
A truthful 8.7 with named gaps is worth more than a 10 nobody can check.

`SENTRY CHECKED` / `SENTRY CONNECTION WORKING` / `TRUE SCORE` / `10/10 ACHIEVED` from §G.8 are
appended after the block, per §G.8's "keep your richer domain block and append this one" rule.

---

## §8 — WHAT THIS FILE COULD NOT VERIFY (UNKNOWN, not invented)

Recorded so the next run does not rediscover them, and does not assume they were checked.

1. **`prune_inactive_from_search()` has no definition tracked in this repository.** It is *called*
   by `sync_search_listings_ar()` (migrations `20260716_batch2_search_truth`, `20260717_price_
   fidelity_guarantee`, `20260717_deal_truth_recovery`, `20260729194317`), its presence in the sync
   body is pinned by `20260824082414` and by `scripts/verify-sync-change-detection-canonical-
   labels.ts` — but no `create [or replace] function ... prune_inactive_from_search` exists anywhere
   in the tree. So the guaranteed remover of inactive rows from the served index is a
   production-only object. **UNKNOWN: its exact predicate, and whether it is guarded.** First action
   for a run that touches link §2.3: recover the definition from
   `supabase_migrations.schema_migrations.statements` / `pg_get_functiondef`, mirror it into
   `supabase/migrations/`, and only then write a barrier over it.
2. **None of routine #11's seven alert kinds has a detector.** `inactive_still_searchable`,
   `inactive_still_counted`, `false_resurrection`, `unknown_treated_as_dead`, `deletion_clock_*`,
   `orphan_after_delete` and `lifecycle_*` are routed by `scripts/lib/alertRouting.ts` and named in
   migration `20260905022312`'s header — but no `mon_raise()` anywhere in `supabase/migrations/`
   emits any of them. The queue is addressable and currently unfillable. §4 builds them.
3. **`unknown_treated_as_dead` is described as *"the alert kind that fires when it is broken"* in
   migration `20260905022312`. It does not fire today.** That is the single highest-value detector
   in §4 and the one whose absence most directly contradicts §0.
4. **`e2e/guardian/journeys.mjs` declares no `lifecycle` or `inactive_listing` surface.** Existing
   journeys cover `theme`, `chat_persistence`, `auth`, `navigation`, `result_card`,
   `loading_states`, `modal`, `search`. Whether a lifecycle journey belongs there — a deep link to a
   confirmed-dead listing must not render as a live card — is a real gap, not a decision this file
   makes. `scripts/verify-guardian-journeys.ts` governs the shape if one is added, and §6 of
   `AUTONOMOUS_INCIDENT_LOOP.md` governs the harness-failure rule: **a navigation timeout is
   `UNDETERMINED`, never a product incident** — which is §0 wearing a browser.
5. **Nothing in this file was executed against production.** Every name was verified to exist in the
   repository at `feat/loop-round-2`; no row counts, no live leak measurements, and no current
   backlog sizes are asserted here. The figures quoted from `DELETION_SAFETY.md` and
   `LISTING_LIVENESS.md` are those documents' own measurements at their own dates, not fresh ones.
6. **The five platforms activated 2026-09-03 (`therc`, `aouj`, `abralosol`, `arkaan`,
   `rawasidark`)** are in `active_listing_ids_v2` and in `liveness_policies.POLICIES` at tier 3, but
   their removal/liveness behaviour is recorded elsewhere as **not instance-proven**. Treat their
   lifecycle as UNKNOWN until this routine measures it; do not report them clean by inheritance.

---

## §9 — WHAT THIS ROUTINE DELIBERATELY DOES NOT DO

- It does not loosen a classifier, a cap, a floor or a threshold. Ever. A blocked destructive run
  has found a real problem (`§G.7`, `LISTING_LIVENESS.md` §7, `DELETION_SAFETY.md` §6).
- It does not delete on evidence that exists only in an aggregate. Per-row, durable, written before
  the delete, or it does not happen (`DELETION_SAFETY.md` §1).
- It does not treat an absent verification as a death. Absence of verification is UNKNOWN, and
  `mon_detect_liveness_verification_sla` says *the verification system is unhealthy*, never *the
  inventory is dead* (`LISTING_LIVENESS.md` §6).
- It does not re-audit whether a live listing's fields are right (#3), whether a crawl ran (#1),
  whether an AF predicate means what it claims (#5), or whether a barrier is honest (#10).
- It does not resolve an incident, a Sentry issue or an alert on a symptom disappearing.
