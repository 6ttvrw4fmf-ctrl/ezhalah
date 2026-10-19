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
import { postgrestFetch } from './lib/postgrestRetry.ts';
import { startDeadline, incompleteVerdict, certified } from './lib/checkDeadline.ts';
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
  const res = await postgrestFetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${fn} ${res.status}: ${await res.text()}`);
  return (await res.json()) as any[];
}

async function cityId(cityAr: string): Promise<number | null> {
  const res = await postgrestFetch(`${URL_BASE}/rest/v1/loc_catalog_city?select=city_id,city_ar&city_ar=eq.${encodeURIComponent(cityAr)}&limit=1`, { headers: HEADERS });
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

// THE DEADLINE (routine-4, 2026-09-27). This check's work grows with inventory: 1,772
// (city × scope × district) suggestions today, up from a run that fitted comfortably a week ago. On
// 2026-09-24 it crossed its 10-minute job cap and 9 of the next 12 runs were KILLED at 618-620s —
// reported by GitHub as `cancelled`, which the failure->alert bridge classifies as NO_VERDICT and
// deliberately does not raise on. So this barrier went dark for ~2.5 days while nothing anywhere
// said so. It now stops taking new work at its own deadline, strictly inside the job cap, and
// reports the shortfall as NOT EXERCISED with a non-zero exit — a loud alert instead of silence.
// See scripts/lib/checkDeadline.ts for the full measurement and the inequality a barrier pins.
const deadline = startDeadline();

let checked = 0;          // suggestions this run actually got an answer for
let unanswered = 0;       // attempted, but the RPC never answered (transport/other error)
let unattempted = 0;      // never attempted: the deadline expired first
let planningFailed = 0;   // a district_options_ar call that never answered
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
  // Monthly toggle. district_options_ar took a boolean p_payment_monthly through 2026-08-18; the
  // owner's سنوي+شهري multi-select (2026-08-19, PR#777) replaced it with the same p_rent_period
  // token ('شهري'/'سنوي'/'كلاهما') the search RPC already takes — src/data/locations.ts's
  // ensureDistrictOptions sends p_rent_period, never p_payment_monthly, so this probe now matches
  // what the app actually calls. Live 2026-08-19: the stale p_payment_monthly arg 404'd every
  // 'monthly' scope call (PGRST202 — no matching overload), so this scope silently checked 0
  // suggestions instead of failing loud; p_rent_period restores real coverage. district_options_ar
  // still excludes RNPL under 'شهري' (the FROZEN PERIOD=SOURCE / RNPL→ANNUAL rule) — if a
  // district's only monthly rows are RNPL this flags a dead end, which is the guard working; the
  // remedy is data/coverage, NEVER the frozen RNPL rule.
  { label: 'monthly',         deals: [RENT],      dopt: { p_rent_period: 'شهري' }, search: { p_rent_period: 'شهري' } },
  // Category picked (non-frozen — a category-scope dead-end IS a real fixable bug).
  { label: 'cat:Residential', deals: [BUY, RENT], dopt: { p_category: 'Residential' }, search: { p_category: 'Residential' } },
  { label: 'cat:Commercial',  deals: [BUY, RENT], dopt: { p_category: 'Commercial' },  search: { p_category: 'Commercial' } },
];
const tasks: Task[] = [];
let planningCut = false;   // the deadline expired while still enumerating suggestions
for (const cityAr of CITIES) {
  if (deadline.expired()) { planningCut = true; break; }
  const cid = await cityId(cityAr);
  if (cid == null) { console.log(`SKIP  ${cityAr} — city_id not found`); continue; }
  for (const scope of SCOPES) {
    for (const deal of scope.deals) {
      if (deadline.expired()) { planningCut = true; break; }
      let opts: DistrictOpt[];
      try {
        opts = (await post('district_options_ar', { p_city_id: cid, p_deal: deal, ...scope.dopt })) as DistrictOpt[];
      } catch (e) { console.log(`FAIL  district_options_ar(${cityAr}, ${deal}, ${scope.label}) — ${(e as Error).message}`); planningFailed++; continue; }
      for (const o of opts.filter((x) => Number(x.listing_count) > 0).slice(0, MAX_DISTRICTS_PER_SCOPE)) {
        tasks.push({ cityAr, deal, scope: scope.label, district: o.district_ar, count: Number(o.listing_count),
          mv: Array.isArray(o.match_values) && o.match_values.length ? o.match_values : [o.district_ar],
          searchExtra: scope.search });
      }
    }
  }
}
if (planningCut) console.log('\nNOT EXERCISED  enumeration cut short — the deadline expired while still reading district_options_ar; some cities/scopes were never planned.');
const planned = tasks.length;

// 2) Verify each suggestion returns >0 from the real search. A worker takes NO new task once the
//    deadline has passed: the tasks left over are reported, never silently dropped.
//
//    TWO WORKERS, NOT TEN (P0, 2026-10-04 21:52-22:12 UTC). Every search here is a full-scope
//    location_search_candidates_ar — the SAME query a user's «بحث» waits on, on the same instance.
//    At 10 workers this check alone held ~9.5 of them in flight for its whole run (edge logs:
//    06:16 1,414 calls / 11,351 DB-s in 20 min; 12:48 1,678 / 8,105 in 14 min; 21:52 1,001 /
//    10,964 in 20 min, mean 11 s, 137 × 5xx). Users' searches queued behind it: a real
//    جدة/شراء/سكني search showed «يجري تحميل الإعلانات» after ~45 s with 0 cards, and browser p90
//    rose to 17-20 s. Ten workers never made the check faster either — each call slowed ~8x
//    because they fought each other. Two keeps it inside the shared envelope ops_search_load_now
//    publishes (safe_qps 1.5); the deadline in the workflow is sized for the longer wall-clock.
const CONCURRENCY = 2;
let cursor = 0;
async function worker() {
  while (cursor < tasks.length) {
    if (deadline.expired()) { unattempted += tasks.length - cursor; cursor = tasks.length; break; }
    const task = tasks[cursor++];
    try {
      const n = await searchCount(task.cityAr, task.deal, task.mv, task.searchExtra);
      checked++;
      if (n === 0) { deadEnds.push(`${task.cityAr} › ${task.district} (${task.deal}/${task.scope}): suggested with listing_count=${task.count} but search returned 0`); }
    } catch (e) { unanswered++; console.log(`FAIL  search(${task.cityAr}/${task.district}/${task.deal}/${task.scope}) — ${(e as Error).message}`); }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

// 3) THE VERDICT. A clean run is one where every planned suggestion was ANSWERED and none was a dead
//    end. Anything unanswered or unattempted makes the run uncertified — it must never render as the
//    clean tick, because "no dead ends found" over cells nobody measured is a false clean claim.
//    Measured on 2026-09-26 run 187, which is why this is spelled out: that run printed
//    «✓ no dead-end district suggestions — every populated district returns results» while 10 of its
//    searches had come back 503 and been counted as failures. The exit code was right and the
//    sentence was wrong, and the sentence is what a human reads.
const unexercised = unanswered + unattempted + planningFailed;
const clean = certified({ defects: deadEnds.length, unanswered, unattempted, planningFailed, planningCut });

console.log(`\nchecked ${checked} of ${planned} planned populated district suggestions across ${CITIES.length} cities × ${SCOPES.length} scopes (deal-only, monthly, category).`);
if (unanswered) console.log(`NOT EXERCISED  ${unanswered} search(es) never answered — see the FAIL lines above. A failed fetch is not an honest zero, so these are neither dead ends nor passes.`);
if (planningFailed) console.log(`NOT EXERCISED  ${planningFailed} district_options_ar call(s) never answered, so their suggestions were never enumerated.`);
if (unattempted) console.log(incompleteVerdict(checked, planned, deadline.budgetSeconds));

if (deadEnds.length) {
  console.log(`\n✗ ${deadEnds.length} DEAD-END suggestion(s) — a district shown as populated returned 0 from search:`);
  for (const d of deadEnds) console.log(`   • ${d}`);
}
if (clean) {
  console.log('\n✓ no dead-end district suggestions — every populated district returns results.');
} else if (!deadEnds.length) {
  console.log(`\n✗ NOT CERTIFIED — no dead end was found, but ${unexercised} suggestion(s) were never measured, so this run does not certify the invariant.`);
}
process.exit(clean ? 0 : 1);
