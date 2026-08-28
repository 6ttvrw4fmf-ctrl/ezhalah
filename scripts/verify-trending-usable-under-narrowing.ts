// TRENDING CITIES MUST STAY USABLE WHEN THE USER IS NARROWED — live, over the ANON path.
//
// WHAT BROKE (2026-08-27, found by the AF+Trending routine, fixed in migration 20260827113819).
// `top_cities_by_deal_ar` took 20,205 ms and died with 57014 (statement timeout) for
// Buy · فيلا/تاون هاوس/بيت · beds>=4 · price<=3,000,000 — one of the most ordinary states a buyer
// reaches. Either predicate ALONE returned in ~0.5 s; only the two together fell off the cliff.
// Root cause: the `total` CTE (`select count(*) from cohort`) is referenced once, so PG12+ inlines
// it and may re-run the aggregate per output row. As postgres the cohort CTE estimated 25 rows and
// the aggregate ran once (179 ms); as anon (RLS on) it estimated 1 row and ran 16,708 times
// (39,221 ms). `total AS MATERIALIZED` fixed it: 406 ms.
//
// WHY THE USER SEES NOTHING, NOT A WRONG NUMBER. src/data/locations.ts gates every widening
// fallback on "is the user narrowed?" — correctly, because a widened count under an active filter
// is a false count. So a failed call under narrowing sets the city pool to 'error' and Trending
// Cities renders NOTHING: the user cannot pick a city from Trending at all.
//
// WHY THIS SCRIPT EXISTS AS WELL AS THE DETECTOR. mon_detect_search_performance_regression (also
// extended in that migration) probes from inside the database, once per daily slot. This runs on
// the same schedule as the other live count checks, from outside, through the same anon REST path
// a browser uses — and it asserts TRUTH as well as speed, so the class can never be "fixed" by
// making a wrong answer arrive quickly.
//
// THE CLASS, not the example: any count surface whose plan degrades only under the user's role.
// Every barrier we own runs privileged; that is precisely why this one must not.
//
// NOT wired into `npm test` (that suite is hermetic, no network/DB). Runs in
// .github/workflows/count-rpc-parity-live-check.yml every 6h:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
//     node --experimental-strip-types scripts/verify-trending-usable-under-narrowing.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL_BASE, key: KEY } = resolvePublicSupabase(process.env);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// The client aborts at 15 s (locations.ts) and the database cancels at 20 s. A healthy call is
// ~0.4 s, so 5 s is 12x the healthy baseline and still far below either cliff: slow enough to
// tolerate a loaded database, fast enough that the defect above could never hide under it.
const BUDGET_MS = 5000;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const VILLA = ['فيلا', 'تاون هاوس', 'بيت'];
const APT = ['شقة', 'مبنى شقق مخدومة', 'ملحق علوي'];
const OFFICE = ['مكتب'];

type State = { label: string; args: Record<string, unknown> };

// Every state carries a location-free scope plus REAL narrowing, because Trending Cities is what
// the user sees BEFORE picking a city — that is the only moment this surface exists.
const STATES: State[] = [
  { label: 'Buy · villas · beds>=4 · price<=3M (the 2026-08-27 timeout)',
    args: { p_deal: 'بيع', p_category: 'Residential', p_types: VILLA, p_beds_min: 4, p_price_max: 3000000 } },
  { label: 'Rent-Annual · apartments · beds>=2 · price<=60k',
    args: { p_deal: 'إيجار', p_rent_period: 'سنوي', p_category: 'Residential', p_types: APT, p_beds_min: 2, p_price_max: 60000 } },
  { label: 'Buy · villas · beds>=3 · area 300-900 · price<=5M (three predicates)',
    args: { p_deal: 'بيع', p_category: 'Residential', p_types: VILLA, p_beds_min: 3, p_area_min: 300, p_area_max: 900, p_price_max: 5000000 } },
  { label: 'Rent-Annual · apartments · beds>=2 · price<=80k · AF bathrooms>=2',
    args: { p_deal: 'إيجار', p_rent_period: 'سنوي', p_category: 'Residential', p_types: APT, p_beds_min: 2, p_price_max: 80000, p_bath_min: 2 } },
  { label: 'Commercial · offices · Rent-Annual · price<=200k · area 50-400',
    args: { p_deal: 'إيجار', p_rent_period: 'سنوي', p_category: 'Commercial', p_types: OFFICE, p_price_max: 200000, p_area_min: 50, p_area_max: 400 } },
];

// THE PROBE MUST BE ABLE TO BITE. The defect needed a bedroom/area predicate AND a budget together;
// a future edit that softened these states into single-predicate calls would leave a green check
// over a dead surface. Assert the shape of the corpus itself, not just its results.
const isSize = (k: string) => k === 'p_beds_min' || k === 'p_beds_exact' || k === 'p_area_min' || k === 'p_area_max';
const isBudget = (k: string) => k.startsWith('p_price_');
const twoAxis = STATES.filter((s) => Object.keys(s.args).some(isSize) && Object.keys(s.args).some(isBudget));
check(`the corpus keeps at least 4 size+budget states (the shape that broke) — has ${twoAxis.length}`,
  twoAxis.length >= 4, STATES.map((s) => s.label).join(' | '));

async function rpc(name: string, body: Record<string, unknown>) {
  const t0 = Date.now();
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  return { ms: Date.now() - t0, ok: r.ok && Array.isArray(j), body: j as unknown };
}

type CityRow = { city_ar: string; listing_count: number };

for (const st of STATES) {
  const res = await rpc('top_cities_by_deal_ar', st.args);
  const rows = (Array.isArray(res.body) ? res.body : []) as CityRow[];
  const err = res.ok ? '' : `HTTP/RPC error: ${JSON.stringify(res.body).slice(0, 200)}`;

  check(`${st.label} — Trending Cities answers at all`, res.ok, `${err} (${res.ms} ms)`);
  check(`${st.label} — answers within ${BUDGET_MS} ms (was 20,205 ms → 57014 before the fix)`,
    res.ok && res.ms <= BUDGET_MS, `took ${res.ms} ms`);
  // A narrowed state over inventory this broad always has cities. Zero rows here means the surface
  // is empty for the user, whatever the reason — which is the outcome this barrier exists to stop.
  check(`${st.label} — returns a city breakdown (rows > 0)`, rows.length > 0, `${rows.length} rows`);
  if (!res.ok || rows.length === 0) continue;

  // TRUTH, not just speed: the advertised count must be what picking that city actually returns.
  for (const row of rows.slice(0, 3)) {
    const click = await rpc('location_search_candidates_ar',
      { ...st.args, p_cities: [row.city_ar], p_per_platform: null, p_limit: 1, p_offset: 0 });
    const landed = Array.isArray(click.body) && click.body.length
      ? Number((click.body[0] as { total_count: number }).total_count) : click.ok ? 0 : null;
    check(`${st.label} — «${row.city_ar}» advertised ${row.listing_count} == click-through ${landed}`,
      landed !== null && Number(row.listing_count) === landed,
      `advertised=${row.listing_count} landed=${landed}`);
  }
}

console.log(failures === 0
  ? '\n✓ Trending Cities stays fast AND exact under every narrowed state a real user reaches\n'
  : `\n✗ ${failures} check(s) FAILED — Trending Cities is degraded for narrowed users\n`);
process.exit(failures === 0 ? 0 : 1);
