// EVERY ENGLISH PLACE NAME IN THE CATALOG IS A READABLE WORD (2026-10-24). The home headline's English facts
// read district names from src/data/sa-locations.json (data/locations.ts districtNameEnOfficial); one row said
// «Al Ghtght Dist.» — vowels lost — and a live fact read "…with the most in Al Ghtght". Aqar's own English
// page for حي الغطغط (sa.aqar.fm/en/…/al-muzahimiyah/al-ghatghat) spells it «Al GhatGhat»; the row is now «Al Ghatghat Dist.».
// A Latin word of 4+ letters with no vowel (a e i o u y) is a broken transliteration, never a name.
//   node --experimental-strip-types scripts/verify-catalog-english-names-are-words.ts   (in `npm test`)
import { readFileSync } from 'node:fs';

type Catalog = { regions: [number, string, string][]; cities: [number, number, string, string][]; districts: [number, number, string, string][] };
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, problems: string[]) => check(`(mutation) catches ${label}`, problems.length > 0);

/** Every English name in the catalog with a vowelless Latin word in it. */
export function unreadableNames(c: Catalog): string[] {
  const names = [...c.regions.map((r) => r[1]), ...c.cities.map((r) => r[2]), ...c.districts.map((r) => r[2])];
  return names.filter((n) => (n.match(/[A-Za-z]+/g) ?? []).some((w) => w.length >= 4 && !/[aeiouy]/i.test(w)));
}

const raw = readFileSync(new URL('../src/data/sa-locations.json', import.meta.url), 'utf8');
const catalog = JSON.parse(raw) as Catalog;
const bad = unreadableNames(catalog);
check('every English region/city/district name in the catalog is a readable word', bad.length === 0, bad.slice(0, 10).join(', '));
check('حي الغطغط (Al Muzahimiyah) reads «Al Ghatghat Dist.»', catalog.districts.some((d) => d[3] === 'حي الغطغط' && d[2] === 'Al Ghatghat Dist.'));
// Mutation proof: the exact broken row must be caught.
mustCatch('«Al Ghtght Dist.»', unreadableNames(JSON.parse(raw.replace('"Al Ghatghat Dist."', '"Al Ghtght Dist."'))));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ catalog English names are readable words');
