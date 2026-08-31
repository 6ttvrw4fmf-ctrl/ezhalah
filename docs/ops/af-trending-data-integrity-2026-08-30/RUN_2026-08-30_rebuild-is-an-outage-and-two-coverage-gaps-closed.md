# AF + Trending Data Integrity — run 2026-08-30

Routine #5 (🎯 Senior Advanced Filter + Trending Data Integrity Engineer). Spec:
`docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`.

```
CONTRACT READ:                YES  (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, 0be0a1d)
BUGS FOUND:                   1   (P1 — the sanctioned repair for an open alert is an outage trigger)
BUGS FIXED:                   0   (blocked: needs DB write; connector token expired mid-run — §2.4)
BARRIERS ADDED:               3   (all new, none duplicating an existing one)
MUTATIONS KILLED:             18/18
TESTS:                        PASS (`npm test`, `tsc --noEmit`)
PRODUCTION VERIFIED:          YES (live browser journeys, desktop + mobile, 3 cities)
```

**ALL GOOD: NO** — one P1 remains open with a named owner (§2).

---

## 1. What the run found healthy (measured, not assumed)

Everything below is `INTENT = UI = REQUEST = RPC = DB TRUTH = RESULTS` checked end to end on
`https://ezhalah-app.vercel.app`, bundle `entry-4f7022b1fdacc49ea0904560b82a91fe.js`.

| surface | measurement |
|---|---|
| Trending city → click-through → DB | الخبر advertised **508** = landed **508** = SQL truth **508** |
| Buy+Rent combined, independent budgets | both `p_price_min/max` **and** `p_price_min_rent/max_rent` carried into Trending; الرياض **8,224** advertised = landed = per-subgroup DB oracle |
| Trending districts under full narrowing | 6/6 exact (136 / 127 / 23 / 103 / 1), «حي الحمرا» counted over its `match_values` pair |
| honest zero | «حي الثقبة» rendered «لا توجد إعلانات هنا حالياً» — no false fallback count |
| district rows beyond the first N | typed Riyadh list fired **36** live per-row RPCs; every rendered row got a true count |
| AF unknown arithmetic | Jeddah 1141+165+470+265+386 + 2 unknown = **2,429** exactly; Dammam 810+155+245+180+218 + 21 = **1,629** exactly |
| single tap / متابعة / رجوع | tap selects only (5,860→2,429, question stays); متابعة advances one and sends `p_amenities:["rnpl"]`; رجوع restores Q1 with the answer still committed |
| تخطي (mobile, non-Riyadh) | count unchanged at 1,629, advanced exactly one question — no predicate applied |
| AF predicates vs an independent implementation | `verify-af-independent-oracle` green on live production, 8 cohorts, unknown never leaked |

**Last run's open §3 defect is FIXED and production-verified.** «في الرياض» → the twin question asked
**once** → «مدينة الرياض» → `p_cities = ["الرياض"]`, 10,318. No re-ask, no 20-city region fan-out.
«الرياض كاملة» → `p_cities = ["الرياض"]` with no clarification at all (the owner's 2026-08-29 rule).
The plain-city fix holds too: «المدينة كاملة» → جدة 5,860 / الدمام 1,629, no Madinah fan-out.

One thing that looked like a defect and is not, recorded so the next run does not re-chase it: the
per-type fan-out sends `p_types:["غرفة"]` **without** `p_beds_exact`, so the sum of the per-type
calls (8,282) exceeds the headline (8,224) by exactly the 58 Room rows. That is correct — selecting
غرفة alone really does return 58, because `isRoomOnlySelection` drops a bedroom chip the user never
chose (`src/lib/roomBedrooms.ts`). The headline applies beds=3 uniformly because the user's selection
is multi-type, which is what that same rule says must happen. Count and click-through agree.

## 2. THE DEFECT — the repair for an open P1 would take production down

`alert_event af_parity_hand_edit` (P1, `af_parity_empirical` dedup key) has been open since
**2026-08-29 17:43**, still affirmed 2026-08-30 10:43. `mon_af_predicate_parity()` check B:
`location_search_candidates_ar` live `aac854f1f448` vs built `f4336f1d8058`. The other three AF RPCs
match their `af_rpc_build_state` md5 exactly, and checks C and D (parameter surface, empirical
count/results/referee parity on 4 probes) both pass — so **no user is seeing a wrong number today**.

### 2.1 Root cause

Three migrations on 2026-08-29 redefined `location_search_candidates_ar` **directly** instead of
going through `af_rpc_templates` + `rebuild_af_filter_rpcs()`. None of the three mentions
`af_rpc_templates`, `rebuild_af_filter_rpcs` or `af_rpc_build_state`:

| migration | what it did |
|---|---|
| `20260829172402_ranking_photo_preference_and_rotation_order_by` | added `p_rotation_seed` + photo-preference ORDER BY. **Its committed file is prose only** — the DDL reached production but was never mirrored into git |
| `20260829172433_drop_old_location_search_candidates_ar_overload` | emergency drop of the stale 41-arg overload |
| `20260829172838_..._fold_into_diversity_partition_order` | the CREATE OR REPLACE production runs today |

That sequence already caused a real incident inside 30 seconds on the day: `CREATE OR REPLACE` with a
**new trailing parameter** is not a replacement — Postgres made it a second overload, and every
caller omitting `p_rotation_seed` PGRST203-ed until 172433 dropped the old signature.

### 2.2 Why the obvious repair is an outage

`af_rpc_templates` was never updated, so it still describes the **pre-2026-08-29, 41-argument**
function — `p_rotation_seed` appears nowhere in the migration that seeded the templates, and nothing
has touched them since (build state still stamped 2026-08-20 19:49). `rebuild_af_filter_rpcs()`
**drops every overload first**, then re-creates from that template. Running it today would:

1. silently **revert the owner's PERMANENT controlled-rotation rule** (2026-08-29, tier 4) and the
   photo-preference ranking folded in beside it; and
2. **drop `p_rotation_seed` from the signature.** Every search the app sends carries it (observed on
   every journey today), and PostgREST resolves named-parameter RPC calls by exact parameter-name
   match — so **every search on production would return "function not found."** The mirror image of
   the incident those same migrations caused on 2026-08-29.

### 2.3 The correct repair (for whoever holds DB write access)

Fold the ranking change **into `af_rpc_templates`** first, then rebuild, then prove the rebuild was a
no-op: the resulting `md5(pg_get_functiondef(...))` must still equal the live `aac854f1f4483863b142cb6cda9c1ae5`.
If it does not match, the port is wrong — revert the template and stop. Do not rebuild blind.

### 2.4 Why this run did not fix it

The Supabase MCP connector's token expired mid-investigation and cannot be re-authorised from a
non-interactive session, so the template could not be read or written. This is stop-reason **(e)**, a
role/permission boundary — routed here with full reproduction and root cause rather than left as
"someone should look at this". **Owner: 🎖️ Senior Production Engineer** (write-authorised, and the
2026-08-29 ranking work is its surface). Everything needed is above; nothing needs re-deriving.

### 2.5 What this run DID fix: the bug class, at PR time

The rail — "never hand-edit the 4 AF shared-eligibility RPCs, go through the shared clause +
`rebuild_af_filter_rpcs()`" — is stated in `AGENTS.md` **and** in this routine's own spec, and on
2026-08-30 `grep -rl rebuild_af_filter_rpcs scripts/` returned **nothing**. A P0-class rail whose only
enforcement fires 15 minutes *after* the migration is already live is a rail that gets crossed, and it
was, three times in 36 minutes.

`scripts/verify-af-rpcs-not-hand-edited.ts` now blocks it before it lands: any migration at or after
the template era that redefines or drops one of the four must also update `af_rpc_templates` **and**
call `rebuild_af_filter_rpcs()`. The two currently-visible divergences are recorded in a dated,
reasoned allowlist that cannot grow silently, cannot rot into cover for a file that was since fixed,
and prints the do-not-rebuild warning on every run. CI stays green — the standing divergence is
recorded, not hidden, and no unrelated PR is blocked by a defect no PR can fix.

## 3. The two coverage gaps the last run scoped — both built

`verify-af-contract-coverage-map` reported `L 46 · B 69 · P 18 · N 2`. **No rule is ungraded now:
`L 46 · B 71 · P 18 · N 0`.**

**R2.1.2 — "No question ships without a ledger entry."** Enforced by nothing; the map's only weight-3
N. `scripts/verify-af-cohort-questions-certified.ts` proves every cohort in `COHORT_QUESTIONS` that
ships a non-empty question list holds an **enabled** `af_cohort_registry` row, read offline from the
new byte-exact `sql/mirrors/af_cohort_registry.sql` (59 rows, md5 `e24bc3e6…` verified equal to
production's own digest; `npm test` is hermetic and must not query production). **39 shipping
cohorts, 0 gaps** — the rule was being honoured, it just was not provable.

Granularity is stated in the file so it is not "tightened" by mistake: the question pool is keyed by
CLEAN type, the registry by `type_ar`, which is finer. The assertion is "at least one enabled row",
not "every alias has a row" — demanding the latter would fail 13 cohorts that are certified and
correct. Those 13 are printed as INFO, not as a gate, for a future run to decide on.

**R5.6.1 — salience orders questions, never gates them.** `scoreQuestion()` returns
`bestSplit × SALIENCE[id]`; the source says emphatically that this is ordering only, and nothing
asserted it. A weight leaking into an inclusion gate is close to invisible: AF would just stop
offering questions, and the symptom is byte-identical to the contract-mandated stop under P1.
`scripts/verify-af-salience-orders-only.ts` executes the real function across the whole salience
range (0 → 1000) and asserts the ask/skip verdict and the surviving option set are invariant, that
score stays exactly proportional (so a future "score floor" is provably a salience floor), and that
order still moves — the check that proves the weight is live rather than vestigial.

## 4. Mutation proofs — 18, every one red then green

| barrier | mutations |
|---|---|
| `verify-af-salience-orders-only` | 5 — salience threshold gates inclusion · salience filters the option set · falsy score read as no-question · score decoupled from salience · scope floor made salience-tunable |
| `verify-af-cohort-questions-certified` | 6 — uncertified cohort ships questions · cohort gains an uncertified period · registry retracts a live cohort · registry row deleted · mirror parse breaks (must fail, never pass vacuously) · cohort key typo |
| `verify-af-rpcs-not-hand-edited` | 7 — new hand edit of the results RPC · of the referee · a DROP · **the sanctioned template+rebuild path stays green** · allowlist grown silently · a protected surface unprotected · baseline raised to hide the divergence |

## 5. Still open from previous runs (unchanged, not re-litigated)

- satel `air_conditioner` (90 T / 0 F) and sanadak `maid_room` — `af_field_stuck_no_variance` P2, open
  since 08-20. The outstanding claim is a *source limitation*, which `AGENTS.md` permanent rule #2
  forbids asserting without a live probe, and satel.sa is still blocked by egress policy. Recorded,
  not waived.
- The registry alias question in §3 (13 cohorts certified on the canonical `type_ar` only).

## 6. Harness notes for the next run

Supersedes the 2026-08-29 notes where they conflict.

1. **Answering «تقصد مدينة X كاملة، أو حي معيّن؟» with «المدينة كاملة» is now SAFE** — PR #1255 is
   live and verified today. The 2026-08-29 warning against it is retired.
2. **Riyadh completes an agent-flow city search now.** «في الرياض» → «مدينة الرياض» lands on
   `p_cities=["الرياض"]`. The 2026-08-29 note to route Riyadh through the Filter flow is retired.
3. **Wait on «يبحث في المنصات…» / «وصلت», not just «يفكر».** The results turn renders a platform
   loader *after* the thinking indicator clears; a wait that only watches «يفكر» returns mid-loader
   and reads as "no AF offer button" — which looks exactly like an R4.4 defect and is not one.
4. **Do not match on «إعلان» to detect a results turn.** The standing disclaimer
   («تعرض إزهله إعلانات من منصات عقارية خارجية…») contains it, so the wait fires instantly on page load.
5. **Playwright resolves from the repo, not the scratchpad.** Import it by absolute path
   (`/home/user/ezhalah/node_modules/playwright/index.js`) and destructure the default export —
   `import { chromium } from '…/index.js'` throws, it is a CommonJS module.
6. **A Supabase MCP token can expire mid-run.** It did today, at the worst moment. Pull anything the
   run's conclusions depend on early; the repo alone was enough to root-cause §2 only because the
   migrations happened to be committed.
7. Launch flags, the pre-selected «شراء»/«سنوي» multi-select behaviour, focus-rendered cached
   Trending, and the district `match_values` merge all behave exactly as the 2026-08-25/08-29 notes
   describe — unchanged.
