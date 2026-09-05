// GOLDEN CORRECTNESS CONTRACT — COMPOUND AF PREDICATES (owner PERMANENT, 2026-09-04).
//
// "THE USER MUST ALWAYS GET EXACTLY THE RESULTS THAT MATCH WHAT THEY SELECTED IN ADVANCED FILTER"
// — every returned listing must satisfy EVERY active cross-field AF predicate, all AT ONCE.
//
// WHY THIS FILE EXISTS, DISTINCT FROM verify-af-independent-oracle.ts. That barrier is real and
// strong, but every one of its CASES sets exactly ONE AF field param per request — mirroring how
// verify-af-live-truth.ts's browser journeys deliberately commit one answer then «تخطي» the rest of
// the round (see e2e/live-sweep/journeys.mjs). Two predicates from different fields being jointly
// wrong — e.g. the clause silently OR-ing amenities.pool with amenities.elevator instead of ANDing
// them, or one predicate's SQL clobbering another's WHERE fragment during string-building — is a
// class of bug NO single-predicate case can expose: each field would test green in isolation while
// their conjunction silently misbehaves. This file closes exactly that gap.
//
// METHOD, one step stronger than the independent-oracle's count comparison: for each case, fetch the
// FULL ID SET (source_table+listing_id) from both the RPC (with 2-3 different-field AF answers
// active simultaneously) and an independently-expressed PostgREST filter (implemented by PostgREST,
// not by us — same evidentiary reasoning as the independent oracle) ANDing the same predicates, and
// assert the two sets are IDENTICAL — not just equal in size. A count match can hide a compensating
// swap (one wrong row in, one wrong row out); an exact ID-set match cannot.
//
//   node --experimental-strip-types scripts/verify-af-compound-predicates.ts   (wired into `npm test`)

// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL_BASE, key: KEY } = resolvePublicSupabase(process.env);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const REGION = 1; // Riyadh — every cohort below has real inventory under all of its predicates.

type Case = {
  label: string;
  types: string[];
  deal: 'بيع' | 'إيجار';
  category: 'Residential' | 'Commercial';
  period?: 'سنوي' | 'شهري';
  rpc: Record<string, unknown>;      // 2-3 DIFFERENT-FIELD AF answers, active together (sent as-is to the RPC)
  restExtra: string;                 // the SAME conjunction, as independent PostgREST filters
  // Each entry is ONE LOGICAL AF FIELD's predicate, as its own params object — e.g. {p_age_min,
  // p_age_max} is a single range field, not two. Used for the per-field superset check below: every
  // row in the full conjunction must also satisfy each field ALONE. Grouping matters — splitting a
  // range's min/max into separate "fields" would make the min-only or max-only slice a much WEAKER
  // (larger, differently-shaped) query than the real field, breaking the superset property for a
  // reason that has nothing to do with the conjunction being tested.
  slices: Record<string, unknown>[];
};

const CASES: Case[] = [
  { label: 'Villa/Buy · street width ≥25 AND bathrooms ≥4', types: ['فيلا', 'تاون هاوس', 'بيت'], deal: 'بيع',
    category: 'Residential', rpc: { p_street_width_min: 25, p_bath_min: 4 },
    restExtra: 'street_width_m=gte.25&bathrooms=gte.4',
    slices: [{ p_street_width_min: 25 }, { p_bath_min: 4 }] },
  { label: 'Apartment/Buy · age 3–5 AND elevator', types: ['شقة', 'مبنى شقق مخدومة', 'ملحق علوي'], deal: 'بيع',
    category: 'Residential', rpc: { p_age_min: 3, p_age_max: 5, p_amenities: ['elevator'] },
    restExtra: 'property_age=gte.3&property_age=lte.5&elevator=is.true',
    slices: [{ p_age_min: 3, p_age_max: 5 }, { p_amenities: ['elevator'] }] },
  { label: 'Apartment/Buy · elevator AND ac AND parking (3-way, same amenities field)',
    types: ['شقة', 'مبنى شقق مخدومة', 'ملحق علوي'], deal: 'بيع', category: 'Residential',
    rpc: { p_amenities: ['elevator', 'ac', 'parking'] },
    restExtra: 'elevator=is.true&air_conditioner=is.true&parking=is.true', slices: [] },
  { label: 'Shop/Rent-Annual · electricity AND water_supply AND street width ≥10',
    types: ['محل', 'كشك', 'درايف ثرو'], deal: 'إيجار', category: 'Commercial', period: 'سنوي',
    rpc: { p_amenities: ['electricity', 'water_supply'], p_street_width_min: 10 },
    restExtra: 'electricity=is.true&water_supply=is.true&street_width_m=gte.10',
    slices: [{ p_amenities: ['electricity', 'water_supply'] }, { p_street_width_min: 10 }] },
];

const periodRest = (p?: string) =>
  p === 'سنوي'  ? '&or=(rent_period_ar.eq.سنوي,and(rent_period_ar.eq.شهري,rent_now_pay_later.is.true))'
  : p === 'شهري' ? '&payment_monthly=is.true&rent_now_pay_later=not.is.true'
  : '';

type RowKey = string;
const key = (r: { source_table: string; listing_id: number | string }): RowKey => `${r.source_table}:${r.listing_id}`;

async function restIds(c: Case): Promise<Set<RowKey> | null> {
  const types = c.types.map((t) => `"${t}"`).join(',');
  const q = `${URL_BASE}/rest/v1/search_listings_ar?select=source_table,listing_id`
    + `&production_ready=is.true&region_id=eq.${REGION}`
    + `&deal_ar=eq.${encodeURIComponent(c.deal)}&type_ar=in.(${encodeURIComponent(types)})`
    + periodRest(c.period) + `&${c.restExtra}&limit=5000`;
  const r = await fetch(q, { headers: H });
  const j = await r.json();
  if (!Array.isArray(j)) return null;
  return new Set(j.map((row: { source_table: string; listing_id: number }) => key(row)));
}

async function rpcIds(c: Case, answer: Record<string, unknown>): Promise<Set<RowKey> | null> {
  const body = {
    p_deal: c.deal, p_types: c.types, p_category: c.category, p_region_ids: [REGION],
    p_rent_period: c.period ?? null, p_per_platform: null, p_limit: 5000, p_offset: 0, ...answer,
  };
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/location_search_candidates_ar`,
    { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!Array.isArray(j)) return null;
  return new Set(j.map((row: { source_table: string; listing_id: number }) => key(row)));
}

const setEq = (a: Set<RowKey>, b: Set<RowKey>) => a.size === b.size && [...a].every((x) => b.has(x));
const diff = (a: Set<RowKey>, b: Set<RowKey>) => [...a].filter((x) => !b.has(x));

console.log('\nCompound AF predicates — every returned row must satisfy ALL active cross-field predicates AT ONCE\n');

for (const c of CASES) {
  check(`${c.label} — case genuinely combines ≥1 predicate expression (sanity)`,
    Object.keys(c.rpc).length >= 1);

  const [viaRpc, viaRest] = await Promise.all([rpcIds(c, c.rpc), restIds(c)]);
  const rpcOk = viaRpc != null, restOk = viaRest != null;
  check(`${c.label} — RPC and PostgREST both returned a usable ID set`, rpcOk && restOk,
    `rpc=${rpcOk ? viaRpc!.size : 'null'} rest=${restOk ? viaRest!.size : 'null'}`);
  if (!rpcOk || !restOk) continue;

  check(`${c.label} — the scope genuinely has matches (the test can bite)`, viaRpc!.size > 0 && viaRest!.size > 0,
    `rpc=${viaRpc!.size} rest=${viaRest!.size}`);

  check(`${c.label} — RPC ID set == independent PostgREST ID set, EXACTLY (not just count)`,
    setEq(viaRpc!, viaRest!),
    `only-in-RPC=${JSON.stringify(diff(viaRpc!, viaRest!).slice(0, 5))} only-in-REST=${JSON.stringify(diff(viaRest!, viaRpc!).slice(0, 5))}`);

  // Every FIELD's own slice must be a SUPERSET of the full conjunction — proves the conjunction did
  // not somehow match MORE than any one field alone allows (an OR-not-AND defect). Each slice is a
  // whole logical field (e.g. the age range as one unit), never a lone min/max half of a range.
  if (c.slices.length >= 2) {
    const partials = await Promise.all(c.slices.map((s) => rpcIds(c, s)));
    partials.forEach((p, i) => {
      const label = Object.keys(c.slices[i]!).join('+');
      check(`${c.label} — single-field slice (${label} alone) is a SUPERSET of the full conjunction`,
        p != null && [...viaRpc!].every((id) => p.has(id)),
        `full=${viaRpc!.size} ${label}-alone=${p?.size ?? 'null'}`);
    });
  }
}

// ── MUTATION PROOF — this barrier must actually catch a dropped predicate ─────────────────────────
// Simulate the exact defect this file exists to catch: the RPC call silently drops one of the two
// active predicates (e.g. a WHERE-clause string-build bug that clobbers the first fragment). Proven
// by fetching the REAL RPC's own single-predicate result (which the compound conjunction must be a
// strict subset of, when the dropped predicate is itself selective) and confirming it disagrees with
// the two-predicate result recorded above — i.e. the check above WOULD have gone red.
{
  const c = CASES[0]!; // street_width>=25 AND bathrooms>=4 — both are individually selective on this cohort
  const [full, swOnly] = await Promise.all([rpcIds(c, c.rpc), rpcIds(c, { p_street_width_min: c.rpc.p_street_width_min })]);
  check('MUTATION: a request that silently drops p_bath_min would return a DIFFERENT (larger) set than the real conjunction',
    full != null && swOnly != null && full.size > 0 && swOnly.size > full.size && !setEq(full, swOnly),
    `full(both predicates)=${full?.size} vs mutant(street-width only)=${swOnly?.size} — the exact-set check above catches this because they are not equal`);
}

console.log(failures === 0
  ? '\n✓ every compound AF combination returns exactly the rows that satisfy ALL active predicates at once\n'
  : `\n✗ ${failures} check(s) FAILED — a compound AF answer means something different than the conjunction of its parts\n`);
process.exit(failures === 0 ? 0 : 1);
