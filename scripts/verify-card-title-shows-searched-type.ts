// THE CARD HEADLINE NAMES THE TYPE THE USER SEARCHED (owner 2026-11-03: «when you display the ad you must show the thing the
// user selected on the property type»). The headline («… للبيع / للإيجار») speaks the filter type the ad was found by
// (listing.cleanType → its Arabic label); the source's own wording stays in the type row and the «Property Type» stat
// (owner 2026-07-06 source-accurate rule). Measured before: a «أرض تجارية» search showed «أرض سكني تجاري للبيع».
//
// Two halves, both able to fail:
//   1. DATA — every clean type a user can pick has an Arabic label, so the headline can never fall back silently to the raw
//      source word for a type the user did pick (EXECUTED over ALL_CLEAN_TYPES against the real dictionary).
//   2. WIRING — both headline lines use searchedTypeLabel, and the type row + stat keep the source typeLabel.
//   node --experimental-strip-types scripts/verify-card-title-shows-searched-type.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_CLEAN_TYPES, SERVICE_FACILITY_TYPES } from '../src/data/propertyTypes.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed++;
};
const i18n = readFileSync(join(ROOT, 'src/i18n.tsx'), 'utf8');
const ar = (key: string) => {
  const m = i18n.match(new RegExp(`\\n\\s*'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'([^']*)'`));
  return m ? m[1] : null;
};
// The facility sub-types (SERVICE_FACILITY_TYPES) are never picked one by one — the «مرافق خدمية» box gathers them — so
// their headline keeps the source word by design (arabicOrPlaceholder falls back to typeLabel).
const PICKABLE = ALL_CLEAN_TYPES.filter((t) => !(SERVICE_FACILITY_TYPES as readonly string[]).includes(t));
const missing = PICKABLE.filter((t) => !ar(t) || !/[\u0600-\u06FF]/.test(ar(t)!));
check(`every pickable clean type (${PICKABLE.length}) has an Arabic headline label`, missing.length === 0, `missing: ${missing.join(', ')}`);
check('the clean-type list is non-trivial (the check above can bite)', ALL_CLEAN_TYPES.length >= 20);
check('Commercial Land reads «أرض تجارية» (the measured case)', ar('Commercial Land') === 'أرض تجارية', String(ar('Commercial Land')));

const card = readFileSync(join(ROOT, 'src/components/ResultCard.tsx'), 'utf8');
check('searchedTypeLabel comes from the one shared helper', /const searchedTypeLabel = locale === 'en' \? typeLabel : listingSearchedTypeAr\(listing\);/.test(card));
const preview = readFileSync(join(ROOT, 'src/components/ListingPreview.tsx'), 'utf8');
check('the ad page top line names the searched type and shows the source word when it differs',
  /testID="listing-preview-searched-type">\{locale === 'ar' \? listingSearchedTypeAr\(l\) : typeLabel\}/.test(preview) && /testID="listing-preview-source-type">\(\{typeLabel\}\)/.test(preview));
const aloud = readFileSync(join(ROOT, 'src/lib/readAloudScript.ts'), 'utf8');
check('read-aloud says the searched type', /const headline = `\$\{listingSearchedTypeAr\(listing\)\} في/.test(aloud));
check('the laptop photo strip headline uses searchedTypeLabel', /<Text style=\{card\.lpPhotoFootTx\}>\{searchedTypeLabel\} \{t\(listing\.deal/.test(card));
check('the compact card headline uses searchedTypeLabel', /<Text style=\{card\.typeLabel\}>\{searchedTypeLabel\} \{t\(listing\.deal/.test(card));
check('the type row still shows the source wording (typeLabel)', /<Text style=\{card\.lpTypeTx\} numberOfLines=\{1\}>\{typeLabel\}<\/Text>/.test(card));
check('the «Property Type» stat still shows the source wording (typeLabel)', /<Stat icon="business-outline" big=\{typeLabel\}/.test(card));

// EXECUTED against the REAL helper bodies (liftSymbols — listingDisplay.ts imports through the @/ alias Node cannot resolve);
// the prelude hands them the real Arabic dictionary, the real facility list and the real placeholder.
const { liftSymbols } = await import('./lib/liftSymbols.ts');
const AR_DICT = (await liftSymbols('src/i18n.tsx', [{ header: 'const AR:' }], ['AR'])).AR as Record<string, string>;
const prelude = `type Listing = any;
const AR = ${JSON.stringify(AR_DICT)};
const translate = (_l: string, k: string) => AR[k] ?? k;
const arabicOrPlaceholder = (text: string, locale: string, ph: string) => (!text ? text : locale !== 'ar' ? text : /[\u0600-\u06FF]/.test(text) ? text : ph);
const SERVICE_FACILITY_TYPES = ${JSON.stringify(SERVICE_FACILITY_TYPES)};
const TYPE_UNRESOLVED_AR = '—';`;
const lifted = await liftSymbols('src/lib/listingDisplay.ts', [{ header: 'export function listingTypeAr(' }, { header: 'export function listingSearchedTypeAr(' }], ['listingTypeAr', 'listingSearchedTypeAr'], prelude);
const listingSearchedTypeAr = lifted.listingSearchedTypeAr as (l: never) => string;
const listingTypeAr = lifted.listingTypeAr as (l: never) => string;
const stub = (type: string, cleanType?: string) => ({ type, cleanType } as never);
check('EXECUTED: «أرض سكني تجاري» found as Commercial Land → headline «أرض تجارية», source word kept by listingTypeAr',
  listingSearchedTypeAr(stub('أرض سكني تجاري', 'Commercial Land')) === 'أرض تجارية' && listingTypeAr(stub('أرض سكني تجاري', 'Commercial Land')) === 'أرض سكني تجاري');
check('EXECUTED: a facility sub-type (Bank) keeps the source word', listingSearchedTypeAr(stub('فرع بنك', 'Bank')) === 'فرع بنك');
check('EXECUTED: no cleanType → the source word', listingSearchedTypeAr(stub('شقة')) === 'شقة');

// MUTATION PROOFS — the real helper body, broken one way at a time in a temp copy, must FAIL the executed checks above.
const { readFileSync: rf, writeFileSync: wf, mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const DISPLAY_SRC = rf(join(ROOT, 'src/lib/listingDisplay.ts'), 'utf8');
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught);
async function mutantHelper(from: string, to: string) {
  if (!DISPLAY_SRC.includes(from)) throw new Error(`mutation anchor missing: ${from.slice(0, 60)}`);
  const f = join(mkdtempSync(join(tmpdir(), 'card-type-')), 'listingDisplay.ts');
  wf(f, DISPLAY_SRC.replace(from, to));
  const l = await liftSymbols(f, [{ header: 'export function listingTypeAr(' }, { header: 'export function listingSearchedTypeAr(' }], ['listingSearchedTypeAr'], prelude);
  return l.listingSearchedTypeAr as (x: never) => string;
}
const keepsSourceWord = await mutantHelper("  const ct = listing.cleanType;\n", "  const ct = undefined as string | undefined; void listing.cleanType;\n");
mustCatch('a headline that keeps the source word («أرض سكني تجاري» instead of «أرض تجارية»)',
  keepsSourceWord(stub('أرض سكني تجاري', 'Commercial Land')) !== 'أرض تجارية');
const noFacilityGuard = await mutantHelper("if (ct && !(SERVICE_FACILITY_TYPES as readonly string[]).includes(ct)) {", "if (ct) {");
mustCatch('a facility sub-type losing its source word (the «مرافق خدمية» rule)',
  noFacilityGuard(stub('فرع بنك', 'Bank')) !== 'فرع بنك');

console.log(failed === 0 ? '\n✅ the card headline names the searched type; the source wording stays on the card.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
