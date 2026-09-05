// A TRENDING CITY ROW MUST ADVERTISE WHAT CLICKING IT DELIVERS, AND A CLUSTER SHOWS ONE ROW.
//
// THE CONTRACT this asserts, both recorded verbatim in src/data/locations.ts:
//   · "Owner rule 2026-08-22: Trending IS the location breakdown of the user's eligible set."
//   · "owner rule 2026-08-22: the city count shown must equal what clicking that city returns,
//      under the full current AF state."
// Plus the owner's presentation rule (2026-09-04, item 1 of the Trending city-bucket decision):
// "Do not allow two Top-city positions to represent the same underlying eligible search cluster.
// The displayed count must still equal the exact eligible set the user gets when clicking that
// row. Search behavior and the existing location cluster semantics must not be weakened or
// changed just for presentation."
//
// THE DEFECT THIS WAS BORN FROM (measured 2026-09-04). الهفوف / أرض سكنية / بيع: Trending said
// 2,627, the committed search delivered 2,737; الاحساء said 110 and delivered the same 2,737. A
// first revision of this file fixed the COUNT (both cities correctly report 2,737) but left TWO
// Top-6 rows describing the same cluster. This revision asserts the COLLAPSE too: a cluster with
// an anchor configured in loc_city_cluster_anchor must show EXACTLY ONE row (the anchor's
// city_id) — no sibling member may appear as its own row — and that row's count must still equal
// what clicking it delivers. (An earlier revision of this file PINNED the two-row gap as a
// sanctioned exception. That exemption is gone: a barrier that asserts a bug goes green on the
// bug and red on the fix.)
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

const restCount = async (query: string): Promise<number> => {
  const r = await fetch(`${REST}/search_listings_ar?${query}&select=listing_id&limit=1`,
    { headers: { ...H, Prefer: 'count=exact' } }).catch(() => null);
  if (!r || !r.ok) return die(`PostgREST count failed (${r ? r.status : 'network error'}) for ${query}`);
  return Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
};

// ── 1. cluster membership + the anchor config, read from production, not assumed ─────────────────
const cr = await fetch(`${REST}/loc_city_cluster?select=city_id,cluster_key`, { headers: H })
  .catch((e) => die(`loc_city_cluster unreachable — ${(e as Error).message}`));
if (!cr.ok) die(`loc_city_cluster returned ${cr.status}`);
const clusterRows = (await cr.json()) as Array<{ city_id: number; cluster_key: string }>;

const ar = await fetch(`${REST}/loc_city_cluster_anchor?select=cluster_key,anchor_city_id`, { headers: H })
  .catch((e) => die(`loc_city_cluster_anchor unreachable — ${(e as Error).message}`));
if (!ar.ok) die(`loc_city_cluster_anchor returned ${ar.status} — has the collapse migration landed?`);
const anchorRows = (await ar.json()) as Array<{ cluster_key: string; anchor_city_id: number }>;

const membersByCluster = new Map<string, number[]>();
for (const c of clusterRows) membersByCluster.set(c.cluster_key, [...(membersByCluster.get(c.cluster_key) ?? []), c.city_id]);
const anchorByCluster = new Map(anchorRows.map((a) => [a.cluster_key, a.anchor_city_id]));

console.log('\n── loc_city_cluster + loc_city_cluster_anchor, read from production ───────────────');
// THE PARAMETERIZED KNOB ITSELF MUST BE SANE: an anchor can only be a real member of its own
// cluster. A typo or a stale row here would make a cluster collapse onto a city that isn't even
// in it, silently dropping the OTHER real members' inventory from Trending.
for (const [key, anchorId] of anchorByCluster) {
  check(`anchor for cluster '${key}' (${anchorId}) is an actual member of that cluster`,
    (membersByCluster.get(key) ?? []).includes(anchorId),
    `loc_city_cluster has ${JSON.stringify(membersByCluster.get(key) ?? [])} for '${key}'`);
}
console.log(anchorByCluster.size === 0
  ? '  (no anchor configured yet — clusters do not collapse; each member still shows its own row)'
  : `  ${anchorByCluster.size} cluster(s) configured to collapse: ${[...anchorByCluster.entries()].map(([k, v]) => `${k}→${v}`).join(', ')}`);

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
  const shown = new Set(cities.map((c) => c.city_id));

  // (a) COLLAPSE: a cluster with an anchor shows that ONE city_id and no sibling of it.
  for (const [key, anchorId] of anchorByCluster) {
    const siblings = (membersByCluster.get(key) ?? []).filter((id) => id !== anchorId);
    check(`cluster '${key}' shows only its anchor (${anchorId}), not ${siblings.join('/')}`,
      siblings.every((id) => !shown.has(id)),
      `Trending rows: ${[...shown].join(', ')}`);
  }

  // (b) DELIVERY: every row Trending DOES show — anchor or plain city — must equal what clicking
  // it delivers. `match_city_ids @> {city}` already returns the whole cluster's union for ANY
  // member id (composite_match_city_ids writes the full cluster into every member's array), so
  // this one predicate is correct whether the row is a collapsed anchor or an uncollapsed city.
  const gaps: Array<{ id: number; city: string; counted: number; delivered: number }> = [];
  for (const c of cities) {
    const delivered = await restCount(`production_ready=is.true&${rest}&match_city_ids=cs.{${c.city_id}}`);
    citiesSwept++;
    if (delivered !== c.listing_count) gaps.push({ id: c.city_id, city: c.city_ar, counted: c.listing_count, delivered });
  }
  check('every city advertises exactly what clicking it delivers',
    gaps.length === 0,
    gaps.map((g) => `${g.city} (city_id ${g.id}): Trending ${g.counted.toLocaleString()} vs ${g.delivered.toLocaleString()} delivered — ${g.delivered - g.counted > 0 ? 'UNDER' : 'OVER'}-reports by ${Math.abs(g.delivered - g.counted).toLocaleString()}`).join('\n        '));

  // (c) SEARCH BEHAVIOUR MUST NOT CHANGE: clicking EITHER real city_id in a cluster — anchor or
  // not — still delivers the same union via the unchanged match_city_ids semantics. This is what
  // makes the collapse a display change only.
  for (const ids of membersByCluster.values()) {
    if (ids.length < 2) continue;
    const delivereds = await Promise.all(ids.map((id) =>
      restCount(`production_ready=is.true&${rest}&match_city_ids=cs.{${id}}`)));
    citiesSwept += ids.length;
    check(`clicking any of {${ids.join(',')}} delivers the same union (search semantics unchanged)`,
      delivereds.every((d) => d === delivereds[0]),
      `per-city delivered counts: ${ids.map((id, i) => `${id}=${delivereds[i]}`).join(', ')}`);
  }
}

// A sweep that measured nothing must not pass as a sweep that found nothing.
check(`the sweep actually measured cities (${citiesSwept})`, citiesSwept >= 100,
  'far fewer city×cohort comparisons than production has cities — the sweep is not covering what its name claims');

console.log(failures === 0
  ? `\n✅ verify-trending-city-bucket-matches-delivery: all ${citiesSwept} city×cohort rows advertise exactly what they deliver, and every anchored cluster shows exactly one row.\n`
  : `\n✗ verify-trending-city-bucket-matches-delivery: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
