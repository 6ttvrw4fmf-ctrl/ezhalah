// Hermetic mutation-proof of the AF independent-oracle translator (scripts/lib/afOracleFilter.ts).
//
// No browser, no network — the live proof that this translator agrees with production (61 checks,
// 9 real journeys, exact ID sets, zero mismatches) lives in scripts/verify-af-live-truth.ts and its
// scheduled workflow. This file protects the translator's LOGIC on every PR: the specific defect
// classes that would make an "independent oracle" agree with a wrong RPC for the wrong reason —
// the exact failure mode the whole exercise exists to catch (docs comment in afOracleFilter.ts).
//
//   node --experimental-strip-types scripts/verify-af-oracle-filter-translator.ts   (wired into `npm test`)

import { buildOracleQS, directionVariantsFrom } from './lib/afOracleFilter.ts';

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
  // 'كلاهما' (both periods) was UNHANDLED here until 2026-09-02; it is now translated verbatim from
  // the clause and proven in the inconclusive-by-default block below.
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
  // DIRECTIONS (2026-09-02): the index stores «…ي» spellings the RPC normalises, so the oracle must
  // expand each key through a map built from the OBSERVED spellings, and refuse without one.
  {
    const dv = directionVariantsFrom(['شمال', 'شمال شرق', 'شمال شرقي', 'جنوب غربي']);
    check('directionVariantsFrom maps a «…ي» compound onto its canonical key and keeps the key itself',
      !!dv && dv['شمال شرق'].includes('شمال شرق') && dv['شمال شرق'].includes('شمال شرقي') && dv['جنوب غرب'].includes('جنوب غربي'));
    check('directionVariantsFrom REFUSES an unmappable spelling (a ninth bucket must not be silently dropped)',
      directionVariantsFrom(['شمال', 'شمالي شرقي']) === null && directionVariantsFrom(['شرق', 'north']) === null);
    check('directions WITHOUT a variants map are UNHANDLED (a literal match is known to undercount)',
      buildOracleQS({ ...BASE, p_directions: ['شمال شرق'] }).unhandled.some((u) => u.includes('p_directions')));
    const withMap = buildOracleQS({ ...BASE, p_directions: ['شمال شرق'] }, { directionVariants: dv! });
    check('directions WITH a map → direction_ar in (key AND its observed «…ي» spelling)',
      withMap.unhandled.length === 0 &&
      withMap.qs.includes(`direction_ar=in.(${encodeURIComponent('"شمال شرق"')},${encodeURIComponent('"شمال شرقي"')})`));
    check('a key the map does not know is UNHANDLED, not silently matched literally',
      buildOracleQS({ ...BASE, p_directions: ['فوق'] }, { directionVariants: dv! }).unhandled.some((u) => u.includes('p_directions')));
    check('a plain key with no observed variant still translates to itself alone',
      buildOracleQS({ ...BASE, p_directions: ['شمال'] }, { directionVariants: dv! }).qs.includes(`direction_ar=in.(${encodeURIComponent('"شمال"')})`));
  }
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
  // NOTE (2026-09-01 → 2026-09-02): this pair has named p_price_min, then p_rent_period='كلاهما', as
  // its example of an unverified param — each time the translator learned the previous example. The
  // property being pinned is unchanged (a REAL value for an unverified param must be UNHANDLED,
  // while its ABSENCE must not trip anything); the example is now a period that does not exist.
  check('an unverified param with a REAL value is UNHANDLED',
    buildOracleQS({ ...BASE, p_deal: 'إيجار', p_rent_period: 'ربع سنوي' }).unhandled.some((u) => u.includes('p_rent_period')));
  check('the SAME unverified param, absent (null), does not falsely trip unhandled',
    buildOracleQS({ ...BASE, p_rent_period: null }).unhandled.length === 0);
  // BOTH periods (2026-09-02, full-surface sweep): 'كلاهما' is the union of the two known-period
  // arms, translated verbatim from the clause — never "no period filter".
  {
    const both = buildOracleQS({ ...BASE, p_deal: 'إيجار', p_rent_period: 'كلاهما' });
    check('p_rent_period=كلاهما under Rent translates (no longer unhandled)', both.unhandled.length === 0, JSON.stringify(both.unhandled));
    check('…as payment_monthly OR literal-annual OR (monthly-labelled AND RNPL) — all three arms, one or=()',
      both.qs.includes(`or=(payment_monthly.is.true,rent_period_ar.eq.${encodeURIComponent('سنوي')},and(rent_period_ar.eq.${encodeURIComponent('شهري')},rent_now_pay_later.is.true))`));
    check('…and does NOT degrade to "no period filter" (an unpublished period must stay out)',
      !both.qs.includes('rent_period_ar=not.is.null') && both.qs.includes('or=(payment_monthly'));
    check('a period under a NON-Rent deal is REFUSED (the clause skips the period predicate for Buy rows; translating it would filter Buy rows by a rent column)',
      buildOracleQS({ ...BASE, p_deal: 'بيع', p_rent_period: 'سنوي' }).unhandled.some((u) => u.includes('p_rent_period')));
  }
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
  // RESTATED 2026-09-14 (routine #9 red team) — this asserted the MECHANISM, and the mechanism was
  // the defect. It read «scope B DROPS a `both`-macro type», matching a bare
  // `and(source_table.in.(…),type_ar.in.(…))` arm with no عمارة in it. That is PART 3.3 shape 2 of
  // PRODUCTION_RED_TEAM_ENGINEER.md: the expected shape IS the bug. Dropping the type is correct
  // ONLY when arm B is the other kind; on the broad «فئة تجاري» search arm B is the category's OWN
  // kind (p_tables2 = commercial tables, p_types2 = COMMERCIAL_TYPE_AR_COM «incl عمارة») and dropping
  // cost 39 real rows, measured on production at حائل/بيع (330 vs 291).
  //
  // The INVARIANT was never "drop it" — it is «a `both`-macro type may never be selectable from a
  // table of the WRONG kind», which holds on both arms and under either implementation. This is
  // NOT a weakening: the old form accepted exactly one correct implementation and would pass a
  // translator that dropped عمارة from a RIGHT-kind arm B too; this one still refuses the
  // unrestricted list that would actually leak, and additionally pins the retained case.
  const armB = q.match(/and\(source_table\.in\.\(aqar_commercial_listings\),(.*?)\)\)$/)?.[1]
    ?? q.slice(q.indexOf('aqar_commercial_listings'));
  check('scope B never permits a `both`-macro type UNRESTRICTED from wrong-kind tables',
    !/type_ar\.in\.\([^)]*عمارة[^)]*\)(?!\s*,source_table\.like)/.test(armB), armB);
  check('…and where scope B retains it at all, it is pinned to the category’s own table kind',
    !armB.includes('عمارة')
      || armB.includes('and(type_ar.in.("عمارة"),source_table.like.*_residential_listings)'), armB);
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
  // THE REFUSAL IS ASSERTED BY ITS CONTENT, NOT BY ITS COUNT (routine #10, ops_incident #314).
  // These two read `unhandled.length > 0` over a fixture built by spreading BASE and overriding one
  // field. A bare count cannot tell «refused for the reason this line names» from «refused for some
  // other reason BASE already carried», so it would keep passing for the entire life of a defect on
  // the branch it claims to cover — the shape that hid ops_incident #299. Executed 2026-09-19: both
  // fixtures really do reach their own branch, and the control below proves the base alone refuses
  // nothing, so the non-emptiness is caused by the override rather than inherited.
  check('BASE alone is fully translated — a refusal below is caused by the override, not inherited',
    buildOracleQS(BASE).unhandled.length === 0,
    `BASE already refuses: ${JSON.stringify(buildOracleQS(BASE).unhandled)}`);
  check('a budget under a COMBINED Buy+Rent search is refused, not approximated',
    buildOracleQS({ ...BASE, p_deal: undefined, p_price_min: 100000 }).unhandled
      .some((u) => /combined Buy\+Rent|p_deal null/.test(u)),
    JSON.stringify(buildOracleQS({ ...BASE, p_deal: undefined, p_price_min: 100000 }).unhandled));
  check('beds_exact and beds_min together (a real OR of two arms) is refused, not silently narrowed',
    buildOracleQS({ ...BUY, p_beds_exact: [3], p_beds_min: 2 }).unhandled
      .some((u) => u.includes('p_beds_exact') && u.includes('p_beds_min')),
    JSON.stringify(buildOracleQS({ ...BUY, p_beds_exact: [3], p_beds_min: 2 }).unhandled));

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
mustCatch('"both" period silently resolving to "no filter" (would over-match anything: an unpublished period must stay out)',
  (() => {
    const both = buildOracleQS({ ...BASE, p_deal: 'إيجار', p_rent_period: 'كلاهما' });
    const none = buildOracleQS({ ...BASE, p_deal: 'إيجار' });
    return both.unhandled.length === 0 && both.qs !== none.qs && both.qs.includes('or=(payment_monthly.is.true');
  })());
mustCatch('a direction key matched LITERALLY (would drop every «…ي» spelling and report a phantom EXTRA)',
  (() => {
    const dv = directionVariantsFrom(['شمال شرقي']);
    return !!dv && buildOracleQS({ ...BASE, p_directions: ['شمال شرق'] }, { directionVariants: dv }).qs.includes(encodeURIComponent('"شمال شرقي"'));
  })());
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


// ── A `both`-MACRO TYPE MUST BE PINNED TO ITS SOURCE-TABLE KIND ON A MIXED-KIND ARM ─────────────
// Found LIVE on 2026-09-14 (routine #10) by the untyped-category journey ops_incident #176 added to
// the daily corpus. الرياض / بيع / Residential, from the app's own captured request: production
// 23,400, this oracle 23,410 — missing 10, extra 0, every one of them «عمارة» (macro `both`) sitting
// in aldarim_COMMERCIAL_listings on a RESIDENTIAL search.
//
// The defect was not that the rule was unknown. afOracleFilter.ts's header records finding this exact
// shape once before and fixing it by splitting arm A from arm B, on the stated premise that *"scope A
// reads the category's OWN tables"*. That premise is false for the product's commonest search: with no
// نوع picked the app sends ONE scope (p_tables2/p_types2 null) and p_tables carrying BOTH kinds, so
// arm A is not one kind at all. Every journey in the corpus narrowed to a specific نوع, so no
// `both`-macro type ever reached arm A on a mixed-kind table set and the premise was never tested.
//
// It is a FALSE-GREEN mechanism, not merely a false red: had production started leaking
// commercial-table rows into a Residential search, this oracle would have AGREED with the leak.
const MACROS = { 'شقة': 'Residential', 'فيلا': 'Residential', 'عمارة': 'both', 'محل': 'Commercial' };
const MIXED_TABLES = ['aqar_residential_listings', 'aldarim_commercial_listings'];
const RES_SUFFIX = encodeURIComponent('') + '_residential_listings';
const enc1 = (t: string) => encodeURIComponent(`"${t}"`);

{
  // THE DEFECTIVE SHAPE: one scope, mixed-kind tables, a type list containing a `both`-macro type.
  const untyped = { p_deal: 'بيع', p_category: 'Residential', p_region_ids: [1],
    p_tables: MIXED_TABLES, p_types: ['شقة', 'عمارة'], p_tables2: null, p_types2: null };
  const { qs } = buildOracleQS(untyped, { typeMacros: MACROS });
  check('a `both`-macro type on a MIXED-KIND arm is restricted to the category’s own table kind',
    qs.includes(`and(type_ar.in.(${enc1('عمارة')}),source_table.like.*${RES_SUFFIX})`), qs);
  check('…while the category’s own pure type stays unrestricted by table kind',
    qs.includes(`or=(type_ar.in.(${enc1('شقة')}),`), qs);
  mustCatch('the pre-2026-09-14 translation: a bare type_ar in-list that lets «عمارة» in from a COMMERCIAL table on a Residential search',
    !new RegExp(`type_ar=in\\\\.\\\\(${enc1('شقة')},${enc1('عمارة')}\\\\)`).test(qs));
}

{
  // THE SAME SHAPE WITH p_types NULL — the other way the app expresses "no نوع picked".
  const untypedNull = { p_deal: 'بيع', p_category: 'Residential', p_region_ids: [1],
    p_tables: MIXED_TABLES, p_types: null, p_tables2: null, p_types2: null };
  const { qs } = buildOracleQS(untypedNull, { typeMacros: MACROS });
  check('the null-p_types purity list ALSO pins its `both`-macro types to the category’s table kind',
    qs.includes(`source_table.like.*${RES_SUFFIX}`), qs);
}

{
  // NEGATIVE CONTROL 1 — a single-kind arm (the two-scope case this module already handled) must be
  // BYTE-IDENTICAL to before: no like-clause, no logic tree. An over-broad repair would break the
  // nine journeys that are currently green, and this is the line that catches it.
  const singleKind = { p_deal: 'بيع', p_category: 'Residential', p_region_ids: [1],
    p_tables: ['aqar_residential_listings'], p_types: ['شقة', 'عمارة'], p_tables2: null, p_types2: null };
  const { qs } = buildOracleQS(singleKind, { typeMacros: MACROS });
  check('a SINGLE-KIND arm is unchanged — plain type_ar=in.(), no kind restriction (not vacuously strict)',
    qs.includes(`type_ar=in.(${enc1('شقة')},${enc1('عمارة')})`) && !qs.includes('source_table.like'), qs);
}

{
  // NEGATIVE CONTROL 2 — no `both`-macro type in play ⇒ nothing to pin, so nothing changes.
  const noBoth = { p_deal: 'بيع', p_category: 'Residential', p_region_ids: [1],
    p_tables: MIXED_TABLES, p_types: ['شقة', 'فيلا'], p_tables2: null, p_types2: null };
  const { qs } = buildOracleQS(noBoth, { typeMacros: MACROS });
  check('a type list with NO `both`-macro member is unchanged (the repair is scoped to the real case)',
    qs.includes(`type_ar=in.(${enc1('شقة')},${enc1('فيلا')})`) && !qs.includes('source_table.like'), qs);
}

{
  // NEGATIVE CONTROL 3 — the COMMERCIAL direction, which measured CLEAN on production the same day
  // (2,303 == 2,303). The restriction must follow the requested category, not be hardcoded.
  const commercial = { p_deal: 'إيجار', p_category: 'Commercial', p_region_ids: [1],
    p_tables: MIXED_TABLES, p_types: ['محل', 'عمارة'], p_tables2: null, p_types2: null };
  const { qs } = buildOracleQS(commercial, { typeMacros: MACROS });
  check('the kind restriction follows the REQUESTED category (Commercial pins to _commercial_listings)',
    qs.includes('source_table.like.*_commercial_listings') && !qs.includes('source_table.like.*_residential_listings'), qs);
}

// ── …AND ARM B IS NOT ALWAYS "THE OTHER CATEGORY'S TABLES" (the MIRROR of the block above) ───────
// Found LIVE on 2026-09-14 by routine #9 (red team), hours after the arm-A repair above landed —
// the same defect on the other arm, which that repair did not check as a related variant (§G.9(2)).
//
// `keepFor(t,'B')` ended `return m === 'both' && arm === 'A'`, dropping every `both`-macro type from
// arm B. The premise: *"scope B reads the OTHER category's tables"*. FALSE for the broad «فئة تجاري»
// search — searchTableScope() sets p_tables2 = the COMMERCIAL tables and p_types2 =
// COMMERCIAL_TYPE_AR_COM, which remote.ts:1280 defines as "commercial tables: incl عمارة", because in
// a commercial table عمارة IS a commercial building. Arm B is the category's OWN kind there.
//
// MEASURED on production, حائل / بيع / فئة تجاري with no نوع, from the app's own captured request:
//   production (RPC total_count, and the count on screen) ........... 330
//   the oracle before this fix ...................................... 291
//   missing 0 · extra 39 — every one «عمارة» in alobid_/mustqr_commercial_listings.
// Production was RIGHT (af_eligibility_clause() applies category purity to the ROW, not per-arm);
// the ORACLE was wrong. FALSE-GREEN, not merely false-red: were production to stop recovering those
// rows from arm B it would return 291 too, and this oracle would certify the loss as agreement.
//
// WHY NO JOURNEY SAW IT: the corpus's only broad-Commercial cell is Rent-Annual/الرياض, and just 2 of
// the 70 عمارة-in-commercial rows are الرياض/إيجار. The 56 BUY rows (39 in حائل) were never driven.
{
  // THE REAL BROAD-COMMERCIAL SHAPE: arm A = residential tables (misfile recovery, عمارة excluded),
  // arm B = commercial tables carrying عمارة, exactly as searchTableScope() builds it.
  const broadCom = { p_deal: 'بيع', p_category: 'Commercial', p_region_ids: [1],
    p_tables: ['aqar_residential_listings'], p_types: ['محل'],
    p_tables2: ['aldarim_commercial_listings'], p_types2: ['محل', 'عمارة'] };
  const { qs } = buildOracleQS(broadCom, { typeMacros: MACROS });
  check('arm B keeps a `both`-macro type when arm B IS the requested category’s own kind',
    qs.includes(`type_ar.in.(${enc1('محل')},${enc1('عمارة')})`), qs);
  check('…and does not gratuitously pin it by table kind on that single-kind arm',
    !qs.includes('source_table.like'), qs);
  // THE MUTATION: re-implement the pre-fix arm-B translation inline (drop every `both`-macro type)
  // and require the assertion above to REJECT it. A guard that passes on this is blind.
  const preFixT2 = ['محل', 'عمارة'].filter((t) => MACROS[t] === 'Commercial');   // the old keepFor(_, 'B')
  const preFixQs = `or=(and(source_table.in.(aqar_residential_listings),type_ar.in.(${enc1('محل')}))`
    + `,and(source_table.in.(aldarim_commercial_listings),type_ar.in.(${preFixT2.map(enc1).join(',')})))`;
  mustCatch('the pre-fix arm-B translation: «عمارة» dropped from the COMMERCIAL arm of a Commercial search',
    !preFixQs.includes(`type_ar.in.(${enc1('محل')},${enc1('عمارة')})`) && !qs.includes(preFixQs));
}

{
  // NEGATIVE CONTROL — the Residential misfile-recovery arm B (tables2 = COMMERCIAL tables on a
  // RESIDENTIAL search) is the case the old premise described correctly, and it must still resolve to
  // "contributes nothing": عمارة pinned to `%_residential_listings` contradicts source_table.in.(a
  // commercial table). The rule now comes from typeConjunct rather than from dropping the type, so
  // the ANSWER is unchanged while the REASON is production's.
  const resMisfile = { p_deal: 'بيع', p_category: 'Residential', p_region_ids: [1],
    p_tables: ['aqar_residential_listings'], p_types: ['شقة'],
    p_tables2: ['aldarim_commercial_listings'], p_types2: ['شقة', 'عمارة'] };
  const { qs } = buildOracleQS(resMisfile, { typeMacros: MACROS });
  check('a `both`-macro type on a WRONG-kind arm B is pinned to the category’s kind (so it matches nothing)',
    qs.includes(`and(type_ar.in.(${enc1('عمارة')}),source_table.like.*${RES_SUFFIX})`), qs);
}

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ the independent-oracle translator is logically sound\n');
