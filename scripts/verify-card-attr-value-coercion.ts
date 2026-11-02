// Regression guard (Search & Matching QA run, 2026-08-18).
//
// THE BUG THIS EXISTS TO PREVENT — a BLANK WHITE PAGE in production.
//
// `additional_info` is a source-scraped JSON column. Its LEGACY array shape (Wasalt, Aqar Gate) is
// stored exactly as the platform published it, and Wasalt publishes NUMBERS for three keys:
//     {"key":"noOfParkings","label":"Number of Parkings","value":1}
//     {"key":"noOfFloors",  "label":"Total Floors",      "value":2}
//     {"key":"floorNumber", "label":"Property Floor",    "value":1}
// 2,977 production_ready rows carried one on the day this guard was written (80 of them with the
// numeric row inside the FIRST FOUR entries, i.e. rendered without any extra click).
//
// buildAdditionalInfo() passed that array through untouched, so the number reached ResultCard's
// arAttrValue(), whose first statement was `(value ?? '').trim()`. `(2).trim is not a function`
// threw an UNCAUGHT TypeError, React unmounted the whole tree, and the user got a blank page.
//
// Live-reproduced on https://ezhalah-app.vercel.app before the fix:
//   تجاري → المباني والمرافق → «مبنى تجاري» → الرياض → «بحث»
//   → the RPC returned 40 matches, all 40 raw cards were fetched (HTTP 200), and the page then had
//     ONE div and zero characters of text. Console: "(t ?? \"\").trim is not a function".
//
// The class this guards is NOT "numbers": it is "a source value reaches a string-only renderer".
// Both halves are asserted — the boundary coercion (root cause) and the render-site String()
// (defence in depth) — because either one alone lets the class back in through a new call site.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const REMOTE = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');
const CARD = readFileSync(new URL('../src/components/ResultCard.tsx', import.meta.url), 'utf8');

let failed = 0;
function check(name: string, ok: boolean, hint?: string) {
  if (ok) { console.log(`  ✓ ${name}`); return; }
  failed++;
  console.error(`  ✗ ${name}${hint ? `\n      ${hint}` : ''}`);
}

console.log('card-attr-value-coercion: a source-published non-string must never blank the app');

// ── 1. Root cause: buildAdditionalInfo's LEGACY ARRAY branch must normalise the row types ────────
const legacyBranch = /if \(Array\.isArray\(raw\)\) \{[\s\S]{0,2400}?\n  \}/.exec(REMOTE)?.[0] ?? '';
check('buildAdditionalInfo has an Array.isArray(raw) branch', legacyBranch.length > 0,
  'the legacy Wasalt/Aqar-Gate array shape is handled there — if it moved, re-point this guard');
check('the legacy array branch coerces value to a string',
  /value:\s*String\(\s*r\.value\s*\)/.test(legacyBranch),
  'a numeric value must become String(r.value) BEFORE it reaches the card renderer');
check('the legacy array branch coerces label to a string',
  /label:\s*String\(\s*r\.label\s*\)/.test(legacyBranch),
  'the label is fed to t() and to .trim().toLowerCase() — it must be a string too');
check('the legacy array branch no longer returns the raw source rows verbatim',
  !/const rows = raw\.filter\(\(r: any\) => r && r\.label && r\.value\);\s*\n\s*return rows\.length/.test(REMOTE),
  'the pre-fix shape — `.filter(...)` straight into `return rows` — is exactly what blanked the page');

// ── 2. Behaviour of the coercion contract, exercised on the real source values ────────────────────
// Replicates ONLY the mapping the guarded branch performs, over the three real Wasalt payloads, and
// proves the result is renderable (has .trim) while preserving the published value verbatim.
const SOURCE_ROWS: any[] = [
  { key: 'noOfParkings', label: 'Number of Parkings', value: 1 },
  { key: 'noOfFloors', label: 'Total Floors', value: 2 },
  { key: 'floorNumber', label: 'Property Floor', value: 1 },
  { key: 'propertyUsage', label: 'Property Usage', value: 'سكني' },
];
const mapped = SOURCE_ROWS
  .filter((r: any) => r && r.label && r.value)
  .map((r: any) => ({ key: String(r.key ?? r.label), label: String(r.label), value: String(r.value) }));
check('every mapped value is a string with a working .trim()',
  mapped.length === 4 && mapped.every((r) => typeof r.value === 'string' && typeof r.value.trim === 'function'));
check('the published value is preserved exactly (never re-formatted or dropped)',
  mapped[0].value === '1' && mapped[1].value === '2' && mapped[3].value === 'سكني');
check('a pre-fix renderer would have thrown on these same rows',
  (() => { try { (SOURCE_ROWS[1].value as any).trim(); return false; } catch { return true; } })(),
  'if this passes, the fixture no longer reproduces the original defect');

// ── 3. Defence in depth: the render site itself must not assume a string ─────────────────────────
const arAttr = /function arAttrValue\([\s\S]{0,400}?\n  const lv/.exec(CARD)?.[0] ?? '';
check('ResultCard.arAttrValue exists', arAttr.length > 0);
check('arAttrValue coerces its value argument before .trim()',
  /const v = String\(value \?\? ''\)\.trim\(\)/.test(arAttr),
  "`(value ?? '').trim()` is the exact line that threw in production");
check('arAttrValue coerces its label argument before .trim()',
  /const ll = String\(label \?\? ''\)\.trim\(\)\.toLowerCase\(\)/.test(arAttr));

// ── 4. No other card-attribute call site may re-introduce the unguarded pattern ──────────────────
// (?<!String) so the guarded `String(value ?? '').trim()` lines don't match themselves.
const unguarded = [...CARD.matchAll(/(?<!String)\((?:value|label|r\.value|r\.label) \?\? ''\)\.trim\(\)/g)];
check('no unguarded (value|label ?? \'\').trim() remains in ResultCard', unguarded.length === 0,
  `found ${unguarded.length}: every listing-sourced value must go through String() first`);

// Execute the actual English card formatter, including Arabic source enums and IDs.
const i18n = await liftSymbols('src/i18n.tsx', [
  { header: 'const AR:' }, { header: 'const EN:' },
  { header: 'export function englishCatalogText(' },
], ['englishCatalogText']);
const englishCatalogText = i18n.englishCatalogText as (text: string) => string;
const declarations = [
  { header: 'const AR_YESNO:', endsWith: /;$/ },
  { header: 'const FURNISH_VALUES_AR:' }, { header: 'const AR_ENUM:' },
  { header: 'export function arAttrValue(' },
];
const translitSource = readFileSync('src/lib/translitPlace.ts', 'utf8').replace(/export /g, '').replace("import sa from '@/data/sa-locations.json';", 'const sa = ' + readFileSync('src/data/sa-locations.json', 'utf8') + ';');
// arAttrValue's English fallback translates leftover Arabic through freeTextEn (owner 2026-10-29) — the real file.
const freeTextSource = readFileSync('src/lib/freeTextEn.ts', 'utf8').replace(/export /g, '').replace(/^import .*$/m, '');
const prelude = `${translitSource}\n${freeTextSource}\n
const englishCatalogText = ${englishCatalogText.toString()};
const AR = ${JSON.stringify((await liftSymbols('src/i18n.tsx', [{header:'const AR:'}], ['AR'])).AR)};
const EN = ${JSON.stringify((await liftSymbols('src/i18n.tsx', [{header:'const EN:'}], ['EN'])).EN)};
const FREE_TEXT_PROSE_LABELS = new Set();
const ATTRIBUTE_UNRESOLVED_AR = 'غير محدد';
const arabicOrPlaceholderForFreeText = (v: string) => v;
const translateTrailingPeriodWord = (v: string) => v;
`;
const formatters = await liftSymbols('src/components/ResultCard.tsx', declarations, ['arAttrValue'], prelude);
const format = formatters.arAttrValue as (label: string, value: string, locale: string) => string;
check('Arabic host name uses the existing English brand name', englishCatalogText('أحمد المحيسني العقارية') === 'Ahmed Almuhaysini');
for (const [label, value, expected] of [
  ['Furniture', 'غير مفروش', 'un furnished'], ['Facade', 'شرقية', 'east'],
  ['Property Usage', 'سكني', 'residential'], ['Age', 'جديد', 'New'],
  ['Electricity', 'نعم', 'Yes'], ['Facade', 'شرق', 'East'],
  ['Facade', 'جنوبية - غربية', 'South West'], ['Street width', '20 متر', '20 m'],
  ['Building age (years)', 'سنه', '1 year'], ['Building age (years)', 'اكثر من عشر سنوات', 'Over 10 years'], ['Age', '2 years', '2 years'],
  ['Street', 'حي الروضة', 'Al Rawdah'],
  ['Ad source', 'الهيئة العامة للعقار', 'Real Estate General Authority'],
  ['Other obligations on the property', 'لايوجد', 'None'],
  ['Other obligations on the property', 'لا يوجد', 'None'],
  ['Amenities', 'موقف', 'Parking'], ['Property services', 'الكهرباء، المياه، الصرف الصحي', 'Electricity, Water Supply, Sanitation'],
  // owner 2026-10-29 «everything must be translated to English»: a plan code's lone letters read as Latin letters
  ['Plan number', '7489/ق/ب', '7489/Q/B'], ['Plan number', '2566/أ', '2566/A'],
]) check(`English ${label}: ${value}`, format(label, value, 'en') === expected);
// Owner 2026-10-24: the English card showed Arabic deed labels and values (sanadak/therc/gathern). Every
// Arabic label the sources publish, and every closed value, must read as English on the English card.
for (const label of ['المنفعة وثيقة نوع / الملكية وثيقة نوع', 'مصدر ترخيص الاعلان', 'تاريخ ترخيص الاعلان', 'تاريخ انتهاء الصلاحية',
  'قنوات العقار', 'رقم البناية', 'الرمز البريدي', 'الرقم الإضافي', 'خدمات العقار', 'الإلتزامات على العقار', 'الضمانات ومدتها',
  'رقم القطعة', 'رقم المخطط', 'نوع الحد الشمالي', 'وصف الحد الجنوبي', 'طول الحد الشرقي', 'سعر بيع المتر', 'اجمالي سعر بيع الارض',
  'مطابقة كود البناء السعودي', 'مفروشة', 'وجود قيد ؟', 'وجود رهن ؟', 'استخدام العقار', 'الملاحظات', 'غرفة سائق', 'بركة سباحة',
  'اجمالي الايجار السنوي للأرض', 'عدد البلوكات']) {
  check(`English label: ${label}`, !/[ء-ي]/.test(englishCatalogText(label)));
}
for (const [label, value, expected] of [
  ['قنوات العقار', 'منصة مرخصة,الإذاعة,منصات التواصل الإجتماعي,أخرى', 'Licensed platform, Radio, Social media, Other'],
  ['خدمات العقار', 'كهرباء,مياه,صرف صحي', 'Electricity, Water Supply, Sanitation'],
  ['الإلتزامات على العقار', 'لأيوجد', 'None'],
  ['المنفعة وثيقة نوع / الملكية وثيقة نوع', 'صك إلكتروني', 'Electronic deed'],
  ['نوع الحد الشمالي', 'شارع', 'Street'],
  ['Price as published', '32,000 ر.س \n / yearly', '32,000 SAR / yearly'],
  ['Amenities', 'إضاءة إضافية, بروجكتر, ماستر', 'Extra lighting, Projector, Master bedroom'],
]) check(`English value ${label}: ${value}`, format(label, value, 'en') === expected);
check('Arabic source authority retained', format('Ad source', 'الهيئة العامة للعقار', 'ar') === 'الهيئة العامة للعقار');
check('Arabic explicit absence retained', format('Other obligations on the property', 'لايوجد', 'ar') === 'لايوجد');
check('Arabic enum rendering retained', format('Facade', 'east', 'ar') === 'شرقية');
for (const [, name] of readFileSync('src/lib/listingDisplay.ts', 'utf8').matchAll(/return '([^']*[ء-ي][^']*)'/g)) {
  check(`English platform name: ${name}`, !/[ء-ي]/.test(englishCatalogText(name)));
}
// Watch the original defect fail: removing the English branch must Arabicize English values again.
const mutantDir = mkdtempSync(join(tmpdir(), 'card-locale-mutant-'));
try {
  const mutantFile = join(mutantDir, 'card.tsx');
  const mutant = CARD.replace("if (locale === 'en') {", "if (locale === 'disabled') {");
  assert.notEqual(mutant, CARD);
  writeFileSync(mutantFile, mutant);
  const broken = (await liftSymbols(mutantFile, declarations, ['arAttrValue'], prelude)).arAttrValue as typeof format;
  function mustCatch() { assert.throws(() => assert.equal(broken('Age', '2 years', 'en'), '2 years'), assert.AssertionError); }
  mustCatch();
  check('MUTATION: removing English locale branch is caught', true);
  const i18nSource = readFileSync('src/i18n.tsx', 'utf8');
  const missingAuthority = i18nSource.replace("  'الهيئة العامة للعقار': 'Real Estate General Authority',", '');
  assert.notEqual(missingAuthority, i18nSource);
  const mutantCatalogFile = join(mutantDir, 'i18n.tsx');
  writeFileSync(mutantCatalogFile, missingAuthority);
  const brokenCatalog = (await liftSymbols(mutantCatalogFile, [
    { header: 'const AR:' }, { header: 'const EN:' }, { header: 'export function englishCatalogText(' },
  ], ['englishCatalogText'])).englishCatalogText as (text: string) => string;
  assert.throws(() => assert.equal(brokenCatalog('الهيئة العامة للعقار'), 'Real Estate General Authority'), assert.AssertionError);
  check('MUTATION: untranslated source authority is caught', true);

} finally { rmSync(mutantDir, {recursive: true, force: true}); }

check('both host-name render paths use English catalog lookup', (CARD.match(/name: locale === 'en' \? englishCatalogText\(sourceName\(listing.source\)\)/g) ?? []).length === 2);

if (failed > 0) {
  console.error(`\n❌ card-attr-value-coercion: ${failed} check(s) failed.`);
  console.error('   A source-published non-string reaching a string-only renderer is the blank-page class.');
  process.exit(1);
}
console.log('✅ card-attr-value-coercion: source values are string-normalised at the boundary and at the renderer.');
