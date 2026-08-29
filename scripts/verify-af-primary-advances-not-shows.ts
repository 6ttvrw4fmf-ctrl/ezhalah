// The Advanced-Filter primary button must not promise results it does not deliver.
//
// DEFECT (production, found 2026-08-23). On a SINGLE-select AF question the green primary button
// read «عرض N نتيجة» ("Show N results"). Tapping it showed nothing: the overlay simply moved on to
// the next question and no results turn was ever produced. Repro that caught it — إيجار / الرياض /
// شقة → «خلّنا نحدد الطلب أكثر» → Q1 «تفضل تدفع الإيجار على دفعات؟» → Q2 «كم عمر العقار تقريباً؟»
// (single) → pick «جديد» → primary reads «عرض 1,848 نتيجة» → tap → card is still open, now titled
// «تفضلها مفروشة؟», chat still holds only the original «لقينا 10,589 إعلان يطابق طلبك.».
//
// CAUSE. The label branched on ARITY alone — multi got «متابعة · N نتيجة», single got
// «عرض N نتيجة» — while the onPress was `onConfirm(sel)` for both. `onConfirm` is
// `commitGuidedStep(keys)` WITHOUT the finish flag: it records the answer and presents the next
// question. Arity never had anything to do with terminality. Ordinality cannot stand in for it
// either: the interview re-ranks the still-unasked pool after every answer, so the card genuinely
// cannot know whether another question is coming.
//
// UPDATE (owner, 2026-08-28): the «عرض النتائج» footer link (`af-skip-all`) — previously the one
// terminal control — was REMOVED entirely; the question footer is متابعة / تخطي / رجوع and a round
// ends only by walking its questions, by Back from question 1, or by ✕. That makes this barrier's
// core rule even stricter: with no in-question terminal control at all, NOTHING in the question
// footer may ever promise results. §3 below pins the removal in both directions.
//
// WHY A BARRIER. This is the owner's "visible UI state must equal committed request state" rule at
// the label level: a control's words must describe what its tap does. The regression is invisible
// to type-checking and to every count-honesty barrier (the NUMBER was right — the verb was not),
// so nothing else in the suite would catch the arity branch coming back.
//
//   node --experimental-strip-types scripts/verify-af-primary-advances-not-shows.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
// Comments describe the defect in prose; only executable source may satisfy a check.
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const cardSrc = codeOnly(read('src/components/AdvancedQuestionCard.tsx'));
const agentSrc = codeOnly(read('src/app/agent.tsx'));
const i18nSrc = read('src/i18n.tsx');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// The rendered block of ONE control, from its testID to the end of its element — so a check about
// the primary's wording can never be satisfied by wording that belongs to the escape link.
const block = (src: string, testId: string, close: string): string => {
  const at = src.indexOf(`testID="${testId}"`);
  if (at < 0) return '';
  const end = src.indexOf(close, at);
  return end < 0 ? '' : src.slice(at, end);
};
const primary = block(cardSrc, 'af-confirm', '</Tap>');

console.log('\nAdvanced Filter — the primary button advances, so it must not promise results\n');

// ── 1. the PREMISE: the primary commits this answer and advances ONE question ───────────────────
// If this ever stops being true the rest of this file is arguing about the wrong button — fix the
// premise here deliberately before relabelling anything.
check('the primary rides onConfirm(sel)',
  /onPress=\{\(\) => onConfirm\(sel\)\}/.test(primary),
  'af-confirm no longer calls onConfirm(sel)');
check('onConfirm advances: onAgeConfirm commits WITHOUT the finish flag',
  /const onAgeConfirm = \(keys: string\[\]\) => \{ void commitGuidedStep\(keys\); \}/.test(agentSrc),
  'the primary may now be terminal — re-derive this barrier before changing its label');
// `void` or `await` — PR #955 made the call awaited to close a duplicate-tap race. What this barrier
// cares about is that a confirm ADVANCES (presentGuided on the next step) rather than finishing, so
// the keyword in front of it is deliberately not pinned.
check('the interview genuinely continues after a confirm (presentGuided on the next step)',
  /if \(finish\) \{ finishGuided\(token\); return; \}/.test(agentSrc)
  && /(?:void|await) presentGuided\(stepIndex \+ 1, token\)/.test(agentSrc));

// ── 2. therefore: the primary's words must not promise results ──────────────────────────────────
check('the primary label never promises results («Show …»)',
  primary !== '' && !/t\('Show/.test(primary),
  `af-confirm label block still contains a Show-promise:\n      ${primary.replace(/\s+/g, ' ').slice(0, 200)}`);
check('the primary label is the advance label, with the live count',
  /t\('Continue · \{count\} results', \{ count: grouped\(count\) \}\)/.test(primary)
  && /t\('Continue'\)/.test(primary),
  'af-confirm must read «متابعة · N نتيجة» (and «متابعة» while the count is still loading)');
check('the primary label does not branch on arity (single and multi advance identically)',
  primary !== '' && !/selection/.test(primary),
  'the arity branch that produced the defect is back inside the af-confirm block');

// ── 3. the in-question early-exit stays REMOVED (owner, 2026-08-28) ─────────────────────────────
// With af-skip-all gone there is no terminal control in the question footer at all, so no footer
// control may carry terminal wording — and the removal itself must not silently revert.
check('af-skip-all does not exist in the question card (the owner removed the early-exit)',
  !/testID="af-skip-all"/.test(cardSrc) && !/onSkipAll/.test(cardSrc));
check('agent.tsx no longer wires an onAgeSkipAll handler',
  !/onAgeSkipAll/.test(agentSrc));
check('the intro card has no «عرض النتائج» decline link either (owner follow-up 2026-08-28: no such action anywhere inside the AF flow; ✕ is the decline and always ran the identical handler)',
  !/onShowResults/.test(cardSrc));

// ── 4. Arabic is the product language — both label states must be translated ────────────────────
check('the primary label has its Arabic translations',
  /'Continue · \{count\} results': 'متابعة · \{count\} نتيجة'/.test(i18nSrc) && /'Continue': 'متابعة'/.test(i18nSrc));

// ── mutation self-proof: every check above must FAIL against its own defect ─────────────────────
let mutFail = 0;
const mustCatch = (label: string, brokenIsCaught: boolean) => {
  if (brokenIsCaught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};
const mut = (src: string, from: string | RegExp, to: string) => src.replace(from, to);

// The exact production defect: restore the arity branch on the label.
const rebroken = mut(cardSrc,
  /\{count != null \? t\('Continue · \{count\} results', \{ count: grouped\(count\) \}\) : t\('Continue'\)\}/,
  `{selection === 'multi'
    ? (count != null ? t('Continue · {count} results', { count: grouped(count) }) : t('Continue'))
    : (count != null ? t('Show {count} results', { count: grouped(count) }) : t('Show results'))}`);
const rebrokenPrimary = block(rebroken, 'af-confirm', '</Tap>');
mustCatch('the arity-branched «عرض N نتيجة» label coming back',
  /t\('Show/.test(rebrokenPrimary) || /selection/.test(rebrokenPrimary));
mustCatch('a bare «عرض النتائج» on the primary',
  /t\('Show/.test(block(mut(cardSrc, "t('Continue')", "t('Show results')"), 'af-confirm', '</Tap>')));
mustCatch('the premise silently flipping to a terminal primary',
  !/const onAgeConfirm = \(keys: string\[\]\) => \{ void commitGuidedStep\(keys\); \}/.test(
    mut(agentSrc, 'const onAgeConfirm = (keys: string[]) => { void commitGuidedStep(keys); }',
      'const onAgeConfirm = (keys: string[]) => { void commitGuidedStep(keys, true); }')));
mustCatch('the removed af-skip-all early-exit creeping back into the card',
  /testID="af-skip-all"/.test(cardSrc + '\n<Pressable testID="af-skip-all" onPress={() => onSkipAll(sel)} />'));
mustCatch('an onAgeSkipAll handler creeping back into agent.tsx',
  /onAgeSkipAll/.test(agentSrc + '\nconst onAgeSkipAll = (keys: string[]) => { void commitGuidedStep(keys, true); };'));
mustCatch('the intro decline link creeping back',
  /onShowResults/.test(cardSrc + '\n<Pressable onPress={onShowResults} />'));
mustCatch('the block extractor going blind (a missing testID reads as an empty block)',
  block(mut(cardSrc, 'testID="af-confirm"', ''), 'af-confirm', '</Tap>') === '');

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ the AF primary advances one question and says so; the in-question «عرض النتائج» early-exit stays removed\n');
