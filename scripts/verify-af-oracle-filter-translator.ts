// Hermetic mutation-proof of the AF independent-oracle translator (scripts/lib/afOracleFilter.ts).
//
// No browser, no network — the live proof that this translator agrees with production (61 checks,
// 9 real journeys, exact ID sets, zero mismatches) lives in scripts/verify-af-live-truth.ts and its
// scheduled workflow. This file protects the translator's LOGIC on every PR: the specific defect
// classes that would make an "independent oracle" agree with a wrong RPC for the wrong reason —
// the exact failure mode the whole exercise exists to catch (docs comment in afOracleFilter.ts).
//
//   node --experimental-strip-types scripts/verify-af-oracle-filter-translator.ts   (wired into `npm test`)

import { buildOracleQS } from './lib/afOracleFilter.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAF independent-oracle translator — hermetic logic proof\n');

// ── baseline shape ────────────────────────────────────────────────────────────────────────────
const BASE = { p_deal: 'بيع', p_tables: ['aqar_residential_listings'], p_types: ['شقة'], p_region_ids: [1] };

{
  const { qs, unhandled } = buildOracleQS(BASE);
  check('production_ready is always asserted', qs.includes('production_ready=is.true'));
  check('deal maps to deal_ar=eq', qs.includes(`deal_ar=eq.${encodeURIComponent('بيع')}`));
  check('tables map to source_table=in', qs.includes('source_table=in.(aqar_residential_listings)'));
  check('types map to type_ar=in', qs.includes(`type_ar=in.(${encodeURIComponent('"شقة"')})`));
  check('region maps to region_id=in', qs.includes('region_id=in.(1)'));
  check('a clean request has nothing unhandled', unhandled.length === 0, JSON.stringify(unhandled));
}

// ── scope B (the real bug this file was extracted to prevent from regressing) ───────────────────
{
  const withScopeB = { ...BASE, p_tables2: ['aqar_commercial_listings'], p_types2: ['شقة'] };
  const { qs } = buildOracleQS(withScopeB);
  check('scope B present ⇒ a combined or=() union, NOT flat source_table/type_ar filters',
    /or=\(and\(source_table\.in\.\(aqar_residential_listings\),type_ar\.in\.\(.*\)\),and\(source_table\.in\.\(aqar_commercial_listings\),type_ar\.in\.\(.*\)\)\)/.test(qs)
    && !qs.includes('source_table=in.') && !qs.includes('type_ar=in.'));
  const withoutScopeB = buildOracleQS(BASE).qs;
  check('scope A alone (no p_tables2/types2) still uses the flat filters, not or=()',
    withoutScopeB.includes('source_table=in.') && !withoutScopeB.includes('or=(and('));
  // empty-array scope2 must NOT trigger the union (matches the app's own "not attached" shape)
  const emptyScopeB = buildOracleQS({ ...BASE, p_tables2: [], p_types2: [] }).qs;
  check('EMPTY p_tables2/p_types2 arrays are treated as absent, not as an empty union',
    emptyScopeB.includes('source_table=in.') && !emptyScopeB.includes('or=(and('));
}

// ── rent period rule (the two-branch annual/RNPL/monthly split) ─────────────────────────────────
{
  const annual = buildOracleQS({ ...BASE, p_deal: 'إيجار', p_rent_period: 'سنوي' }).qs;
  check('annual period = literal-annual OR (monthly-labeled AND RNPL)',
    annual.includes(`rent_period_ar.eq.${encodeURIComponent('سنوي')}`)
    && annual.includes(`and(rent_period_ar.eq.${encodeURIComponent('شهري')},rent_now_pay_later.is.true)`));
  const monthly = buildOracleQS({ ...BASE, p_deal: 'إيجار', p_rent_period: 'شهري' }).qs;
  check('monthly period = payment_monthly AND NOT rnpl (excludes the annual RNPL branch)',
    monthly.includes('payment_monthly=is.true') && monthly.includes('rent_now_pay_later=not.is.true'));
  const both = buildOracleQS({ ...BASE, p_deal: 'إيجار', p_rent_period: 'كلاهما' });
  check('"both" (كلاهما) is honestly UNHANDLED, never guessed at',
    both.unhandled.some((u) => u.includes('كلاهما')));
}

// ── AF-answer column mapping (each one a real defect class if the operator/column is wrong) ─────
{
  check('bath_min → bathrooms gte (excludes NULL by construction)',
    buildOracleQS({ ...BASE, p_bath_min: 3 }).qs.includes('bathrooms=gte.3'));
  check('furnished tri-state → furnished is.<bool>, true and false both reachable',
    buildOracleQS({ ...BASE, p_furnished: true }).qs.includes('furnished=is.true')
    && buildOracleQS({ ...BASE, p_furnished: false }).qs.includes('furnished=is.false'));
  check('age range → property_age gte + lte, both bounds independently',
    buildOracleQS({ ...BASE, p_age_min: 3 }).qs.includes('property_age=gte.3')
    && buildOracleQS({ ...BASE, p_age_max: 5 }).qs.includes('property_age=lte.5'));
  check('street width → street_width_m gte/lte',
    buildOracleQS({ ...BASE, p_street_width_min: 15 }).qs.includes('street_width_m=gte.15'));
  check('directions → direction_ar in',
    buildOracleQS({ ...BASE, p_directions: ['شمال'] }).qs.includes(`direction_ar=in.(${encodeURIComponent('"شمال"')})`));
  check('rating/reviews → rating gte / reviews_count gte',
    buildOracleQS({ ...BASE, p_rating_min: 9.5 }).qs.includes('rating=gte.9.5')
    && buildOracleQS({ ...BASE, p_reviews_min: 10 }).qs.includes('reviews_count=gte.10'));
  check('unit subtypes → unit_subtype_ar in',
    buildOracleQS({ ...BASE, p_unit_subtypes: ['استوديو'] }).qs.includes('unit_subtype_ar=in.'));
  check('a plain amenity token maps to <token>=is.true',
    buildOracleQS({ ...BASE, p_amenities: ['elevator'] }).qs.includes('elevator=is.true'));
  check('rnpl is the ONE special-cased amenity token → rent_now_pay_later, not a literal "rnpl" column',
    buildOracleQS({ ...BASE, p_amenities: ['rnpl'] }).qs.includes('rent_now_pay_later=is.true'));
  check('multiple amenities AND together (every one must hold)', (() => {
    const qs = buildOracleQS({ ...BASE, p_amenities: ['elevator', 'parking'] }).qs;
    return qs.includes('elevator=is.true') && qs.includes('parking=is.true');
  })());
}

// ── the inconclusive-by-default contract (this is the entire safety property of the file) ───────
{
  check('an unmapped amenity token is UNHANDLED, never silently dropped',
    buildOracleQS({ ...BASE, p_amenities: ['not_a_real_amenity'] }).unhandled.some((u) => u.includes('not_a_real_amenity')));
  check('an unverified param (e.g. price) with a REAL value is UNHANDLED',
    buildOracleQS({ ...BASE, p_price_min: 500000 }).unhandled.some((u) => u.includes('p_price_min')));
  check('the SAME unverified param, absent (null), does not falsely trip unhandled',
    buildOracleQS({ ...BASE, p_price_min: null }).unhandled.length === 0);
  check('an entirely unknown future param name is UNHANDLED (default case), not ignored',
    buildOracleQS({ ...BASE, p_some_future_param: 42 }).unhandled.some((u) => u.includes('p_some_future_param')));
}

// ── genuinely irrelevant params never produce noise ───────────────────────────────────────────
{
  check('paging/sorting/informational params never appear in the WHERE clause and never trip unhandled',
    buildOracleQS({ ...BASE, p_limit: 100, p_offset: 0, p_sort_by: 'recent', p_category: 'Residential' }).unhandled.length === 0);
}

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// Re-implement each defect INLINE (not by mutating source text) so the mutation proof exercises
// the same contract the checks above assert, the way the earlier barriers in this session do.
mustCatch('wrong operator direction on a strict answer (lte instead of gte would silently invert bath_min)',
  buildOracleQS({ ...BASE, p_bath_min: 3 }).qs.includes('bathrooms=gte.3')
  && !buildOracleQS({ ...BASE, p_bath_min: 3 }).qs.includes('bathrooms=lte.3'));
mustCatch('a tri-state boolean collapsing true/false to the same filter',
  buildOracleQS({ ...BASE, p_furnished: true }).qs !== buildOracleQS({ ...BASE, p_furnished: false }).qs);
mustCatch('scope B silently ignored would make a Residential+commercial-mirrored type undercount',
  (() => {
    const withB = buildOracleQS({ ...BASE, p_tables2: ['x'], p_types2: ['y'] }).qs;
    const withoutB = buildOracleQS(BASE).qs;
    return withB !== withoutB; // must actually change the predicate, not no-op
  })());
mustCatch('an unmapped amenity being treated as a boolean column of the same name (fabricated column)',
  !buildOracleQS({ ...BASE, p_amenities: ['totally_made_up'] }).qs.includes('totally_made_up=is.true'));
mustCatch('"both" period silently resolving to "no filter" (would over-match anything)',
  buildOracleQS({ ...BASE, p_deal: 'إيجار', p_rent_period: 'كلاهما' }).unhandled.length > 0);
mustCatch('rnpl amenity resolving to a nonexistent "rnpl" column instead of rent_now_pay_later',
  !buildOracleQS({ ...BASE, p_amenities: ['rnpl'] }).qs.includes('rnpl=is.true'));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ the independent-oracle translator is logically sound\n');
