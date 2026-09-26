// A JOURNEY'S «ملخص البحث» MUST NAME THE CITY IT ASKED FOR — judged by EXACT NAME, never a substring.
//
// WHY THIS EXISTS (routine #4, 2026-09-26). `assertChain`'s INTENT→UI city test read:
//
//     !ui.city.includes(intent.city) && !intent.city.includes(ui.city)
//
// and `'الخبراء'.includes('الخبر')` is TRUE. So a journey that asked for الخبر — 15,254
// production_ready rows, measured on production the day this was written — and actually searched
// الخبراء — 17 — reported `ok`, and `ops_qa_coverage_ledger` recorded coverage for a city that was
// never searched. NINE city pairs in production collide this way (`b.city_ar LIKE a.city_ar||'%'`
// over distinct production_ready cities); the pairs asserted below are that measurement.
//
// It is the SECOND HALF of `ops_incident` #733, and it was left open on purpose: routine #9 fixed
// which option `pickCity` clicks (`e2e/live-sweep/cityOption.mjs`, proven by
// `scripts/verify-city-option-pick-is-exact.ts`) and recorded that the guard itself «remains blind by
// construction». That mattered more than a leftover, because `cityOption.mjs`'s prefix FALLBACK is
// justified in its own comment with «let the caller's own INTENT→UI comparison be the thing that
// judges the result» — a delegation to precisely the test that could not judge a prefix. The pick and
// the judgement were blind in the same direction at the same time.
//
// This barrier EXECUTES the rule (`cityIntentMismatch`, exported from sweep.mjs for this purpose)
// rather than reading the call site's source. A source-text tripwire over this exact line is what
// AGENTS.md records as the defect class that stays green for as long as the defect is live — and two
// of the five defects of 2026-09-04 had a barrier that literally pinned the defective line as correct.
//
// Hermetic: no browser, no network, no database. It belongs in the required `npm test`.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-live-sweep-city-intent-is-exact.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cityIntentMismatch, cityLookupKey } from '../e2e/live-sweep/sweep.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nINTENT→UI city equality is EXACT: a longer city containing the asked-for one is a DEFECT\n');

// ── the production measurement ───────────────────────────────────────────────────────────────────
// Captured 2026-09-26 from `search_listings_ar` where production_ready, as
//   select a.city_ar, b.city_ar from (distinct cities) a join (distinct cities) b
//     on b.city_ar <> a.city_ar and b.city_ar like a.city_ar || '%'
// `asked` is the shorter city the journey wants; `served` is the longer one the old test let through.
// These are names PRODUCTION STORES, never shapes this file invented.
const PREFIX_PAIRS: Array<{ asked: string; served: string; askedRows: number; servedRows: number }> = [
  { asked: 'الخبر',   served: 'الخبراء',          askedRows: 15254, servedRows: 17 },
  { asked: 'الجبيل',  served: 'الجبيلة',          askedRows: 1229,  servedRows: 29 },
  { asked: 'صبيا',    served: 'صبياء',            askedRows: 256,   servedRows: 10 },
  { asked: 'بيش',     served: 'بيشة',             askedRows: 162,   servedRows: 160 },
  { asked: 'الخرماء', served: 'الخرماء الجنوبية', askedRows: 5,     servedRows: 1 },
  { asked: 'السلام',  served: 'السلام العليا',    askedRows: 3,     servedRows: 1 },
  { asked: 'العمار',  served: 'العمارية',         askedRows: 2,     servedRows: 21 },
  { asked: 'الجلة',   served: 'الجلة وتبراك',     askedRows: 2,     servedRows: 5 },
  { asked: 'القاع',   served: 'القاعد',           askedRows: 1,     servedRows: 3 },
];

// ── 1. THE RULE CATCHES EVERY REAL PREFIX PAIR, BY EXECUTION ────────────────────────────────────
for (const { asked, served, askedRows, servedRows } of PREFIX_PAIRS) {
  check(`«${asked}» (${askedRows} rows) searched as «${served}» (${servedRows}) is a MISMATCH`,
    cityIntentMismatch(asked, served) === true,
    `cityIntentMismatch(${JSON.stringify(asked)}, ${JSON.stringify(served)}) returned false`);
}
// Both directions: the old test was symmetric in its blindness, so the fix must be symmetric too.
for (const { asked, served } of PREFIX_PAIRS) {
  check(`and in reverse — asked «${served}», summary shows «${asked}»`,
    cityIntentMismatch(served, asked) === true);
}

// ── 2. THE MUTATION — the OLD predicate must FAIL these, or this barrier proves nothing ─────────
// If a future edit restores the substring form, section 1 goes red. This asserts the two predicates
// genuinely DISAGREE on the production data, so section 1 is a live discriminator and not a tautology.
const substringPredicate = (intent: string, ui: string) =>
  !ui.includes(intent) && !intent.includes(ui);
const missedByOld = PREFIX_PAIRS.filter(({ asked, served }) => substringPredicate(asked, served) === false);
check('MUTATION: the substring predicate this replaced misses ALL 9 production prefix pairs',
  missedByOld.length === PREFIX_PAIRS.length,
  `it would have caught ${PREFIX_PAIRS.length - missedByOld.length} of them — then section 1 is not a discriminator`);
check('MUTATION: the exact rule and the substring rule disagree on every one of them',
  PREFIX_PAIRS.every(({ asked, served }) =>
    cityIntentMismatch(asked, served) !== !substringPredicate(asked, served)) === false
  && PREFIX_PAIRS.every(({ asked, served }) =>
    cityIntentMismatch(asked, served) === true && substringPredicate(asked, served) === false));

// ── 3. NO FALSE DEFECTS — the same city spelled differently is still the same city ──────────────
// §40.7 / §41.15: an oracle that accuses the product for its own imprecision is worse than no oracle.
// A strict `===` would report every one of these as a wrong city.
const SAME_CITY: Array<[string, string]> = [
  ['أبو عريش', 'ابو عريش'],   // أ/ا
  ['إبو عريش', 'ابو عريش'],   // إ/ا
  ['آبو عريش', 'ابو عريش'],   // آ/ا
  ['مكة',      'مكه'],        // ة/ه
  ['المرتضى',  'المرتضي'],    // ى/ي
  ['بـريدة',   'بريدة'],      // tatweel
  ['  جدة  ',  'جدة'],        // surrounding whitespace
  ['ابو   عريش', 'ابو عريش'], // collapsed whitespace run
];
for (const [a, b] of SAME_CITY) {
  check(`«${a}» and «${b}» are the SAME city, not a mismatch`,
    cityIntentMismatch(a, b) === false,
    `normalised: ${JSON.stringify(cityLookupKey(a))} vs ${JSON.stringify(cityLookupKey(b))}`);
}

// ── 4. THE FOLD NEVER SHORTENS A NAME ───────────────────────────────────────────────────────────
// Section 3 is only safe if normalisation cannot collapse a prefix pair into equality. Proven over
// the real pairs rather than argued: if some future fold stripped a suffix, section 1 would silently
// start passing wrong cities and section 3 would still look fine.
for (const { asked, served } of PREFIX_PAIRS) {
  check(`the fold keeps «${asked}» and «${served}» distinct`,
    cityLookupKey(asked) !== cityLookupKey(served),
    `both normalise to ${JSON.stringify(cityLookupKey(asked))}`);
}

// ── 5. A FIELD THE SUMMARY DOES NOT SHOW CANNOT BE JUDGED ───────────────────────────────────────
// `parseVisibleState` returns null for every field when no «ملخص البحث» is on screen. Reading LESS
// must stay safe: a missing summary may never invent a defect (visibleState.mjs's own contract).
check('a null/absent ui.city is not a mismatch', cityIntentMismatch('الخبر', null as never) === false
  && cityIntentMismatch('الخبر', '') === false);
check('a journey with no city intent is not a mismatch', cityIntentMismatch(null as never, 'الخبر') === false
  && cityIntentMismatch('', 'الخبر') === false);

// ── 6. THE CALL SITE USES THE RULE, AND THE SUBSTRING FORM IS GONE ──────────────────────────────
// Sections 1–5 prove the RULE. This proves the JOURNEY reaches it: a perfect predicate nothing calls
// is decoration, and the defect being fixed lived at the call site, not in the predicate.
const sweep = read('e2e/live-sweep/sweep.mjs');
// Judge CODE as code. The comments in sweep.mjs quote the old predicate verbatim — that history is
// why the file is readable — so a raw text search would fail on the very documentation of the fix.
const sweepCode = sweep
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
check('assertChain judges the city through cityIntentMismatch', sweepCode.includes('cityIntentMismatch(intent.city, ui.city)'));
check('the substring city test is gone from sweep.mjs CODE',
  !/!ui\.city\.includes\(intent\.city\)/.test(sweepCode) && !/!intent\.city\.includes\(ui\.city\)/.test(sweepCode),
  'the old INTENT→UI substring comparison is still live code');
// A stripper that ate the whole file would make the two checks above pass vacuously. Assert it still
// holds real code by naming symbols that only exist in code — not by a size ratio: sweep.mjs is 61%
// comment by design (78,720 → 30,640 chars, measured 2026-09-26), and that ratio is not a defect.
check('the comment stripper did not empty the file (real code symbols survive)',
  ['export function cityIntentMismatch', 'export function cityScopeArm', 'function dbFilterFromRequest',
   'export function districtResolutionScope', 'resolveDistrictLabels(']
    .every((sym) => sweepCode.includes(sym)),
  `stripped ${sweep.length} → ${sweepCode.length} chars, and a named symbol went missing with the comments`);
check('cityIntentMismatch is exported for execution, not re-implemented per caller',
  /export function cityIntentMismatch/.test(sweep));

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
