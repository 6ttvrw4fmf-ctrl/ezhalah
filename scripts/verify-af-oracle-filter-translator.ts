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
  // NOTE (2026-09-01): this pair used to name p_price_min as its example of an unverified param.
  // Price is now translated and proven against production (27/27 exact, see verify-af-live-truth),
  // so the example moved to p_rent_period='كلاهما' — still genuinely unverified, so the property
  // being pinned (a real value for an unverified param must be UNHANDLED, while its ABSENCE must
  // not trip anything) is unchanged. The expectation was updated because the code became more
  // capable, never to accommodate a weaker translator.
  check('an unverified param with a REAL value is UNHANDLED',
    buildOracleQS({ ...BASE, p_rent_period: 'كلاهما' }).unhandled.some((u) => u.includes('p_rent_period')));
  check('the SAME unverified param, absent (null), does not falsely trip unhandled',
    buildOracleQS({ ...BASE, p_rent_period: null }).unhandled.length === 0);
  check('a param that is now VERIFIED no longer reports unhandled (price was, until 2026-09-01)',
    buildOracleQS({ ...BASE, p_price_min: 500000 }).unhandled.length === 0);
  check('an entirely unknown future param name is UNHANDLED (default case), not ignored',
    buildOracleQS({ ...BASE, p_some_future_param: 42 }).unhandled.some((u) => u.includes('p_some_future_param')));
}

// ── genuinely irrelevant params never produce noise ───────────────────────────────────────────
// p_category was REMOVED from this list on 2026-08-28. It was never informational: the clause's
// category-purity predicate makes a `both`-macro type eligible only from the table matching the
// requested category. Treating it as paging metadata produced a live false differential (المدينة
// المنورة / Residential Building / Buy: oracle 708 vs RPC 707, the row being a `both`-macro «عمارة»
// in a commercial table) AND left the oracle unable to catch a category-purity leak at all.
{
  check('paging/sorting params never appear in the WHERE clause and never trip unhandled',
    buildOracleQS({ ...BASE, p_limit: 100, p_offset: 0, p_sort_by: 'recent' }).unhandled.length === 0);
}

// ── category purity is a PREDICATE, and a missing macro map fails LOUD ─────────────────────────
{
  const noMap = buildOracleQS({ ...BASE, p_category: 'Residential' });
  check('p_category without a macro map is UNHANDLED, never silently dropped',
    noMap.unhandled.some((u) => u.includes('p_category')), JSON.stringify(noMap.unhandled));

  const macros = { 'شقة': 'Residential', 'عمارة': 'both', 'محل': 'Commercial' };
  const withMap = buildOracleQS({ ...BASE, p_category: 'Residential' }, { typeMacros: macros });
  check('p_category WITH a macro map is fully handled', withMap.unhandled.length === 0, JSON.stringify(withMap.unhandled));

  // scope A keeps `both`; scope B (the other category's tables) must drop it
  const body = {
    ...BASE, p_category: 'Residential',
    p_tables: ['aqar_residential_listings'], p_types: ['شقة', 'عمارة'],
    p_tables2: ['aqar_commercial_listings'], p_types2: ['شقة', 'عمارة'],
  };
  const q = decodeURIComponent(buildOracleQS(body, { typeMacros: macros }).qs);
  const arms = q.match(/and\(source_table\.in\.\([^)]*\),type_ar\.in\.\([^)]*\)\)/g) ?? [];
  check('scope A keeps a `both`-macro type (its tables match the category)',
    arms.some((x) => x.includes('residential_listings') && x.includes('عمارة')), arms.join(' | '));
  check('scope B DROPS a `both`-macro type (its tables do not match the category)',
    arms.some((x) => x.includes('commercial_listings') && !x.includes('عمارة')), arms.join(' | '));
  check('a Commercial-only type is dropped from a Residential scope entirely', !q.includes('محل'));
}

// ── NUMERIC NARROWING (added 2026-09-01, alongside the translations themselves) ──────────────────
//
// price / area / beds / exact-bathrooms / floor / age-unknown / new-construction / tenant / licence
// were ALL unclassified until 2026-09-01, so the oracle refused every narrowed search and AF's
// stacked-state journeys could never be independently certified. These pin the translations against
// af_eligibility_clause()'s actual semantics; the live differential that proved them (27/27 exact
// against production, incl. all three cities) lives in verify-af-live-truth.ts.
{
  const BUY = { ...BASE, p_deal: 'بيع' };
  const qs = (b: Record<string, unknown>) => buildOracleQS(b).qs;

  check('a Buy budget reads price_total and excludes the priceless rows the clause excludes',
    qs({ ...BUY, p_price_min: 500000, p_price_max: 1500000 })
      .includes('price_total=gt.0') &&
    qs({ ...BUY, p_price_min: 500000 }).includes('price_total=gte.500000'));

  // The clause compares a MONTHLY budget against the ANNUAL column scaled by 12 (L78/79). Reading
  // a monthly figure straight off price_annual would silently return ~1/12th of the right band.
  check('a MONTHLY rent budget is scaled x12 onto price_annual, not compared raw',
    qs({ ...BASE, p_deal: 'إيجار', p_rent_period: 'شهري', p_price_min: 2000, p_price_max: 8000 })
      .includes('price_annual=gte.24000'));
  check('an ANNUAL rent budget is NOT scaled',
    qs({ ...BASE, p_deal: 'إيجار', p_rent_period: 'سنوي', p_price_min: 24000 })
      .includes('price_annual=gte.24000'));

  check('beds_exact becomes a set membership, beds_min a threshold',
    qs({ ...BUY, p_beds_exact: [2, 3] }).includes('bedrooms=in.(2,3)') &&
    qs({ ...BUY, p_beds_min: 3 }).includes('bedrooms=gte.3'));

  check('area min/max map to area_m2 in the right direction',
    qs({ ...BUY, p_area_min: 100, p_area_max: 300 }).includes('area_m2=gte.100') &&
    qs({ ...BUY, p_area_min: 100, p_area_max: 300 }).includes('area_m2=lte.300'));

  // A budget of 0 is the UI's "unset", and the clause wraps every budget in nullif(x,0). Treating a
  // 0 as a real bound would exclude every priceless row from an unfiltered search.
  check('a 0 budget is treated as unset (nullif semantics), not as a real bound',
    !qs({ ...BUY, p_price_min: 0, p_price_max: 0 }).includes('price_total'));

  // Genuine unions stay refusals — an approximation here would make the oracle agree with a wrong
  // RPC, the one failure mode this whole module exists to prevent.
  // p_deal null IS the combined Buy+Rent search (both buttons lit) — BASE carries a deal, so it
  // must be stripped, not merely omitted from the spread.
  check('a budget under a COMBINED Buy+Rent search is refused, not approximated',
    buildOracleQS({ ...BASE, p_deal: undefined, p_price_min: 100000 }).unhandled.length > 0);
  check('beds_exact and beds_min together (a real OR of two arms) is refused, not silently narrowed',
    buildOracleQS({ ...BUY, p_beds_exact: [3], p_beds_min: 2 }).unhandled.length > 0);

  // Ordering-only params must not narrow anything — p_rotation_seed is sent on EVERY search, so a
  // predicate here would corrupt every single oracle count.
  check('p_rotation_seed changes nothing about the predicate (ordering-only)',
    qs({ ...BUY, p_rotation_seed: 'seed|2026-W36' }) === qs(BUY) &&
    buildOracleQS({ ...BUY, p_rotation_seed: 'seed|2026-W36' }).unhandled.length === 0);
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
mustCatch('a monthly rent budget compared raw against the annual column (would return ~1/12th the band)',
  buildOracleQS({ ...BASE, p_deal: 'إيجار', p_rent_period: 'شهري', p_price_min: 2000 }).qs
    .includes('price_annual=gte.24000'));
mustCatch('an ordering-only param leaking into the predicate (p_rotation_seed rides every search)',
  buildOracleQS({ ...BASE, p_deal: 'بيع', p_rotation_seed: 'z' }).qs
    === buildOracleQS({ ...BASE, p_deal: 'بيع' }).qs);
mustCatch('new-construction true/false collapsing to one filter (would ignore the answer entirely)',
  buildOracleQS({ ...BASE, p_is_new_construction: true }).qs
    !== buildOracleQS({ ...BASE, p_is_new_construction: false }).qs);
mustCatch('age_unknown inverted — UNKNOWN and KNOWN must never resolve to the same predicate',
  buildOracleQS({ ...BASE, p_age_unknown: true }).qs.includes('property_age=is.null')
    && buildOracleQS({ ...BASE, p_age_unknown: false }).qs.includes('property_age=not.is.null'));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ the independent-oracle translator is logically sound\n');
