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

### شقة / Apartment — BUY — questions data-justified 2026-08-15
- N=34,049. Coverage: age 90% · direction 50% · kitchen 34% · elevator 29% · private entrance 29% ·
  bathrooms 26%. RNPL/furnished: correctly absent (rent concepts; Buy furnished ≈2%).
- Questions: property_age · amenities · bathrooms · **direction** (new).

### دور / Floor — RENT ANNUAL
- N=3,638. age 93% · RNPL 83% known with **64% yes** · AC 76% · private entrance 76% · bath 66%.
- Questions: rnpl (ask-first) · property_age · amenities · bathrooms · furnished.

### دور / Floor — BUY
- N=11,857. age 85% · private entrance 39% · bath 30%.
- Questions: property_age · amenities · bathrooms.

### عمارة سكنية / Residential Building — RENT ANNUAL & BUY
- N=3,211 / 6,373. **street width 96-97% · direction 83-84% · age 89-91%** — completely different
  signature from Apartment (bathrooms 1%: a building has no meaningful bathroom count — deliberately
  no bathrooms question). RNPL yes ≈0 → no installment question.
- Questions: property_age · **street_width** (new ladder ١٥/٢٠/٢٥/٣٠ م فأكثر) · **direction** ·
  furnished (rent only).

### غرفة / Room — RENT ANNUAL
- N=1,774. **kitchen 85% (its signature)** · age 94% · furnished 49%. bathrooms 0%.
  RNPL known 95% but only 5% yes → the floor gate would hide it everywhere; deliberately not offered.
- Questions: property_age · amenities · furnished.

### استوديو / Studio — RENT ANNUAL (minimal)
- N=30 nationwide — barely above the >25 floor; most gates will suppress most questions. Enabled
  minimally (property_age · amenities · furnished) so the engine can serve it if inventory grows.

### Not applicable (documented, no cohort)
- غرفة/Buy (n=1), استوديو/Buy (n=2) — no real market; genuinely N/A.
- All Monthly-Rent cohorts — FROZEN by owner.

## New-question source map
- `street_width` ← `search_listings_ar.street_width_m` (raw source field; ladder = cumulative ≥,
  strict, unknown excluded) → `p_street_width_min` + `cnt_stw15/20/25/30`.
- `direction` ← `norm_direction_ar(direction_ar)` (8 normalized source values, multi = OR)
  → `p_directions` + `cnt_dir_{n,s,e,w,ne,nw,se,sw}`.
- Both added by migration `guided_counts_add_direction_and_street_width` via template+rebuild.

## Barrier fleet (all registry-driven — a cohort row = protection)
`af_cohort_registry` drives: `mon_rich_attrs_barrier`, `mon_af_new_listing_readiness` (A/B/C),
`mon_filter_parity_barrier` check 2 (annual rows). Plus the cohort-agnostic fleet: predicate parity
(hourly), legacy parity, normal-filter barrier, field integrity, manufactured negatives, price/size
sanity trigger, filter-barrier leaks, PII sweep. Mutation-test protocol: single transaction, break →
assert fired → RAISE rolls back; match the mutation to the barrier's contract before judging it.
