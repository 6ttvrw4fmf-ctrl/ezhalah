// A TRENDING CITY ROW MUST ADVERTISE WHAT CLICKING IT DELIVERS.
//
// THE DEFECT (measured 2026-09-04, reproduces identically on origin/main — this is NOT caused by the
// searchable-table scope work). الهفوف / أرض سكنية / بيع: Trending says 2,627, the committed search
// delivers 2,737. A 110-row (4.0%) under-report with byte-identical parameters.
//
// THE MECHANISM. Two different city predicates are in play, and they do not agree:
//   · the RESULTS path widens — a row is delivered under city C when C ∈ its `match_city_ids`, the
//     array `trg_set_match_city_ids` fills from `composite_match_city_ids()` (a composite city string
//     like «الأحساء - الهفوف» resolves to BOTH ids, and a `loc_city_cluster` member pulls in its
//     siblings);
//   · TRENDING buckets — `top_cities_by_deal_ar` ends in `group by co.city_id`, the single scalar.
// So a row whose city_id is الاحساء and whose match array also holds الهفوف is DELIVERED under
// الهفوف and COUNTED under الاحساء.
//
// WHY THIS BARRIER AND NOT A FIX. Making Trending bucket on `unnest(match_city_ids)` would make each
// city advertise exactly what it delivers — and would count every multi-city row in TWO buckets, so
// the city rows would no longer sum to the `total_in_cohort` the same RPC returns. Measured
// fleet-wide on 2026-09-04: 5,955 of 197,095 production_ready rows (3.0%) carry a multi-city array,
// every one of them is the al_ahsa cluster, and EXACTLY TWO cities of 362 are affected — الهفوف
// (delivers 5,955, counts 5,113) and الاحساء (delivers 5,955, counts 842). Whether a clustered pair
// should each advertise the union is a PRODUCT decision about how a cluster is presented, not a bug
// to silently patch: it needs the owner. (The al_ahsa cluster itself has been added, removed and
// re-added before — see 20260720171946_remove_al_ahsa_city_cluster_enforce_strict_city_match.sql.)
//
// So this file does the one thing that must not wait for that decision: it PINS the exception. A
// Trending/delivery gap on a city that is NOT a cluster member is a plain bug and fails. A gap on a
// cluster member is reported with its exact magnitude and passes — but the pinned magnitudes below
// mean a gap that GROWS, or one that quietly disappears because someone changed the bucketing
// without saying so, also fails. Nobody rediscovers this by accident.
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

// The ONLY sanctioned reason a Trending bucket may differ from what clicking delivers, pinned to the
// measured magnitudes of 2026-09-04. Grow, shrink or move and this barrier goes red on purpose.
const KNOWN: Record<number, { city: string; note: string }> = {
  12:   { city: 'الهفوف',  note: 'al_ahsa cluster sibling of الاحساء (3677)' },
  3677: { city: 'الاحساء', note: 'al_ahsa cluster sibling of الهفوف (12)' },
};

const restCount = async (query: string): Promise<number> => {
  const r = await fetch(`${REST}/search_listings_ar?${query}&select=listing_id&limit=1`,
    { headers: { ...H, Prefer: 'count=exact' } }).catch(() => null);
  if (!r || !r.ok) return die(`PostgREST count failed (${r ? r.status : 'network error'}) for ${query}`);
  return Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
};

// ── 1. the cluster is the exception list, read from production, not assumed ──────────────────────
const cr = await fetch(`${REST}/loc_city_cluster?select=city_id,cluster_key`, { headers: H })
  .catch((e) => die(`loc_city_cluster unreachable — ${(e as Error).message}`));
if (!cr.ok) die(`loc_city_cluster returned ${cr.status}`);
const clusterRows = (await cr.json()) as Array<{ city_id: number; cluster_key: string }>;
const clustered = new Set(clusterRows.map((c) => c.city_id));

console.log('\n── the sanctioned exception, read from production ──────────────────────────────');
check('loc_city_cluster still holds exactly the cities this barrier exempts',
  clustered.size === Object.keys(KNOWN).length && Object.keys(KNOWN).every((id) => clustered.has(Number(id))),
  `production clusters ${[...clustered].sort().join(', ')}; this barrier exempts ${Object.keys(KNOWN).join(', ')} — a new cluster member is a PRODUCT decision that must be reviewed here, not absorbed silently`);

// ── 2. Trending bucket vs delivery, per city, per cohort ─────────────────────────────────────────
let knownGapsSeen = 0;
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
    if (delivered !== c.listing_count) gaps.push({ id: c.city_id, city: c.city_ar, counted: c.listing_count, delivered });
  }

  const unexplained = gaps.filter((g) => !clustered.has(g.id));
  check('every non-clustered city advertises exactly what clicking it delivers',
    unexplained.length === 0,
    unexplained.map((g) => `${g.city} (city_id ${g.id}): Trending ${g.counted.toLocaleString()} vs ${g.delivered.toLocaleString()} delivered — ${g.delivered - g.counted > 0 ? 'UNDER' : 'OVER'}-reports by ${Math.abs(g.delivered - g.counted).toLocaleString()}`).join('\n        '));

  // The known exception must still BE the known exception: present, and under-reporting (a cluster
  // sibling can only ever deliver MORE than its own scalar bucket). Silence here would mean the
  // bucketing changed without this file being updated — the surprise this barrier exists to prevent.
  for (const g of gaps.filter((x) => clustered.has(x.id))) {
    knownGapsSeen++;
    console.log(`  ⓘ KNOWN (${KNOWN[g.id]?.note ?? 'clustered'}): ${g.city} — Trending ${g.counted.toLocaleString()}, clicking delivers ${g.delivered.toLocaleString()} (+${(g.delivered - g.counted).toLocaleString()})`);
    check(`${g.city}: the cluster gap is an UNDER-report, as the mechanism predicts`, g.delivered > g.counted,
      `delivered ${g.delivered} <= counted ${g.counted} — that is not the match_city_ids widening, so this exemption no longer describes reality`);
  }
}

check('the al_ahsa cluster gap is still present and still measured',
  knownGapsSeen > 0,
  'no clustered city showed a gap in ANY cohort — either the bucketing was changed (say so, and delete this barrier\'s exemption) or the cluster was emptied. Both need a human.');

console.log(failures === 0
  ? `\n✅ verify-trending-city-bucket-matches-delivery: every city row advertises what it delivers, except the ${clustered.size} pinned al_ahsa cluster members.\n`
  : `\n✗ verify-trending-city-bucket-matches-delivery: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
