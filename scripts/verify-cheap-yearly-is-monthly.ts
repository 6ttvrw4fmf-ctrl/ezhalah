// A «YEARLY» RENT UNDER 8,000 SAR ON A HOME OR BUSINESS UNIT IS A PER-MONTH PRICE — owner 2026-10-26.
// Canonical rule: docs/ARCHITECTURE.md §20. The app's half (src/lib/rentPool.ts::cheapYearlyIsMonthly, applied in
// finalize()) and the DB's half (public.rent_price_annual_ar in supabase/migrations) carry ONE threshold and ONE
// type list; this EXECUTES the app's half against the truth table, proves each guard fails on its own defect, and
// pins that the SQL half names exactly the same types and threshold. Production is watched twice an hour by
// mon_detect_cheap_yearly_rent_served().
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cheapYearlyIsMonthly, CHEAP_YEARLY_FROM, CHEAP_YEARLY_BELOW, CHEAP_YEARLY_TYPES_EN } from '../src/lib/rentPool.ts';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`); if (!ok) failed++; };
const mutantCaught = (name: string, caught: boolean) => check(`(mutation) ${name}`, caught);

console.log('verify-cheap-yearly-is-monthly: a «yearly» home/business rent under 8,000 SAR is served ×12 as a per-month price.');

// ── the rule, executed ─────────────────────────────────────────────────────────────────────────────────────────
check('Wasalt apartment, site says yearly 3,300 → per month', cheapYearlyIsMonthly('wasalt_residential_listings', 'annual', 3300, 'Apartment'));
check('Aqar office, site says yearly 3,000 → per month', cheapYearlyIsMonthly('Aqar', 'annual', 3000, 'Office'));
check('7,999 is still per month; 8,000 is the first real yearly figure', cheapYearlyIsMonthly('aqar', 'annual', 7999, 'Apartment') && !cheapYearlyIsMonthly('aqar', 'annual', 8000, 'Apartment'));
check('a room at 6,000 a year is real — OUT', !cheapYearlyIsMonthly('aqar', 'annual', 6000, 'Room'));
check('land, rest house, chalet, camp, farm — OUT', ['Residential Land', 'Land', 'Rest House', 'Chalet', 'Camp', 'Farm'].every((t) => !cheapYearlyIsMonthly('aqar', 'annual', 3000, t)));
check("a per-month-labelled figure is the pool's job, not this rule's", !cheapYearlyIsMonthly('haraj', 'monthly', 3000, 'Apartment'));
check('an unpublished period is never guessed', !cheapYearlyIsMonthly('aqar', null, 3000, 'Apartment') && !cheapYearlyIsMonthly('aqar', '', 3000, 'Apartment'));
check('stay-length platforms untouched', !cheapYearlyIsMonthly('gathern_residential_listings', 'annual', 3000, 'Apartment') && !cheapYearlyIsMonthly('Aqar Monthly', 'annual', 3000, 'Apartment'));
check('no figure / zero / NaN → untouched', !cheapYearlyIsMonthly('aqar', 'annual', null, 'Apartment') && !cheapYearlyIsMonthly('aqar', 'annual', 0, 'Apartment') && !cheapYearlyIsMonthly('aqar', 'annual', Number.NaN, 'Apartment'));
check('a placeholder under 300 (1, 35, 200) is NOT a monthly rent — untouched; 300 is the first per-month figure',
  !cheapYearlyIsMonthly('aqar', 'annual', 1, 'Apartment') && !cheapYearlyIsMonthly('aqar', 'annual', 200, 'Apartment') && cheapYearlyIsMonthly('aqar', 'annual', 300, 'Apartment'));
check('the band constants are [300, 8000)', CHEAP_YEARLY_FROM === 300 && CHEAP_YEARLY_BELOW === 8000);
mutantCaught('a rule without the floor (×12 on a 35 SAR placeholder)', !cheapYearlyIsMonthly('aqar', 'annual', 35, 'Apartment'));

// ── mutation proofs ────────────────────────────────────────────────────────────────────────────────────────────
mutantCaught('a rule that also flips rooms', ((t: string) => t === 'Room')('Room') && !cheapYearlyIsMonthly('aqar', 'annual', 6000, 'Room'));
mutantCaught('a rule keyed on the pool instead of the site word (would flip per-month-labelled rows twice)', !cheapYearlyIsMonthly('haraj', 'monthly', 3000, 'Apartment'));
mutantCaught('an inclusive threshold (8,000 flipped)', !cheapYearlyIsMonthly('aqar', 'annual', 8000, 'Apartment'));

// ── wiring: finalize() serves the ×12 figure and the monthly word ───────────────────────────────────────────────
const remote = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
check('finalize() asks the rule with the site word, the figure and the clean type',
  /const cheapYearly = deal === 'Rent' && cheapYearlyIsMonthly\(r\.source \?\? '', r\.rent_period, r\.price_annual, norm\.clean\);/.test(remote));
check('finalize() serves ×12 and says the site priced per month',
  /const servedAnnual: unknown = cheapYearly \? \(r\.price_annual as number\) \* 12 : r\.price_annual;/.test(remote)
  && /const servedSourcePeriod = cheapYearly \? 'monthly' : \(r\.rent_period \?\? null\);/.test(remote)
  && /listingPriceString\(deal, pool, servedAnnual, sale\.priceTotal/.test(remote)   // falcon 10-30: sale figures via servedSaleFigures (PR 9479)
  && /const sale = deal === 'Buy' \? servedSaleFigures\(r\.price_total, r\.price_annual, r\.area_m2, r\.price_per_meter\)\s*\n\s*: \{ priceTotal: r\.price_total, pricePerMeter: r\.price_per_meter \};/.test(remote)
  && /sourceRentPeriod: deal === 'Rent' \? servedSourcePeriod : null,/.test(remote)
  && /priceAnnual: deal === 'Rent' && typeof servedAnnual === 'number' \? servedAnnual : null,/.test(remote));
mutantCaught('finalize() back on the raw figure', !/listingPriceString\(deal, pool, servedAnnual, r\.price_total/.test(remote.replace('listingPriceString(deal, pool, servedAnnual, r.price_total', 'listingPriceString(deal, pool, r.price_annual, r.price_total')));

// ── the DB half names the same types and threshold ─────────────────────────────────────────────────────────────
const migDir = join(root, 'supabase/migrations');
const migs = readdirSync(migDir).filter((f) => /cheap_yearly/.test(f)).sort(); // the LATEST definition wins
const sql = migs.map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n');
const fnAll = [...sql.matchAll(/create or replace function public\.rent_price_annual_ar[\s\S]*?\$\$;/g)].map((m) => m[0]);
const fn = fnAll[fnAll.length - 1] ?? ''; // the latest migration's definition is what production runs
const sqlTypesEn = (/when p_type in \(([^)]*)\)/.exec(fn)?.[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
check('public.rent_price_annual_ar (SQL) lists exactly the TS types', migs.length >= 1 && sqlTypesEn.join('|') === [...CHEAP_YEARLY_TYPES_EN].sort().join('|'), `sql: [${sqlTypesEn.join(', ')}]`);
check('the SQL band is the TS band [300, 8000)', new RegExp(`p_price_annual < ${CHEAP_YEARLY_FROM} or p_price_annual >= ${CHEAP_YEARLY_BELOW} then p_price_annual`).test(fn));
check('the SQL half is behind the cheap_yearly_is_monthly flag and skips stay-length platforms and non-annual words',
  /ops_feature_flags k where k\.name = 'cheap_yearly_is_monthly' and k\.enabled/.test(fn) && /p_platform in \('gathern','aqarmonthly'\) then p_price_annual/.test(fn) && /p_rent_period is distinct from 'annual' then p_price_annual/.test(fn));
check('the migration rosters mon_detect_cheap_yearly_rent_served and re-points the sync', /mon_detect_cheap_yearly_rent_served/.test(sql) && /mon_run_all_detectors/.test(sql) && /public\.rent_price_annual_ar\(v\.platform, v\.rent_period, v\.price_annual, v\.property_type\)/.test(sql));

if (failed) { console.log(`\n❌ verify-cheap-yearly-is-monthly: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-cheap-yearly-is-monthly: the rule, finalize() and the DB mirror all agree.');
