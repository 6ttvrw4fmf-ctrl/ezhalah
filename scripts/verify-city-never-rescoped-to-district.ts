// AN EXACT CITY STAYS THAT EXACT CITY — IT IS NEVER SILENTLY RE-SCOPED TO A NEIGHBOURHOOD.
//
// OWNER RULE (EXACT LOCATION ONLY): when the user names a city, Ezhalah searches THAT CITY. It must
// never quietly narrow the request to a district inside it, and an honest zero beats a wrong match.
//
// THE DEFECT THIS LOCKS OUT (found on production 2026-08-23, reproduced twice against DB truth):
// «أبي استراحة للبيع في مدينة أبها كاملة» returned a Search Summary reading «الحي: روابي أبها» and
// «ما فيه نتائج» — zero results, while the database held 15. «أبي شقة للبيع في مدينة أبها كاملة»
// showed 22 where 770 exist. The whole CITY of Abha had been re-scoped to one neighbourhood, with
// no way for the user to see it happen except one extra summary line.
//
// THE MECHANISM. src/data/locations.ts's liveDistrictLookup() decides "the typed location is JUST a
// city, so there is no district to look up" by SUBTRACTING the matched city's name from the district
// probe and checking nothing is left (`if (probe.length < 2) return []`). The subtraction used a
// plain String.replace() over flatLoc'd text — and flatLoc, unlike the norm() that built the search
// keys which matched the city in the first place, keeps أ/إ/آ, ة and ى distinct. The catalog spells
// Abha «ابها»; users and the AI agent write «أبها». Nothing was subtracted, the entire city name
// survived as a "district probe", word-matched the live district «روابي أبها» (44 listings), and
// resolveLocation() returned kind:'district'. A sweep of 9,770 real place names found 27 city
// spellings Kingdom-wide doing this — الرياض، الدمام، بريدة، الباحة، صامطة، الغزالة، نجران، … .
//
// THE FIX is cutPlaceName() in src/lib/arabicText.ts: the same subtraction, blind to those spelling
// variants, and length-preserving so it removes exactly the characters the source actually wrote
// (never a folded rewrite of them). This barrier asserts BOTH halves — the helper's real behavior,
// executed, and that liveDistrictLookup still routes its city subtraction through it with the guard
// still standing behind it. A source check alone would not have caught the original bug; a behavior
// check alone would not notice the call site being bypassed.
//
// Hermetic: no network, no DB. Wired into `npm test`.
//   node --experimental-strip-types scripts/verify-city-never-rescoped-to-district.ts

import { readFileSync } from 'node:fs';
import { cutPlaceName, foldArabicVariants } from '../src/lib/arabicText.ts';

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, detail: string) => { failed++; console.log(`  FAIL  ${name}\n        ${detail}`); };
const check = (name: string, cond: boolean, detail = '') => (cond ? ok(name) : bad(name, detail));

const locations = readFileSync(new URL('../src/data/locations.ts', import.meta.url), 'utf8');

console.log('\nAn exact city stays that exact city — never re-scoped to a neighbourhood\n');

// ─── 1. the real behavior: a city name subtracts to nothing, whatever way it is spelled ─────────
// Left = what the user / the AI agent typed. Right = how the catalog (or the live index) spells it.
// Every pair below is the SAME city; each must cancel out completely, or liveDistrictLookup goes on
// to treat the city's own name as a district probe. «أبها»/«ابها» is the reported defect itself.
console.log('1. a city name typed in any spelling subtracts to nothing');
const cityPairs: [string, string, string][] = [
  ['أبها', 'ابها', 'the reported defect — hamza on the alef'],
  ['ابها', 'أبها', 'and the mirror image (catalog hamza, user plain)'],
  ['الباحة', 'الباحه', 'ta marbuta typed as ha — extremely common'],
  ['بريده', 'بريدة', 'and the mirror image'],
  ['صامطه', 'صامطة', 'ta marbuta'],
  ['المزاحميه', 'المزاحمية', 'ta marbuta'],
  ['نجرأن', 'نجران', 'stray hamza mid-word'],
  ['الرياض', 'الرياض', 'identical spellings must still cancel'],
  ['abha', 'abha', 'the English key path must still cancel'],
];
for (const [typed, catalog, why] of cityPairs) {
  const left = cutPlaceName(typed, catalog);
  check(`«${typed}» − «${catalog}» → ""`, left === '',
    `left «${left}» (${left.length} chars) — a non-empty remainder is what becomes a district probe. ${why}`);
}

// ─── 2. …but a REAL district keeps its own name, and an unrelated city is never subtracted ──────
// The fix must not over-subtract: narrowing to a district the user actually named is the feature.
console.log('\n2. a real district still narrows, and unrelated names are left alone');
const keeps: [string, string, string, string][] = [
  ['روابيأبها', 'ابها', 'روابي', 'the district «روابي أبها» must still resolve inside Abha'],
  ['ابهاالجديدة', 'أبها', 'الجديدة', 'and «أبها الجديدة» too, across the spelling difference'],
  ['العليا', 'الرياض', 'العليا', 'a district that does not contain the city name is untouched'],
  ['الملقا', 'jeddah', 'الملقا', 'an unrelated city name subtracts nothing'],
  ['', 'ابها', '', 'an empty probe stays empty'],
  ['العليا', '', 'العليا', 'an empty city name subtracts nothing'],
];
for (const [probe, city, want, why] of keeps) {
  const got = cutPlaceName(probe, city);
  check(`«${probe}» − «${city}» → «${want}»`, got === want, `got «${got}» — ${why}`);
}

// ─── 3. length-preserving: we subtract, we never rewrite what the source published ──────────────
// foldArabicVariants exists ONLY to make the comparison spelling-blind. If it ever changed a
// string's LENGTH the slice arithmetic in cutPlaceName would cut at the wrong offset and silently
// corrupt a real district name — a listing-fidelity break, not just a bad match.
console.log('\n3. the folding is 1:1, so the subtraction can never corrupt the remainder');
for (const s of ['أبها', 'الباحة', 'مكة المكرمة', 'روابي أبها', 'Al Olaya', 'حي الملقا، الرياض', 'إآٱةىي']) {
  check(`foldArabicVariants keeps «${s}» the same length`, foldArabicVariants(s).length === s.length,
    `${s.length} → ${foldArabicVariants(s).length}`);
}
check('every folded letter class maps to exactly ONE character',
  [...'أإآٱةىي'].every((c) => foldArabicVariants(c).length === 1),
  'a multi-character replacement would desynchronise the fold-space index from the real one');
check('cutPlaceName returns characters of the ORIGINAL, never of the folded form',
  cutPlaceName('حيأبها', 'حي') === 'أبها',
  'the hamza the source wrote must survive the subtraction — never normalised away');

// ─── 4. the call site: liveDistrictLookup must still use it, and still guard behind it ──────────
console.log('\n4. the guard in src/data/locations.ts is still wired up');
const fn = locations.slice(locations.indexOf('function liveDistrictLookup'),
                           locations.indexOf('export function rawDistrictVariants'));
check('liveDistrictLookup() was found', fn.length > 0, 'the function was renamed or moved — re-point this barrier');
check('it subtracts the matched city through cutPlaceName',
  /probe\s*=\s*cutPlaceName\(cutPlaceName\(probe,\s*cityKey\),\s*cityKeyAr\)/.test(fn),
  'the English AND the Arabic city key must both be subtracted, fold-blind');
check('it never falls back to a spelling-blind String.replace for the city keys',
  !/probe\s*=\s*probe\.replace\(city(Key|KeyAr)/.test(fn) && !/probe\.replace\(cityKeyAr/.test(fn),
  'THIS IS THE ORIGINAL BUG — replace() cannot see «أبها» inside «ابها»');
const cutAt = fn.indexOf('cutPlaceName');
const guardAt = fn.indexOf('if (probe.length < 2) return [];');
check('the "input is just a city" guard still exists', guardAt >= 0,
  'without it a bare city name reaches the district matcher no matter how the probe was built');
check('the guard runs AFTER the subtraction', cutAt >= 0 && guardAt > cutAt,
  'a guard that tests the un-subtracted probe never fires');

console.log(failed === 0
  ? '\nPASS — a city stays a city.\n'
  : `\nFAIL — ${failed} check(s) failed. A named city can be silently re-scoped to a neighbourhood.\n`);
process.exit(failed === 0 ? 0 : 1);
