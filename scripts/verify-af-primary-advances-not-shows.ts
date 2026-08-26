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
// cannot know whether another question is coming. The one terminal control is the «عرض النتائج»
// link (`af-skip-all` → `commitGuidedStep(keys, true)` → `finishGuided`).
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
const escape_ = block(cardSrc, 'af-skip-all', '</Pressable>');

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

// ── 3. the ONE terminal control keeps its terminal wording ──────────────────────────────────────
check('«عرض النتائج» is the terminal control: af-skip-all, labelled Show results',
  /onPress=\{\(\) => onSkipAll\(sel\)\}/.test(escape_) && /t\('Show results'\)/.test(escape_));
check('onSkipAll finishes the interview (commitGuidedStep with finish = true)',
  /const onAgeSkipAll = \(keys: string\[\]\) => \{ void commitGuidedStep\(keys, true\); \}/.test(agentSrc));

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
mustCatch('the escape link losing its terminal commit',
  !/const onAgeSkipAll = \(keys: string\[\]\) => \{ void commitGuidedStep\(keys, true\); \}/.test(
    mut(agentSrc, 'commitGuidedStep(keys, true)', 'commitGuidedStep(keys)')));
mustCatch('the escape link losing its «عرض النتائج» wording',
  !/t\('Show results'\)/.test(block(mut(cardSrc, "s.skipAllTxt}>{t('Show results')}", "s.skipAllTxt}>{t('Skip')}"), 'af-skip-all', '</Pressable>')));
mustCatch('the block extractor going blind (a missing testID reads as an empty block)',
  block(mut(cardSrc, 'testID="af-confirm"', ''), 'af-confirm', '</Tap>') === '');

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ the AF primary advances one question and says so; «عرض النتائج» remains the one terminal control\n');
