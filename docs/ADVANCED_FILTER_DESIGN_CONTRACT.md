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
- **Single tap = select ONLY; double tap = select + confirm + advance one** (owner 2026-08-22,
  SUPERSEDES the 2026-08-11 ~260 ms auto-advance, which is now banned). The user must be able to see
  the picked row and the recomputed count before committing. Both taps run through the SAME single
  `onPress` path — there is deliberately no second double-click/long-press handler, so a double tap
  can never fire "select" and "advance" as competing handlers and skip two questions; and a single
  tap is never delayed waiting to see whether another follows. Multi is select-then-«متابعة» only.
- **«رجوع» on every question** (owner 2026-08-22). It steps back exactly one question and restores
  that question's recorded answer — including restoring a skip AS a skip (open, no predicate).
  From the FIRST question it leaves the interview and hands the pre-AF controls back
  («خلّنا نحدد الطلب أكثر» + «عرض المزيد»), which is automatic: that row is gated on `!ageFlow`.
- **The interview is ONE ordered step record** (`ageFlowStepsRef`), and query/asked/labels/facets are
  DERIVED from it by `syncGuidedFromSteps(cursor)` — the query is rebuilt from `baseQ` by re-applying
  the steps *before* the cursor, never un-applied by a per-question inverse. This is what makes "no
  stale hidden predicate" structural: a changed or dropped answer simply stops contributing to the
  rebuild, and an appending answer (amenities) cannot accumulate twice from being re-answered.
- **Changing an earlier answer re-validates every later one** (`revalidateStepsAfter`): a later
  answer is KEPT if its question is still eligible for the new scope and its keys still select
  something (live count > 0), and DROPPED only if it has become incompatible. A skip is always kept —
  it carries no predicate.
- No numeric «Question N of M» caption — the denominator legitimately changes as the set narrows;
  the thin bar and the shrinking live count are the only progress signals.
- Normal-Filter territory (location, deal, period, price, size, **bedrooms**) is never asked by the
  interview — enforced as data via `af_field_registry.filter_tier`. **AMENDED 2026-08-23: property
  GROUP and property TYPE are carved out — see «Amendment 2026-08-23» below. Everything else in this
  list is unchanged, and bedrooms in particular remains permanently off-limits.**


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
  tentative selection; the primary commits via «متابعة · N نتيجة» with the same live number. All
  numbers come from the production count RPCs — never placeholders, never unknown-as-no.
- **The escape is always one tap.** «عرض النتائج» replaces the question-count skip-all arithmetic.
- **The primary ADVANCES; «عرض النتائج» TERMINATES** (owner 2026-08-23, corrects a shipped defect).
  The primary reads «متابعة · N نتيجة» on single AND multi, because `onConfirm` is
  `commitGuidedStep(keys)` in both cases: it records the answer and presents the next question.
  Until this correction the label branched on ARITY and a single-select read «عرض N نتيجة» — a
  button that promised results and delivered the next question instead. Arity was never a proxy for
  terminality, and neither is ordinality: the pool is re-ranked after every answer, so the card
  cannot know whether another question is coming. The one terminal control is the «عرض النتائج»
  link (`af-skip-all` → `commitGuidedStep(keys, true)` → `finishGuided`). Pinned by
  `scripts/verify-af-primary-advances-not-shows.ts`.
- **Availability is explained naturally.** One tiny line — «الخيارات تعتمد على المعلومات المتوفرة
  للإعلانات الحالية» — replaces the technical unknown-count phrasing. No coverage/NULL/backend
  language anywhere user-facing.
- **Micro-motion, reduced-motion-safe.** Press compression, check fade/scale, count settle, question
  fade-rise. Decoration only: every hand-off (mining dismissal, and the double-tap threshold, which
  is a timestamp comparison rather than a timer) never rides an animation callback
  (`src/lib/afterAnimation.ts`).
- **The mining transition.** After the interview commits ≥1 answer, the «digging through the market»
  beat plays over the final search: fragments drift inward, copy uses REAL numbers («نراجع N عقار
  ونطلع لك الأنسب» → «لقينا N عقار أقرب لطلبك»), minimum ~1.4 s, dismissed by setTimeout latches
  with a 15 s failsafe + a catch on the search itself. Skip-everything closes with no beat.
- **Results summary + removable pills.** The guided results turn shows «بناءً على: …» and each
  committed answer as a removable pill. Removal is PURE recomputation: rebuild from the interview's
  baseQ by re-applying the remaining facets through each question's own `apply()` — never a
  hand-written inverse — then re-search immediately (no mining beat on removal).


## Amendment 2026-08-22 (a) — the narrowing gate (owner-approved, supersedes the 8%-90% option band)

> **Partly superseded on 2026-08-25** — see «Amendment 2026-08-25» at the end of this file. The
> ORDERING half below stands. The ELIGIBILITY half's `count < N` was replaced by
> `optionNarrowsMeaningfully(count, N)` (≥10% removed, or landing at/under the target): the
> small-slice protection this amendment won is permanent, the lopsided-majority half was an
> over-correction and the owner reversed it. Kept in full because this gate has now moved twice.

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

## Amendment 2026-08-22 (b) — a useful question is required to open (owner-approved)
### CORRECTED 2026-08-24 by the owner: the threshold is **1**, not 2 (PR #1045)

**`MIN_USEFUL_QUESTIONS_TO_SHOW = 1`.** This section shipped on 2026-08-22 with the value 2 and the
owner corrected it two days later in PR #1045; the original reasoning is kept below, struck through
in place, because this constant has now MOVED and a future reader must be able to see both positions
rather than trust whichever paragraph they happen to read first.

**The correction (owner, 2026-08-24):** a lone useful question is a REAL NARROWING STEP, not a tax on
the user's attention. The 2026-08-22 brief assumed answering one question and closing leaves the user
where they started — but that one question routinely takes a scope from hundreds to tens, which is
exactly what the Advanced Filter is for. Refusing to open on it withheld a genuine narrowing step and
sent the user to the refine chips, which promise no numbers at all. So: **0 useful questions ⇒ AF does
not open; 1 or more ⇒ it does.** Everything else in this amendment — that it is a SECOND gate composed
with the result-count gate, that "useful" means `scoreQuestion()` and is never re-derived, that it is
computed after the eligibility layer, that it governs the OPENING decision only, and that Skip applies
no predicate — stands exactly as written.

~~The owner's brief (2026-08-22, SUPERSEDED): «Advanced Filter should only appear when there are
multiple useful questions available that can actually help narrow the result set» — opening the
interview on exactly one useful question means the user answers or skips it and still closes on
whatever the result-count gate alone left large, which is a tax on their attention, not a niche
shortlist.~~ Pinned by `scripts/verify-af-min-useful-questions-gate.ts`, which asserts the value is
exactly 1 and fails on 2 in both directions.

- **A SECOND, independent gate, composed with the existing result-count gate, never replacing it.**
  Advanced Filter may open only when BOTH hold: the scope's true total is
  `> INTERVIEW_STOP_AT (25)` **and** the scope has `>= MIN_USEFUL_QUESTIONS_TO_SHOW (1)` useful
  questions (2026-08-22 shipped this as 2; owner-corrected to 1 on 2026-08-24, PR #1045). 0 useful
  questions ⇒ AF does not open, even if the result-count gate alone would allow it — the manual
  "narrow it down" tap falls through to the pre-existing plain refine-chip flow (the SAME fallback
  an empty plan already used; this is a threshold widening, not a new code path).
- **"Useful" already has one definition — `scoreQuestion()`, unchanged by this rule.** Per Amendment
  (a) above, a question is useful when the scope clears `MIN_TOTAL_TO_SHOW` and has at least
  `minOptionsFor(selection)` options that would actually narrow the current set
  (`count < N` when this was written; `optionNarrowsMeaningfully(count, N)` since 2026-08-25).
  `rankQuestions()` already computes exactly this set (`ranked`); this gate counts `ranked.length`
  at the OPENING decision only — it does not re-derive "useful" a second, potentially-disagreeing
  way, and automatically picks up whatever "useful" means as Amendment (a)'s definition evolves.
- **Computed AFTER every other narrowing the eligibility layer already applies** — combined-period
  (سنوي+شهري) cohort intersection (`cohortAllows`'s `RentAnnual ∩ RentMonthly`), the Buy+Rent
  3-way intersection, and multi-type intersection all run inside `eligibleQuestions()` /
  `cohortAllows()`, which `rankQuestions()` calls before scoring — so a question valid for only one
  leg of a combined search can never count toward the useful-question threshold on that search.
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

---

## Amendment 2026-08-23 — the footer is PINNED, only the question body scrolls

§2's diagram already put the footer at the bottom of the card, but the implementation rendered it as
the last child *inside* the card's body `ScrollView`. On a short question that was invisible; on a
tall one it was the whole exit. Measured on production at 390×664 (iPhone 13): the bathrooms question
kept «عرض النتائج» at y=541..558, and the very next question (amenities, 7 options) put the entire
secondary row at y=656..682 against `innerHeight=664` — about 8px of glyph left. The card's inner
scroller was `clientHeight=601 / scrollHeight=639`: 38px of scroll room, no scrollbar, no fade cue.
«رجوع», «تخطي» and «عرض النتائج» all lived down there, so the only visible way out of the interview
was the ✕.

**The rule, for every question:** the action row — primary `Show {N}` / `Continue · {N}` plus the
`Back / Skip / Show results` row — is a **flex sibling of the body scroller**, never a descendant of
it. Only the title, description, brand strip, option list and availability note scroll. The scroller
carries the explicit `flexShrink`, so it is the element that gives up height when the card hits
`maxHeight: '100%'`; the footer keeps its own. The overlay reserves vertical padding, so the card's
bottom edge is never the viewport's bottom edge and the pinned row cannot land under a phone's home
indicator or the browser's bottom chrome.

Post-fix on the same device the row sits at y=604..630, fully visible, and «عرض النتائج» commits with
no scrolling at all. Pinned by `scripts/verify-af-footer-onscreen.ts` (wired into `npm test`), which
fails if any of the four footer controls, or the `s.foot` container, moves back inside the scroller —
including via an `position: 'absolute'` substitute that would overlap the last option instead.


## Amendment 2026-08-23 — the SCOPE PREFIX: CATEGORY → GROUP → TYPE (owner-approved)

**This amendment carves property GROUP and property TYPE out of the "Normal-Filter territory is never
asked" boundary rule above. Nothing else moves. Bedrooms in particular stays permanently off-limits.**

### The defect

«سكني» / «تجاري» is only the CATEGORY. It was never enough information to ask about bathrooms, age or
amenities — and, measured, it was not enough to ask *anything*:

- `cohortAllows()` intersects across every clean type in scope (`afCohorts.ts:220`) and treats an
  uncertified type as an **empty** cohort, never as "no constraint" (`afCohorts.ts:226`).
- So ONE uncertified sibling zeroed a whole group. Riyadh / Rent / annual, measured 2026-08-23:
  `Villa` alone certifies **7** questions over **4,140** listings; `Duplex` has **3** listings and
  certifies none; the «Villas & Houses» group therefore certified **zero**.
- **5 of the 8 shipped groups could not open Advanced Filter on Buy, and 5 of 8 could not on Rent.**
  A category-only scope could *never* open it (`cohortAllows` short-circuits on an empty type list,
  `afCohorts.ts:219`).
- The tap then fell through to `startRefine()`'s legacy hardcoded 4-chip type question
  (شقة/فيلا/دور/أرض) — not the canonical taxonomy, no group tier, scalar `q.type` only. That legacy
  flow is what users actually saw, which is why the feature read as *present but wrong* rather than
  *blocked*. **It has been deleted**; property type is now asked in exactly one place.

### The rule

The interview resolves the property hierarchy before asking any certified question:

```
CATEGORY → PROPERTY GROUP → PROPERTY TYPE → certified ADVANCED questions
```

- **Category** is never asked. It is chosen in the Filter home and is a precondition.
- **Group** is asked only when neither a group nor a type is selected. Options are
  `groupsFor(category)` — never hardcoded, never another category's groups.
- **Type** is asked whenever no type is selected. Options are the member types of the selected
  group(s); if the group step was skipped, every type in the category.
- An explicit **type** pick resolves *both* tiers — a user who already chose فيلا is asked neither.
- Several groups **OR**; several types **OR**. Every other dimension stays AND.
- The advanced questions offered for a multi-type scope remain the **safe semantic INTERSECTION**
  across the selected types. `cohortAllows` is deliberately **unchanged**: the hierarchy makes the
  intersection non-empty by NARROWING the scope, never by loosening the gate. A `.some()`/union there
  would offer a question uncertified for a scoped type, and because the shared SQL predicates are
  strict-NULL-excluding, answering it would silently amputate that type's rows — ask for شقة+غرفة,
  get zero غرفة back.

### Skip

Every scope step supports «تخطي». Skip means **"I do not care / I am open"** — permanently, and
identically to every other interview question:

- it applies **zero** predicate and returns the query byte-identically ⇒ **count delta is exactly 0**;
- it is never a "no", never `false`, and never silently selects an option;
- a skipped tier counts as **resolved** (the walk moves down, it never re-asks);
- skip GROUP ⇒ the TYPE step offers every type in the category;
- skip BOTH ⇒ only questions safely shared across the whole effective type set may be asked, and if
  that is below the useful floor the interview **stops cleanly and shows results**. It never invents a
  type to keep going.

### A tier with nothing to choose between

If a tier resolves to exactly **one** option it is not a question: it is auto-committed and never
rendered. The result set cannot move (every other branch of that tier is empty here), while the
cohort scope becomes a certified single type — which is what lets a one-member group like
«Residential Plots» → `Residential Land` reach the advanced questions at all. Zero options records an
open skip. Neither case invents a predicate the user did not ask for.

### Where the useful-question gate now runs

`MIN_USEFUL_QUESTIONS_TO_SHOW` is **1** (owner correction 2026-08-24, PR #1045 — this paragraph said
"still 2" until 2026-08-25 and was stale, not a second opinion), and still governs only the OPENING
decision — but it is evaluated at the **scope→advanced transition**, not at `startAgeFlow`. With an
unresolved hierarchy the ranked plan is empty *by construction*, so the old placement closed the
interview before the first scope question could render. It counts **advanced** questions only: the
hierarchy steps are what earned the right to ask, never part of the quota. At the transition, 0 useful
advanced questions ends the interview **cleanly** on the results the scope answers already narrowed to
— it never bounces to the refine chips, because by then the user has answered real questions we must
honour.

### Counts

Each scope option shows the **exact** result count that picking it would return, on top of the
current committed state (location, price, area, bedrooms and any AF answers already given). A scope
candidate changes five RPC params (`p_types`, `p_types2`, `p_tables`, `p_tables2`, `p_category`), so
each candidate resolves its **own** scope via `resolveSearchScope(candidateQ)` —
`fetchScopeOptionCounts` in `src/data/remote.ts`. Options are ordered by the canonical HIERARCHY,
never by count. A **zero-count** option is dropped (it promises results it cannot deliver); **no other
usefulness floor applies**, so a genuinely small branch — 4 listings — is still offered. Hiding it
would be the silent amputation of a real part of the taxonomy.

### Pills

Scope answers render as **non-removable** chips in the results row. Every other advanced answer only
ever narrows, so removing its pill returns to a scope the user already had; removing a TYPE pill would
instead broaden the search past anything they ever asked for, with no re-interview and no control to
get it back.

### Where this lives

- `src/lib/afPlan.ts` — the tier logic, **pure** (no `./remote`, no `@/i18n`) so a barrier executes it
  rather than grepping for it.
- `src/data/advancedFilters.ts` — `SCOPE_QUESTIONS` / `scopeQuestionFor()`. Deliberately **not**
  members of `ADVANCED_QUESTIONS` and never ranked by `rankQuestions`/`scoreQuestion`: a scope step is
  a prerequisite of that pool, not a ranked peer, and `scoreQuestion`'s usefulness gates would delete
  real taxonomy branches (`MIN_REAL_OPTION_COUNT` hides a 4-listing group; the narrowing gate —
  `o.count < N` when this was written, `optionNarrowsMeaningfully()` since 2026-08-25, which is
  stricter still — retires a group with one populated type).
- `src/app/agent.tsx` — the scope prefix inside `presentGuided`, the moved gate, the plan
  invalidation on a scope commit, and the scope-aware `revalidateStepsAfter`.
- `scripts/verify-af-scope-hierarchy.ts` — the barrier, wired into `npm test`. It EXECUTES the real
  tier logic, the real cohort gate and the real step-rebuild, and carries a mutation proof that a
  `.some()`/union "fix" to `cohortAllows` is detected.

### Registry note

`af_field_registry` is a registry of listing **attribute** fields (bathrooms, furnished, kitchen…).
Scope dimensions — location, deal, category, type — have never had rows in it, so this amendment adds
none: inventing rows for them would pollute the registry with non-fields. The boundary rule keeps its
teeth where it matters, in `scripts/verify-ui-controls-have-predicates.ts`: the interview may ask
exactly the two authorized scope ids and nothing else from Normal-Filter territory, and `bedrooms`
must remain `'normal'` tier and appear in no interview question.

## Amendment 2026-08-25 — the ASK gate uses the narrowing rule too (owner-approved, supersedes the eligibility half of Amendment 2026-08-22 (a))

**The owner's brief.** «You have 100 properties. If the next AF question is "Do you want a gym?" but
100/100 properties have a gym, then asking that is pointless. The answer cannot narrow anything. So do
not show that question. Same if 98/100 have it, or every option gives basically the same result.»
«Certified question = allowed to ask. Useful backend split = worth asking now. We need BOTH.» «Do not
invent questions and do not force questions just to reach the 25-listing target. If there are 50 or
100 results left but no meaningful truthful question remains, Advanced Filter is done.»

**The rule.** ONE predicate, `optionNarrowsMeaningfully(count, total)` in `src/lib/afRanking.ts`:

```
qualifies  ==  (total - count >= total * MEANINGFUL_NARROWING_FRACTION)  ||  (count <= INTERVIEW_STOP_AT)
```

`MEANINGFUL_NARROWING_FRACTION = 0.10`, `INTERVIEW_STOP_AT = 25` (unchanged). The removal form is
written so that EXACTLY 10% qualifies (N=100 k=90 and N=30 k=27 both ask; N=100 k=91 does not). The
second clause exists so the LAST step to the target is never blocked by a percentage: at N=26 an
option yielding 25 removes 3.8% and still qualifies, because it lands AT the target.

**Two uses, one predicate — required, not tidiness.**
- **ASK gate** — `scoreQuestion()` filters the OPTIONS by it, REPLACING the 2026-08-22 `o.count < N`.
  `minOptionsFor(selection)` then decides whether the question survives (single ≥2, multi ≥1).
  Owner's worked case, bathrooms at N=100 with rungs 100/98/60/20: «1+»=100 (0% cut) and «2+»=98 (2%
  cut) are DROPPED, «3+»=60 (40%) and «4+»=20 (80%) are KEPT — a real choice of two, and the user
  never sees a chip that does nothing. Gym at 100/100 loses its only option, so that question dies.
- **OFFER gate** — `offersMeaningfulNarrowing()` calls the SAME predicate instead of its own copy of
  the arithmetic. Two copies would drift into «تحديد أكثر» opening a round that immediately closes —
  the bug shape PR #1094 had to fix for a different cause. Sharing it makes that unrepresentable.

**ONE-SIDED, deliberately — the small-slice protection of 2026-08-22 is permanent.** The 2026-08-11
band rejected BOTH extremes; only the lopsided end is the gym problem. An option matching 8 of 100
removes 92% and is an excellent question; `street_width` «30m+» at 60 of 1,874 (a 3.2% share, a 96.8%
cut) is exactly the question the owner fought to get back and is never rejected. What this amendment
reverses is the over-correction at the other end: `amenities` «parking» at 1,820 of 1,874 costs a tap
and moves 54 listings. Nothing is invented and nothing is forced to reach ≤25 — when no meaningful
truthful option is left, the Advanced Filter is DONE at 50 or 100 results and only «عرض المزيد»
remains.

**Amendment 2026-08-22 (a) as amended.** Its *ordering* half stands untouched (selectivity orders,
never includes). Its *eligibility* half now reads `optionNarrowsMeaningfully(count, N)` instead of
`count < N`, so its regression bullet (b) — "a 97%-share-only option is included" — is superseded and
now asserts the opposite; bullet (a) (the small-slice question) stands unchanged and permanent.
Unchanged around it: `MIN_TOTAL_TO_SHOW`, the absolute per-option floor `MIN_REAL_OPTION_COUNT = 5`
and `meaningful()`, `MIN_USEFUL_QUESTIONS_TO_SHOW = 1`, the adaptive round size, the manual tap,
Skip = no predicate, and Summary == committed state.

Regression: `scripts/verify-af-narrowing-gate.ts` (§2/§2b/§5 inverted in place with the dated reason,
§1 and §6 keep the small-slice half permanent) and `scripts/verify-af-offer-gate.ts` (§3 and §4
inverted from "the gates are separate" to "the gates share ONE predicate and neither re-implements the
arithmetic"). Both EXECUTE the real pure predicate; neither was deleted or unwired.

## Amendment 2026-08-26 — UNKNOWN IS NOT NO (owner-approved)

> **Known useless → hide AF. Couldn't determine because the backend failed → keep AF available.**

Every Advanced Filter question earns its place by one live count RPC, capped at
`AGE_COUNT_TIMEOUT_MS` (4 s). Until this amendment a probe that never completed produced the
**byte-identical** value to a source that answered *"nothing here"*, at every hop:

| hop | timed-out probe | genuinely empty scope |
|---|---|---|
| `withTimeout` | `{ timedOut: true }` | — |
| the count fetcher | `null` | `null` |
| `guidedOptions` | `{ options: [], total: 0 }` | `{ options: [], total: 0 }` |
| `scoreQuestion` | `null` → dropped | `null` → dropped |
| `startAgeFlow` | empty plan → `setAgeFlow(null)` + `startRefine(q)` | same |

So a transient network blip was rendered to the user as a settled verdict about their search —
*"there is nothing more worth asking about this"* — and quietly demoted them to the legacy
district/budget/beds chips. The user could not tell the difference, and by the third hop neither
could the code: the information that anything had gone wrong no longer existed.

This is the same rule the repo already enforces on the data side, where a failed fetch may never be
written down as a negative fact — *"403/429/timeout/5xx/blocked/unknown → NOT proof"*
(`docs/ops/DATA_INTEGRITY_ENGINEER.md`). Advanced Filter now obeys it too.

**The rule, binding on every path that decides whether to ask:**

1. A probe that times out or errors is **UNKNOWN**. An empty *result set* is a real answer and stays
   `null` — the distinction is between *"the source said nothing"* and *"we never heard back"*.
2. When nothing useful survives, **retry the batch exactly once**. A bounded retry absorbs the
   transient case; it is never retried on a verdict the sources actually gave.
3. If it is still undetermined, **assert nothing**: leave «تحديد أكثر» exactly where it was so the
   user can try again.
4. **Never open an empty AF card** — on either verdict.
5. **Never invent counts** to fill the gap.
6. **Never fall back to the refine chips on UNKNOWN**, because offering them *in place of* AF is
   itself the claim that there is nothing left to narrow.
7. This binds the **mid-interview re-rank as well as the opening decision**. Ending an interview
   says *"there is nothing left worth asking"* — also a claim about the data — so a failed probe may
   not silently shorten an interview that is already open.

Owner decision 2026-08-26: *"UNKNOWN must never become NO."*

**Where it lives:** `src/lib/afProbe.ts` (pure: `probeVerdict` / `mayOpenInterview` /
`mayAssertNothingToNarrow` / `shouldRetryProbes`), so both decision points read ONE rule and cannot
drift. **Barrier:** `scripts/verify-af-probe-failure-not-a-verdict.ts` in `npm test` — executes the
verdicts, pins the wiring, and is mutation-proven against the real source (6/6 deliberate breaks
turn CI red).

**Why it is not just a bigger timeout:** raising `AGE_COUNT_TIMEOUT_MS` lowers the frequency and
keeps the wrong semantics — the outage would still be recorded as the user's verdict, just less
often. Measured cost on a real 6-district Villa/Buy scope: **920 ms** for one count and **3,433 ms**
for the five certified questions, server-side on a quiet database, against a 338 ms/search baseline
and a concurrency knee of 3 (`docs/ops/SEARCH_MATCH_QA_ENGINEER.md` §40.1) — so the cap is reachable
under ordinary load and always will be.
