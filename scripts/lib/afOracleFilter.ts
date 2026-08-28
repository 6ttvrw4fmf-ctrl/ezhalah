// THE independent Advanced Filter oracle — translates a captured location_search_candidates_ar
// request body into PostgREST filter querystring against search_listings_ar DIRECTLY.
//
// "Independent" means genuinely independent: PostgREST's `gte`/`eq`/`in`/`is` filter engine is
// implemented by PostgREST, not by us, so agreement between it and our RPC is real evidence about
// what a predicate MEANS — not a restatement of our own SQL. A defect that makes the RPC's SQL
// uniformly wrong (right operator direction, wrong threshold; NULL leaking through) would still
// agree with itself no matter how many of our own components re-check it. This does not.
//
// Params outside the verified set below make the caller report the journey INCONCLUSIVE (via
// `unhandled`) rather than silently skip the param — an oracle that goes quiet on what it doesn't
// understand is worse than one that says so.
//
// Extracted (2026-08-24, AF backend-truth audit) from a browser-first capture-and-diff tool so the
// translation logic itself can be mutation-tested without a browser or a network call — see
// scripts/verify-af-oracle-filter-translator.ts.

export type RpcBody = Record<string, unknown>;

// TOKEN → COLUMN, mirroring the production `af_eligibility_clause()` vocabulary guard exactly.
//
// This is a MAP, not a set of column names, because the token the RPC receives is not always the
// column it filters: the clause reads «'ac' → s.air_conditioner» and «'rnpl'/'rent_now_pay_later'
// → s.rent_now_pay_later». The previous version listed COLUMN names as if they were tokens, so the
// two most common real chips were invisible to the oracle:
//
//   • 'ac' (Air conditioning) — 2,831 of the 11,153 Riyadh/Rent-Annual/شقة cohort, the single
//     biggest amenity chip in production — resolved to `unhandled`, and
//   • 'furnished' (the amenity-question chip, distinct from the p_furnished question)
//
// so `verify-af-live-truth.ts` reported "independent oracle covers every predicate in this
// request" = FAIL for any journey that ticked either one. It fails CLOSED (loud), which is why no
// wrong number ever shipped — but the oracle could never certify those journeys, and the corpus
// simply never ticked them. The reverse drift was live too: the set carried nine tokens the clause
// REJECTS fail-closed (balcony, laundry_room, pool, gym, garden, separate_*_meter, optical_fibers),
// for which the oracle would have happily filtered a column while the RPC returned zero rows.
//
// `verify-af-multiselect-combining-semantics.ts` now derives the clause's vocabulary from the
// replayed migrations and fails if this map drifts from it in either direction.
const AMENITY_TOKEN_COL: Record<string, string> = {
  elevator: 'elevator',
  parking: 'parking',
  kitchen: 'kitchen',
  ac: 'air_conditioner',
  maid_room: 'maid_room',
  driver_room: 'driver_room',
  private_entrance: 'private_entrance',
  car_entrance: 'car_entrance',
  sanitation: 'sanitation',
  electricity: 'electricity',
  water_supply: 'water_supply',
  furnished: 'furnished',
  rnpl: 'rent_now_pay_later',
  rent_now_pay_later: 'rent_now_pay_later',
};

export function buildOracleQS(reqBody: RpcBody): { qs: string; unhandled: string[] } {
  const parts = ['production_ready=is.true'];
  const unhandled: string[] = [];
  const enc = (s: unknown) => encodeURIComponent(String(s));
  const inList = (arr: unknown[]) => `(${arr.map((x) => enc(`"${x}"`)).join(',')})`;

  // Every Residential search attaches a SECOND scope (owner: attachResScopeB in resolveSearchScope,
  // src/data/remote.ts ~602) — the SAME types read from the *_commercial_listings tables too, because
  // a residential-sounding type_ar genuinely appears there (verified live 2026-08-24: mustqr/dealapp
  // commercial rows carry type_ar='فيلا'/'شقة' outside Riyadh). Treating p_tables2/p_types2 as a
  // no-op is WRONG whenever present — the true predicate is scope A OR scope B, as one `or=()`.
  const tables2 = reqBody.p_tables2 as string[] | undefined;
  const types2 = reqBody.p_types2 as string[] | undefined;
  const hasScopeB = Array.isArray(tables2) && tables2.length > 0 && Array.isArray(types2) && types2.length > 0;
  if (hasScopeB) {
    const tables = (reqBody.p_tables as string[] | undefined) ?? [];
    const types = (reqBody.p_types as string[] | undefined) ?? [];
    const a = `and(source_table.in.(${tables.map((x) => enc(x)).join(',')}),type_ar.in.(${types.map((x) => enc(`"${x}"`)).join(',')}))`;
    const b = `and(source_table.in.(${(tables2 as string[]).map((x) => enc(x)).join(',')}),type_ar.in.(${(types2 as string[]).map((x) => enc(`"${x}"`)).join(',')}))`;
    parts.push(`or=(${a},${b})`);
  }

  for (const [k, v] of Object.entries(reqBody)) {
    if (v == null || (Array.isArray(v) && v.length === 0)) continue;
    switch (k) {
      case 'p_deal': parts.push(`deal_ar=eq.${enc(v)}`); break;
      case 'p_tables': if (!hasScopeB) parts.push(`source_table=in.(${(v as string[]).map((x) => enc(x)).join(',')})`); break;
      case 'p_types': if (!hasScopeB) parts.push(`type_ar=in.${inList(v as string[])}`); break;
      case 'p_tables2': case 'p_types2': break; // folded into the or=() above when hasScopeB
      case 'p_region_ids': parts.push(`region_id=in.(${(v as number[]).join(',')})`); break;
      case 'p_cities': parts.push(`city_ar=in.${inList(v as string[])}`); break;
      case 'p_districts': parts.push(`district_ar=in.${inList(v as string[])}`); break;
      case 'p_rent_period':
        if (v === 'سنوي') parts.push(`or=(rent_period_ar.eq.${enc('سنوي')},and(rent_period_ar.eq.${enc('شهري')},rent_now_pay_later.is.true))`);
        else if (v === 'شهري') parts.push(`payment_monthly=is.true&rent_now_pay_later=not.is.true`);
        else unhandled.push(`p_rent_period=${v}`); // includes 'كلاهما' (both) — not yet verified
        break;
      case 'p_bath_min': parts.push(`bathrooms=gte.${v}`); break;
      case 'p_furnished': parts.push(`furnished=is.${v}`); break;
      case 'p_age_min': parts.push(`property_age=gte.${v}`); break;
      case 'p_age_max': parts.push(`property_age=lte.${v}`); break;
      case 'p_street_width_min': parts.push(`street_width_m=gte.${v}`); break;
      case 'p_street_width_max': parts.push(`street_width_m=lte.${v}`); break;
      case 'p_directions': parts.push(`direction_ar=in.${inList(v as string[])}`); break;
      case 'p_rating_min': parts.push(`rating=gte.${v}`); break;
      case 'p_reviews_min': parts.push(`reviews_count=gte.${v}`); break;
      case 'p_unit_subtypes': parts.push(`unit_subtype_ar=in.${inList(v as string[])}`); break;
      // MULTI-AMENITY IS AND (R7.2.2). Each ticked chip is its own boolean column, so every token
      // appends its OWN conjunctive part — PostgREST joins top-level filters with AND, matching the
      // clause's `and (not ('tok' = any(p_amenities)) or s.col)` chain. Collapsing these into one
      // `or.(...)` would silently turn every multi-amenity answer into a union.
      case 'p_amenities':
        for (const tok of v as string[]) {
          const col = AMENITY_TOKEN_COL[tok];
          if (!col) { unhandled.push(`p_amenities:${tok}`); continue; }
          parts.push(`${col}=is.true`);
        }
        break;
      // genuinely irrelevant to the WHERE clause (paging/sorting/informational), always safe:
      case 'p_platforms': case 'p_per_platform': case 'p_limit': case 'p_offset':
      case 'p_sort_by': case 'p_category':
        break;
      // NOT verified — a real value here fails loud rather than being silently ignored.
      default: unhandled.push(`${k}=${JSON.stringify(v)}`);
    }
  }
  return { qs: parts.join('&'), unhandled };
}
