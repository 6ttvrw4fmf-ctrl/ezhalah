// AN UNPUBLISHED RENTAL PERIOD MUST NEVER BE RENDERED AS «/سنوياً».
//
// THE DEFECT (found live 2026-08-23, production ezhalah-app.vercel.app).
// Filter search with BOTH شراء and إيجار selected (combined mode), الرياض → الشقق والسكن المشترك →
// شقة. Card #7 — «رغدان للعقارات · raghdan.sa», النرجس, 450 م² — printed «ر.س 70,000/سنوياً».
// Ground truth: raghdan_residential_listings:598090 has transaction_type='Rent', price_annual=70000
// and rent_period IS NULL, and the source page
// https://raghdan.sa/ar/property/ElBARcYHDtOFPt3q99nI/ publishes «"advertisementType":"إيجار",
// "propertyPrice":70000» with NO سنوي/شهري/annual/monthly token anywhere. The app invented the
// period. 316 active Rent rows carry a NULL rent_period with a price, so this was not one row.
//
// THE CAUSE. finalize() in src/data/remote.ts built the price line as
//     `SAR ${amount}${deal === 'Rent' ? (isMonthlyRent ? '/mo' : '/yr') : ''}`
// i.e. "not monthly" was treated as annual. Every single-period search filters those rows out
// (keptFiltersReq's annual branch is `rent_period = 'annual'`, and its own comment says "a null
// rent_period on a mixed platform is NOT annual and must appear in NEITHER ... never guess"), so
// nothing exercised the guess — until combined Buy+Rent mode, which applies no period filter at all
// and lets NULL-period rent rows reach the card.
//
// WHY THIS BARRIER EXISTS. PERIOD = SOURCE is a permanent owner rule: a period the source did not
// publish stays unknown, and unknown must never be rendered as a known value. The formatting now
// lives in ONE zero-dep function, listingPriceString() in src/data/listings.ts, and this file
// EXECUTES it rather than grepping for it. The source half then pins that finalize() still
// delegates to it, so the rule cannot be re-broken by inlining a new copy of the old expression.
//
//   node --experimental-strip-types scripts/verify-unknown-rent-period-not-annual.ts
import { readFileSync } from 'node:fs';
import { listingPriceString } from '../src/data/listings.ts';
import { join as __join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

// "Is this guard actually wired in?" — asked of the test registry, which is what `npm test`
// resolves its run set from (scripts/lib/testRegistry.ts). String-matching package.json used to
// answer it; since the 201-command chain became one runner invocation, that match would read
// "not wired" for every barrier in the suite.
const REPO_ROOT = __join(import.meta.dirname, '..');

let failed = 0;
const check = (label: string, ok: boolean, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && extra ? ` — ${extra}` : ''}`);
};

// ------------------------------------------------------------------ behavioural half (the rule)

// THE REGRESSION ITSELF: the exact production row that was mis-rendered.
const raghdan598090 = listingPriceString('Rent', null, 70000, null);
check('NULL rent_period → NO period suffix (raghdan 598090, the live defect)',
  raghdan598090 === 'SAR 70,000',
  `got ${JSON.stringify(raghdan598090)} — an unpublished period is being rendered as a known one`);
check('NULL rent_period never emits /yr (tPrice would print «/سنوياً»)',
  !raghdan598090.includes('/yr') && !raghdan598090.includes('/year'),
  `got ${JSON.stringify(raghdan598090)}`);
check('NULL rent_period never emits /mo either (the opposite guess is equally invented)',
  !raghdan598090.includes('/mo'),
  `got ${JSON.stringify(raghdan598090)}`);
check('an UNDEFINED rent_period (column absent from the row) is treated the same as NULL',
  listingPriceString('Rent', undefined, 70000, null) === 'SAR 70,000',
  `got ${JSON.stringify(listingPriceString('Rent', undefined, 70000, null))}`);
check('an unrecognised rent_period token is not silently promoted to annual',
  listingPriceString('Rent', 'weekly', 70000, null) === 'SAR 70,000',
  `got ${JSON.stringify(listingPriceString('Rent', 'weekly', 70000, null))}`);
// The price itself is passed through VERBATIM — no rounding, no annualisation, no derivation.
check('the source figure is passed through verbatim on a NULL-period row',
  listingPriceString('Rent', null, 70000, null).includes('70,000')
  && listingPriceString('Rent', null, 12345, null) === 'SAR 12,345',
  'the unknown-period branch is altering the source price');

// AND THE KNOWN PERIODS MUST STILL BE LABELLED — an over-broad "fix" that dropped every suffix
// would silence 82,000 rows whose source DID publish a period.
check('rent_period=annual still prints /yr',
  listingPriceString('Rent', 'annual', 70000, null) === 'SAR 70,000/yr',
  `got ${JSON.stringify(listingPriceString('Rent', 'annual', 70000, null))}`);
check('rent_period=monthly still prints the per-month figure with /mo (24,000 stored → 2,000/mo)',
  listingPriceString('Rent', 'monthly', 24000, null) === 'SAR 2,000/mo',
  `got ${JSON.stringify(listingPriceString('Rent', 'monthly', 24000, null))}`);
check('Buy rows carry no period suffix at all, whatever rent_period says',
  listingPriceString('Buy', 'annual', null, 900000) === 'SAR 900,000'
  && listingPriceString('Buy', null, null, 900000) === 'SAR 900,000',
  'a Buy row is being labelled with a rental period');
check('a price-less row still falls back to the «السعر عند الطلب» sentinel',
  listingPriceString('Rent', null, null, null) === 'Price on request'
  && listingPriceString('Buy', null, null, null) === 'Price on request',
  'the no-price sentinel changed — ResultCard keys its سعر المتر fallback off this exact string');

// ------------------------------------------------------------------ source half (single owner)

const REMOTE = readFileSync('src/data/remote.ts', 'utf8');
const finalizeSrc = REMOTE.slice(REMOTE.indexOf('function finalize('));
check('finalize() delegates the price line to listingPriceString()',
  /const priceStr = listingPriceString\(deal, r\.rent_period, r\.price_annual, r\.price_total\)/
    .test(finalizeSrc),
  'finalize() no longer calls listingPriceString — the formatting rule has a second owner again, '
  + 'and the behavioural checks above no longer cover what the card actually renders');
check('finalize() does not re-inline the old "not monthly ⇒ /yr" expression',
  !/\?\s*'\/mo'\s*:\s*'\/yr'/.test(REMOTE) && !/\?\s*"\/mo"\s*:\s*"\/yr"/.test(REMOTE),
  'the pre-fix expression `isMonthlyRent ? \'/mo\' : \'/yr\'` is back in src/data/remote.ts — it '
  + 'stamps «/سنوياً» on every rent row whose source published no period');
check('finalize() does not default Listing.rentPeriod to annual either',
  /rentPeriod: deal === 'Rent' \? \(r\.rent_period \?\? null\) : null/.test(finalizeSrc)
  && !/r\.rent_period \?\? 'annual'/.test(REMOTE),
  'Listing.rentPeriod is being defaulted to \'annual\' when the source published no period');

// The single-period fetch branches are what kept this invisible; if they ever start admitting
// NULL-period rows under an ANNUAL search, the card would be labelling them by the FILTER, not by
// the source. Pin the strict equality.
check('keptFiltersReq still filters ANNUAL searches to an explicit rent_period=\'annual\'',
  /q\.rentPeriod === 'annual'\)\s*\{\s*\n\s*req = req\.eq\('rent_period', 'annual'\);/.test(REMOTE),
  'the annual branch no longer requires an explicit annual rent_period — NULL-period rows would be '
  + 'swept into an annual-only result set');

check('npm test runs this guard',
  npmTestRuns(REPO_ROOT, 'verify-unknown-rent-period-not-annual'),
  '`npm test` no longer runs verify-unknown-rent-period-not-annual.ts (see scripts/test-exclusions.txt) — the guard is inert');

console.log(
  failed
    ? `\n❌ unknown-rent-period: ${failed} check(s) failed — the app is inventing a rental period the source never published.`
    : '\n✅ unknown-rent-period: an unpublished period stays unpublished.',
);
process.exit(failed ? 1 : 0);
