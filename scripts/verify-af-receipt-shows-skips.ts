// THE COMPLETED-ROUND RECEIPT REPLAYS THE ROUND, IN ORDER — AND IT ARRIVES AT ONCE.
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
//     Measured live after the fix, on a real round: 172ms from the final click to the card.
//
//  2. SKIPS WERE INVISIBLE. buildAfSummary is committed-state-only and must stay that way — it is
//     the PILLS sentence, a claim about the live predicate (permanent rule, owner 2026-08-22). The
//     receipt instead renders buildAfRoundLog: the round IN ASK ORDER, answers and skips in ONE
//     sentence. It records what the interview DID and claims no filter, which is why naming a
//     skipped question there cannot contradict the predicate. This file pins that in both directions.
//
//     ORDER AND MARK ARE BOTH LOAD-BEARING — the owner replaced a first, two-line version («اخترت: …»
//     over «تخطيت: …») the same day: "you asked about apartment and then age, and he decided to skip,
//     then he chose الواجهة … you say: user decided to skip". Sorting the round into two piles
//     destroys the sequence, and giving a skip the question's own emoji makes it read, mid-sentence,
//     as a third answer. Hence «تخطى {noun} ⏭️», never «{noun} 🏗️».
//
// WHAT WOULD BREAK SILENTLY WITHOUT THIS FILE: a new Advanced-Filter question with no entry in
// SKIPPED_QUESTION. buildAfRoundLog drops an unknown id rather than printing a raw slug, so the new
// question would simply never appear when skipped — correct-looking output, missing information,
// nothing red. Check C executes the real map against the real registries to close that.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAfSummary, buildAfRoundLog, skippedQuestionNoun } from '../src/lib/afSummary.ts';
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

console.log('\nThe receipt replays the round in order, marks skips as skips, and shows at once\n');

// ── A. EXECUTED: the round log itself ───────────────────────────────────────────────────────────
const TYPE = { id: 'property_type', keys: ['apartment'], labels: ['شقة'] };
const DIR = { id: 'direction', keys: ['north'], labels: ['شمال'] };
const BATH = { id: 'bathrooms', keys: ['3'], labels: ['+٣'] };
const log = buildAfRoundLog;

// THE OWNER'S OWN WORKED EXAMPLE: apartment answered, age SKIPPED, الواجهة answered.
check("the owner's example renders as one ask-ordered sentence",
  log(['property_type', 'property_age', 'direction'], [TYPE, DIR])
    === 'شقة 🏡، تخطى عمر العقار ⏭️، وشمال 🧭',
  log(['property_type', 'property_age', 'direction'], [TYPE, DIR]));
// ORDER IS THE POINT: the skip sits WHERE IT HAPPENED, so the same facets asked in a different
// order must produce a different sentence — otherwise this is a pile, not a log.
check('the sentence follows ASK order, not facet order or registry order',
  log(['property_age', 'property_type', 'direction'], [TYPE, DIR])
    === 'تخطى عمر العقار ⏭️، شقة 🏡، وشمال 🧭',
  log(['property_age', 'property_type', 'direction'], [TYPE, DIR]));
check('a skip is worded as a skip and marked ⏭️',
  log(['bathrooms'], []) === 'تخطى دورات المياه ⏭️', log(['bathrooms'], []));
check('the skip carries NO per-question emoji (🚿 would read as an answer mid-sentence)',
  !log(['bathrooms'], []).includes('🚿'));
check('two items are joined with «، و», never a bare «و»',
  log(['bathrooms', 'direction'], [DIR]) === 'تخطى دورات المياه ⏭️، وشمال 🧭',
  log(['bathrooms', 'direction'], [DIR]));
check('an all-answered round shows no skip mark at all',
  !log(['property_type', 'direction'], [TYPE, DIR]).includes('⏭️'));
check('nothing asked and nothing committed → empty string', log([], []) === '');
check('a repeated id is named once', log(['rating', 'rating'], []) === 'تخطى التقييم ⏭️');
// Rule 1 of the permanent summary rule is the half that must never fail quiet: a facet in the
// predicate MUST appear. Ordering yields to it.
check('a committed facet missing from askedIds is still named, never silently dropped',
  log(['property_age'], [BATH]) === 'تخطى عمر العقار ⏭️، و+٣ حمامات 🚿',
  log(['property_age'], [BATH]));
// COMMA ALWAYS AFTER THE EMOJI, NEVER BEFORE (owner, universal).
{
  const sentence = log(['property_type', 'property_age', 'direction'], [TYPE, DIR]);
  const masked = sentence.replace(/[\u{1F300}-\u{1FAFF}☀-➿️]/gu, 'E');
  check('every comma sits AFTER an emoji, never before one',
    /E،/.test(masked) && !/،E/.test(masked), sentence);
}

// ── B. The two sentences stay separate ──────────────────────────────────────────────────────────
// The permanent rule (owner 2026-08-22) is about buildAfSummary, and this change must not touch it.
check('buildAfSummary takes no ask order and can emit no skip',
  buildAfSummary([{ id: 'property_age', keys: ['new'], labels: ['جديد'] }]) === 'عمر جديد ✨'
  && !buildAfSummary([TYPE, DIR]).includes('⏭️'));
check('an empty facet list still summarises to nothing (no stray joiner)', buildAfSummary([]) === '');
check('an answer is worded identically in both sentences (one shared renderer, no drift)',
  log(['property_type'], [TYPE]) === buildAfSummary([TYPE]));

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
check('the nouns carry no emoji of their own (the ⏭️ mark is added by the builder)',
  [...ids].every((id) => !/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(skippedQuestionNoun(id) ?? '')));

// ── D. The wiring in agent.tsx ──────────────────────────────────────────────────────────────────
check('a turn holding a receipt shows no actions row (this is what makes the swap immediate)',
  /const showActionsRow = !afReceipt\[m\.id\] && resultsActionsRowVisible\(\{/.test(agent),
  'without this the receipt waits for chatCompleted, which lands only after the next search returns');
const fin = windowBetween(agent, 'const finishGuided = ', 'const startAgeFlow = ', 'src/app/agent.tsx');
check('the receipt stores the ask-ordered round log',
  /\[carry\.msgId\]: roundLog/.test(fin)
  && /const roundLog = buildAfRoundLog\(askedThisRound, ageFlowFacetsRef\.current\)/.test(fin));
check("ask order is THIS round's, with the carry subtracted",
  /const askedThisRound = \[\.\.\.ageFlowAskedRef\.current\]\.filter\(\(id\) => !\(carry\?\.asked \?\? \[\]\)\.includes\(id\)\)/.test(fin),
  'carrying earlier rounds in would re-report questions the previous receipt already named');
check('only a round that COMMITTED something leaves a receipt',
  /if \(carry && roundCommitted\) setAfReceipt/.test(fin)
  && /const roundCommitted = buildAfSummary\(ageFlowFacetsRef\.current\)/.test(fin),
  'a skip-everything round must keep its buttons — a receipt there strands the user with no way back in');
check('the card prints the stored log verbatim, with no «اخترت:» label wrapping it',
  /testID="af-round-receipt-choices"[\s\S]{0,260}?\{afReceipt\[m\.id\]\}/.test(agent)
  && !/af-round-receipt-skipped/.test(agent),
  'the line mixes answers and skips, so a «your choices» label would mislabel half of it');

// ── E. The copy ─────────────────────────────────────────────────────────────────────────────────
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
// RETIRED, not merely unused — an orphaned key is how a deleted surface quietly comes back (the
// lesson the deleted AF overlay taught on this same day).
check('the retired label keys are gone from i18n',
  !i18n.includes('Your choices: {summary}') && !i18n.includes('Skipped: {summary}')
  && !i18n.includes('اختياراتك'));
check("the card's heading is still translated",
  i18n.includes("'Continued with the advanced filter': 'تابع المستخدم باستخدام التصفية المتقدمة'"));

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
mustCatch('the log sorted into piles instead of kept in ask order',
  log(['property_type', 'property_age', 'direction'], [TYPE, DIR])
    !== log(['property_age', 'property_type', 'direction'], [TYPE, DIR]));
mustCatch("a skip given the question's own emoji instead of ⏭️",
  !log(['property_age'], []).includes('🏗️'));
mustCatch('skips leaking into the PILLS sentence', !buildAfSummary([TYPE, DIR]).includes('⏭️'));

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — the receipt is late, silent about skips, or out of order\n`
  : '\n✓ the round reads back in the order it happened, skips marked as skips, card replaces the row at once\n');
process.exit(failed ? 1 : 0);
