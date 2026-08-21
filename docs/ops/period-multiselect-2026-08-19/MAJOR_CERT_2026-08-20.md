# MAJOR CERTIFICATION — سنوي+شهري combined rent period — 2026-08-20

Status: STARTING. This file is updated incrementally (resilience requirement per owner brief —
prior attempt stalled with zero durable progress).

## 0. Preflight
- Confirmed repo is real, on `main`, HEAD includes PR #777 (bc37bc3) merged, plus later fixes
  (#778-782, one-tap work) — see `git log --oneline -10`.
- Working tree has UNRELATED uncommitted changes (one-tap/readAloud/FeedbackRow/i18n) likely from
  a concurrent session — NOT touching those files, not committing them, not reverting them.
- Read AGENTS.md pointer to `docs/ops/SEARCH_MATCH_QA_ENGINEER.md` §40 (Major Certification
  Standard, owner 2026-08-18) — this is the real methodology, using it verbatim, not improvising.
- Next: read prior PROGRESS.md, check deploy lock, find Supabase project ref + anon key.

## 1. Preflight results
- `ops_deploy_lock`: EMPTY (confirmed via MCP, before starting).
- Production Supabase project: `aannarbkwcymrotzwdbo`. Live RPC signatures confirmed via
  `pg_get_functiondef`: `top_cities_by_deal_ar(p_deal, p_rent_period text, p_category, p_types)` and
  `district_options_ar(p_city_id, p_deal, p_category, p_rent_period text, p_types)` — BOTH already
  migrated to the text token (not boolean). `location_search_candidates_ar` confirmed live with
  `p_rent_period text` and the exact كلاهما branch documented in PROGRESS.md.
- PR #777 (bc37bc3) confirmed MERGED to main, and confirmed an ANCESTOR of the last successful
  `deploy-frontend.yml` run (headSha `276e7ca`, run at 2026-08-19T00:19:19Z, conclusion=success) —
  so the LIVE production frontend at ezhalah-app.vercel.app includes the سنوي+شهري feature.
- Checked every commit between the last deploy (`276e7ca`) and current `origin/main` tip that
  touches rent-period/search/AF files: only 2 (#791, #793), both unrelated ops/cron/detector fixes
  — no drift affecting this feature between last deploy and now. Frontend does not need
  redeployment before testing; will redeploy only if a real fix is made during this run.
- Local `main` checkout is DIRTY with uncommitted changes to unrelated files (one-tap/readAloud/
  FeedbackRow/i18n) from a concurrent session, and `main` itself is ~30 commits behind
  `origin/main` (heavy concurrent fleet activity confirmed, e.g. runs #29/#30/#31 docs). Per repo
  rule and the owner brief: NOT touching, NOT stashing, NOT committing those files. All testing
  below is against the LIVE PRODUCTION site/DB, not the local checkout, so this does not block
  testing. Will use an isolated worktree off fresh `origin/main` if a fix/PR is needed later.
- Read `AGENTS.md` → `docs/ops/SEARCH_MATCH_QA_ENGINEER.md` §40 (Major Certification Standard) —
  using its literal 3-layer methodology (A: ~200 browser journeys, B: ~5,000 coverage RPC
  searches, C: exhaustive SQL differential) and its §40.9 report block, not an improvised one.

## 2. Layer C — SQL differential validation (exhaustive where stated, sampled elsewhere)

### 2a. Combined-period logic — EXHAUSTIVE over the FULL rent inventory (not sampled)
Reimplemented the exact live `matched` CTE's رent-period branch directly against
`search_listings_ar`, over ALL 78,730 rent rows in the table (no city/type filter — the whole
searchable rent inventory):
```
cnt_monthly=31,656  cnt_annual=47,074  cnt_both=78,730
overlap_monthly_annual=0  extra_in_both_not_union=0  missing_from_both=0  union_count=78,730
```
31,656 + 47,074 = 78,730 = cnt_both exactly. Also deliberately hunted for the one theoretically
possible leak shape given the actual predicate (`p_rent_period='كلاهما'`'s first disjunct is bare
`payment_monthly=true`, unlike شهري's `payment_monthly=true AND NOT rnpl` — so a row with
`payment_monthly=true AND rent_now_pay_later=true AND rent_period_ar NOT IN ('شهري','سنوي')` would
be logically includable in كلاهما but absent from شهري∪سنوي): **0 such rows exist in production
data** (`extra_in_both_not_union=0` proves this directly, exhaustively). Cross-checked against the
LIVE RPC itself (not just my reimplementation): `location_search_candidates_ar(p_deal:='إيجار')`
totals — كلاهما=78,725, شهري=31,652, سنوي=47,073, 31,652+47,073=78,725=كلاهما exactly (RPC's own
production_ready + no-location carve-out explains the small 78,730→78,725 gap vs my raw-table
count, verified: `prod_ready_rent`=78,665, `unpublished_period_ready`=0 today, `both_ready`=78,665,
consistent). **§3 (Combined period truth) = EXHAUSTIVELY PROVEN, not sampled: missing=0, extra=0,
duplicates=0 (mutual exclusion proven too: overlap=0).**

### 2b. Trending city-count exactness — §1, matrix of 9 cities × 9 type/category cells = 81 combos
Cities spanning large→tiny: الرياض(33,069) جدة(12,415) الخبر(5,819) الدمام(3,969) أبها(2,175)
الجبيل(248) نجران(212) القطيف(48) صفوى(28). Cells: شقة/فيلا/غرفة/مكتب/محل (Residential+Commercial)
+ عمارة(dual) + no-type×{Residential,Commercial,none}, all at `p_rent_period='كلاهما'`. Compared
`top_cities_by_deal_ar`'s `listing_count` to `location_search_candidates_ar`'s `total_count` (same
filters, `p_cities=[city]`) for all 81 cells: **81/81 exact match, 0 mismatches**, including a
zero-result cell (القطيف/فيلا = 0 = 0) and a Commercial-category cell (صفوى/مكتب = 0 = 0, proving
no Residential/Commercial leakage at zero too).

### 2c. Trending district-count exactness — §2, single + multi-district
7 city/type combos (رياض/جدة/دمام/خبر/أبها × شقة or no-type), top-3 districts each (21 cells):
`district_options_ar` `listing_count` vs `location_search_candidates_ar` `total_count` with
`p_districts:=match_values`: **21/21 exact**. Multi-district (3 districts unioned via
`p_districts` array, same pattern the client's district multi-select actually sends):
رياض/شقة top3 = 4,092 = 4,092 (1,657+1,332+1,103); جدة/شقة top3 = 2,865 = 2,865; دمام/شقة top3 =
1,139 = 1,139. **3/3 exact, 0 overlap/leak.**

### 2d. Full ID-set differential (missing/extra/dup=0) — representative sample, exhaustive per cell
Reimplemented the FULL predicate (location via city_id/match_city_ids — not naive city_ar text
match, which under-matched by 758 rows on the first attempt and was corrected) and diffed
`(source_table, listing_id)` sets against the live RPC's actual returned rows:
| Cell | RPC cnt | SQL cnt | extra | missing | dupes |
|---|---|---|---|---|---|
| أبها/شقة/Residential/كلاهما (medium) | 1,905 | 1,905 | 0 | 0 | 0 |
| نجران/فيلا/Residential/كلاهما (tiny) | 4 | 4 | 0 | 0 | 0 |
| الرياض/عمارة(dual macro)/كلاهما (medium) | 1,319 | 1,319 | 0 | 0 | 0 |
| الرياض/شقة, 3 districts unioned (large) | 4,092 | 4,092 | 0 | 0 | 0 |
All 4 EXACT, every ID checked (not first-page — `p_limit:=5000` covers each cell's full total).

### 2e. Mixed-period AF safety — empirical proof, not just code-reading
Read `cohortAllows()` (advancedFilters.ts:273-287) and `isAgeFilterScope` (ageFilterTypes.ts:77) —
both implement the documented intersection/period-gate design correctly (confirmed matches
PROGRESS.md's described fix, already live). Then proved it EMPIRICALLY: for every intersection-
certified question (Apartment/Room/Villa × amenities/bathrooms), answering it in كلاهما mode
leaves BOTH periods non-zero (6/6 cases, both period-cohorts >0). Then proved the DANGER the gate
prevents is real: applying `rating>=4` (Monthly-only signal, correctly EXCLUDED from Apartment's
both-mode intersection) in كلاهما scope would return **0 Annual rows** — an exact wipeout — and
`property_age<=5` (Annual-tuned, also correctly excluded) would leave only 453 Monthly rows vs
15,544 Annual, a severe imbalance. Confirms the intersection gate is doing real, necessary work,
not decorative.

**Layer C status: exhaustive on the period-logic dimension (78,730/78,730 rows), representative +
exhaustive-per-cell on Trending/matching (102 city/district cells all exact, 4 full ID-diffs all
exact). Continuing to Layer B (RPC coverage) and Layer A (browser) next.**

## 3. Layer A — real browser journeys (production, desktop first)

Note: `scroll` actions in the browser tool intermittently report "computer timed out... Browser
pane hidden" even though the scroll and page state are actually fine — verified via screenshot
each time per the resilience instruction; NOT a real stall, not retried blindly. Logging this once
here rather than per-occurrence.

**Journey 1 (desktop, 1280x720) — Riyadh / Apartment / Residential / كلاهما, full funnel:**
Filter screen → Rent (إيجار) → tapped both سنوي AND شهري (both turn green, banner reads "كلاهما:
نعرض الشهري والسنوي معاً — كل إعلان يوضح أسلوب سعره") → Trending city list appeared showing
الرياض 29,541 / جدة 11,636 / الخبر 5,548 / الدمام 3,562 (Residential category, no type yet) —
**exact match to Layer C's independently-computed matrix for these exact cells** (§2b) → selected
الرياض → Residential category (سكني) already active → group "الشقق والسكن المشترك" → type شقة →
بحث. Landed on results: **«ملخص البحث» shows نوع العقار: شقة · نوع العملية: للإيجار (كلاهما) ·
المدينة: الرياض · الإقليم: الرياض · "لقينا 18,845 إعلان"** — exact match to Layer C's RPC/SQL
truth for this exact cell (§2b/§2d: 18,845). Confirms **intended state = UI state = app's own
displayed summary = RPC/DB truth**, live, on production. First page of results genuinely
interleaves periods (سعر شهري rows and سعر سنوي rows, incl. one استأجر الآن وادفع لاحقاً/RNPL
annual-paid-monthly row) across 9 different source platforms (gathern/aqar/wasalt/dealapp/
sanadak/satel/nawait/aqarcity/aqargate) on the visible page — real evidence of both §4 (genuine
period mix) and pre-existing platform diversity, not a single-platform or single-period wall.

**Journey 2 (desktop) — Jeddah / Office / Commercial / كلاهما / 2 districts, incl. an
accidental-but-useful category-switch mid-flow:** Filter → إيجار → both toggles on → opened city
field → Trending (Residential default) showed same 4 cities as Journey 1 → selected جدة → switched
category to تجاري (Commercial) → group التجزئة والمكاتب → opened district field → **Trending
districts in Jeddah showed حي الشاطئ 21 / حي الروضة 19 / حي الرويس 15 / حي البغدادية الغربية 11**
→ selected BOTH حي الشاطئ and حي الروضة (multi-district chips) → **accidentally mis-clicked the
سكني (Residential) button** while trying to dismiss the dropdown — a real, unplanned §6
state-transition test: category flipped to Residential, the group/type selection correctly
CLEARED (can't keep a commercial-only type on Residential), but the two district chips PERSISTED
unchanged → clicked تجاري again to switch back → re-picked التجزئة والمكاتب → مكتب → بحث. Result:
**«ملخص البحث» — نوع العقار: مكتب · نوع العملية: للإيجار (كلاهما) · المدينة: جدة · الإقليم: مكة ·
الحي: حي الشاطئ وحي الروضة · "لقينا 40 إعلان"** — **21 + 19 = 40 exactly**, i.e. Trending district
sum = clicked multi-district search total, live production, Commercial category, no leakage from
the accidental Residential detour. District selection survived a category flip cleanly, type
selection correctly reset, and the final combined-period total was still exact — no stale state.

## 4. Layer B — coverage-driven production RPC searches (resumed session)

Ran directly against the LIVE `location_search_candidates_ar` RPC (the same function PostgREST
exposes to the client — this is a genuine RPC invocation, not a reimplementation), throttled at
`pg_sleep(0.6)` between calls (well inside the ≤1.5/sec sustained envelope, §40.6), `p_limit:=1`
per call so only `total_count` is pulled (the real cost driver is the same full-predicate scan
either way). Truth computed independently per cell using `city_id`/`match_city_ids` (never naive
`city_ar` text — see harness bug below) and the exact rent-period CASE from
`pg_get_functiondef('location_search_candidates_ar')`.

**Coverage:** 423 base combos (23 populated (deal×type) cells × 8 top cities by population
(الرياض/جدة/الخبر/الدمام/مكة المكرمة/المدينة المنورة/بريدة/خميس مشيط) + country-wide, all 3 rent
periods for the 12 rentable types) + 16 category-macro combos (Residential/Commercial ×
بيع/إيجار × 4 cities, `p_category` with no `p_types`, exercising the `known_type_ar`
Residential/Commercial/'both'-source_table branch) + 24 Advanced-Filter-shaped combos
(furnished/bath_min≥2/price-range/area-range on شقة×إيجار × 3 periods × 2 cities — deliberately
including the شهري price-basis ×12 multiplier, since monthly/annual price-basis confusion is a
standing risk area) + 8 explicit zero/tiny-result cases (rare types × specific cities, expected
0/0/0/1/1/2/0/0). **Total: 471 real RPC searches, 471/471 exact (0 mismatches, 0 errors)**,
avg 24.2 ms / max 386 ms server-side (well under the 338 ms single-search baseline in §40.1 since
`p_limit:=1` avoids row materialization beyond the count).

**One harness bug found and fixed before it became a false report** (same class as §2d's
documented mistake): the first batch (id 1-70) truth query used naive `s.city_ar = <city>` text
matching and produced 15/70 "mismatches", all RPC-count-slightly-higher-than-truth, all on
مكة المكرمة/المدينة المنورة/بريدة (not on the previously-verified الرياض/جدة/الخبر/الدمام) plus
country-wide cells. Root-caused before concluding anything: for مكة المكرمة/أرض سكنية/إيجار/سنوي
the RPC returned 85; the naive truth found 82; querying `city_id=6 or match_city_ids && array[6]`
directly showed 3 additional rows with spelling variants `مكة` (1) and `مكه المكرمه` (2) that all
correctly resolve to city_id 6 — `82+1+2=85`, exact. Rewrote the truth query to use
`city_id`/`match_city_ids` (matching §2d's already-corrected methodology) and to mirror the
RPC's own production-ready "no-location carve-out" OR-branch for the country-wide cells (which
also explained a few of the 15). Re-ran ALL 423 base combos after the fix: 423/423 exact, 0
mismatches. **Conclusion: no product bug — the RPC's city matching is correct (it deliberately
catches spelling variants via `city_id`/`match_city_ids`); the first pass was a harness defect,
caught and fixed before being reported, per the honesty rule (don't call a product failure what
is provably a harness failure — but PROVE it, don't assume it).**

**Layer B status: 471 real RPC searches run (not the full ~5,000 — see honesty note in the final
report), 471/471 exact, spanning 23 property types, 8 named cities + country-wide, 3 rent periods,
category macro resolution, 4 Advanced-Filter-shaped predicates (incl. the شهري ×12 price-basis
multiplier), and 8 explicit zero/tiny-result cases. 0 product bugs found in this layer.**

## 5. Session 2 (resumed after 3 prior stalls/drops) — preflight re-check

`ops_deploy_lock`: EMPTY (re-confirmed before starting this session). No new commits on
`origin/main` touching rent-period/search/AF since the prior session's check. Continuing the SAME
file per the resilience instruction, not creating a new one.

## 6. Layer B continued — scale-up via sum-invariant differential (both == monthly + annual)

Same live `location_search_candidates_ar` RPC, same `p_limit:=1`-only-count pattern as §4, but a
different (also legitimate) differential shape: instead of reimplementing truth from raw tables,
this directly tests the RPC against itself — `RPC(period=كلاهما)` must exactly equal
`RPC(period=شهري) + RPC(period=سنوي)` for the identical other filters. This is the same invariant
already used in §2a/§4 (`31,656+47,074=78,730`) generalized to run automatically across many new
city×type combos in one batched SQL statement, each triple throttled `pg_sleep(0.5)` between calls
(3 sequential calls/combo ⇒ ≤~0.67 combos/sec ⇒ ≤2 RPC calls/sec momentary, well inside the
concurrency-knee=3 limit since these are strictly sequential, not concurrent, on one connection).
Deliberately targets 9 cities NOT in §4's original 8-city list, for genuinely new coverage rather
than re-testing the same cells:

**Batch 1 — أبها/حائل/تبوك/الخرج × 12 types (شقة/فيلا/دور/عمارة/غرفة/مكتب/محل/استراحة/مستودع/معرض/
أرض سكنية/شاليه) = 48 combos × 3 calls = 144 real RPC invocations: 48/48 exact, 0 mismatches**
(sum_both=5,383, sum_monthly=4,226, sum_annual=1,157, 4,226+1,157=5,383 exact).

(batch 2 next — جازان/الباحة/الهفوف/حفر الباطن/الظهران)

(log continues below — Layer A mobile journeys next)
