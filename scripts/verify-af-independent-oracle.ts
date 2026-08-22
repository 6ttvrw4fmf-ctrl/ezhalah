// THE ADVANCED FILTER MUST AGREE WITH AN INDEPENDENTLY-EXPRESSED PREDICATE.
//
// WHY THIS EXISTS. Every other AF barrier compares our own SQL against our own SQL: the shared
// eligibility clause against the four surfaces it builds, the count RPC against the search RPC, a
// detector against the function it was derived from. Those catch DRIFT between our components, but
// they are structurally incapable of catching a predicate that is uniformly wrong — if the clause
// says `street_width_m >= p` where the product means `>`, every surface built from that clause
// agrees with every other, and every parity barrier stays green while every user gets wrong results.
//
// This barrier closes that hole by asking the SAME question through a path that shares NO SQL with
// the RPC: PostgREST's own filter operators applied directly to search_listings_ar. `gte`, `eq`,
// `in`, `is.true` are implemented by PostgREST, not by us, so agreement between the two is real
// evidence about the predicate's MEANING, not about our own internal consistency.
//
// WHAT IT ASSERTS, per case:
//   1. the RPC's total_count == the count PostgREST returns for the same user intent
//   2. UNKNOWN NEVER PASSES — a strict AF answer must exclude NULL-valued rows. Proved positively:
//      the rows carrying NULL in the answered column are counted separately and must be excluded
//      from the answered total (base == answered + not-matching + unknown, with unknown > 0).
//
// SCOPING NOTE: every case pins p_region_ids, which makes reachability exactly `production_ready`
// (the clause's unlocated-countrywide fallback only applies when NO location filter is given), so
// the two paths are comparing the same population and a difference is always a predicate defect.
//
//   node --experimental-strip-types scripts/verify-af-independent-oracle.ts   (wired into `npm test`)

import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL_BASE, key: KEY } = resolvePublicSupabase(process.env);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// Riyadh region — big enough that every cohort below has real inventory to disagree about.
const REGION = 1;

type Case = {
  label: string;
  types: string[];
  deal: 'بيع' | 'إيجار';
  category: 'Residential' | 'Commercial';
  period?: 'سنوي' | 'شهري';
  rpc: Record<string, unknown>;   // the AF answer, as the app sends it
  rest: string;                   // the SAME answer, as PostgREST filters
  strictCol?: string;             // column the answer reads — its NULLs must be excluded
  notMatching?: string;           // the SAME column, KNOWN but failing the answer (partition test)
};

const CASES: Case[] = [
  { label: 'Villa/Buy · street width ≥ 20', types: ['فيلا','تاون هاوس','بيت'], deal: 'بيع', category: 'Residential',
    rpc: { p_street_width_min: 20 }, rest: 'street_width_m=gte.20', strictCol: 'street_width_m',
    notMatching: 'street_width_m=lt.20' },
  { label: 'Villa/Buy · bathrooms ≥ 3', types: ['فيلا','تاون هاوس','بيت'], deal: 'بيع', category: 'Residential',
    rpc: { p_bath_min: 3 }, rest: 'bathrooms=gte.3', strictCol: 'bathrooms', notMatching: 'bathrooms=lt.3' },
  { label: 'Apartment/Rent-Annual · confirmed furnished', types: ['شقة','مبنى شقق مخدومة','ملحق علوي'], deal: 'إيجار',
    category: 'Residential', period: 'سنوي', rpc: { p_furnished: true }, rest: 'furnished=is.true', strictCol: 'furnished',
    notMatching: 'furnished=is.false' },
  { label: 'Apartment/Rent-Annual · confirmed UNfurnished (tri-state)', types: ['شقة','مبنى شقق مخدومة','ملحق علوي'],
    deal: 'إيجار', category: 'Residential', period: 'سنوي', rpc: { p_furnished: false }, rest: 'furnished=is.false',
    strictCol: 'furnished', notMatching: 'furnished=is.true' },
  { label: 'Apartment/Buy · age 3–5 years', types: ['شقة','مبنى شقق مخدومة','ملحق علوي'], deal: 'بيع', category: 'Residential',
    rpc: { p_age_min: 3, p_age_max: 5 }, rest: 'property_age=gte.3&property_age=lte.5', strictCol: 'property_age',
    notMatching: 'or=(property_age.lt.3,property_age.gt.5)' },
  { label: 'Apartment/Buy · elevator', types: ['شقة','مبنى شقق مخدومة','ملحق علوي'], deal: 'بيع', category: 'Residential',
    rpc: { p_amenities: ['elevator'] }, rest: 'elevator=is.true', strictCol: 'elevator', notMatching: 'elevator=is.false' },
  { label: 'Apartment/Rent-Monthly · rating ≥ 9.5', types: ['شقة','مبنى شقق مخدومة','ملحق علوي'], deal: 'إيجار',
    category: 'Residential', period: 'شهري', rpc: { p_rating_min: 9.5 }, rest: 'rating=gte.9.5', strictCol: 'rating',
    notMatching: 'rating=lt.9.5' },
  { label: 'Shop/Rent-Annual · electricity', types: ['محل','كشك','درايف ثرو'], deal: 'إيجار', category: 'Commercial',
    period: 'سنوي', rpc: { p_amenities: ['electricity'] }, rest: 'electricity=is.true', strictCol: 'electricity',
    notMatching: 'electricity=is.false' },
  { label: 'Residential Land/Buy · street width ≥ 15', types: ['أرض سكنية'], deal: 'بيع', category: 'Residential',
    rpc: { p_street_width_min: 15 }, rest: 'street_width_m=gte.15', strictCol: 'street_width_m',
    notMatching: 'street_width_m=lt.15' },
];

// The rent-period rule, expressed as PostgREST filters (the product rule, not our SQL):
//   annual  = source says annual, OR a monthly-priced row that is an RNPL instalment plan
//   monthly = a real monthly rental that is NOT an RNPL instalment plan
const periodRest = (p?: string) =>
  p === 'سنوي'  ? '&or=(rent_period_ar.eq.سنوي,and(rent_period_ar.eq.شهري,rent_now_pay_later.is.true))'
  : p === 'شهري' ? '&payment_monthly=is.true&rent_now_pay_later=not.is.true'
  : '';

async function restCount(c: Case, extra: string): Promise<number | null> {
  const types = c.types.map((t) => `"${t}"`).join(',');
  const q = `${URL_BASE}/rest/v1/search_listings_ar?select=listing_id`
    + `&production_ready=is.true&region_id=eq.${REGION}`
    + `&deal_ar=eq.${encodeURIComponent(c.deal)}&type_ar=in.(${encodeURIComponent(types)})`
    + periodRest(c.period) + (extra ? `&${extra}` : '');
  const r = await fetch(q, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const cr = r.headers.get('content-range');
  return cr && cr.includes('/') ? Number(cr.split('/')[1]) : null;
}

async function rpcTotal(c: Case, answer: Record<string, unknown>): Promise<number | null> {
  const body = {
    p_deal: c.deal, p_types: c.types, p_category: c.category, p_region_ids: [REGION],
    p_rent_period: c.period ?? null, p_per_platform: null, p_limit: 1, p_offset: 0, ...answer,
  };
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/location_search_candidates_ar`,
    { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!Array.isArray(j)) return null;
  return j.length ? Number(j[0].total_count) : 0;
}

console.log('\nAF predicates must agree with an independently-expressed predicate (PostgREST filters)\n');

for (const c of CASES) {
  // ── 1. the answered set: RPC vs PostgREST ──
  const [viaRpc, viaRest] = await Promise.all([rpcTotal(c, c.rpc), restCount(c, c.rest)]);
  check(`${c.label} — RPC total == independent PostgREST count`,
    viaRpc != null && viaRest != null && viaRpc === viaRest,
    `RPC=${viaRpc} PostgREST=${viaRest} (answer ${JSON.stringify(c.rpc)} / ${c.rest})`);

  // ── 2. UNKNOWN NEVER PASSES — proved as an EXACT PARTITION, not a bound.
  // The scope splits into exactly three disjoint groups: rows the answer matches, rows that are
  // KNOWN but do not match, and rows whose value is unknown. If a single unknown row leaked into
  // the answered set it would be double-counted and the identity breaks.
  //   answered + known-but-not-matching + unknown  ==  base
  // (A bound like `answered <= known` is NOT enough: a small leak still fits under it — proven by
  // mutation, where a predicate letting 222 NULL-street rows pass still satisfied the bound.)
  if (c.strictCol) {
    const [base, unknown, notMatching] = await Promise.all([
      rpcTotal(c, {}), restCount(c, `${c.strictCol}=is.null`), restCount(c, c.notMatching),
    ]);
    check(`${c.label} — the scope really does contain UNKNOWN rows (the test can bite)`,
      unknown != null && unknown > 0, `unknown ${c.strictCol} rows = ${unknown}`);
    const sum = (viaRpc ?? 0) + (notMatching ?? 0) + (unknown ?? 0);
    check(`${c.label} — answered + known-not-matching + unknown == base (no unknown leaked in)`,
      viaRpc != null && base != null && sum === base,
      `answered=${viaRpc} + notMatching=${notMatching} + unknown=${unknown} = ${sum}, base=${base}`);
  }
}

console.log(failures === 0
  ? '\n✓ every AF predicate agrees with an independent implementation, and unknown never passes\n'
  : `\n✗ ${failures} check(s) FAILED — an AF answer means something different than the product intends\n`);
process.exit(failures === 0 ? 0 : 1);
