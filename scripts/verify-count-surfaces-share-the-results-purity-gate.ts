// A COUNT SURFACE MUST RESOLVE ITS SCOPE THE WAY THE SEARCH DOES — including the purity gate.
//
// THE DEFECT (🔴 Regression Hunter, routine #8, first run 2026-09-04; ops_incident #31).
// Five production RPCs take the same (p_tables, p_tables2, p_types2) scope trio and are supposed to
// describe the same eligible set. Four of them — location_search_candidates_ar, district_options_ar,
// apartment_guided_counts_ar, property_age_option_counts_ar — gate category purity as
//
//     (k.macro = p_category OR (k.macro = 'both' AND <table-kind case>))
//
// so the table-kind restriction binds ONLY the dual-macro types, which is what lets the
// misfile-recovery scope B (a Residential type sitting in a *_commercial_listings table, and its
// mirror) survive. top_cities_by_deal_ar — the Trending city chip — gates as
//
//     (k.macro = p_category OR k.macro = 'both') AND <table-kind case>
//
// so the restriction binds EVERY type and every misfiled row is dropped from the count while the
// search still returns it. ONE call site of five was left behind when the misfile fix landed.
//
// MEASURED LIVE on the anon path, 2026-09-04. One question — «فئة تجاري / بيع / الرياض» — asked of
// three functions with the IDENTICAL scope object: top_cities_by_deal_ar said 266,
// district_options_ar said 3,358, location_search_candidates_ar said 3,358. Across the top six
// cities of broad Commercial Buy the chip was short by 72.9%–96.3%, and because the Top-6 ranking is
// BY that number the chips are also ordered wrongly. Narrowed searches hit it too: فيلا/بيع الهفوف
// 621 vs 764 (-18.7%).
//
// WHAT THIS ASSERTS, and why it is over the CLASS rather than the pair:
//   1. DISCOVERY — the count surfaces are enumerated AT RUN TIME out of src/data/**, by finding every
//      .rpc('name') call site that is handed the table-scope trio. A hardcoded list is the staleness
//      trap that produced the defect in the first place: a sixth count surface added next month is
//      outside any list written today. A discovered surface this file does not know how to reconcile
//      FAILS the run — silence about a new surface is the failure mode, not a clean pass.
//   2. RECONCILIATION — for each shape the app actually builds, the count a surface advertises for a
//      city must equal the results RPC's own total_count for that same city under the same scope.
//      Behavioural, not textual: it executes the real production functions through the real anon path,
//      so it cannot be satisfied by a predicate that merely LOOKS right.
//
// IT FAILS CLOSED. Every path that cannot MEASURE exits non-zero — a network barrier that reports
// success when it could not reach the network manufactures confidence.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/verify-count-surfaces-share-the-results-purity-gate.ts
//
// LIVE CHECK — excluded from `npm test` (scripts/test-exclusions.txt); belongs with the other
// production-truth barriers in .github/workflows/af-live-truth-check.yml.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';
import { liftSearchScope } from './lib/liftSearchScope.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const ROOT = join(import.meta.dirname, '..');
const { url: BASE, key: KEY } = resolvePublicSupabase(process.env);
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? `\n        ${detail}` : ''}`);
  if (!cond) failures++;
};
const die = (why: string): never => {
  console.log(`\n✗ SKIP-FAIL: ${why}`);
  process.exit(1);
};

async function rpc(fn: string, params: Record<string, unknown>): Promise<any[]> {
  let r: Response;
  try {
    r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(params) });
  } catch (e) {
    return die(`could not reach ${fn}: ${(e as Error).message}`);
  }
  if (!r.ok) return die(`${fn} answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as any[];
}

// ── 1. DISCOVERY — which surfaces claim the results scope? Read it out of the client, at run time. ──
//
// A count surface is any RPC the client hands the table-scope trio to. In src/data the trio arrives
// spread from searchTableScope()/rpcAllNarrowingParams() rather than typed out, so the marker is the
// call site being given a scope object at all — `...scope`, `...af`, `...SCOPE_KEYS` and friends —
// which is exactly the shape the 2026-09-03 fix introduced. Anything named here that this file has no
// reconciliation for is reported as UNRECONCILED and fails the run.
const SCOPE_NAMES = String.raw`scope|af|cityTableScope|tableScope|scopeParams|baseRpcParams`;
// Inline: `...scope`, `...(scope ?? {})`, `...rpcAllNarrowingParams(q)`, or a literal p_tables key.
const SCOPE_INLINE = new RegExp(String.raw`\.\.\.\s*\(?\s*(?:${SCOPE_NAMES})\b|\.\.\.\s*(?:searchTableScope|rpcAllNarrowingParams|rpcAdvancedFilterParams)\s*\(|p_tables\s*:`);
// Deferred: the params are a bare identifier the file filled in earlier — `Object.assign(args, scope ?? {})`
// then `supabase.rpc('top_cities_by_deal_ar', args)`. src/data/locations.ts builds BOTH of its count
// surfaces this way, so a detector that only understood the inline spread found neither of them.
const assignsScopeInto = (src: string, id: string) =>
  new RegExp(String.raw`Object\.assign\(\s*${id}\s*,\s*\(?\s*(?:${SCOPE_NAMES})\b`).test(src);

/** Every RPC name called from src/data/**, paired with whether its call site carries the scope. */
export async function discoverScopedRpcs(sources: Array<{ file: string; text: string }>): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const { file, text } of sources) {
    const src = stripComments(text);
    // The call site plus a WINDOW after it, rather than a regex that tries to find the closing paren:
    // params are a multi-line object literal and any `foo(bar)` inside them (dealAr(deal), pmKey(...))
    // ends a naive balanced-looking match early. The window stops at the next .rpc( so one call site's
    // scope can never be credited to the following one.
    for (const m of src.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'\s*(,?)/g)) {
      const [, name, comma] = m;
      const from = m.index! + m[0].length;
      const rest = src.slice(from, from + 900);
      const body = comma ? rest.split('.rpc(')[0] : '';
      const bareId = body.match(/^\s*([A-Za-z_$][\w$]*)\s*\)/)?.[1];
      if (SCOPE_INLINE.test(body) || (bareId && assignsScopeInto(src, bareId))) found.set(name, file);
    }
  }
  return found;
}

// The surfaces this barrier knows how to reconcile: RPC name → the column that carries its count,
// and how to key a row to a city. Extending this map is the price of adding a count surface, and the
// DISCOVERY check above is what makes forgetting to extend it loud instead of silent.
const RECONCILABLE: Record<string, { countCol: string; cityCol?: string; needsCityId?: boolean }> = {
  top_cities_by_deal_ar: { countCol: 'listing_count', cityCol: 'city_ar' },
  district_options_ar: { countCol: 'total_in_city', needsCityId: true },
};
// Called with the scope but NOT a per-city count surface — they answer a different question
// (per-option counts inside one already-scoped search), so a city-level reconciliation does not apply.
const NOT_A_CITY_COUNT = new Set([
  'location_search_candidates_ar', 'apartment_guided_counts_ar', 'property_age_option_counts_ar',
  'resolve_district_cities', 'loc_rel_rank',
]);

const dataDir = join(ROOT, 'src', 'data');
const files = (await readdir(dataDir)).filter((f) => f.endsWith('.ts'));
const sources = await Promise.all(files.map(async (f) => ({ file: `src/data/${f}`, text: await readFile(join(dataDir, f), 'utf8') })));
const discovered = await discoverScopedRpcs(sources);

console.log('\nCount surfaces discovered at run time (never a hardcoded list)\n');
check('the scan found the scope-carrying RPCs at all', discovered.size >= 3,
  `only ${discovered.size} found — the scan pattern has drifted from how src/data spreads its scope, so this barrier is no longer looking at anything`);
for (const [name, file] of [...discovered].sort()) console.log(`     · ${name}  (${file})`);

const unreconciled = [...discovered.keys()].filter((n) => !(n in RECONCILABLE) && !NOT_A_CITY_COUNT.has(n));
check('every discovered scope-carrying RPC is either reconciled here or explicitly not a city count',
  unreconciled.length === 0,
  `${unreconciled.join(', ')} takes the results scope but nothing reconciles it against the results RPC. ` +
  `Add it to RECONCILABLE (with the column that carries its count) or to NOT_A_CITY_COUNT with a reason.`);
check('top_cities_by_deal_ar is still one of the surfaces under test', discovered.has('top_cities_by_deal_ar'),
  'the Trending city chip no longer reads as scope-carrying — either it stopped sending the scope (the 2026-09-03 defect) or the scan missed it');

// ── 2. RECONCILIATION — the advertised number vs what the search actually delivers. ─────────────────
const S = await liftSearchScope(ROOT);
const known = (await (await fetch(`${BASE}/rest/v1/known_type_ar?select=type_ar,macro`, { headers: H })).json()) as Array<{ type_ar: string; macro: string }>;
if (!Array.isArray(known) || !known.length) die('could not read known_type_ar — the taxonomy half of the scope is unavailable');
const COM_ALL = [...new Set(known.filter((k) => k.macro === 'Commercial').map((k) => k.type_ar))];
const COM_RES = COM_ALL.filter((t) => t !== 'عمارة');

type Shape = { label: string; deal: string; cat: string; types: string[] | null; q: { deal: string }; broad: boolean };
const SHAPES: Shape[] = [
  { label: 'Residential · شقة · إيجار', deal: 'إيجار', cat: 'Residential', types: ['شقة'], q: { deal: 'Rent' }, broad: false },
  { label: 'Residential · فيلا · بيع', deal: 'بيع', cat: 'Residential', types: ['فيلا'], q: { deal: 'Buy' }, broad: false },
  { label: 'BROAD Commercial · إيجار', deal: 'إيجار', cat: 'Commercial', types: null, q: { deal: 'Rent' }, broad: true },
  { label: 'BROAD Commercial · بيع', deal: 'بيع', cat: 'Commercial', types: null, q: { deal: 'Buy' }, broad: true },
];

/** THE INVARIANT, as a pure predicate — so the mutation proofs below can feed it a broken pair. */
export const countDescribesTheSearch = (advertised: number, delivered: number): boolean => advertised === delivered;

console.log('\nEvery count surface reconciles against the results RPC, under the identical scope\n');
for (const sh of SHAPES) {
  const RES = S.resTables(sh.q), COM = S.comTables(sh.q);
  // searchTableScope(): broad Commercial reads the residential tables as scope A and the commercial
  // tables as scope B; a narrowed Residential search recovers its own type out of the commercial tables.
  const scope = sh.broad
    ? { p_tables: RES, p_tables2: COM, p_types2: COM_ALL }
    : { p_tables: RES, p_tables2: COM.filter((t) => !RES.includes(t)), p_types2: sh.types! };
  const cohort = { p_deal: sh.deal, p_category: sh.cat, ...(sh.types ? { p_types: sh.types } : {}) };

  const chips = await rpc('top_cities_by_deal_ar', { ...cohort, ...scope });
  if (!chips.length) { check(`${sh.label} — the chip surface returned rows`, false, 'no cities came back; nothing to reconcile'); continue; }

  for (const chip of chips.slice(0, 3)) {
    // The results call the chip's own scope commits to. isBroadCommercial overrides p_types on scope A.
    const rows = await rpc('location_search_candidates_ar', {
      ...cohort, ...(sh.broad ? { p_types: COM_RES } : {}), ...scope,
      p_cities: [chip.city_ar], p_per_platform: null, p_limit: 1, p_offset: 0,
    });
    const advertised = Number(chip.listing_count), delivered = Number(rows[0]?.total_count ?? 0);
    check(`${sh.label} · ${chip.city_ar}: chip ${advertised} == search ${delivered}`,
      countDescribesTheSearch(advertised, delivered),
      `the Trending chip advertises ${advertised} where the search under the SAME scope delivers ${delivered} ` +
      `(${delivered ? ((100 * Math.abs(advertised - delivered)) / delivered).toFixed(1) : '∞'}% off). ` +
      `The chips are also ORDERED by this number, so the Top-6 ranking is wrong by the same amount.`);

    // The district panel answers the same question for the same city through a different function —
    // an independent third reading, which is what proved top_cities to be the outlier and not the truth.
    if (chip.city_id != null) {
      // Same args ensureDistrictOptions() sends: the cohort (INCLUDING p_types, which it forwards
      // whenever a type is selected) plus the table scope. Dropping p_types here would widen the
      // panel's cohort and manufacture a disagreement this barrier would then blame on production.
      const dist = await rpc('district_options_ar', {
        p_city_id: chip.city_id, p_deal: sh.deal, p_category: sh.cat,
        ...(sh.types ? { p_types: sh.types } : {}), ...scope,
      });
      const panel = Number(dist[0]?.total_in_city ?? 0);
      if (dist.length) {
        check(`${sh.label} · ${chip.city_ar}: district panel ${panel} == search ${delivered}`,
          countDescribesTheSearch(panel, delivered),
          `district_options_ar's total_in_city disagrees with the results RPC under the same scope`);
      }
    }
  }
}

// ── 3. MUTATION PROOF — feed each predicate the real broken input and watch it be caught. ───────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

console.log('\nMutation proofs\n');

// M1 — the reconciliation predicate, fed the exact production numbers measured on 2026-09-04.
mustCatch('the live defect: Trending 266 while the same-scope search delivers 3,358',
  !countDescribesTheSearch(266, 3358));
mustCatch('a 2-row misfile-recovery gap (شقة/إيجار/مكة المكرمة, 601 vs 603)',
  !countDescribesTheSearch(601, 603));
mustCatch('a predicate that only tolerates agreement — an equal pair must NOT be reported as a defect',
  countDescribesTheSearch(3358, 3358));

// M2 — the DISCOVERY half: a sixth count surface appears, wired with the scope and reconciled by
// nobody. The barrier must name it rather than pass quietly, which is the staleness trap PART 6
// forbids and the reason this list is built at run time instead of typed out.
const mutantSource = [{
  file: 'src/data/__mutant__.ts',
  text: `const r = await supabase.rpc('top_regions_by_deal_ar', {\n  p_deal: dealAr(deal),\n  ...scope,\n});`,
}];
const mutantFound = await discoverScopedRpcs(mutantSource);
mustCatch('a NEW scope-carrying count surface that nothing reconciles',
  mutantFound.has('top_regions_by_deal_ar')
  && !('top_regions_by_deal_ar' in RECONCILABLE)
  && !NOT_A_CITY_COUNT.has('top_regions_by_deal_ar'));

// M3 — the DISCOVERY half in the other direction: a count surface that STOPPED sending the scope is
// the 2026-09-03 defect itself, and must not read as discovered.
const unscoped = await discoverScopedRpcs([{ file: 'src/data/__mutant2__.ts', text: `await supabase.rpc('top_cities_by_deal_ar', { p_deal: dealAr(deal) });` }]);
mustCatch('a count surface that stopped carrying the table scope entirely (the 2026-09-03 defect)',
  !unscoped.has('top_cities_by_deal_ar'));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
console.log(failures === 0
  ? '\n✓ every count surface resolves its scope — and its purity gate — the way the search does\n'
  : `\n✗ ${failures} check(s) failed — a count surface is describing a set the search does not return\n`);
process.exit(failures === 0 ? 0 : 1);
