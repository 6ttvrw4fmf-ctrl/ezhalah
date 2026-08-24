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

const AMENITY_COLS = new Set([
  'kitchen', 'parking', 'elevator', 'private_entrance', 'car_entrance', 'sanitation', 'electricity',
  'water_supply', 'balcony', 'laundry_room', 'pool', 'gym', 'garden', 'separate_electricity_meter',
  'separate_water_meter', 'air_conditioner', 'maid_room', 'driver_room', 'optical_fibers',
]);

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
      case 'p_amenities':
        for (const tok of v as string[]) {
          if (tok === 'rnpl') { parts.push(`rent_now_pay_later=is.true`); continue; }
          if (!AMENITY_COLS.has(tok)) { unhandled.push(`p_amenities:${tok}`); continue; }
          parts.push(`${tok}=is.true`);
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
