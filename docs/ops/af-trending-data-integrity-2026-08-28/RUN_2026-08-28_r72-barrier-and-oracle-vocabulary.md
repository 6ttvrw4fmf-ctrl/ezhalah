# AF + Trending Data Integrity — run 2026-08-28

Routine #5 (🎯 Senior Advanced Filter + Trending Data Integrity Engineer). Spec:
`docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`.

```
CONTRACT READ:                YES  (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, a4e7d5b)
BUGS FOUND:                   3   (1 oracle-coverage defect · 2 barrier defects)
BUGS FIXED:                   3
BARRIERS ADDED/STRENGTHENED:  3   (1 new hermetic barrier · 1 new SQL mirror · 1 live check repaired)
MUTATION-PROVEN:              YES (5 mutations on the new barrier, red then green)
DEPLOYED:                     NO  (no src/ change; none required one)
PRODUCTION VERIFIED:          YES
```

**ALL GOOD: YES** — with one owner question still open from 2026-08-27 (§6), and one alert
deliberately left open for want of source evidence (§5).

---

## 1. R7.2 finally has a barrier

R7.2 ("multi-select marginal vs combined") was the **only** rule family in the Product Contract's
§15 audit table with no directly-corresponding barrier. The 2026-08-27 run established both
production shapes live and flagged the barrier as this run's work.

Both shapes are correct, and they are structurally determined by the clause:

| shape | applies to | mechanism |
|---|---|---|
| **INTERSECT (AND)** | amenity chips | each chip is its own boolean column; the clause chains one `and (not ('tok' = any(p_amenities)) or s.col)` per token |
| **UNION (OR)** | directions, unit_subtypes, bath_exact, types | one column, disjoint values; a membership test |

Re-proved live (anon REST) before writing anything:

```
AND   ac=2,831 · elevator=1,803  →  ac+elevator=1,619  ·  +parking=161
OR    شمال=488 · جنوب=325        →  813 (exact sum)    ·  +شرق=1,300
```

RPC = independent PostgREST oracle on all nine.

**`scripts/verify-af-multiselect-combining-semantics.ts`** — offline, hermetic, in `npm test`, 34
checks. Mutation-proven five ways (oracle forgets `ac`; oracle collapses amenities into an OR;
clause amenity chain made disjunctive; `p_directions` membership → equality; UI gains a chip the
clause rejects), each red, then green again.

## 2. The drift the barrier exposed — the independent oracle could not see the biggest chip

`scripts/lib/afOracleFilter.ts` — the oracle `verify-af-live-truth.ts` runs against production
daily — listed **column names as if they were request tokens**:

```
buildOracleQS({p_amenities:['ac']})  ->  qs: production_ready=is.true   unhandled: [p_amenities:ac]
```

The clause reads `'ac' → s.air_conditioner` and `'furnished' → s.furnished`. «تكييف» is the biggest
amenity chip in production — **2,831 of the 11,153** Riyadh / Rent-Annual / شقة cohort.

It fails **CLOSED** (an unhandled param is a loud FAIL, never a silent skip), so **no wrong number
ever shipped** — but the oracle could not certify those journeys at all, and the 9-journey corpus
simply never ticked them. The drift ran both ways: the set carried nine tokens the clause **rejects
fail-closed** (`pool, gym, garden, balcony, laundry_room, separate_*_meter, optical_fibers`), for
which the oracle would have filtered a real column while the RPC returned zero rows.

Fixed as a token→column map. Verified live after the fix — RPC = oracle on `ac`(2,831),
`furnished`(1,048), `ac+elevator`(1,619), `ac+parking+elevator`(161), `rnpl`(3,811),
`maid_room`(24), and the three direction unions.

**Why it survived so long:** nothing in the repo stated what the clause accepts.

## 3. New mirror: `sql/mirrors/af_eligibility_clause.sql`

The canonical AF predicate every count surface is generated from (`rebuild_af_filter_rpcs()`) — the
one `AGENTS.md` forbids hand-editing — had **no mirror**. A session could recover it only by
querying production, and an offline barrier could not read it at all.

Re-derived verbatim via base64 round-trip from `pg_get_functiondef` (never hand-transcribed):
md5 `ea24a98d22674dad6398cdff5e2b5e56`, **8,574 octets both sides**. `verify-sql-mirrors-not-stale.ts`
green. The new barrier reads its vocabulary from this file, so clause/UI/oracle drift is now caught
on every PR.

## 4. The live AF barrier was red on main — and it was the barrier's fault

Run 33168150595 (dispatched by this run, on `main`):

```
FAIL  MOBILE Residential/Rent-Annual/Apartment/Riyadh — furnished:
      final search request was captured
      null
```

The **byte-identical desktop journey passed in the same run**, same scope, same base
(11,153 → 3,811 on both).

**Root cause.** The finish block reset `lastSearchBody` **after** `af-confirm` and its 1200 ms
settle. Confirming the last useful question can end the round on its own — the block's own comment
says so — firing the final search inside that window. The reset then discarded the captured request;
`stillOpen` was false so nothing was re-clicked; the 25 s poll had nothing left to find. Whether it
trips is pure timing (does the round still have a question left), which is exactly why it moves
between journeys and runs.

**Fix.** Arm the capture immediately **before** each committing click. Any search from the commit
onward is the final one. This cannot weaken the assertion — a search that never fires still leaves
`lastSearchBody` null and still fails.

### 4b. A green check whose evidence said the opposite

Same run, same file:

```
PASS  … Back re-offers the earlier question's options
      no af-option-* found after Back — the restored card never rendered (restored.q=كم دورة مياه تفضل؟)
```

`check()` prints its detail on PASS as well as FAIL, and the detail was the failure sentence
unconditionally. A green check whose own evidence line says the card never rendered is how a run
gets misdiagnosed — it is what sent this run hunting a Back-navigation defect that does not exist.
The detail now reads true in both states.

### 4c. The 2026-08-27 Back failure: not reproducible, not closed as "flake"

The 22:31 scheduled run failed 3 checks on `Back restores the previous question` (`got=null`).
Reproduced against production today in a real browser, at the same CI timing (1200 ms between
confirm and Back), on the same scope:

```
Q1 «كم دورة مياه تفضل؟» chip=11,202 opts=[1,2,3,4]
select → 2,469 → confirm → Q2 «وش المميزات المهمة لك؟» chip=2,469
Back → Q1 restored: question ✓  count 2,469 ✓  options [1,2,3,4] ✓
```

Also ruled out the class the 2026-08-27 run found (a role-dependent plan cliff): the card-feeding
count RPCs are healthy under the **anon** role for that exact scope —
`apartment_guided_counts_ar` 350–1,972 ms over 15 calls, `property_age_option_counts_ar` ~460 ms,
no cliff, nowhere near the 25 s bound. **Status: one occurrence, not reproduced, left open as a
watch item.** Not waived, not called a flake.

## 5. AF data integrity — satel `air_conditioner` (2026-08-27 handoff)

The alert `af_field_stuck_no_variance` (P2, open since 2026-08-20) flags satel · air_conditioner as
100% one value. Measured over the full cohort:

| where | true | false | unknown |
|---|---|---|---|
| `search_listings_ar` (satel) | 89 | 0 | **1** |

The base table `satel_residential_listings.air_conditioner` is NULL for **all 221** rows; the fact
lives in `additional_info.air_conditioning_type` (`split` 108 · `both` 61 · `concealed` 50 · null 2).
Joined row-for-row:

| index value | source published an acType? | rows |
|---|---|---|
| `true` | yes | 89 |
| `unknown` | no | 1 |

**Exact 1:1.** The index says "has AC" only where satel named the AC system installed, and unknown
where it said nothing. That is a faithful source reading, **not** an UNKNOWN→true coercion. Tri-state
is preserved (satel also emits 4 real `false`s on `kitchen`, and leaves `elevator` unknown on all 90).

**The alert was NOT resolved.** The remaining claim — that satel's acType enum has no negative value,
so `false` is unreachable — is a *source-limitation* claim, and `AGENTS.md`'s permanent rule #2
forbids asserting one without a live probe. **satel.sa is unreachable from this container**
(`curl` → 000, connection failed). Recorded for a run that can reach it.

## 6. Contract spot-audit

| rule | how audited | result |
|---|---|---|
| R7.2.1 marginal chip counts | live + hermetic | each chip reads its own `cnt_*`; footer is `cnt_selected` recomputed — now barriered |
| R7.2.2 combined count | live, both shapes | AND `ac+elevator`=1,619 · OR `شمال+جنوب`=813 — now barriered |
| R1.3.1 type union | clause + live | `p_types` membership pinned by the new barrier |
| R2.5 / P2 unknown ≠ no | live, satel §5 | 1:1 source correspondence; no coercion found |
| R4.3 / R4.5 offer gate | real browser | offer present at 6,113 (جدة annual شقة) with a useful question |
| R5.1 / R5.3 usefulness + floor | CI run 33168150595 | 9 journeys, ID-exact |
| R7.1.1 counts vs narrowed set | live, 108 checks | every AF option count = search RPC, 3 cohorts, 0 mismatches |
| R7.5 count = independent oracle | CI + live | `ui=rpc=oracle` on all 6 completed journeys; missing=extra=duplicates=0 |
| R8.1 Skip = no predicate | CI run | `before=11,202 after=11,202`, advances to a different question |
| R8.2 Back semantics | live browser §4c | question, count and options all restored |
| Trending full-state inheritance | live, 24+24 | cities and districts both carry AF answers exactly |

### ~~Still open for the owner (raised 2026-08-27, unchanged — not acted on)~~ — CLOSED 2026-08-29

**R7.2.2** says a multi-select footer count "reflects the **union** of the ticked chips". Production
has two shapes and both are right (§1). The contract sentence is **incomplete, not wrong**. Per §0.1
a contract rule is not edited without owner authorisation, so nothing was changed. The behaviour is
now barriered either way, so whichever wording the owner picks, the code is pinned.

> **CORRECTION (2026-08-29).** This item was already stale when it was written here: PR #1177 had
> replaced the union-only sentence with the two-shape wording. The owner confirmed that wording as
> canonical on 2026-08-29 — same-field value choices UNION, different boolean amenities INTERSECT —
> and the contract now says so explicitly, with an R7.2 row added to its §16 audit table pointing at
> `verify-af-multiselect-combining-semantics.ts`. **R7.2.2 is closed. Do not carry it forward as an
> open owner question.**

## 7. Harness notes for the next run

1. **The browser CAN drive production from this container now** — this supersedes the 2026-08-26 and
   2026-08-27 notes. Working recipe: pinned browser `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`,
   `--ssl-version-max=tls1.2`, `--proxy-server=$HTTPS_PROXY`, `--no-sandbox`. Desktop and mobile
   (390×844, isMobile+hasTouch+iOS UA) both work.
2. **The app opens in «تصفية» (Filter) mode.** Advanced Filter is in **«الوكيل الذكي»** — click that
   div first, then the composer is a plain `<textarea>` (last one on the page).
3. **The agent's disambiguation has NO chips.** «تقصد مدينة جدة كاملة، أو حي معيّن؟» is answered by
   **typing** «المدينة كاملة» into the composer. Clicking the question text does nothing (and matches
   the question itself, which silently looks like a successful click).
4. **Use the app's own testids, never a hand-rolled probe:** `af-card`, `af-question-title`,
   `af-count-chip`, `af-option-*`, `af-confirm`, `af-back`, `af-skip`, `af-skip-all`. A wrong
   selector returns `null`, and `null === null` makes a comparison **pass**. That produced a false
   "Back restored the question" here before the repo's own reader was used instead.
5. **The offer button renders only after the AF probe resolves.** Read the page too early and
   «خلّنا نحدد الطلب أكثر» is genuinely absent — it looks exactly like an R4.4 defect. Scroll to the
   bottom and settle before concluding anything about the offer gate.
6. **Unit-subtype tokens are `استديو` / `شقق مخدومة` / `شقة`** — not `استوديو`. A wrong token makes the
   search return 0 while the AF count reads 3,741, which looks precisely like a count→click-through
   break. It is not one.
7. `npm test` still needs `curl_cffi`, `python-dotenv`, `supabase` (install the last with
   `--ignore-installed PyJWT`).
