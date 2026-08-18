# Normal Filter — deep certification stress test

A **periodic** deep test, not the daily check. The daily Search & Matching QA routine
(`docs/ops/SEARCH_MATCH_QA_ENGINEER.md`, ~200 searches) stays the repeatable morning run; this one
is the certification pass to run **after any change to search/filter logic** or on a slower cadence.

First run: 2026-08-18 — **1,348 searches**, 34,917 unique listings, which found and fixed the
district-bridge leak (`supabase/migrations/20260818012640_district_bridge_ambiguity_guard.sql`).

## Why it exists: the harness must not be able to lie

The 2026-08-17 daily audit shipped two silent harness defects that made ~99 tests assert less than
their labels claimed:

* **C1** — the sweep read `p_types` from the wrong nesting level, so `p_types`/`p_tables`/`p_tables2`
  were `NULL` in every search. Tests labelled `شقة`/`فيلا` carried **no type filter at all**.
* **C2** — `p_beds_exact` was sent as a scalar; production sends an **array**. All 7 bedroom tests
  errored instead of testing anything.

`contract.py` makes both structurally impossible: a spec **cannot be executed** unless every filter
it claims is provably present in the outgoing request, in production's shape. `assert_contract()`
raises *before* the network call. It is validated against the LIVE captured UI params, so it also
caught a wrong assumption of my own (19 of 26 types are `kinds: BOTH` and send one merged 62-table
scope with **no** scope B; only 7 use the 31+31 two-scope form).

## Pipeline

```
profile.py    # anon-REST profile of the live inventory per نوع × deal:
              # cities, districts, price/area percentiles, bedroom availability
matrix.py     # generates specs.json — depth scaled by inventory, so a 15-row type
              # does not get 26 near-identical searches (diminishing returns)
run_stress.py # executes + adjudicates EVERY returned row against EVERY requested predicate
ui_stress.py  # browser layer: parity, «عرض المزيد», card fields, click-through,
              # stale-state on نوع/فئة switching. `python3 ui_stress.py mobile` for 390px
report.py     # coverage matrix (نوع × dimension) + headline counts
```

## Validation split (deliberate)

* **city / district / price / area / bedrooms** — validated for *all* returned rows straight from the
  RPC payload (it returns those columns), so it costs zero extra requests.
* **deal / period / type** — need the index row, so a bounded sample per search is re-read through
  the **anon** role (user truth, RLS-respecting).

## Failure taxonomy — never merged

| class | meaning |
|---|---|
| `PRODUCT_FAIL` | Ezhalah returned a row that does not satisfy the user's request |
| `HARNESS` | the test code/spec was wrong (contract rejects it before it runs) |
| `INFRA` | network/timeout/5xx from a concurrent session; retried once, then recorded |
| `VARIANT` | source-published Arabic spelling of the SAME canonical city — **not** a defect |

## Load discipline

Read-only. ~1 RPC + ~1 REST per search, `p_limit=200`, index sample 80, pauses out of the
`:00/:15/:20` cron slots, checkpoints every 100 searches. A full 1,348-search run is ~55 minutes.

## Notes

* Two things are **expected**, not defects: `production_ready=false` rows are admitted when the
  search carries **no** location filter (see the RPC's own `WHERE`), and a card shows the **region**
  when a listing has no حي.
* Chromium here needs `--ssl-version-max=tls1.2` — the session egress proxy resets TLS 1.3.
