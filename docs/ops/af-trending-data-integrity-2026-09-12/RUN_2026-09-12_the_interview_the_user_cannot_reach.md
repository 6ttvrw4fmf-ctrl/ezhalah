# Run 2026-09-12 — the interview the user cannot reach, and the pipe that cannot deliver the fix

Routine #5 (🎯 Senior Advanced Filter + Trending Data Integrity Engineer).

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, 2517175)
CONTRACT RULES SPOT-AUDITED THIS RUN: R4.4.2, R13.10, R2.5.4 (probe failure / UNKNOWN)
CONTRACT/PRODUCTION CONFLICTS FOUND: 0 — the one live red is the contract's OWN UNKNOWN branch
                                     behaving as specified; the defect is upstream of the gates.
OWNER DECISIONS OPENED (contract-change requests): NONE
```

## 1. The headline: production cannot receive an AF fix right now

Production serves **b3a7ba2** (2026-09-11 17:42 PT). `main` is **14990bb**, five commits ahead.
Deploy run **402 failed in 90 seconds** — `scripts/safe-deploy.sh` was refused by the
migration-drift gate, which is RED on two migrations applied to production but not mirrored in git:

```
20260912073506  city_resolution_exempt_three_filter_only_objects        -> PR #2371
20260912110226  search_index_oracle_remirrored_to_the_live_sync…        -> PR #2380
```

Both repair PRs are open, byte-exact, single-purpose, and marked **NEEDS HUMAN MERGE** — AGENTS.md
forbids an autonomous run from self-merging a PR touching `supabase/migrations/`. The gate is
global and correctly fail-closed, so **every session's frontend deploy is blocked until a human
merges both.**

Two already-merged, already-proven fixes on MY surface are stuck behind it, both still live for
users today:

| commit | defect, as measured by its own author on production |
|---|---|
| `a801531` | 2nd «عرض المزيد» press on الرياض (37,532 matching) fires **50 RPC searches over 3.5 min, adds ZERO cards**, then errors. Match 101 of 37,532 is unreachable by any route, and each retry costs production another 50 searches. Also strands جدة (44,533). |
| `14990bb` | The cookie-consent card covers «بحث» on a phone — a first-time signed-out visitor's first tap on the app's primary control is eaten by the banner (`ops_incident` #152). |

This is not a defect I can fix. It is category **§G.2(a)** — the unblocking action is a merge
reserved to the owner. Escalated by push notification at the moment it was established.

## 2. The real AF finding: `ops_incident` #156 root-caused, with numbers

The AF live sweep (run 290) is RED on three steps, all mine. I re-ran
`verify-af-agent-cta-live.ts` from this container against production and **reproduced CI exactly**:

```
[diag] agent · Riyadh · Rent-Annual · apartments: after the round closed —
       CTA back=true, refine chips=false
SKIP   agent · Riyadh · Rent-Annual · apartments — probe-undetermined
```

That is the owner-locked UNKNOWN branch (`mayAssertNothingToNarrow(probeVerdict(…))`,
`src/lib/afProbe.ts`) working correctly: the round could not determine its option counts, so it
asserted **nothing** and restored «تحديد أكثر». R4.4.2/R13.10 is neither proved nor broken.

**The defect is upstream, and until today it had only ever been cited, never measured on the
cohort that actually fails.** `src/data/remote.ts:720` gives the probe a hard
`AGE_COUNT_TIMEOUT_MS = 4000`. Measured through the anon REST path the browser really uses, with
production **idle** (`ops_search_load_now`: `degraded=false`, mean 192.7 ms, 0.14 qps):

| scope | latency | vs. the 4,000 ms budget |
|---|---|---|
| الرياض / إيجار / سنوي / شقة | 2.48 · 2.67 · 2.80 · 3.09 s | fits, ~25% headroom |
| **الرياض / إيجار / سنوي (no type)** | **4.18 s** | **already over budget, at rest** |
| الرياض / شراء (no type) | 1.46 s | fits |
| unfiltered شراء | 1.01 s | fits |
| **unfiltered (no params)** | **18.70 s** | 4.7× the budget |

`EXPLAIN (ANALYZE, BUFFERS)` on the failing scope: Execution **2,622 ms**, shared hit 9,624,
Bitmap Heap Scan keeping 23,937 rows and removing 50,805, 9,235 heap blocks. The bitmap **index**
scans cost only 84 ms — the time is heap fetch (701 ms) plus the ~40 conditional `cnt_*`
aggregates. **There is no missing index. This is CPU-bound aggregation.**

**User impact.** On الرياض / إيجار سنوي with no property type narrowed, a user taps
«خلّنا نحدد الطلب أكثر», sees a loading flicker, and gets no question. The Advanced Filter
interview is unreachable on that cohort whenever the probe crosses 4 s — which it already does
with the database at rest, and which any load makes routine.

### Why I did not fix it in this run

Two candidate fixes, and both are outside what this routine may decide alone:

- **(a) Make `apartment_guided_counts_ar` faster.** It is a guarded AF count RPC — AGENTS.md
  requires changes to go through the shared clause + `rebuild_af_filter_rpcs()`, and its output
  *is* the count-equals-DB-truth contract this routine exists to defend. With no missing index,
  the fix is a restructuring (materialisation / narrower aggregate), not a one-liner. That is
  RED-list adjacent and not a safe unsupervised change.
- **(b) Re-size `AGE_COUNT_TIMEOUT_MS`.** A genuine product/UX decision — wait longer, or assert
  nothing — i.e. **§G.2(b)**. Raising a timeout to get past a slow query is also exactly the move
  this repo's harness notes forbid doing reflexively.

Recorded on `ops_incident` #156, advanced `open → reproduced`, with the full measurement set, the
plan, the local reproduction and both options, so whoever takes it starts from evidence rather
than from the ten-day-old citation of a different scope.

## 3. Closed this run

**`ops_incident` #153** — "the agent-tab rename «الوكيل الذكي»→«الوسيط الذكي» has sat
merged-but-unshipped since 2026-09-06". Verified in the **live DOM** on the served bundle
`entry-f2aa23d1…`: «الوسيط الذكي» present, «الوكيل الذكي» absent. The premise is no longer true.
Resolved against `scripts/verify-af-live-truth-gate-reads-shipped-not-conclusion.ts`.

## 4. What I deliberately did NOT do

**No migration was applied.** A backend fix would have reached users without a frontend deploy —
but every migration I applied would have to be mirrored by a PR only a human may merge, adding a
**third** blocker to a gate already holding two P1-class AF fixes hostage. Deferring `#127`'s DB
work was the cheaper of the two harms, and it is stated here rather than left implicit.

## Health (derived, `scripts/verify-af-contract-coverage-map.ts` — 142 rules graded, L 75 · B 55 · P 12 · N 0)

Nothing this run changed production, so every "after" equals its "before".

```
AF SYSTEM RATING: 9/10                     (judgement — the spec's UNKNOWN handling is exactly right)
ENGINEER PERFORMANCE RATING: 8/10          (judgement — root-caused and escalated; fixed nothing shippable)
ADVANCED FILTER HEALTH: 9.2/10 → 9.2/10
TRENDING CITIES HEALTH: 9.6/10 → 9.6/10
TRENDING DISTRICTS HEALTH: 9.6/10 → 9.6/10
AF DATA INTEGRITY: 9.4/10 → 9.4/10
OVERALL AF + TRENDING HEALTH: 9.3/10 → 9.3/10

NEW PRODUCT CONTRACT USED FOR RATING: YES
RULES LIVE-TESTED THIS RUN: 75/142
RULES BARRIER-PROTECTED: 55/142
RULES WITH INSUFFICIENT COVERAGE: 12/142

REAL BROWSER JOURNEYS: 3
AF JOURNEYS: 1        (verify-af-agent-cta-live, production, reproduced CI run 290)
TRENDING CITY JOURNEYS: 0
TRENDING DISTRICT JOURNEYS: 0
CITIES TESTED: 1 (الرياض)
REGIONS TESTED: 1
AF FIELDS TESTED: 0/— (no field matrix run this session; the CI matrix job passed at 10:17Z)
COUNT MISMATCHES: 0
STALE COUNTS: 0
INELIGIBLE RESULTS: 0
DUPLICATES: 0
UNKNOWN/FALSE VIOLATIONS: 0
BUGS FOUND: 1 root-caused (#156) + 1 systemic ship blocker
BUGS FIXED: 0
BUGS REMAINING: 8 open in queue (1 now reproduced, 1 resolved)
BARRIERS ADDED/STRENGTHENED: 0
MUTATION-PROVEN: N/A (no code change)
MERGED: NO
DEPLOYED: NO
PRODUCTION VERIFIED: YES (rename shipped; #156 reproduced; latency measured)
```

Trending was NOT exercised by this session — the CI Trending jobs passed at 09:12Z and 10:33Z, but
that is their evidence, not mine. Reported as not-covered rather than folded into a passing count
(PART 7: never fake green).

```
ALL GOOD: NO
```

Remaining blockers, with owner and §G category:

1. **Frontend deploys globally blocked** — merge PR #2371 and #2380. Owner: a human with merge
   rights. §G.2(a).
2. **`ops_incident` #156 / guided-count latency** — needs either a `rebuild_af_filter_rpcs()`-routed
   performance change or an owner ruling on the probe budget. §G.2(a)/(b).
