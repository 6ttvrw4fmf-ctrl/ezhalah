// Regression guard: an INVENTED city name must never be answered with an unrelated
// «هل تقصد …؟» suggestion.  (live-proven on production, 2026-08-23)
//
// The bug: typing «أبي شقة في مدينة زقنبوطية الشمالية» into the AI agent returned
// «ما لقينا إعلانات في "مدينة زقنبوطية الشمالية". هل تقصد مكة المكرمة؟» — a city with no
// relationship whatsoever to the typed text.
//
// Root cause — a LYING sentinel in editDistance() (src/data/locations.ts). It short-circuits on a
// large length gap and used to `return 3` there, i.e. it reported an unrelated pair as being three
// edits apart. nearbyCityWithListings() scales its budget with the query length and allows
// maxD = 3 for anything over 7 folded characters, so the sentinel PASSED the `bestEd > maxD`
// gate: every live city sharing the query's first folded letter scored exactly 3, and the
// `lc.n > best.n` tie-break then handed back the largest-inventory one (مكة المكرمة for «م»,
// بريدة for «ب», …). Short invented names escaped only because their budget happened to be 2.
//
// The fix: the short-circuit returns Math.max(m, n) — a truthful upper bound on a distance that is
// already ≥ |m − n| ≥ 3 — so it can never be mistaken for a real 3. Genuine typo correction
// («القرص»→الرس, «khubar»→Khobar) is untouched: those pairs differ in length by ≤ 1 and never hit
// the short-circuit at all.
//
// Owner rule this protects: EXACT LOCATION ONLY — never guess a location; an honest zero (the
// plain «ما فيه نتائج… تبيني أوسّع البحث؟») beats a wrong match.
//
// This barrier runs the REAL functions, lifted verbatim out of src/data/locations.ts (LIVE_CITIES
// and cityKeys() are module-private, so they are stubbed with a small realistic index).
//
//   node --experimental-strip-types scripts/verify-no-invented-city-suggestion.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const src = readFileSync(new URL('../src/data/locations.ts', import.meta.url), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// ── lift the real implementation out of the source ────────────────────────────────────────────
const grab = (re: RegExp, what: string): string => {
  const m = src.match(re);
  if (!m) { console.error(`FAIL  could not lift ${what}() out of src/data/locations.ts — did it move or get renamed?`); process.exit(1); }
  return m[0];
};
const normSrc = grab(/const norm = \(s: string\) =>[\s\S]*?\n {4}\.replace\(\/\[\^\\p\{L\}\\p\{N\}\]\/gu, ''\);/, 'norm');
const foldSrc = grab(/const fuzzyFold = \(s: string\) =>\n[\s\S]*?;\n/, 'fuzzyFold');
const edSrc = grab(/function editDistance\(a: string, b: string\): number \{[\s\S]*?\n\}/, 'editDistance');
const nearSrc = grab(/export function nearbyCityWithListings\([\s\S]*?\n\}/, 'nearbyCityWithListings');

type LiveCity = { city: string; region: string; n: number };
type CityKey = { key: string; fold: string; city: string };
type Nearby = (raw: string, exclude?: string) => { cityEn: string; region: string; n: number } | null;

const lifted = stripTypeScriptTypes(
  `type CityKey = { key: string; fold: string; city: string };
type LiveCity = { city: string; region: string; n: number };
declare const LIVE_CITIES: LiveCity[];
declare function cityKeys(): CityKey[];
declare function regionForCity(c: string): string;
${normSrc}
${foldSrc}
${edSrc}
${nearSrc.replace(/^export /, '')}
`,
  { mode: 'strip' },
).replace(/^\s*(type |declare ).*$/gm, '');

// A small but realistic live index: the cities the production repro actually collided with.
const LIVE: LiveCity[] = [
  { city: 'Makkah', region: 'Makkah', n: 14000 },
  { city: 'Madinah', region: 'Madinah', n: 5000 },
  { city: 'Buraydah', region: 'Qassim', n: 8000 },
  { city: 'Jeddah', region: 'Makkah', n: 30000 },
  { city: 'Riyadh', region: 'Riyadh', n: 90000 },
  { city: 'Ar Rass', region: 'Qassim', n: 213 },
  { city: 'Al Khobar', region: 'Eastern Province', n: 4000 },
];
// Same shape cityKeys() builds — spelling variants keyed to the canonical English city.
const NAMES: [string, string][] = [
  ['مكة المكرمة', 'Makkah'], ['Makkah', 'Makkah'],
  ['المدينة المنورة', 'Madinah'], ['Madinah', 'Madinah'],
  ['بريدة', 'Buraydah'], ['Buraydah', 'Buraydah'],
  ['جدة', 'Jeddah'], ['Jeddah', 'Jeddah'],
  ['الرياض', 'Riyadh'], ['Riyadh', 'Riyadh'],
  ['الرس', 'Ar Rass'], ['Ar Rass', 'Ar Rass'],
  ['الخبر', 'Al Khobar'], ['Al Khobar', 'Al Khobar'], ['khobar', 'Al Khobar'],
];
const norm = (s: string) => s.toLowerCase().replace(/[ً-ٟ]/g, '').replace(/ـ/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه')
  .replace(/[ىي]/g, 'ي').replace(/[^\p{L}\p{N}]/gu, '');
const fold = (s: string) => norm(s).replace(/[صث]/g, 'س')
  .replace(/[ضظذ]/g, 'ز').replace(/ط/g, 'ت');
const KEYS: CityKey[] = NAMES.map(([n, c]) => ({ key: norm(n), fold: fold(n), city: c }));

const nearbyCityWithListings = new Function(
  'LIVE_CITIES', 'cityKeys', 'regionForCity',
  `${lifted}\nreturn nearbyCityWithListings;`,
)(LIVE, () => KEYS, (c: string) => LIVE.find((v) => v.city === c)?.region ?? '') as Nearby;

// ── 1. invented places get NO suggestion (the defect) ─────────────────────────────────────────
// Every one of these is long enough (> 7 folded chars) to earn the maxD = 3 budget, and every one
// shares its first folded letter with a big live city — exactly the shape the sentinel let through.
const INVENTED = [
  'مدينة زقنبوطية الشمالية', // → used to return مكة المكرمة (the production repro)
  'زقنبوطية الشمالية',
  'بلدة كركوبان',            // → used to return بريدة
  'جججججججج',                 // → used to return جدة
  'مقلوبستان الكبرى',
  'الرقمطوش الجنوبي',
];
for (const q of INVENTED) {
  const got = nearbyCityWithListings(q);
  check(`invented «${q}» gets NO city suggestion (got ${got ? got.cityEn : 'null'})`, got === null);
}

// ── 2. genuine near-miss typo correction still works (the fix must not blunt it) ──────────────
const TYPOS: [string, string][] = [
  ['القرص', 'Ar Rass'],   // the case nearbyCityWithListings exists for (ed = 1)
  ['khubar', 'Al Khobar'],
  ['riydah', 'Riyadh'],
  ['جدةةة', 'Jeddah'],
];
for (const [q, want] of TYPOS) {
  const got = nearbyCityWithListings(q);
  check(`near-miss «${q}» still suggests ${want} (got ${got ? got.cityEn : 'null'})`, got?.cityEn === want);
}

// ── 3. the primitive itself never under-reports a distance ────────────────────────────────────
// Guards the fix at its source: whatever the length-gap short-circuit returns must exceed the
// largest budget any caller uses (3), or the sentinel becomes a fake "did you mean" again.
check('editDistance() length-gap short-circuit does NOT return the literal 3',
  !/if \(Math\.abs\(m - n\) > 2\) return 3;/.test(edSrc));
check('editDistance() length-gap short-circuit returns a value that grows with the inputs',
  /if \(Math\.abs\(m - n\) > 2\) return Math\.max\(m, n\);/.test(edSrc));

if (failed) {
  console.error(`\n${failed} check(s) FAILED — an invented place name can be answered with a real city again.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
