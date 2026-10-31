// «إقامات قصيرة» (Short stays) POOL — owner 2026-10-25. Canonical rule: docs/ARCHITECTURE.md §20.
//
//   Short stays = Gathern + Aqar Monthly ONLY. Every other site's rent listing with a published period is YEARLY:
//   a per-month figure pools at ×12 (price_annual is already monthly×12) and the card keeps the site's own words,
//   «السعر المعلن 3,000 شهرياً». An unpublished period stays null — never guessed.
//
// This EXECUTES src/lib/rentPool.ts (the app's half) against the truth table, proves each guard fails on its own
// defect, and pins that the DB half (public.rent_pool_ar, the same table in SQL) names exactly the same platforms.
// The production side is watched twice an hour by mon_detect_short_stays_pool_drift().
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rentPool, advertisedMonthly, cardFetchPeriodOr, isShortStayTable, SHORT_STAY_PLATFORMS, judgeSilentRentPeriod, SILENT_YEARLY_FROM } from '../src/lib/rentPool.ts';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`); if (!ok) failed++; };
const mutantCaught = (name: string, caught: boolean) => check(`(mutation) ${name}`, caught);

console.log('verify-short-stays-pool: Short stays = Gathern + Aqar Monthly; every other per-month rent is yearly at ×12.');

// ── the pool, executed ──────────────────────────────────────────────────────────────────────────────────────────
check("gathern (table, key, or display name) → 'monthly' pool whatever the source word",
  rentPool('gathern_residential_listings', 'monthly') === 'monthly' && rentPool('gathern', null) === 'monthly' && rentPool('Gathern', 'annual') === 'monthly');
check("aqarmonthly → 'monthly' pool, by table, key and the row's display name «Aqar Monthly»",
  rentPool('aqarmonthly_residential_listings', 'monthly') === 'monthly' && rentPool('Aqar Monthly', 'monthly') === 'monthly');
check("any other site, source 'monthly' → 'annual' pool (×12)", rentPool('haraj_residential_listings', 'monthly') === 'annual' && rentPool('Aqar', 'monthly') === 'annual' && rentPool('wasalt', 'MONTHLY') === 'annual');
check("any other site, source 'annual' → 'annual'", rentPool('aqar_residential_listings', 'annual') === 'annual');
check('no published period and no figure → null, never annual (owner 2026-09-03)', rentPool('aqar_residential_listings', null) === null && rentPool('raghdan', '') === null && rentPool('Aqar', undefined) === null);
// A SILENT period is judged from the figure (owner 2026-09-28, built 2026-10-31 — mirror of judge_silent_rent_period_ar):
check('silent + 180,000 warehouse (wajaf 22222374) → yearly pool', rentPool('wajaf_commercial_listings', null, 180000, 'Warehouse') === 'annual' && judgeSilentRentPeriod(180000, 'Warehouse') === 'annual');
check('silent + 2,500 apartment → a per-month figure → yearly pool at ×12', rentPool('muhaysini_residential_listings', null, 2500, 'Apartment') === 'annual' && judgeSilentRentPeriod(2500, 'Apartment') === 'monthly-figure');
check('silent + 9,000 (borderline) → null; silent + 2,500 on land → null; silent + 35 (placeholder) → null',
  rentPool('aqar_residential_listings', null, 9000, 'Apartment') === null && rentPool('aqar_residential_listings', null, 2500, 'Residential Land') === null && rentPool('aqar_residential_listings', null, 35, 'Apartment') === null);
check('the silent yearly bar is 15,000 inclusive; 14,999 is borderline', judgeSilentRentPeriod(15000, 'Residential Land') === 'annual' && judgeSilentRentPeriod(14999, 'Apartment') === null && SILENT_YEARLY_FROM === 15000);
check('a stated period still wins over the figure', rentPool('aqar_residential_listings', 'annual', 35, 'Apartment') === 'annual' && rentPool('gathern_residential_listings', null, 180000, 'Apartment') === 'monthly');
check('«Aqar» alone is not a short-stay site (the prefix must be the whole key)', !isShortStayTable('Aqar') && !isShortStayTable('aqar_residential_listings') && !isShortStayTable('aqarcity'));
check('the TS platform list is exactly gathern + aqarmonthly', [...SHORT_STAY_PLATFORMS].sort().join(',') === 'aqarmonthly,gathern');

// ── the card's «السعر المعلن» line ───────────────────────────────────────────────────────────────────────────────
check('yearly pool + source monthly + price_annual 36,000 → advertised 3,000/month', advertisedMonthly('annual', 'monthly', 36000) === 3000);
check('yearly pool + source yearly → no line', advertisedMonthly('annual', 'annual', 36000) === null);
check('short-stay pool → no line (they show no price line)', advertisedMonthly('monthly', 'monthly', 36000) === null);
check('no price / bad price → no line', advertisedMonthly('annual', 'monthly', null) === null && advertisedMonthly('annual', 'monthly', 0) === null && advertisedMonthly('annual', 'monthly', 'x') === null);

// ── the card-fetch clause per pool and table ───────────────────────────────────────────────────────────────────
check('yearly search, other site: accepts monthly AND annual source rows, a silent-period row the index judged, and unpriced',
  cardFetchPeriodOr('annual', 'haraj_residential_listings') === 'rent_period.in.(monthly,annual),rent_period.is.null,price_annual.is.null');
mutantCaught('the 10-25 yearly card-fetch clause (no rent_period.is.null) drops a judged silent-period ad the count included',
  'rent_period.in.(monthly,annual),price_annual.is.null' !== cardFetchPeriodOr('annual', 'haraj_residential_listings'));
check('yearly search, short-stay table: still excluded (annual-only clause, which they never carry)',
  cardFetchPeriodOr('annual', 'gathern_residential_listings') === 'rent_period.eq.annual,price_annual.is.null');
check('short-stays search, short-stay table: no clause; other site: monthly-only (the index never returns them)',
  cardFetchPeriodOr('monthly', 'aqarmonthly_residential_listings') === null && cardFetchPeriodOr('monthly', 'aqar_residential_listings') === 'rent_period.eq.monthly,price_annual.is.null');
check("both: short-stay table no clause; other site in.(monthly,annual)",
  cardFetchPeriodOr('both', 'gathern_residential_listings') === null && cardFetchPeriodOr('both', 'wasalt_residential_listings') === 'rent_period.in.(monthly,annual),rent_period.is.null,price_annual.is.null');

// ── mutation proofs: each guard fails on its own defect ───────────────────────────────────────────────────────
const oldPool = (_t: string, p: string | null) => (p === 'monthly' ? 'monthly' : p === 'annual' ? 'annual' : null); // PERIOD = SOURCE, the pre-2026-10-25 rule
mutantCaught('the old PERIOD=SOURCE pool puts a haraj per-month ad under Short stays', oldPool('haraj_residential_listings', 'monthly') !== 'annual');
mutantCaught('a pool that guesses annual for an unpublished period', ((_t: string, p: string | null) => p === 'monthly' ? 'annual' : 'annual')('aqar', null) !== null);
mutantCaught("the old yearly card-fetch clause (rent_period.eq.annual) drops a moved per-month ad", 'rent_period.eq.annual,price_annual.is.null' !== cardFetchPeriodOr('annual', 'haraj_residential_listings'));
mutantCaught('an advertised line on a short-stay row', advertisedMonthly('monthly', 'monthly', 36000) === null);

// ── wiring: the app routes every period surface through the pool ─────────────────────────────────────────────
const remote = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
const card = readFileSync(join(root, 'src/components/ResultCard.tsx'), 'utf8');
const preview = readFileSync(join(root, 'src/components/ListingPreview.tsx'), 'utf8');
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
const index = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
check('finalize() pools the row with rentPool(r.source, r.rent_period) and prices with the POOL',
  /const pool = deal === 'Rent' \? rentPool\(r\.source \?\? '', r\.rent_period, r\.price_annual, norm\.clean\) : null;/.test(remote)
  // (2026-10-26: the figure and the site word are the SERVED ones — a cheap «yearly» home/business rent is ×12 and
  //  'monthly'; scripts/verify-cheap-yearly-is-monthly.ts executes that rule.)
  && /listingPriceString\(deal, pool, servedAnnual/.test(remote) && /rentPeriod: pool,/.test(remote) && /sourceRentPeriod: deal === 'Rent' \? servedSourcePeriod : null,/.test(remote));
check('the card fetch applies cardFetchPeriodOr for monthly / annual / both', /const clause = cardFetchPeriodOr\(q\.rentPeriod, tbl\);/.test(remote));
check('both card layouts and the ad page print the monthly line',
  (card.match(/\{monthlyLine\(listing, locale\)\}/g) || []).length === 2 && /monthlyLineText\(l, locale\)/.test(preview)
  && /listing-preview-monthly-line/.test(preview));
check('the button and its hint say «إقامات قصيرة» / Short stays; the Arabic copy never claims a contract length',
  /label=\{t\(which === 'monthly' \? 'Short stays' : 'Yearly'\)\}/.test(index) && /'Short stays': 'إقامات قصيرة'/.test(i18n)
  && /'Advertised price \{a\}\/month': 'السعر المعلن \{a\} شهرياً'/.test(i18n)
  && /'Short stays: stays shorter than a year, priced by length of stay\.': 'إقامات قصيرة: إقامات أقل من سنة، وأسعارها حسب مدة الإقامة\.'/.test(i18n));
mutantCaught('the old «شهري» button label is no longer what the guard accepts', !/label=\{t\(which === 'monthly' \? 'Short stays' : 'Yearly'\)\}/.test(index.replace("'Short stays' : 'Yearly'", "'Monthly' : 'Yearly'")));

// ── the DB half names the same platforms ─────────────────────────────────────────────────────────────────────
const migDir = join(root, 'supabase/migrations');
const poolMigs = readdirSync(migDir).filter((f) => /short_stays_pool/.test(f));
const poolSql = poolMigs.map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n');
const sqlPlatforms = /create or replace function public\.rent_pool_ar[\s\S]*?when p_platform in \(([^)]*)\) then 'شهري'/.exec(poolSql)?.[1] ?? '';
check('public.rent_pool_ar (SQL) lists exactly the TS platforms', poolMigs.length >= 1
  && sqlPlatforms.replace(/['\s]/g, '').split(',').sort().join(',') === [...SHORT_STAY_PLATFORMS].sort().join(','), `sql: [${sqlPlatforms}]`);
check('the SQL pool maps monthly AND annual to «سنوي» for other sites, and null stays null, behind the short_stays_pool flag',
  /when 'annual' then 'سنوي' when 'monthly' then 'سنوي' else null::text end/.test(poolSql) && /ops_feature_flags k where k\.name = 'short_stays_pool' and k\.enabled/.test(poolSql));
check('the migration rosters mon_detect_short_stays_pool_drift (a detector outside the roster is decoration)',
  /mon_detect_short_stays_pool_drift/.test(poolSql) && /mon_run_all_detectors/.test(poolSql));

if (failed) { console.log(`\n❌ verify-short-stays-pool: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-short-stays-pool: the pool, the card line and the DB mirror all agree.');
