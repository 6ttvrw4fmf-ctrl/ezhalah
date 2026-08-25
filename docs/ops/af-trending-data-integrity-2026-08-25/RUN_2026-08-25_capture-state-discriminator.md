# AF + Trending Data Integrity — run 2026-08-25

Routine #5 (🎯 Senior Advanced Filter + Trending Data Integrity Engineer). Spec:
`docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`.

```
ADVANCED FILTER HEALTH:        9.5/10 (95%) → 9.5/10 (95%)
TRENDING CITIES HEALTH:       10.0/10 (100%) → 10.0/10 (100%)
TRENDING DISTRICTS HEALTH:     9.7/10 (97%) → 9.7/10 (97%)
AF DATA INTEGRITY:             9.3/10 (93%) → 9.6/10 (96%)
OVERALL AF + TRENDING HEALTH:  9.6/10 (96%) → 9.7/10 (97%)

REAL BROWSER JOURNEYS: 24
AF JOURNEYS: 8
TRENDING CITY JOURNEYS: 10
TRENDING DISTRICT JOURNEYS: 6
CITIES TESTED: 7 driven (الرياض جدة الدمام الخبر أبها المدينة المنورة مكة المكرمة) + 10 read in trending lists
REGIONS TESTED: 5 (الرياض · مكة المكرمة · الشرقية · عسير · المدينة المنورة)
AF FIELDS TESTED: 8/8 live-reachable (street width · amenities×9 · bathrooms · property age ·
                  direction · RNPL · furnished · bedrooms) of the 10 the registry monitors
INTENT→UI MISMATCHES: 0
UI→REQUEST MISMATCHES: 0
REQUEST→RPC MISMATCHES: 0
RPC→DB MISMATCHES: 0
COUNT MISMATCHES: 0
STALE COUNTS: 0
INELIGIBLE RESULTS: 0
DUPLICATES: 0
UNKNOWN/FALSE VIOLATIONS: 0
BUGS FOUND: 1 (barrier defect — an alert that could not tell two opposite causes apart)
BUGS FIXED: 1
BUGS REMAINING: 0
BARRIERS ADDED/STRENGTHENED: 2 (detector payload + new offline verifier in `npm test`)
MUTATION-PROVEN: YES
MERGED: pending CI (PR opened)
DEPLOYED: NO — no `src/` change required one
PRODUCTION VERIFIED: YES
```

**ALL GOOD: YES.** Every AF, Trending and count behaviour tested was exact against an independent DB
oracle. The one defect found was in a *barrier*, not in the product, and it is fixed, mutation-proven
and live. Two items are recorded as owner questions, not defects (§5).

---

## 1. What the run proved (INTENT = UI = REQUEST = RPC = DB = RESULTS)

### Advanced Filter — interaction contract, live browser

| behaviour | result |
|---|---|
| single tap = select only | ✅ chip 1,417 → 693, question unchanged, checkmark + bold label appear |
| double tap = select + advance **exactly one** | ✅ street width → amenities, never two |
| Continue | ✅ |
| Skip applies no predicate / changes no count | ✅ Dammam, **5 consecutive skips, chip stayed 2,655 throughout** |
| Back restores previous question **and** its answer | ✅ back×2 restored kitchen+elevator, then stw15 |
| earlier answer re-entered ⇒ later predicates dropped | ✅ chip at Q1 = 1,285 (stw only), not the stale 101 |
| Back at the first question exits to pre-AF controls | ✅ AF card gone |
| Arabic only (AF card) | ✅ no English on any card |

### Advanced Filter — counts against an independent oracle

Riyadh · بيع · فيلا/تاون هاوس/بيت · 4 beds. Every number below was re-derived by raw set-math over
`search_listings_ar` that never calls the AF count RPC:

| surface | UI | RPC | independent DB |
|---|---|---|---|
| base | 1,417 | 1,417 | **1,417** |
| street width ≥15 / ≥20 / ≥25 / ≥30 | 1,285 / 693 / 126 / 102 | same | **1,285 / 693 / 126 / 102** |
| kitchen (base) / elevator (base) | 457 / 115 | same | **457 / 115** |
| stw15 + kitchen | 403 | 403 | **403** |
| stw15 + kitchen + elevator | 101 | 101 | **101** |

- **Multi-amenity is AND, not OR** — proven numerically: the OR of the same two amenities is 409.
- **UNKNOWN stays UNKNOWN** — 42 street-width-unknown and 909 kitchen-unknown rows are excluded from
  every option count and from the strict predicate. None is coerced to false, and the base 1,417 >
  1,285 shows unknowns are not swept into a bucket either.
- **Results honour the committed state**: «عرض النتائج» returned 101 rows for a chip of 101 and a
  `total_count` of 101; all 101 checked row-by-row in DB — 0 violated any predicate, 0 duplicates.

### Trending Cities — 10 filter states

Every state's rendered rows equalled the `top_cities_by_deal_ar` response exactly, and the request
carried the complete filter state (types, beds, area, price, deal, rent period, category):

bare · bedrooms · area · price · bedrooms+area+price+group · rent-annual · rent-both-periods ·
Buy+Rent combined · commercial · rent+apartments+bedrooms.

**Five click-throughs landed exactly on the advertised number**: 37,121 (Riyadh) · 118 (Dammam,
stacked) · 3,499 (Khobar, rent) · 1,463 (Madinah, commercial) · 100 (Makkah, 2-bed apartments).

Seven cohorts were then re-derived independently in SQL — all exact. A structural cross-check also
held: Riyadh buy 37,121 + rent-all-periods 31,033 = combined-mode 68,154, confirming combined mode is
genuinely the union and not a differently-scoped query.

### Trending Districts — 6 journeys

- Live counts replace scope counts under narrowing: one real `location_search_candidates_ar` per row
  (Riyadh 6/6, Khobar 6/6, Dammam 6/6). No row fell back to a scope count.
- **Advertised = click-through, 4/4**, including the extremes: Dammam حي طيبة advertised **1** and
  landed **1**; Khobar حي الثقبة advertised **117** and landed **117** on mobile.
- **Honest zero over false fallback** — Jeddah, 3 beds, typed «ال»: six districts rendered
  «لا توجد إعلانات هنا حالياً» instead of a count. DB confirms all six are genuinely 0.
- Merged name variants are exact: Jeddah «الصفاء» advertises 409 = 304 (`صفاء`) + 105 (`صفا`), the two
  tokens its `match_values` merges.
- Mobile (390×844) and non-Riyadh coverage: Khobar, Abha, Jeddah, Dammam.

---

## 2. The one defect: a barrier that could not tell two opposite causes apart

**What was wrong.** `mon_af_new_listing_readiness()` §B raised
`af_new_listing_capture_regression` on `wasalt_commercial_listings/property_age` for two certified
segments — إيجار/سنوي/مكتب (fresh-48h known 19% vs 94% all-time) and .../معرض (22% vs 91%). The signal
was correct. Its *explanation* was not: the alert said "the scraper likely stopped capturing it" and
offered one escape hatch — acknowledge it in `ops_amenity_capture_verified` "if PROVEN source-side".
Both readings were wrong here, and each would have caused real damage.

**Root cause of the underlying data state.** Not a parser bug and not a source change. Every one of
the 94 `wasalt_commercial_listings` rows added since 2026-08-22 carries `enrich_attempted_at` (the
enrich job ran, and is still running — last attempt 05:02 UTC today) with `detail_enriched = false`:
`fetch_detail()` returned not-ok (network/403/block) on every one. `scrapers/wasalt/enrich.py` writes
`property_age` **only** on the ok+deep branch, so the column stays NULL — correctly UNKNOWN, never
guessed. The platform simultaneously carries open `proxy_block_spike`, `rows_collapse` and
`silent_partial_success` alerts. **The root cause is egress, and it belongs to the scraping routine.**
The cliff is exact: ~100% age capture through 2026-08-21, 0% from 2026-08-22 on.

**Why nothing was repaired.** The list-page payload does carry a `completionYear`, and backfilling
from it would have "fixed" the alert instantly — but `scrapers/wasalt/run.py` documents that the
search-list enum is *corrupt* and that only the detail-page string is authoritative. Filling
`property_age` from it would have been fabrication. The rows stay UNKNOWN, and they stay queued for
retry (`detail_enriched=false`), which is the correct end state.

**The fix (barrier, not data).** The detector now reads the raw row and names which failure it found.
Nothing about *when* it fires changed — same condition, severity, dedup key and resolve path; this
deliberately suppresses nothing, because silencing a barrier to make it green is forbidden and making
it distinguish cases is the actual fix. The payload gains:

| field | meaning |
|---|---|
| `capture_state` | `upstream_fetch_incomplete` \| `fetched_but_field_absent` \| `unknown_no_fetch_columns` |
| `fresh_rows_never_detail_fetched` | rows in *this* segment's 48h window with `detail_enriched=false` |
| `last_enrich_attempt_at` | proves whether the enrich job is even still trying |
| `adjudicate` | what to do — and explicitly what **not** to do — for that state |

For `upstream_fetch_incomplete` the routing line says, in the alert itself: fix egress; do **not**
rewrite a parser; and do **not** waive it in `ops_amenity_capture_verified`, because a source-side
waiver is permanent and would mask the real regression the day egress recovers. This is the owner's
permanent rule of 2026-08-13 — *"a missing captured field is NOT evidence that the source omits it —
a failed fetch looks identical"* — moved from prose an engineer must remember into the alert itself.

**Cost containment.** The discriminator query runs on the **raise path only** (2 executions in today's
entire sweep), never in the per-segment × per-field scan. Deliberate: the twice-hourly sweep already
runs near its `statement_timeout` (open `detector_sweep_budget` alert), and an aborted sweep rolls
back every alert it had raised.

**Production verification.** Ran live: both segments now classify as `upstream_fetch_incomplete` with
`31 of 31` and `37 of 37` fresh rows never detail-fetched, carrying the correct routing text.

**Barrier + mutation proof.** New `scripts/verify-af-capture-state-discriminator.ts`, wired into
`npm test`. It pins the classification math (10 cases, including the int-rounding boundary where
16/31 is upstream and 15/31 is not — each expectation checked against the identical CASE expression
evaluated in Postgres, not just against the TypeScript re-implementation), and it pins the raise
condition in the other direction with a **SILENCER GUARD**: no `capture_state`/`fetch_state`/
`never_fetched` term may ever appear in the `if` that decides whether to raise. Mutation-proven by
deliberately breaking the shipped SQL three ways —

| mutation | verifier |
|---|---|
| discriminator added to the raise condition (classifier → silencer) | 🔴 SILENCER GUARD fails |
| `adjudicate` routing line removed | 🔴 fails |
| column guard removed (would query platforms lacking the columns) | 🔴 fails |
| restored | 🟢 all pass |

plus five mutations of the classifier itself (always-upstream, always-fetched, null-treated-as-fetched,
`>` for `>=`, floor for round) — every one caught.

---

## 3. Two observations recorded for the owner — neither changed

**(a) Trending district rows keep their scope-popularity rank while showing narrowed counts.** Under
narrowing the numbered list can read `5. حي طويق 21` above `6. حي العارض 69`. The counts themselves
are exact (both were click-through-verified), and the behaviour is consistent, not random: the rank
means "most active districts in this city", the number means "matches under your filter". A user
reading it as one ranked list will find it contradictory. Re-sorting by live count is a **product
decision** about what "trending" means, so nothing was changed.

**(b) The PDPL redaction marker renders as the English literal `[redacted]`** inside otherwise
Arabic descriptions (e.g. «للتواصل والاستفسار [redacted]»). It is written at ingestion by
`scrapers/common/pii.py` (`_REDACTED = "[redacted]"`) — 6,650 of 94,249 active aqar residential rows
carry it, and every platform uses the same constant. Changing it is not an AF fix: it needs a product
call on the Arabic wording, a rewrite of stored descriptions across all platforms (a bulk data
operation), **and** an edit to the literal that the PII barrier tests assert. All three are outside
this routine's authority, so it is escalated rather than touched.

---

## 4. Adjacent state noted, not acted on

- `migration_drift` is **red** (P1, 7 migrations applied to prod today with no git file: detector
  timing, loc_rel ×3, aqarcity index, card_link_identity). None of them are this routine's — they
  belong to the sessions that applied them this morning, two of which have open PRs (#1077, #1082).
  This run's own migration is mirrored in the same PR that carries it, so it adds no drift.
- wasalt carries open `proxy_block_spike` / `rows_collapse` / `silent_partial_success` / `stale_active`
  alerts. That is the scraping routine's, and it is the upstream cause of §2.
- No DB saturation observed at this routine's 11:00 UTC start (1 active query), so no restagger is
  needed against the junior scraper sharing the slot.

## 5. Coverage ledger

24 rows written this run under the `af_*` / `trending_*` dimensions (`ops_qa_coverage_ledger`),
including the two observations above marked `observed` rather than `pass` so they stay visible.
