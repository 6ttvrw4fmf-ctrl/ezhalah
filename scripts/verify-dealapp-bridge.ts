// Permanent tests for the dealapp English-district bridge (owner mandate, 2026-07-27):
// exact official-name matching, transliteration variance, city scoping, duplicate-name districts,
// ambiguous-match rejection, junk rejection, and idempotent bridge updates. Runs offline against
// the official dataset (src/data/sa-locations.json) + the applied phase-2 migration file.
//   node --experimental-strip-types scripts/verify-dealapp-bridge.ts   (wired into `npm test`)
import { readFileSync } from 'node:fs';
import { normEn, skel, JUNK, matchInCity } from './lib-dealapp-bridge.ts';

const sa = JSON.parse(readFileSync(new URL('../src/data/sa-locations.json', import.meta.url), 'utf8'));
const D: Array<[number, number, string, string]> = sa.districts;

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// 1) Exact official-name matching — the applied tier-1 shape: dealapp form == official name.
check('exact: normEn equates the form and the official name ("Al Hajlah Dist.")',
  normEn('Al Hajlah Dist.') === normEn('Al Hajlah Dist.') && matchInCity(D, 6, 'Al Hajlah Dist.') === 'حي الهجلة');
check('exact: article-prefix variants still exact ("AL-AGHAR" == "Al Aghar Dist.")',
  normEn('AL-AGHAR') === normEn('Al Aghar Dist.') && matchInCity(D, 2800, 'AL-AGHAR') === 'حي الأغر');

// 2) Transliteration variance — the applied tier-2 pairs must keep matching through the skeleton.
check("variance: Al Ju'ranah ↔ Jaranah Dist. (مكة)", matchInCity(D, 6, "Al Ju'ranah") === 'حي جعرانة');
check('variance: Al-dHRAFAH ↔ Al Dhurfah Dist. (خميس)', matchInCity(D, 62, 'Al-dHRAFAH') === 'حي الظرفة');
check('variance: ALOMARAH + almaamorah both ↔ Al Mamurah Dist.',
  matchInCity(D, 62, 'ALOMARAH') === 'حي المعمورة' && matchInCity(D, 62, 'almaamorah') === 'حي المعمورة');
check('variance: al-waffa ↔ Al Wafa Dist.', matchInCity(D, 62, 'al-waffa') === 'حي الوفاء');

// 3) City scoping — the same form NEVER matches through another city's catalog.
check('city-scope: Talah Dist. matches in KAEC (3666) but NOT in مكة (6)',
  matchInCity(D, 3666, 'Talah Dist.') === 'حي التالة' && matchInCity(D, 6, 'Talah Dist.') === null);
check('city-scope: Al Hajlah Dist. does not leak into خميس مشيط (62)',
  matchInCity(D, 62, 'Al Hajlah Dist.') === null);

// 4) Duplicate-name districts — dataset rows may duplicate the SAME district (shkar case, city 62):
// one distinct Arabic → accepted; two DISTINCT Arabic districts sharing a skeleton → rejected.
const shkarRows = D.filter((d) => d[0] === 62 && skel(d[2]) === skel('shkar'));
check('duplicate-name: shkar rows in city 62 collapse to ONE distinct Arabic (حي شكر)',
  shkarRows.length >= 2 && matchInCity(D, 62, 'shkar') === 'حي شكر');
const synth: Array<[number, number, string, string]> = [
  [999, 1, 'Al Nasim Dist.', 'حي النسيم'], [999, 1, 'Al Nassim Dist.', 'حي النسيم الغربي'],
];
check('duplicate-name: two DISTINCT districts sharing a skeleton in one city → rejected (null)',
  matchInCity(synth, 999, 'alnaseem') === null);

// 5) Ambiguous-match rejection is structural: >1 distinct Arabic candidates → null (same gate).
check('ambiguous: gate returns null rather than picking between candidates',
  matchInCity(synth, 999, 'al-nasim') === null);

// 6) Junk rejection — plans/zones/institutions never nominate, even if something would match.
for (const j of ['PLAN 6', 'Subdivision Plan B', 'industrial zone', 'Najran University', 'Atood plan'])
  check(`junk: "${j}" rejected`, JUNK.test(j) && matchInCity(D, 62, j) === null);

// 7) Idempotent bridge updates — the applied migration inserts on the (district_en, district_ar) PK
// with DO NOTHING (re-run = no-op) and never UPDATEs (an existing Arabic mapping is never overwritten).
const MIG = readFileSync(new URL('../supabase/migrations/20260727112253_dealapp_bridge_phase2_49_official_pairs.sql', import.meta.url), 'utf8');
check('idempotency: migration conflicts on (district_en, district_ar) with DO NOTHING',
  /on conflict \(district_en, district_ar\) do nothing/.test(MIG));
check('idempotency: migration never overwrites (no DO UPDATE / UPDATE statements)',
  !/do update|update\s+public\./i.test(MIG));
check('idempotency: migration carries exactly the 49 approved pairs',
  (MIG.match(/^\s{2}\('/gm) ?? []).length === 49);

if (failed) { console.error(`\n✗ ${failed} dealapp-bridge assertion(s) FAILED`); process.exit(1); }
console.log('\n✓ all dealapp-bridge assertions passed (exact, variance, city-scope, duplicates, ambiguity, junk, idempotency)');
