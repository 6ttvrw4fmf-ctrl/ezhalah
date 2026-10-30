// ENGLISH CARDS ARE ENGLISH (owner 2026-10-29: «Everything must be translated to English»). Measured that day on the
// 3,578 district names in the served index: 2,044 came out letter by letter on English cards («Al Nhdh», «Mtar Al Mlk
// Khald Al Dwly»), 471 of them only because normAr's «حي» strip was written /^ال?حي/ and never matched a bare «حي»;
// deed sentences printed as «Al Jnadryh Bmdynh Al Ryad Msahh…»; plan codes kept Arabic letters; «.» and «0 m» showed
// as values; a raw «2026-07-16T13:09:02+03:00». EXECUTED, on the real files: translitPlace and freeTextEn on real
// names and real deed text, the card's blank-value and date rules, and the wiring that sends each through them.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
let fail = 0;
const check = (label: string, ok: boolean, detail = '') => { if (ok) console.log(`  PASS  ${label}`); else { fail++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); } };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const dir = mkdtempSync(join(tmpdir(), 'ezh-en-'));
const saUrl = pathToFileURL(join(root, 'src/data/sa-locations.json')).href;
async function load(translitSrc: string, freeSrc = read('src/lib/freeTextEn.ts')) {
  const n = Math.random().toString(36).slice(2);
  writeFileSync(join(dir, `tp-${n}.ts`), translitSrc.replace("import sa from '@/data/sa-locations.json';", `import sa from '${saUrl}' with { type: 'json' };`));
  writeFileSync(join(dir, `fte-${n}.ts`), freeSrc.replace("from './translitPlace';", `from './tp-${n}.ts';`));
  const tp = await import(pathToFileURL(join(dir, `tp-${n}.ts`)).href);
  const fte = await import(pathToFileURL(join(dir, `fte-${n}.ts`)).href);
  return { translitPlace: tp.translitPlace as (s: string) => string, freeTextEn: fte.freeTextEn as (s: string) => string };
}
const TP = read('src/lib/translitPlace.ts');
const { translitPlace, freeTextEn } = await load(TP);
const AR = /[؀-ۿ]/;

console.log('\nEnglish cards are English\n');
// 1. Place names, real ones from the served index (listing counts that day in brackets).
const NAMES: [string, string][] = [
  ['حي النهضة', 'Al Nahdah'],                                   // 4,341 — was «Al Nhdh» on a live card
  ['القدس', 'Al Quds'], ['غرناطة', translitPlace('حي غرناطة')],   // bare names = the catalog's «حي …»
  ['حي الشامية الجديد', 'New Ash Shamiyah'],                    // 741
  ['حي مطار الملك خالد الدولي', 'King Khalid International Airport'],
  ['حي جامعة الأميرة نورة', 'Princess Noura University'],
  ['شمال بريدة', 'North Buraidah'], ['الضاحية الخامس', 'Suburb 5'], ['حي الحادي عشر', 'District 11'],
  ['ضاحية هجر(الحي الخامس)', 'Hajr Suburb - District 5'], ['الرياض - النرجس', 'Riyadh - Al Narjis'],
  ['حي ظهرة نمار', 'Dhahrat Nimar'], ['حي اسكان قوى الامن العام', 'Public Security Housing'],
  ['المحاسن بالمبرز', 'Al Mahasin in Al Mubarraz'], ['شارع الشهيد عز الدين', 'Al Shahid Izz Al Din Street'],
  ['حي العليا', 'Al Olaya'], ['الرياض', 'Riyadh'], ['سدرة', 'Sidrah'],
  ['شارع علي بن حسن', 'Ali bin Hasan Street'],                  // live card read «Ali Ibn Hsn Al Shwytr»
];
for (const [ar, en] of NAMES) { const got = translitPlace(ar); check(`«${ar}» → «${en}»`, got === en, `got «${got}»`); }

// 2. Deed sentences, real ones.
const DEEDS: [string, string][] = [
  ['حي السلامة بمدينة جدة مساحة الوحدة من الأرض 29.68 متر وتختص من المنافع والأجزاء المشتركة بمساحة 61.19 متر',
    'As Salamah, Jeddah · Unit land area 29.68 m², plus 61.19 m² of shared areas'],
  ['حي البوادى بمدينة جدة .', 'Al Bawadi, Jeddah'],
  ['قطعة رقم 15 المخطط رقم 2566/أ الواقع في حي النرجس', 'Plot no. 15 plan no. 2566/A located in Al Narjis'],
  ['7489/ق/ب', '7489/Q/B'],
];
for (const [ar, en] of DEEDS) { const got = freeTextEn(ar); check(`deed «${ar.slice(0, 30)}…» reads «${en.slice(0, 40)}…»`, got === en, `got «${got}»`); }
check('no Arabic letter survives any of them', [...NAMES.map(([a]) => translitPlace(a)), ...DEEDS.map(([a]) => freeTextEn(a))].every((s) => !AR.test(s)));
check('English text passes through untouched', freeTextEn('Riyadh 12') === 'Riyadh 12' && translitPlace('Al Olaya') === 'Al Olaya');

// 3. The card: blank values hidden, dates readable, deed text through the sentence translator, labels translated.
const card = read('src/components/ResultCard.tsx');
const { isBlankAttrValue } = await liftSymbols('src/components/ResultCard.tsx', [{ header: 'export function isBlankAttrValue(' }], ['isBlankAttrValue']);
const blank = isBlankAttrValue as (l: string, v: string) => boolean;
check('«.», «-», «/» and a 0 m street width are blank; a real value is not',
  blank('Other obligations on the property', '.') && blank('x', ' - ') && blank('x', '/') && blank('Street width', '0')
  && blank('عرض الشارع', '0 م') && !blank('Street width', '15') && !blank('Plan number', '0') && !blank('Age', 'New'));
const cardWired = (src: string) =>
  /if \(ll === 'deed location'\) return freeTextEn\(v\);/.test(src)
  && /return freeTextEn\(englishCatalogText\(v\)\);/.test(src)
  && (src.match(/enText\(attrDisplayLabel\(/g) ?? []).length === 3
  && /r\.value && !isBlankAttrValue\(r\.label, r\.value\)\)/.test(src)
  && /const iso = \/\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)/.test(src) && src.includes('return `${iso[3]}/${iso[2]}/${iso[1]}`;');
check('the card sends deed text, unknown values and labels through the translators, hides blanks, reads dates', cardWired(card));
// Laid out left to right in English: the live card showed «Plan number A/2566» and «.Additional No» because the
// detail text was hard-wired rtl.
const ltrWired = (src: string) => !/style=\{card\.addl(?:Label|Value)\}/.test(src)
  && (src.match(/style=\{\[card\.addl(?:Label|Value), locale !== 'ar' && card\.ltr\]\}/g) ?? []).length === 6
  && /\n {2}ltr: \{ writingDirection: 'ltr' \},/.test(src);
check('card details read left to right in English (no mirrored «A/2566»)', ltrWired(card));
mustCatch('the details hard-wired right-to-left again', !ltrWired(card.replace("style={[card.addlValue, locale !== 'ar' && card.ltr]}", 'style={card.addlValue}')));
const preview = read('src/components/ListingPreview.tsx');
check('the ad page translates the street (never hides it) and its detail labels, and hides blanks',
  /const street = place\(String\(l\.street_name \?\? ''\)\.trim\(\)\);/.test(preview)
  && preview.includes("locale === 'en' ? freeTextEn(englishCatalogText(r.label)) : t(r.label)")
  && preview.includes('if (isBlankAttrValue(r.label, r.value)) continue;'));
const agent = read('src/app/agent.tsx');
const tabWired = (src: string) => src.includes("const tabTitle = (l: Listing) => (locale === 'en' ? listingLocationEn(l) : listingLocationAr(l));")
  && (src.match(/title: tabTitle\(l\)/g) ?? []).length === 2 && !src.includes('title: listingLocationAr(l)');
check('the in-app viewer tab names the place in English in the English UI (it showed «الجنادرية، الرياض»)', tabWired(agent));
mustCatch('the viewer tab back on the Arabic location', !tabWired(agent.replace('title: tabTitle(l), url: url ?? \'\' })', 'title: listingLocationAr(l), url: url ?? \'\' })')));
const home = read('src/app/index.tsx');
const noteCleared = (src: string) => /useEffect\(\(\) => \{\s*if \(locale === 'ar'\) return;\s*setLocMsg\(\(m\) => \(m === ARABIC_ONLY_MSG \? '' : m\)\);\s*setDistrictMsg\(\(m\) => \(m === ARABIC_ONLY_MSG \? '' : m\)\);\s*\}, \[locale\]\);/.test(src);
check('switching to English clears the Arabic-only note under the Filter fields', noteCleared(home));

// 4. Mutations — each rule is load-bearing.
{
  const old = await load(TP.replace('.replace(/^(?:ال)?حي\\s+/, \'\').replace(/^حى\\s+/, \'\')\n    .replace(/[أإآٱ]/g', '.replace(/^ال?حي\\s+/, \'\').replace(/^حى\\s+/, \'\')\n    .replace(/[أإآٱ]/g'));
  mustCatch('the old «حي» strip that missed every bare district name', old.translitPlace('القدس') !== 'Al Quds');
  const noWords = await load(TP.replace("if (HEAD[k] && !head) { head = HEAD[k]; words.shift(); continue; }", ''));
  mustCatch('dropping the head words («… Airport», «… University»)', noWords.translitPlace('حي مطار الملك خالد الدولي') !== 'King Khalid International Airport');
  const noPhrases = await load(TP, read('src/lib/freeTextEn.ts').replace(/\[new RegExp\(`مساحة الوحدة من ال\[أا\]رض[^\n]*\n/, ''));
  mustCatch('losing the deed phrases', noPhrases.freeTextEn(DEEDS[0][0]) !== DEEDS[0][1]);
  mustCatch('deed text back through the place-name reader', !cardWired(card.replace("if (ll === 'deed location') return freeTextEn(v);", '')));
  mustCatch('an unknown Arabic value printed raw again', !cardWired(card.replace('return freeTextEn(englishCatalogText(v));', 'return englishCatalogText(v);')));
  mustCatch('the note left standing after a language switch', !noteCleared(home.replace("if (locale === 'ar') return;", "if (locale === 'en') return;")));
}

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ english-cards-are-english: names, deed text, codes, blanks and dates all read as English');
