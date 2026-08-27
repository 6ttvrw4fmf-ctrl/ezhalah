# AF + Trending Data Integrity — run 2026-08-27

Routine #5 (🎯 Senior Advanced Filter + Trending Data Integrity Engineer). Spec:
`docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`.

```
CONTRACT READ:                YES  (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, a4e7d5b)
BUGS FOUND:                   2   (1 production P1 · 1 self-inflicted, caught pre-sweep)
BUGS FIXED:                   2
BARRIERS ADDED/STRENGTHENED:  2   (1 new live check · 1 detector extended)
MUTATION-PROVEN:              YES (3 on the live check · 2 nested on the detector)
DEPLOYED:                     NO  (no src/ change; none required one)
PRODUCTION VERIFIED:          YES
```

**ALL GOOD: YES**, with one contract-wording question opened for the owner (§4).

---

## 1. The defect: Trending Cities was dead for narrowed users

Set a property type, a bedroom count and a budget — the most ordinary state a buyer reaches — and
**Trending Cities rendered nothing at all.** Over the anon REST path a browser actually uses:

| state | before | after |
|---|---|---|
| Buy · villas · beds≥4 · price≤3M | **20,205 ms → `57014` statement timeout** | 406 ms |
| Buy · villas · beds≥4 | 442 ms | 401 ms |
| Buy · villas · price≤3M | 574 ms | 470 ms |
| Rent-Annual · apartments · beds≥2 · ≤60k | **12,047 ms** (survived, same cliff) | 408 ms |

Either predicate alone was fine; together the call died. `src/data/locations.ts` gates every widening
fallback on "is the user narrowed?" — correctly, since a widened count under an active filter is a
false count — so the city pool went to `'error'` and the field stayed empty. Honest, and dead.

### Root cause

```sql
), total as (select count(*)::int as t from cohort)
... from cohort co ... cross join total
```

`total` is referenced exactly once, so PG12+ **inlines** it and is free to re-run the aggregate per
output row. Whether it does depends entirely on the row estimate for `cohort`:

```
as postgres (service role): cohort est. 25 rows -> Aggregate loops=1     ->    179 ms
as anon      (RLS enabled): cohort est.  1 row  -> Aggregate loops=16708 -> 39,221 ms
```

16,708 × 16,708 CTE scans. **The plan difference is the whole bug** — and it is the lesson worth
keeping: every barrier we own runs as a privileged role, so every barrier saw the 179 ms plan.

`total AS MATERIALIZED` (migration `20260827113819`) evaluates the count once whatever the estimate.
Semantics proved untouched before applying — row-for-row `EXCEPT` both ways on three parameter sets
(narrowed 113 rows, Rent-Annual apartments, unfiltered 372 rows): **0 differences**.

## 2. The second bug — mine, caught before any sweep ran it

The first two versions of the extended detector did `set local role anon` inside
`mon_detect_search_performance_regression`, which is SECURITY DEFINER. That works when the function
is the *top-level* statement (how I first tested it) and fails with `42501` when called from another
function — which is exactly how `mon_run_all_detectors()` invokes it, inside the ONE transaction
pg_cron job 38 runs. **The next scheduled sweep would have errored, rolling back every alert it had
already raised and skipping `mon_dispatch_alerts`** — another instance of the currently-open
`detector_sweep_budget` / `detector_sweep_aborted` failure, caused while barriering something else.

It surfaced because the mutation proof ran the detector *nested*, in a DO block, rather than as a
bare `select`. Two harness rules worth carrying forward:

1. **Mutation-prove a detector the way the roster calls it**, not the way that is convenient to type.
2. `set local statement_timeout` inside a function **does not bound that function's own queries** —
   the timeout is per top-level statement. The 6 s bound claimed in `20260827113819` was fiction; the
   mutated probe ran 19,214 ms. `20260827114249` replaced it, and `20260827114417` removed the role
   switch entirely.

## 3. Barriers

**`scripts/verify-trending-usable-under-narrowing.ts`** (new) — live, anon, every 6 h in
`count-rpc-parity-live-check.yml`. Five narrowed states assert the call answers, answers within 5 s,
returns a city breakdown, **and that every advertised count equals its click-through**, so the class
cannot be "fixed" by making a wrong answer arrive quickly. It also asserts the shape of its own
corpus (≥4 size+budget states) — a corpus softened into single-predicate calls would sit green over
a dead surface. Mutation-proven: budget 5000→1 ms (5 fails) · corpus softened (guard fires) ·
click-through compared to the wrong city (10 fails) · restored green.

**`mon_detect_search_performance_regression`** (extended, not duplicated) — it already owned "a count
surface got slow" and stayed green through a 39-second call because it probed
`location_search_candidates_ar` only, never Trending, and probed privileged. It now also times the
narrowed Trending shape and pins `total AS MATERIALIZED` in the definition. Mutation-proven nested:
healthy 0, mutated 1 at P1 with `total_cte_materialized=false`.

The division of labour is deliberate: **a database detector cannot become the anon role without
endangering the sweep; a live check already is the anon role.**

## 4. Contract spot-audit

| rule | how audited | result |
|---|---|---|
| R1.4.1/R1.4.2 Buy+Rent union, independent budgets | live | combined 15,747 = buy 11,542 + rent 4,205; buy cap prices only the buy leg (9,075 = 4,870 + 4,205); both caps 8,130 = 4,870 + 3,260 |
| R1.5.1 Annual+Monthly union | live | كلاهما 4,205 = annual 4,177 + monthly 28 |
| R5.1 / R5.3 usefulness + option floor | real production counts through the REAL `meaningful()` / `optionNarrowsMeaningfully()` | 8/8 chips agreed; `driver_room` (4 < `MIN_REAL_OPTION_COUNT`) correctly dropped |
| R7.1.1 counts recompute against the narrowed set | live | after committing kitchen, `cnt_parking` 264 = search(kitchen+parking) 264 |
| R7.2.1 marginal chip counts | live | kitchen 4,654 · parking 320 · elevator 1,878 — chip = search RPC = independent PostgREST |
| R7.2.2 combined multi-select count | live | **see below** |
| R7.5 count = independent DB oracle | live | 15 city rows + 24 district rows exact |
| R4.4/R4.5, R8.1, R8.2, R11 | `af-live-truth-check` run 40 (9 browser journeys + 4 agent-flow CTA journeys) | SUCCESS |
| R2.5 unknown never passes | `verify-af-independent-oracle.ts` in `npm test` | green |

### One question for the owner (not acted on)

**R7.2.2** says a multi-select question's footer count "reflects the **union** of the ticked chips
within the question's domain." Production has **two** shapes, and both are right:

- **amenity chips INTERSECT** — kitchen+parking = 264 = the AND-oracle (264), *not* the OR-oracle
  (4,710). Each chip is its own boolean column, and this is what the routine spec's own standing rule
  requires ("multi-amenity must be AND, not OR").
- **value-domain chips UNION** — direction شمال+جنوب = 5,474 = the OR-oracle = the marginal sum. One
  column, disjoint values.

So the code is correct and the contract sentence is incomplete rather than wrong. Per §0.1 a contract
rule is not edited without owner authorisation, so **nothing was changed** — this is recorded as an
owner decision request: extend R7.2.2 to name both shapes.

R7.2 also has **no directly-corresponding barrier** in the §15 audit table. The live checks above now
cover its behaviour; a dedicated hermetic barrier is the natural next run's work.

## 5. Trending districts — exact

24/24 rows across 3 cities × 3 filter states (الرياض Buy/villas/beds≥4/≤3M · جدة Rent-Annual/
apartments/beds≥2/≤60k · الدمام Buy/villas/AF bathrooms≥3): advertised = click-through = independent
DB truth, including a `match_values` merge (حي الصفا, mv=2, 217).

## 6. AF data integrity — the tri-state half of alert 781

`af_field_stuck_no_variance` (P2, open since 2026-08-20) flags 4 platform×field×cohort pairs as 100%
one value. Measured over the **full** cohort rather than the alert's narrow segment, there is **no
UNKNOWN→false coercion anywhere in the four**:

| pair | true / false / unknown |
|---|---|
| sanadak · maid_room | 36 / 0 / **166** |
| wasalt · driver_room | 16 / 308 / **8,614** |
| satel · kitchen | 41 / **1** / 0 |
| satel · air_conditioner | 42 / 0 / 0 |

sanadak and wasalt preserve tri-state fully, so neither parser is asserting a constant; satel's single
`false` on kitchen proves that parser can emit false rather than defaulting. Only satel
`air_conditioner` (42 rows, no unknowns) still deserves a source look.

**The alert was deliberately NOT resolved** — its own `do_not` clause requires live source evidence to
waive, and this run did not fetch satel. Recorded in the ledger so the next run needs only that fetch.

## 7. Harness notes for the next run

1. **Anon REST works from this container** (`https://aannarbkwcymrotzwdbo.supabase.co/rest/v1/...`
   with the key from `scripts/safe-deploy.sh`), and it is the only path that reproduces a role-
   dependent plan. MCP `execute_sql` runs as `postgres` and will happily show you a healthy plan for
   a query that is timing out for every real user. **When measuring anything performance-shaped, use
   the anon path, or `set local role anon` from a top-level statement.**
2. **A district oracle must test BOTH orthographies.** `search_listings_ar.district_ar` stores
   `المهدية` (8,078 rows, unprefixed) *and* `حي الرمال` (4,217, prefixed). `norm_district_tok()` folds
   them inside the RPC; an oracle that strips the «حي» prefix unconditionally reports a false zero on
   every row stored with it — it read as 20 district mismatches here before I checked the column.
3. **`npm test` needs three python packages this image lacks**: `curl_cffi`, `python-dotenv`,
   `supabase` (install the last with `--ignore-installed PyJWT`, or it fails on the Debian-owned
   PyJWT). Without them the suite dies inside `verify-sanadak-rsc-object-match.ts` /
   `verify-abeea-identity-supersession.ts` and looks like a product failure.
4. **The browser half still belongs in CI.** `af-live-truth-check.yml` via `workflow_dispatch` runs
   the 9 AF journeys plus the 4 agent-flow CTA journeys against production in ~10 minutes; this
   container still cannot drive Chromium to the app reliably (see the 2026-08-26 notes).
