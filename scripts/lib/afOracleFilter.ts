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
  // Added 2026-08-31: these 8 were the exact tokens the 2026-08-24 header comment above names as
  // "the clause REJECTS fail-closed" at the time — now genuinely certified
  // (20260831205347_af_amenity_tokens_residential_rich_set.sql), so the oracle catching up here
  // closes the loop this file's own history describes, rather than reopening the old drift.
  gym: 'gym',
  pool: 'pool',
  garden: 'garden',
  balcony: 'balcony',
  laundry_room: 'laundry_room',
  optical_fibers: 'optical_fibers',
  separate_electricity_meter: 'separate_electricity_meter',
  separate_water_meter: 'separate_water_meter',
  furnished: 'furnished',
  rnpl: 'rent_now_pay_later',
  rent_now_pay_later: 'rent_now_pay_later',
};

export type OracleOpts = {
  /** type_ar → macro ('Residential' | 'Commercial' | 'both'), read from the same `known_type_ar`
   *  reference table the RPC's category-purity clause reads. Required whenever p_category is set. */
  typeMacros?: Record<string, string>;
};

export function buildOracleQS(reqBody: RpcBody, opts?: OracleOpts): { qs: string; unhandled: string[] } {
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

  // CATEGORY PURITY IS A REAL PREDICATE, NOT PAGING METADATA (found live 2026-08-28).
  //
  // `p_category` used to sit in the "genuinely irrelevant … always safe" list below and was simply
  // `break`-ed past. It is not irrelevant: af_eligibility_clause() carries
  //
  //   and (p_category is null or exists (select 1 from known_type_ar k where k.type_ar = s.type_ar
  //        and (k.macro = p_category
  //             or (k.macro = 'both' and (case p_category
  //                   when 'Residential' then s.source_table like '%\_residential\_listings' …)))))
  //
  // so a `both`-macro type is eligible ONLY from the table matching the requested category. Ignoring
  // that had two costs, and the second is the serious one:
  //   1. FALSE DIFFERENTIALS. المدينة المنورة / Residential Building / Buy reported oracle 708 vs
  //      RPC 707, stable across two passes. The one row was dealapp_commercial_listings:8218315,
  //      type_ar «عمارة», macro `both`, in a COMMERCIAL table on a RESIDENTIAL search — production
  //      correctly excluded it; the oracle wrongly kept it.
  //   2. IT COULD NOT CATCH THE REGRESSION IT EXISTS FOR. If production ever started leaking
  //      commercial-table rows into a Residential search, the oracle would have agreed with the
  //      leak instead of flagging it — the check would be green over the exact defect
  //      verify-null-category-purity.ts was written about.
  //
  // The fix is exact rather than approximate, because the two arms have different table sets:
  //   • scope A reads the category's OWN tables, so `macro === category` AND `macro === 'both'` both
  //     survive purity there;
  //   • scope B reads the OTHER category's tables, so ONLY `macro === category` survives — a `both`
  //     type in the wrong table is precisely what the clause removes.
  // Callers pass `typeMacros` (type_ar → macro) read from the same `known_type_ar` the RPC reads.
  // Without it, `p_category` is reported UNHANDLED rather than silently dropped: an oracle that goes
  // quiet on a predicate it does not understand is the thing this module's header forbids.
  const category = reqBody.p_category as string | undefined;
  const macros = opts?.typeMacros;
  const keepFor = (type: string, arm: 'A' | 'B'): boolean => {
    if (!category || !macros) return true;
    const m = macros[type];
    if (m === undefined) return true;              // unknown to the reference table → leave as-is
    if (m === category) return true;
    return m === 'both' && arm === 'A';
  };
  if (category && !macros) unhandled.push(`p_category=${category} (no typeMacros supplied — category purity cannot be applied)`);

  if (hasScopeB) {
    const tables = (reqBody.p_tables as string[] | undefined) ?? [];
    const types = ((reqBody.p_types as string[] | undefined) ?? []).filter((t) => keepFor(t, 'A'));
    const t2 = (types2 as string[]).filter((t) => keepFor(t, 'B'));
    const a = `and(source_table.in.(${tables.map((x) => enc(x)).join(',')}),type_ar.in.(${types.map((x) => enc(`"${x}"`)).join(',')}))`;
    // Scope B can legitimately empty out — every requested type being `both`-macro means the
    // commercial arm contributes nothing, which is what production computes too.
    const b = t2.length
      ? `and(source_table.in.(${(tables2 as string[]).map((x) => enc(x)).join(',')}),type_ar.in.(${t2.map((x) => enc(`"${x}"`)).join(',')}))`
      : null;
    parts.push(b ? `or=(${a},${b})` : a);
  }

  // ── NUMERIC NARROWING, TRANSLATED VERBATIM FROM af_eligibility_clause() (2026-09-01) ────────────
  //
  // Until today NONE of price / area / bedrooms / exact-bathrooms / floor / age-unknown /
  // new-construction / tenant / licence was classified here, so every one of them fell to the
  // `default:` arm and reported UNHANDLED. Fail-closed is the right posture for an unknown param,
  // but the consequence was that the independent oracle could never certify a NARROWED search —
  // exactly the journeys AF exists for. The ledger's stacked-state proofs had to be hand-rolled in
  // SQL precisely because the oracle refused them.
  //
  // Each translation below is taken from the live clause body, not inferred (line numbers are
  // af_eligibility_clause()'s own):
  //   L56/57  area  : nullif(p_area_*,0) is null or (area_m2 is not null and area_m2 >=/<= …)
  //   L58-60  bath  : exact wins when non-empty; p_bath_min applies ONLY when exact is empty
  //   L61     beds  : same shape — exact when non-empty, min otherwise
  //   L62-79  price : see the price block below
  //   L84     age_unknown        : (property_age is null) = p_age_unknown
  //   L85     new construction   : (property_age = 0)      = p_is_new_construction
  //   L86     tenant             : tenant_ar = p_tenant
  //   L88     licence            : (license_number is not null) = p_has_license
  //   L116-118 floor             : floor_number between coalesce(min,0) and coalesce(max,maxint)
  //
  // Anything whose SQL is a genuine UNION of arms (beds exact AND min together; price under a
  // combined Buy+Rent search) stays UNHANDLED rather than being approximated — a wrong translation
  // is worse than a refusal, because it makes the oracle agree with a wrong RPC.
  const nz = (x: unknown): number | null => {
    const n = Number(x);                                   // mirrors SQL nullif(x, 0)
    return Number.isFinite(n) && n !== 0 ? n : null;
  };
  const nonEmpty = (x: unknown): unknown[] | null =>
    (Array.isArray(x) && x.length > 0 ? x : null);

  // beds / bathrooms — exact and min are alternative arms of one OR, never both at once in practice.
  for (const [exactKey, minKey, col] of [
    ['p_beds_exact', 'p_beds_min', 'bedrooms'],
    ['p_bath_exact', 'p_bath_min', 'bathrooms'],
  ] as const) {
    const exact = nonEmpty(reqBody[exactKey]);
    const min = reqBody[minKey];
    if (exact && min != null) {
      unhandled.push(`${exactKey}+${minKey} together (clause unions the two arms — not translated)`);
    } else if (exact) {
      parts.push(`${col}=in.(${(exact as (number | string)[]).map((x) => enc(x)).join(',')})`);
    } else if (min != null) {
      parts.push(`${col}=gte.${enc(min)}`);                // gte already excludes NULL, as the clause does
    }
  }

  // price — the clause has two regimes (L62-79). Under a SINGLE deal the budget reads the column
  // for that deal, and p_price_min_rent/p_price_max_rent are not referenced at all. Under a
  // COMBINED Buy+Rent search (p_deal null) it is a union of two differently-parameterised arms;
  // that is NOT translated here and is reported honestly instead.
  {
    const deal = reqBody.p_deal as string | undefined;
    const pMin = nz(reqBody.p_price_min);
    const pMax = nz(reqBody.p_price_max);
    const rMin = nz(reqBody.p_price_min_rent);
    const rMax = nz(reqBody.p_price_max_rent);
    const anyBudget = pMin != null || pMax != null || rMin != null || rMax != null;
    if (deal == null) {
      if (anyBudget) unhandled.push('price budget under a combined Buy+Rent search (p_deal null) — clause unions two arms, not translated');
    } else if (pMin != null || pMax != null) {
      if (deal === 'بيع') {
        parts.push('price_total=gt.0');
        if (pMin != null) parts.push(`price_total=gte.${pMin}`);
        if (pMax != null) parts.push(`price_total=lte.${pMax}`);
      } else if (deal === 'إيجار') {
        // L78/79: a MONTHLY budget is compared against the ANNUAL column, scaled by 12.
        const mult = reqBody.p_rent_period === 'شهري' ? 12 : 1;
        parts.push('price_annual=gt.0');
        if (pMin != null) parts.push(`price_annual=gte.${pMin * mult}`);
        if (pMax != null) parts.push(`price_annual=lte.${pMax * mult}`);
      } else {
        unhandled.push(`price budget under p_deal=${deal} (unrecognised deal)`);
      }
    }
  }

  // floor — one range over a NOT NULL floor_number (L116-118).
  {
    const fMin = reqBody.p_floor_min;
    const fMax = reqBody.p_floor_max;
    if (fMin != null) parts.push(`floor_number=gte.${enc(fMin)}`);
    if (fMax != null) parts.push(`floor_number=lte.${enc(fMax)}`);
    if (fMin == null && fMax != null) parts.push('floor_number=gte.0');   // clause's coalesce(p_floor_min, 0)
  }

  for (const [k, v] of Object.entries(reqBody)) {
    if (v == null || (Array.isArray(v) && v.length === 0)) continue;
    switch (k) {
      case 'p_deal': parts.push(`deal_ar=eq.${enc(v)}`); break;
      case 'p_tables': if (!hasScopeB) parts.push(`source_table=in.(${(v as string[]).map((x) => enc(x)).join(',')})`); break;
      case 'p_types': if (!hasScopeB) parts.push(`type_ar=in.${inList((v as string[]).filter((t) => keepFor(t, 'A')))}`); break;
      case 'p_tables2': case 'p_types2': break; // folded into the or=() above when hasScopeB
      case 'p_region_ids': parts.push(`region_id=in.(${(v as number[]).join(',')})`); break;
      case 'p_cities': parts.push(`city_ar=in.${inList(v as string[])}`); break;
      case 'p_districts': parts.push(`district_ar=in.${inList(v as string[])}`); break;
      case 'p_rent_period':
        if (v === 'سنوي') parts.push(`or=(rent_period_ar.eq.${enc('سنوي')},and(rent_period_ar.eq.${enc('شهري')},rent_now_pay_later.is.true))`);
        else if (v === 'شهري') parts.push(`payment_monthly=is.true&rent_now_pay_later=not.is.true`);
        else unhandled.push(`p_rent_period=${v}`); // includes 'كلاهما' (both) — not yet verified
        break;
      // beds/bath/price/floor are handled ABOVE, where the clause's exact-vs-min and
      // single-vs-combined-deal interactions are visible; here they must not be re-applied.
      case 'p_beds_exact': case 'p_beds_min': case 'p_bath_exact': case 'p_bath_min':
      case 'p_price_min': case 'p_price_max': case 'p_price_min_rent': case 'p_price_max_rent':
      case 'p_floor_min': case 'p_floor_max':
        break;
      case 'p_area_min': parts.push(`area_m2=gte.${enc(v)}`); break;
      case 'p_area_max': parts.push(`area_m2=lte.${enc(v)}`); break;
      // L84: (property_age is null) = p_age_unknown
      case 'p_age_unknown': parts.push(v === true ? 'property_age=is.null' : 'property_age=not.is.null'); break;
      // L85: (property_age = 0) = p_is_new_construction. `neq.0` excludes NULL ages exactly as the
      // SQL does — (NULL = 0) is NULL, which is not `false`, so a NULL-age row fails either arm.
      case 'p_is_new_construction': parts.push(v === true ? 'property_age=eq.0' : 'property_age=neq.0'); break;
      case 'p_tenant': parts.push(`tenant_ar=eq.${enc(v)}`); break;
      // L88: (license_number is not null) = p_has_license
      case 'p_has_license': parts.push(v === true ? 'license_number=not.is.null' : 'license_number=is.null'); break;
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
      case 'p_sort_by':
      // ORDERING-ONLY, PROVEN AGAINST THE LIVE RPC BODY (2026-09-01). p_rotation_seed shipped in
      // PR #1361 (2026-08-30) and, being sent on EVERY search, immediately made this oracle refuse
      // 100% of requests — verify-af-live-truth.ts and its scheduled workflow went red on
      // 2026-08-30T18:33Z and stayed red, so AF's deepest correctness check produced no verdict at
      // all for three days. It is safe to skip because it is not a predicate: in
      // location_search_candidates_ar it occurs exactly twice outside the signature, both times
      // inside `case when …sort… and p_rotation_seed is not null then hashtext(source_table||':'||
      // listing_id||':'||p_rotation_seed) end as rot_key` — a PROJECTED ORDER BY key. It appears in
      // no WHERE clause and cannot move total_count. (Verified by reading pg_get_functiondef on
      // production, not from the client-side comment in src/lib/rotationSeed.ts.)
      case 'p_rotation_seed':
        break;
      // handled above, as a real predicate — never as paging metadata
      case 'p_category': break;
      // NOT verified — a real value here fails loud rather than being silently ignored.
      default: unhandled.push(`${k}=${JSON.stringify(v)}`);
    }
  }
  return { qs: parts.join('&'), unhandled };
}
