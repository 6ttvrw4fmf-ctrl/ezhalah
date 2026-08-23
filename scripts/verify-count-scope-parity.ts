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
// Assert the INTENT — the shared constant is imported from remote.ts — not the exact import list.
// Pinning the whole line made this fail for an unrelated import change (2026-08-22: Trending moved to
// rpcAllNarrowingParams), which is noise, not a parity violation.
check('index.tsx imports it from remote.ts',
  /import \{[^}]*\bIMPLIED_CATEGORY_DEFAULT\b[^}]*\} from '@\/data\/remote'/.test(indexSrc));
check('effCategory = query.category ?? IMPLIED_CATEGORY_DEFAULT (the one derivation)', /const effCategory: Category = query\.category \?\? IMPLIED_CATEGORY_DEFAULT;/.test(indexSrc));
check("index.tsx never re-duplicates the literal ('Residential' appears in no pool wiring)", !/\?\? 'Residential'/.test(indexSrc));

// ── EVERY pool call in index.tsx passes effCategory — none is left at the old raw/null scope. ──
// (paymentMonthly boolean was renamed rentPeriodTok string 2026-08-19 — owner mixed-period feature,
// Trending now sends the same 'شهري'/'سنوي'/'كلاهما' token the results RPC uses. The invariant this
// test protects — every pool call passes effCategory — is unaffected by that rename.)
const poolCalls: Array<[string, RegExp, RegExp]> = [
  ['ensureCityFieldIndex', /ensureCityFieldIndex\(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams\)/g, /ensureCityFieldIndex\(effDeal, rentPeriodTok\)[^,]/g],
  ['topCitiesByListings', /topCitiesByListings\(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams\)/g, /topCitiesByListings\(effDeal, rentPeriodTok, 6\)/g],
  ['matchCitiesByText', /matchCitiesByText\(effDeal, rentPeriodTok, effCategory, /g, /matchCitiesByText\(effDeal, rentPeriodTok, [^e]/g],
  ['ensureDistrictOptions', /ensureDistrictOptions\(cid, effDeal, effCategory, rentPeriodTok, cohortTypes\)/g, /ensureDistrictOptions\([^)]*query\.category/g],
  ['topDistrictsForCityId', /topDistrictsForCityId\((?:cid|citySelected\.cityId), effDeal, effCategory, rentPeriodTok, 6, cohortTypes\)/g, /topDistrictsForCityId\([^)]*query\.category/g],
  ['matchDistrictsByCityId', /matchDistrictsByCityId\((?:cid|citySelected\.cityId), effDeal, effCategory, rentPeriodTok, /g, /matchDistrictsByCityId\([^)]*query\.category/g],
];
for (const [name, good, bad] of poolCalls) {
  const goodCount = (indexSrc.match(good) || []).length;
  const badCount = (indexSrc.match(bad) || []).length;
  check(`${name}: every call passes effCategory (${goodCount} scoped, ${badCount} unscoped)`, goodCount > 0 && badCount === 0);
}

// ── Cache keys include the effective category — a category flip can never serve the other scope's
//    counts from cache. ──
check('city pool cache key includes category', /const cityPoolKey = \(deal: Deal \| null, periodTok: string \| null, category: Category \| null, types: string\[\] \| null = null, af: AfParams \| null = null\) => `\$\{deal\}:\$\{pmKey\(periodTok\)\}:\$\{category \?\? ''\}:\$\{typesKey\(types\)\}:\$\{afKey\(af\)\}`/.test(locSrc));
check('district cache key includes category (pre-existing, pinned)', /const districtCacheKey = \(cityId: number, deal: Deal \| null, category: Category \| null, periodTok: string \| null, types: string\[\] \| null = null\) => `\$\{cityId\}:\$\{deal\}:\$\{category \?\? ''\}:\$\{pmKey\(periodTok\)\}:\$\{typesKey\(types\)\}`/.test(locSrc));

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
