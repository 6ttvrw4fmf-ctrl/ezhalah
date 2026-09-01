// TRIPWIRE: fail CI when a migration re-issues location_search_candidates_ar with a body that DROPS a
// clause that must always be present.
//
// WHY THIS EXISTS (real incident, 2026-07-17): migration 20260716221011 moved the Monthly/Yearly rent
// filter onto s.payment_monthly (payment schedule — the owner's permanent rule). 139 seconds later,
// 20260716221230 (PR#120, "newest first NULLS LAST") re-issued CREATE OR REPLACE FUNCTION
// location_search_candidates_ar from a body COPIED FROM THE PREVIOUS RPC MIGRATION, silently carrying the
// stale rent-period clause and reverting the fix in production. 15,221 listings were returned by the wrong
// rent-period filter and 15,419 vanished from Monthly, with no error and no test failure. The repo copy was
// stale too, so a replay would have re-reverted it again.
//
// The failure mode is generic: this RPC is defined by full-body CREATE OR REPLACE in many migrations, so
// ANY author who copies an older body silently deletes newer clauses. This tripwire pins the invariants.
//
// It is deliberately OFFLINE + STATIC (no DB connection — CI has none, and tripwires here are offline-only):
// it replays the repo's migration ORDER exactly as Supabase would, takes the LAST migration that defines
// the RPC (that body is what a fresh replay produces), and asserts every required clause survives.
//
//   node --experimental-strip-types scripts/verify-rpc-clause-invariants.ts   (wired into `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const RPC = 'location_search_candidates_ar';

// Each invariant = a clause that MUST appear in the effective (last) definition of the RPC.
// `marker` is matched case-insensitively against the migration body.
const REQUIRED: { name: string; marker: RegExp; why: string }[] = [
  {
    name: 'rent-period buckets on payment_monthly (payment SCHEDULE, not lease length)',
    marker: /payment_monthly/i,
    why: 'Owner permanent rule: Monthly = source explicitly offers monthly payment; Yearly = must pay annually. Reverted once by PR#120 (15,221 listings in the wrong bucket).',
  },
  {
    name: 'category purity via known_type_ar',
    marker: /known_type_ar/i,
    why: 'Residential/Commercial purity — without it ~14k Commercial-macro rows leak into Residential results.',
  },
  {
    name: 'newest-first ordering uses NULLS LAST',
    marker: /nulls\s+last/i,
    why: 'PR#120: unknown-date rows must sort LAST, not first.',
  },
  {
    name: 'furnished filter is NULL-strict (consistent with the amenities furnished token)',
    marker: /p_furnished\s+is null or s\.furnished\s*=\s*p_furnished/i,
    why: 'Bug C (2026-07-23): p_furnished must exclude furnished-unknown rows like every other strict boolean and the amenities path (both return 31,394). NULL-permissive returned 72,483 (furnished IS NOT FALSE).',
  },
  {
    name: 'tenant filter is NULL-strict',
    marker: /p_tenant\s+is null or s\.tenant_ar\s*=\s*p_tenant/i,
    why: '2026-07-27 audit: the permissive form returned 75,014 rows for p_tenant=>عوائل instead of the strict 5,751 — tenant-unknown rows must not pass an explicit tenant filter.',
  },
  {
    name: 'directions filter is NULL-strict and vocabulary-canonicalized (norm_direction_ar on BOTH sides)',
    marker: /norm_direction_ar\(s\.direction_ar\)\s+in\s*\(select norm_direction_ar\(d\)/i,
    why: '2026-07-27 audit: direction_ar holds two vocabulary families (شمال 14,869 vs شمالية 40); a literal match makes one family unreachable, and the old NULL-permissive clause returned 67,439 instead of 14,869.',
  },
  {
    name: 'street-width filter is NULL-strict (street_width_m IS NOT NULL required)',
    marker: /s\.street_width_m is not null/i,
    why: '2026-07-27 audit: NULL-permissive returned 89,819 for p_street_width_min=>20 instead of the strict 20,112.',
  },
  {
    name: 'floor filter is NULL-strict (floor_number IS NOT NULL required)',
    marker: /s\.floor_number is not null/i,
    why: '2026-07-27 audit: NULL-permissive returned 108,880 for p_floor_min=>3 instead of the strict 3,661 (96.6% false positives — floor coverage is only 4.9%).',
  },
  {
    name: "amenity token 'rent_now_pay_later' is an explicit alias of 'rnpl'",
    marker: /'rent_now_pay_later'\s*=\s*any\(p_amenities\)\)\s*or s\.rent_now_pay_later/i,
    why: "2026-07-27 audit: the literal token silently degraded to an UNFILTERED search (75,492 instead of 15,199).",
  },
  {
    name: 'unknown amenity tokens fail CLOSED (vocabulary guard present)',
    marker: /not exists \(select 1 from unnest\(p_amenities\) tok/i,
    why: 'An unrecognized amenity token must never silently widen a search to "no filter" — it must match nothing, so the mistake is visible the first time it ships.',
  },
  {
    name: 'bedrooms filter is the guarded tri-arm union (no-filter / exact-any / min), exact ∪ min DELIBERATE',
    marker: /\(\(coalesce\(cardinality\(p_beds_exact\),0\) = 0 and p_beds_min is null\) or \(coalesce\(cardinality\(p_beds_exact\),0\) > 0 and s\.bedrooms = any\(p_beds_exact\)\) or \(p_beds_min is not null and s\.bedrooms >= p_beds_min\)\)/i,
    why: 'SEMANTICS CHANGED DELIBERATELY (20260809161258 + 20260811125918 shared-eligibility layer), certified live 2026-08-15: the app’s bedrooms multi-select sends p_beds_exact=[1,2,3,4] AND p_beds_min=5 together for a 1–4 ∪ 5+ selection — the union IS the correct result (verified [1,2,3,4]∪≥5 = 8,254, chip == results == referee == direct SQL). The 2026-07-28 CASE-exclusive form would silently drop every 5+ listing from that selection.',
  },
  {
    name: 'per-platform total_count is computed pre-cap (same window pass as row_number, before rn <= p_per_platform)',
    // Widened 2026-08-29 (PHOTO PREFERENCE + CONTROLLED ROTATION): m.has_photo is now selected right
    // before count(*) over() in this same window pass — an optional, bounded gap tolerates that new
    // column without loosening the actual invariant (count(*) over() must still sit directly before
    // row_number(), i.e. still the SAME window pass, still pre-cap).
    marker: /m\.bedrooms,\s*(?:m\.has_photo,\s*)?count\(\*\) over \(\) as total_count,\s*row_number\(\) over \(/i,
    why: '2026-07-28 audit: total_count in the p_per_platform branch was computed AFTER the diversification cap — live-verified 54 instead of the true 35,535 for the same filter (Riyadh/Residential/بيع, p_per_platform:=5).',
  },
  {
    name: 'p_limit is clamped non-negative (greatest(p_limit, 0)), matching the existing p_offset guard',
    marker: /limit greatest\(p_limit,\s*0\) offset greatest\(p_offset,\s*0\)/i,
    why: "2026-07-28 audit: p_offset already guards itself but p_limit didn't — a negative p_limit raised a hard 'LIMIT must not be negative' Postgres error instead of degrading like p_limit:=0 already does (0 rows, no error).",
  },
  {
    name: 'PLATFORM DIVERSITY: the default branch computes a per-platform round-robin rank (div_rank)',
    // Widened 2026-08-29 (PHOTO PREFERENCE, owner PERMANENT rule): div_rank's own row_number() now
    // orders by photo status FIRST, recency second — folding photo preference INTO diversity's own
    // per-platform ordering (a platform's #1 round-robin slot is its own best real-photo, most-recent
    // listing) rather than layering photo as a separate key after div_rank, which let a no-photo row
    // outrank a same-platform photo row (caught+fixed live, same session). The bounded, non-greedy gap
    // tolerates that new ordering clause while still requiring recency+id as the row_number's own
    // secondary tiebreak and "end as div_rank" — div_rank is still computed, still partitioned by
    // platform, still ends in the unique (source_table, listing_id).
    marker: /then row_number\(\) over \(\s*partition by m\.platform[\s\S]{0,1300}?order by[\s\S]{0,240}?m\.recency_at desc nulls last, m\.source_table, m\.listing_id\s*\)\s*end as div_rank/i,
    why: 'Owner PERMANENT rule 2026-08-05 (MATCH FIRST -> DIVERSIFY SECOND). Without this, ordering is pure recency and one platform saturates every window — live-measured 65-row single-platform streak with 11 qualifying platforms and 9,257 eligible rows.',
  },
  {
    name: 'PLATFORM DIVERSITY: div_rank leads the tie-break in the default branch (before recency)',
    // Widened 2026-08-29: PHOTO PREFERENCE (photo_rank) and CONTROLLED ROTATION (rot_key) now sit
    // BETWEEN div_rank and recency, per the owner's MATCH -> DIVERSITY -> PHOTO -> ROTATION hierarchy
    // — the bounded gap tolerates those two new intervening keys while still requiring div_rank to
    // lead and the sequence to still end in the same unique (source_table, listing_id) total order.
    marker: /a\.div_rank asc nulls last,[\s\S]{0,120}?a\.recency_at desc nulls last, a\.source_table, a\.listing_id/i,
    why: 'The rank must be APPLIED, and must sit BEFORE recency — otherwise it is computed and ignored. Ending in the unique (source_table, listing_id) keeps the sort a TOTAL order, which is what makes paging deterministic and duplicate-free.',
  },
  {
    name: 'PLATFORM DIVERSITY: the outer union ORDER BY honours div_rank too',
    // Widened 2026-08-29, same reason as the check above — u.photo_rank/u.rot_key now sit between
    // u.div_rank and u.recency_at in the outer (post-union) ORDER BY too.
    marker: /u\.div_rank asc nulls last,[\s\S]{0,120}?u\.recency_at desc nulls last, u\.source_table, u\.listing_id/i,
    why: 'The outer ORDER BY re-sorts the page after the union. If it ignores div_rank it silently reverts the page to recency order, undoing the diversification the inner branch just computed.',
  },
  {
    name: 'PLATFORM DIVERSITY: objective sorts are excluded from diversification',
    marker: /coalesce\(p_sort_by,''\) not in \('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest'\)/i,
    why: "Owner requirement: price/area/bedrooms/oldest must retain their exact intended semantics. div_rank must be NULL for those 6 sorts (verified: 0 mismatched positions over 300 rows x 6 sorts).",
  },
];

// A clause that must NOT come back: the pre-fix rent-period predicate keyed on lease length + a hardcoded
// platform list. Its presence means someone pasted a stale body.
const FORBIDDEN: { name: string; marker: RegExp; why: string }[] = [
  {
    name: "stale rent-period clause (rent_period_ar + hardcoded platform in ('gathern','aqarmonthly'))",
    marker: /p_rent_period\s*=\s*'شهري'[\s\S]{0,120}?platform\s+in\s*\(\s*'gathern'\s*,\s*'aqarmonthly'\s*\)/i,
    why: 'This is the reverted, lease-length-based bucket. Rent period must bucket on payment_monthly.',
  },
  {
    name: 'NULL-permissive furnished predicate (Bug C regression)',
    marker: /p_furnished\s+is null or s\.furnished is null/i,
    why: 'Reintroduces Bug C: p_furnished would keep furnished-unknown rows (72,483) instead of the strict 31,394 the amenities path returns.',
  },
  {
    name: 'NULL-permissive tenant predicate',
    marker: /or s\.tenant_ar is null or/i,
    why: 'Reintroduces the 2026-07-27 defect: tenant-unknown rows pass an explicit tenant filter (75,014 instead of 5,751).',
  },
  {
    name: 'NULL-permissive directions predicate',
    marker: /or s\.direction_ar is null or/i,
    why: 'Reintroduces the 2026-07-27 defect: direction-unknown rows pass an explicit direction filter (67,439 instead of 14,869).',
  },
  {
    name: 'NULL-permissive street-width predicate',
    marker: /or s\.street_width_m is null\s+or/i,
    why: 'Reintroduces the 2026-07-27 defect: width-unknown rows pass an explicit street-width filter (89,819 instead of 20,112).',
  },
  {
    name: 'NULL-permissive floor predicate',
    marker: /or s\.floor_number is null\s+or/i,
    why: 'Reintroduces the 2026-07-27 defect: floor-unknown rows pass an explicit floor filter (108,880 instead of 3,661).',
  },
  {
    name: 'bedrooms CASE-exclusive form (reverts the deliberate exact ∪ min union)',
    marker: /case\s+when coalesce\(cardinality\(p_beds_exact\), ?0\) > 0 then s\.bedrooms = any\(p_beds_exact\)\s+when p_beds_min is not null then s\.bedrooms >= p_beds_min/i,
    why: 'The app sends p_beds_exact=[1,2,3,4] + p_beds_min=5 together for a 1–4 ∪ 5+ multi-select; the exclusive CASE form silently drops every 5+ listing from that selection (certified union semantics 2026-08-15).',
  },
  {
    name: 'per-platform total_count computed post-cap (over the diversification-capped rowset)',
    marker: /count\(\*\) over\(\) as total_count, t\.effective_price/i,
    why: '2026-07-28 audit: reintroduces the count bug — total_count reflects the p_per_platform-capped set (e.g. 54) instead of the true pre-cap match count (e.g. 35,535).',
  },
  {
    name: 'p_limit unclamped (bare "limit p_limit", no greatest() guard)',
    marker: /limit p_limit offset greatest\(p_offset,\s*0\)/i,
    why: '2026-07-28 audit: reintroduces the crash — a negative p_limit raises a hard Postgres error instead of degrading gracefully like p_limit:=0 already does.',
  },
];

// Supabase applies migrations in version order (the leading numeric prefix). Replicate that ordering so
// "last" here == what a real replay would leave in the database.
function versionOf(filename: string): string {
  const m = filename.match(/^(\d+)/);
  return m ? m[1] : '';
}
function compareMigrations(a: string, b: string): number {
  const va = versionOf(a);
  const vb = versionOf(b);
  if (va !== vb) return va < vb ? -1 : 1; // lexicographic on the digit prefix == chronological here
  return a < b ? -1 : 1;
}

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// A STATIC definer writes the full `CREATE OR REPLACE FUNCTION ... AS $function$ ... $function$` body
// literally in the migration file — the file's raw text IS the new effective body.
const staticDefineRe = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(public\\.)?${RPC}\\s*\\(`, 'i');
// A DYNAMIC (needle-edit) definer — the pattern this repo's hazard rule recommends, and the ONLY way to
// safely patch one clause of a huge full-body-replace RPC without risking a stale-copy revert — pulls
// pg_get_functiondef() at apply time, string-replaces one or more needles, then `execute`s the result.
// It never writes the full body literally, so it can't be detected (or verified) by literal marker
// matching; it must be REPLAYED (needle → replacement, in the order the file applies them) against the
// body accumulated from prior migrations. See 20260728140000_type_label_compound_and_annual_rent_strictness.sql
// for the first instance of this pattern on this RPC, and this file's own history: a checker that treats
// only static definers as "effective" silently reports PASS against a body that dynamic migrations have
// since moved past — false confidence is worse than no check.
const dynamicDefineRe = /proname\s*=\s*'location_search_candidates_ar'[\s\S]*?execute\s+v_new\s*;/i;

// Extract `name text := '...(sql-escaped '' string)...'` declarations from a dynamic migration, so
// `replace(v_src, needle_x, replacement_x)` calls that reference them by name can be resolved.
function extractDeclaredVars(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  const re = /(\w+)\s+text\s*:=\s*'((?:[^']|'')*)'/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) vars.set(m[1], m[2].replace(/''/g, "'"));
  return vars;
}

// Find every `v_new := replace( <src>, <needle>, <replacement> )` call in file order, where <src> is the
// identifier `v_src` or `v_new`, and <needle>/<replacement> are each either a bare identifier (resolved
// via declaredVars) or an inline SQL string literal. A hand-rolled scan (not a single regex) because the
// needle/replacement text itself can contain commas and parens, which breaks naive comma-splitting.
function extractReplaceCalls(text: string): { src: string; needleArg: string; replacementArg: string }[] {
  const calls: { src: string; needleArg: string; replacementArg: string }[] = [];
  const callRe = /v_new\s*:=\s*replace\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(text))) {
    let i = callRe.lastIndex; // just past the opening '('
    let depth = 1;
    let inString = false;
    const start = i;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (inString) {
        if (c === "'") {
          if (text[i + 1] === "'") { i++; continue; } // escaped '' inside a string
          inString = false;
        }
      } else if (c === "'") inString = true;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    const inner = text.slice(start, i - 1); // text between the outer parens, exclusive
    // Split into top-level args (commas outside strings/nested parens).
    const args: string[] = [];
    let depth2 = 0, inString2 = false, argStart = 0;
    for (let j = 0; j < inner.length; j++) {
      const c = inner[j];
      if (inString2) {
        if (c === "'") { if (inner[j + 1] === "'") { j++; continue; } inString2 = false; }
      } else if (c === "'") inString2 = true;
      else if (c === '(') depth2++;
      else if (c === ')') depth2--;
      else if (c === ',' && depth2 === 0) { args.push(inner.slice(argStart, j)); argStart = j + 1; }
    }
    args.push(inner.slice(argStart));
    if (args.length === 3) {
      calls.push({ src: args[0].trim(), needleArg: args[1].trim(), replacementArg: args[2].trim() });
    }
  }
  return calls;
}

// Resolve a replace() argument: an inline 'literal' (SQL-unescaped) or a bare identifier looked up in vars.
function resolveArg(arg: string, vars: Map<string, string>): string | undefined {
  if (arg.startsWith("'")) return arg.slice(1, -1).replace(/''/g, "'");
  return vars.get(arg);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort(compareMigrations);

const definers = files.filter((f) => {
  const text = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
  return staticDefineRe.test(text) || dynamicDefineRe.test(text);
});

check(`at least one migration defines ${RPC} (found ${definers.length})`, definers.length > 0);
if (!definers.length) {
  console.error(`\n✗ No migration defines ${RPC}. Tripwire cannot verify invariants.`);
  process.exit(1);
}

// Replay EVERY definer in order — static definers replace the body wholesale; dynamic definers apply
// their needle→replacement chain on top of whatever body prior migrations left behind. This is what
// makes "effective" actually mean "what a real migration replay produces," not just "the last file that
// happens to contain a literal CREATE OR REPLACE".
let body = '';
let replayOk = true;
for (const f of definers) {
  const text = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
  if (staticDefineRe.test(text)) {
    body = text;
    continue;
  }
  // Dynamic definer: replay its needle→replacement chain against the accumulated body.
  const vars = extractDeclaredVars(text);
  const calls = extractReplaceCalls(text);
  if (!calls.length) {
    check(`${f}: dynamic definer has a parseable replace() chain`, false);
    console.error(`   ↳ Matched the dynamic-definer pattern but no v_new := replace(...) calls could be parsed. Cannot replay — treating as UNVERIFIED.`);
    replayOk = false;
    continue;
  }
  for (const call of calls) {
    const needle = resolveArg(call.needleArg, vars);
    const replacement = resolveArg(call.replacementArg, vars);
    if (needle === undefined || replacement === undefined) {
      check(`${f}: replace() call args resolve (needle/replacement)`, false);
      console.error(`   ↳ Could not resolve "${call.needleArg}" / "${call.replacementArg}" to a literal or declared var.`);
      replayOk = false;
      continue;
    }
    const found = body.includes(needle);
    check(`${f}: needle found in accumulated body (${needle.slice(0, 50).replace(/\s+/g, ' ')}...)`, found);
    if (!found) {
      console.error(`   ↳ This dynamic migration's needle isn't present in the body replayed from prior migrations — either the replay is wrong, or this migration's own fail-closed guard would abort at apply time too. Either way, the effective body from this point on is UNVERIFIED.`);
      replayOk = false;
      continue;
    }
    body = body.replaceAll(needle, replacement); // Postgres replace() is global, not first-occurrence-only
  }
}

const effective = definers[definers.length - 1];
console.log(`\n→ effective ${RPC} definition after replay: ${effective}`);
console.log(`  (${definers.length} migration(s) define/patch it: ${definers.join(', ')})`);
if (!replayOk) {
  console.error(`\n✗ Dynamic-migration replay failed partway — invariant results below may be checked against a WRONG body. Fix the replay (or the migration) before trusting this run.\n`);
} else {
  console.log('');
}

for (const inv of REQUIRED) {
  const ok = inv.marker.test(body);
  check(`effective RPC keeps: ${inv.name}`, ok);
  if (!ok) console.error(`   ↳ WHY IT MATTERS: ${inv.why}\n   ↳ ${effective} re-issues ${RPC} but DROPS this clause. Do not copy an older body — start from the CURRENT live definition (pg_get_functiondef) and change only what you intend.`);
}
for (const bad of FORBIDDEN) {
  const present = bad.marker.test(body);
  check(`effective RPC does NOT reintroduce: ${bad.name}`, !present);
  if (present) console.error(`   ↳ WHY IT MATTERS: ${bad.why}`);
}

console.log(
  failed === 0
    ? '\n✓ RPC clause invariants hold — no migration drops a required clause'
    : `\n✗ ${failed} RPC clause invariant(s) VIOLATED — a migration re-issued ${RPC} with a stale body`,
);
process.exit(failed === 0 ? 0 : 1);
