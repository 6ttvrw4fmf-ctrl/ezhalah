// A TRENDING CITY ROW MUST ADVERTISE WHAT CLICKING IT DELIVERS. No exceptions.
//
// THE CONTRACT this asserts, both recorded verbatim in src/data/locations.ts:
//   · "Owner rule 2026-08-22: Trending IS the location breakdown of the user's eligible set."
//   · "owner rule 2026-08-22: the city count shown must equal what clicking that city returns,
//      under the full current AF state."
//
// THE DEFECT IT WAS BORN FROM (measured 2026-09-04). الهفوف / أرض سكنية / بيع: Trending said 2,627,
// the committed search delivered 2,737; الاحساء said 110 and delivered the same 2,737. Two different
// city predicates were in play:
//   · the RESULTS path widens — a row is delivered under city C when C ∈ its `match_city_ids`, the
//     array `trg_set_match_city_ids` fills from `composite_match_city_ids()` (a composite city string
//     like «الأحساء - الهفوف» resolves to BOTH ids, and a `loc_city_cluster` member pulls in its
//     siblings — owner-approved 2026-08-31, 20260831195108);
//   · TRENDING bucketed on the single scalar `group by co.city_id`.
// 20260904181500_trending_city_bucket_matches_delivery.sql moved the bucket onto the same array the
// results path filters on, so the two surfaces describe one set. THIS FILE IS THE PROOF THAT THEY
// STILL DO — it asserts the invariant, never the old gap. (An earlier revision of this file PINNED
// the gap as a sanctioned exception. That exemption is gone: a barrier that asserts a bug goes green
// on the bug and red on the fix.)
//
// It reads production through the ANON/publishable key — the same path a real visitor takes — and
// compares the REAL top_cities_by_deal_ar output against an INDEPENDENT PostgREST count on
// search_listings_ar. Never our RPC's SQL on both sides.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-trending-city-bucket-matches-delivery.ts
//
// LIVE CHECK — excluded from `npm test` (scripts/test-exclusions.txt); runs in
// .github/workflows/af-live-truth-check.yml with the other production-truth barriers.
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: BASE, key: KEY } = resolvePublicSupabase(process.env);
const REST = `${BASE}/rest/v1`;
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}` };

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? `\n        ${detail}` : ''}`);
  if (!cond) failures++;
};
/** A barrier that cannot measure must never report success. */
const die = (why: string): never => {
  console.log(`\n✗ SKIP-FAIL: ${why}`);
  process.exit(1);
};

// ── the cohorts under test ───────────────────────────────────────────────────────────────────────
// Deliberately only predicates this file can mirror EXACTLY in PostgREST (production_ready + deal +
// type). A cohort whose predicate the oracle has to guess at would make a disagreement ambiguous,
// and an ambiguous barrier is one nobody believes.
const COHORTS: Array<{ label: string; body: Record<string, unknown>; rest: string }> = [
  { label: 'أرض سكنية · بيع (the scope that exposed this)',
    body: { p_deal: 'بيع', p_types: ['أرض سكنية'] },
    rest: 'deal_ar=eq.%D8%A8%D9%8A%D8%B9&type_ar=eq.%D8%A3%D8%B1%D8%B6%20%D8%B3%D9%83%D9%86%D9%8A%D8%A9' },
  { label: 'شقة · إيجار (no period token, so the oracle mirrors the cohort exactly)',
    body: { p_deal: 'إيجار', p_types: ['شقة'] },
    rest: 'deal_ar=eq.%D8%A5%D9%8A%D8%AC%D8%A7%D8%B1&type_ar=eq.%D8%B4%D9%82%D8%A9' },
];

// loc_city_cluster's membership on the day the fix shipped. A cluster member's row now advertises
// the UNION its siblings deliver, so ADDING a member adds another city row carrying another city's
// inventory under a second name — visible in the Top-6, and a product decision, not a data tweak.
// The invariant below stays true either way, which is exactly why this has to be pinned separately.
const CLUSTERED_ON_2026_09_04 = [12, 3677];

const restCount = async (query: string): Promise<number> => {
  const r = await fetch(`${REST}/search_listings_ar?${query}&select=listing_id&limit=1`,
    { headers: { ...H, Prefer: 'count=exact' } }).catch(() => null);
  if (!r || !r.ok) return die(`PostgREST count failed (${r ? r.status : 'network error'}) for ${query}`);
  return Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
};

// ── 1. the cluster membership, read from production, not assumed ─────────────────────────────────
const cr = await fetch(`${REST}/loc_city_cluster?select=city_id,cluster_key`, { headers: H })
  .catch((e) => die(`loc_city_cluster unreachable — ${(e as Error).message}`));
if (!cr.ok) die(`loc_city_cluster returned ${cr.status}`);
const clusterRows = (await cr.json()) as Array<{ city_id: number; cluster_key: string }>;
const clustered = [...new Set(clusterRows.map((c) => c.city_id))].sort((a, b) => a - b);

console.log('\n── loc_city_cluster, read from production ──────────────────────────────────────');
check('cluster membership is unchanged since the bucket fix shipped',
  clustered.length === CLUSTERED_ON_2026_09_04.length
    && clustered.every((id, i) => id === CLUSTERED_ON_2026_09_04[i]),
  `production clusters ${clustered.join(', ')}; pinned ${CLUSTERED_ON_2026_09_04.join(', ')} — every member's Trending row advertises the whole cluster's inventory, so a change here changes what the Top-6 shows and needs a human`);

// ── 2. Trending bucket vs delivery, per city, per cohort — ONE invariant, no exemptions ──────────
let citiesSwept = 0;
for (const { label, body, rest } of COHORTS) {
  console.log(`\n── ${label} ──────────────────────────────────────────────────`);
  const r = await fetch(`${REST}/rpc/top_cities_by_deal_ar`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch((e) => die(`top_cities_by_deal_ar unreachable — ${(e as Error).message}`));
  if (!r.ok) die(`top_cities_by_deal_ar returned ${r.status} — ${(await r.text()).slice(0, 200)}`);
  const cities = (await r.json()) as Array<{ city_id: number; city_ar: string; listing_count: number }>;
  check(`Trending returned a plausible city list (${cities.length})`, cities.length >= 5,
    'too few cities for the sweep below to mean anything');

  const gaps: Array<{ id: number; city: string; counted: number; delivered: number }> = [];
  for (const c of cities) {
    // INDEPENDENT delivery truth: the results path's own predicate, `match_city_ids @> {city}`.
    const delivered = await restCount(`production_ready=is.true&${rest}&match_city_ids=cs.{${c.city_id}}`);
    citiesSwept++;
    if (delivered !== c.listing_count) gaps.push({ id: c.city_id, city: c.city_ar, counted: c.listing_count, delivered });
  }

  check('every city advertises exactly what clicking it delivers',
    gaps.length === 0,
    gaps.map((g) => `${g.city} (city_id ${g.id})${clustered.includes(g.id) ? ' [cluster member]' : ''}: Trending ${g.counted.toLocaleString()} vs ${g.delivered.toLocaleString()} delivered — ${g.delivered - g.counted > 0 ? 'UNDER' : 'OVER'}-reports by ${Math.abs(g.delivered - g.counted).toLocaleString()}`).join('\n        '));
}

// A sweep that measured nothing must not pass as a sweep that found nothing.
check(`the sweep actually measured cities (${citiesSwept})`, citiesSwept >= 100,
  'far fewer city×cohort comparisons than production has cities — the sweep is not covering what its name claims');

console.log(failures === 0
  ? `\n✅ verify-trending-city-bucket-matches-delivery: all ${citiesSwept} city×cohort rows advertise exactly what they deliver.\n`
  : `\n✗ verify-trending-city-bucket-matches-delivery: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
