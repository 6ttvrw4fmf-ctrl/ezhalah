// THE WHOLE CERTIFIED ADVANCED FILTER SURFACE, PROVEN OPTION BY OPTION AGAINST INDEPENDENT DB TRUTH.
//
// ── THE OWNER REQUIREMENT (2026-09-02) ───────────────────────────────────────────────────────────
//
//   «Whatever number and option Advanced Filter shows the user must equal the real database truth,
//    and clicking that option must return exactly the correct listings. Gym — 3 means truly 3
//    eligible listings with a gym in that search; clicking Gym returns those 3 — not 2, not 4, and
//    no listing without a gym. Proven across EVERY certified field, every option, every supported
//    property type, Residential/Commercial, Buy/Rent, Annual/Monthly, cities, and multi-type.»
//
// verify-af-property-type-differential.ts proves ONE answer per certified question. This file proves
// EVERY option the card can render — every bathroom rung, every direction, every age bucket, every
// amenity chip, both furnished answers, every rating cut, every unit subtype — plus the combinations
// the contract defines (same-field OR, cross-field AND, second-round chips computed inside the
// first answer), the boundaries (≥ N includes N; buckets are closed at both ends), UNKNOWN never
// becoming a value, zero-count options staying zero when clicked, and multi-type / combined-deal /
// both-period scopes. Every case is judged by scripts/lib/afSurfaceJudge.ts, whose verdicts are
// mutation-proven offline in `npm test` (verify-af-surface-judge.ts).
//
// ── FIVE WITNESSES PER OPTION, ALL OF WHICH MUST AGREE ───────────────────────────────────────────
//
//   chip       apartment_guided_counts_ar / property_age_option_counts_ar — the number on the card,
//              read from the cnt_* column the app reads, with the exact request shape the app sends
//   applied    af_eligible_count() with the option applied — the shared clause counting itself
//   rpcTotal   location_search_candidates_ar total_count with the option applied — what «بحث» lands
//   rpcIds     that call, PAGED to exhaustion — the cards the user can actually scroll to
//   oracle     PostgREST filters on search_listings_ar (scripts/lib/afOracleFilter.ts) — shares NO
//              SQL with the RPCs; its rows are then re-evaluated in JavaScript on their own column
//              values, so "every returned listing satisfies the filter" is checked by a third
//              evaluator, never by the RPC that produced the listing
//
// A mismatch anywhere is a FAIL naming the cohort, the option, and the first offending IDs.
//
// ── SELF-CONFIGURING FROM THE LIVE CATALOG, NEVER A HARDCODED LIST ───────────────────────────────
//
//   • cohorts      COHORT_QUESTIONS (src/lib/afCohorts.ts) — the runtime gate the product executes —
//                  cross-checked against the certification registry mirror
//                  (sql/mirrors/af_cohort_registry.sql, byte-exact with production, its own barrier)
//   • type folds   typeArForTypes() — the same function remote.ts uses to build p_types
//   • chip lists   the same per-cohort rules AMENITIES_QUESTION.resolveOptions applies
//                  (villa-only chips, COHORT_CHIPS intersection, the furnished chip)
//   • tables       read from the index; direction spellings read from the index
//   • vocabulary   the option catalog below mirrors src/data/advancedFilters.ts one-for-one, and the
//                  sweep FAILS if a certified question id has no catalog entry (a new question can
//                  never silently shrink the sweep)
//
// ── SCOPE ────────────────────────────────────────────────────────────────────────────────────────
//
// Every case carries a location, deliberately: without one af_eligibility_clause() admits UNLOCATED
// non-production_ready rows the oracle does not model (see afOracleFilter.ts). Default is the Riyadh
// region; AF_FSD_SCOPES adds cities, e.g. AF_FSD_SCOPES='region:1,city:جدة,city:الدمام'.
//
//   node --experimental-strip-types scripts/verify-af-full-surface-differential.ts
//   AF_FSD_SCOPES=region:1,city:جدة   AF_FSD_ONLY=Apartment,Villa   AF_FSD_CONCURRENCY=2
//   AF_FSD_SKIP_MULTI=1 (skip multi-type/combined/both-period stages)   AF_FSD_MAX_IDS=60000
//
// Sequential-ish on purpose: the measured concurrency knee is 3 and the sustained ceiling ~1.5
// searches/s (SEARCH_MATCH_QA_ENGINEER.md §40.1). Two in flight, never more.
//
// LIVE CHECK — excluded from `npm test` (scripts/test-exclusions.txt); runs in
// .github/workflows/af-live-truth-check.yml.

// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COHORT_QUESTIONS, COHORT_CHIPS, cohortAllows, intersectChips } from '../src/lib/afCohorts.ts';
import { typeArForTypes, CLEAN_MACRO } from '../src/data/propertyTypes.ts';
import { buildOracleQS, CANONICAL_DIRECTIONS } from './lib/afOracleFilter.ts';
import { loadDirectionVariants } from './lib/afOracleLive.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import {
  judgeOption, judgeUnion, judgeIntersection, judgeZero, judgeUnknownCaption, boundaryReport,
  optionWouldRender, settleOnOneIndex, UNREADABLE_STAMP, type Pred, type Row,
} from './lib/afSurfaceJudge.ts';

const { url: REST, key: KEY } = resolvePublicSupabase(process.env);
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// ── bookkeeping ──────────────────────────────────────────────────────────────────────────────────
let failures = 0;
const failedLabels: string[] = [];
const skipped: string[] = [];
const fail = (label: string, detail: string) => { failures++; failedLabels.push(label); console.error(`FAIL  ${label}\n      ${detail}`); };
const pass = (label: string, detail = '') => console.log(`PASS  ${label}${detail ? `  ${detail}` : ''}`);
const skip = (label: string, why: string) => { skipped.push(`${label}: ${why}`); console.log(`SKIP  ${label} — ${why}`); };
const info = (s: string) => console.log(`      ${s}`);

const M = {
  cohorts: 0, scopes: 0, options: 0, optionsRendered: 0, predicateOnly: 0, zeroOptions: 0,
  orCombos: 0, andCombos: 0, stacked: 0, secondRoundChips: 0, multiTypePairs: 0, combinedDeal: 0, bothPeriod: 0,
  unknownCaptions: 0, boundariesExercised: 0, boundariesUnexercised: 0,
  missing: 0, extra: 0, dupes: 0, countMismatch: 0, nullLeaks: 0, rowViolations: 0, renderGateViolations: 0,
  basePurity: 0,
  // A comparison that straddled an index rebuild: settled on a stable re-read (reconciled) or not
  // settled at all (undecided). Neither is ever a silent pass — both are printed in the summary.
  reconciled: 0, undecided: 0,
};

// ── env ──────────────────────────────────────────────────────────────────────────────────────────
const CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.AF_FSD_CONCURRENCY || 2)));
const ONLY = (process.env.AF_FSD_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const SKIP_MULTI = process.env.AF_FSD_SKIP_MULTI === '1';
const MAX_IDS = Number(process.env.AF_FSD_MAX_IDS || 60000);
type Scope = { label: string; params: Record<string, unknown> };
const SCOPES: Scope[] = (process.env.AF_FSD_SCOPES || 'region:1').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
  const [kind, val] = s.split(':');
  if (kind === 'region') return { label: `region:${val}`, params: { p_region_ids: [Number(val)] } };
  if (kind === 'city') return { label: `city:${val}`, params: { p_cities: [val] } };
  throw new Error(`unknown scope ${s} (use region:<id> or city:<name>)`);
});

// ── live reference data ──────────────────────────────────────────────────────────────────────────
async function rest(path: string, extra: Record<string, string> = {}): Promise<any> {
  const r = await fetch(`${REST}/rest/v1/${path}`, { headers: { ...H, ...extra } });
  if (!r.ok) throw new Error(`REST ${r.status} on ${path.slice(0, 140)}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function rpc(name: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${REST}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`RPC ${name} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const TYPE_MACROS: Record<string, string> = Object.fromEntries(
  (await rest('known_type_ar?select=type_ar,macro')).map((x: any) => [x.type_ar, x.macro]));

const DIRECTION_VARIANTS = await loadDirectionVariants(REST, H);
if (!DIRECTION_VARIANTS.map) {
  fail('direction vocabulary is exactly the 8 keys and their «…ي» spellings',
    `${DIRECTION_VARIANTS.strangers} row(s) carry a spelling outside that domain — the oracle refuses directions until it is classified`);
}

// Every served source table, discovered LIVE with a "next value strictly greater" walk: one request
// per distinct table (~50) instead of paging the whole index (~200 ordered pages). PostgREST has no
// DISTINCT; `order=source_table&limit=1&source_table=gt.<last>` is the cheapest exact equivalent.
const { RES_TABLES, COM_TABLES } = await (async () => {
  const seen: string[] = [];
  let last = '';
  for (let i = 0; i < 400; i++) {
    const rows = await rest(`search_listings_ar?select=source_table&order=source_table&limit=1${last ? `&source_table=gt.${encodeURIComponent(last)}` : ''}`);
    if (!Array.isArray(rows) || !rows.length) break;
    last = rows[0].source_table; seen.push(last);
  }
  if (!seen.length) throw new Error('no source tables discovered — the index is unreadable, refusing to sweep against nothing');
  return { RES_TABLES: seen.filter((t) => t.includes('_residential_')).sort(), COM_TABLES: seen.filter((t) => t.includes('_commercial_')).sort() };
})();

// ── the certification registry mirror (byte-exact with production; its own staleness barrier) ────
const ROW_RE = /\(\s*'((?:[^']|'')*)'\s*,\s*(NULL|'(?:[^']|'')*')\s*,\s*'((?:[^']|'')*)'\s*,\s*(true|false)\s*\)/g;
const unq = (s: string) => s.replace(/^'|'$/g, '').replace(/''/g, "'");
const registry = [...readFileSync(join(import.meta.dirname, '..', 'sql/mirrors/af_cohort_registry.sql'), 'utf8').matchAll(ROW_RE)]
  .map((m) => ({ deal: unq(m[1]), period: m[2] === 'NULL' ? '' : unq(m[2]), type: unq(m[3]), enabled: m[4] === 'true' }));
const enabledRows = new Set(registry.filter((r) => r.enabled).map((r) => `${r.deal}|${r.period}|${r.type}`));

// ── the option catalog — mirrors src/data/advancedFilters.ts one-for-one ─────────────────────────
type Opt = { key: string; col: string | null; countRpc: 'guided' | 'age' | null; params: Record<string, unknown>; pred: Pred };
const AMENITY_COL: Record<string, string> = {
  kitchen: 'kitchen', parking: 'parking', elevator: 'elevator', ac: 'air_conditioner', private_entrance: 'private_entrance',
  maid_room: 'maid_room', driver_room: 'driver_room', car_entrance: 'car_entrance', sanitation: 'sanitation',
  electricity: 'electricity', water_supply: 'water_supply', furnished: 'furnished', rnpl: 'rent_now_pay_later',
};
// The eight residential tokens the CHAT may map (certifiedAmenityKeys) that have a clause predicate
// but NO chip on the card: predicate-only cases — the click set must still be exact.
const RICH_TOKENS = ['gym', 'pool', 'garden', 'balcony', 'laundry_room', 'optical_fibers', 'separate_electricity_meter', 'separate_water_meter'];
const amenity = (key: string): Opt => ({ key: `amenities:${key}`, col: `cnt_${key}`, countRpc: 'guided', params: { p_amenities: [key] }, pred: { kind: 'true', col: AMENITY_COL[key] } });
const DIR_COL: Record<string, string> = { 'شمال': 'cnt_dir_n', 'جنوب': 'cnt_dir_s', 'شرق': 'cnt_dir_e', 'غرب': 'cnt_dir_w', 'شمال شرق': 'cnt_dir_ne', 'شمال غرب': 'cnt_dir_nw', 'جنوب شرق': 'cnt_dir_se', 'جنوب غرب': 'cnt_dir_sw' };

/** Which amenity chips the card renders for this scope — AMENITIES_QUESTION.resolveOptions, restated. */
function amenityChipKeys(types: string[], q: any): string[] {
  const defs = ['kitchen', 'parking', 'elevator', 'ac', 'private_entrance', 'maid_room', 'driver_room'];
  if (types.length > 0 && types.every((t) => t === 'Villa')) defs.push('car_entrance', 'sanitation');
  const chipAllow = intersectChips(types);
  if (chipAllow) {
    if (!defs.includes('sanitation')) defs.push('sanitation');
    defs.push('electricity', 'water_supply');
    return defs.filter((d) => chipAllow.includes(d));
  }
  if (cohortAllows(q, 'furnished')) defs.push('furnished');
  return defs;
}

function optionsFor(qid: string, types: string[], q: any): Opt[] | null {
  switch (qid) {
    case 'rnpl': return [{ key: 'rnpl', col: 'cnt_rnpl', countRpc: 'guided', params: { p_amenities: ['rnpl'] }, pred: { kind: 'true', col: 'rent_now_pay_later' } }];
    case 'amenities': return amenityChipKeys(types, q).map(amenity);
    case 'bathrooms': return [1, 2, 3, 4].map((n) => ({ key: `bathrooms:${n}+`, col: `cnt_bath${n}`, countRpc: 'guided', params: { p_bath_min: n }, pred: { kind: 'gte', col: 'bathrooms', n } }));
    case 'furnished': return [
      { key: 'furnished:yes', col: 'cnt_furnished', countRpc: 'guided', params: { p_furnished: true }, pred: { kind: 'true', col: 'furnished' } },
      { key: 'furnished:no', col: 'cnt_unfurnished', countRpc: 'guided', params: { p_furnished: false }, pred: { kind: 'false', col: 'furnished' } },
    ];
    case 'street_width': return [15, 20, 25, 30].map((n) => ({ key: `street_width:${n}+`, col: `cnt_stw${n}`, countRpc: 'guided', params: { p_street_width_min: n }, pred: { kind: 'gte', col: 'street_width_m', n } }));
    case 'direction': return CANONICAL_DIRECTIONS.map((d) => ({ key: `direction:${d}`, col: DIR_COL[d], countRpc: 'guided', params: { p_directions: [d] }, pred: { kind: 'in', col: 'direction_ar', vs: DIRECTION_VARIANTS.map?.[d] ?? [d] } }));
    case 'rating': return [
      { key: 'rating:9.5', col: 'cnt_rating95', countRpc: 'guided', params: { p_rating_min: 9.5 }, pred: { kind: 'gte', col: 'rating', n: 9.5 } },
      { key: 'rating:9.0', col: 'cnt_rating90', countRpc: 'guided', params: { p_rating_min: 9.0 }, pred: { kind: 'gte', col: 'rating', n: 9.0 } },
      { key: 'rating:9.0_rc10', col: 'cnt_rating90_rc10', countRpc: 'guided', params: { p_rating_min: 9.0, p_reviews_min: 10 }, pred: { kind: 'and', preds: [{ kind: 'gte', col: 'rating', n: 9.0 }, { kind: 'gte', col: 'reviews_count', n: 10 }] } },
    ];
    case 'unit_subtype': return [['استديو', 'cnt_sub_studio'], ['شقق مخدومة', 'cnt_sub_serviced'], ['شقة', 'cnt_sub_regular']]
      .map(([v, col]) => ({ key: `unit_subtype:${v}`, col, countRpc: 'guided', params: { p_unit_subtypes: [v] }, pred: { kind: 'eq', col: 'unit_subtype_ar', v } }));
    case 'property_age': return [
      { key: 'property_age:new', col: 'cnt_new', countRpc: 'age', params: { p_is_new_construction: true }, pred: { kind: 'eq', col: 'property_age', v: 0 } },
      { key: 'property_age:1_2', col: 'cnt_1_2', countRpc: 'age', params: { p_age_min: 1, p_age_max: 2 }, pred: { kind: 'between', col: 'property_age', lo: 1, hi: 2 } },
      { key: 'property_age:3_5', col: 'cnt_3_5', countRpc: 'age', params: { p_age_min: 3, p_age_max: 5 }, pred: { kind: 'between', col: 'property_age', lo: 3, hi: 5 } },
      { key: 'property_age:6_9', col: 'cnt_6_9', countRpc: 'age', params: { p_age_min: 6, p_age_max: 9 }, pred: { kind: 'between', col: 'property_age', lo: 6, hi: 9 } },
      { key: 'property_age:10p', col: 'cnt_10p', countRpc: 'age', params: { p_age_min: 10 }, pred: { kind: 'gte', col: 'property_age', n: 10 } },
    ];
    default: return null;
  }
}

// ── request bodies, the way remote.ts builds them ────────────────────────────────────────────────
type Leg = 'Buy' | 'RentAnnual' | 'RentMonthly' | 'Combined' | 'Both';
const DEAL_OF: Record<Leg, { p_deal: string | null; p_rent_period: string | null }> = {
  Buy: { p_deal: 'بيع', p_rent_period: null },
  RentAnnual: { p_deal: 'إيجار', p_rent_period: 'سنوي' },
  RentMonthly: { p_deal: 'إيجار', p_rent_period: 'شهري' },
  Combined: { p_deal: null, p_rent_period: null },
  Both: { p_deal: 'إيجار', p_rent_period: 'كلاهما' },
};
const REGISTRY_SLOT: Record<string, { deal: string; period: string }> = { Buy: { deal: 'بيع', period: '' }, RentAnnual: { deal: 'إيجار', period: 'سنوي' }, RentMonthly: { deal: 'إيجار', period: 'شهري' } };

/** The SearchQuery shape cohortAllows() reads — enough of it to decide certification. */
function queryFor(types: string[], leg: Leg): any {
  const category = CLEAN_MACRO[types[0]];
  return {
    deal: leg === 'Buy' ? 'Buy' : 'Rent', category, types, type: null, detail: null, priceInput: '', priceBand: null, location: '',
    rentPeriod: leg === 'RentMonthly' ? 'monthly' : leg === 'Both' ? 'both' : 'annual',
    dealCombined: leg === 'Combined',
  };
}

function scopeBody(types: string[], leg: Leg, scope: Scope): Record<string, unknown> | null {
  const typesAr = typeArForTypes(types) ?? [];
  if (!typesAr.length) return null;
  const category = CLEAN_MACRO[types[0]];
  if (!types.every((t) => CLEAN_MACRO[t] === category)) return null;   // cross-category is impossible in the UI (R1.1.2)
  return {
    ...DEAL_OF[leg],
    p_category: category,
    ...scope.params,
    p_types: typesAr, p_tables: category === 'Commercial' ? COM_TABLES : RES_TABLES,
    p_types2: typesAr, p_tables2: category === 'Commercial' ? RES_TABLES : COM_TABLES,
  };
}
const searchBody = (base: Record<string, unknown>, params: Record<string, unknown>) => ({ ...base, ...params, p_per_platform: null, p_limit: 1500, p_offset: 0 });
const countBody = (base: Record<string, unknown>, params: Record<string, unknown>) => ({ ...base, ...params });
const key = (r: any) => `${r.source_table}:${r.listing_id}`;
const mergeParams = (...ps: Record<string, unknown>[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const p of ps) for (const [k, v] of Object.entries(p)) {
    if (k === 'p_amenities' && Array.isArray(out[k]) && Array.isArray(v)) out[k] = [...new Set([...(out[k] as string[]), ...(v as string[])])];
    else if (k === 'p_directions' && Array.isArray(out[k]) && Array.isArray(v)) out[k] = [...new Set([...(out[k] as string[]), ...(v as string[])])];
    else out[k] = v;
  }
  return out;
};

// ── the five witnesses ───────────────────────────────────────────────────────────────────────────
const PAGE = 1500;
async function rpcIds(body: Record<string, unknown>): Promise<{ ids: string[]; total: number }> {
  const ids: string[] = [];
  let total = 0;
  for (let off = 0; ; off += PAGE) {
    const rows = await rpc('location_search_candidates_ar', { ...body, p_limit: PAGE, p_offset: off });
    if (off === 0) total = Number(rows?.[0]?.total_count ?? rows.length);
    rows.forEach((x: any) => ids.push(key(x)));
    if (rows.length < PAGE || ids.length >= total || off > MAX_IDS) break;
  }
  return { ids, total };
}
type OracleOut = { ids: string[]; rows: Row[]; unhandled: string[] };
async function oracle(body: Record<string, unknown>, cols: string[] = []): Promise<OracleOut> {
  const { qs, unhandled } = buildOracleQS(body, { typeMacros: TYPE_MACROS, ...(DIRECTION_VARIANTS.map ? { directionVariants: DIRECTION_VARIANTS.map } : {}) });
  if (unhandled.length) return { ids: [], rows: [], unhandled };
  const select = ['source_table', 'listing_id', ...new Set(cols)].join(',');
  const ids: string[] = []; const rows: Row[] = [];
  for (let off = 0; ; off += 1000) {
    const page = await rest(`search_listings_ar?select=${select}&${qs}&order=source_table,listing_id`, { Range: `${off}-${off + 999}` });
    for (const r of page) { ids.push(key(r)); rows.push(r); }
    if (page.length < 1000 || off > MAX_IDS) break;
  }
  return { ids, rows, unhandled: [] };
}
async function oracleCount(body: Record<string, unknown>, extraQs = ''): Promise<number | null> {
  const { qs, unhandled } = buildOracleQS(body, { typeMacros: TYPE_MACROS, ...(DIRECTION_VARIANTS.map ? { directionVariants: DIRECTION_VARIANTS.map } : {}) });
  if (unhandled.length) return null;
  const r = await fetch(`${REST}/rest/v1/search_listings_ar?select=listing_id&${qs}${extraQs ? `&${extraQs}` : ''}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const cr = r.headers.get('content-range') || '';
  return cr.includes('/') ? Number(cr.split('/')[1]) : null;
}
const strictColsOf = (p: Pred): string[] => (p.kind === 'and' ? [...new Set(p.preds.flatMap(strictColsOf))] : [p.col]);

// ── a tiny semaphore ─────────────────────────────────────────────────────────────────────────────
let inFlight = 0; const waiters: Array<() => void> = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= CONCURRENCY) await new Promise<void>((res) => waiters.push(res));
  inFlight++;
  try { return await fn(); } finally { inFlight--; waiters.shift()?.(); }
}

// ── the index MOVES UNDER this check, and a verdict must describe ONE state of it ────────────────
// `search_listings_ar` is rebuilt while this job is reading it: `sync_search_listings_ar` (pg_cron
// jobid 28) runs at :14 past every hour and the location MV refresh (jobid 17) at :20, against a job
// that reads for ~28 minutes. Every witness compared here is a SEPARATE read — the chip from a count
// RPC, the search `total_count`, the paged id set, the independent PostgREST oracle — and the chip in
// particular is captured ONCE per cohort and then reused for every option in it, so it can be many
// minutes older than the reads it is judged against. A verdict that straddles a rebuild is comparing
// two different databases.
//
// Measured 2026-09-04 (run 33855677911): Villa+Farm/Buy @region:1 failed on ALL FOUR of its checks,
// the no-AF baseline included, in the 09:14–09:21 window that holds both cron jobs. Re-read on a
// quiet index every witness agreed exactly — chip 11,720 = search total 11,720 = 11,720 paged ids =
// 11,720 oracle rows, with 0 missing, 0 extra, 0 duplicates. Production was right the whole time; the
// harness accused it of a count defect it does not have.
//
// So this file now obeys the rule the PRODUCT obeys under R2.5.4/R13.11: our own inability to learn
// something is never a statement about the data. A disagreement is reported only when it survives a
// re-read that PROVABLY spans no rebuild. One that cannot be settled is UNDECIDED — counted, named
// and printed, never folded into a pass. This is not a tolerance and not a retry-until-green: the
// counts are a deterministic function of the index, so a real defect reproduces on every stable read
// and is still reported the first time it survives one.
const undecided: string[] = [];
const undecide = (label: string, why: string) => { undecided.push(`${label}: ${why}`); console.log(`UNDECIDED  ${label} — ${why}`); };

/**
 * A cheap exact fingerprint of the searchable index: how many rows it holds, and its newest write.
 * Either half being unreadable yields UNREADABLE_STAMP, which settleOnOneIndex treats as "moved" —
 * a stamp we could not read never certifies that a comparison saw one index.
 */
async function indexStamp(): Promise<string> {
  const [count, newest] = await Promise.all([
    fetch(`${REST}/rest/v1/search_listings_ar?select=listing_id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
      .then((r) => (r.headers.get('content-range') || '').split('/')[1] || '?').catch(() => '?'),
    rest('search_listings_ar?select=last_updated&order=last_updated.desc.nullslast&limit=1')
      .then((r: any) => r?.[0]?.last_updated ?? '?').catch(() => '?'),
  ]);
  return count === '?' && newest === '?' ? UNREADABLE_STAMP : `${count}@${newest}`;
}
const onOneIndex = <T>(take: () => Promise<T>) => settleOnOneIndex(indexStamp, take);

/** Re-read an option's own chip from the count RPC that produced it, NOW rather than minutes ago. */
async function chipNow(base: Record<string, unknown>, opt: Opt): Promise<number | null> {
  if (!opt.col || !opt.countRpc) return null;
  const row = (await rpc(opt.countRpc === 'age' ? 'property_age_option_counts_ar' : 'apartment_guided_counts_ar', countBody(base, {})))?.[0];
  return row ? Number(row[opt.col]) : null;
}

/** One option, five witnesses, one verdict. Returns the RPC id set so combos can do set algebra. */
async function verifyOption(label: string, base: Record<string, unknown>, opt: Opt, chip: number | null, applied: boolean, total: number | null)
  : Promise<{ ids: string[]; total: number } | null> {
  return withSlot(async () => {
    try {
      const body = searchBody(base, opt.params);
      const [r, o, a] = await Promise.all([
        rpcIds(body),
        oracle(body, strictColsOf(opt.pred)),
        applied ? rpc('af_eligible_count', countBody(base, opt.params)) : Promise.resolve(null),
      ]);
      if (o.unhandled.length) { skip(label, `oracle declined: ${o.unhandled[0].slice(0, 100)}`); return null; }
      let v = judgeOption({ label, chip, applied: a == null ? null : Number(a), rpcTotal: r.total, rpcIds: r.ids, oracleIds: o.ids, oracleRows: o.rows, pred: opt.pred });

      // A disagreement is only this product's if it survives a re-read taken on ONE index state —
      // chip included, since the chip handed in above may be many minutes old (see `indexStamp`).
      if (!v.ok) {
        const again = await onOneIndex(async () => {
          const [c2, r2, o2, a2] = await Promise.all([
            chip == null ? Promise.resolve(null) : chipNow(base, opt),
            rpcIds(body),
            oracle(body, strictColsOf(opt.pred)),
            applied ? rpc('af_eligible_count', countBody(base, opt.params)) : Promise.resolve(null),
          ]);
          if (o2.unhandled.length) return null;
          return judgeOption({ label, chip: c2, applied: a2 == null ? null : Number(a2), rpcTotal: r2.total, rpcIds: r2.ids, oracleIds: o2.ids, oracleRows: o2.rows, pred: opt.pred });
        });
        if (again.state === 'moved') {
          undecide(label, `the searchable index was rebuilt under the read (${again.stamp}) — no verdict, in either direction`);
          M.undecided++; return null;
        }
        if (again.result === null) { skip(label, 'oracle declined on the re-read'); return null; }
        if (again.result.ok) {
          M.reconciled++;
          info(`${label}: disagreed on the first read and agreed on a re-read proven to span no index rebuild — the first read straddled one`);
        }
        v = again.result;
      }

      M.missing += v.missing.length; M.extra += v.extra.length; M.dupes += v.dupes; M.nullLeaks += v.nullLeaks; M.rowViolations += v.rowViolations;
      if (v.reasons.some((x) => x.includes('≠'))) M.countMismatch++;
      if (chip === 0 || r.total === 0) {
        M.zeroOptions++;
        if (!judgeZero(chip, r.total, o.ids.length, r.ids)) { fail(`${label} · ZERO-RESULT`, `chip=${chip} total=${r.total} oracle=${o.ids.length} ids=${r.ids.length} — a zero option must be zero everywhere`); return null; }
      }
      if (opt.pred.kind === 'gte' || opt.pred.kind === 'between') {
        const b = boundaryReport(o.rows, opt.pred);
        if (b.exercised) M.boundariesExercised++; else M.boundariesUnexercised++;
      }
      if (chip != null && total != null) {
        M.options++;
        if (optionWouldRender(chip, total)) M.optionsRendered++;
      } else M.predicateOnly++;
      if (!v.ok) {
        fail(label, `${v.reasons.join(' | ')}\n      chip=${v.counts.chip} applied=${v.counts.applied} rpc_total=${v.counts.rpcTotal} rpc_ids=${v.counts.rpcIds} oracle=${v.counts.oracle}` +
          (v.extra.length ? `\n      first EXTRA (fails the filter): ${v.extra.slice(0, 3).join(', ')}` : '') +
          (v.missing.length ? `\n      first MISSING (eligible, dropped): ${v.missing.slice(0, 3).join(', ')}` : ''));
      } else {
        pass(label, `chip=${chip ?? '—'} = rpc ${r.total} = oracle ${o.ids.length} · ${v.nullLeaks} null-leaks · ${v.rowViolations} violations`);
      }
      return { ids: r.ids, total: r.total };
    } catch (e: any) { fail(label, `probe error: ${e.message}`); return null; }
  });
}

// ── STAGE 1 — every certified cohort × every scope × every option ─────────────────────────────────
type Cohort = { clean: string; leg: 'Buy' | 'RentAnnual' | 'RentMonthly'; qids: string[] };
const COHORTS: Cohort[] = [];
for (const [clean, cfg] of Object.entries(COHORT_QUESTIONS)) {
  if (ONLY.length && !ONLY.includes(clean)) continue;
  for (const leg of ['Buy', 'RentAnnual', 'RentMonthly'] as const) {
    const qids: string[] = (cfg as any)[leg] ?? [];
    if (qids.length) COHORTS.push({ clean, leg, qids });
  }
}
console.log(`\nAF full-surface differential — ${COHORTS.length} certified cohorts · ${SCOPES.length} scope(s) · ` +
  `${RES_TABLES.length}+${COM_TABLES.length} tables · directions ${DIRECTION_VARIANTS.observed.length} spellings\n`);

// registry cross-check: the code's cohort must be certified by at least one enabled registry row.
for (const c of COHORTS) {
  const folds = typeArForTypes([c.clean]) ?? [];
  const slot = REGISTRY_SLOT[c.leg];
  const certified = folds.filter((t) => enabledRows.has(`${slot.deal}|${slot.period}|${t}`));
  if (!certified.length) fail(`${c.clean}/${c.leg} is certified by the registry`, `COHORT_QUESTIONS ships [${c.qids.join(', ')}] but no enabled af_cohort_registry row exists for any of ${folds.join(', ')}`);
  const uncertifiedFolds = folds.filter((t) => !certified.includes(t));
  if (uncertifiedFolds.length) info(`${c.clean}/${c.leg}: folds ${uncertifiedFolds.join(', ')} have no registry row of their own (the cohort is certified through ${certified.join(', ')})`);
}

type CohortResult = { base: Record<string, unknown>; guided: any; age: any; firstIds: Record<string, { opt: Opt; ids: string[]; total: number; chip: number | null }>; dirIds: Record<string, { ids: string[]; chip: number }> };
const cohortResults = new Map<string, CohortResult>();

for (const scope of SCOPES) {
  M.scopes++;
  for (const c of COHORTS) {
    const types = [c.clean];
    const q = queryFor(types, c.leg);
    const base = scopeBody(types, c.leg, scope);
    const tag = `${c.clean}/${c.leg} @${scope.label}`;
    if (!base) { fail(tag, 'no type_ar fold — the scope would search everything'); continue; }
    M.cohorts++;

    // the card's count surfaces, exactly as the app requests them (no AF answer yet)
    let guided: any = null, age: any = null;
    try {
      guided = (await rpc('apartment_guided_counts_ar', countBody(base, {})))?.[0] ?? null;
      if (c.qids.includes('property_age')) age = (await rpc('property_age_option_counts_ar', countBody(base, {})))?.[0] ?? null;
    } catch (e: any) { fail(`${tag} · count RPCs`, e.message); continue; }
    const total = guided ? Number(guided.cnt_total_base) : null;

    // baseline: type purity + the headline itself, before any option
    const baseline = await withSlot(async () => {
      const body = searchBody(base, {});
      const [r, o] = await Promise.all([rpcIds(body), oracle(body)]);
      if (o.unhandled.length) { skip(`${tag} · baseline`, o.unhandled[0]); return null; }
      const v = judgeOption({ label: 'baseline', chip: total, applied: null, rpcTotal: r.total, rpcIds: r.ids, oracleIds: o.ids });
      M.basePurity++;
      if (!v.ok) { fail(`${tag} · baseline (no AF)`, v.reasons.join(' | ')); M.missing += v.missing.length; M.extra += v.extra.length; }
      else pass(`${tag} · baseline (no AF)`, `${r.total} rows, chip total ${total}`);
      return { ids: r.ids, total: r.total };
    });
    if (!baseline || baseline.total === 0) { if (baseline) info(`${tag}: empty cohort in this scope — options skipped`); continue; }

    const result: CohortResult = { base, guided, age, firstIds: {}, dirIds: {} };
    cohortResults.set(`${tag}`, result);

    // unknown captions (R7.1.3): the ones the card is allowed to show, each against the oracle's NULL count
    if (age && c.qids.includes('property_age')) {
      const nulls = await oracleCount(searchBody(base, {}), 'property_age=is.null');
      M.unknownCaptions++;
      if (nulls == null || !judgeUnknownCaption(Number(age.cnt_unknown), nulls)) fail(`${tag} · unknown caption (property_age)`, `card says ${age.cnt_unknown} did not state an age; DB has ${nulls}`);
      else pass(`${tag} · unknown caption (property_age)`, `${nulls} did not state an age`);
    }
    if (guided && c.qids.includes('furnished')) {
      const nulls = await oracleCount(searchBody(base, {}), 'furnished=is.null');
      const caption = Math.max(0, Number(guided.cnt_total_base) - Number(guided.cnt_furnished) - Number(guided.cnt_unfurnished));
      M.unknownCaptions++;
      if (nulls == null || !judgeUnknownCaption(caption, nulls)) fail(`${tag} · unknown caption (furnished)`, `card derives ${caption}; DB has ${nulls}`);
      else pass(`${tag} · unknown caption (furnished)`, `${nulls} did not state furnishing`);
    }
    if (guided && c.qids.includes('direction')) {
      const nulls = await oracleCount(searchBody(base, {}), 'direction_ar=is.null');
      const sum = Object.values(DIR_COL).reduce((s, col) => s + Number(guided[col] ?? 0), 0);
      const caption = Math.max(0, Number(guided.cnt_total_base) - sum);
      M.unknownCaptions++;
      if (nulls == null || !judgeUnknownCaption(caption, nulls)) fail(`${tag} · unknown caption (direction)`, `card derives ${caption} (= ${guided.cnt_total_base} − Σ8 ${sum}); DB has ${nulls}`);
      else pass(`${tag} · unknown caption (direction)`, `${nulls} did not state a direction`);
    }

    // every option of every certified question
    const jobs: Promise<void>[] = [];
    for (const qid of c.qids) {
      const opts = optionsFor(qid, types, q);
      if (!opts) { fail(`${tag} · ${qid}`, 'certified question with NO catalog entry in this sweep — add it to optionsFor(); an unmapped question is a certified predicate this sweep never tests'); continue; }
      for (const opt of opts) {
        const counts = opt.countRpc === 'age' ? age : guided;
        const chip = counts && opt.col ? Number(counts[opt.col]) : null;
        if (chip == null) { fail(`${tag} · ${opt.key}`, `the count RPC returned no ${opt.col} — a chip with no count path`); continue; }
        jobs.push(verifyOption(`${tag} · ${opt.key}`, base, opt, chip, true, total).then((r) => {
          if (r && !result.firstIds[qid] && chip >= 5) result.firstIds[qid] = { opt, ids: r.ids, total: r.total, chip };
          if (r && qid === 'direction' && chip > 0) result.dirIds[opt.key] = { ids: r.ids, chip };
          // the render gate is an offline rule; here only report an option the card WOULD render that does not narrow
          if (total != null && chip >= 5 && !optionWouldRender(chip, total)) { /* would be hidden by the usefulness rule — correct */ }
        }));
      }
    }
    // predicate-only tokens the chat may send (no chip): the click set must still be exact
    if (c.qids.includes('amenities') && CLEAN_MACRO[c.clean] === 'Residential' && !intersectChips(types)) {
      for (const tok of RICH_TOKENS) {
        const opt: Opt = { key: `amenities(chat-only):${tok}`, col: null, countRpc: null, params: { p_amenities: [tok] }, pred: { kind: 'true', col: tok } };
        jobs.push(verifyOption(`${tag} · ${opt.key}`, base, opt, null, true, null).then(() => {}));
      }
    }
    await Promise.all(jobs);

    // ── same-field OR (R7.2.2): two directions must UNION, and the footer chip must be the union ──
    const dirs = Object.entries(result.dirIds).sort((a, b) => b[1].chip - a[1].chip).slice(0, 2);
    if (dirs.length === 2) {
      const [a, b] = dirs;
      const ka = a[0].split(':')[1], kb = b[0].split(':')[1];
      await withSlot(async () => {
        const params = { p_directions: [ka, kb] };
        const [r, o, footer] = await Promise.all([rpcIds(searchBody(base, params)), oracle(searchBody(base, params), ['direction_ar']), rpc('apartment_guided_counts_ar', countBody(base, params))]);
        M.orCombos++;
        const u = judgeUnion(a[1].ids, b[1].ids, r.ids);
        const chip = Number(footer?.[0]?.cnt_selected);
        const v = judgeOption({ label: 'or', chip, applied: null, rpcTotal: r.total, rpcIds: r.ids, oracleIds: o.ids, oracleRows: o.rows, pred: { kind: 'in', col: 'direction_ar', vs: [...(DIRECTION_VARIANTS.map?.[ka] ?? [ka]), ...(DIRECTION_VARIANTS.map?.[kb] ?? [kb])] } });
        if (o.unhandled.length) skip(`${tag} · OR ${ka}+${kb}`, o.unhandled[0]);
        else if (!u.ok || !v.ok) fail(`${tag} · OR ${ka}+${kb}`, `union expected ${u.expected} got ${u.got} (missing ${u.missing.length}, extra ${u.extra.length}); ${v.reasons.join(' | ')}`);
        else pass(`${tag} · OR ${ka}+${kb}`, `${a[1].chip} ∪ ${b[1].chip} = ${r.total} (footer ${chip} = oracle ${o.ids.length})`);
      });
    }

    // ── cross-field AND (R7.2.2) + the second-round chip (R7.1.1) ─────────────────────────────────
    const firsts = Object.entries(result.firstIds);
    for (let i = 0; i < firsts.length; i++) for (let j = i + 1; j < firsts.length; j++) {
      const [qa, A] = firsts[i], [qb, B] = firsts[j];
      await withSlot(async () => {
        const params = mergeParams(A.opt.params, B.opt.params);
        const pred: Pred = { kind: 'and', preds: [A.opt.pred, B.opt.pred] };
        // the chip for B, computed INSIDE A (what the card shows in round 2 / after ticking A)
        const countsInA = B.opt.countRpc === 'age'
          ? (await rpc('property_age_option_counts_ar', countBody(base, A.opt.params)))?.[0]
          : (await rpc('apartment_guided_counts_ar', countBody(base, A.opt.params)))?.[0];
        const chipB = countsInA && B.opt.col ? Number(countsInA[B.opt.col]) : null;
        const [r, o] = await Promise.all([rpcIds(searchBody(base, params)), oracle(searchBody(base, params), strictColsOf(pred))]);
        M.andCombos++; M.secondRoundChips++;
        if (o.unhandled.length) { skip(`${tag} · AND ${A.opt.key} ∧ ${B.opt.key}`, o.unhandled[0]); return; }
        const it = judgeIntersection(A.ids, B.ids, r.ids);
        const v = judgeOption({ label: 'and', chip: chipB, applied: null, rpcTotal: r.total, rpcIds: r.ids, oracleIds: o.ids, oracleRows: o.rows, pred });
        M.missing += v.missing.length; M.extra += v.extra.length; M.nullLeaks += v.nullLeaks; M.rowViolations += v.rowViolations;
        if (!it.ok || !v.ok) fail(`${tag} · AND ${A.opt.key} ∧ ${B.opt.key}`, `intersection expected ${it.expected} got ${it.got} (missing ${it.missing.length}, extra ${it.extra.length}); second-round chip ${chipB}; ${v.reasons.join(' | ')}`);
        else pass(`${tag} · AND ${A.opt.key} ∧ ${B.opt.key}`, `${A.chip} ∩ ${B.chip} = ${r.total} (chip-in-round-2 ${chipB} = oracle ${o.ids.length})`);
      });
    }
    // the whole stack: every certified question answered at once
    if (firsts.length >= 3) {
      await withSlot(async () => {
        const params = mergeParams(...firsts.map(([, f]) => f.opt.params));
        const pred: Pred = { kind: 'and', preds: firsts.map(([, f]) => f.opt.pred) };
        const [r, o, a] = await Promise.all([rpcIds(searchBody(base, params)), oracle(searchBody(base, params), strictColsOf(pred)), rpc('af_eligible_count', countBody(base, params))]);
        M.stacked++;
        if (o.unhandled.length) { skip(`${tag} · STACK ×${firsts.length}`, o.unhandled[0]); return; }
        const v = judgeOption({ label: 'stack', chip: null, applied: Number(a), rpcTotal: r.total, rpcIds: r.ids, oracleIds: o.ids, oracleRows: o.rows, pred });
        M.missing += v.missing.length; M.extra += v.extra.length;
        if (!v.ok) fail(`${tag} · STACK ${firsts.map(([, f]) => f.opt.key).join(' ∧ ')}`, v.reasons.join(' | '));
        else pass(`${tag} · STACK ${firsts.map(([, f]) => f.opt.key).join(' ∧ ')}`, `${r.total} = oracle ${o.ids.length}`);
      });
    }
  }
}

// ── STAGE 2 — multi-type, combined deal, both periods (region scope only) ───────────────────────
if (!SKIP_MULTI) {
  const scope = SCOPES[0];
  const cleanTypes = [...new Set(COHORTS.map((c) => c.clean))];
  const legs = ['Buy', 'RentAnnual', 'RentMonthly'] as const;

  // multi-type pairs within one category: the surviving questions are the INTERSECTION (R2.2.1)
  for (const leg of legs) {
    const inLeg = cleanTypes.filter((t) => COHORTS.some((c) => c.clean === t && c.leg === leg));
    for (let i = 0; i < inLeg.length; i++) for (let j = i + 1; j < inLeg.length; j++) {
      const types = [inLeg[i], inLeg[j]];
      if (CLEAN_MACRO[types[0]] !== CLEAN_MACRO[types[1]]) continue;
      const q = queryFor(types, leg);
      const base = scopeBody(types, leg, scope);
      if (!base) continue;
      const qids = ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction', 'rating', 'unit_subtype'].filter((id) => cohortAllows(q, id));
      const tag = `${types.join('+')}/${leg} @${scope.label}`;
      M.multiTypePairs++;
      if (!qids.length) { info(`${tag}: empty certified intersection — the card offers nothing (correct, R2.2.4)`); continue; }
      let guided: any = null, age: any = null;
      try {
        guided = (await rpc('apartment_guided_counts_ar', countBody(base, {})))?.[0] ?? null;
        if (qids.includes('property_age')) age = (await rpc('property_age_option_counts_ar', countBody(base, {})))?.[0] ?? null;
      } catch (e: any) { fail(`${tag} · count RPCs`, e.message); continue; }
      const total = guided ? Number(guided.cnt_total_base) : null;
      if (!total) { info(`${tag}: empty in this scope`); continue; }
      // baseline union purity: the pair's set must be exactly the union of the two types' sets
      await withSlot(async () => {
        const label = `${tag} · baseline (type union, no AF)`;
        const take = async (chipNow: number | null) => {
          const [r, o] = await Promise.all([rpcIds(searchBody(base, {})), oracle(searchBody(base, {}))]);
          if (o.unhandled.length) return null;
          return judgeOption({ label: 'mt-base', chip: chipNow, applied: null, rpcTotal: r.total, rpcIds: r.ids, oracleIds: o.ids });
        };
        let v = await take(total);
        if (v === null) { skip(label, 'oracle declined'); return; }
        // Same rule as verifyOption: `total` above came from a count RPC read before this pair's
        // options were walked, so re-read it with the rest on one proven-stable index before accusing.
        if (!v.ok) {
          const again = await onOneIndex(async () => {
            const g = (await rpc('apartment_guided_counts_ar', countBody(base, {})))?.[0] ?? null;
            return take(g ? Number(g.cnt_total_base) : null);
          });
          if (again.state === 'moved') { undecide(label, `the searchable index was rebuilt under the read (${again.stamp}) — no verdict`); M.undecided++; return; }
          if (again.result === null) { skip(label, 'oracle declined on the re-read'); return; }
          if (again.result.ok) { M.reconciled++; info(`${label}: agreed on a re-read proven to span no index rebuild`); }
          v = again.result;
        }
        M.missing += v.missing.length; M.extra += v.extra.length; M.dupes += v.dupes;
        if (v.reasons.some((x) => x.includes('≠'))) M.countMismatch++;
        if (!v.ok) fail(label, v.reasons.join(' | ')); else pass(label, `${v.counts.rpcTotal}`);
      });
      const jobs: Promise<void>[] = [];
      for (const qid of qids) {
        const opts = optionsFor(qid, types, q) ?? [];
        // first option with a real chip, else the first option — every surviving question is exercised
        const counts = (o: Opt) => (o.countRpc === 'age' ? age : guided);
        const pick = opts.find((o) => o.col && counts(o) && Number(counts(o)[o.col!]) >= 5) ?? opts[0];
        if (!pick) continue;
        const chip = pick.col && counts(pick) ? Number(counts(pick)[pick.col]) : null;
        jobs.push(verifyOption(`${tag} · ${pick.key}`, base, pick, chip, true, total).then(() => {}));
      }
      await Promise.all(jobs);
    }
  }

  // combined Buy+Rent (p_deal null): only questions certified for ALL THREE legs (R2.4.1)
  for (const clean of cleanTypes) {
    const q = queryFor([clean], 'Combined');
    const qids = ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction', 'rating', 'unit_subtype'].filter((id) => cohortAllows(q, id));
    if (!qids.length) continue;
    const base = scopeBody([clean], 'Combined', scope);
    if (!base) continue;
    const tag = `${clean}/COMBINED(Buy∪Rent) @${scope.label}`;
    const guided = (await rpc('apartment_guided_counts_ar', countBody(base, {})))?.[0] ?? null;
    const total = guided ? Number(guided.cnt_total_base) : null;
    const jobs: Promise<void>[] = [];
    for (const qid of qids) for (const opt of optionsFor(qid, [clean], q) ?? []) {
      const chip = opt.col && guided ? Number(guided[opt.col]) : null;
      M.combinedDeal++;
      jobs.push(verifyOption(`${tag} · ${opt.key}`, base, opt, chip, true, total).then(() => {}));
    }
    await Promise.all(jobs);
  }

  // both periods ('كلاهما'): only questions certified for RentAnnual AND RentMonthly (R2.3.1)
  for (const clean of cleanTypes) {
    const q = queryFor([clean], 'Both');
    const qids = ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction', 'rating', 'unit_subtype'].filter((id) => cohortAllows(q, id));
    if (!qids.length) continue;
    const base = scopeBody([clean], 'Both', scope);
    if (!base) continue;
    const tag = `${clean}/Rent-BOTH(كلاهما) @${scope.label}`;
    const guided = (await rpc('apartment_guided_counts_ar', countBody(base, {})))?.[0] ?? null;
    const total = guided ? Number(guided.cnt_total_base) : null;
    const jobs: Promise<void>[] = [];
    for (const qid of qids) for (const opt of optionsFor(qid, [clean], q) ?? []) {
      const chip = opt.col && guided ? Number(guided[opt.col]) : null;
      M.bothPeriod++;
      jobs.push(verifyOption(`${tag} · ${opt.key}`, base, opt, chip, true, total).then(() => {}));
    }
    await Promise.all(jobs);
  }
}

// ── the report ───────────────────────────────────────────────────────────────────────────────────
console.log(`
══════ AF FULL-SURFACE DIFFERENTIAL — SUMMARY ══════
COHORTS × SCOPES:                 ${M.cohorts} (${COHORTS.length} certified cohorts × ${M.scopes} scope(s))
OPTIONS WITH A CHIP VERIFIED:     ${M.options} (${M.optionsRendered} would render under the usefulness rule; the rest are hidden but must still be true)
PREDICATE-ONLY (chat) VERIFIED:   ${M.predicateOnly}
ZERO-RESULT OPTIONS VERIFIED:     ${M.zeroOptions}
SAME-FIELD OR COMBOS:             ${M.orCombos}
CROSS-FIELD AND COMBOS:           ${M.andCombos} (each with its round-2 chip)
FULL STACKS:                      ${M.stacked}
MULTI-TYPE PAIRS:                 ${M.multiTypePairs}
COMBINED BUY∪RENT OPTIONS:        ${M.combinedDeal}
BOTH-PERIOD OPTIONS:              ${M.bothPeriod}
UNKNOWN CAPTIONS VERIFIED:        ${M.unknownCaptions}
BOUNDARIES EXERCISED/UNEXERCISED: ${M.boundariesExercised}/${M.boundariesUnexercised}
MISSING: ${M.missing}   EXTRA: ${M.extra}   DUPLICATES: ${M.dupes}   COUNT MISMATCHES: ${M.countMismatch}
NULL→VALUE LEAKS: ${M.nullLeaks}   ROW VIOLATIONS: ${M.rowViolations}
RECONCILED ACROSS AN INDEX REBUILD: ${M.reconciled}   UNDECIDED (index moved, no verdict): ${M.undecided}${undecided.length ? '\n  ' + undecided.slice(0, 10).join('\n  ') : ''}
ORACLE REFUSALS (SKIP): ${skipped.length}${skipped.length ? '\n  ' + skipped.slice(0, 10).join('\n  ') : ''}
`);

// An UNDECIDED comparison is missing coverage, not a pass — so a run that could not certify a
// meaningful share of the surface must be loud rather than green. The index is rebuilt for ~2 of this
// job's ~28 minutes, and a straddled comparison is re-taken in seconds, so undecided should be rare;
// crossing the floor means the re-takes are straddling too, and the run proved little.
const attempted = M.options + M.predicateOnly;
const undecidedFloor = Math.max(5, Math.round(attempted * 0.01));
if (M.undecided > undecidedFloor) {
  fail('index stability', `${M.undecided} comparison(s) could not be settled on one index state (floor ${undecidedFloor} of ${attempted} attempted) — this run did not certify the surface`);
}

console.log(failures
  ? `✗ verify-af-full-surface-differential: ${failures} failure(s):\n` + failedLabels.map((l) => `    • ${l}`).join('\n') + '\n'
  : '✅ verify-af-full-surface-differential: every certified option shows DB truth and clicks to exactly that set\n');
process.exit(failures ? 1 : 0);
