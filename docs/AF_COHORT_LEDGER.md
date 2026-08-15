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

## Barrier fleet (all registry-driven — a cohort row = protection)
`af_cohort_registry` drives: `mon_rich_attrs_barrier`, `mon_af_new_listing_readiness` (A/B/C),
`mon_filter_parity_barrier` check 2 (annual rows). Plus the cohort-agnostic fleet: predicate parity
(hourly), legacy parity, normal-filter barrier, field integrity, manufactured negatives, price/size
sanity trigger, filter-barrier leaks, PII sweep. Mutation-test protocol: single transaction, break →
assert fired → RAISE rolls back; match the mutation to the barrier's contract before judging it.
