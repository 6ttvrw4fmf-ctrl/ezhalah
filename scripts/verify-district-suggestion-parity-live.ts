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

async function searchCount(cityAr: string, deal: string, matchValues: string[]): Promise<number> {
  const rows = await post('location_search_candidates_ar', {
    p_deal: deal, p_cities: [cityAr], p_districts: matchValues, p_per_platform: 100000000, p_limit: 1,
  });
  return rows.length ? Number(rows[0].total_count) : 0;
}

let failed = 0, checked = 0;
const deadEnds: string[] = [];

// 1) Gather every populated district suggestion across all scopes (district_options_ar is one call
//    per city×deal — cheap).
type Task = { cityAr: string; deal: string; district: string; count: number; mv: string[] };
const tasks: Task[] = [];
for (const cityAr of CITIES) {
  const cid = await cityId(cityAr);
  if (cid == null) { console.log(`SKIP  ${cityAr} — city_id not found`); continue; }
  for (const deal of [BUY, RENT]) {
    // Category null = the default (deal-only) ranking the app shows before Category is picked.
    let opts: DistrictOpt[];
    try {
      opts = (await post('district_options_ar', { p_city_id: cid, p_deal: deal })) as DistrictOpt[];
    } catch (e) { console.log(`FAIL  district_options_ar(${cityAr}, ${deal}) — ${(e as Error).message}`); failed++; continue; }
    for (const o of opts.filter((x) => Number(x.listing_count) > 0).slice(0, MAX_DISTRICTS_PER_SCOPE)) {
      tasks.push({ cityAr, deal, district: o.district_ar, count: Number(o.listing_count),
        mv: Array.isArray(o.match_values) && o.match_values.length ? o.match_values : [o.district_ar] });
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
      const n = await searchCount(task.cityAr, task.deal, task.mv);
      checked++;
      if (n === 0) { failed++; deadEnds.push(`${task.cityAr} › ${task.district} (${task.deal}): suggested with listing_count=${task.count} but search returned 0`); }
    } catch (e) { failed++; console.log(`FAIL  search(${task.cityAr}/${task.district}/${task.deal}) — ${(e as Error).message}`); }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

console.log(`\nchecked ${checked} populated district suggestions across ${CITIES.length} cities × 2 deals.`);
if (deadEnds.length) {
  console.log(`\n✗ ${deadEnds.length} DEAD-END suggestion(s) — a district shown as populated returned 0 from search:`);
  for (const d of deadEnds) console.log(`   • ${d}`);
} else {
  console.log('\n✓ no dead-end district suggestions — every populated district returns results.');
}
process.exit(failed === 0 ? 0 : 1);
