// Automated tests — the two sibling English-leak gaps found by the 2026-07-13 independent
// adversarial re-verification pass, after the original city-leak fix:
//
// 1. src/app/interview.tsx's guided-interview "Something else" custom answer had no Arabic-only
//    input guard (unlike src/app/index.tsx / src/app/agent.tsx), so a custom-typed English answer
//    (city/neighborhood/category/type/amenity) flowed unvalidated into t()/tWord() calls and leaked
//    raw English into the Arabic UI — and further downstream, into src/data/search.ts's
//    whatText()/searchSummary()/querySummaryLine(), which had NO guard on the property-type side
//    (only the location side was ever guarded via arabicOrUnresolved()).
// 2. scrapers/wasalt/run.py's deep-fetch backfill stores Wasalt's own raw attribute LABEL text
//    verbatim (unlike every sibling additional-info source, which only emits a small fixed,
//    AR{}-translated set), and src/components/ResultCard.tsx's AdditionalInformationPanel rendered
//    that label via a bare t(r.label) with no guard — unlike the VALUE on the same row, which was
//    already guarded.
//
// Both fixes reuse the SAME zero-dependency arabicOrPlaceholder() primitive (src/lib/arabicText.ts,
// already proven directly executable — see scripts/verify-arabic-summary-fallback.ts), composed with
// a new placeholder constant per case (TYPE_UNRESOLVED_AR, ATTRIBUTE_UNRESOLVED_AR — both in
// src/i18n.tsx, which can't be live-imported here for the same reason as always: heavy React
// Native / Reanimated imports). So this test: (a) genuinely executes arabicOrPlaceholder with the
// exact literal placeholder values (proving the composition is correct), and (b) does a lightweight
// source-text check that the guard call sites actually exist, and that isLatinOnlyInput/ARABIC_ONLY_MSG
// are actually imported and used in interview.tsx (the input-side half of fix #1).
//
//   node --experimental-strip-types scripts/verify-type-and-attribute-fallback.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { arabicOrPlaceholder, hasArabicChar } from '../src/lib/arabicText.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

// These literal values must stay in sync with src/i18n.tsx's exported constants — checked below via
// a source-text assertion, so a drift between the two is caught rather than silently passing.
const TYPE_UNRESOLVED_AR = 'نوع غير محدد';
const ATTRIBUTE_UNRESOLVED_AR = 'بيان غير محدد';

// ── REAL, EXECUTED composition tests (the shared primitive both fixes rely on) ─────────────────────
eq('a custom interview type ("Penthouse", not in AR{}) becomes the type placeholder, not raw English', arabicOrPlaceholder('Penthouse', 'ar', TYPE_UNRESOLVED_AR), TYPE_UNRESOLVED_AR);
eq('a real, already-translated type word passes through unchanged', arabicOrPlaceholder('فيلا', 'ar', TYPE_UNRESOLVED_AR), 'فيلا');
eq('a Wasalt attribute label that misses the AR{} dict becomes the attribute placeholder, not raw English', arabicOrPlaceholder('Some Unmapped Label', 'ar', ATTRIBUTE_UNRESOLVED_AR), ATTRIBUTE_UNRESOLVED_AR);
eq('a real, already-translated attribute label passes through unchanged', arabicOrPlaceholder('الواجهة', 'ar', ATTRIBUTE_UNRESOLVED_AR), 'الواجهة');
check('both new placeholders are themselves genuinely Arabic (would be a no-op leak-guard otherwise)', hasArabicChar(TYPE_UNRESOLVED_AR) && hasArabicChar(ATTRIBUTE_UNRESOLVED_AR));

// ── Source-text checks for the parts that can't be live-imported (heavy RN/search.ts deps) ─────────
const stripWs = (s: string) => s.replace(/\s+/g, '');

// Note: stripWs strips whitespace INSIDE string literals too (e.g. 'نوع غير محدد' → 'نوعغيرمحدد') —
// harmless as long as both sides of a comparison go through the same transform, which they do here.
const I18N_TS = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');
check(
  "i18n.tsx's TYPE_UNRESOLVED_AR literal matches what this test asserts against",
  stripWs(I18N_TS).includes(stripWs(`export const TYPE_UNRESOLVED_AR = '${TYPE_UNRESOLVED_AR}';`)),
);
check(
  "i18n.tsx's ATTRIBUTE_UNRESOLVED_AR literal matches what this test asserts against",
  stripWs(I18N_TS).includes(stripWs(`export const ATTRIBUTE_UNRESOLVED_AR = '${ATTRIBUTE_UNRESOLVED_AR}';`)),
);

const INTERVIEW_TS = readFileSync(new URL('../src/app/interview.tsx', import.meta.url), 'utf8');
const INTERVIEW_NOWS = stripWs(INTERVIEW_TS);
check(
  'interview.tsx imports the Arabic-only input guard (isLatinOnlyInput, ARABIC_ONLY_MSG) from @/i18n',
  /import\{[^}]*isLatinOnlyInput[^}]*ARABIC_ONLY_MSG[^}]*\}from'@\/i18n'/.test(INTERVIEW_NOWS),
);
check(
  "interview.tsx's goNext() rejects a Latin-only custom answer before calling answer()",
  INTERVIEW_NOWS.includes("if(isLatinOnlyInput(customVal.trim())){setCustomErr(ARABIC_ONLY_MSG);return;}"),
);
// 2026-07-13 integration-gap fix: the pre-existing "isn't a city I recognize, I'll still search"
// note and the new Arabic-only rejection note must never render stacked/simultaneously — the old
// note's promise ("I'll still search") is false the instant goNext() has just rejected the answer.
check(
  "interview.tsx suppresses the cityUnknown note while customErr is showing (the two notes never stack)",
  INTERVIEW_NOWS.includes('{cityUnknown&&!customErr?'),
);

const SEARCH_TS = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');
const SEARCH_NOWS = stripWs(SEARCH_TS);
check(
  'search.ts defines arabicOrTypeUnresolved() (the property-type sibling of arabicOrUnresolved())',
  SEARCH_NOWS.includes('functionarabicOrTypeUnresolved(s:string):string{returnarabicOrPlaceholder(s,getLocale(),TYPE_UNRESOLVED_AR);}'),
);
check(
  'whatText() wraps its tWord() result in arabicOrTypeUnresolved()',
  SEARCH_NOWS.includes("constwhatText=(q:SearchQuery)=>arabicOrTypeUnresolved(tWord(q.type??q.category??'Property'));"),
);
// No new *unwrapped* tWord(q.type...)/tWord(q.category)/tWord(x) call site feeding a user-facing
// summary/heading line should appear without arabicOrTypeUnresolved on the same line — catches a
// FUTURE sibling leak in this same file, mirroring the tPlace() catch-all in
// scripts/verify-no-english-city-leak.ts.
const bareTypeWordLines = SEARCH_TS
  .split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => /\btWord\(/.test(line))
  .filter(({ line }) => !/arabicOrTypeUnresolved\(/.test(line))
  .filter(({ line }) => !/^\s*(\/\/|const whatText|export function tWord)/.test(line.trim()));
check(
  `no new unwrapped tWord() call sites feeding search.ts's user-facing type text (found: ${bareTypeWordLines.map((l) => l.n).join(', ') || 'none'})`,
  bareTypeWordLines.length === 0,
);

const RESULTCARD_TS = readFileSync(new URL('../src/components/ResultCard.tsx', import.meta.url), 'utf8');
check(
  "ResultCard.tsx's AdditionalInformationPanel wraps the row label in arabicOrPlaceholder(..., ATTRIBUTE_UNRESOLVED_AR)",
  stripWs(RESULTCARD_TS).includes('arabicOrPlaceholder(t(r.label),locale,ATTRIBUTE_UNRESOLVED_AR)'),
);

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} type-and-attribute-fallback assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ all type-and-attribute-fallback assertions passed');
