// LIVE dead-end guard for the District field's suggestions (2026-08-09).
//
// THE BUG THIS PREVENTS FOREVER: the District dropdown suggested districts that returned ZERO
// listings when searched — e.g. picking حي المطار / الرس (which has villas + a house for sale but no
// apartments) or one of the 24-of-44 zero-listing catalog districts. A suggested district that a
// search can't fulfil is a dead end, and dead ends make users leave.
//
// THE INVARIANT: every district that district_options_ar reports with listing_count > 0 (i.e. every
// district the app can rank into its Top-6 / show as "has listings") MUST return > 0 from the real
// search RPC (location_search_candidates_ar) for the same city + deal. If it doesn't, the suggestion
// lied. Checked through the SAME anon key real clients use, against the REAL production data (a
// privileged connection could mask RLS/permission differences — memory: verify-via-anon-key rule).
//
// NOT wired into `npm test` (CI has no network/DB). Run after any change to district_options_ar,
// the district-matching in location_search_candidates_ar, or the sync — and from the daily audit:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
//     node --experimental-strip-types scripts/verify-district-suggestion-parity-live.ts

// Env wins when set; otherwise the committed PUBLIC endpoint. Before 2026-08-10 this required env
// and the workflow's repo secret did not exist, so this barrier exited 1 without ever running.
import { resolvePublicSupabase } from './lib/public-supabase.ts';
const { url: URL_BASE, key: KEY } = resolvePublicSupabase();
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const BUY = 'بيع';
const RENT = 'إيجار';
// Representative cities across regions + sizes. Small cities (الرس) are where zero-listing catalog
// districts are proportionally worst, so they matter most.
const CITIES = ['الرس', 'الرياض', 'جدة', 'الدمام', 'مكة المكرمة', 'بريدة', 'أبها'];
const MAX_DISTRICTS_PER_SCOPE = 40; // bound runtime; each city rarely has more populated districts

type DistrictOpt = { district_ar: string; listing_count: number; match_values: string[] };

async function post(fn: string, body: Record<string, unknown>): Promise<any[]> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${fn} ${res.status}: ${await res.text()}`);
  return (await res.json()) as any[];
}

async function cityId(cityAr: string): Promise<number | null> {
  const res = await fetch(`${URL_BASE}/rest/v1/loc_catalog_city?select=city_id,city_ar&city_ar=eq.${encodeURIComponent(cityAr)}&limit=1`, { headers: HEADERS });
  if (!res.ok) return null;
  const rows = (await res.json()) as { city_id: number }[];
  return rows.length ? rows[0].city_id : null;
}

async function searchCount(cityAr: string, deal: string, matchValues: string[], extra: Record<string, unknown> = {}): Promise<number> {
  const rows = await post('location_search_candidates_ar', {
    p_deal: deal, p_cities: [cityAr], p_districts: matchValues, p_per_platform: 100000000, p_limit: 1, ...extra,
  });
  return rows.length ? Number(rows[0].total_count) : 0;
}

let failed = 0, checked = 0;
const deadEnds: string[] = [];

// 1) Gather every populated district suggestion across EVERY scope the District field can be in.
//    Each scope maps district_options_ar's args (what the dropdown suggests) to the
//    location_search_candidates_ar args the app actually searches with — if the two disagree, a
//    populated suggestion is a dead end. (district_options_ar is one cheap call per city×deal×scope.)
type Task = { cityAr: string; deal: string; district: string; count: number; mv: string[]; scope: string; searchExtra: Record<string, unknown> };
type Scope = { label: string; deals: string[]; dopt: Record<string, unknown>; search: Record<string, unknown> };
const SCOPES: Scope[] = [
  // Deal-only, before Category / Monthly is chosen — the original coverage.
  { label: 'default',         deals: [BUY, RENT], dopt: {},                          search: {} },
  // Monthly toggle. district_options_ar counts payment_monthly rows (incl. RNPL); the search asks
  // rent_period='شهري' which EXCLUDES RNPL (the FROZEN PERIOD=SOURCE / RNPL→ANNUAL rule). If a
  // district's only monthly rows are RNPL this flags a dead end — that is the guard working; the
  // remedy is data/coverage, NEVER the frozen RNPL rule. Live 2026-08-10: 0 monthly dead-ends.
  { label: 'monthly',         deals: [RENT],      dopt: { p_payment_monthly: true }, search: { p_rent_period: 'شهري' } },
  // Category picked (non-frozen — a category-scope dead-end IS a real fixable bug).
  { label: 'cat:Residential', deals: [BUY, RENT], dopt: { p_category: 'Residential' }, search: { p_category: 'Residential' } },
  { label: 'cat:Commercial',  deals: [BUY, RENT], dopt: { p_category: 'Commercial' },  search: { p_category: 'Commercial' } },
];
const tasks: Task[] = [];
for (const cityAr of CITIES) {
  const cid = await cityId(cityAr);
  if (cid == null) { console.log(`SKIP  ${cityAr} — city_id not found`); continue; }
  for (const scope of SCOPES) {
    for (const deal of scope.deals) {
      let opts: DistrictOpt[];
      try {
        opts = (await post('district_options_ar', { p_city_id: cid, p_deal: deal, ...scope.dopt })) as DistrictOpt[];
      } catch (e) { console.log(`FAIL  district_options_ar(${cityAr}, ${deal}, ${scope.label}) — ${(e as Error).message}`); failed++; continue; }
      for (const o of opts.filter((x) => Number(x.listing_count) > 0).slice(0, MAX_DISTRICTS_PER_SCOPE)) {
        tasks.push({ cityAr, deal, scope: scope.label, district: o.district_ar, count: Number(o.listing_count),
          mv: Array.isArray(o.match_values) && o.match_values.length ? o.match_values : [o.district_ar],
          searchExtra: scope.search });
      }
    }
  }
}

// 2) Verify each suggestion returns >0 from the real search — bounded-concurrency parallel so the
//    whole barrier finishes in seconds, not minutes (CI-viable).
const CONCURRENCY = 10;
let cursor = 0;
async function worker() {
  while (cursor < tasks.length) {
    const task = tasks[cursor++];
    try {
      const n = await searchCount(task.cityAr, task.deal, task.mv, task.searchExtra);
      checked++;
      if (n === 0) { failed++; deadEnds.push(`${task.cityAr} › ${task.district} (${task.deal}/${task.scope}): suggested with listing_count=${task.count} but search returned 0`); }
    } catch (e) { failed++; console.log(`FAIL  search(${task.cityAr}/${task.district}/${task.deal}/${task.scope}) — ${(e as Error).message}`); }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

console.log(`\nchecked ${checked} populated district suggestions across ${CITIES.length} cities × ${SCOPES.length} scopes (deal-only, monthly, category).`);
if (deadEnds.length) {
  console.log(`\n✗ ${deadEnds.length} DEAD-END suggestion(s) — a district shown as populated returned 0 from search:`);
  for (const d of deadEnds) console.log(`   • ${d}`);
} else {
  console.log('\n✓ no dead-end district suggestions — every populated district returns results.');
}
process.exit(failed === 0 ? 0 : 1);
