// ADVANCED FILTER OWNS THE MOMENT — the pre-AF CTA row must disappear the instant AF is entered.
//
// Owner 2026-08-21: "before AF is entered → show the normal CTA; user selects Advanced Filter → hide
// those two buttons; show the AF question flow instead. Do not keep both visible at the same time."
//
// The two buttons are «Load more» and «خلّنا نحدد الطلب أكثر» (the AF launcher itself), rendered in one
// row under a results turn. That row was gated ONLY on `(hasMore || canNarrowFurther)`. The AF card is
// an ABSOLUTE overlay (StyleSheet.absoluteFill) drawn on top, so the row kept rendering — and stayed
// reachable — underneath the flow the user had just opened. `ageFlow` is non-null for every AF phase
// (loading → intro → asking → mining) and returns to null when the flow closes, so gating on it hides
// the row for exactly the duration of the interview and restores it afterwards with no extra state.
//
// This is a FLOW/STATE cleanup only: no AF answer semantics, no Skip semantics, no count logic, and no
// backend behaviour is touched by it — those are asserted unchanged below so this file fails if a later
// edit tries to "simplify" the flow by moving that logic.
//
//   node --experimental-strip-types scripts/verify-af-takes-over-cta.ts     (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, '..', 'src', 'app', 'agent.tsx'), 'utf8');
// The interview's state rules moved into a pure module (owner 2026-08-22, «رجوع») so a barrier can
// execute them; Skip's "writes no predicate" guarantee now lives there, so read both.
const stepsSrc = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'afSteps.ts'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAdvanced Filter takes over the CTA space\n');

// ── the gate itself ──────────────────────────────────────────────────────────────────────────────
check('the pre-AF CTA row is hidden while the AF flow is open',
  /\{\(hasMore \|\| canNarrowFurther\) && !ageFlow \? \(/.test(code),
  'without `&& !ageFlow` the two buttons keep rendering underneath the AF overlay');

// It must be the WHOLE row, so neither button can survive alone.
const rowStart = code.indexOf('(hasMore || canNarrowFurther) && !ageFlow');
const rowChunk = code.slice(rowStart, rowStart + 2600);  // the row spans ~1.9k chars
check('the gate wraps BOTH buttons (Load more + the AF launcher)',
  /Load more/.test(rowChunk) && /Let’s narrow it down/.test(rowChunk),
  'gating only one leaves the other competing with the AF card');

// ── the flow must still own every phase, and still close back to null ────────────────────────────
for (const phase of ['loading', 'intro', 'asking', 'mining']) {
  check(`ageFlow still models the '${phase}' phase (the gate covers it)`,
    new RegExp(`phase: '${phase}'`).test(code));
}
check('closing the flow restores the CTA by setting ageFlow back to null',
  // NB: both handlers bump ageFlowTokenRef FIRST, so the matcher must cross that statement's `;`.
  /onAgeClose = \(\) => \{[\s\S]{0,120}?setAgeFlow\(null\)/.test(code)
  && /onIntroShowResults = \(\) => \{[\s\S]{0,120}?setAgeFlow\(null\)/.test(code),
  'if close did not null ageFlow the CTA row would never come back');

// ── unchanged product logic (this was a UI gate, not a redesign) ─────────────────────────────────
// Skip now rides the SAME commit path as an answer, with an EMPTY answer (owner 2026-08-22) — so
// it is recorded on the step (walking Back restores it AS a skip) while still contributing no
// predicate, because the query rebuild skips empty-keyed steps outright.
check('Skip still advances without applying a restriction, and stays recorded as open',
  /onAgeSkip = \(\) => \{ void commitGuidedStep\(\[\]\); \}/.test(code)
  && /if \(!st\.keys\.length\) continue;/.test(stepsSrc),
  'Skip must keep meaning "no preference", never a filter');
check('the AF card still receives its live count callback',
  /liveCount=\{\(keys\) =>/.test(code) && /liveResultCount\(/.test(code),
  'the count must keep updating inside the flow, not freeze on entry');
check('answering still hands off to the same refine path',
  /onConfirm=\{onAgeConfirm\}/.test(code));
check('the AF overlay is still the absolute layer over the results',
  /ageFlow \? \(\s*<View style=\{StyleSheet\.absoluteFill\}/.test(code));

console.log(failures === 0
  ? '\n✓ AF takes over cleanly: CTA hidden for the whole flow, restored on close, logic untouched\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
