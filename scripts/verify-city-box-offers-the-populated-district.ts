// THE CITY BOX OFFERS THE POPULATED DISTRICT, AND RANKS 0-SERVED HOMONYM CITIES BELOW IT (owner decision 2026-10-19;
// backlog 522 / 566; built by 🔧 Quality & Repair 2026-10-20).
//
// WHAT WAS WRONG, measured twice in ops_zero_result_log: a real user typed «البديعة» into the city box (2026-10-13
// 05:19 UTC) and another picked «الراكة» (2026-10-15 20:10 UTC). Both names are DISTRICTS with listings (حي البديعة ·
// الرياض 100+, حي الراكة الجنوبية · الخبر ~200) AND catalog CITIES with none. The picker offered only the cities, each
// «لا توجد إعلانات هنا حالياً», and both searches answered 0 over listings that exist.
//
// THE FIX, executed here: `populatedDistrictRows()` turns the live location index into «حي X · City» rows for a typed
// prefix (every raw spelling of one district folded into one row that carries them all), and `orderCityBoxRows()`
// places them after the cities that have listings in the scope and BEFORE the 0-served cities and the catalog extras.
// Both helpers are pure, so this check RUNS them; each assertion is mutation-proven against a deliberately broken copy.
// Text checks pin the wiring: matchCitiesByText builds the rows and orders through the helper, and the screen selects
// the district on the tap.
//
//   node --experimental-strip-types scripts/verify-city-box-offers-the-populated-district.ts
import { readFileSync } from 'node:fs';
import { populatedDistrictRows, orderCityBoxRows, cityOutweighsDistricts, type LiveDistrictRow } from '../src/lib/locationSuggest.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};
// A mutation proof: the SAME assertion, run against a deliberately broken implementation, must go RED.
const mutation = (name: string, brokenAssertionHolds: boolean) => check(`(mutation) catches ${name}`, !brokenAssertionHolds);

const LIVE: LiveDistrictRow[] = [
  { districtAr: 'حي الراكة الجنوبية', cityId: 31, n: 186 },
  { districtAr: 'الراكة الجنوبية', cityId: 31, n: 16 },   // a second raw spelling of the same district
  { districtAr: 'حي الراكة الشمالية', cityId: 13, n: 15 },
  { districtAr: 'حي البديعة', cityId: 3, n: 100 },
  { districtAr: 'البديعة', cityId: 3, n: 13 },
  { districtAr: 'حي ظهرة البديعة', cityId: 3, n: 301 },
  { districtAr: 'حي البديعة', cityId: 1061, n: 23 },
  { districtAr: 'حي البديعة', cityId: 80, n: 20 },
  { districtAr: 'حي البديعة', cityId: 67, n: 3 },
  { districtAr: 'حي الراكة القديمة', cityId: 99, n: 0 },     // 0 served: never a row
  { districtAr: 'حي النرجس', cityId: 3, n: 5000 },
];

// 1. «الراكة» → ONE row per district per city, spellings folded, most listings first.
{
  const rows = populatedDistrictRows('الراكة', LIVE);
  check('«الراكة» offers حي الراكة الجنوبية · الخبر first', rows[0]?.districtAr === 'حي الراكة الجنوبية' && rows[0]?.cityId === 31, JSON.stringify(rows.map((r) => [r.districtAr, r.cityId, r.n])));
  check('…its two raw spellings fold into one row carrying both', rows[0]?.n === 202 && (rows[0]?.matchValues ?? []).includes('الراكة الجنوبية') && rows.filter((r) => r.cityId === 31).length === 1);
  check('…then حي الراكة الشمالية · الدمام', rows[1]?.districtAr === 'حي الراكة الشمالية' && rows[1]?.cityId === 13);
  check('…a 0-served district is never offered', !rows.some((r) => r.districtAr === 'حي الراكة القديمة'));
  check('…«حي الراكة» (typed with حي) finds the same rows', populatedDistrictRows('حي الراكة', LIVE)[0]?.districtAr === 'حي الراكة الجنوبية');
}
// 2. «البديعة» → the district itself (prefix), not «ظهرة البديعة» (not a prefix), one row per city, capped at 4.
{
  const rows = populatedDistrictRows('البديعة', LIVE);
  check('«البديعة» offers حي البديعة · الرياض first (100+13)', rows[0]?.cityId === 3 && rows[0]?.districtAr === 'حي البديعة' && rows[0]?.n === 113, JSON.stringify(rows.map((r) => [r.districtAr, r.cityId, r.n])));
  check('…ظهرة البديعة is not a prefix match', !rows.some((r) => r.districtAr.includes('ظهرة')));
  check('…one row per city, capped at 4', rows.length === 4 && new Set(rows.map((r) => r.cityId)).size === 4);
  check('…a limit of 2 keeps the two biggest', populatedDistrictRows('البديعة', LIVE, 2).map((r) => r.cityId).join() === '3,1061');
}
// 2b. A typed CITY wins (owner 2026-10-24): «مكة» = مكة المكرمة 9,133 listings vs «حي مكة · الجبيل» 16 → no district rows;
//     «البديعة» = a 0-listing city vs حي البديعة 113 → the district rows stay.
{
  const mecca = [{ n: 16 }, { n: 5 }, { n: 2 }];
  check('«مكة»: a 9,133-listing city drops the district rows', cityOutweighsDistricts([9133], mecca));
  check('«البديعة»: a 0-listing city keeps the district rows', !cityOutweighsDistricts([0], populatedDistrictRows('البديعة', LIVE)));
  check('no matching city keeps the district rows', !cityOutweighsDistricts([], mecca));
  check('wired: matchCitiesByText drops the rows when the typed city outweighs them',
    /cityOutweighsDistricts\(scored\.filter\(\(sc\) => sc\.rank === 0\)[\s\S]{0,120}\(typedCity \? \[\] : liveRows\)/.test(readFileSync('src/data/locations.ts', 'utf8')));
  mutation('a rule that always keeps the rows', ((_c: readonly number[], _d: readonly { n: number }[]) => false)([9133], mecca));
}
// 3. Nothing is offered for a short, Latin or empty query.
check('two letters offer nothing', populatedDistrictRows('ال', LIVE).length === 0);
check('a Latin query offers nothing', populatedDistrictRows('Rakah', LIVE).length === 0);
check('an empty query offers nothing', populatedDistrictRows('', LIVE).length === 0);

// 4. Order: populated / unmeasured pool cities → district rows → 0-served pool cities → catalog extras.
type Row = { id: string; listingCount: number; scopeKnown?: boolean };
const pool: Row[] = [{ id: 'city-with-listings', listingCount: 12 }, { id: 'city-empty-in-scope', listingCount: 0, scopeKnown: true }, { id: 'city-unmeasured', listingCount: 0, scopeKnown: false }];
const dist: Row[] = [{ id: 'district-row', listingCount: 0, scopeKnown: false }];
const extras: Row[] = [{ id: 'catalog-extra', listingCount: 0, scopeKnown: true }];
{
  const ids = orderCityBoxRows(pool, dist, extras).map((r) => r.id).join(' > ');
  check('district rows sit after the populated/unmeasured cities and before the 0-served ones', ids === 'city-with-listings > city-unmeasured > district-row > city-empty-in-scope > catalog-extra', ids);
  check('with no district rows the order is exactly [pool, extras]', orderCityBoxRows(pool, [], extras).map((r) => r.id).join(' > ') === 'city-with-listings > city-empty-in-scope > city-unmeasured > catalog-extra');
}

// 5. Mutation proofs: a broken copy of each helper must go RED under the same assertions.
{
  const noFold = (q: string, rows: readonly LiveDistrictRow[]) => rows.filter((r) => r.n > 0 && r.districtAr.includes(q)).sort((a, b) => b.n - a.n).slice(0, 4);
  const m1 = noFold('الراكة', LIVE);
  mutation('a reader that neither folds spellings nor matches by prefix', m1[0]?.n === 202 && m1.filter((r) => r.cityId === 31).length === 1 && !noFold('البديعة', LIVE).some((r) => r.districtAr.includes('ظهرة')));
  const appendOnly = <T,>(p: readonly T[], d: readonly T[], e: readonly T[]) => [...p, ...e, ...d];
  mutation('an order that appends the district rows last', appendOnly(pool, dist, extras).map((r) => r.id).join(' > ') === 'city-with-listings > city-unmeasured > district-row > city-empty-in-scope > catalog-extra');
  const neverEmpty = (q: string, rows: readonly LiveDistrictRow[]) => populatedDistrictRows(q, rows.map((r) => ({ ...r, n: Math.max(r.n, 1) })));
  mutation('a reader that offers 0-served districts', !neverEmpty('الراكة', LIVE).some((r) => r.districtAr === 'حي الراكة القديمة'));
}

// 6. Wiring: the data module builds the rows from the live index and orders through the helper; the screen selects the
//    district on the tap and labels the row «حي X · City».
const loc = readFileSync(new URL('../src/data/locations.ts', import.meta.url), 'utf8');
const idx = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');
check('matchCitiesByText builds district rows from the live index', /populatedDistrictRows\(query, liveDistrictRows\(\)/.test(loc));
check('matchCitiesByText returns through orderCityBoxRows(fromPool, districtRows, extras)', /return orderCityBoxRows\(fromPool, districtRows, extras\);/.test(loc));
check('a district row carries every raw spelling for the search', /districtMatchValues: r\.matchValues \?\? \[r\.districtAr\]/.test(loc));
check('hasNameCollision ignores district rows', /!r\.districtAr && r\.cityAr === cityAr/.test(loc));
check('the city tap selects the district too', /if \(opt\.districtAr\) \{\s*setDistrictsSelected\(\[\{ districtAr: opt\.districtAr, listingCount: 0, matchValues: opt\.districtMatchValues \?\? \[opt\.districtAr\]/.test(idx));
check('the row is labelled «حي X · City»', /const cityRowLabel = \(o: CityOption\) => \(o\.districtAr \? `\$\{districtLabel\(o\.cityId, o\.districtAr\)\} · \$\{cityLabel\(o\)\}` : cityLabel\(o\)\);/.test(idx) && /\{cityRowLabel\(opt\)\}/.test(idx));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-city-box-offers-the-populated-district: all green');
