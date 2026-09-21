// THE COMPLETED-ROUND RECEIPT NAMES BOTH HALVES, AND IT ARRIVES AT ONCE.
//
// Owner 2026-09-20, shown the receipt card mid-round: "once user finishes with the advanced filter …
// let this message immediately show, and when user clicks skip add … an emoji based on the questions
// u did". Two defects behind one screenshot:
//
//  1. THE RECEIPT WAS LATE BY A WHOLE SEARCH. `setAfReceipt` runs synchronously inside finishGuided,
//     but the card renders in the `else` of `showActionsRow` — and that flag only drops when
//     `chatCompleted` flips, which happens in runRefine's onFetched, ~10s later. So the spent turn
//     kept «عرض المزيد / خلّنا نحدد الطلب أكثر» for the entire new search. Never a timer: a gate
//     resolving late. The fix gates `showActionsRow` on the receipt itself, which ALSO shortens the
//     closing note in the same frame (it is derived from the same flag) — so the note can never
//     offer «تبي أعرض لك المزيد؟» under a row that is gone (§42 visible-output contract).
//
//  2. SKIPS WERE INVISIBLE. buildAfSummary is committed-state-only and must stay that way — it is
//     the PILLS sentence, a claim about the live predicate (permanent rule, owner 2026-08-22). The
//     skips therefore ride a SECOND sentence, built by buildAfSkipped, that the receipt alone shows.
//     The receipt records what the interview DID; it claims no filter, so naming a skipped question
//     there cannot contradict the predicate. This file pins that separation in both directions.
//
// WHAT WOULD BREAK SILENTLY WITHOUT THIS FILE: a new Advanced-Filter question with no entry in
// SKIPPED_QUESTION. buildAfSkipped drops unknown ids rather than printing a raw slug, so the new
// question would simply never appear when skipped — correct-looking output, missing information,
// nothing red. Check C executes the real map against the real registries to close that.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAfSummary, buildAfSkipped, skippedQuestionNoun } from '../src/lib/afSummary.ts';
import { stripComments } from './lib/stripComments.ts';
// windowBetween, not slice(indexOf, indexOf): a raw window silently widens to the rest of the file
// when a marker moves, so every assertion under it would pass against unrelated source.
import { windowBetween } from './lib/sourceWindow.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const root = join(import.meta.dirname, '..');
const agent = stripComments(readFileSync(join(root, 'src/app/agent.tsx'), 'utf8'));

console.log('\nThe completed-round receipt names choices AND skips, and shows at once (owner 2026-09-20)\n');

// ── A. EXECUTED: the skip sentence itself ───────────────────────────────────────────────────────
check('one skipped question reads as noun + its own emoji, no list punctuation',
  buildAfSkipped(['bathrooms']) === 'دورات المياه 🚿', buildAfSkipped(['bathrooms']));
check('two are joined with «، و», never a bare «و»',
  buildAfSkipped(['amenities', 'direction']) === 'المميزات ✅، والاتجاه 🧭',
  buildAfSkipped(['amenities', 'direction']));
check('three keep «، » between and «، و» before the last',
  buildAfSkipped(['amenities', 'property_age', 'direction'])
    === 'المميزات ✅، عمر العقار 🏗️، والاتجاه 🧭',
  buildAfSkipped(['amenities', 'property_age', 'direction']));
check('nothing skipped → empty string (the card then renders no second line)',
  buildAfSkipped([]) === '');
check('a repeated id is named once', buildAfSkipped(['rating', 'rating']) === 'التقييم ⭐');
check('ask order is preserved, not alphabetised or registry-ordered',
  buildAfSkipped(['rating', 'amenities']) === 'التقييم ⭐، والمميزات ✅',
  buildAfSkipped(['rating', 'amenities']));
// COMMA ALWAYS AFTER THE EMOJI, NEVER BEFORE (owner, universal). The separator follows the emoji
// because every item ENDS in one — a noun-then-comma-then-emoji shape would read as a different rule.
const sentence = buildAfSkipped(['amenities', 'property_age', 'bathrooms']);
check('every comma in the sentence sits AFTER an emoji, never before one',
  !/[\u0600-\u06FF]\s*،\s*(?=[^\u0600-\u06FF])/.test(sentence.replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F]/gu, 'E'))
  && /E،/.test(sentence.replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F]/gu, 'E')),
  sentence);

// ── B. The two sentences stay separate ──────────────────────────────────────────────────────────
// The permanent rule (owner 2026-08-22) is about buildAfSummary, and this change must not touch it.
check('buildAfSummary still names ONLY committed facets — a skipped id passed as a bare id is not in it',
  buildAfSummary([{ id: 'property_age', keys: ['new'], labels: ['جديد'] }]) === 'عمر جديد ✨'
  && !buildAfSummary([{ id: 'property_age', keys: ['new'], labels: ['جديد'] }]).includes('عمر العقار 🏗️'));
check('an empty facet list still summarises to nothing (no stray joiner)',
  buildAfSummary([]) === '');

// ── C. EXECUTED: every question the interview can ask has a noun ────────────────────────────────
// Source-scanned inventory, executed map: a question id that exists in the real registries but has
// no noun would vanish from the receipt with nothing else failing.
const ids = new Set<string>();
for (const f of ['src/data/advancedFilters.ts', 'src/lib/afPlan.ts']) {
  const src = readFileSync(join(root, f), 'utf8');
  for (const m of src.matchAll(/^\s*id: '([a-z_]+)',$/gm)) ids.add(m[1]);
  for (const m of src.matchAll(/^export const SCOPE_(?:GROUP|TYPE)_ID = '([a-z_]+)';$/gm)) ids.add(m[1]);
}
check('the inventory actually found the questions (a zero-id scan would pass vacuously)',
  ids.size >= 9, `found ${ids.size}`);
for (const id of [...ids].sort())
  check(`«${id}» has a receipt noun`, !!skippedQuestionNoun(id),
    'add it to SKIPPED_QUESTION in src/lib/afSummary.ts — without it this question is silent when skipped');

// ── D. The wiring in agent.tsx ──────────────────────────────────────────────────────────────────
check('a turn holding a receipt shows no actions row (this is what makes the swap immediate)',
  /const showActionsRow = !afReceipt\[m\.id\] && resultsActionsRowVisible\(\{/.test(agent),
  'without this the receipt waits for chatCompleted, which lands only after the next search returns');
const fin = windowBetween(agent, 'const finishGuided = ', 'const startAgeFlow = ', 'src/app/agent.tsx');
check('the receipt stores both sentences, newline-joined',
  /\[carry\.msgId\]: `\$\{roundChoices\}\\n\$\{roundSkipped\}`/.test(fin));
check('skips are THIS round\'s asked minus THIS round\'s committed',
  /const askedThisRound = \[\.\.\.ageFlowAskedRef\.current\]\.filter\(\(id\) => !\(carry\?\.asked \?\? \[\]\)\.includes\(id\)\)/.test(fin)
  && /askedThisRound\.filter\(\(id\) => !committedThisRound\.has\(id\)\)/.test(fin),
  'carrying earlier rounds in would re-report questions the previous receipt already named');
check('only a round that COMMITTED something leaves a receipt',
  /if \(carry && roundChoices\) setAfReceipt/.test(fin),
  'a skip-everything round must keep its buttons — a receipt there strands the user with no way back in');
check('the card renders the skip line under its own testID',
  /testID="af-round-receipt-skipped"/.test(agent) && /t\('Skipped: \{summary\}', \{ summary: skipped \}\)/.test(agent));
check('an old receipt (no newline) still renders its choices line',
  /const \[chosen = '', skipped = ''\] = afReceipt\[m\.id\]\.split\('\\n'\)/.test(agent));

// ── E. The copy exists in Arabic ────────────────────────────────────────────────────────────────
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
check('«اخترت» replaced «اختياراتك» (owner 2026-09-20)',
  i18n.includes("'Your choices: {summary}': 'اخترت: {summary}'") && !i18n.includes('اختياراتك'));
check('«تخطيت» exists', i18n.includes("'Skipped: {summary}': 'تخطيت: {summary}'"));

// ── F. MUTATION PROOFS ──────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

mustCatch('the receipt gate being dropped, putting the card back behind the next search',
  !/const showActionsRow = !afReceipt\[m\.id\] && resultsActionsRowVisible\(\{/
    .test(agent.replace('const showActionsRow = !afReceipt[m.id] && resultsActionsRowVisible({',
                        'const showActionsRow = resultsActionsRowVisible({')));
mustCatch('a question id added to the registries with no receipt noun',
  !skippedQuestionNoun('a_brand_new_question'));
mustCatch('a skip sentence joined with a bare «و» instead of «، و»',
  buildAfSkipped(['amenities', 'direction']) !== 'المميزات ✅ والاتجاه 🧭');
mustCatch('skips leaking into the PILLS sentence',
  !buildAfSummary([]).includes('تخطيت'));

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — the receipt is late, silent about skips, or claiming a filter it does not hold\n`
  : '\n✓ choices and skips are named separately, every question has a noun, and the card replaces the row at once\n');
process.exit(failed ? 1 : 0);
