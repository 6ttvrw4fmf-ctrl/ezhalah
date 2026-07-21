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
  selection: 'single' | 'multi';                // arity — the ONLY behavioural switch
  eligibility: (scope: SearchQuery) => boolean;  // ONE unified scope gate (see §9)
  resolveOptions: (scope: SearchQuery) => Promise<AdvancedOption[]>; // [{key,label,count}], live, pre-filtered
  apply: (query: SearchQuery, selectedKeys: string[]) => SearchQuery; // how the answer merges into search
};

export type AdvancedOption = { key: string; label: string; count: number }; // label = i18n-resolved text
```

A question supplies **exactly these seven fields — nothing else.** No `mode`-specific render hooks, no
`liveCount` fn (the card derives the live count from `resolveOptions` + `apply`), no styles, no icons,
no copy beyond `title`/`description`/option `label`s. `single` gets `selectedKeys.length ≤ 1`; `multi`
gets `≥ 0`. Everything visual and behavioural below is owned by the shared component.

---

## 2. Card layout — identical for every question

```
┌───────────────────────────────────────────┐
│  ✦  Ezhalah AI Agent                    ✕  │  Shell top-bar (fixed)
├───────────────────────────────────────────┤
│  ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░                       │  Progress bar (§3)
│                                             │
│  {title}                                    │  Title  (h-question)
│  {description}                              │  Subtitle (optional, muted)
│                                             │
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
│   Skip            Skip all & search now     │  Footer secondary (§7)
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
  it clears the scope-size floor `MIN_TOTAL_TO_SHOW` **and** has ≥ the required real options —
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
