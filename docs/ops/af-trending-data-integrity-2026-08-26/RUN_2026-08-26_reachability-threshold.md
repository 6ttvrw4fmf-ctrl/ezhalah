# AF + Trending Data Integrity — run 2026-08-26

Routine #5 (🎯 Senior Advanced Filter + Trending Data Integrity Engineer). Spec:
`docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`.

```
ADVANCED FILTER HEALTH:        9.5/10 (95%) → 8.6/10 (86%)
TRENDING CITIES HEALTH:       10.0/10 (100%) → 10.0/10 (100%)
TRENDING DISTRICTS HEALTH:     9.7/10 (97%) → 9.7/10 (97%)
AF DATA INTEGRITY:             9.6/10 (96%) → 9.8/10 (98%)
OVERALL AF + TRENDING HEALTH:  9.7/10 (97%) → 9.4/10 (94%)

REAL BROWSER JOURNEYS: 14 driven here + 9 in the dispatched official check = 23
AF JOURNEYS: 6 driven here (5 agent-flow + 1 mobile) + 5 AF journeys in the official check
TRENDING CITY JOURNEYS: 4
TRENDING DISTRICT JOURNEYS: 2
CITIES TESTED: 8 driven/verified (الرياض جدة الدمام الخبر الجبيل عنيزة بريدة الخرج)
REGIONS TESTED: 4 (الرياض · مكة المكرمة · الشرقية · القصيم)
AF FIELDS TESTED: bathrooms · furnished · rnpl · property_age · amenities · street_width (6)
INTENT→UI MISMATCHES: 0
UI→REQUEST MISMATCHES: 0
REQUEST→RPC MISMATCHES: 0
RPC→DB MISMATCHES: 0
COUNT MISMATCHES: 0
STALE COUNTS: 0
INELIGIBLE RESULTS: 0
DUPLICATES: 0
UNKNOWN/FALSE VIOLATIONS: 0
BUGS FOUND: 3 (1 barrier defect · 1 agent-flow AF entry defect · 1 ambiguous count pair)
BUGS FIXED: 1 (the barrier defect)
BUGS REMAINING: 2 (both escalated, neither safely fixable without an owner call)
BARRIERS ADDED/STRENGTHENED: 1 (verify-af-group-cohort-coverage.ts, two independent fixes)
MUTATION-PROVEN: YES
MERGED: NO — PR #1127 open, CI green
DEPLOYED: NO — no `src/` change required one
PRODUCTION VERIFIED: YES (Trending exact against DB; AF state characterised live)
```

**ALL GOOD: NO.** Trending Cities and Trending Districts are exact on every leg of the chain, and
the aqar tri-state repair is confirmed propagating. Two AF items are left open, deliberately: an
agent-flow entry defect whose root cause is **not** proven, and a count pair that is genuinely
ambiguous against a deliberate owner change. Neither was guessed at.

---

## 1. A correction, stated first

An interim alert during this run said *"Advanced Filter is unreachable in production"*. **That was
too broad and is withdrawn.** Dispatching the repo's own `AF backend-truth live check` against live
production opened real AF question cards in three journeys —

| journey | evidence |
|---|---|
| MOBILE Residential/Rent-Annual/Apartment/Riyadh | `hasCard:true`, «تفضل تدفع الإيجار على دفعات؟», chip 10,670 |
| Residential/Buy/Apartment/Riyadh (Skip) | `hasCard:true`, «كم دورة مياه تفضل؟», chip 10,957 |
| Residential/Buy/Apartment/Riyadh (Back) | `hasCard:true`, chip 10,957 |

That check reaches AF through the **Filter («تصفية») flow**, and that path works. The finding below
is real but narrower than first reported.

## 2. Advanced Filter does not open from the AGENT-flow CTA (open, root cause unproven)

**What a user experiences.** In the «الوكيل الذكي» chat flow, after results render, tapping the
documented entry «خلّنا نحدد الطلب أكثر» (`testID=results-narrow`) never presents an Advanced Filter
question. The button either stays put or silently consumes itself and appends more listing cards.

**Reproduced 5/5**, on the currently-deployed bundle (`22a2936`):

| cohort | viewport | CTA shown | AF card |
|---|---|---|---|
| Riyadh · Buy · villas group | desktop | yes | none |
| Riyadh · Buy · villas group · 4 beds | desktop | yes | none |
| Riyadh · Rent-Annual · apartments group | desktop | yes | none |
| Riyadh · Buy · residential land group | desktop | yes | none |
| Riyadh · Rent-Annual · apartments group | mobile 390×844 | yes | none |
| Jeddah · Buy · apartments group | desktop | **correctly hidden** | n/a |

**What was ruled out, with evidence:**
- Not a dead click — the tap fires `property_age_option_counts_ar` and `apartment_guided_counts_ar`.
- Not thin data — those RPCs return a 10,670-row base with heavy narrowing power (age buckets
  4,531/1,589/1,760/1,217/1,195; furnished 1,046 vs unfurnished 2,706).
- Not a crash — zero console errors, zero `pageerror`, zero `unhandledrejection`.
- Not the ranking rules — running the pure gates offline against these exact query shapes shows
  scope tiers already **resolved**, exactly one cohort-allowed question (`bathrooms` for the villas
  group, `furnished` for apartments), and options that comfortably clear `scoreQuestion`.
- Not `hasClientOnlyNarrowing` — that would return an empty pool and issue **no** RPCs at all.

So the failure is in `agent.tsx` orchestration, not in cohorts, counts or thresholds.

**Suspected window, NOT proven:** #1094 (conversational rounds), #1097 (conversation persistence),
#1098 (only-questions-that-narrow) — merged and deployed the evening of 2026-08-25, *after* the
08-25 run verified AF working end to end. A bundle-level bisect was **not possible here**: Vercel
preview hosts return `ERR_TUNNEL_CONNECTION_FAILED` (egress policy allows only
`ezhalah-app.vercel.app`).

**Why this run did not fix it.** No root cause is proven, and the area was deliberately rewritten by
an owner product decision one day earlier. Shipping a guessed fix would violate "evidence before the
write, proof after it". Escalated instead.

## 3. Two production checks are red, and the direction is genuinely ambiguous

The dispatched official check finished `failure` with two red checks, both sharing one signature —
the AF header chip reads **null** where a number is expected:

| check | observed |
|---|---|
| SKIP: "Skip does not change the count (no predicate applied)" | `before=10957 after=null` |
| BACK: "Back restores the previous count" | `expected=null got=2482` |

**Not adjudicated, on purpose.** #1061 — *"the pending window must not show the previous answer's
count either"* — deliberately BLANKS the count during the pending window. These may therefore be
**stale barrier expectations** rather than a product defect. Deciding which side is wrong changes
either a barrier or owner-specified UI behaviour, so it needs an owner call. Everything else in that
run passed exactly, including `UI = RPC = oracle` and `missing = extra = duplicates = 0` on Jeddah
4,186 and Riyadh 3,848 / 2,330.

## 4. The bug that was fixed: AF reachability measured at a threshold production stopped using

**PR #1127, CI green, barrier-only.**

`scripts/verify-af-group-cohort-coverage.ts` rolled up *"which shipped groups can open Advanced
Filter"* with a hardcoded `>= 2`, while `MIN_USEFUL_QUESTIONS_TO_SHOW` moved to **1** on 2026-08-24
(#1045). The file's own comments already said the threshold was 1 — only the arithmetic never
followed. At the real threshold **six** of eight shipped groups can open AF, not two; the four it
could not see are exactly those with ceiling 1 (Apartments & Co-living, Villas & Houses, Retail &
Workspace, Industrial & Logistics).

It failed its own header promise twice: it measured the wrong threshold, **and** it only asserted
`reachable.length > 0` — with two plot groups permanently clearing the bar, every other group could
regress to zero while the check stayed green.

Fixed at the class level: the threshold is now **read** from `src/data/advancedFilters.ts` (anchored
regex, so a rename fails loudly) rather than retyped, and the reachable **set** is pinned by name so
a flip in either direction is a named diff. The ceiling failure message, which hardcoded the same
stale 2, now quotes the live constant.

**Mutation proof** (each reverted): threshold `1→2` → 🔴 fails naming all four groups as
`NO LONGER REACHABLE` (it now reports precisely the blind spot it had); constant renamed → 🔴 fails
with the read error, never a silent pass; restored → 🟢 passes reporting 6 groups.

## 5. Trending — exact on every leg

**Cities.** Riyadh cohort Buy + `[فيلا, تاون هاوس, بيت, دوبلكس]` + `p_beds_exact:[4]`. The request
carried the complete filter state, and **UI = RPC = independent DB truth on all 6 rows**:

| الرياض | الدمام | جدة | الخبر | الجبيل | عنيزة |
|---|---|---|---|---|---|
| 1,415 | 220 | 181 | 178 | 79 | 77 |

Trending is recomputed, not stale: the distribution and ordering both move with the filter (Dammam
rises to 2nd; الجبيل/عنيزة/بريدة/الخرج enter). Bare and rent-only states carried correct params
(`p_rent_period: سنوي` after deselecting «شراء», per harness note 2).

**Districts.** Under narrowing, `district_options_ar` returns scope counts (3800/703/686/502/479/412)
and the UI then fires **one real `location_search_candidates_ar` per row** — 6 calls for 6 rows, no
row left on a scope count. All six equal independent DB truth: المهدية 333 · النرجس 149 · العارض 127
· الرمال 85 · الجنادرية 61 · طويق 21.

## 6. AF data integrity — the aqar tri-state repair is confirmed propagating

The 2026-08-23 item left OPEN ("0 of 117,734 rows re-captured") is now **closed as PASS**. PR #987's
corrected parser is reaching data: 27,040 of 118,766 rows re-captured since the merge (newest
capture 08-26 08:15 UTC). Real FALSE values have landed where there were none — `maid_room`
0 → **2,773** false, `driver_room` 0 → **3,611** false — and the over-reported trues fell as
expected (maid 15,987 → 9,474). The column is now genuinely three-valued. ~91k rows still carry
pre-fix values; at the observed ~9k/day that completes in ~10–13 days. **Nothing was hand-edited.**

`alert_event` 781 (`af_field_stuck_no_variance`) is **correctly still open**: the detector returns 0
only because `mon_raise` dedups against the open key. Evaluating its own stuck query directly shows
4 pairs still firing (satel `air_conditioner` 39/0 and `kitchen` 39/0, sanadak `maid_room` 35/0,
wasalt `driver_room` 0/74). Its resolve path is present and correct. This is exactly the AGENTS.md
"an all-zero sweep can sit on top of open alerts" shape — read `open_alerts`, never the count.
Adjudicating those 4 pairs against live source is next run's work; none was repaired on plausibility.

## 7. Harness note for the next run (extends note 4)

District oracles must normalize the «حي» prefix, not just expand `match_values`: the RPC label is
`حي المهدية` while `search_listings_ar.district_ar` stores `المهدية`. An oracle keyed on the display
label reports a **false zero** — it did here, on a row whose count was in fact exact (333).

Also: in the agent chat flow the disambiguation options are **plain text, not buttons** — a real user
answers by typing. And the composer is disabled while the agent thinks, so a bare `fill`+Enter
silently no-ops; wait for the message to echo into the transcript before sending the next one.

## 8. Adjacent state noted, not acted on

- `migration_drift` is **red** (other sessions' migrations; this run applied none, so it adds none).
- `silent_scraper_death` P0 and `zero_new_stall` P1 are open — the scraping routine's.
- No DB saturation observed at this routine's 11:00 UTC start, so no restagger is needed against the
  junior scraper sharing the slot.
