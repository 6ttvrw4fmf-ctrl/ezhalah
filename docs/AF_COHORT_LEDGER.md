# Advanced Filter — Cohort Certification Ledger

One row of truth per (property type × deal) cohort. **This file + `public.af_cohort_registry` are
the control plane**: a cohort is protected by the barrier fleet the moment its registry row exists,
and a cohort's questions are governed by `COHORT_QUESTIONS` in `src/data/advancedFilters.ts`.
Future sessions: read this before touching the Advanced Filter. Amend it in the same PR as any
cohort change.

## Architecture (shared by every cohort — never forked)

- **Normal Filter → exact candidate set → contextual interview → narrower results.** Advanced
  answers only ever NARROW; they stack on top of every Normal selection (city/district/category/
  type/deal/period/price/area/bedrooms). MATCH FIRST → THEN DIVERSITY.
- One question pool (`ADVANCED_QUESTIONS`), one card, one orchestrator. A cohort turns questions on
  via `COHORT_QUESTIONS[type][deal]` (availability); `scoreQuestion()`'s live gates decide whether a
  question is actually asked in the user's current scope (>25 scope, option ∈ [max(15,8%N), 90%N],
  one option ≤75%N). Installments (`rnpl`) carries the ask-first tier — first when it earns it.
- Counts come only from the 4 shared RPC surfaces (`af_eligibility_clause` → `rebuild_af_filter_rpcs`).
  Chip == results == referee == DB truth is the certification bar for every enabled question.
- Unknown ≠ no, everywhere. Never invent a value (no payment frequencies, no guessed cities).
- **Monthly Rent is FROZEN** by owner order — no cohort key exists for it anywhere.

## Certified cohorts

### شقة / Apartment — RENT ANNUAL — ✅ CERTIFIED 2026-08-15 (the template)
- Questions: rnpl (ask-first) · property_age · amenities · bathrooms · furnished.
- Full battery: counts exact 4-way, 91,527 rows row-checked 0 violations, stacking, skip, pills,
  paging, diversity, unknown≠no, new-listing inheritance, barrier mutations. PRs #606/#608/#621/
  #623/#625/#628/#630/#633/#636.

### شقة / Apartment — BUY — ✅ CERTIFIED 2026-08-15 (PASS, n=34,069)
- Types بيع: شقة · مبنى شقق مخدومة · ملحق علوي. Coverage: age 90% · direction 50% · kitchen 34% ·
  elevator 29% · private entrance 29% · bathrooms 26%. RNPL/furnished: correctly absent (rent
  concepts; Buy furnished ≈2%).
- Questions: property_age · amenities · bathrooms · **direction** (new).
- Battery: all chips == af_eligible == candidates total == rows == direct SQL at nationwide + Riyadh;
  price/beds/stacking exact; garbage tokens fail closed.

### دور / Floor — RENT ANNUAL — ✅ CERTIFIED 2026-08-15 (PASS, n=3,638)
- age 93% · RNPL 83% known with **64% yes** · AC 76% · private entrance 76% · bath 66%.
- Questions: rnpl (ask-first) · property_age · amenities · bathrooms · furnished.
- rnpl chip 2,335 == applied results == referee == direct SQL, 0 row violations; full 4-way
  equality nationwide + Riyadh; stacking subsets proven by anti-join.

### دور / Floor — BUY — ✅ CERTIFIED 2026-08-15 (PASS, n=11,867)
- age 85% · private entrance 39% · bath 30%. Questions: property_age · amenities · bathrooms.

### عمارة سكنية / Residential Building — RENT ANNUAL & BUY — ✅ CERTIFIED 2026-08-15
- RENT-ANNUAL PASS n=3,202 · BUY PASS n=6,334 (types: عمارة · مجمع سكني · مجمع · برج).
  **street width 96-97% · direction 83-84% · age 89-91%** — completely different signature from
  Apartment (bathrooms 1%: a building has no meaningful bathroom count — deliberately no bathrooms
  question). RNPL yes ≈0 → no installment question.
- Questions: property_age · **street_width** (new ladder ١٥/٢٠/٢٥/٣٠ م فأكثر) · **direction** ·
  furnished (rent only).
- Set equality proven by md5(sorted ids) vs direct SQL on every combo; stw ladder monotonic;
  0 commercial-table rows in any result set.

### غرفة / Room — RENT ANNUAL — ✅ CERTIFIED 2026-08-15 (PASS, n=1,774)
- **kitchen 85% (its signature)** · age 94% · furnished 49%. bathrooms 0%.
  RNPL known 95% but only 5% yes → the floor gate would hide it everywhere; deliberately not offered.
- Questions: property_age · amenities · furnished. md5 set-equality at both scopes.

### استوديو / Studio — RENT ANNUAL (minimal) — ✅ CERTIFIED 2026-08-15 (PASS, n=30)
- Types: استوديو · ستوديو · شقَّة صغيرة (استوديو). Barely above the >25 floor; most gates will
  suppress most questions. Enabled minimally (property_age · amenities · furnished) so the engine
  can serve it if inventory grows. Engine counts verified exact at n=14 Riyadh (gate suppression is
  client-side by design).

## Verifier's corrected NATIONWIDE oracle (use this, not the strict predicate)
The strict oracle (`production_ready AND city_id/region_id NOT NULL` + category purity + period
clause) is exact at ANY city/district/region scope, but NATIONWIDE the shared eligibility layer
deliberately also admits non-production_ready rows with unresolved location (locked
«unresolved-location-countrywide» product decision). Add this OR-branch for countrywide oracles:
`(not s.production_ready and (s.region_id is null or s.city_id is null)
  and not search_row_price_gated(s.deal_ar, s.price_total))`
Two 2026-08-15 verifiers independently rediscovered this (deltas of 2 and 8 rows, each reconciled
row-by-row). Chip==RPC always; only a strict-oracle comparison shows the phantom gap.

## Deliberately NOT claimed
- Annual «مبنى شقق مخدومة» / «ملحق علوي» — the annual battery certified شقة only; certify before
  adding registry rows.
- غرفة/Buy (n=1), استوديو/Buy (n=2) — no real market; genuinely N/A.
- All Monthly-Rent cohorts — FROZEN by owner. NOTE 2026-08-15: the شهري bucket's read-side RNPL
  guard (payment_monthly AND NOT coalesce(rent_now_pay_later,false)) was silently lost on 08-11 when
  the canonical clause was written without it; restored via clause→rebuild
  (20260815021419 + replay checkpoint 20260815021440). The replay-checkpoint pattern is what exposed
  it — after any dynamic rebuild migration, record a literal checkpoint so repo truth == live truth.

### Registry state (2026-08-15)
18 enabled rows in `af_cohort_registry` (migration 20260815022835): the original إيجار/سنوي/شقة
plus 17 rows covering every certified cohort above, one row per attested DB type_ar value.
Mutation-proven: with Floor/Rent-Annual isolated and its interview fields blinded,
mon_rich_attrs_barrier fired on the second run (drift contract: run1 records, run2 alarms) and
rolled back. Dry-run before insert: readiness=0, rich=0, parity=0 with all rows present.

## New-question source map
- `street_width` ← `search_listings_ar.street_width_m` (raw source field; ladder = cumulative ≥,
  strict, unknown excluded) → `p_street_width_min` + `cnt_stw15/20/25/30`.
- `direction` ← `norm_direction_ar(direction_ar)` (8 normalized source values, multi = OR)
  → `p_directions` + `cnt_dir_{n,s,e,w,ne,nw,se,sw}`.
- Both added by migration `guided_counts_add_direction_and_street_width` via template+rebuild.

## aqar per-segment amenity source change (RESOLVED 2026-08-15 — do not re-investigate)
Aqar changed its ad-form composition ~2026-06-21 (weekly first-seen series breaks at Jun 22;
scraper code unchanged Jun–Jul): kitchen + elevator checkboxes removed from دور forms (both
deals), air-conditioner removed from بيع forms (both types). Proof: the SAME fresh rows parse
age ~100% / private_entrance ~83% / rent-side AC 84% on the same code path, and raw == index
byte-for-byte — the payload is read; only those keys stopped arriving. These columns are
structured-only by design (prose is NOT a source field), so the honest value is UNKNOWN and the
correct backfill from published fields is ZERO rows. Old TRUE values (June bulk era, e.g. دور/بيع
kitchen 43% all-time) predate the form change and stand as captured; they will decay out
naturally and the affected chips gate out honestly. Acknowledged per (platform, field, segment)
in `ops_amenity_capture_verified` (evidence in each row's note). Readiness check B is now
per-cohort-segment (migration 20260815130215) — the pooled version let شقة's healthy 90% mask
دور's 0%; mutation-proven: waivers stripped → exactly the 4 real segments fire; unrelated
segment blinded with waivers present → still fires.

## Backend certification audit — 2026-08-15 (9-agent sweep + inline mutations)
All 8 cohorts re-verified 4-way exact (af_eligible_count == candidates total == returned rows ==
independent SQL oracle) at nationwide + Riyadh, every chip == SQL, 20 stacked combos with full
row-level verification (0 violations), md5 set-equality on 8 combos. 12 adversarial probes: never
widened, never errored (garbage tokens/empty arrays/conflicts/overflow/RLM unicode/oversized
arrays all fail CLOSED; شهري+rnpl = 0 at the RPC surface). UNKNOWN sweep: 0 fabricated defaults
across 354 column instances on 35 tables; the only row-field `coalesce(...,false)` anywhere is the
3 documented rnpl exceptions per surface. New-listing trace: 10/10 fresh rows (aqar/wasalt/dealapp)
in-index with 9/9 AF fields exactly equal to raw (null==null); worst sync lag ~34 min (wasalt AR
enrichment queue, provably drains).

**Fixed during the audit (PR#674, migration 20260815215511):** the three hourly filter barriers
(predicate parity :43, normal-filter :41, parity-legacy :54) detected but never PAGED — they wrote
only location_pipeline_alerts, which alert-dispatch does not read. All three now mon_raise P1 on
detection. Added registry freeze-guards (a شهري row or enabled<18 pages P1 — raise the floor in
the same migration that adds cohorts) and gave mon_detect_orphaned_detectors an explicit
must-be-scheduled list for the 5 first-class AF barriers. Mutation-proven incl. the
dispatched-channel write; zero residue.

**API contract notes (documented behavior, not bugs):** `p_types: []` fails CLOSED (0 rows) — the
app sends null for "no type"; never send [] to mean "all". `p_directions: []` also fails closed
(asymmetric with other array params' cardinality-0 escapes); app skip omits the param. Array caps
(cities>200/districts>500/types>200/platforms>100) return 0 by design.

## الفلل والبيوت plan (profiled 2026-08-15 — NOT implemented)
Live types: **فيلا** 33.6k (99.84% of the family) · بيت 51 · تاون هاوس 3 · دوبلكس 65 · قصر 0
(taxonomy rawType maps to nothing live — do not build). Build exactly TWO cohorts:
- **فيلا × بيع (n≈27,249; aqar 50% + wasalt 40%):** age (≤2y 17.9k / 3–10y 7.0k, merge >10y 154 up),
  street_width (≤15m/16–20m/>20m all pass), direction (4 cardinals only; diagonals 484–771 fail the
  2,180 floor), **car_entrance مدخل سيارة (5,594/5,943 — villa gem)**, elevator-as-luxury
  (2,454/8,492), sanitation.
- **فيلا × إيجار سنوي (n≈5,935; 82% aqar):** age, AC (2,052/2,339 textbook), **RNPL ask-first
  (yes 3,908 = 66% of cohort — strongest RNPL market found anywhere)**, furnished, car_entrance,
  street_width (all 4 rungs), direction (cardinals), sanitation, living_rooms.
- **Must NOT copy from Apartment:** floor_number (0%), kitchen (no-side below floor — a no-option
  would make UNKNOWN behave as NO), maid/driver/private_entrance (publish-only-when-yes),
  furnished on Buy, elevator on Rent (yes 361 < floor 475).
- **Data-dead villa dreams (need scraper work first, not filter work):** pool/garden/majlis/
  total_floors/balcony all <5%; annex/apartments-in-villa/two-entrances have NO column anywhere.
- بيت/تاون هاوس/دوبلكس: searchable as normal, NO interview (n and coverage below every gate).
- All فيلا annual-rent rows are native سنوي (the شهري+RNPL branch contributes 0). Monthly stays frozen.

## فيلا / Villa — RENT ANNUAL & BUY — ✅ CERTIFIED 2026-08-16
- RENT-ANNUAL **PASS** (nationwide 5,938 / Riyadh 3,997, 4-way exact + md5 set-equality on all 6
  combo/scope pairs, 0 row violations). BUY **PASS** (27,304 / 11,346, full base-set md5 identity
  at both scopes, 3 combos md5-equal, 0 violations, Rent/Buy isolation + Gathern-not-in-Buy = 0).
- Fresh-listing trace 10/10 rows × 8 fields zero divergences (aqar typed columns; wasalt/dealapp
  resolver fidelity proven: facade/streetWidth/completionYear → index verbatim); counted-proof
  3-way exact at الخبر (242/126/89). Browser E2E on production: Buy 11,356→6,193→637 with every
  hop == referee, pills + removal recompute → 1,683 exact; Rent rnpl leads (2,923 of 4,023).
- Villa mutation spot-check: rich-attrs drift fired 0→2 in isolation, rolled back, zero residue.
- KNOWN NUANCE (honest, monitored): Villa/Buy AC chip counts are exact (644 NAT / 241 RYD) but AC
  is dead on FRESH Buy rows (waived source-side) — the chip is floor-suppressed at big scopes and
  can render in small scopes on pre-June listings until they age out.
- OWNER DECISION CANDIDATE: wasalt completionYear sometimes arrives as bare numerals ('2','11');
  the age resolver maps only string forms → NULL (fail-closed). Mapping bare numerals to years
  needs an owner call (ambiguous-mapping-ask-first).
- Types: فيلا (99.84% of family) + riders بيت/تاون هاوس (searchable, no questions). قصر = 0 live rows.
- Fresh-band profiling designed the questions (7d/48h first-seen, per platform):
  - RENT (n≈5,935; fresh 851): rnpl ask-first (74.7% of fresh known = yes — strongest RNPL market in
    the DB) · property_age · amenities (AC 74% fresh; kitchen 76%; مدخل سيارة 75%; صرف صحي 85%) ·
    bathrooms · furnished · street_width · direction.
  - BUY (n≈27,400; fresh 2,492): property_age · amenities (kitchen 51% fresh and RISING; NO AC —
    aqar dropped it from بيع forms, fresh 0.0%; NO rnpl — yes=0; NO furnished — yes below floor) ·
    bathrooms · street_width · direction.
- NEW amenity tokens (migration 20260815223500, template+rebuild, chips==direct==referee asserted):
  **car_entrance مدخل سيارة** (buy 5,594y/5,943n — near-perfect split) and **sanitation صرف صحي**
  (buy 7,377y/2,829n). Villa-scoped chips in AMENITIES_QUESTION (singleCleanType==='Villa') so
  certified cohorts' cards are unchanged. af_field_registry rows exposed (20260815224225).
- 3 new evidenced waivers (same aqar form-composition class): AC بيع/فيلا (fresh 0/1,378 vs 29%);
  private_entrance BOTH deals فيلا (0/2,012 fresh while the same rows parse age 100%/car_entrance
  84% — villa forms carry مدخل سيارة, not مدخل خاص).
- Registry: 6 rows (فيلا/بيت/تاون هاوس × rent-annual/buy), enabled floor raised 18→24
  (20260815223803); replay checkpoint 3 (20260815223522). Monthly untouched — no شهري row.

## Commercial + rural + land families — ✅ CERTIFIED 2026-08-16 (all 6 battery agents PASS)
~136 same-moment equality checks, 0 mismatches. Highlights: CommLand/Buy 17,511 five-way equal with
FULL base-set md5 identity (nationwide + Riyadh + Jeddah); ResLand/Buy 10,575 md5-identical; Office
rent 2,140 / Shop rent 1,982 full 32-chip row-diffs == SQL at both scopes; 20+ stacked combos
row-level verified 0 violations; skip-null == baseline everywhere; garbage → 0 everywhere;
unknown≠no partitions sum exactly (e.g. CommLand electricity 9,712y+2,445n+5,354null=17,511, and
p_furnished=false NEVER counts unknowns). عمارة CATEGORY ISOLATION proven: commercial-kind 11/49
vs residential 3,277/6,526, zero cross-table leaks. Gathern absent from every set. Fresh trace:
441/441 fresh rows present, 8-field parity 0 divergences (aqar/dealapp/wasalt), counted-proof exact,
pipeline lag <8h. Mutation spot-check (Shop rent isolated, utility fields blinded): rich-attrs
fired 0→2, rolled back, zero residue; previously certified stable (Apartment 9,907, Villa 11,346).
FOLLOW-UP (small, monitored): 10 fresh dealapp ResLand rows are location-unresolved
(production_ready=false) and their direction/street_width sit in listing_extra_attrs but not the
index — outside every cohort until location resolves; verify attr backfill on resolution
(ids 8005469, 8009303, 8011667, 8014426, 7853423, 7853433, 7853625, 7853686, 7853384, 7853038).
20 type×deal cohorts profiled from live fresh-band data. **18 VIABLE registered** (registry 52
enabled rows, floor 52): Office ×2 (rent n=2,140: age+furnished+utility chips; buy n=60 thin),
Shop ×2 (rent n=1,982 — strongest commercial; street+direction+age+utilities; aqar 97.9%
monoculture flag), Showroom buy (88, thin), Warehouse ×2 (1,175/147; fresh supply dealapp-first),
Workshop ×2 (141/74), CommBldg ×2 (347/179), Hotel buy (69), GasStation ×2 (49/78),
CommLand buy (**17,509 — largest cohort in the system**; street+direction),
IndLand buy (1,794; aqar monoculture), ResLand ×2 (10,338/412; dealapp+wasalt+aqar diverse),
RestHouse ×2 (1,712/1,268; age+street+water/sanitation), Farm buy (233; 15-platform diversity),
AgriPlot buy (1,009; the land quintet incl. genuinely two-sided utilities).
**13 NOT-VIABLE, Normal-Filter-only with evidence:** Chalet ×2 (buy n=25 at gate, rent fresh 2/wk
stale pool), Camp ×2 (0/3), Factory ×2 (32 monoculture / 64 with ZERO fresh), Staff Housing ×2
(0/3), Service Facilities ×2 (6/28 heterogeneous 6-type mix, 0 fresh), Hotel rent (25),
Farm rent (104 but fresh 3/wk — hold), CommLand rent (23), IndLand rent (0), AgriPlot rent (5).
**New amenity tokens** `electricity` كهرباء + `water_supply` توفر الماء (20260815234444, chips ==
direct == referee in-transaction; checkpoint 4 = 20260815234504). **AC enabled NOWHERE new** —
fresh-dead on commercial (aqar form change) despite passing all-time gates. **12 evidenced land
waivers**: land has no building amenities; all-time 22-33% rates are June-bulk artifacts.
`cohortAllows` now matches the clean type's macro (was Residential-only); `COHORT_CHIPS` scopes
commercial chips to the utility trio (+kitchen RestHouse) — certified residential cards unchanged.
**Documented capture gaps (deliberate deferrals, due diligence not done tonight):** wasalt
electricityMeter/waterMeter (770/770 explicit نعم/لا, columns exist, view branch missing) ·
aqar special_position (1,798y CommLand, no index column) · aqar deed_area_m2 (~85% raw, no column)
· aqar land direction non-flow (72 rows). None blocks a shipped question.

## Barrier fleet (all registry-driven — a cohort row = protection)
`af_cohort_registry` drives: `mon_rich_attrs_barrier`, `mon_af_new_listing_readiness` (A/B/C),
`mon_filter_parity_barrier` check 2 (annual rows). Plus the cohort-agnostic fleet: predicate parity
(hourly), legacy parity, normal-filter barrier, field integrity, manufactured negatives, price/size
sanity trigger, filter-barrier leaks, PII sweep. Mutation-test protocol: single transaction, break →
assert fired → RAISE rolls back; match the mutation to the barrier's contract before judging it.

## Monthly Rent (شهري) — UNFROZEN and certified 2026-08-18 (owner order)

The 2026-08-15 freeze was REPLACED by a certified-set guard (`af_registry_monthly_uncertified`, P1):
only the cohorts below may carry `rent_period_ar='شهري'` in `af_cohort_registry`; anything else pages.
Monthly = payment_monthly AND NOT rnpl (live search semantics). Designed from MONTHLY data — the
fresh-dead Annual staples (kitchen 94/30,356 · AC 7 · age 564 · floor 53 · furnished 100%-true on
Gathern) are contract-pinned OUT of every Monthly question list.

| Cohort | n | Questions | Evidence |
|---|---:|---|---|
| شقة | 30,356 | rating · unit_subtype · amenities · bathrooms | 24,716 rated; استديو 9,218 / شقق مخدومة 2,040; elevator 62%, parking 33%, bathrooms 56% |
| غرفة | 556 | rating · amenities | 446 rated; elevator 53%, parking 31%; bathrooms 0 known |
| فيلا | 362 | rating · bathrooms · amenities | 245 rated; bathrooms 92%; parking 57% (elevator 5% self-gates) |

NOT enabled (Normal-Filter-only, re-check before enabling): شاليه 287 (ZERO rated/elevator/parking/
bathrooms — no question exists); Commercial Monthly 137 total (مكتب 124/معرض 7/محل 6 — owner:
Normal-only); عمارة 40 · مخيم 28 · استراحة 24 · دور 18 · استوديو 16 (inventory floor).

**Gathern rating** — the Monthly differentiator: SOURCE-DECLARED 1–10 scale (schema.org
aggregateRating, bestRating 10/worstRating 1, live-page verified), a PROPERTY/UNIT rating on
@type:VacationRental. Options 9.5+ / 9.0+ / 9.0+ مع 10 تقييمات أو أكثر (review-confidence).
«لا يوجد تقييم» ⇒ NULL even over a stale stored numeric (444 rows). UNKNOWN never satisfies a
rating answer (strict `>=` SQL). Never rescale to /5. Barriers:
`mon_detect_gathern_rating_source_truth` (6 checks, 4 mutations proven) +
`mon_detect_monthly_af_exactness` (chip=referee=landed, stale-RPC mutation proven).
Ratings flow automatically: jobid 28 (:14 hourly) runs `sync_gathern_native_attrs()` after the index
sync. Fields investigated and REJECTED: guest_capacity (constant 1), stay_nights (constant 30),
booking_count (engagement, not a property fact — neutrality), check_in/out + house_rules (prose),
nightly_price (monthly basis is the deal), rate_text as a filter (label, numeric is canonical).

## Mixed period (سنوي + شهري together, `q.rentPeriod === 'both'`) — INTERSECTION only (owner 2026-08-19)

`cohortAllows()` (`src/data/advancedFilters.ts`) requires a question id present in BOTH the type's
`RentAnnual` AND `RentMonthly` lists to fire on a combined search — never the union, and never a
silent alias to `RentAnnual` (that was the bug: the old code had no `'both'` branch and fell through
to the same arm as plain Annual Rent). Reasoning: each list is independently profiled against real
coverage for THAT period alone; a question absent from one list has zero evidence it is valid there,
and the shared SQL predicates are strict-NULL-excluding (an unrated/unaged row FAILS the filter, it
does not pass through as "unknown"). Offering a period-specific question against a mixed result set
would silently amputate the other period's rows the instant it is answered:
- `rating` (Monthly-only, never profiled against Annual data) would exclude every Annual listing —
  the exact "Gathern rating must never classify an Annual listing as low/unrated" risk the owner
  named directly.
- `rnpl`/`property_age`/`furnished` (Annual-tuned) would exclude nearly every Monthly listing — the
  mirror-image leak, found during this same investigation, not explicitly named by the owner but the
  same failure class.

For the 3 certified Monthly cohorts this yields a SMALLER but fully-safe combined-mode surface:

| Type | RentAnnual ∩ RentMonthly (what fires on 'both') |
|---|---|
| Apartment (شقة) | amenities, bathrooms |
| Room (غرفة) | amenities |
| Villa (فيلا) | amenities, bathrooms |

Any type with no certified Monthly cohort (Floor, Residential Building, Studio, every commercial/
rural type) correctly offers ZERO Advanced Filter questions on a 'both' search — an empty
intersection, because there is no evidence a mixed scope is meaningfully populated for that type
either. `property_age` (AGE_QUESTION) used to have its OWN separate eligibility gate
(`src/lib/ageFilterTypes.ts`, did not route through `cohortAllows` at all) — as of 2026-09-01 that
gate is deleted and `AGE_QUESTION`'s eligibility is `cohortAllows(q, 'property_age')` directly, so it
gets this same period exclusion (and the multi-type/group intersection below) for free, with nothing
second to keep in sync.

This is a CLIENT-SIDE-ONLY gate, same as every other cohort decision in this file — the shared SQL
`af_eligibility_clause()` / `rebuild_af_filter_rpcs()` 4-surface generator is completely untouched;
only which questions the client is willing to SURFACE changes. Full architecture + the "why
intersection, not union" reasoning: `docs/ARCHITECTURE.md` §17. Mutation-tested barrier:
`scripts/verify-mixed-period-af-gating.ts` (npm test) — proves the old union-shaped bug fails this
test, and `scripts/verify-age-filter-gate.ts` covers the property_age half.

## Re-audit of the six uncertified types — 2026-08-23 (owner order)

Six clean types sat outside `COHORT_QUESTIONS`, and because `cohortAllows()` intersects across every
selected type and treats an uncertified type as an EMPTY cohort, each one zeroed Advanced Filter for
every shipped GROUP containing it. Owner order: audit them individually against real source data and
certify only what is genuinely supported — "do not copy Villa questions into Duplex merely because
they seem similar."

Measured against TODAY's production inventory, then adjudicated against the LIVE source page.

| type | cohort | n (fresh/7d) | platforms | supported | unsupported | certified | source evidence |
|---|---|---|---|---|---|---|---|
| **Duplex** | Buy | 117 (5) | 9, top 40.2% | `bathrooms` 76/117 = 65%, 4 rungs | age 12, street 14, dir 9, kitchen 7, parking 6, furnished 1, rnpl 0 | **1** | **YES** — 6/6 exact vs hajerhouses' «دورات المياه» |
| Duplex | Rent/Annual | 17 (1) | 8 | — | below the 26-row scope floor entirely | 0 | n/a |
| **Factory** | Rent/Annual | 72 (7) | 2, top 94.4% | `street_width` 68/72 = 94% | bath 1, dir 3, rnpl 66 known/0 yes | **1** | **YES** — 10/10 exact vs aqar's structured `street_width` key |
| **Factory** | Buy | 34 (2) | 2, top 94.1% | `street_width` 29/34 = 85% | bath 0, dir 5 | **1** | **YES** — same probe |
| Chalet | Rent/Annual | 61 (4) | 5, top 85.2% | age 53, bath 54, street 56 pass every DB gate | — | **0** | **MIXED** — of 24 rows adjudicated, **12 now have BOTH structured keys null** on the live page |
| Chalet | Buy / Monthly | 25 / 292 (0) | 6 / 1 | — | Buy below floor; Monthly has ZERO coverage on every AF field | 0 | n/a |
| Camp | Rent ×2 | 4 / 28 (0) | 1–2 | — | no inventory | 0 | n/a |
| Staff Housing | Rent ×2 | 3 / 1 | 1 | — | no inventory | 0 | n/a |
| Service Facilities | — | **40 total** | — | — | six unrelated raw types (bank 11 / parking 10 / telecom tower 9 / school 6 / health centre 4); largest 11 | 0 | n/a |

`property_age` is source-verified 10/10 for Factory but deliberately **not** listed in
`COHORT_QUESTIONS`: Factory's own inventory (72/34) is under the 150-row `MIN_TOTAL_TO_SHOW` floor
for age specifically, so the question could never be offered. Listing it would be availability for a
question the type can never be asked. (`property_age` eligibility is `cohortAllows(q, 'property_age')`
against this same table directly, 2026-09-01 — there is no second type list to omit Factory from
any more.)

**Certifying these does NOT open Advanced Filter for any group, and that is the audit's main finding.**
Every group's best case is the intersection of its ALREADY-CERTIFIED members, and `property_age` cannot
count toward it at all (its eligibility requires a SINGLE selected type, so it never fires for a group).
Measured ceilings, now pinned by `scripts/verify-af-group-cohort-coverage.ts`:

| group | Buy | Rent/Annual | blocked by |
|---|---|---|---|
| Apartments & Co-living | 0 | 1 | its own certified members |
| **Villas & Houses** | 1 | **6** | Duplex needs a SECOND supported field it does not have (Rent side: Duplex n=17) |
| Vacation & Rural | 2 | 2 | Camp — uncertifiable at 4 rows |
| Residential Plots | **2** ✅ | **2** ✅ | — |
| Retail & Workspace | 1 | 1 | its own certified members |
| Industrial & Logistics | 1 | 1 | Warehouse ∩ Workshop — Factory cannot lift it |
| Commercial Buildings & Facilities | 2 | 1 | Staff Housing + Service Facilities |
| Commercial & Industrial Plots | **2** ✅ | 0 | — |

So three groups (Apartments & Co-living, Retail & Workspace, Industrial & Logistics) can never be
opened by certification at all — only a change to the intersection rule would, and that is a product
decision, not a data one.

Registry: 56 → 59 enabled rows (`20260823205033`), floor raised with it.

**Also adjudicated the same day:** `af_field_stuck_no_variance` / sanadak `driver_room` is a
SOURCE-PUBLISHED negative, not a manufactured one — 4/4 live pages carry an explicit
`"isDriverRoomAvailable": false` (land listings included), and the field is two-sided platform-wide
(32 true / 951 false over 983 rows). Acknowledged for that one segment only (`20260823205435`).
The aqar maid/driver segments in the same alert are fixed at the parser level (#987) and clear as the
8-hourly sweep re-enriches; satel, wasalt and aqaratikom segments remain **unadjudicated**.

## The whole certified matrix, one truth — 2026-09-02 (owner invariant, class-wide barrier)

«What the AF UI says + what the user selects + what the backend applies + what the returned listings
actually satisfy must all be the same truth.» Two barriers now walk the WHOLE matrix instead of a
hand-picked slice — every scope (each clean type, each group) × every deal/period mode (Buy, RentAnnual,
RentMonthly, RentBoth, dealCombined, bothDeals) × every question the REAL pool offers there × every
option its real `resolveOptions()` defines. The matrix is derived by executing `src/data/
advancedFilters.ts` (lifted) through the real `cohortAllows()`, never from a list, so a cohort or
option certified tomorrow is covered tomorrow. Measured 2026-09-02: 39 scopes × 6 modes = 234 cells,
55 certified, 149 (cell, field) pairs, 742 options.

- `scripts/lib/afMatrix.ts` — the matrix builder + `optionMeaning()`: for every option KEY, its meaning
  in three independent vocabularies (RPC params the app must send · the `cnt_*` column the card must
  read · the predicate on canonical `search_listings_ar` columns as PostgREST filters, with the
  known-not-matching and UNKNOWN complements). An option with no meaning fails the barrier.
- `scripts/verify-af-matrix-truth.ts` (npm test) — gate == table; selection = predicate (single, same-
  field OR/AND, cross-field AND); count-column wiring + caption derivation; removal via the real
  `withoutFacet()`; Trending carry via the real `rpcAllNarrowingParams()`; results path spreads the
  one builder; re-certification on every mode/type transition (23,415 executed); the dormant
  `p_has_license` arm has no sender. 18 mutants RED, restored GREEN (PR body has the table).
- `scripts/verify-af-matrix-truth-live.ts` (af-live-truth-check.yml, own job) — the same cells in
  الرياض against production: card number (real `resolveOptions()` on the real count row) == PostgREST
  count on canonical columns == results total; answered + known-not-matching + unknown == base for
  EVERY option; every returned row fetched back and checked on its canonical column; exact ID diff
  under the walk cap; two options of one field == SQL union (directions) / intersection (amenities);
  two fields == intersection; Trending's advertised count == committed (skipped with a logged reason
  on the agent-only bothDeals shape — see below); any certified amenity token the card does not offer
  is still measured at count level and logged, never silently dropped.

Measured 2026-09-02 on production (الرياض): 55 cells · 742 options · 4,905 checks · 234,591 returned
rows re-verified on canonical columns · 0 empty cells · 0 cells the oracle could not express. Live
mutants (small scopes): p_bath_min dropped RED 16 · Trending drops AF RED 1 · «غير مفروشة» sends
nothing RED 4 · direction OR lost RED 2 · restored GREEN.

Adjudicated, same day, from that run's only two FAILs (Apartment/bothDeals and Villa/bothDeals,
`Trending advertises exactly the committed count`): executed live, `top_cities_by_deal_ar` with the
results body's own `p_tables` returns the committed number (5,719 / 4,627); without it 9,415 / 4,647
— the two monthly-only sources the annual results scope excludes. Not an AF carry defect, and the
comparison does not apply: bothDeals is an agent-only shape that `sanitizeForFilterRestore()` drops,
so the Filter home (the only Trending surface) can never hold it. The live tier now SKIPS that one
(mode × check) with the reason printed; `verify-af-matrix-truth.ts §8` pins both facts the skip
rests on (executed sanitizer; the Filter home never reads bothDeals). If either changes, re-adjudicate.

Owner rulings the same day, all shipped in this change (SQL drafted + branch-verified, applied by Ship):
- **GAP 1 — the 8 rich amenities are exposed on the card** (gym, pool, garden, balcony, laundry_room,
  optical_fibers, separate_electricity_meter, separate_water_meter): `cnt_*` columns inside the same
  `scoped` CTE through the templated path (migration `20260902220000`), chip defs + labels, sweep rows,
  and `verify-af-matrix-truth.ts §3` now asserts offered == certified token-for-token on every
  residential amenities cell (matrix floor 742 → 886 options). Certification unchanged: residential
  cells only; villa-only tokens and Chalet/Camp untouched.
- **BUG-1 — `p_has_license = false` admits nothing** (silent → NULL, never unknown → NO): canonical
  data has no explicit negative (fleet-wide `rega_license_status` is only ever نشط/فعال, both with a
  number), so the honest false arm is `(p_has_license is null or (p_has_license and s.license_number
  is not null))` — migration `20260902220100` needle-edits the clause AND `top_cities_by_deal_ar`,
  rebuilds, and raises if a non-active status ever appears. `§7` executes the arm from the mirror.
- **H9 — the runtime detector reads rows**: `mon_detect_af_option_count_truth` called the sweep with
  `p_check_rows := false`; migration `20260902220200` turns it on (p_row_limit 200) and widens to 40
  slices (measured 1.65 s per row check on the heaviest cohort).
- **Amenities AND / direction OR** stays as built and measured (contract R7.2.2).

Findings while building it: the results request re-typed the 11 AF params by hand beside the shared
builder (now spreads `rpcAdvancedFilterParams()`); the `GuidedCounts` comment asserted the opposite of
the deployed SQL (per-option counts ARE computed inside the committed scope); the diagonal directions
are stored ONLY in the adjectival spelling (`شمال شرقي`), so a literal oracle counted 0 against a correct
RPC — the oracle now covers the published spellings; `p_rent_period='كلاهما'` is translated (RentBoth
cells have truth coverage); `verify-af-independent-oracle.ts` left the required `npm test` for the live
workflow. Deferred for the owner: the `p_has_license=false` clause arm reads a missing licence as
«unlicensed» (no sender today, pinned); whether the card should offer the 8 rich tokens.
