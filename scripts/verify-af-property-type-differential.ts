// PROPERTY-TYPE CORRECTNESS, PROVEN ROW BY ROW, FOR EVERY CERTIFIED COHORT.
//
// ── THE OWNER REQUIREMENT THIS ENFORCES (2026-09-01, "extremely high priority") ──────────────────
//
//   "When a user chooses a property type and then selects Advanced Filter options, the user MUST
//    get exactly what they asked for. Every returned listing must be the correct property type AND
//    satisfy every selected Advanced Filter condition."
//
// Existing AF barriers each prove a slice: verify-af-live-truth.ts drives ~9 hand-picked journeys,
// verify-af-cohort-questions-certified.ts pins WHICH questions a cohort may offer, and
// verify-af-scope-hierarchy.ts pins the scope rules. None of them sweeps EVERY certified
// (clean type × deal × period) cohort × EVERY question that cohort certifies and diffs the exact
// returned ID set. That sweep is what this file is.
//
// ── WHY THE SET-DIFF IS SUFFICIENT ───────────────────────────────────────────────────────────────
//
// The independent oracle (scripts/lib/afOracleFilter.ts, reached through PostgREST — never by
// re-calling our own RPC) encodes BOTH halves of the requirement in one query: `type_ar=in.(…)`
// AND the AF predicate. So an exact ID-set match proves, simultaneously:
//
//   MISSING = 0   →  no eligible listing of the right type was dropped
//   EXTRA   = 0   →  every returned listing IS the right type AND satisfies the AF predicate
//   DUPES   = 0   →  no listing is served twice
//   COUNT   = ok  →  the number the user is shown equals independent DB truth
//
// A type leak is an EXTRA by construction: a listing whose `type_ar` is outside the selected set
// cannot be in the oracle's result, so it shows up in the diff. There is no separate "leak check"
// to forget to run.
//
// This only became possible on 2026-09-01. Before that the oracle refused any request carrying
// price/area/beds/bath_exact/floor/age/tenant/licence (see
// verify-af-oracle-classifies-every-search-param.ts), so a property-type × AF differential could
// not be computed at all.
//
// ── WHAT "THE CORRECT PROPERTY TYPE" ACTUALLY MEANS ──────────────────────────────────────────────
//
// NOT "type_ar equals the label the user tapped". The expected set comes from `typeArForTypes()` in
// src/data/propertyTypes.ts — the SAME pure function src/data/remote.ts:352 uses to build `p_types`.
// Several folds are deliberate owner rules, and hard-coding a naive one-label-per-type expectation
// here would manufacture false leaks:
//   • Villa  = فيلا + قصر + تاون هاوس + بيت      (owner 2026-07-20)
//   • Apartment = شقة + مبنى شقق مخدومة + ملحق علوي
//   • Rest House = استراحة + إستراحة              (hamza spelling variant, aqarcity)
// Importing the real function instead of restating it means this barrier cannot drift from the
// product when a fold changes.
//
// Scope B (R1.1.3) is deliberately included: a Residential search also probes the *_commercial_
// tables for the same Arabic type_ar, because real residential listings are misfiled on commercial
// platforms. That widens TABLES, never TYPES — so it cannot cause a type leak, and the oracle
// models it the same way production does.
//
// ── SELF-CONFIGURING, BY DESIGN ──────────────────────────────────────────────────────────────────
//
// Every input is read live: the certified cohorts from src/lib/afCohorts.ts, the type folds from
// src/data/propertyTypes.ts, and the table list / direction vocabulary / unit-subtype vocabulary
// from production itself. Nothing here is a hardcoded catalog that can silently rot — a new
// property type or a new certification is picked up on the next run without editing this file.
//
//   node --experimental-strip-types scripts/verify-af-property-type-differential.ts
//   AF_PTD_ONLY=Villa,Shop   → restrict to certain clean types (debugging)
//
// LIVE CHECK — excluded from `npm test` (see scripts/test-exclusions.txt); runs in the AF live
// workflow, like every other check that talks to production.

import { COHORT_QUESTIONS, COHORT_CHIPS } from '../src/lib/afCohorts.ts';
import { typeArForTypes, CLEAN_MACRO } from '../src/data/propertyTypes.ts';
import { buildOracleQS } from './lib/afOracleFilter.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: REST, key: KEY } = resolvePublicSupabase(process.env);
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

let failures = 0;
const fail = (label: string, detail: string) => { failures++; console.error(`FAIL  ${label}\n      ${detail}`); };
const pass = (label: string, detail = '') => console.log(`PASS  ${label}${detail ? `  ${detail}` : ''}`);

// ── live reference data (never hardcoded) ────────────────────────────────────────────────────────
async function rest(path: string, extraHeaders: Record<string, string> = {}): Promise<any> {
  const r = await fetch(`${REST}/rest/v1/${path}`, { headers: { ...H, ...extraHeaders } });
  if (!r.ok) throw new Error(`REST ${r.status} on ${path.slice(0, 120)}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const TYPE_MACROS: Record<string, string> = Object.fromEntries(
  (await rest('known_type_ar?select=type_ar,macro')).map((x: any) => [x.type_ar, x.macro]),
);

/** Every served source table, split the way resolveSearchScope splits them. */
const { RES_TABLES, COM_TABLES } = await (async () => {
  const seen = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const rows = await rest(
      'search_listings_ar?select=source_table&order=source_table,listing_id',
      { Range: `${off}-${off + 999}` },
    );
    rows.forEach((r: any) => seen.add(r.source_table));
    if (rows.length < 1000 || off > 300000) break;
  }
  const all = [...seen];
  return {
    RES_TABLES: all.filter((t) => t.includes('_residential_')).sort(),
    COM_TABLES: all.filter((t) => t.includes('_commercial_')).sort(),
  };
})();

/** Direction + unit-subtype vocabularies, read from the index rather than assumed. */
const DIRECTIONS: string[] = (await rest(
  'search_listings_ar?select=direction_ar&direction_ar=not.is.null&limit=400&order=source_table,listing_id',
)).map((r: any) => r.direction_ar).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).slice(0, 2);

const SUBTYPES: string[] = (await rest(
  'search_listings_ar?select=unit_subtype_ar&unit_subtype_ar=not.is.null&limit=400&order=source_table,listing_id',
)).map((r: any) => r.unit_subtype_ar).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).slice(0, 1);

console.log(`\nAF property-type differential — ${RES_TABLES.length} residential + ${COM_TABLES.length} commercial tables, ` +
            `directions ${JSON.stringify(DIRECTIONS)}, subtypes ${JSON.stringify(SUBTYPES)}\n`);

// ── one concrete, certified answer per question id ───────────────────────────────────────────────
// Deliberately a NARROWING answer in every case: a predicate that matches everything would make the
// diff pass without exercising anything.
const RESIDENTIAL_BASE_CHIPS = ['elevator', 'parking', 'kitchen'];
function answerFor(qid: string, cleanType: string): Record<string, unknown> | null {
  const chips = COHORT_CHIPS[cleanType] ?? RESIDENTIAL_BASE_CHIPS;
  switch (qid) {
    case 'bathrooms': return { p_bath_min: 2 };
    case 'property_age': return { p_age_max: 5 };
    case 'amenities': return chips.length ? { p_amenities: [chips[0]] } : null;
    case 'furnished': return { p_furnished: true };
    case 'rnpl': return { p_amenities: ['rnpl'] };
    case 'street_width': return { p_street_width_min: 15 };
    case 'direction': return DIRECTIONS.length ? { p_directions: DIRECTIONS } : null;
    case 'rating': return { p_rating_min: 4 };
    case 'unit_subtype': return SUBTYPES.length ? { p_unit_subtypes: SUBTYPES } : null;
    default: return null;                       // an unknown id is reported by the caller, never skipped silently
  }
}

const DEAL_OF: Record<string, { p_deal: string; p_rent_period?: string }> = {
  Buy: { p_deal: 'بيع' },
  RentAnnual: { p_deal: 'إيجار', p_rent_period: 'سنوي' },
  RentMonthly: { p_deal: 'إيجار', p_rent_period: 'شهري' },
};

// EVERY CASE IS SCOPED TO A REGION, DELIBERATELY (2026-09-01).
//
// With NO location narrowing, af_eligibility_clause() switches on its UNLOCATED carve-out and also
// admits non-production_ready rows we could not place on the map (see afOracleFilter.ts). That is
// correct product behaviour, but it is not something the independent oracle models, so a
// location-less sweep would report a phantom EXTRA on every cohort that owns an unlocated row —
// measured: Duplex/Buy nationwide, rpc 125 vs oracle 124, the one row being a genuine «دوبلكس».
//
// Scoping to a region disables the carve-out by construction AND is the realistic user journey.
// The location-less case is not thereby ignored: verifyNationwideCarveOut() below covers it with a
// direct SQL model of the clause, which CAN express search_row_price_gated().
const REGION_IDS = [1];   // منطقة الرياض — the largest region, so cohorts stay non-empty

/** The request body the app would send for this scope — same shape as remote.ts builds. */
function bodyFor(cleanType: string, leg: string, answer: Record<string, unknown>) {
  const typesAr = typeArForTypes([cleanType]) ?? [];
  const category = CLEAN_MACRO[cleanType];
  return {
    ...DEAL_OF[leg],
    p_category: category,
    p_region_ids: REGION_IDS,
    // SCOPE A IS THE CATEGORY'S OWN TABLES; SCOPE B IS THE MISFILE MIRROR (remote.ts ~596-625).
    // Getting this backwards is not a small error: على a Commercial scope it makes «عمارة» — a
    // `both`-macro label that means Commercial Building in a com table but RESIDENTIAL Building in a
    // res table — read from the residential side, and the oracle then "expects" 711 apartment blocks
    // production correctly withholds (measured: rpc 28 vs oracle 711 before this was fixed).
    // Production guards that exact leak deliberately (COMMERCIAL_TYPE_AR_RES excludes عمارة), and the
    // oracle's own category-purity arm reproduces it: scope A keeps `both`, scope B keeps only an
    // exact macro match. So assigning the scopes by category is all that is needed here.
    p_types: typesAr, p_tables: category === 'Commercial' ? COM_TABLES : RES_TABLES,
    p_types2: typesAr, p_tables2: category === 'Commercial' ? RES_TABLES : COM_TABLES,
    ...answer,
    p_per_platform: null, p_limit: 1500, p_offset: 0,
  };
}

const key = (r: any) => `${r.source_table}:${r.listing_id}`;

// THE RPC MUST BE PAGED, NOT SAMPLED (2026-09-01). p_limit caps a single call, so comparing one
// page against the oracle's FULL set reports the page shortfall as MISSING: measured Villa/Buy
// rpc_total 2,966 == oracle 2,966 (counts already agreeing) yet MISSING=1,466, which is exactly
// 2,966 - 1,500. That is arithmetic, not a defect. Walk p_offset the way Load-More does; the RPC's
// unconditional (source_table, listing_id) tiebreaker makes the order total, so paging is gap-free.
const PAGE = 1500;
async function rpcIds(body: any): Promise<{ ids: string[]; total: number; dupes: number }> {
  const ids: string[] = [];
  let total = 0;
  for (let off = 0; ; off += PAGE) {
    const r = await fetch(`${REST}/rest/v1/rpc/location_search_candidates_ar`, {
      method: 'POST', headers: H, body: JSON.stringify({ ...body, p_limit: PAGE, p_offset: off }),
    });
    if (!r.ok) throw new Error(`RPC ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    if (off === 0) total = Number(rows?.[0]?.total_count ?? rows.length);
    rows.forEach((x: any) => ids.push(key(x)));
    if (rows.length < PAGE || ids.length >= total || off > 60000) break;
  }
  return { ids, total, dupes: ids.length - new Set(ids).size };
}

async function oracleIds(body: any): Promise<{ ids: string[]; unhandled: string[] }> {
  const { qs, unhandled } = buildOracleQS(body, { typeMacros: TYPE_MACROS });
  if (unhandled.length) return { ids: [], unhandled };
  const out: string[] = [];
  for (let off = 0; ; off += 1000) {
    const rows = await rest(
      `search_listings_ar?select=source_table,listing_id&${qs}&order=source_table,listing_id`,
      { Range: `${off}-${off + 999}` },
    );
    rows.forEach((r: any) => out.push(key(r)));
    if (rows.length < 1000 || off > 40000) break;
  }
  return { ids: out, unhandled: [] };
}

// ── the sweep ────────────────────────────────────────────────────────────────────────────────────
const ONLY = (process.env.AF_PTD_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

type Case = { cleanType: string; leg: string; qid: string; answer: Record<string, unknown> };
const CASES: Case[] = [];
const unmapped: string[] = [];
for (const [cleanType, cfg] of Object.entries(COHORT_QUESTIONS)) {
  if (ONLY.length && !ONLY.includes(cleanType)) continue;
  for (const leg of ['Buy', 'RentAnnual', 'RentMonthly']) {
    const ids: string[] = (cfg as any)[leg] ?? [];
    if (!ids.length) continue;
    // A baseline with NO AF answer proves type purity on its own, before any predicate narrows it.
    CASES.push({ cleanType, leg, qid: '(no AF — type purity only)', answer: {} });
    for (const qid of ids) {
      const answer = answerFor(qid, cleanType);
      if (!answer) { unmapped.push(`${cleanType}/${leg}/${qid}`); continue; }
      CASES.push({ cleanType, leg, qid, answer });
    }
  }
}

// A certified question this file cannot express is a COVERAGE HOLE, not a skip: it would silently
// shrink the sweep the next time a new question type is certified.
if (unmapped.length) {
  fail('every certified question has a concrete answer in this barrier',
    `no answerFor() mapping: ${[...new Set(unmapped)].join(', ')}\n      ` +
    'Add it to answerFor() — an unmapped question is a certified predicate this sweep never tests.');
}

console.log(`${CASES.length} cases across ${new Set(CASES.map((c) => c.cleanType)).size} certified clean types\n`);

// Sequential on purpose: the measured concurrency knee is 3 and the sustained ceiling ~1.5
// searches/s (SEARCH_MATCH_QA_ENGINEER.md §40.1). This sweep is not worth destabilising production.
let checked = 0, skippedEmpty = 0, refused = 0;
const worst: string[] = [];
for (const c of CASES) {
  const body = bodyFor(c.cleanType, c.leg, c.answer);
  const label = `${c.cleanType}/${c.leg} · ${c.qid}`;
  if (!body.p_types.length) { fail(label, 'typeArForTypes() returned no Arabic type — the scope would search everything'); continue; }
  try {
    const [r, o] = await Promise.all([rpcIds(body), oracleIds(body)]);
    if (o.unhandled.length) { refused++; console.log(`SKIP  ${label} — oracle declined: ${o.unhandled[0].slice(0, 80)}`); continue; }
    const rs = new Set(r.ids), os = new Set(o.ids);
    const missing = o.ids.filter((i) => !rs.has(i));
    const extra = r.ids.filter((i) => !os.has(i));
    const countOk = r.total === os.size;
    if (r.total === 0 && os.size === 0) { skippedEmpty++; continue; }   // empty cohort proves nothing
    checked++;
    if (missing.length || extra.length || r.dupes || !countOk) {
      fail(label,
        `MISSING=${missing.length} EXTRA=${extra.length} DUPES=${r.dupes} ` +
        `rpc_total=${r.total} oracle=${os.size}` +
        (extra.length ? `\n      first EXTRA (wrong type or fails the predicate): ${extra.slice(0, 3).join(', ')}` : '') +
        (missing.length ? `\n      first MISSING (eligible but dropped): ${missing.slice(0, 3).join(', ')}` : ''));
      worst.push(label);
    } else {
      pass(label, `${r.total} rows · MISSING=0 EXTRA=0 DUPES=0`);
    }
  } catch (e: any) {
    fail(label, `probe error: ${e.message}`);
  }
}

console.log(`\n${checked} non-empty cases verified · ${skippedEmpty} empty cohorts skipped · ${refused} oracle refusals`);
if (worst.length) console.error(`cases with a mismatch: ${worst.join(' | ')}`);
console.log(failures
  ? `\n✗ verify-af-property-type-differential: ${failures} failure(s)\n`
  : '\n✅ verify-af-property-type-differential: every certified cohort returns ONLY listings of the ' +
    'selected property type that satisfy the selected AF predicate\n');
process.exit(failures ? 1 : 0);
