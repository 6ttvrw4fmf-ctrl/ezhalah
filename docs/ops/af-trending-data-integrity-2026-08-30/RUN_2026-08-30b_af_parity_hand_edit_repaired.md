# AF template repair — `af_parity_hand_edit` P1 closed (2026-08-30, second pass)

Routine #5 (🎯 Senior AF + Trending Data Integrity). Continuation of
`RUN_2026-08-30_rebuild-is-an-outage-and-two-coverage-gaps-closed.md`, which found this defect and
routed it because the Supabase connector's token had expired mid-run. The connector came back; the
blocker was permissions, so the routing dissolved and this routine finished the job itself.

```
AF TEMPLATE REPAIRED:       YES  (migration 20260830134244)
REBUILD SAFE:               YES  (proven byte-exact BEFORE applying, re-proven after)
P_ROTATION_SEED PRESERVED:  YES
SEARCH HEALTHY AFTER APPLY: YES  (SQL + anon REST, no PGRST202/PGRST203)
P1 RESOLVED:                YES  (2026-08-30 13:43:00, by the detector clearing — not by hand)
```

## 1. What was wrong

`af_rpc_templates` still described the **pre-2026-08-29, 41-argument** `location_search_candidates_ar`.
Three migrations that day (172402 ranking + `p_rotation_seed`, 172433 the emergency overload drop,
172838 the fold into the diversity partition ORDER BY) had redefined the function directly, without
touching the template, the builder, or the build state.

So `rebuild_af_filter_rpcs()` — the sanctioned repair for the alert the drift raised — would have
dropped every overload and recreated the **old** function: reverting the owner's PERMANENT
controlled-rotation rule, and dropping `p_rotation_seed` from the signature. PostgREST matches
named-parameter calls exactly and every live search sends that parameter, so every search would have
returned "function not found."

## 2. The repair, and why it could not have gone wrong

The new template is the **current live definition** with the single `af_eligibility_clause()`
occurrence swapped back out for `__AF_ELIGIBILITY_WHERE__` — the same *templates-from-live-defs*
construction `20260811130146` used to seed the table originally.

Measured **before** applying anything:

| property | value |
|---|---|
| clause occurrences in the live definition | **1** (a blind replace is therefore safe) |
| placeholders in the old template | 1 |
| placeholder already present in live text | 0 |
| `replace(new_template, placeholder, clause) = pg_get_functiondef()` | **true, byte for byte** |
| round-trip md5 vs live md5 | `aac854f1f4483863b142cb6cda9c1ae5` = `aac854f1f4483863b142cb6cda9c1ae5` |
| new template carries `p_rotation_seed` / `has_photo` | yes / yes |

Because the expanded template is byte-identical to what production was already running, the rebuild
was a no-op **by construction**, not by hope.

The migration then enforces that anyway. It asserts every precondition, snapshots the md5 of all four
AF RPCs, updates the template, rebuilds, and re-checks: if any md5 moved, or if build state still
disagreed with live, it raises. DDL is transactional in Postgres, so the template update and the
rebuild alike roll back together. **The migration could only fully succeed as a no-op or change
nothing at all.** The deploy lock (`production`) was held for the window and released after.

## 3. Verification

**Definitions** — combined md5 of all four AF RPCs identical before and after
(`80e095b9a78cc32c816a4c8937f55e47`); `location_search_candidates_ar` live md5 == build-state md5 ==
`aac854f1f448…`; exactly 1 overload; `build_state_mismatches = 0`.

**Behaviour** — 6/6 probes identical in total **and** in row order:

| probe | total | order |
|---|---|---|
| no seed | 10,318 | identical |
| `p_rotation_seed='probe-seed-A'` | 10,318 | identical |
| `p_rotation_seed='probe-seed-B'` | 10,318 | identical |
| `p_sort_by='price_asc'` | 10,318 | identical |
| `p_sort_by='area_desc'` | 10,318 | identical |
| Buy/villa/جدة + seed | 3,716 | identical |

The three rotation variants produce three *different* orders at the same total, which is what proves
rotation is genuinely live rather than inert — a baseline that could actually have caught a
regression.

**Eligibility** — 5/5 `af_eligible_count` probes unchanged: 24,018 · 3,472 · 371 · 23,058 · 11,770.

**PostgREST / user truth** (anon key, the path MCP SQL bypasses) — all HTTP 200:
`location_search_candidates_ar` **with** and **without** `p_rotation_seed` (no PGRST202), with an
explicit sort, plus `apartment_guided_counts_ar`, `property_age_option_counts_ar` and
`top_cities_by_deal_ar` (144 rows).

**The alert** — `mon_af_predicate_parity()` returned **0** and `af_parity_hand_edit` resolved at
2026-08-30 13:43:00 via `mon_resolve_key`. It closed because the condition cleared, not because
anything was closed by hand.

## 4. The guard was strengthened, not weakened

`scripts/verify-af-rpcs-not-hand-edited.ts` keeps every assertion it shipped with this morning, and
gains **§5**: a divergence claiming to be reconciled must name a migration that **exists in this
repo** and that **itself went through the template path**. "This was repaired" is now a checkable
claim rather than a comment anyone can write.

Two things were corrected rather than relaxed:

- The allowlist is a **permanent historical record**, not a to-do list. A hand edit is a fact about
  history — the file offends forever, because remediation lands in a *later* migration. Deleting an
  entry would turn §1 red. What changes on repair is `reconciledBy`, which §5 then verifies. The
  earlier "delete the line when fixed" instruction was wrong and is gone.
- The standing-divergence banner no longer says *do not run the rebuild*. That was true this morning
  and is false now, and leaving it would deter a legitimate, proven-safe operation. It now reports
  per-entry reconciliation state and keeps the reusable rule: **never assume the template matches
  live — check, fold in first, prove the round trip, then rebuild inside a transaction that asserts
  the md5s did not move.**

Mutation-proven **9 ways** (7 original + 2 new), each red then green, including one proving the
sanctioned template+rebuild path stays *allowed*.

## 5. Not mine, observed in passing

`verify-migration-drift-vs-production` reports **3** migrations applied to production but missing
from git — `20260830071705` (deleted_but_source_live adjudication), `20260830105044` and
`20260830134700` (p0_delivery_sla / p0 fast lane). They belong to 🛡️ Data Integrity and 🧵 Systems
Seam; PRs #1341/#1342 appear to cover part of it. This run's own migration mirrors faithfully and is
**not** among them.
