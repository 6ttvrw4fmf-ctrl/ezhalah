# AF + Trending Data Integrity — Run 3 (2026-08-23, third pass)

Continuation of `RUN_2026-08-23b_second-run.md`, executing the owner instruction
**"FINISH PER-TYPE ADVANCED FILTER VERIFICATION"**: browser-verify every certified live type,
finish the aqar maid/driver propagation rather than waiting on it, and fix — not re-note — the
property_age lead.

**Rating: 9.4/10 (94%) → 9.4/10 (94%).** No production behaviour changed this pass. What changed
is the *evidence*: eight more cohorts proven exact end-to-end, one harness defect found and fixed,
and the maid/driver residue quantified with a named root cause instead of an open question.

---

## 1. Backend degradation event — detected, contained, self-healed (no product fault)

At **21:52 UTC** three consecutive anon-REST calls returned `503/521 PGRST002`
("Could not query the database for the schema cache"), and two Supabase MCP `execute_sql` calls
timed out. Per the standing safety rail (*"if Supabase degrades, STOP heavy testing and diagnose
first"*) all browser harnesses were killed immediately, before any further load was applied.

Diagnosis:

| probe | result |
|---|---|
| plain PostgREST table read | **200** — Postgres alive |
| `auth/v1/health` | **200** |
| 3 of 4 search RPCs | **200** |
| `pg_stat_activity` | **61 / 160** connections, 1 active — *not* exhaustion |

So it was a transient PostgREST schema-cache fault on Supabase's side, **not load this run
caused**, and it self-healed: `top_cities_by_deal_ar` then returned **5/5 × 200**.

**A false alarm I raised and corrected.** Mid-diagnosis a `top_cities_by_deal_ar` call returned
`PGRST202 (function not found)` and I read it as the 2026-07-16 outage shape recurring. It was not.
`pg_proc` shows exactly **one** overload — a 37-argument signature — and always did; my health-check
curl had invented a `p_limit` parameter that does not exist. The 404 was my probe's error. Recorded
here because the same mistake would otherwise look like a real regression to the next reader.

The three browser cases that ran inside the degradation window returned completely empty (no
trending rows, no RPC bodies). They were **discarded and re-run**, not recorded as product failures.

---

## 2. Browser verification — 10 journeys, counts proven against an independent oracle

Every count below was checked against raw set-math over `search_listings_ar`. **The oracle never
calls the AF/count RPC**, per the owner's rule against validating an RPC with itself.

| case | browser | oracle | verdict |
|---|---|---|---|
| apartment_buy_jeddah | 13,859 | 13,859 | ✅ exact |
| apartment_rent_dammam | 1,859 | 1,859 | ✅ exact (count only — AF did not open) |
| floor_buy_riyadh | 10,159 | 10,159 | ✅ exact |
| room_rent_riyadh | 1,236 | 1,236 | ✅ exact |
| resland_buy_riyadh | 2,262 | 2,262 | ✅ exact |
| resthouse_buy_riyadh | 400 | 400 | ✅ exact |
| resthouse_rent_riyadh | 644 | 644 | ✅ exact |
| villa_buy_dammam | 2,619 | 2,619 | ✅ exact **after fixing my oracle** (§3) |
| resbldg_buy_jeddah | — | 1,154 = RPC 1,154 | ⚠️ browser leg failed (harness) |
| resbldg_rent_riyadh | — | 1,370 = RPC 1,370 | ⚠️ browser leg failed (harness) |

7 of 10 opened Advanced Filter. Combined with run 2, **16 distinct cohorts** are now browser-verified.

**Honest limitations, not papered over:**

* `resthouse_rent_taif` targeted الطائف but Taif was absent from the trending rows, so the harness
  fell back to الرياض. This is recorded as a **Riyadh** verification. It is **not** a Taif rotation.
* عمارة (residential building) failed navigation twice (`city=None`) — a harness failure, not a
  product fault. Its counts are proven RPC = oracle, but the **browser leg remains unproven**.

---

## 3. Harness defect found and fixed — my oracle, not the product

`villa_buy_dammam` showed browser **2,619** vs oracle **2,618**. The owner's bar is *"not
approximately, exactly"*, so this was chased rather than written off as drift — and drift was ruled
out directly: `search_listings_ar` is rebuilt only hourly (last 21:15), so the index was **static**
across both reads.

The recorded request gave the answer. The app serializes the whole **villa group**:

```
sent_types: ["فيلا", "تاون هاوس", "بيت"]     ← the app
p_types:    ["فيلا"]                          ← my oracle
```

Corrected oracle: **2,619 = 2,618 فيلا + 0 تاون هاوس + 1 بيت.** Exact.

Per *"if the failure is your harness/oracle, fix the harness, not the product"* — the harness was
wrong. Because that flaw could have made other "exact" matches lucky rather than correct, **every**
case was re-verified against its full serialized array. `apartment` (3 types), `resland` (3),
`resthouse` (2 — the app queries both alif-hamza spellings استراحة / إستراحة) all confirmed exact,
with the extra group members contributing 0. No product defect anywhere in this section.

---

## 4. aqar maid/driver propagation — quantified, with a root cause (not "wait longer")

The parser fix (PR #987) only takes effect on rows that are **re-captured**. Measured state:

| metric | value |
|---|---|
| aqar rows total | 117,790 |
| re-swept since merge | **13,214 (11.2%)** |
| still carrying pre-fix state | **104,576 (88.8%)** |
| canonical `maid_room is false` | 1,334 |
| canonical `driver_room is false` | 1,708 |

**Root cause of the incomplete propagation is structural, not time.** `aqar-sweep.yml` is by its own
header *"a light 3-page sweep of every (type × deal) combo"* that **upserts new listings** — a
discovery sweep, not a backfill. Stale rows fall off the first three pages and are never revisited.
**Waiting would never have finished this**, which is exactly what the owner anticipated.

Evidence the residue is genuinely wrong and not merely unknown:

| cohort | maid true | maid false | true % of known |
|---|---|---|---|
| post-fix re-swept (12,791) | 1,062 | 1,334 | **44.3%** |
| pre-fix stale (104,999) | 14,779 | **0** | **100%** |

Pre-fix, `false` was **structurally unreachable** — the value could only be a prose-derived `true`
or `NULL`. Read structurally, barely 44% of known maid values are true. So the stale cohort contains
both under-known UNKNOWNs *and* prose-derived TRUEs that the source contradicts.

**Action taken (not deferred):** dispatched `aqar-deep-fill.yml` for **riyadh** — the sanctioned
backfill entrypoint, which goes **150 pages** deep and therefore *can* reach stale rows — with gentle
settings (`workers=8`, `min_interval=0.15`, `max_parallel=4`). Riyadh baseline captured at 22:02 for
proof: 39,085 rows, maid 6,698 true / **85** false / 32,302 unknown; driver 2,883 / **109** / 36,093.

**Status: PROPAGATION PENDING — mechanism proven, coverage incomplete.** The sync demonstrably
carries `false` for six other platforms (wasalt 1,996 / gathern 29,054 / aldarim 158 / sanadak 1,104
/ aqaratikom 68), so aqar sitting at 0 in the index is a coverage problem, not a broken pipeline.

**Villa/Apartment are therefore NOT yet fully source-faithful, and are not claimed to be.**

---

## 5. The barrier had already caught this — three days earlier, unactioned

`af_field_stuck_no_variance` (P2, raised **2026-08-20**, still open) names its `stuck_pairs`. The
top five are precisely the defect independently root-caused in run 2:

| platform | cohort | field | true | false |
|---|---|---|---|---|
| aqar | إيجار سنوي / فيلا | maid_room | 2,506 | **0** |
| aqar | إيجار سنوي / فيلا | driver_room | 1,177 | **0** |
| aqar | إيجار سنوي / شقة | maid_room | 1,158 | **0** |
| aqar | إيجار سنوي / دور | maid_room | 509 | **0** |
| aqar | إيجار سنوي / شقة | driver_room | 261 | **0** |

The detector worked. Nobody acted on it for three days. Movement since the fix:

| cohort | maid false | driver false | state |
|---|---|---|---|
| Villa / Rent | 0 → **305** | 0 → **458** | ✅ no longer stuck |
| Apartment / Rent | 0 | 0 | ❌ still stuck |
| Floor / Rent | 0 | — | ❌ still stuck |

2 of 5 pairs cleared, tracking the 11.2% re-capture coverage exactly.

`mon_raise()` returns 0 on an already-open dedup key, so this alert will **not** re-raise and will
not self-clear until a detector re-checks it — the "open alert under an all-zero sweep" trap called
out in `AGENTS.md`. It is left open deliberately and honestly.

---

## 6. Chalet — SOURCE INCONCLUSIVE upheld, now with a mechanism

Chalet was previously held at SOURCE INCONCLUSIVE. That verdict is **reinforced**, not softened:

* `Chalet / Buy` — **0 rows** in aqar entirely.
* `Chalet / Rent` — 57 rows, **91.2% seen in 24h** (fetched fine; genuinely thin inventory).
* Sweep logs show `CHALET BUY … (0 listings) NOT proven empty (fetch_failed=True, pages_fetched=0,
  empty_state=False)` in multiple shards.

This is the standing rule in `AGENTS.md` at slice granularity: **a missing capture is not evidence
the source omits it — a failed fetch looks identical.** Chalet stays uncertified. Camp (4 rows) and
Staff Housing (0 rows) remain **INSUFFICIENT INVENTORY**.

---

## 7. Two further findings (reported, not silently absorbed)

**(a) Every aqar sweep run concludes `failure` — and the guard is right.** Today's dispatch: 85 jobs
succeeded, **5 failed** (`badr`, `al_khurma`, `tarout`, `al_ghazalah`, `qurayyat`). This is *not* a
zero-row problem — `al_khurma` upserted 4/4, `tarout` 33/33, `al_ghazalah` 67/67 and were still
demoted. RC-B fires on a slice that **could not prove emptiness** after a fetch failure:

```
📊 Done. 67/67 upserted across all slices. (run_id=34314)
✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.
```

Chronic and low-rate (1.7–7.2% of runs/day over 7 days), not a new regression. **No change made:**
this is a correct barrier refusing to call an unproven slice a success, and loosening it to get a
green tick is exactly what the rules forbid. Flagged because a permanently-red workflow is how a
*real* failure eventually goes unnoticed.

**(b) `Residential Land / Buy` is 20.9h stale** — 2,817 rows, newest capture `01:06`, while every
peer type refreshed at `21:46`. Most likely crowded out of the 3-page sweep window by
`Commercial Land` (21,520 rows) sharing the same `land` slice. Counts are still correct
(أرض سكنية/Buy/الرياض verified exact at 2,262) but the data is aging. Deep-fill is the remedy.

---

## 8. Status vocabulary

| item | status |
|---|---|
| Per-cohort count correctness (16 cohorts) | **FIXED + VERIFIED** — exact vs independent oracle |
| Oracle group-expansion defect | **FIXED + VERIFIED** (harness) |
| property_age source fidelity | **RESOLVED — no defect, no change** (24/25; run 2) |
| aqar maid/driver canonical repair | **PROPAGATION PENDING** — 11.2% done, deep-fill dispatched |
| aqar maid/driver → search index | **AWAITING FIRST PRODUCTION EXECUTION** of the hourly sync |
| Chalet | **SOURCE INCONCLUSIVE** (upheld, mechanism identified) |
| Camp / Staff Housing | **INSUFFICIENT INVENTORY** |
| عمارة browser leg | **NOT PROVEN** (harness navigation failure) |
| Sweep RC-B demotions | **NO ACTION — guard correct** |

**FULLY CORRECT: NO** — and deliberately so. The counts verified this run are exact, but
`aqar maid_room/driver_room` remains 88.8% un-repropagated, so Villa and Apartment cannot yet be
called fully source-faithful. Deployments: **0** (no `src/` change required one).
