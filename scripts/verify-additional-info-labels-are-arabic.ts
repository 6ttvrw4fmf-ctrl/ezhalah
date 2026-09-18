// AN "ADDITIONAL INFORMATION" ROW NEVER SHOWS «بيان غير محدد» FOR A NAME THE SOURCE PUBLISHED,
// AND NEVER LEAKS AN ENGLISH PERIOD WORD — executed, not read.
//
// THE DEFECT (found live on production, 2026-09-18, Normal-Filter QA run; Riyadh / إيجار / شقة,
// result card #2 = therc_residential_listings/10283325). `additional_info` rows carry BOTH `key` and
// `label`, and the two platforms that populate the field disagree about which one a human reads:
//
//   therc  → {"key":"السعر كما نشر", "label":"Price as published"}   ← the ARABIC name is the key
//   wasalt → {"key":"propertyMainType", "label":"Property usage"}     ← the key is a machine name
//
// ResultCard rendered `arabicOrPlaceholder(t(r.label), …)`, so for therc every label that has no
// AR{} entry collapsed to «بيان غير محدد» — the app telling the user "statement unspecified" about a
// field whose Arabic name it was holding in the same object. Measured against production: 438 therc
// listings carry the field (429 residential + 9 commercial) and three of the four rows on each are
// affected («رقم المرجع», «تاريخ النشر», «السعر كما نشر»); «الحي» survived only because "District"
// happens to be in AR{}. Separately, therc's price string «5,000 ر.س \n / yearly» (245 listings)
// contains «ر.س», so the free-text English-leak guard correctly passed it through as real source
// content — and carried the English word "yearly" onto an Arabic card with it.
//
// WHY THIS BARRIER IS SHAPED LIKE THIS. Both halves are PURE functions and this check RUNS them —
// the repo has been burned repeatedly by source-TEXT tripwires that pinned a defective line as
// correct for as long as it was live (AGENTS.md, "Barriers for this class must EXECUTE"). It also
// asserts the WIRING, because a correct helper nothing calls is decoration: the two production call
// sites in ResultCard.tsx are checked, and the pre-fix expressions are asserted GONE.
//
//   node --experimental-strip-types scripts/verify-additional-info-labels-are-arabic.ts
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attrDisplayLabel, translateTrailingPeriodWord, hasArabicChar, hasLatinLetter,
} from '../src/lib/arabicText.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CARD = join(ROOT, 'src/components/ResultCard.tsx');
const PLACEHOLDER = 'بيان غير محدد';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ─── 1. THE LABEL HALF, executed against the two real production shapes ──────────────────────────
// The exact rows production serves, copied from the live DB read that found the defect.
const THERC_ROWS = [
  { key: 'رقم المرجع',    label: 'Reference',          value: 'AQ422369' },
  { key: 'تاريخ النشر',   label: 'Date posted',        value: '2026-07-12T12:15:53+03:00' },
  { key: 'الحي',          label: 'District',           value: 'حي ظهرة لبن' },
  { key: 'السعر كما نشر', label: 'Price as published', value: '5,000 ر.س \n / yearly' },
];
// `t()` in the Arabic locale: an AR{} hit returns Arabic, a miss returns the English key verbatim.
const AR_DICT: Record<string, string> = { District: 'الحي', 'Property usage': 'استخدام العقار' };
const t = (k: string) => AR_DICT[k] ?? k;

for (const r of THERC_ROWS) {
  const shown = attrDisplayLabel(t(r.label), r.key, 'ar', PLACEHOLDER);
  check(`therc «${r.key}» renders its published Arabic name, not the placeholder`,
    shown !== PLACEHOLDER && hasArabicChar(shown) && !hasLatinLetter(shown),
    `rendered: ${JSON.stringify(shown)}`);
}
check('a label WITH an AR{} translation still wins over the raw key',
  attrDisplayLabel(t('District'), 'الحي', 'ar', PLACEHOLDER) === 'الحي');
check('a translated Arabic label is preferred even when the key differs',
  attrDisplayLabel('استخدام العقار', 'propertyMainType', 'ar', PLACEHOLDER) === 'استخدام العقار');

// wasalt: the key is a machine name. Promoting it would BE the English leak this family prevents.
for (const k of ['propertyMainType', 'electricityMeter', 'regaAdvLicDate', 'zipCode', 'obligations']) {
  check(`wasalt machine key «${k}» is never promoted into the UI`,
    attrDisplayLabel(t('Ad source'), k, 'ar', PLACEHOLDER) === PLACEHOLDER);
}
check('a mixed Arabic+Latin key is refused (not a clean display string)',
  attrDisplayLabel('Reference', 'رقم ref', 'ar', PLACEHOLDER) === PLACEHOLDER);
check('an empty/absent key still falls back to the honest placeholder',
  attrDisplayLabel('Reference', '', 'ar', PLACEHOLDER) === PLACEHOLDER
  && attrDisplayLabel('Reference', undefined as unknown as string, 'ar', PLACEHOLDER) === PLACEHOLDER);
check('the English locale is untouched (an English label is correct there, not a leak)',
  attrDisplayLabel('Reference', 'رقم المرجع', 'en', PLACEHOLDER) === 'Reference');

// ─── 2. THE VALUE HALF ───────────────────────────────────────────────────────────────────────────
const priced = translateTrailingPeriodWord('5,000 ر.س \n / yearly', 'ar');
check('«/ yearly» is rendered in Arabic', priced.includes('سنوياً'), `rendered: ${JSON.stringify(priced)}`);
check('no Latin letter survives in the price-as-published value', !hasLatinLetter(priced),
  `rendered: ${JSON.stringify(priced)}`);
check('the number and currency are preserved verbatim (never a rewrite of the value)',
  priced.includes('5,000') && priced.includes('ر.س'));
for (const [en, ar] of [['monthly', 'شهرياً'], ['weekly', 'أسبوعياً'], ['daily', 'يومياً'], ['Yearly', 'سنوياً']]) {
  check(`«/ ${en}» → «${ar}»`, translateTrailingPeriodWord(`900 ر.س / ${en}`, 'ar').includes(ar));
}
check('a sale price with no period suffix is returned untouched',
  translateTrailingPeriodWord('650,000 ر.س', 'ar') === '650,000 ر.س');
check('an UNKNOWN trailing word is left exactly as published, never guessed at',
  translateTrailingPeriodWord('5,000 ر.س / fortnightly', 'ar') === '5,000 ر.س / fortnightly');
check('a Latin word that is not a trailing period token is untouched',
  translateTrailingPeriodWord('REGA-4471 yearly report', 'ar') === 'REGA-4471 yearly report');
check('the English locale is untouched',
  translateTrailingPeriodWord('5,000 ر.س / yearly', 'en') === '5,000 ر.س / yearly');
check('an empty value is a no-op', translateTrailingPeriodWord('', 'ar') === '');

// ─── 3. THE WIRING — a correct helper nothing calls is decoration ────────────────────────────────
const card = readFileSync(CARD, 'utf8');
check('ResultCard imports both helpers',
  /import\s*\{[^}]*\battrDisplayLabel\b[^}]*\}\s*from\s*'@\/lib\/arabicText'/s.test(card)
  && /import\s*\{[^}]*\btranslateTrailingPeriodWord\b[^}]*\}\s*from\s*'@\/lib\/arabicText'/s.test(card));
check('the additional-info LABEL is rendered through attrDisplayLabel, with the row key',
  /attrDisplayLabel\(\s*t\(r\.label\)\s*,\s*r\.key\s*,\s*locale\s*,\s*ATTRIBUTE_UNRESOLVED_AR\s*\)/.test(card));
check('arAttrValue\'s generic fallback goes through translateTrailingPeriodWord',
  /return translateTrailingPeriodWord\(v, locale\);/.test(card));
check('the pre-fix label expression is GONE (it produced the placeholder for a published name)',
  !/arabicOrPlaceholder\(t\(r\.label\), locale, ATTRIBUTE_UNRESOLVED_AR\)/.test(card));

// ─── 4. MUTATION PROOF — each guard is shown to be load-bearing ──────────────────────────────────
// Re-implementations of the exact behaviour being ruled out. If a mutant passes the assertions
// above, the assertion is blind and this file is worthless.
let mutFail = 0;
const mustCatch = (what: string, caught: boolean) => {
  if (caught) { console.log(`KILLED  ${what}`); return; }
  mutFail++;
  console.error(`SURVIVED  ${what}  ← the assertion above cannot see this defect`);
};

// M1 — the pre-fix label behaviour: ignore the key, placeholder on any non-Arabic translation.
const preFixLabel = (tl: string, _k: string, loc: string, ph: string) =>
  (loc !== 'ar' ? tl : (tl && hasArabicChar(tl) ? tl : ph));
mustCatch('the pre-fix label path (key ignored → «بيان غير محدد» for a published Arabic name)',
  THERC_ROWS.some((r) => preFixLabel(t(r.label), r.key, 'ar', PLACEHOLDER) === PLACEHOLDER));

// M2 — promoting ANY key, which would put wasalt's `propertyMainType` on an Arabic card.
const promoteAnyKey = (tl: string, k: string, loc: string, ph: string) =>
  (loc !== 'ar' ? tl : (tl && hasArabicChar(tl) ? tl : (k ? k : ph)));
mustCatch('promoting a machine key into the UI (a NEW English leak)',
  hasLatinLetter(promoteAnyKey(t('Ad source'), 'propertyMainType', 'ar', PLACEHOLDER)));

// M3 — the value left unguarded, exactly as it shipped.
mustCatch('the price-as-published value returned verbatim (English "yearly" on an Arabic card)',
  hasLatinLetter('5,000 ر.س \n / yearly'));

// M4 — a period translator that rewrites the whole value instead of only the trailing word.
const clobber = (s: string) => s.replace(/[A-Za-z]+/g, 'سنوياً');
mustCatch('a translator that clobbers non-period Latin text (source content rewritten)',
  clobber('REGA-4471 yearly report') !== 'REGA-4471 yearly report');

if (failures || mutFail) {
  console.error(`\n❌ ${failures} assertion failure(s), ${mutFail} blind mutation(s)`);
  process.exit(1);
}
console.log('\n✅ a published Arabic label is shown, a machine key never is, and no English period word leaks');
