// Static invariant checks for COUNT-SCOPE PARITY (findings 2026-08-13, R1): the number/ranking
// beside a city or district must be computed at the SAME category scope the results RPC will
// actually search. A category-less search implies 'Residential' (remote.ts impliedCategory), so
// every pool call threads `effCategory = query.category ?? IMPLIED_CATEGORY_DEFAULT` — imported
// from remote.ts, ONE literal, never duplicated — and every pool cache key includes it. Before
// this, pools counted ALL categories: district counts overstated up to 86% (قصر بن عقيل 37 shown,
// 5 returned), and commercial-only districts presented as alive yet searched to 0.
//
//   node --experimental-strip-types scripts/verify-count-scope-parity.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexSrc = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
const locSrc = readFileSync(join(root, 'src/data/locations.ts'), 'utf8');
const remoteSrc = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── ONE source for the implied default — remote.ts owns it, everyone imports it. ──
check("remote.ts exports IMPLIED_CATEGORY_DEFAULT ('Residential', as const)", /export const IMPLIED_CATEGORY_DEFAULT = 'Residential' as const;/.test(remoteSrc));
check('impliedCategory() itself uses the shared constant (no second literal)', /return effectiveCleanQuery\(q\) \? null : IMPLIED_CATEGORY_DEFAULT;/.test(remoteSrc));
check('index.tsx imports it from remote.ts', /import \{ fetchDistrictEligibleCounts, IMPLIED_CATEGORY_DEFAULT \} from '@\/data\/remote'/.test(indexSrc));
check('effCategory = query.category ?? IMPLIED_CATEGORY_DEFAULT (the one derivation)', /const effCategory: Category = query\.category \?\? IMPLIED_CATEGORY_DEFAULT;/.test(indexSrc));
check("index.tsx never re-duplicates the literal ('Residential' appears in no pool wiring)", !/\?\? 'Residential'/.test(indexSrc));

// ── EVERY pool call in index.tsx passes effCategory — none is left at the old raw/null scope. ──
const poolCalls: Array<[string, RegExp, RegExp]> = [
  ['ensureCityFieldIndex', /ensureCityFieldIndex\(query\.deal, paymentMonthly, effCategory\)/g, /ensureCityFieldIndex\(query\.deal, paymentMonthly\)[^,]/g],
  ['topCitiesByListings', /topCitiesByListings\(query\.deal, paymentMonthly, effCategory, 6\)/g, /topCitiesByListings\(query\.deal, paymentMonthly, 6\)/g],
  ['matchCitiesByText', /matchCitiesByText\(query\.deal, paymentMonthly, effCategory, /g, /matchCitiesByText\(query\.deal, paymentMonthly, [^e]/g],
  ['ensureDistrictOptions', /ensureDistrictOptions\(cid, query\.deal, effCategory, paymentMonthly\)/g, /ensureDistrictOptions\([^)]*query\.category/g],
  ['topDistrictsForCityId', /topDistrictsForCityId\((?:cid|citySelected\.cityId), query\.deal, effCategory, paymentMonthly, 6\)/g, /topDistrictsForCityId\([^)]*query\.category/g],
  ['matchDistrictsByCityId', /matchDistrictsByCityId\((?:cid|citySelected\.cityId), query\.deal, effCategory, paymentMonthly, /g, /matchDistrictsByCityId\([^)]*query\.category/g],
];
for (const [name, good, bad] of poolCalls) {
  const goodCount = (indexSrc.match(good) || []).length;
  const badCount = (indexSrc.match(bad) || []).length;
  check(`${name}: every call passes effCategory (${goodCount} scoped, ${badCount} unscoped)`, goodCount > 0 && badCount === 0);
}

// ── Cache keys include the effective category — a category flip can never serve the other scope's
//    counts from cache. ──
check('city pool cache key includes category', /const cityPoolKey = \(deal: Deal, paymentMonthly: boolean \| null, category: Category \| null\) => `\$\{deal\}:\$\{pmKey\(paymentMonthly\)\}:\$\{category \?\? ''\}`/.test(locSrc));
check('district cache key includes category (pre-existing, pinned)', /const districtCacheKey = \(cityId: number, deal: Deal, category: Category \| null, paymentMonthly: boolean \| null\) => `\$\{cityId\}:\$\{deal\}:\$\{category \?\? ''\}:\$\{pmKey\(paymentMonthly\)\}`/.test(locSrc));

// ── The city RPC is called WITH the named p_category arg, plus a compat fallback that drops it on
//    an older signature (the p_category migration is landing separately — see the TODO). ──
check('top_cities_by_deal_ar receives named p_category', /if \(category !== null\) args\.p_category = category;/.test(locSrc));
check('compat fallback retries without p_category on RPC error (TODO pins the pending migration)', /TODO\(pending migration[\s\S]{0,400}?const \{ p_category: _dropped, \.\.\.noCat \} = args;\s*res = await supabase\.rpc\('top_cities_by_deal_ar', noCat\)/.test(locSrc));
check('district_options_ar keeps its p_category (pre-existing, pinned)', /rpc\('district_options_ar', args\)/.test(locSrc) && /p_city_id: cityId, p_deal: dealAr\(deal\), p_category: category/.test(locSrc));

// ── Downstream consumers follow automatically — nothing may re-assume the OLD all-categories
//    scope: the PR#384 zero-mark and the Top-6 slice both read listingCount straight off the pool
//    rows (no second category filter, no cross-scope mixing). ──
check('Top-6 slice reads the (now correctly scoped) pool counts directly', /\.filter\(\(d\) => d\.listingCount > 0\)\.slice\(0, k\)/.test(locSrc));
check('zero-mark reads the same rows (live full-filter count still wins when present)', /const isEmpty = live != null \? live === 0 : opt\.listingCount === 0/.test(indexSrc));

console.log(failed === 0 ? '\n✓ all count-scope-parity assertions passed' : `\n✗ ${failed} count-scope-parity assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
