# Rent-period multi-select (سنوي + شهري) — progress log, 2026-08-19

Owner brief: replace the 3-way إيجار period control (سنوي/شهري/كلاهما) with a 2-button
سنوي+شهري control where BOTH can be independently toggled on. No كلاهما button in the UI.
Full brief text lives in the task that spawned this session (not duplicated here).

Working branch: `feat/rent-period-multiselect-2026-08-19`, isolated worktree at
`/Users/yusufalnashwan/Downloads/design_handoff_ezhalah/.hardening-worktrees/period-multiselect`,
based on `origin/main` @ `33ffeb3`. Main checkout at `ezhalah-app/` was DIRTY (uncommitted changes
to `src/app/agent.tsx`, `src/app/index.tsx` from a concurrent agent-rebuild session) — deliberately
NOT touched, NOT stashed. This worktree avoids it entirely.

Supabase project: `aannarbkwcymrotzwdbo` ("ezhalah app"). ops_deploy_lock currently EMPTY (no
active lock) as of investigation start.

## MAJOR FINDING: the backend "both periods" architecture already exists and is production-proven

This is NOT a from-scratch feature. `docs/ARCHITECTURE.md` §17 + live DB confirm a full "both"
(كلاهما) architecture shipped 2026-08-14/15:

- `SearchQuery.rentPeriod: 'monthly' | 'annual' | 'both' | undefined` (single enum, `src/data/search.ts`).
- `rentPeriodParam(q)` in `src/data/remote.ts` (~line 882-892) maps it to an Arabic RPC token:
  `'monthly'→'شهري'`, `'annual'→'سنوي'`, `'both'→'كلاهما'` (a THIRD sentinel, not NULL — NULL means
  "no period filter", which wrongly admits ~510 rent rows with unpublished period; كلاهما is
  exactly `monthly-predicate OR annual-predicate`, unpublished rows excluded).
- Live predicate (confirmed via `pg_get_functiondef` on `location_search_candidates_ar`,
  `apartment_guided_counts_ar`, `property_age_option_counts_ar` — byte-identical clause via the
  shared `af_eligibility_clause()` / `rebuild_af_filter_rpcs()` generator, "4 surfaces" =
  `af_eligible_count`, `apartment_guided_counts_ar`, `location_search_candidates_ar`,
  `property_age_option_counts_ar`):
  ```sql
  and (p_rent_period is null
       or s.deal_ar <> 'إيجار'
       or (p_rent_period = 'شهري' and s.payment_monthly = true and not coalesce(s.rent_now_pay_later, false))
       or (p_rent_period = 'سنوي' and (s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
       or (p_rent_period = 'كلاهما' and (s.payment_monthly = true or s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
       or (p_rent_period not in ('شهري','سنوي','كلاهما') and s.rent_period_ar = p_rent_period))
  ```
- Mutual exclusion is a settled, previously-fixed invariant (PR #424, the "MONTHLY/ANNUAL black
  hole"): `rent_period_ar='سنوي' → ANNUAL`; `='شهري'+RNPL → ANNUAL` (annual contract paid monthly);
  `='شهري'+not RNPL → MONTHLY`; `NULL → NEITHER`. ANNUAL ∩ MONTHLY = ∅, proven live
  (31,859 + 43,287 = 75,146 exactly, vs 75,656 for NULL/no-filter — the delta is exactly the
  unpublished-period rows). **This directly answers the "can one property appear as both a
  monthly AND annual row" question: NO — verified live, the union sum has zero overlap.** No
  product-decision escalation needed for §2's counting semantics; sum-of-eligible-counts is
  provably correct.
- Barrier already exists: `mon_filter_parity_barrier()` (migration
  `20260810144023_mon_filter_parity_barrier_both_periods.sql`) — behavioral (calls live RPCs), 7
  checks incl. mutual exclusion, results-vs-guided-vs-age count parity, buy/rent separation. Also
  `scripts/verify-rent-period-both.ts` (npm test, mutation-tested per its own docstring) and DB
  monitor `mon_detect_rent_period_both_branch()`.
- Results are period-interleaved for display (`orderByScope(..., mixPeriods)`), nested inside the
  platform-outermost ordering rule — already handles §2's "genuine mix" requirement.
- Price basis on 'both' = ANNUAL (`price_annual`, unscaled) — ×12 monthly scaling only applies to
  the pure `'شهري'` token.

**Net effect: §2 (combined search correctness), most of §6 (backend), most of §7/§8 barriers for
the RESULTS/COUNT-at-search-time path are ALREADY DONE, proven, and barrier-protected.** The task
is materially narrower than "build combined-period search from scratch."

## CONFIRMED GAP #1 — Trending (city/district) RPCs never got the كلاهما treatment

`top_cities_by_deal_ar` and `district_options_ar` (live signatures confirmed via MCP):
```
top_cities_by_deal_ar(p_deal text, p_payment_monthly boolean DEFAULT NULL, p_category text DEFAULT NULL, p_types text[] DEFAULT NULL)
district_options_ar(p_city_id integer, p_deal text DEFAULT NULL, p_category text DEFAULT NULL, p_payment_monthly boolean DEFAULT NULL, p_types text[] DEFAULT NULL)
```
These take **boolean** `p_payment_monthly` (true/false/null) — there is NO third state for "both
known periods, excluding unpublished." Client-side, `src/app/index.tsx:163-167` currently computes:
```ts
const rentPeriod: 'monthly' | 'annual' | 'both' = query.rentPeriod ?? 'annual';
const paymentMonthly: boolean | null =
  query.deal !== 'Rent' || rentPeriod === 'both' ? null : rentPeriod === 'monthly';
```
i.e. today, selecting Both sends `paymentMonthly: null` to Trending — which is a BROADER set
(includes unpublished-period rows) than what the results RPC's `'كلاهما'` token returns. This is
a live Trending-vs-results scope mismatch of the exact same shape as the original black-hole bug —
this is §2's "Trending using a different period scope from results" barrier requirement, currently
UNMET for the both case.

**Fix direction (reuse-first, confirmed with 2nd investigation, see below):** change both RPCs'
period param from `p_payment_monthly boolean` to `p_rent_period text` (nullable, same sentinel
domain: `شهري`/`سنوي`/`كلاهما`/NULL), reusing the exact predicate fragment already proven in the
other 3 RPCs — not a parallel boolean implementation. This is a signature change (different arg
list = NEW overload; must DROP the old `p_payment_monthly` overload explicitly per repo rule).
Every call site must move in the same migration+PR: `src/data/locations.ts`
(`ensureCityFieldIndex`/`top_cities_by_deal_ar` calls, `ensureDistrictOptions`/`district_options_ar`
calls) and `src/app/index.tsx` (the `paymentMonthly` derivation → replace with a `rentPeriodToken`
derivation mirroring `rentPeriodParam()`).

TODO before writing the migration: grep for EVERY caller of `top_cities_by_deal_ar` /
`district_options_ar` / `p_payment_monthly` (not just locations.ts — check agent.ts, search.ts,
any test/script that calls them) so no caller is left on the old signature.

## CONFIRMED GAP #2 — Advanced Filter cohort gating silently treats 'both' as 'RentAnnual'

`src/data/advancedFilters.ts` `cohortAllows()` (~line 255-273):
```ts
function cohortAllows(q: SearchQuery, id: string): boolean {
  const type = singleCleanType(q);
  if (!type) return false;
  if (q.category !== (CLEAN_MACRO[type] ?? 'Residential')) return false;
  const cfg = COHORT_QUESTIONS[type];
  if (!cfg) return false;
  const deal: 'RentAnnual' | 'RentMonthly' | 'Buy' | null =
    q.deal === 'Buy' ? 'Buy'
    : q.deal === 'Rent' && q.rentPeriod === 'monthly' ? 'RentMonthly'
    : q.deal === 'Rent' ? 'RentAnnual'          // <-- 'both' falls in HERE, silently
    : null;
  if (!deal) return false;
  return (cfg[deal] ?? []).includes(id);
}
```
When `q.rentPeriod === 'both'`, this ternary chain has NO explicit branch for it, so it falls
through to `'RentAnnual'`. Consequence: a combined سنوي+شهري search would (a) offer Annual-only-
certified AF questions (rnpl, property_age tuned for Annual data, furnished, etc.) whose predicates
would silently narrow out Monthly listings that have no valid/known data for that field, and (b)
NEVER offer Monthly-only questions (`rating` = Gathern, `unit_subtype`) — which is actually SAFE
re: Gathern (never misclassifies Annual listings, matches the owner's explicit worry) but is an
accidental side effect of a bug, not a designed behavior, and the (a) direction is a real,
unproven-safe leak risk: e.g. `p_rating_min` predicate in the shared eligibility clause is
`(p_rating_min is null or s.rating >= p_rating_min)` — period-UNAWARE at the SQL layer. If it were
ever set while scope is 'both', it would silently zero out every Annual listing (`s.rating` is
NULL for Annual/non-Gathern rows → comparison is UNKNOWN → excluded) — exactly the failure mode
owner brief §3 describes. Today this is only prevented by client-side gating never SETTING
`ratingMin` in 'both' scope, not by a real backend safeguard — a client-side gating bug is the
entire safety margin. This is the central design problem for §3.

**Design decided (see full writeup below once 2nd investigation returns)**: fix `cohortAllows` to
require the question id present in BOTH `RentAnnual` and `RentMonthly` question lists for a 'both'
scope (intersection), not just RentAnnual. This keeps the AF surface honest without touching the
shared SQL eligibility clause at all — a period-invalid question is simply never offered, so its
period-unsafe predicate is never sent. Need to verify: (1) whether any question already answered
survives a period-selection change from single→both and must be cleared if it becomes ineligible
(§5 "state changes must recompute everything"), (2) whether `cohortAllows`/COHORT_QUESTIONS is
truly the ONLY gate (single source of truth) or whether the DB-side `af_eligibility_clause()` also
needs an intersection-safety net for defense-in-depth.

## CONFIRMED GAP #3 (likely) — "خلّنا نحدد الطلب أكثر" CTA in results screen has NO count gate

`src/app/agent.tsx` ~line 1900-1926 — the manual "let's narrow it down" button shown under a
result set (distinct from the auto-opening AF intro overlay, which DOES correctly gate on
`gateTotal > INTERVIEW_STOP_AT` per `agent.tsx:1375`). This second button:
```tsx
<Pressable style={s.mBtnAlt} onPress={() => {
  const q = m.result.query;
  if (q && anyGuidedEligible(q)) void startAgeFlow(q);
  else startRefine(q);
}}>
  <Text style={s.mBtnAltTx}>{t('Let’s narrow it down')}</Text>
</Pressable>
```
renders UNCONDITIONALLY alongside the (correctly-gated) "Load more" button — no check against
`fetched > INTERVIEW_STOP_AT` or `matchTotal`. Owner's exact strings ("أقدر أحدد أكثر" /
"أقدر أكون أكثر تحديداً") do NOT exist in the codebase (grepped, zero hits) — the real current
copy is «خلّنا نحدد الطلب أكثر» — but the underlying bug the owner describes (CTA shown when it
shouldn't be) matches this code path. NEEDS VERIFICATION: does `startRefine`/`startAgeFlow` itself
silently no-op when the eligible set is ≤25 (making this a dead-but-harmless button) or does it
open something broken/empty? Must trace `anyGuidedEligible`, `startRefine`, `startAgeFlow` to
confirm before calling this a real bug vs a cosmetic one. If confirmed, the fix is a straightforward
gate: hide/replace this button with the ≤25 "normal actions" set (👍/Share only — `FeedbackRow` is
already rendered separately, right below, unconditionally — so ≤25 may already correctly get
"only normal actions" once this extra button is suppressed).

The TRUE total for this gate must be `m.result.matchTotal ?? m.result.listings.length` — the exact
invariant already pinned by `scripts/verify-advanced-filter-contract.ts` per the "matchTotal, never
page-capped total" incident (PR #608) — NEVER `fetched`/`m.result.listings.length` alone (that's
page-buffer size, not true eligible count, per §4's explicit "not: mounted cards, first page size"
requirement).

## Background investigation agents

1. "Investigate rent-period filter architecture" — COMPLETE. Findings folded in above.
2. "Investigate AF eligibility layer and 25-cap CTA" — IN PROGRESS as of this write.

## FINALIZED DESIGN (both background investigations converged with direct DB checks)

### Mixed-period AF gating — INTERSECTION design (the answer to §3)
`cohortAllows(q, id)` gains an explicit `'both'` branch:
```ts
if (q.rentPeriod === 'both') return (cfg.RentAnnual ?? []).includes(id) && (cfg.RentMonthly ?? []).includes(id);
```
A question is offered in a combined search ONLY if it is independently certified valid for BOTH
RentAnnual AND RentMonthly for that clean type. Reasoning: RentAnnual and RentMonthly question
lists are each hand-profiled against real coverage data for that exact period; a question absent
from one list has NO evidence it's valid there. Union would let e.g. `rating` (Monthly-only, never
profiled against Annual data) or `rnpl`/`property_age` (Annual-only, ~2% known on Monthly Apartment)
fire against a mixed set — and since the SQL predicates are strict-NULL-excluding (not "unknown
passes through"), applying either would silently amputate one period's listings from the result,
exactly the failure the owner named. Intersection guarantees an offered question's predicate is
safe against every row in a 'both' scope, for both periods, by construction — no new NULL-handling
code needed, no touching the shared `af_eligibility_clause()` SQL at all (the 4-surface generator
stays completely untouched; only the CLIENT decides which questions to surface, exactly matching
how cohort-gating already works today for every other case). For the 3 certified Monthly cohorts
(Apartment/Room/Villa) this yields `['amenities','bathrooms']`/`['amenities']`/`['amenities',
'bathrooms']` respectively — a smaller but fully-safe AF surface in combined mode. Any type with NO
certified Monthly cohort gets ZERO AF questions in 'both' mode (empty intersection) — correct, since
there's no evidence a mixed scope is even meaningfully populated for that type.

Trust boundary (pre-existing, unchanged by this fix): the RPC layer is period-agnostic by design —
it honestly executes whatever predicate the client sends. Cohort/period-validity gating has ALWAYS
lived client-side only (`docs/ADVANCED_FILTER_DESIGN_CONTRACT.md` §9 "one unified eligibility
gate", never at the SQL layer). This fix keeps that exact model; it does not weaken it.

### SECOND bypass found: `AGE_QUESTION` does not route through `cohortAllows` at all
`property_age`'s eligibility is `isAgeFilterScopeFor(q, effectiveTypes(q))` in
`src/lib/ageFilterTypes.ts` — a SEPARATE, period-blind gate (type+category only, no deal/rentPeriod
check). The COHORT_QUESTIONS ledger deliberately excludes `property_age` from EVERY certified
RentMonthly list (documented reason: age is "fresh-dead" on Monthly inventory, 564/30,356 known for
Apartment) — but `isAgeFilterScope` doesn't know that, so nothing currently stops the age question
from being offered on a Monthly-only or a 'both' scope. In 'both' mode specifically this is a live
version of the same leak: Annual rows dominate age coverage, so answering an age bucket would
silently exclude ~all Monthly rows while claiming to search both periods. FIX: gate
`isAgeFilterScope` on period too — eligible only for Buy or plain-Annual Rent, never
`monthly`/`both` — matching what the cohort ledger already asserts is true for property_age.

### UI design — two independent toggle buttons, reusing existing patterns
- `Segmented` (`src/components/ui.tsx`) stays single-select, used as-is for Buy/Rent — NOT reused
  for periods anymore. New: two chip-style `Pressable` toggles (سنوي / شهري), each independently
  on/off, visual treatment borrowed from the existing district multi-select chip toggle
  (`toggleDistrict` pattern in `index.tsx`) for consistency, not from Segmented's radio look.
- State: keep `SearchQuery.rentPeriod: 'monthly'|'annual'|'both'|undefined` UNCHANGED (still ONE
  canonical enum — no `p_rent_periods` array invented; the existing sentinel-token backend already
  IS the "array of periods" representation, just spelled as a token). Derive it from two local
  booleans `annualOn`/`monthlyOn` (or directly toggle `rentPeriod` by case): annual-only→'annual',
  monthly-only→'monthly', both-on→'both'. Guard: tapping the only currently-active button is a
  no-op (cannot reach a 0-selected state) — same "always exactly one interpretation" requirement as
  today's Buy/Rent Segmented, just now allowing 2-of-2 as well as 1-of-2.
- Price-unit-clear-on-change logic (existing, `priceMin/priceMax` reset on period change) reruns
  for EVERY toggle transition, not just Segmented's onChange — same clearing rule applies whenever
  the resulting `rentPeriod` value's price basis changes (annual↔monthly still clears; annual→both
  or monthly→both do NOT change price basis since 'both' already uses the annual basis, same as
  'annual' — verify no double-clear/false-positive "price cleared" message on annual→both).

### Trending exactness fix (§2/§6/§7) — IMPLEMENTED, see migration below
`top_cities_by_deal_ar`/`district_options_ar`: `p_payment_monthly boolean` → `p_rent_period text`
(شهري/سنوي/كلاهما/NULL), reusing the exact `af_eligibility_clause()` period fragment verbatim.
`mon_detect_trending_cohort_drift()` (live pg_cron monitor) updated in the SAME migration (it calls
both RPCs positionally with the old boolean — would have broken immediately otherwise) AND extended
with explicit `'كلاهما'` probes (apt-rent-both, floor-rent-both, untyped-rent-both) so the monitor
now behaviorally proves combined-period Trending == combined-period Search, not just single-period.
Migration file: see `supabase/migrations/` (named after the server-minted timestamp, added post-apply).
No other DB function calls these RPCs with the boolean param (checked via `pg_get_functiondef` ILIKE
scan of all `public` functions — only `mon_location_predicate_branch_barrier` and
`mon_trending_district_barrier` call them, both WITHOUT the period arg, so their calls are
unaffected by the signature change).

Client-side rename required (mechanical, same shape everywhere): `paymentMonthly: boolean | null`
→ a period-token string in `src/data/locations.ts` (8 functions: `pmKey`, `cityPoolKey`,
`cityPoolStatus`, `districtPoolStatus`, `ensureCityFieldIndex`, `topCitiesByListings`,
`districtCacheKey`, `ensureDistrictOptions`, `topDistrictsForCityId`, `matchDistrictsByCityId`,
`matchCitiesByText`) and ~15 call sites in `src/app/index.tsx`.

### ≤25 CTA bug — CONFIRMED REAL (not the same bug as the already-fixed matchTotal one)
Both investigations agree: the auto-opening AF intro overlay already correctly gates on
`matchTotal`-first (PR #608, already fixed, machine-pinned). The REMAINING bug is the separate
manual "خلّنا نحدد الطلب أكثر" button in the results closing message (`agent.tsx` ~1917-1926) which
renders UNCONDITIONALLY (no total check at all). Traced the click path: for a ≤25 scope it does NOT
crash or show a broken card — `startAgeFlow`'s `rankQuestions` empties out below the 26-floor and
falls back to `startRefine(q)`, the PLAIN refine-chip flow (asks district/budget/bedrooms/type as a
free-form chat question). That is exactly the "useless CTA that asks the user to narrow further"
the owner wants gone for ≤25 — it's not a dead button, it actively opens an unwanted flow. FIX: gate
the button's very presence on `(m.result.matchTotal ?? m.result.listings.length) > INTERVIEW_STOP_AT`
(matchTotal-first, same invariant as the already-fixed intro gate — reuse, don't reinvent), and swap
the closing message copy to a plain statement (no "want more precise?" invitation) when gated off.
`FeedbackRow` (👍/Share) already renders unconditionally right below — no change needed there.

## OWNER CLARIFICATION (received mid-task) — MATCH FIRST, period is a preference boundary only

Owner locked the exact semantics: selecting سنوي+شهري means "I accept either rental period" over an
otherwise fully-matched listing — never a ranking/balancing preference. Concretely: (1) all other
selected criteria (category/group/type/city/district(s)/price/area/bedrooms/AF answers) must match
EXACTLY first; period only ORs in `rent_period ∈ {annual, monthly}` on top of that; (2) diversify
AFTER eligibility is fixed — platform/period reordering may never add, drop, or reweight a row, and
must never force any Monthly:Annual ratio; (3) Trending must be computed from the FULL pre-location
filter set (category, group, type, both periods, any other pre-location predicate), never period
alone. Owner also directed: build barrier #13 (duplicate counting) as a standing defensive barrier
regardless of what the "can one property appear as both periods" investigation finds.

**Verified the EXISTING (pre-existing, unmodified) architecture against this clarification —
compliant, no changes needed to the matching/diversification code itself:**
- `location_search_candidates_ar`'s `p_rent_period='كلاهما'` branch is one WHERE-clause OR
  (`payment_monthly=true OR rent_period_ar='سنوي' OR ...`) ANDed with every other predicate
  (type/city/district/price/area/bedrooms/AF answers) in the SAME clause — by construction, period
  can never compensate for or override a mismatch on any other predicate. This is exactly the
  owner's §2 "MATCH FIRST" requirement, already true today.
- `src/lib/platformDiversity.ts` `orderByScope()`/`interleaveRanked()` (used for both platform AND,
  when `mixPeriods`, period reordering): verified by reading the algorithm — it groups the ALREADY-
  FILTERED `rows` array by key (platform, then period), round-robins one-per-group per pass, and
  loops until `out.length === rows.length`. It is a **stable permutation of the exact same input
  array** — cannot add a non-matching row, cannot drop a matched row, cannot duplicate one, and
  reads/writes nothing about "how many of each period there should be" (no quota, no padding, no
  50/50 target anywhere in the code). The existing code comments already assert exactly this
  ("MATCH FIRST, DIVERSIFY SECOND: this only re-orders rows the filter already matched. It can
  never introduce a period the user didn't ask for") — confirmed true by reading the implementation,
  not just trusting the comment. **No balancing logic exists to remove; none will be added.**
- The combined-period fetch is ONE RPC call with ONE `count(*) over()` window (matchTotal) — not two
  separate per-period queries merged/quota'd client-side. No mechanism exists that could truncate one
  period's rows to hit a target ratio.
- Trending fix already in flight (RPC signature migration) threads `p_types`/`p_category` completely
  unchanged — only the period parameter's TYPE changes (bool→text), so type/group/category
  preservation in combined Trending (owner's barriers #7/#8) was never at risk from this change and
  is unaffected.

**New work directly required by this clarification:**
- Permanent product-rule doc entry (this IS a required deliverable, not just code) — see
  `docs/ARCHITECTURE.md` §17 addition (added in this session).
- Barrier #13 (duplicate counting) as an explicit, permanent, standing check — even though the live
  proof numbers (31,859+43,287=75,146 exact, zero overlap) plus the single-OR-clause construction
  are strong evidence no double counting occurs, add a standing behavioral assertion (extend
  `mon_filter_parity_barrier`/the trending drift monitor) that `count(كلاهما) == count(شهري) +
  count(سنوي)` for sampled cohorts, and that no `(source_table, listing_id)` pair appears twice in
  one result page for a كلاهما query.
- Barrier #4 / #11 as explicit regression tests (not just architectural reasoning): a mutation test
  that proves diversification is a permutation (same multiset of row identities before/after
  `orderByScope` with `mixPeriods=true`), and a predicate test that a combined-period query with
  type+city+price set only returns rows matching type+city+price exactly (mutate one predicate off
  and prove the test catches leakage).
- Cross-platform duplicate representation (same physical property listed on two platforms) is a
  PRE-EXISTING, accepted characteristic of this whole search engine (documented "search-engine-not-
  marketplace" permanent rule — every platform's row counted/shown independently, no cross-platform
  dedup exists anywhere in this codebase, for any search, not just combined-period). This is NOT
  something introduced or worsened by rent-period multi-select; noting it in the final report as a
  genuine finding per the owner's instruction, not treating it as a bug to fix in this task.

## Next steps (not yet done)
- [ ] Get 2nd agent's findings (rebuild_af_filter_rpcs 4-surface detail already pulled directly by
      me via MCP — see above; still need: mon_af_predicate_parity exact check, COHORT_QUESTIONS
      full picture, confirm CTA bug via startRefine/anyGuidedEligible trace).
- [ ] Grep every `p_payment_monthly` / `top_cities_by_deal_ar` / `district_options_ar` call site.
- [ ] Design final UI: 2 independent toggle buttons (سنوي/شهري), reusing chip-toggle visual pattern
      from district multi-select. Decide "can't deselect the last one" guard.
- [ ] Write migration: `top_cities_by_deal_ar` + `district_options_ar` → `p_rent_period text`.
- [ ] Fix `cohortAllows` both-mode intersection gate; check for stale answer clearing on period
      change.
- [ ] Fix/verify the "Let's narrow it down" CTA gate.
- [ ] New/extended barriers, at least one mutation-tested per the brief.
- [ ] npm test locally; PR; guarded deploy; production browser verification (desktop+mobile).
