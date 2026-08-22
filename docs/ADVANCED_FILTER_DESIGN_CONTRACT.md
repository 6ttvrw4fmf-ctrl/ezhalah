# Advanced Filter Design Contract (PERMANENT)

Owner-mandated 2026-07-20. This contract governs **every** Advanced Filter question — installments,
property age, amenities, minimum bathrooms, and every future one (Floor Number, Street Width, …).

> **The single rule:** one shared component owns **100%** of the chrome, layout, spacing, typography,
> motion, progress, footer, skip, counts, and interaction. A question is **pure data + rules** — it
> never renders UI, never sets a style, never picks an interaction. Adding a filter = adding **one
> config object**. If a change requires touching the card, it changes the contract for *all*
> questions, on purpose — never for one.

This supersedes the styling/interaction guidance in `ADVANCED_FILTER_PATTERN.md` (that doc stays as the
data/RPC-reuse pattern; this doc is the UI/UX law).

---

## 1. The boundary — the ONLY things a question may supply

```ts
export type AdvancedQuestion = {
  id: string;                                   // stable key, e.g. 'property_age'
  title: string;                                // i18n key — the headline
  description?: string;                          // i18n key — optional one-line subtitle
  brandImage?: string;                           // optional asset TOKEN (owner 2026-07-21, e.g. 'ejari-rnpl')
  selection: 'single' | 'multi';                // arity — the ONLY behavioural switch
  eligibility: (scope: SearchQuery) => boolean;  // ONE unified scope gate (see §9)
  resolveOptions: (scope: SearchQuery) => Promise<AdvancedOption[]>; // [{key,label,count}], live, pre-filtered
  apply: (query: SearchQuery, selectedKeys: string[]) => SearchQuery; // how the answer merges into search
};

export type AdvancedOption = { key: string; label: string; count: number }; // label = i18n-resolved text
```

A question supplies **exactly these eight fields — nothing else.** No `mode`-specific render hooks, no
`liveCount` fn (the card derives the live count from `resolveOptions` + `apply`), no styles, no icons,
no copy beyond `title`/`description`/option `label`s. `brandImage` is a **string token only** — the
card owns a private token→asset registry (`BRAND_IMAGES`), the single slot it renders in (under the
subtitle, above the options), and its one shared style; a question may never pass an asset, a
`require()`, or a style. `single` gets `selectedKeys.length ≤ 1`; `multi` gets `≥ 0`. Everything
visual and behavioural below is owned by the shared component.

---

## 2. Card layout — identical for every question

```
┌───────────────────────────────────────────┐
│  ✦  Ezhalah AI Agent                    ✕  │  Shell top-bar (fixed)
├───────────────────────────────────────────┤
│  ▓▓▓▓▓▓▓▓░░░░░░░░░░░  Question {c} of {t}   │  Progress bar + numeric caption (§3)
│                                             │
│  {title}                                    │  Title  (h-question)
│  {description}                              │  Subtitle (optional, muted)
│  ┌─────────────────────────────────────┐   │
│  │            {brandImage}              │   │  Brand strip (optional, §1 token; card-owned slot)
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │ ◉/☑  {label}                  {count}│   │  Option row — ONE template (§8)
│  │ ○/☐  {label}                  {count}│   │  leading indicator · label · trailing count
│  │ ○/☐  {label}                  {count}│   │
│  └─────────────────────────────────────┘   │
│  {unknown-count caption, when > 0}          │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │            Show {N}                  │   │  Footer primary — live count (§4)
│  └─────────────────────────────────────┘   │
│   Skip       Skip remaining ({n}) & search  │  Footer secondary (§7)
└───────────────────────────────────────────┘
```

- One `Shell` (overlay + backdrop + top-bar + `Reveal`) wraps loading and every question — no container
  jump.
- The **row template is the same** for single and multi. The only per-mode difference is the leading
  indicator glyph (radio `◉/○` for single, checkbox `☑/☐` for multi) and how many rows may be selected.
- No question adds, removes, reorders, or restyles any slot.

---

## 3. Progress behaviour — identical

- **Denominator = the number of questions ELIGIBLE for the current scope**, computed up front (run every
  question's `eligibility` + a cheap options probe once at flow start), **not** the static array length.
- **Numerator = the 1-based ordinal among the questions that will actually show.**
- The bar **animates** its width between steps.
- **Numeric caption** (owner 2026-07-21): `Question {cur} of {total}` renders beside the bar on every
  card, and the skip-all link discloses the remaining count — `Skip remaining ({n}) and search now` —
  so the user always sees how many questions are left. English digits, tabular-nums (§8 locale rule).
- Hidden entirely when only one question is eligible.
- Never shows a fraction that can't reach 100% (the current `2/4` bug is banned by this section).

---

## 4. Footer — identical, always present on every card

Every card (single and multi) has the **same footer**:
- **Primary button — `Show {N}`** where `N` is the **live** result count for the current selection
  (§8). Always present. Pressing it **commits the selection and advances** (or searches, if last).
- The primary is the single canonical "commit" affordance for **both** modes — see §9 (no auto-advance).
- Secondary row: **Skip** (this question) and, when >1 question remains, **Skip all & search now** (§7).

---

## 5. Spacing & typography — identical, tokens only

- **Zero raw literals.** Colors, radii, spacing, and shadows come from the app design tokens
  (`colors.*`, `radius.*`, `space.*`, `cardShadow`). Brand green = `colors.primary` (#2f7247); never a
  hex literal in the card.
- **Font = Poppins** via the token typography scale — set once on the card root, inherited by all text.
- Row height, inner padding, inter-row gap, title/subtitle/label/count sizes and weights are **one set
  of token values** shared by both modes. A reviewer must not be able to tell single from multi by
  spacing or type.

---

## 6. Animations — identical

Shared, token-timed transitions applied by the card (never per question):
- `Reveal` on open (existing).
- Progress-bar width transition between steps.
- Selection highlight transition on a row (in/out).
- Live-count cross-fade when `Show {N}` changes; loading dots during the async re-count (hold the last
  good number, never flash a wrong one).

---

## 7. Skip behaviour — identical

Three exits on **every** card (single and multi):
- **Skip** → advance to the next eligible question, no change to the query.
- **Skip all & search now** → commit whatever is accumulated and run the search immediately.
- **Close (✕)** → abandon the flow, no search.

The current gap — multi cards missing "Skip all" — is banned. The two skip actions must be visually
distinct and consistently styled across both modes (Skip = secondary button; Skip-all = tertiary link).

---

## 8. Count presentation — identical

- **Per-option:** a trailing **count pill** on **every** row, both modes (grouped English digits,
  tabular-nums, per the locale rule — numbers stay English).
- **Aggregate:** the footer **`Show {N}`** live count on **every** card. `N` = exactly what Search will
  return for the current selection (**count == search**, always — same predicate at count and search
  time).
- **Unknown-count caption** rendered in the same slot when a question reports `> 0` unknowns.
- No question hides a count that another shows. (The current gap — chips hide per-option counts — is
  banned.)

---

## 9. Interaction principles — identical

- **Select-then-confirm for ALL questions.** Tapping a row *selects* it (radio for single — replaces the
  prior pick; checkbox for multi — toggles); it does **not** auto-advance. The footer `Show {N}`
  commits and advances. This kills the "tap-to-advance vs toggle-then-confirm" whiplash — single and
  multi feel identical; only the selection count differs.
- **Every question is optional/skippable** (§7).
- **One unified eligibility gate.** `eligibility(scope)` is the *only* visibility rule a question
  declares, and all questions share the same gate contract (same thresholds: a question shows only when
  it clears the scope-size floor `MIN_TOTAL_TO_SHOW (= INTERVIEW_STOP_AT + 1 = 26 since 2026-08-11)` **and** has ≥ the required real options —
  **one** `MIN_REAL_OPTION_COUNT` applied to single **and** multi alike; the current `>0` (chips) vs
  `>=5` (buckets) split is banned). Age's gate must live in its own config like every other question —
  no gate may live only at the call site.
- **Silent when ineligible** — an ineligible question is skipped; the flow never renders an empty card.
- **Consistent feedback** — selection feedback weight is the same in both modes; no mode has strong
  feedback while the other has none.

---

## 10. Enforcement — how drift is made impossible

1. **One component.** `AdvancedQuestionCard` is the *only* renderer. Questions live in
   `ADVANCED_QUESTIONS` as config objects and never import React/StyleSheet.
2. **No per-question branching in the card.** The card switches on `selection` (single/multi) and
   nothing else — never on a question `id`.
3. **`scripts/verify-advanced-filter-contract.ts`** (wired into `npm test`) asserts, by grepping the
   shipped source:
   - every `ADVANCED_QUESTIONS` entry declares only the seven allowed fields (§1);
   - the card contains **no question-`id` string** and **no raw hex/`px` literals** (tokens only, §5);
   - footer primary (`Show {`), **both** skip actions, the per-row count pill, and the progress bar are
     rendered for **both** modes;
   - progress denominator is derived from the eligible set, not `ADVANCED_QUESTIONS.length`.
4. **PR checklist.** Any PR adding/altering an Advanced Filter must confirm "adds/edits only a config
   object; no card change" — or, if it changes the card, it changes the contract for all questions and
   updates this doc + the verify test.

---

## 11. What this fixes (from the 2026-07-20 architecture review)

Unifying under this contract resolves every inconsistency the review found: the two interaction
grammars (§9), the broken progress numerator/denominator (§3), the missing multi "skip-all" (§7), the
hidden per-chip counts (§8), the `Skip`/`No preference` weight mismatch (§7), the hardcoded "apartments"
copy (§4 generic `Show {N}`), and the raw-literal token bypass (§5). Adding **Floor Number**, **Street
Width**, or any future filter is then a one-config-object change that inherits the entire system for
free.


## Amendment 2026-08-11 — the contextual interview (owner-approved)

- The interview is available only when the user's OWN search has **more than 25** results, and it
  stops asking the moment **25 or fewer** remain — both from the same constant
  (`INTERVIEW_STOP_AT = 25`, `MIN_TOTAL_TO_SHOW = 26`).
- Ask-order is **not** the queue: `rankQuestions()` re-probes and re-scores the still-unasked pool
  against the CURRENT candidate set after every answer (`score = split × salience` with the
  usefulness gates in `scoreQuestion()`). `ADVANCED_QUESTIONS` is the probe universe only.
- A question answered OR skipped is never re-asked in the same session (`ageFlowAskedRef`).
  **Skip = no preference**: nothing is filtered, no false is written, unknowns stay eligible.
- `FURNISHED_QUESTION` (single, Rent-only) is true tri-state via `q.furnishedPref` → `p_furnished`;
  «غير مفروشة» counts EXPLICIT unfurnished only (`cnt_unfurnished` = furnished IS FALSE).
- Single-select auto-advances ~260 ms after the tap (plain `setTimeout`, never an animation
  callback). Multi stays select-then-confirm.
- No numeric «Question N of M» caption — the denominator legitimately changes as the set narrows;
  the thin bar and the shrinking live count are the only progress signals.
- Normal-Filter territory (location, deal, period, category/type, price, size, **bedrooms**) is
  never asked by the interview — enforced as data via `af_field_registry.filter_tier`.


## Amendment 2026-08-16 — the conversational refresh (owner-approved)

The owner's brief: «The user should feel like Ezhalah is quietly understanding what they want and
narrowing the market for them, not forcing them to fill another form.» Everything below is pinned by
`scripts/verify-advanced-filter-contract.ts`.

- **Intro-first entry (supersedes 2026-08-03 results-first).** An eligible Filter search with MORE
  than 25 results auto-opens the overlay on a calm intro — «لقينا N عقار» + «خلّنا نحدد طلبك أكثر»
  + one soft availability line — never a question. «عرض النتائج» closes it (results are already
  rendered behind). ≤ 25, or an ineligible scope, keeps pure results-first. A manual «خلّنا نحدد
  الطلب أكثر» tap skips the intro (the user already opted in).
- **The narrowing is always visible.** A live «N نتيجة» chip sits in the card bar and follows every
  tentative selection; multi-select commits via «متابعة · N نتيجة» with the same live number. All
  numbers come from the production count RPCs — never placeholders, never unknown-as-no.
- **The escape is always one tap.** «عرض النتائج» replaces the question-count skip-all arithmetic.
- **Availability is explained naturally.** One tiny line — «الخيارات تعتمد على المعلومات المتوفرة
  للإعلانات الحالية» — replaces the technical unknown-count phrasing. No coverage/NULL/backend
  language anywhere user-facing.
- **Micro-motion, reduced-motion-safe.** Press compression, check fade/scale, count settle, question
  fade-rise. Decoration only: every hand-off (auto-advance, mining dismissal) is a plain
  `setTimeout`, never an animation callback (`src/lib/afterAnimation.ts`).
- **The mining transition.** After the interview commits ≥1 answer, the «digging through the market»
  beat plays over the final search: fragments drift inward, copy uses REAL numbers («نراجع N عقار
  ونطلع لك الأنسب» → «لقينا N عقار أقرب لطلبك»), minimum ~1.4 s, dismissed by setTimeout latches
  with a 15 s failsafe + a catch on the search itself. Skip-everything closes with no beat.
- **Results summary + removable pills.** The guided results turn shows «بناءً على: …» and each
  committed answer as a removable pill. Removal is PURE recomputation: rebuild from the interview's
  baseQ by re-applying the remaining facets through each question's own `apply()` — never a
  hand-written inverse — then re-search immediately (no mining beat on removal).


## Amendment 2026-08-22 (a) — the narrowing gate (owner-approved, supersedes the 8%-90% option band)

**Bug report that triggered this:** owner selected Villa + 6 Riyadh districts (~5,154 matches),
answered/skipped through the interview, and it stopped after ~2 questions at ~1,874 remaining —
while several more source-certified Villa questions (street width, direction, amenities…) existed
and had genuinely never been asked. **"We still have thousands of listings" must never end in "but
we ran out of questions to ask" while a valid, source-backed one exists.**

**Root cause.** `scoreQuestion()`'s pre-2026-08-22 gate required every candidate question to have an
option between 8% and 90% of the current scope, AND at least one option ≤ 75% — a *selectivity*
requirement, not a *validity* one. Once 1-2 answers had already skimmed the cleanest splits off a
large scope, the remaining unasked questions' real, source-backed options frequently fell outside
that band (too small a minority, or too large a majority) and were entirely dropped — not ranked
lower, REMOVED from the pool — even though picking them would still have genuinely narrowed the set.

**The fix — separate ELIGIBILITY from ORDERING, permanently:**
- **Eligibility** (may this question be asked at all): the scope must clear `MIN_TOTAL_TO_SHOW`
  (unchanged), and the question must have at least `minOptionsFor(selection)` options where
  `count < N` — i.e. an option that would actually change the result if picked. Every option here
  already cleared the absolute per-option floor (`meaningful()`, `MIN_REAL_OPTION_COUNT = 5`)
  upstream, so this is never a fabricated or thin option — only genuinely small or genuinely
  lopsided ones are now included instead of hidden. An option where `count === N` (100% of the
  current scope already has it) is correctly excluded — not for being unpopular, but because
  selecting it is a no-op.
- **Ordering** (which eligible question is asked first): unchanged — `score = bestSplit × salience`,
  where `bestSplit` still peaks at a 50/50 split. A well-balanced question is still asked before a
  lopsided one; a lopsided-but-real one is now asked LATER instead of never.
- **Never affected:** the ≤ 25 stop rule (`INTERVIEW_STOP_AT`/`MIN_TOTAL_TO_SHOW`, unchanged — the
  interview still closes once the remaining scope is small), the ask-first RNPL tier (still applied
  only among questions that clear the gate above), cohort availability (`COHORT_QUESTIONS` —
  unchanged; this amendment only touches whether an *available* question is *live-useful right now*),
  and Skip semantics (still "no preference" — never a predicate, never false, unknowns stay eligible).
- **This is not "ask every question no matter what."** A question with ZERO real narrowing option
  (every value ties at `N`, or nothing clears the per-option floor) is still excluded — the gate
  distinguishes "genuinely nothing to ask" from "asked in the wrong order for the current scope."
  Reaching the end of a cohort's certified list with every remaining question honestly exhausted is
  a correct stop, not a bug — the fix is that this must be the REAL reason, not a selectivity
  side-effect.

Regression: `scripts/verify-af-narrowing-gate.ts` calls `scoreQuestion()` directly (pure function,
mutation-provable) with synthetic scopes proving (a) a 2%-share option that used to be dropped is now
included, (b) a 97%-share-only option is included but scores below a balanced one, (c) a question
where every option ties at `N` is still excluded, (d) ordering still favors the more balanced split.

## Amendment 2026-08-22 (b) — 2+ useful questions to open (owner-approved)

The owner's brief: «Advanced Filter should only appear when there are multiple useful questions
available that can actually help narrow the result set» — opening the interview on exactly one
useful question means the user answers or skips it and still closes on whatever the result-count
gate alone left large, which is a tax on their attention, not a niche shortlist. Pinned by
`scripts/verify-af-min-useful-questions-gate.ts`.

- **A SECOND, independent gate, composed with the existing result-count gate, never replacing it.**
  Advanced Filter may open only when BOTH hold: the scope's true total is
  `> INTERVIEW_STOP_AT (25)` **and** the scope has `>= MIN_USEFUL_QUESTIONS_TO_SHOW (2)` useful
  questions. 0 or 1 useful question ⇒ AF does not open, even if the result-count gate alone would
  allow it — the manual "narrow it down" tap falls through to the pre-existing plain refine-chip
  flow (the SAME fallback an empty plan already used; this is a threshold widening, not a new code
  path).
- **"Useful" already has one definition — `scoreQuestion()`, unchanged by this rule.** Per Amendment
  (a) above, a question is useful when the scope clears `MIN_TOTAL_TO_SHOW` and has at least
  `minOptionsFor(selection)` options that would actually narrow the current set (`count < N`).
  `rankQuestions()` already computes exactly this set (`ranked`); this gate counts `ranked.length`
  at the OPENING decision only — it does not re-derive "useful" a second, potentially-disagreeing
  way, and automatically picks up whatever "useful" means as Amendment (a)'s definition evolves.
- **Computed AFTER every other narrowing the eligibility layer already applies** — combined-period
  (سنوي+شهري) cohort intersection (`cohortAllows`'s `RentAnnual ∩ RentMonthly`), the Buy+Rent
  3-way intersection, and multi-type intersection all run inside `eligibleQuestions()` /
  `cohortAllows()`, which `rankQuestions()` calls before scoring — so a question valid for only one
  leg of a combined search can never count toward the 2-question threshold on that search.
  Recomputing the gate from a second, independent implementation was deliberately avoided.
- **Governs the OPENING decision only.** Once the interview is open, the existing continuation loop
  (`presentGuided`'s re-rank after every answer/skip) is unchanged: it keeps offering the next
  useful question for as long as at least one remains, and stops only when the re-ranked plan is
  genuinely empty (`plan.length === 0`) — an already-open interview is never retroactively closed
  for dropping to exactly one remaining useful question. This is the owner's dynamic-loop rule
  (§2/§6 of the brief): narrow while anything useful remains; stop at niche or at "nothing left to
  ask," never earlier.
- **Skip is unchanged and was already correct.** `onConfirm([])` (a confirm with nothing selected)
  and `onSkip()` were traced end to end and found structurally identical: both mark the question
  asked and advance to the next plan index; neither calls a question's `apply()`, sets the
  query-changed flag, or records a facet. Skip therefore already applies no predicate, does not
  reduce the eligible set, and does not treat an unknown value as "no" — this amendment did not
  need to touch that path, and the barrier locks the two handlers' shapes so a future edit can't
  quietly split them.
