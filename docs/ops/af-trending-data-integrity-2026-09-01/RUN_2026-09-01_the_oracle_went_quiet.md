# The oracle went quiet, and quiet read as fine (2026-09-01)

Routine #5 (🎯 Senior AF + Trending Data Integrity). PR
[#1464](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/1464), merged `f23f7fa`.

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, 0be0a1d)
```

## 1. What this run found

Advanced Filter was returning correct results the whole time. What had broken was our ability to
**prove** it — and that failure was invisible in exactly the way this repo has been burned by before.

`p_rotation_seed` shipped in PR #1361 (2026-08-30) and rides **every** search request.
`scripts/lib/afOracleFilter.ts` had no `case` for it, so it hit the fail-closed `default:` arm and
reported UNHANDLED. `buildOracleQS` refuses to produce a count when anything is unhandled, so every
AF journey lost its independent verdict at once.

`verify-af-live-truth.ts` and its workflow went red at **2026-08-30T18:33Z and stayed red**. For
three days, AF's deepest correctness check — RPC total vs independent DB truth, with exact
`(source_table, listing_id)` set diffs — produced **no verdict at all**.

**The oracle did not lie. It went quiet.** That is the same shape as the nine dark detectors in
`AGENTS.md`: a check that cannot reach a verdict reads, from a distance, exactly like one that
passed. A red scheduled live check caused by a translator gap is indistinguishable from a red one
caused by a real regression, which is why three days passed — including yesterday's run of this very
routine, which reported "live production journeys — all green" from hand-rolled anon-REST checks
while the certified suite sat red.

## 2. Root cause, established from production rather than from a comment

`p_rotation_seed` is genuinely ordering-only. Outside the signature it occurs exactly twice in
`location_search_candidates_ar`, both inside:

```sql
case when coalesce(p_sort_by,'') not in (...) and p_rotation_seed is not null
     then hashtext(m.source_table || ':' || m.listing_id::text || ':' || p_rotation_seed)
end as rot_key
```

A projected ORDER BY key. In no WHERE clause; cannot move `total_count`. Read from
`pg_get_functiondef` on production — deliberately *not* from the client-side comment in
`src/lib/rotationSeed.ts`, which asserts the same thing but is not evidence about the server.

## 3. The class was much wider than the example

Probing the translator directly showed **15 more** unclassified parameters: `p_price_min/max`,
`p_price_min_rent/max_rent`, `p_area_min/max`, `p_beds_exact/min`, `p_bath_exact`,
`p_floor_min/max`, `p_age_unknown`, `p_is_new_construction`, `p_tenant`, `p_has_license`.

So the oracle could never certify a **narrowed** search — the journeys AF exists for. That is why
the coverage ledger's stacked-state proofs had to be hand-rolled in SQL: the oracle refused them.

Every translation was taken verbatim from `af_eligibility_clause()`, including the parts that are
easy to get wrong:

| clause | semantics |
|---|---|
| L58-61 | exact wins over min for beds/baths; `min` applies **only** when exact is empty |
| L62-79 | `nullif(x,0)` — a 0 budget is "unset", not a real bound |
| L78/79 | a **MONTHLY** budget is compared against the **ANNUAL** column, scaled ×12 |
| L84/85 | `age_unknown` / `new_construction` as equality against a tri-state age |
| L88 | licence as `(license_number is not null) = p_has_license` |

**Differential against production: 27/27 exact**, across Riyadh / Jeddah / Dammam, buy and rent,
single and stacked.

Genuine unions stay **refusals**, never approximations — `p_beds_exact` + `p_beds_min` together,
and a budget under a combined Buy+Rent search. A wrong translation makes the oracle agree with a
wrong RPC, which is strictly worse than refusing.

## 4. A third gap, found by driving Trending as a user

Production does **not** match districts literally. The clause matches
`norm_district_tok(district_ar)` against a normalised, alias-expanded token set. The oracle's plain
`district_ar=in.(…)` agrees only when every requested name is stored verbatim.

Measured on a live Trending click-through: the request carried «حي المهدية», the index stores
«المهدية», and the oracle returned **0 against the RPC's 1,796** — a false differential on a
perfectly healthy search.

The normalisation cannot be expressed through PostgREST (no normalised column exists), and
re-implementing `norm_district_tok` would make the "independent" oracle depend on a guess about our
own SQL — the one thing it must never do. So `p_districts` now takes the route `p_category` already
takes: read the **reference data** (the `district_ar` values actually in the index) and refuse when
a requested name is not among them, rather than silently emitting a filter that undercounts.

Cost: two of this run's journeys are now honestly reported as UNVERIFIED rather than counted. That
is the correct trade — a refusal replaced a false 0-vs-1,796.

## 5. Barriers

**New — `scripts/verify-af-oracle-classifies-every-search-param.ts`** (offline, in `npm test` by
discovery). Every `p_*` the app can put on a search request must carry an explicit `case`. The PR
that adds a parameter turns red, instead of a live workflow going quiet three days later. It also
pins the `default: unhandled` arm, so a future "fix" cannot be to ignore unknown params. Extraction
is scoped to the four regions that literally build the search body, so the other RPCs' params in
`remote.ts` (`p_intents`, `p_listing_ids`, `p_source_tables`) cannot raise a false failure.

**Mutation-proven 4/4**, baseline restores green:

| mutation | result |
|---|---|
| drop the `p_rotation_seed` case (the exact 3-day outage) | red |
| add a new unclassified param at the call site | red |
| add one inside `rpcFilterParams` (not the call site) | red |
| make `default:` silently skip unknown params | red |

**New — `scripts/verify-trending-live-four-way-truth.ts`** (live browser; wired into
`af-live-truth-check.yml` with its exclusion line). The existing Trending barriers stop one link
short of the user: one reads `remote.ts` to prove the params are threaded, the others compare RPC
against RPC. None read the number a human actually **sees** in a row and carry it through the click
into a search and on to an independent count. This one does, and the last link only became
checkable today.

**Strengthened — `scripts/verify-af-oracle-filter-translator.ts`**: 10 hermetic checks + 4 mutation
guards for the new translations. One pre-existing check named `p_price_min` as its example of an
"unverified param"; since price is now translated and production-proven, the example moved to
`p_rent_period='كلاهما'` and a third check asserts price specifically no longer reports unhandled.
The expectation moved because the code got more capable — never to accommodate a weaker translator.

## 6. A barrier caught this run's own author

`verify-af-oracle-soundness.ts` failed the first version of the district fix: the new reference
fetch paged with `Range` and no `order=`, which can drop or repeat rows across page boundaries —
here that would have yielded an incomplete district set, and every missing name would have become a
spurious refusal. Both callers now page on the total order `(source_table, listing_id)`.

Worth recording plainly: the barrier did its job on the person adding a barrier.

## 7. Live production journeys

`verify-af-live-truth.ts` — **green for the first time since 2026-08-30**. All 9 journeys report
MISSING / EXTRA / DUPLICATE = 0 against the independent oracle, including mobile, Jeddah
(non-Riyadh), the zero-result case, SKIP and BACK/change-answer.

`verify-trending-live-four-way-truth.ts` — 45 checks, 0 failures, stable across consecutive runs.
PART 3's permanent rule (a district's advertised count IS the count after clicking it) holds in
**4/4** journeys:

| journey | district | advertised | after click | oracle |
|---|---|---|---|---|
| Riyadh · Buy · Apartment | حي الرمال | 562 | 562 | 562 |
| Jeddah · Buy · Villa, ≤3M | حي الرحمانية | 447 | 447 | 447 |
| Riyadh · Buy · Apartment, ≤900k + area≥120 | حي المهدية | 1,796 | 1,796 | declined (§4) |
| **Mobile 390×844** · Dammam · Buy · Apartment | حي الشعلة | 974 | 974 | 974 |

City rows matched the Trending RPC's own `listing_count` 6/6 in every journey. The narrowing was
typed into the **real** controls (`price-max-input`, `area-min-input`) and the trending call itself
was asserted to carry `p_price_max=900000` and `p_area_min=120` — so what is proved is inheritance
of a state the *user* set, not one poked into a request.

**One harness lesson for the next run:** reading district rows BEFORE choosing the property type
compares two different questions and reports a false mismatch. The first draft did exactly that and
"found" four district discrepancies that were entirely its own. Narrow first, then read the rows.

## 8. Ratings

Derived from `verify-af-contract-coverage-map.ts` — no number typed that the tool did not print.

```
AF        8.9 → 8.9
TRENDING  9.3 → 9.6
INTEGRITY 9.4 → 9.4
OVERALL   9.0 → 9.0
```

Two rules moved B → L, both directly evidenced above: **R14.3.2** (advertised district count is the
count after clicking) and **R14.4.1** (every count surface spreads the one narrowing definition).
Nothing else was re-graded.

**An honesty note on the "before" number.** 9.0 was flattering. Several rules were graded on live
barriers that *ran* but had been *failing* for three days, and the coverage map's own guard checks
only that a cited barrier executes — not that it is passing. A grade can therefore rest on a live
proof that has been absent for days. That is the same "dark check reads as clean" class this run is
about, one level up, and it is recorded here as a known gap in the rating methodology rather than
quietly fixed, because closing it needs the map (offline, deterministic) to learn something about CI
state.

## 9. Not fixed, deliberately — with the category and the owner

- **`migration_drift` P1** (open since 2026-08-31 16:42). 7 versions applied to production with no
  git file, all P0-lane / alert-lifecycle work, **none from this routine**. ROUTED to the
  systems-seam / monitoring routine that applied them.
  The recovery method is proven, not theoretical: base64 the statements out of
  `supabase_migrations.schema_migrations`, decode to
  `supabase/migrations/<version>_<name>.sql`, and require the file's md5 to equal
  `md5(array_to_string(statements, E'\n'))`. Validated end to end on `20260831193255`
  (md5 `032d21cf…` matched) — **and then deliberately reverted**.
  Why not mirrored here: `20260901104521` was applied at 10:45Z, i.e. by the owning routine's own
  10:30Z run, which was still live. If that session commits these under its own filenames after I
  commit them under mine, the result is drift condition 3 (duplicate migration versions) — a *new*
  red guard caused by helping. Category (d), other routine owns the surface. Recorded durably in the
  coverage ledger (`af_routing / migration_drift_handoff_2026-09-01`), not only in this prose.

- **`af_field_stuck_no_variance` P2** (satel `air_conditioner`, sanadak `maid_room`) and
  **`age_resolver_platform_gap` P2** (eastabha, erapulse). Both need a LIVE SOURCE READ to
  adjudicate. All four hosts are egress-blocked from this container (`eastabha.com`,
  `www.eastabha.com`, `erapulse.com`, `satel.sa` — all HTTP 000, probed this run). `AGENTS.md`
  permanent rule #2 forbids treating a failed fetch as evidence the source omits a field, so neither
  can be closed from here. Categories (b) source-truth ambiguity and (f) external dependency.

## 10. Report block

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, 0be0a1d)
CONTRACT RULES SPOT-AUDITED THIS RUN: R14.1.1-R14.1.3, R14.2.1-R14.2.4, R14.3.1-R14.3.2, R14.4.1-R14.4.2
CONTRACT/PRODUCTION CONFLICTS FOUND: 0
OWNER DECISIONS OPENED (contract-change requests): NONE

AF SYSTEM RATING: 9/10 (judgement)
ENGINEER PERFORMANCE RATING: 8/10 (judgement — the 3-day dark oracle should have been
  caught by yesterday's run of this same routine, which read its own hand-rolled checks
  as production truth instead of running the certified suite)
ADVANCED FILTER HEALTH: 8.9 → 8.9
TRENDING CITIES HEALTH: 9.3 → 9.6
TRENDING DISTRICTS HEALTH: 9.3 → 9.6
AF DATA INTEGRITY: 9.4 → 9.4
OVERALL AF + TRENDING HEALTH: 9.0 → 9.0

NEW PRODUCT CONTRACT USED FOR RATING: YES
RULES LIVE-TESTED THIS RUN: 58/135 (grade L)
RULES BARRIER-PROTECTED: 59/135 (grade B)
RULES WITH INSUFFICIENT COVERAGE: 18/135 (grades P + N)

REAL BROWSER JOURNEYS: 13   (9 AF + 4 Trending)
AF JOURNEYS: 9
TRENDING CITY JOURNEYS: 4
TRENDING DISTRICT JOURNEYS: 4
CITIES TESTED: 3 (الرياض · جدة · الدمام)
REGIONS TESTED: 3
INTENT→UI MISMATCHES: 0
UI→REQUEST MISMATCHES: 0
REQUEST→RPC MISMATCHES: 0
RPC→DB MISMATCHES: 0
COUNT MISMATCHES: 0
STALE COUNTS: 0
INELIGIBLE RESULTS: 0
DUPLICATES: 0
UNKNOWN/FALSE VIOLATIONS: 0

BUGS FOUND: 3
BUGS FIXED: 3
BUGS REMAINING: 0 (in this routine's surface)
BARRIERS ADDED: 2 new, 2 strengthened
MUTATIONS KILLED: 8/8
TESTS: PASS (npm test 278/278)
MERGED: YES (PR #1464, f23f7fa)
DEPLOYED/APPLIED: N/A — scripts-only, no src/ change; a deploy would have been a
  deploy-to-test-the-pipeline, which the rules forbid. Deployments: 0.
PRODUCTION VERIFIED: YES — verify-af-live-truth.ts re-run green from MERGED main (f23f7fa)
  against ezhalah-app.vercel.app. verify-trending-live-four-way-truth.ts: 45/45 green twice
  pre-merge on byte-identical code (the merge fast-forwarded these same commits); its
  post-merge re-run and the dispatched af-live-truth-check.yml run on f23f7fa were still
  executing when this report was written, and are NOT counted as evidence here.
SENTRY CHECKED: YES
SENTRY CONNECTION WORKING: YES (real read; 0 unresolved in react-native, 5 resolved E2E probes visible)
SENTRY ISSUES CLAIMED THIS RUN: 0
SENTRY ISSUES RESOLVED THIS RUN: 0
OPEN P0/P1 IN SCOPE: 0
TRUE SCORE: 9.0/10
10/10 ACHIEVED: NO

ALL GOOD: NO
```

Remaining blockers, all genuine and none of them defects this run chose to skip:

1. `migration_drift` P1 — category (d), owned by the systems-seam / monitoring routine. Routed with
   reproduction, the proven recovery method, and the reason mirroring it here would make things
   worse.
2. `af_field_stuck_no_variance` P2 and `age_resolver_platform_gap` P2 — categories (b) and (f).
   Adjudication requires a live source read; all four hosts are egress-blocked from this container.
3. The rating-methodology gap in §8 — a grade may cite a live barrier that runs but has been failing
   for days. Recorded, not fixed; closing it needs the offline map to learn CI state.
