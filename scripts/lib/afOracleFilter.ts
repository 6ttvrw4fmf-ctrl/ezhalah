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
  /** The literal `district_ar` values present in the index. Required whenever p_districts is set —
   *  see the p_districts case for why a literal match alone is not sound. */
  knownDistricts?: Iterable<string>;
  /** canonical direction key → every literal `direction_ar` spelling the index stores for it.
   *  Required whenever p_directions is set — see the p_directions case. Build it with
   *  `directionVariantsFrom()` below from the DISTINCT values actually in search_listings_ar. */
  directionVariants?: Record<string, string[]>;
};

/** The eight canonical direction keys the product offers (src/data/advancedFilters.ts DIRECTION_DEFS). */
export const CANONICAL_DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب', 'شمال شرق', 'شمال غرب', 'جنوب شرق', 'جنوب غرب'] as const;

/**
 * Map every literal direction spelling the index stores onto its canonical key, INDEPENDENTLY of
 * the server's norm_direction_ar(): the only rule applied is Arabic morphology — a compound
 * direction may carry the nisba suffix «ي» on its last word («شمال شرقي» = «شمال شرق»). Measured on
 * the live index (2026-09-02): exactly 12 distinct spellings, the 8 canonical keys plus the 4
 * «ي»-suffixed compounds, 92,130 rows, 0 outliers.
 *
 * Returns `null` if ANY observed spelling maps to no canonical key or to more than one: the caller
 * must then refuse to translate p_directions rather than silently undercount — a ninth bucket in the
 * data is exactly the drift verify-af-unknown-count-truthful.ts exists to catch.
 */
export function directionVariantsFrom(observed: Iterable<string>): Record<string, string[]> | null {
  const map: Record<string, string[]> = Object.fromEntries(CANONICAL_DIRECTIONS.map((k) => [k, [k]]));
  for (const raw of observed) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    const hits = CANONICAL_DIRECTIONS.filter((k) => v === k || v === `${k}ي`);
    if (hits.length !== 1) return null;
    if (!map[hits[0]].includes(v)) map[hits[0]].push(v);
  }
  return map;
}

export function buildOracleQS(reqBody: RpcBody, opts?: OracleOpts): { qs: string; unhandled: string[] } {
  const parts = ['production_ready=is.true'];
  const unhandled: string[] = [];

  // `production_ready=is.true` IS NOT THE WHOLE ADMISSION RULE (found live 2026-09-01).
  //
  // af_eligibility_clause() admits:
  //
  //   production_ready
  //   OR ( no city AND no district AND no region
  //        AND not search_row_price_gated(deal_ar, price_total)
  //        AND (region_id is null or city_id is null) )
  //
  // — the UNLOCATED carve-out: on a search with NO location narrowing, a listing we could not place
  // on the map is still shown rather than hidden. Measured on Duplex/Buy nationwide: the RPC
  // returned 125 and this oracle 124, the difference being exactly one unlocated row
  // (ramzalqasim_residential_listings:615862, type_ar «دوبلكس», production_ready false, city_ar
  // null). The oracle was UNDER-counting, which surfaces as a phantom EXTRA — a false alarm against
  // a correct production search.
  //
  // The moment ANY location narrowing is present the carve-out is disabled by construction, so
  // `production_ready=is.true` is then exact — which is why every existing journey (they all pick a
  // city) has always agreed. Only the location-less case is affected.
  //
  // It is NOT modelled here. It depends on search_row_price_gated(), which is our own SQL —
  // currently neutralised to constant false, but reproducing it would make this "independent"
  // oracle depend on a guess about the server, the exact thing this module must never do (same
  // reasoning as p_districts below). So the location-less case is REFUSED, and the caller decides:
  // scope the check to a city, or verify that case by other means.
  {
    const arr = (x: unknown) => (Array.isArray(x) ? x.length : 0);
    const hasLocation = arr(reqBody.p_cities) > 0 || arr(reqBody.p_districts) > 0 || arr(reqBody.p_region_ids) > 0;
    if (!hasLocation) {
      unhandled.push('no location narrowing — af_eligibility_clause() then also admits UNLOCATED non-production_ready rows (carve-out), which this oracle does not model');
    }
  }
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
      // DISTRICTS ARE NOT MATCHED LITERALLY BY PRODUCTION (found live 2026-09-01).
      //
      // The clause matches `norm_district_tok(s.district_ar) = any(district_tokens)`, where
      // district_tokens is norm_district_tok() over p_districts PLUS a guarded alias expansion. A
      // plain `district_ar=in.(…)` therefore agrees only when every requested name happens to be
      // stored verbatim. Measured on a live Trending click-through: the request carried
      // «حي المهدية», the index stores «المهدية», and the naive filter returned 0 against the RPC's
      // 1,796 — a false differential on a healthy production search.
      //
      // The normalisation cannot be reproduced through PostgREST (no normalised column is exposed),
      // and re-implementing norm_district_tok here would make the "independent" oracle depend on a
      // guess about our own SQL — the one thing this module must never do. So it takes the same
      // route p_category already takes: read the REFERENCE DATA (the district_ar values actually in
      // the index) and refuse when a requested name is not among them, rather than silently
      // emitting a filter that undercounts.
      case 'p_districts': {
        const known = opts?.knownDistricts ? new Set(opts.knownDistricts) : null;
        if (!known) {
          unhandled.push('p_districts (no knownDistricts supplied — the RPC normalises district names, so a literal match cannot be trusted)');
          break;
        }
        const missing = (v as string[]).filter((d) => !known.has(d));
        if (missing.length) {
          unhandled.push(`p_districts:${missing.join('|')} (not stored verbatim — needs the RPC's norm_district_tok/alias resolution)`);
          break;
        }
        parts.push(`district_ar=in.${inList(v as string[])}`);
        break;
      }
      case 'p_rent_period':
        // The clause's period predicate is `p_rent_period is null OR s.deal_ar <> 'إيجار' OR (…)`:
        // under any deal other than Rent it is a no-op, and the translations below would then
        // wrongly filter Buy rows by a rent column. The app never sends a period without
        // p_deal='إيجار' (rentPeriodParam returns null otherwise), so this is refused, not modelled.
        if (reqBody.p_deal !== 'إيجار') { unhandled.push(`p_rent_period=${v} with p_deal=${JSON.stringify(reqBody.p_deal ?? null)} (the clause only applies a period to Rent rows)`); break; }
        if (v === 'سنوي') parts.push(`or=(rent_period_ar.eq.${enc('سنوي')},and(rent_period_ar.eq.${enc('شهري')},rent_now_pay_later.is.true))`);
        else if (v === 'شهري') parts.push(`payment_monthly=is.true&rent_now_pay_later=not.is.true`);
        // BOTH periods (rentPeriod 'both' → 'كلاهما'), translated VERBATIM from the clause (2026-09-02):
        //   p_rent_period = 'كلاهما' and (s.payment_monthly = true
        //                                 or s.rent_period_ar = 'سنوي'
        //                                 or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later,false)))
        // It is the union of the two single-period arms — NOT "no period filter": a rent row whose
        // source published no period at all stays OUT (R1.5.1; migration rent_period_both_monthly_and_annual).
        else if (v === 'كلاهما') parts.push(`or=(payment_monthly.is.true,rent_period_ar.eq.${enc('سنوي')},and(rent_period_ar.eq.${enc('شهري')},rent_now_pay_later.is.true))`);
        else unhandled.push(`p_rent_period=${v}`);
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
      // DIRECTIONS ARE NOT STORED CANONICALLY (found 2026-09-02, full-surface sweep). The clause
      // compares norm_direction_ar() on BOTH sides, and the index holds «شمال شرقي» (3,978 rows) next
      // to «شمال شرق» (the key the chip sends). A literal `direction_ar=in.(key)` therefore UNDERCOUNTS
      // every compound direction and reports a phantom EXTRA against a correct production search.
      // Same route as p_category / p_districts: read the observed spellings from the index, map them
      // with a rule that owes nothing to our SQL (directionVariantsFrom), and REFUSE when no map was
      // supplied or a requested key is not in it — never emit a filter known to undercount.
      case 'p_directions': {
        const dv = opts?.directionVariants;
        if (!dv) { unhandled.push('p_directions (no directionVariants supplied — the index stores «…ي» spellings the RPC normalises, so a literal match undercounts)'); break; }
        const keys = v as string[];
        const missing = keys.filter((k) => !dv[k]);
        if (missing.length) { unhandled.push(`p_directions:${missing.join('|')} (not a canonical direction key)`); break; }
        parts.push(`direction_ar=in.${inList(keys.flatMap((k) => dv[k]))}`);
        break;
      }
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
