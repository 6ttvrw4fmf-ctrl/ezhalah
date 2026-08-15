// Regression guard — Filter rent-period "Both" option (owner, 2026-08-15):
// "user can choose both monthly and yearly, he doesn't need to select one only specifically."
//
// THE MECHANISM. location_search_candidates_ar already has a `p_rent_period is null` arm that
// matches every Rent row regardless of period — Buy and bothDeals already exercise it today. This
// feature is just the Normal Filter's Monthly/Yearly toggle gaining a third option that routes to
// that SAME existing null path, so MATCH already runs over the full monthly+annual pool before the
// existing platform round-robin (div_rank) diversity — no diversity-layer change was needed or made.
//
// THE BUGS THIS WOULD HAVE SHIPPED IF rentPeriod HAD BEEN WIDENED WITHOUT AUDITING EVERY BRANCH:
//   1. resTables(): a binary `=== 'monthly'` check would exclude Gathern + Aqar Monthly (the two
//      monthly-only platforms) from a 'both' search — their rows never reach the RPC at all.
//   2. index.tsx paymentMonthly: a binary `rentPeriod === 'monthly'` ternary silently returns FALSE
//      for 'both' (same as 'annual'), which restricts the City/District trending + count RPCs to
//      annual-only — the exact "district count accuracy" class of bug fixed 2026-08-11.
//   3. advancedFilters.ts isAnnualRentApartment/isApartmentAttributeScope used `!== 'monthly'`,
//      which reads 'both' as "annual" and would ask RNPL/amenities/bathroom questions scoped to a
//      pool that still mixes in monthly rows carrying none of those structured attributes.
//   node --experimental-strip-types scripts/verify-rent-period-both-option.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SEARCH = read('src/data/search.ts');
const REMOTE = read('src/data/remote.ts');
const ADV = read('src/data/advancedFilters.ts');
const IX = read('src/app/index.tsx');
const NOWS_IX = IX.replace(/\s+/g, '');
const I18N = read('src/i18n.tsx');

// ── type + query-label plumbing ──
check("SearchQuery.rentPeriod type widened to include 'both'",
  /rentPeriod\?:\s*'monthly'\s*\|\s*'annual'\s*\|\s*'both'/.test(SEARCH));
check("verbText handles 'both' distinctly (not silently falling to plain \"to rent\")",
  SEARCH.includes("if (q.rentPeriod === 'both') return t('to rent monthly or yearly');"));
check("searchSummary period suffix has a real 3rd label for 'both' (not defaulting to Yearly)",
  SEARCH.includes("q.rentPeriod === 'monthly' ? 'Monthly' : q.rentPeriod === 'annual' ? 'Yearly' : 'Monthly & Yearly'"));

// ── remote.ts: the two places a binary check would have silently misrouted 'both' ──
check("resTables() includes Gathern + Aqar Monthly for 'both' (monthly-only platforms must not vanish)",
  /q\.rentPeriod === 'monthly' \|\| q\.rentPeriod === 'both'/.test(REMOTE)
  && REMOTE.includes("[...RES_TABLES, 'gathern_residential_listings', 'aqarmonthly_residential_listings']"));
check("rentPeriodParam() explicitly returns null for 'both' (the RPC's own no-filter path)",
  REMOTE.includes("q.rentPeriod === 'both'") &&
  /if \(q\.bothDeals \|\| q\.deal !== 'Rent' \|\| q\.rentPeriod === 'both'\) return null;/.test(REMOTE));

// ── advancedFilters.ts: exact('annual'), not a negated !=='monthly' that would sweep in 'both' ──
check("isAnnualRentApartment uses exact rentPeriod==='annual' (excludes 'both', same as 'monthly')",
  ADV.includes("q.deal === 'Rent' && q.rentPeriod === 'annual';"));
check("isApartmentAttributeScope uses exact rentPeriod==='annual' (excludes 'both', same as 'monthly')",
  ADV.includes("(q.deal === 'Rent' && q.rentPeriod === 'annual');"));
check("neither advanced-filter gate still uses the old '!== \\'monthly\\'' shape",
  !ADV.includes("q.rentPeriod !== 'monthly'"));

// ── index.tsx: paymentMonthly must be null (no filter), never false, for 'both' ──
check("paymentMonthly resolves to null for 'both' (false would wrongly hide monthly cities/districts)",
  NOWS_IX.includes("constpaymentMonthly:boolean|null=query.deal==='Rent'") &&
  NOWS_IX.includes("?(rentPeriod==='both'?null:rentPeriod==='monthly')"));
check("rentPeriod local type widened to include 'both'",
  NOWS_IX.includes("constrentPeriod:'monthly'|'annual'|'both'=query.rentPeriod??'annual';"));

// ── index.tsx: the Segmented control itself offers a 3rd, real option ──
check("Segmented options include 'Both' as a genuine 3rd choice",
  IX.includes("options={['Monthly', 'Yearly', 'Both']}"));
check("Segmented value maps 'both' → the 'Both' label (not falling through to Yearly)",
  IX.includes("value={rentPeriod === 'monthly' ? 'Monthly' : rentPeriod === 'annual' ? 'Yearly' : 'Both'}"));
check("Segmented onChange maps the 'Both' tap to rentPeriod:'both'",
  IX.includes("const next = v === 'Monthly' ? 'monthly' : v === 'Yearly' ? 'annual' : 'both';"));
check("hint text has a genuine 'Both' explanation (not reusing the annual/monthly copy)",
  IX.includes("'Both: monthly and yearly listings together.'"));
// Sibling rule from verify-period-price-flip.ts must still hold with the 3-way next: switching
// into/out of 'both' clears price bounds exactly like Monthly↔Yearly (same ambiguous-unit reasoning).
check("period-change price-clear logic untouched by the 3-way next (sibling rule still wired)",
  NOWS_IX.includes("rentPeriod:next,priceMin:null,priceMax:null,priceInput:'',priceBand:null"));

// ── i18n: every new label actually has an Arabic translation, not an English leak ──
check("'Both' has an Arabic translation", /'Both':\s*'كلاهما'/.test(I18N));
check("'Monthly & Yearly' (search-summary suffix) has an Arabic translation", /'Monthly & Yearly':\s*'شهري وسنوي'/.test(I18N));
check("'to rent monthly or yearly' has an Arabic translation", I18N.includes("'to rent monthly or yearly': 'للإيجار الشهري أو السنوي'"));
check("Both hint text has a genuine Arabic translation", I18N.includes("'Both: monthly and yearly listings together.': 'كلاهما: نتائج الإيجار الشهري والسنوي معاً.'"));

if (failed) { console.error(`\n✗ ${failed} rent-period-both assertion(s) FAILED`); process.exit(1); }
console.log('\n✓ all rent-period "Both" assertions passed (match-both-periods wiring + diversity untouched)');
