// THE CERTIFIED ADVANCED-FILTER MATRIX, DERIVED BY EXECUTION — and the MEANING of every option.
//
// Two barriers share this module: verify-af-matrix-truth.ts (offline, npm test) and
// verify-af-matrix-truth-live.ts (production + the real DB, af-live-truth-check.yml). Both walk the
// SAME matrix, built the same way, so a cell the offline tier proves is a cell the live tier
// measures — nothing is enumerated twice by hand.
//
// HOW THE MATRIX IS BUILT. Never from a list. Every scope (each clean type, each group) is crossed
// with every deal/period mode, and for each the REAL question pool is asked: the lifted
// ADVANCED_QUESTIONS array from src/data/advancedFilters.ts, each question's own eligibility()
// (which reaches the real cohortAllows() in src/lib/afCohorts.ts, unmocked) and its own
// resolveOptions() (real cohort/chip logic — only the count FETCH is shimmed, because counts decide
// how many options are worth SHOWING, never which options exist). A cohort, question or option
// certified tomorrow is in the matrix tomorrow with no edit here.
//
// WHAT "MEANING" IS. optionMeaning() is the one hand-written table in this module, and it is
// deliberately NOT derived from the code it judges: for each option KEY it states what the option
// means in three independent vocabularies — the RPC params the app must send, the count column the
// card must read, and the predicate on search_listings_ar's CANONICAL columns expressed as
// PostgREST filters (match / known-but-not-matching / unknown) plus a plain JS predicate over a
// fetched row. An option key with no meaning FAILS the barrier: a new option cannot ship
// unspecified.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { liftSymbols } from './liftSymbols.ts';
import { COHORT_QUESTIONS } from '../../src/lib/afCohorts.ts';
import { CLEAN_MACRO, ALL_CLEAN_TYPES, HIERARCHY, groupsOf, groupMembers } from '../../src/data/propertyTypes.ts';
import type { SearchQuery } from '../../src/data/search.ts';

export type Leg = 'Buy' | 'RentAnnual' | 'RentMonthly';
export type Mode = {
  mode: string;
  /** SearchQuery fields that put a query into this mode. */
  fields: Partial<SearchQuery>;
  /** The COHORT_QUESTIONS legs a question must be listed under to be certified in this mode. */
  legs: Leg[];
  /** What the request boundary sends (remote.ts p_deal / rentPeriodParam). */
  p_deal: string | null;
  p_rent_period: string | null;
};

// Six modes. RentBoth and the two combined-deal shapes are INTERSECTIONS of legs — the rule
// afCohorts.ts documents; here it is restated as DATA so the gate can be checked against it.
export const MODES: Mode[] = [
  { mode: 'Buy',          fields: { deal: 'Buy',  rentPeriod: 'annual' },  legs: ['Buy'],         p_deal: 'بيع',   p_rent_period: null },
  { mode: 'RentAnnual',   fields: { deal: 'Rent', rentPeriod: 'annual' },  legs: ['RentAnnual'],  p_deal: 'إيجار', p_rent_period: 'سنوي' },
  { mode: 'RentMonthly',  fields: { deal: 'Rent', rentPeriod: 'monthly' }, legs: ['RentMonthly'], p_deal: 'إيجار', p_rent_period: 'شهري' },
  { mode: 'RentBoth',     fields: { deal: 'Rent', rentPeriod: 'both' },    legs: ['RentAnnual', 'RentMonthly'], p_deal: 'إيجار', p_rent_period: 'كلاهما' },
  { mode: 'dealCombined', fields: { deal: 'Buy',  rentPeriod: 'annual', dealCombined: true }, legs: ['Buy', 'RentAnnual', 'RentMonthly'], p_deal: null, p_rent_period: null },
  { mode: 'bothDeals',    fields: { deal: 'Rent', rentPeriod: 'annual', bothDeals: true },    legs: ['Buy', 'RentAnnual', 'RentMonthly'], p_deal: null, p_rent_period: null },
];

/** The certification TABLE's answer (data, not the gate): is `id` certified for this type in this mode? */
export function tableAllows(type: string, mode: Mode, id: string): boolean {
  const cfg = COHORT_QUESTIONS[type];
  if (!cfg) return false;
  return mode.legs.every((leg) => (cfg[leg] ?? []).includes(id));
}

export type Scope = { kind: 'type' | 'group'; label: string; types: string[]; category: 'Residential' | 'Commercial'; query: SearchQuery };

/** Every clean type and every group, each as the SearchQuery the Filter screen would hold. */
export function allScopes(): Scope[] {
  const base = { location: 'الرياض', type: null, detail: null, priceInput: '', priceBand: null } as Partial<SearchQuery>;
  const out: Scope[] = [];
  for (const type of ALL_CLEAN_TYPES) {
    const category = CLEAN_MACRO[type];
    out.push({ kind: 'type', label: type, types: [type], category,
      query: { ...base, deal: 'Buy', category, typeGroups: groupsOf([type]), types: [type] } as SearchQuery });
  }
  for (const category of ['Residential', 'Commercial'] as const) {
    for (const g of HIERARCHY[category]) {
      out.push({ kind: 'group', label: g.group, types: groupMembers(g.group), category,
        query: { ...base, deal: 'Buy', category, typeGroups: [g.group], types: null } as SearchQuery });
    }
  }
  return out;
}

export const inMode = (q: SearchQuery, m: Mode): SearchQuery => {
  const { dealCombined: _dc, bothDeals: _bd, ...rest } = q as SearchQuery & { dealCombined?: boolean; bothDeals?: boolean };
  return { ...rest, ...m.fields } as SearchQuery;
};

// ── the real questions, lifted ───────────────────────────────────────────────────────────────────
export type Option = { key: string; label: string; count: number | string };
export type Resolved = { options: Option[]; unknownCount: number | string | null; total: number | string; unknownOf?: ((c: unknown) => number) | null };
export type Question = {
  id: string; selection: 'single' | 'multi';
  eligibility: (q: SearchQuery) => boolean;
  resolveOptions: (q: SearchQuery) => Promise<Resolved>;
  apply: (q: SearchQuery, keys: string[]) => SearchQuery;
};
export type Lifted = {
  questions: Question[];
  rpcAdvancedFilterParams: (q: SearchQuery) => Record<string, unknown>;
  rpcAllNarrowingParams: (q: SearchQuery) => Record<string, unknown>;
  /** What the shimmed count fetchers hand to resolveOptions(). Pass a real RPC row (live tier) or a recorder (offline). */
  setCounts: (guided: unknown, age: unknown) => void;
};

/**
 * A count row that answers every column read with the column's own NAME (and remembers the reads).
 * Running resolveOptions() against it turns each option's `count` into the cnt_* column it reads —
 * the wiring, executed, rather than a regex over `count: (c) => c.cnt_x` text.
 */
export function recorder(): { row: Record<string, unknown>; reads: Set<string> } {
  const reads = new Set<string>();
  const row = new Proxy({}, { get: (_t, k) => { if (typeof k !== 'string') return undefined; reads.add(k); return k; } });
  return { row, reads };
}

const QUESTION_CONSTS = [
  'RNPL_QUESTION', 'AGE_QUESTION', 'AMENITIES_QUESTION', 'BATHROOMS_QUESTION', 'FURNISHED_QUESTION',
  'STREET_WIDTH_QUESTION', 'DIRECTION_QUESTION', 'RATING_QUESTION', 'UNIT_SUBTYPE_QUESTION',
];

export async function loadLifted(root: string): Promise<Lifted> {
  const href = (p: string) => JSON.stringify(pathToFileURL(join(root, p)).href);
  const counts = { guided: null as unknown, age: null as unknown };
  (globalThis as Record<string, unknown>).__afMatrixCounts = counts;
  const lifted = await liftSymbols(
    join(root, 'src/data/advancedFilters.ts'),
    [
      { header: 'const AGE_BUCKETS', endsWith: /^\];$/ },
      { header: 'const DIRECTION_DEFS', endsWith: /^\];$/ },
      { header: 'function addAmenities' },
      ...QUESTION_CONSTS.map((h) => ({ header: `const ${h}` })),
      { header: 'export const ADVANCED_QUESTIONS', endsWith: /^\];$/ },
    ],
    ['ADVANCED_QUESTIONS'],
    [
      `import { cohortAllows, scopeCleanTypes, intersectChips } from ${href('src/lib/afCohorts.ts')};`,
      'type GuidedCounts = any; type AgeOptionCounts = any; type SearchQuery = any; type AdvancedQuestion = any; type AdvancedQuestionResult = any;',
      'const t = (k: string) => k;',
      'const isProbeFailure = (_c: unknown) => false;',
      // The card floors (MIN_TOTAL_TO_SHOW, meaningful) decide whether an option is worth SHOWING.
      // Here every option a question can define is examined — the superset, i.e. strictly more
      // than the card ever renders — so a wrong count on a hidden chip is still a wrong count.
      'const MIN_TOTAL_TO_SHOW = 0;',
      'const meaningful = (o: any) => o;',
      'const __c = (globalThis as any).__afMatrixCounts;',
      'const fetchApartmentGuidedCounts = async (_q: unknown) => __c.guided;',
      'const fetchPropertyAgeOptionCounts = async (_q: unknown) => __c.age;',
      // guidedOptions() is shimmed for ONE reason: to hand back the question\'s own `unknownOf`
      // lambda so its arithmetic can be examined on a recorder. Options and total are computed the
      // way the real function computes them (each def\'s own count(), cnt_total_base).
      'const guidedOptions = (counts: any, defs: Array<{ key: string; labelKey: string; count: (c: any) => number }>, unknownOf?: (c: any) => number) => ({',
      '  options: defs.map((d) => ({ key: d.key, label: d.labelKey, count: d.count(counts) })),',
      '  unknownCount: unknownOf ? unknownOf(counts) : null, total: counts.cnt_total_base, unknownOf: unknownOf ?? null });',
    ].join('\n'),
  );
  const remote = await liftSymbols(
    join(root, 'src/data/remote.ts'),
    [{ header: 'export function rpcAdvancedFilterParams' }, { header: 'export function rpcAllNarrowingParams' }],
    ['rpcAdvancedFilterParams', 'rpcAllNarrowingParams'],
    // The NORMAL half of the narrowing (beds/price/area) is not under test here; a bare scope has
    // none, so the shim returns exactly what rpcFilterParams returns for one: explicit nulls.
    'type SearchQuery = any; const rpcFilterParams = (_q: any) => ({ p_types: null, p_beds_exact: null, p_beds_min: null, p_price_min: null, p_price_max: null, p_area_min: null, p_area_max: null });',
  );
  return {
    questions: lifted.ADVANCED_QUESTIONS as Question[],
    rpcAdvancedFilterParams: remote.rpcAdvancedFilterParams as Lifted['rpcAdvancedFilterParams'],
    rpcAllNarrowingParams: remote.rpcAllNarrowingParams as Lifted['rpcAllNarrowingParams'],
    setCounts: (guided, age) => { counts.guided = guided; counts.age = age; },
  };
}

// ── the meaning of every option, stated independently of the code ────────────────────────────────
export type Meaning = {
  /** exactly the RPC params selecting this option must add */
  params: Record<string, unknown>;
  /** the count column the card must read for this option */
  cntCol: string;
  /** canonical column(s) the predicate reads */
  cols: string[];
  /** PostgREST filter: rows that satisfy the option */
  rest: string;
  /** PostgREST filter: rows whose value is KNOWN and does not satisfy it */
  notMatching: string;
  /** PostgREST filter: rows whose value is UNKNOWN (must never be in the answer) */
  unknown: string;
  /** the same predicate over one fetched row — null anywhere in `cols` is a violation */
  satisfies: (row: Record<string, unknown>) => boolean;
};
export type FieldMeaning = {
  /** several options of this field together = union (OR) or intersection (AND) */
  combine: 'or' | 'and';
  /** how two options of this field are expressed as ONE PostgREST filter */
  restBoth: (a: string, b: string) => string;
  /** the exact params two options together must produce, from the two single-option params */
  paramsBoth: (a: Record<string, unknown>, b: Record<string, unknown>) => Record<string, unknown>;
  /** fields whose options + unknown PARTITION the scope (options are disjoint and exhaustive over known) */
  partition: boolean;
  /** the count columns the card's "did not mention" caption must derive from (null = no caption) */
  unknownCols: string[] | null;
  totalCol: string;
};

const enc = (s: unknown) => encodeURIComponent(String(s));
const quoted = (s: string) => enc(`"${s}"`);

const AMENITY_COL: Record<string, string> = {
  kitchen: 'kitchen', parking: 'parking', elevator: 'elevator', ac: 'air_conditioner', private_entrance: 'private_entrance',
  maid_room: 'maid_room', driver_room: 'driver_room', car_entrance: 'car_entrance', sanitation: 'sanitation',
  electricity: 'electricity', water_supply: 'water_supply', furnished: 'furnished', gym: 'gym', pool: 'pool',
  garden: 'garden', balcony: 'balcony', laundry_room: 'laundry_room', optical_fibers: 'optical_fibers',
  separate_electricity_meter: 'separate_electricity_meter', separate_water_meter: 'separate_water_meter',
  rnpl: 'rent_now_pay_later',
};
const DIR_COL: Record<string, string> = {
  'شمال': 'cnt_dir_n', 'جنوب': 'cnt_dir_s', 'شرق': 'cnt_dir_e', 'غرب': 'cnt_dir_w',
  'شمال شرق': 'cnt_dir_ne', 'شمال غرب': 'cnt_dir_nw', 'جنوب شرق': 'cnt_dir_se', 'جنوب غرب': 'cnt_dir_sw',
};
const SUBTYPE_COL: Record<string, string> = { 'استديو': 'cnt_sub_studio', 'شقق مخدومة': 'cnt_sub_serviced', 'شقة': 'cnt_sub_regular' };
const AGE: Record<string, { params: Record<string, unknown>; lo: number | null; hi: number | null; exact?: number }> = {
  new: { params: { p_is_new_construction: true }, lo: null, hi: null, exact: 0 },
  '1_2': { params: { p_age_min: 1, p_age_max: 2 }, lo: 1, hi: 2 },
  '3_5': { params: { p_age_min: 3, p_age_max: 5 }, lo: 3, hi: 5 },
  '6_9': { params: { p_age_min: 6, p_age_max: 9 }, lo: 6, hi: 9 },
  '10p': { params: { p_age_min: 10 }, lo: 10, hi: null },
};

/** The published spellings of a compass point: noun, and the adjective on its last word. */
export const spellings = (d: string): string[] => [d, `${d}ي`, `${d}ية`];

const bool = (col: string, cnt: string, params: Record<string, unknown>): Meaning => ({
  params, cntCol: cnt, cols: [col], rest: `${col}=is.true`, notMatching: `${col}=is.false`, unknown: `${col}=is.null`,
  satisfies: (r) => r[col] === true,
});
const ladder = (col: string, cnt: string, params: Record<string, unknown>, n: number): Meaning => ({
  params, cntCol: cnt, cols: [col], rest: `${col}=gte.${n}`, notMatching: `${col}=lt.${n}`, unknown: `${col}=is.null`,
  satisfies: (r) => typeof r[col] === 'number' && (r[col] as number) >= n,
});

export function optionMeaning(field: string, key: string): Meaning | null {
  switch (field) {
    case 'rnpl': return key === 'rnpl' ? bool('rent_now_pay_later', 'cnt_rnpl', { p_amenities: ['rnpl'] }) : null;
    case 'amenities': return AMENITY_COL[key] ? bool(AMENITY_COL[key], `cnt_${key}`, { p_amenities: [key] }) : null;
    case 'bathrooms': return /^[1-4]$/.test(key) ? ladder('bathrooms', `cnt_bath${key}`, { p_bath_min: Number(key) }, Number(key)) : null;
    case 'street_width': return /^(15|20|25|30)$/.test(key) ? ladder('street_width_m', `cnt_stw${key}`, { p_street_width_min: Number(key) }, Number(key)) : null;
    case 'furnished':
      if (key === 'yes') return bool('furnished', 'cnt_furnished', { p_furnished: true });
      if (key === 'no') return { ...bool('furnished', 'cnt_unfurnished', { p_furnished: false }), rest: 'furnished=is.false', notMatching: 'furnished=is.true', satisfies: (r) => r.furnished === false };
      return null;
    case 'direction': {
      if (!DIR_COL[key]) return null;
      // A direction option means the SOURCE TEXT for that compass point, in the spellings sources
      // publish: the noun («شمال شرق») and the adjective («شمال شرقي» / «شمال شرقية»). Measured on the
      // whole index 2026-09-02: exactly 8 distinct stored values, the four diagonals stored ONLY in
      // the adjectival form (شمال شرقي 3,992 · جنوب شرقي 2,950 · جنوب غربي 2,901 · شمال غربي 2,796).
      // A literal `direction_ar = key` oracle therefore counted 0 for every diagonal while the card
      // and the search (both via norm_direction_ar) agreed on 121/77/232/… — a false differential
      // this table must not repeat. Spelled here as Arabic morphology of the published text, not as
      // a copy of our SQL normaliser.
      const v = spellings(key);
      return {
        params: { p_directions: [key] }, cntCol: DIR_COL[key], cols: ['direction_ar'],
        rest: `direction_ar=in.(${v.map(quoted).join(',')})`, notMatching: `direction_ar=not.in.(${v.map(quoted).join(',')})`,
        unknown: 'direction_ar=is.null',
        satisfies: (r) => typeof r.direction_ar === 'string' && v.includes(r.direction_ar),
      };
    }
    case 'rating':
      if (key === '9.5') return ladder('rating', 'cnt_rating95', { p_rating_min: 9.5 }, 9.5);
      if (key === '9.0') return ladder('rating', 'cnt_rating90', { p_rating_min: 9 }, 9);
      if (key === '9.0_rc10') return {
        params: { p_rating_min: 9, p_reviews_min: 10 }, cntCol: 'cnt_rating90_rc10', cols: ['rating', 'reviews_count'],
        rest: 'rating=gte.9&reviews_count=gte.10',
        notMatching: 'and=(rating.not.is.null,reviews_count.not.is.null,or(rating.lt.9,reviews_count.lt.10))',
        unknown: 'or=(rating.is.null,reviews_count.is.null)',
        satisfies: (r) => typeof r.rating === 'number' && r.rating >= 9 && typeof r.reviews_count === 'number' && r.reviews_count >= 10,
      };
      return null;
    case 'unit_subtype': return SUBTYPE_COL[key] ? {
      params: { p_unit_subtypes: [key] }, cntCol: SUBTYPE_COL[key], cols: ['unit_subtype_ar'],
      rest: `unit_subtype_ar=eq.${enc(key)}`, notMatching: `unit_subtype_ar=neq.${enc(key)}`, unknown: 'unit_subtype_ar=is.null',
      satisfies: (r) => r.unit_subtype_ar === key,
    } : null;
    case 'property_age': {
      const a = AGE[key];
      if (!a) return null;
      const range = a.exact != null
        ? { rest: `property_age=eq.${a.exact}`, notMatching: `property_age=neq.${a.exact}`, ok: (v: number) => v === a.exact }
        : a.hi == null
          ? { rest: `property_age=gte.${a.lo}`, notMatching: `property_age=lt.${a.lo}`, ok: (v: number) => v >= (a.lo as number) }
          : { rest: `property_age=gte.${a.lo}&property_age=lte.${a.hi}`, notMatching: `or=(property_age.lt.${a.lo},property_age.gt.${a.hi})`, ok: (v: number) => v >= (a.lo as number) && v <= (a.hi as number) };
      return { params: a.params, cntCol: `cnt_${key}`, cols: ['property_age'], rest: range.rest, notMatching: range.notMatching,
        unknown: 'property_age=is.null', satisfies: (r) => typeof r.property_age === 'number' && range.ok(r.property_age) };
    }
    default: return null;
  }
}

export function fieldMeaning(field: string): FieldMeaning | null {
  const single = (totalCol = 'cnt_total_base', unknownCols: string[] | null = null, partition = false): FieldMeaning => ({
    combine: 'and', partition, unknownCols, totalCol,
    restBoth: (a, b) => `${a}&${b}`,
    paramsBoth: (a, b) => ({ ...a, ...b }),
  });
  switch (field) {
    case 'amenities': return { ...single(), combine: 'and',
      paramsBoth: (a, b) => ({ p_amenities: [...(a.p_amenities as string[]), ...(b.p_amenities as string[])] }) };
    case 'direction': return {
      combine: 'or', partition: true, totalCol: 'cnt_total_base',
      unknownCols: ['cnt_total_base', ...Object.values(DIR_COL)],
      // union of the two options' spelling sets — one in-list, exactly as p_directions is a membership test
      restBoth: (a, b) => `direction_ar=in.(${a.slice('direction_ar=in.('.length, -1)},${b.slice('direction_ar=in.('.length, -1)})`,
      paramsBoth: (a, b) => ({ p_directions: [...(a.p_directions as string[]), ...(b.p_directions as string[])] }),
    };
    case 'furnished': return single('cnt_total_base', ['cnt_total_base', 'cnt_furnished', 'cnt_unfurnished'], true);
    case 'property_age': return single('cnt_total', ['cnt_unknown'], true);
    case 'rnpl': case 'bathrooms': case 'street_width': case 'rating': case 'unit_subtype': return single();
    default: return null;
  }
}

// ── the matrix itself ────────────────────────────────────────────────────────────────────────────
export type Cell = { scope: Scope; mode: Mode; query: SearchQuery; fields: { question: Question; options: Option[]; resolved: Resolved }[] };

/** Walk every scope × mode through the REAL pool. `counts` is what the shimmed fetchers return. */
export async function buildMatrix(L: Lifted, counts: { guided: unknown; age: unknown }, scopes = allScopes()): Promise<Cell[]> {
  const cells: Cell[] = [];
  for (const scope of scopes) {
    for (const mode of MODES) {
      const query = inMode(scope.query, mode);
      const fields: Cell['fields'] = [];
      for (const question of L.questions) {
        if (!question.eligibility(query)) continue;
        L.setCounts(counts.guided, counts.age);
        const resolved = await question.resolveOptions(query);
        fields.push({ question, options: resolved.options, resolved });
      }
      cells.push({ scope, mode, query, fields });
    }
  }
  return cells;
}

/** Two options of DIFFERENT fields together: every param of both. rnpl and amenities share the one
 *  p_amenities bag, so their tokens union; every other pair is disjoint. */
export const paramsAcross = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> =>
  Array.isArray(a.p_amenities) && Array.isArray(b.p_amenities)
    ? { ...a, ...b, p_amenities: [...(a.p_amenities as string[]), ...(b.p_amenities as string[])] }
    : { ...a, ...b };

export const sortedJson = (o: unknown): string => JSON.stringify(o, (_k, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);
