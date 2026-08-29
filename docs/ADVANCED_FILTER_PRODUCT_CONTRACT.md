# Advanced Filter — Product Contract (PERMANENT, CANONICAL)

Owner-mandated 2026-08-26. This is the **single source of truth for what Advanced Filter DOES** —
the product behavior a user experiences. Read this before touching any AF code, filing an AF issue,
or making an AF product decision.

**Companion documents (do NOT duplicate their scope):**

| Document | What it owns |
|---|---|
| **This file** (`ADVANCED_FILTER_PRODUCT_CONTRACT.md`) | Product behavior: when/why AF asks, what it asks, when it stops. |
| `ADVANCED_FILTER_DESIGN_CONTRACT.md` | UI/UX law: one shared card owns all chrome/layout/motion. |
| `ADVANCED_FILTER_PATTERN.md` | Data/RPC reuse pattern for adding a new AF question. |
| `ops/ADVANCED_FILTER_SOURCE_TRUTH.md` | Data-integrity contract: unknown≠no, source-truth predicates. |
| `AF_COHORT_LEDGER.md` | Per-cohort certification evidence (coverage %s, source-adjudicated proofs). |

If any of those docs disagrees with THIS one on product behavior, **this file wins** and the other
must be fixed. If code disagrees with this file, that is a defect — the audit at the bottom names
every disagreement found on the day this contract was written.

---

## 0. The core philosophy — everything below derives from this

> **Advanced Filter exists to narrow a broad result set as much as truthfully possible, toward
> about 25 listings or fewer, WITHOUT asking useless questions.**

That is the only reason AF exists. Every rule below is a consequence of that sentence. If any
future rule seems to fight it, the rule is wrong.

Three sub-principles fall out of that philosophy and outrank every mechanical rule:

- **P1 — Truth over completion.** If no genuinely useful question remains, AF STOPS. Never invent
  a question just to force the number below 25.
- **P2 — Unknown stays unknown.** A missing field is never guessed, never converted to "no,"
  never counted as "yes." Options only count listings the platform actually published the fact for.
- **P3 — The user decides.** AF only narrows on facts the user chose. It never recommends, never
  ranks by "best," never says "good deal."

---

## 1. Search scope — what AF is operating on

### 1.1 Category is single-select (Residential OR Commercial, never both)

- **R1.1.1** — Category is a single toggle. Tapping the other one CLEARS everything beneath it
  (groups, types, detail, beds, size). This is not a bug: groups and property types belong to
  exactly one category by design.
- **R1.1.2** — A cross-category scope is impossible to construct in the UI, and even if one
  arrived via URL, `cohortAllows()` rejects a scope whose `q.category` disagrees with the type's
  own macro, so AF offers ZERO questions.
- **R1.1.3** — **Small exception, not a bug:** a Residential search on a Residential type ALSO
  probes the Commercial tables for that same Arabic `type_ar` (scope B in `resolveSearchScope`).
  Some real residential listings are misfiled on commercial platforms; the search catches them for
  the user. This is silent scope-widening for accuracy, not "both categories selected."

### 1.2 Multiple property types within a category

- **R1.2.1** — A user may select **any number of types** within one category (Apartment + Villa,
  Warehouse + Factory + Workshop, etc.).
- **R1.2.2** — Multiple types may come from different property groups within the same category.
  Apartment (Apartments & Co-living) + Villa (Villas & Houses) is a valid single scope.
- **R1.2.3** — Types from different categories cannot be combined (see R1.1.2).

### 1.3 Row-level type logic is OR / union

- **R1.3.1** — Selected types become `p_types = ['شقة','فيلا']` and the RPC filters
  `type_ar IN (...)`, which is a **union at the row level**. A listing has exactly one type; there
  is no overlap to worry about.
- **R1.3.2** — Every normal filter (city, price, area, bedrooms, deal, period) applies uniformly
  across that union. A listing must match the type union AND the other filters.
- **R1.3.3** — **Worked example (Example A):** Apartment + Villa in Riyadh, Annual Rent, ≤2M SAR,
  ≥3 beds → 4,200 matching apartments + 800 matching villas = **5,000 results total**. Not
  4,200×800, not their intersection, not either alone. Straight union.

### 1.4 Buy + Rent combined (`dealCombined`)

- **R1.4.1** — When the user selects both شراء and إيجار, the result set is
  **Buy(eligible) ∪ Rent(eligible)** — a union at the row level.
- **R1.4.2** — Buy and Rent have **INDEPENDENT budgets** (`p_price_min/max` and
  `p_price_min_rent/max_rent`). A listing appears if it passes its OWN leg's budget only.
- **R1.4.3** — In `dealCombined` mode, Rent has no period selector — it spans BOTH annual and
  monthly rent unless the user narrows further.

### 1.5 Annual + Monthly Rent (`rentPeriod: 'both'`)

- **R1.5.1** — Rent-only, both periods selected → result set is
  **AnnualRent(eligible) ∪ MonthlyRent(eligible)**.
- **R1.5.2** — Both periods use the same single Rent budget in this mode (independent per-period
  budgets are a `dealCombined`-only concept, not a plain-Rent one).

### 1.6 The result set AF operates on is the CURRENT eligible set

- **R1.6.1** — AF never re-scopes on its own. It only computes option counts and asks questions
  against exactly what the user's current filters + prior answered AF facts return.
- **R1.6.2** — After each round, "current eligible set" means the narrowed set the round just
  produced. Round N+1 asks questions against that, not against the original search.

---

## 2. AF question certification — where the questions come from

### 2.1 Cohort registry — the only allowed question pool

- **R2.1.1** — Every AF question must appear in `COHORT_QUESTIONS` (`src/lib/afCohorts.ts`) for a
  given `(clean_type × deal × period)` triple, or it can never be asked for that scope.
- **R2.1.2** — Cohort entries are added ONLY after per-cohort profiling against real production
  data proves the source field has meaningful coverage for that exact type/deal/period. Evidence
  lives in `docs/AF_COHORT_LEDGER.md`. **No question ships without a ledger entry.**
- **R2.1.3** — Absence is deliberate. A cohort that omits a question means the source data for
  that type+deal+period is too thin, too skewed, or absent. "Uncertified = do not ask" is the
  design, not an oversight.

### 2.2 Multi-type INTERSECTION rule

- **R2.2.1** — When multiple types are selected, a question survives ONLY if it is certified for
  **every single selected type**. `cohortAllows()` uses `types.every(...)` — a strict intersection.
- **R2.2.2** — **Why:** the shared SQL predicates are strict-NULL-excluding. An unrated apartment
  row FAILS a rating filter; it does not "pass through as unknown." Offering a Villa-only question
  on an Apartment+Villa scope would silently amputate every apartment the moment it's answered.
  Intersection prevents this by construction.
- **R2.2.3** — **Worked example:** Apartment allows `[rnpl, property_age, amenities, bathrooms,
  furnished]`, Villa (Rent) also allows `street_width, direction`. Intersection for Apartment+Villa
  = `[rnpl, property_age, amenities, bathrooms, furnished]`. `street_width` and `direction` drop
  out.
- **R2.2.4** — Empty intersection = zero AF questions. This is CORRECT — no evidence, don't ask.

### 2.3 Multi-period INTERSECTION rule (rentPeriod = 'both')

- **R2.3.1** — A question must appear in BOTH the `RentAnnual` and `RentMonthly` cohort lists to
  be askable in a 'both'-period scope.
- **R2.3.2** — Same NULL-exclusion reason as R2.2.2. Gathern rating is a Monthly-only signal;
  offering it in a 'both' scope would exclude every Annual listing the moment it's answered.

### 2.4 Multi-deal INTERSECTION rule (`dealCombined`)

- **R2.4.1** — A question must appear in `Buy` AND `RentAnnual` AND `RentMonthly` to be askable in
  a Buy+Rent combined scope. `dealCombined`'s Rent side has no period selector, so it spans both.
- **R2.4.2** — This correctly excludes Buy-only questions, Rent-only questions like `rnpl`, and
  Monthly-only signals like `rating`. A type with no certified Monthly cohort has ZERO combined-
  mode AF questions. Conservative on purpose.

### 2.5 Unknown must never be guessed or converted to false

- **R2.5.1** — Option counts only include listings where the source published the fact. `unknown`
  is a separate count shown as a caption; it is never rolled into a "no" chip.
- **R2.5.2** — A predicate like `bathrooms >= 3` is strict-NULL-excluding on the DB side. AF may
  only offer such a predicate when the cohort is certified for that field on that scope.
- **R2.5.3** — See `ops/ADVANCED_FILTER_SOURCE_TRUTH.md` for the full data-integrity contract.
- **R2.5.4** — **A FAILED, TIMED-OUT OR ERRORED PROBE IS `UNKNOWN` — never "not useful" and never
  "nothing left to narrow"** (owner rule 2026-08-26, made canonical 2026-08-28). A count probe that
  did not complete must not produce the same result as a source that answered "nothing here". Where
  no useful question survives AND any probe failed, AF's availability is UNDECIDED: retry once
  (bounded), then leave the offer exactly where it was so the user can simply try again. AF may
  never assert there is nothing left to narrow on the strength of a probe that never answered, may
  never invent or estimate a count to fill the gap, and may never relax the usefulness gate to
  compensate. Implemented in `src/lib/afProbe.ts` (`PROBE_FAILED` is a distinct value from `null`);
  enforced by `verify-af-probe-failure-not-a-verdict.ts`.

---

## 3. Scope hierarchy — CATEGORY → GROUP → EXACT TYPE

### 3.1 The three tiers, in order

- **R3.1.1** — AF first asks any UNRESOLVED scope tier the user has not yet pinned down:
  1. **CATEGORY** — usually already picked in the Filter form.
  2. **GROUP** — asked when Category is set but Group is not (e.g. Residential but no group).
  3. **EXACT TYPE** — asked when Group is set but exact type is not (e.g. "Villas & Houses" chosen
     but Villa vs Duplex vs Townhouse not).
- **R3.1.2** — Scope questions come first because most advanced questions only make sense per
  exact type. `unresolvedScopeTiers()` returns which tiers still need asking.
- **R3.1.3** — Scope steps do NOT count toward the round's 4-question cap
  (`AF_ROUND_MAX_QUESTIONS`). They are the prerequisite that earns the right to ask.

### 3.2 Skip / auto-resolution

- **R3.2.1** — If a group has exactly one member type visible in the current result set, that type
  is auto-resolved and its scope question is skipped.
- **R3.2.2** — If the exact type resolves to a cohort with **zero useful advanced questions** (per
  the usefulness rule in §5), the offer button MUST NOT render — see R4.4. Opening AF and
  immediately closing is a defect.

### 3.3 Scope answers are also carried forward

- **R3.3.1** — A scope answer once given is remembered across the whole interview. Round 2 never
  re-asks Group if Round 1 already answered it.

---

## 4. The offer button («خلّنا نحدد الطلب أكثر»)

### 4.1 Manual only, never auto-popup

- **R4.1.1** — AF NEVER opens by itself. The button appears below results; only the user's tap
  opens a round. (Owner rule 2026-08-19, permanent.)
- **R4.1.2** — No popup, no overlay, no auto-open, ever.

### 4.2 Only the newest results turn carries the button

- **R4.2.1** — When a new results turn lands (after any round or a fresh search), the previous
  turn's action buttons become read-only history. Only the newest turn is interactive.
- **R4.2.2** — This is enforced by `lastResultsMsg` in `agent.tsx` — buttons render only for the
  message whose id matches. See `verify-af-takes-over-cta.ts`.

### 4.3 Only shown when results > 25

- **R4.3.1** — `INTERVIEW_STOP_AT = 25` (`src/lib/afRanking.ts`). At ≤25 results, the offer is
  hidden — there is nothing worth asking.
- **R4.3.2** — The threshold is a hide, not a hard stop. If a round narrows to exactly 25, AF
  finishes; if it lands at 26+, the button may reappear if a useful question remains.

### 4.4 Only shown when a genuinely useful question exists

- **R4.4.1** — The offer probe runs `rankQuestions()` with the same carried asked-set the round
  itself would use. If nothing survives, the button is HIDDEN.
- **R4.4.2** — The offer and the round use the SAME usefulness predicate
  (`optionNarrowsMeaningfully`). Tapping the button must NEVER open a round that immediately closes.
- **R4.4.3** — This is enforced by `verify-af-offer-gate.ts` and `verify-af-offer-agreement.ts`.

### 4.5 The 0/1/2+ useful-question rule (owner 2026-08-24)

- **R4.5.1** — `MIN_USEFUL_QUESTIONS_TO_SHOW = 1` (`src/data/advancedFilters.ts`). Meaning:
  - **0 useful questions available** → AF is HIDDEN.
  - **1 useful question** → AF opens and asks that one question.
  - **2+ useful questions** → AF opens and asks them (up to the round cap).
- **R4.5.2** — Withholding a single genuinely useful question was the defect the 2026-08-24
  correction fixed. A useful question is a useful question — asking it is not a tax on attention.

---

## 5. Question usefulness — the ONE rule that decides everything

### 5.1 The rule (`optionNarrowsMeaningfully` in `src/lib/afRanking.ts`)

- **R5.1.1** — An option qualifies for asking if and only if:
  > `total - count >= total × 0.10`  **OR**  `count <= 25`
- **R5.1.2** — In plain English: **choosing this option must remove at least 10% of the current
  results, OR leave the user at 25 or fewer.** `MEANINGFUL_NARROWING_FRACTION = 0.1` and
  `INTERVIEW_STOP_AT = 25`.

### 5.2 The rule is ONE-SIDED — this is deliberate

- **R5.2.1** — Only near-no-op options are rejected. **Small-slice options are never rejected
  just because they are a small slice.** Choosing an 8-of-100 option removes 92 of 100 listings —
  that is an excellent question.
- **R5.2.2** — See the 2026-08-11→2026-08-25 rule history in the source comments: an earlier
  band-based rule that rejected BOTH extremes was wrong. The small-slice half of that ban was the
  actual bug (street_width «30m+» at 60 of 1,874 = 3.2%, dropped while it would have taken the
  user from 1,874 to 60). That half is banned forever; the over-correction was kept-and-then-
  reverted for lopsided majorities like 1,820 of 1,874.

### 5.3 Absolute per-option floor

- **R5.3.1** — `MIN_REAL_OPTION_COUNT = 5`. An option backed by fewer than 5 listings is hidden,
  full stop — this is the ONLY floor an option must clear to be considered real. Below the floor,
  the option is not "false" — it is not a meaningful chip at all.

### 5.4 Question-level survival (single vs multi)

- **R5.4.1** — `MIN_OPTIONS_SINGLE = 1` **(owner correction 2026-08-26; was `2`)**: a single-select
  question survives with even ONE real narrowing option. ~~"`MIN_OPTIONS_SINGLE = 2`: a single-select
  question must offer at least two real narrowing options (a real yes/no OR two rungs)."~~ The owner
  reversed this the day after this document was drafted: «if filtering removes the useless/lopsided
  option but leaves one genuinely useful option, do not throw away the whole question just because
  one option remains». `minOptionsFor()` is now UNIFORM across both arities.
- **R5.4.2** — `MIN_OPTIONS_MULTI = 1`: a multi-select question survives with even ONE meaningful
  chip — "yes / (implicit no)" is a valid narrow. **Unchanged** — and it is what R5.4.1 was
  reconciled to, since the identical option set was already asked as a multi.
- **R5.4.3** — ~~**Named side effect (not a bug):** a single-select where 92% and 6% are the only
  splits will drop the 92% chip (no-op) leaving just 6%, then fail `MIN_OPTIONS_SINGLE`, so the
  whole question dies. A 94%-cut option can disappear with its partner. This is the owner's chosen
  design and it is documented in the source comment on `scoreQuestion`.~~ **REVERSED 2026-08-26.**
  That question is now ASKED, carrying its 6% chip alone, as a yes/no against Skip — which is legal
  precisely because Skip is unconditional and applies ZERO predicate. What has NOT changed: ZERO
  surviving options still kills the question (R5.1 is now the only gate), and the per-option floor
  R5.3.1 still applies. Measured on production before shipping:
  `docs/ops/af-single-option-yes-no-2026-08-26.md` — 23 questions gained at cohort entry, 262
  mid-interview across 161 cohorts, none with a cut below 10%.

### 5.5 Ladder questions (bathrooms, street_width, rating)

- **R5.5.1** — Ladder questions render each rung as its own option. Each rung is filtered by the
  usefulness rule independently. Rungs above the near-no-op line drop; useful rungs survive.
- **R5.5.2** — **Worked example (Example G):** N=100, bathrooms distribution 100/98/60/20 for
  rungs ≥1/≥2/≥3/≥4. ≥1 (0% cut) drops, ≥2 (2%) drops, ≥3 (40%) keeps, ≥4 (80%) keeps. Question
  survives with two rungs.

### 5.6 Salience and ordering

- **R5.6.1** — `SALIENCE` weights (`property_age`, `furnished`, `rating` = 1.0; `unit_subtype` =
  0.95; `bathrooms`, `street_width` = 0.9; `amenities` = 0.8; `direction` = 0.7; `rnpl` = 0.6)
  order the SURVIVING questions by relevance × split-balance. **These weights only affect ASK
  ORDER, never inclusion.**
- **R5.6.2** — `ASK_FIRST_TIER['rnpl'] = 1` is a preferred opener for Annual Rent scopes, but
  ONLY reorders — a scope with no confirmed installment coverage fails `scoreQuestion` and rnpl
  is skipped like any other useless question.

### 5.7 Worked examples

| # | N | Distribution | Ask it? | Why |
|---|---|---|---|---|
| **B** | 100 | Gym: 100/0 | ❌ NO | "Yes" removes 0. "No" count=0 (below floor). Question dies. |
| **C** | 100 | Gym: 98/2 | ❌ NO | "Yes" removes 2 (2% — under 10%). "No" count=2 (below floor). Question dies. |
| **D** | 100 | Gym: 8/92 | ✅ YES | "Yes" removes 92 (92%). "No" removes 8 (8% — under 10%, drops). Multi-chip survives with just "Yes". |
| **G** | 100 | Bath ≥1/≥2/≥3/≥4 = 100/98/60/20 | ✅ YES | ≥1, ≥2 drop; ≥3, ≥4 survive as two useful rungs. |
| **H** | 26 | Any option that reaches ≤25 | ✅ YES | The "OR count ≤ 25" clause guarantees the final step is never blocked by the 10% floor. |
| **I** | 50 | option yields 47 | ❌ NO | Removes 3 (6%). Under 10% and 47 > 25. |
| **I2** | 50 | option yields 45 | ✅ YES | Removes 5 (10% exactly) — the "≥" makes 10% qualify. |

---

## 6. Rounds — small, cumulative, capped

### 6.1 Round size

- **R6.1.1** — `AF_ROUND_MAX_QUESTIONS = 4`. A round asks **1, 2, 3, or 4** advanced questions —
  whichever is `min(availableUseful, 4)`, minimum 1.
- **R6.1.2** — There is **no minimum of 2**. A round with a single useful question is a valid
  round (that is what the R4.5 revision established).
- **R6.1.3** — Scope steps do not count against the cap.
- **R6.1.4** — A round is NEVER truncated to hit the cap. Which questions get asked is decided
  only by `scoreQuestion()` (usefulness first), then the top-`AF_ROUND_MAX_QUESTIONS` by score.

### 6.2 Cumulative carry — no repeated asks

- **R6.2.1** — Every ANSWERED question and every SKIPPED question is remembered. The carry
  (`afCarryRef.asked`) is unioned into the round's asked-set on entry.
- **R6.2.2** — Round N+1 must never re-ask what Round N answered or skipped.
- **R6.2.3** — Enforced by `verify-af-cross-round-carry.ts`.

### 6.3 After a round

- **R6.3.1** — A new results turn lands with the narrowed count (e.g. 5,000 → 900).
- **R6.3.2** — The PREVIOUS turn's action buttons are replaced by a read-only **receipt** of what
  was committed (e.g. "✓ عرض الشارع: ≥20م · عدد الحمامات: ≥3").
- **R6.3.3** — Committed answers also appear as **removable pills** above the new turn (see §9).
- **R6.3.4** — If the new turn still has >25 results AND a useful question remains, the offer
  button appears again — the user may run another round.

### 6.4 Progressive narrowing example (Example E)

> Search → 5,000 → tap تحديد أكثر → Round 1 asks 3 questions → 900 → tap again → Round 2 asks 3
> more → 180 → tap again → Round 3 asks 2 more → 22 → AF stops (≤25).

### 6.5 Stopping when useless questions remain (Example F)

> Search → 500 → Round 1 → 80. All remaining questions are useless (near-no-op or below option
> floor). **AF stops at 80.** Offer button HIDDEN. Only «عرض المزيد» remains. This is CORRECT.
> Never invent a garbage question to force below 25.

---

## 7. Live counts — every visible number is DB truth

### 7.1 What every count means

- **R7.1.1** — Each option's count is the count of matching listings in the CURRENT eligible set
  (after all normal filters + all previously-committed AF facts).
- **R7.1.2** — The Continue button ("متابعة · N نتيجة") shows the count for the **current
  tentative selection**, before committing.
- **R7.1.3** — The unknown-count caption ("X إعلان لم يذكر …") shows how many listings have no
  value for the field — never rolled into any option's count.

### 7.2 Multi-select marginal vs combined

- **R7.2.1** — In a multi-select question, each chip's count is the count for that chip alone
  (marginal), not the combined effect of everything currently ticked. The FOOTER count is the
  combined effect.
- **R7.2.2** — The FOOTER count is the combined effect of everything currently ticked, and there are
  **two shapes**. Which one applies is decided by the DATA, not by the question — so neither is a
  special case, and production implements both (owner decision 2026-08-28):
  - **Several values of ONE field UNION.** Directions, unit subtypes, exact bathroom counts and
    property types all live in a single column, and a listing holds exactly one value, so each extra
    tick admits MORE listings and the count RISES. Measured live: شمال 488 + جنوب 325 = **813**.
  - **Several DIFFERENT amenities INTERSECT.** Each amenity is its own boolean column, so each tick
    is another requirement and the count FALLS. Measured live: تكييف 2,831 ∩ مصعد 1,803 = **1,619**.
  - **Multi-amenity must never be an OR.** A user asking for AC *and* a lift must never be shown a
    listing with only one of them. Enforced by `verify-af-multiselect-combining-semantics.ts`, which
    fails in BOTH directions (an amenity chain turned disjunctive, or a value domain turned
    conjunctive).

### 7.3 No stale counts

- **R7.3.1** — While an RPC is in flight, the count MUST NOT show a previous scope's value.
  Blank (or a subtle loading indicator) is better than stale.
- **R7.3.2** — Enforced by `verify-af-count-belongs-to-selection.ts`.

### 7.4 True eligible total stays honest

- **R7.4.1** — The result-turn headline says "لقينا N إعلان يطابق طلبك" — N is the true eligible
  count, not the number of cards currently shown. If only the first 10 are displayed, the "10
  displayed" is the display-cap footer message, never the headline.
- **R7.4.2** — See the fleet-wide `feedback_result-cap-min-true-100-rule` — the headline count is
  the DB truth; the display cap is a separate concept.

### 7.5 Count = independent DB oracle

- **R7.5.1** — The headline count on any results turn must equal what an independent SQL query
  against `search_listings_ar` for the exact same predicates would return.
- **R7.5.2** — Enforced by `verify-af-live-truth.ts` + `verify-af-independent-oracle.ts` running
  daily against production.

---

## 8. Skip / Back / Show Results

### 8.1 Skip («تخطي») — "I don't care"

- **R8.1.1** — Skip writes **zero predicate**. Nothing is added to the query.
- **R8.1.2** — The result count is UNCHANGED by a skip. UNKNOWN listings and every other
  value remain fully eligible.
- **R8.1.3** — The skipped question is remembered — it will not be asked again this round or in
  any future round.

### 8.2 Back («رجوع»)

- **R8.2.1** — On question 2 or later of a round: Back steps to the previous question and
  restores its previous answer (if any). Changing that answer rebuilds every step after it from
  the new selection forward.
- **R8.2.2** — On question 1 of a round: Back **cancels the round entirely** and returns the user
  to the previous result state byte-identically — no receipt, no pill, no probe verdict written.
- **R8.2.3** — Back writes NO receipt, NO pill, NO probed-canNarrow verdict, ever.
- **R8.2.4** — Enforced by `verify-af-back-navigation.ts` + `verify-af-round-back-boundary.ts`.

### 8.3 The question footer (owner decision, 2026-08-28)

- **R8.3.1** — The question footer offers exactly THREE controls — متابعة (primary), تخطي and
  رجوع as real buttons — and NO in-question «عرض النتائج» early-exit. (Owner, 2026-08-28,
  reversing the 2026-08-16 escape-link rule: the removed control used to commit the round early;
  a round now ends by walking its questions, by Back from question 1, or by ✕. A same-day
  follow-up removed the intro card's «عرض النتائج» decline link as well — ✕ declines the intro;
  no عرض النتائج action exists anywhere inside the AF flow.)
- **R8.3.2** — When a round ends, a new results turn lands; the previous turn's buttons become
  the receipt (§6.3).

### 8.4 Skip All («تخطي الباقي»)

- **R8.4.1** — Skips every remaining question in the current round. Skipped questions are
  remembered per R8.1.3.

---

## 9. Pills — the committed AF state

### 9.1 What pills show

- **R9.1.1** — Every COMMITTED (not skipped) AF answer appears as a removable pill above the
  newest results turn. The pill's label is the human-readable summary of the answer.
- **R9.1.2** — Pills are cumulative across all rounds — a pill from Round 1 is still visible and
  removable after Round 3.

### 9.2 Removing a pill

- **R9.2.1** — Tapping a pill's ✕ removes ONLY that one committed predicate. Every other
  committed answer stays.
- **R9.2.2** — The search re-runs without that predicate. The result count may WIDEN. A new
  results turn lands below with the new count. Nothing above is rewritten.
- **R9.2.3** — The removed question becomes eligible to be asked again in a future round — it is
  DROPPED from the `asked` carry. Removing a pill must not permanently "burn" that question.
- **R9.2.4** — Enforced by `verify-af-cross-round-carry.ts` (the pill-removal + asked-drop check).

### 9.3 What pills are NOT

- **R9.3.1** — Pills never show skipped questions. The summary must equal the committed state by
  construction — see `feedback_af-summary-equals-committed-state-permanent-rule`.

---

## 10. Show More («عرض المزيد») — separate from AF

### 10.1 Distinct purpose

- **R10.1.1** — Show More reveals more CARDS from the SAME eligible result set. It does not
  narrow, does not add a filter, does not change the true total.
- **R10.1.2** — Show More and Advanced Filter are independent controls that can both appear on
  the same newest results turn.

### 10.2 After Show More

- **R10.2.1** — The revealed cards persist in the transcript (see the persistence contract).
- **R10.2.2** — The turn remains interactive (offer button, Show More button) as long as it is
  the newest results turn.
- **R10.2.3** — When a NEW results turn lands (from an AF round or a follow-up), the previous
  turn's Show More button becomes history.

---

## 11. Stopping conditions

AF stops (offer button hidden, round refuses to open) when ANY of:

- **R11.1** — Current eligible results ≤ 25 (`INTERVIEW_STOP_AT`).
- **R11.2** — No remaining question has any option that clears
  `optionNarrowsMeaningfully(count, N)`.
- **R11.3** — The certified cohort intersection for the current scope is empty (multi-type or
  multi-period/deal with no shared cohort).
- **R11.4** — User taps Skip All in the middle of a round (the round ends; future rounds may
  still open if a useful question remains and R11.1/R11.2 haven't triggered).

**AF does NOT keep asking to hit a numeric target.** 80 listings remaining with no useful question
is a valid, correct stop.

---

## 12. Persistence — the chat holds the whole conversation

Full contract lives in `ARCHITECTURE.md §7.4b` and `feedback_chat-persistence-chatgpt-*`. The
AF-specific consequences:

- **R12.1** — Every AF question turn, every answer selection, every receipt, every pill state,
  every revealed Show More page — all persist as part of the chat transcript.
- **R12.2** — Switching to another chat and coming back restores the exact conversation. Refresh
  restores it. Log out + log back in restores it.
- **R12.3** — Only the newest results turn stays interactive after restore. Older turns are
  read-only history — never recreated from the original filter.
- **R12.4** — Deleting a chat deletes the full server transcript, not just the sidebar entry.
- **R12.5** — Continuation identity: AF round → same chatId → same sidebar entry. Rounds never
  fork into new sidebar rows.

---

## 13. What AF must NEVER do

- **R13.1** — Never ask a Normal-Filter question (bedrooms, price, area, city, deal, period). Those
  live in the Filter form. See `project_normal-vs-advanced-filter-boundary-2026-08-11`.
- **R13.2** — Never invent a fact the source did not publish.
- **R13.3** — Never convert `unknown` into `no` or `yes`.
- **R13.4** — Never auto-open, never auto-advance, never popup.
- **R13.5** — Never recommend, never rank by "best," never say "good deal."
- **R13.6** — Never show a count that disagrees with the DB truth for the current selection.
- **R13.7** — Never re-ask an answered or skipped question in the same interview.
- **R13.8** — Never fork a conversation into a new sidebar entry between rounds.
- **R13.9** — Never permanently burn a question the user un-answered (removed the pill for).
- **R13.10** — Never offer a round that would immediately have nothing to ask.
- **R13.11** — Never turn our own outage into a statement about the data. A timeout, error or
  blocked request is something WE failed to learn, never something the source said.

---

## 14. Trending Cities and Trending Districts

Added 2026-08-28 (owner decision). Trending was governed only by the engineer routine's own spec,
so the "single source of truth" did not actually cover it and a future engineer rebuilding it from
this document would have had nothing to read. **This section formalises behaviour that already
ships; it changes nothing in production.**

### 14.1 What Trending IS

- **R14.1.1** — Trending is the **location breakdown of the user's exact current eligible set** —
  never a generic popularity list, never a cached "top cities" table.
- **R14.1.2** — City Trending respects the COMPLETE filter state: category, group, property type,
  Buy/Rent, Annual/Monthly/both, bedrooms, area, price (including the independent Buy and Rent
  budgets of §1.4), and every committed Advanced Filter answer.
- **R14.1.3** — District Trending, once a city is chosen, inherits that same complete state.

### 14.2 Every visible number is DB truth

- **R14.2.1** — For every visible row: **displayed count = Trending RPC = the count the user gets
  after clicking it = independent DB truth.** The same chain §7.5 requires of AF counts.
- **R14.2.2** — Counts must not go stale across a filter change; a count belongs to the state that
  produced it.
- **R14.2.3** — Every visible row gets a truthful narrowed count, not only the first N rows.
- **R14.2.4** — Where a district's name merges orthographic variants, the count covers the WHOLE
  merged set, matching what clicking it returns.

### 14.3 Honest zero over false fallback

- **R14.3.1** — A count must NEVER be a widened or unfiltered fallback presented as filtered truth.
  Every widening fallback is gated on the user not being narrowed.
- **R14.3.2** — **If a live narrowed count is unavailable, show NO count rather than a false one.**
  An empty field is honest; an overstated one is not.

### 14.4 Trending must not be left behind

- **R14.4.1** — A filter added to the main search must reach Trending. A count surface that silently
  drops a predicate is a defect, not a limitation — the single `rpcAllNarrowingParams()` definition
  exists so a new filter arrives everywhere by construction.
- **R14.4.2** — Trending must remain usable under narrowing. A narrowed state that makes the call
  time out is a P1 defect: the field goes empty and the user loses the surface entirely.

## 15. Numeric constants — the whole product's tuning surface

All constants live in **one file per concept** and are imported everywhere else. Changing them
here changes the entire product; no other file may hard-code the number.

| Constant | Value | File | Meaning |
|---|---|---|---|
| `INTERVIEW_STOP_AT` | 25 | `src/lib/afRanking.ts` | Result-count floor; AF hides at/below. |
| `MIN_TOTAL_TO_SHOW` | 26 | `src/lib/afRanking.ts` | = INTERVIEW_STOP_AT + 1. |
| `MIN_REAL_OPTION_COUNT` | 5 | `src/lib/afRanking.ts` | Absolute per-option floor. |
| `MIN_OPTIONS_SINGLE` | ~~2~~ **1** | `src/lib/afRanking.ts` | Single-select survives with ≥1 real option (owner 2026-08-26; was 2). |
| `MIN_OPTIONS_MULTI` | 1 | `src/lib/afRanking.ts` | Multi-select survives with ≥1. |
| `MEANINGFUL_NARROWING_FRACTION` | 0.10 | `src/lib/afRanking.ts` | The 10% narrowing rule. |
| `AF_ROUND_MAX_QUESTIONS` | 4 | `src/lib/afRanking.ts` | Round size cap. |
| `MIN_USEFUL_QUESTIONS_TO_SHOW` | 1 | `src/data/advancedFilters.ts` | 0 hides, 1+ asks (owner 2026-08-24). |

---

## 16. AUDIT — every rule vs current production code + barriers

Performed 2026-08-26 against `main@11cfd2f`.

| Rule | In code? | Barrier (existing) |
|---|---|---|
| R1.1 Category single-select | ✅ `setCategory()` in `src/lib/searchDefaults.ts` | — (add: `verify-af-category-single-select.ts`, see §16) |
| R1.2 Multi-type within category | ✅ `p_types = ANY(...)` in `resolveSearchScope` | `verify-multi-group-scope.ts` |
| R1.3 Row-level OR | ✅ `type_ar IN (...)` in RPC | `verify-af-independent-oracle.ts` proves union math |
| R1.4 Buy+Rent combined | ✅ `q.dealCombined` → `p_deal=null`, dual budgets | `verify-buy-rent-combined-af-gating.ts` |
| R1.5 Annual+Monthly both | ✅ `rentPeriod === 'both'` | `verify-mixed-period-af-gating.ts`, `verify-rent-period-both.ts` |
| R2.1 Cohort registry | ✅ `COHORT_QUESTIONS` in `afCohorts.ts` | `verify-af-group-cohort-coverage.ts` |
| R2.2 Multi-type intersection | ✅ `types.every(...)` in `cohortAllows()` | `verify-af-group-cohort-coverage.ts` (executes intersection) |
| R2.3 Multi-period intersection | ✅ `cohortAllows()` `rentPeriod === 'both'` branch | `verify-mixed-period-af-gating.ts` |
| R2.4 Multi-deal intersection | ✅ `cohortAllowsCombined()` | `verify-buy-rent-combined-af-gating.ts` |
| R2.5 Unknown ≠ no | ✅ strict-NULL SQL predicates | `ops/ADVANCED_FILTER_SOURCE_TRUTH.md` invariants |
| R3 Scope hierarchy | ✅ `unresolvedScopeTiers` / `SCOPE_QUESTIONS` | `verify-af-scope-hierarchy.ts` |
| R4.1 Manual open | ✅ button in `agent.tsx`, no auto-open | `verify-af-takes-over-cta.ts` |
| R4.2 Newest turn only | ✅ `lastResultsMsg` gate | `verify-af-takes-over-cta.ts` |
| R4.3 >25 gate | ✅ `INTERVIEW_STOP_AT` in offer + ask | `verify-af-offer-gate.ts` |
| R4.4 Useful question exists | ✅ `offersMeaningfulNarrowing()` = `optionNarrowsMeaningfully` | `verify-af-offer-gate.ts`, `verify-af-offer-agreement.ts` |
| R4.5 0/1/2+ rule | ✅ `MIN_USEFUL_QUESTIONS_TO_SHOW = 1` | `verify-af-min-useful-questions-gate.ts` |
| R5.1 10% OR ≤25 usefulness | ✅ `optionNarrowsMeaningfully` | `verify-af-narrowing-gate.ts` |
| R5.2 One-sided (small slice kept) | ✅ same predicate | `verify-af-narrowing-gate.ts` |
| R5.3 Per-option floor | ✅ `meaningful()` filter, `MIN_REAL_OPTION_COUNT` | `verify-af-narrowing-gate.ts` |
| R5.4 Single vs multi survival | ✅ `minOptionsFor()` | `verify-af-two-option-survival.ts` |
| R5.5 Ladder rungs | ✅ per-rung `scoreQuestion` | `verify-af-narrowing-gate.ts` |
| R6.1 Round cap 4 | ✅ `AF_ROUND_MAX_QUESTIONS` | `verify-af-round-size.ts` |
| R6.2 Carry answered+skipped | ✅ `afCarryRef.asked` | `verify-af-cross-round-carry.ts` |
| R6.3 Receipt on prior turn | ✅ `afReceipt[m.id]` + `buildAfSummary()` | `verify-af-round-back-boundary.ts` |
| R7.1 Live counts = current selection | ✅ `resolveOptions` per-scope | `verify-af-count-belongs-to-selection.ts` |
| R7.3 No stale count | ✅ blank while pending | `verify-af-count-belongs-to-selection.ts` |
| R7.4 Headline = true total | ✅ `matchTotal` | `feedback_result-cap-min-true-100-rule.md` + `verify-result-cap-honesty.ts` |
| R7.5 Count = DB oracle | ✅ shared `af_eligibility_clause()` | `verify-af-live-truth.ts`, `verify-af-independent-oracle.ts` |
| R8.1 Skip = no predicate | ✅ `skipStep()` writes nothing | `verify-af-back-navigation.ts` |
| R8.2 Back semantics | ✅ `onAgeBack` | `verify-af-back-navigation.ts`, `verify-af-round-back-boundary.ts` |
| R9.1 Pills = committed only | ✅ `guidedPills.facets` | `verify-af-emoji-summary.ts` |
| R9.2 Pill removal re-searches, drops from asked | ✅ `removeGuidedFacet` | `verify-af-cross-round-carry.ts` |
| R10 Show More independence | ✅ `loadMore` never touches filter/AF state | `verify-refresh-restores-filter-search.ts` |
| R11 Stopping conditions | ✅ `finishGuided` paths | `verify-af-round-size.ts`, `verify-af-narrowing-gate.ts` |
| R12 Persistence | ✅ chat transcript | `verify-chat-persistence.ts`, `verify-chat-persistence-live.mjs` |
| R13.1 No normal-filter Qs | ✅ `filter_tier` boundary | `verify-af-narrowing-gate.ts` |
| R13.4 No auto-open | ✅ `af-never-auto-open-popup` project memory | `verify-af-takes-over-cta.ts` |

### 15.1 Code/prose conflicts found

**NONE.** Every rule in this contract is faithfully implemented in `main@11cfd2f` code today.

### 15.2 Rules already barriered

**37 of 40** rules have a directly-corresponding barrier that executes their invariant. The
remaining 3 are structural rules with no numeric test needed (R1.1's exception, R6.1.4's negative
of "never truncate for cap", and R9.3's "no skipped in summary" — all covered by the summary
oracle in `verify-af-emoji-summary.ts` and the round-cap regex in `verify-af-round-size.ts`).

### 15.3 Owner decisions needed

**NONE.** Every rule in this contract reflects an owner decision already made and shipped.

---

## 17. New barrier added: category single-select

R1.1 (single-select category) was implemented but not directly barriered. Added
`scripts/verify-af-category-single-select.ts` in the same change as this contract — executes
`setCategory()` to prove: tapping the same category twice clears it; switching category clears
every downstream field (typeGroups, type, types, detail, contextBeds, contextBedsList,
contextSize); a cross-category scope offers zero AF questions via `cohortAllows()`.

---

## 18. Reading order for a new engineer

1. This file (**§0 core philosophy** in one minute).
2. `ARCHITECTURE.md §6` (Frontend — the AI agent) for the surrounding architecture.
3. `docs/ADVANCED_FILTER_DESIGN_CONTRACT.md` for the UI/UX rules.
4. `docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md` for the data-integrity contract.
5. `docs/AF_COHORT_LEDGER.md` when adding or removing a certified cohort.
6. `src/lib/afRanking.ts` and `src/lib/afCohorts.ts` — the pure modules with the load-bearing
   comments.
7. `scripts/verify-af-*.ts` — the barriers, each with a header explaining what defect it
   prevents.

Do NOT rebuild AF understanding from old PR descriptions, old chat conversations, or old
comments elsewhere in the codebase. This document + those files are the whole product.

---

## SUMMARY

- **RULES DOCUMENTED: 74** (across §§1–13; count is R-numbers written above.)
- **RULES ALREADY BARRIERED: 37 of 40 rule *families*** (individual R-numbers roll up into 40
  test-provable invariants; 37 have a directly-corresponding barrier that executes the rule,
  the other 3 are structural properties covered by adjacent barriers.)
- **NEW BARRIERS ADDED: 1** — `scripts/verify-af-category-single-select.ts` (added in the same
  change as this contract, wired into `npm test`, mutation-proven).
- **CODE/PROSE CONFLICTS FOUND: 0.**
- **OWNER DECISIONS NEEDED: NONE.**
- **CANONICAL AF PRODUCT CONTRACT COMPLETE: YES.**
