#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
// A CITY MUST NEVER OWN A DISTRICT CATALOG WHILE ITS OWN LISTINGS LIVE UNDER A DIFFERENT ID.
//
// Found 2026-09-23 investigating "how many catalog districts have a listing" (owner, just curious).
// Of 30 cities whose district catalog showed zero listings, most were genuinely tiny hamlets — but
// الدرعية (629 real listings) and بيشة (149) were NOT empty. Each exists TWICE in loc_catalog_city:
// the exact same city_ar and city_norm under two different city_ids. All real listings resolved to
// ONE twin; the district catalog (17 / 28 neighbourhoods) was built under the OTHER, which never
// received a single listing. The picker was reading the empty folder while the full one sat unlabeled
// next to it. Confirmed via src/data/sa-locations.json (§ROOT CAUSE below): the duplication is not
// ours — the official third-party hierarchy we import verbatim lists each of these places twice,
// under two different official codes, in the same region. الحريق and الحرجة carry the identical
// shape (migration 20260923234716 and its sibling fix the first pair and, where confirmed, these).
//
// ROOT CAUSE, same shape as feedback_our-district-list-never-shows-a-number: sa-locations.json is
// "the official Saudi hierarchy … the source of truth for what places exist" (docs/LOCATION_SYSTEM.md
// §6), imported verbatim, and it is where the duplicate pair originates. A future re-import of that
// file is how this comes back — which is exactly why this barrier runs against LIVE PRODUCTION DATA
// on every test run, not just the file: the file only proves the pair EXISTS, never whether one twin
// has quietly become the orphan a new import creates.
//
// WHAT THIS FILE DOES NOT DO: it does not decide whether two same-named cities are the same real
// place. That judgement call was made once, by hand, cross-referencing region_id, the district's own
// listing text, and the official hierarchy file (see PR #3813 and its follow-up) — never automated,
// because a same-named-but-genuinely-different-place pair (القوز has FOUR unrelated twins, all with
// zero listings — a common place name, not one place split in two) must never be silently merged.
// This barrier only refuses to let a CONFIRMED orphan reappear; the mutation proof below is what
// keeps its own detection logic from either missing a real one or flagging a benign coincidence.
import { createClient } from '@supabase/supabase-js';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught, 'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// ── THE PURE DETECTOR (mirrors mon_detect_city_duplicate_orphaned_districts' own SQL logic) ───────
// Inputs are plain data so this can be proven correct against synthetic cases with no network call.
type CityRow = { city_id: number; city_norm: string };
export function findOrphanedTwins(
  cities: CityRow[],
  citiesWithDistricts: Set<number>,
  listingsByCity: Map<number, number>,
): Array<{ dead_city_id: number; live_city_id: number; live_listings: number }> {
  const byNorm = new Map<string, number[]>();
  for (const c of cities) {
    const arr = byNorm.get(c.city_norm) ?? [];
    arr.push(c.city_id);
    byNorm.set(c.city_norm, arr);
  }
  const out: Array<{ dead_city_id: number; live_city_id: number; live_listings: number }> = [];
  for (const ids of byNorm.values()) {
    if (ids.length < 2) continue;
    for (const dead of ids) {
      if (!citiesWithDistricts.has(dead)) continue;             // only a city that OWNS a district catalog
      if ((listingsByCity.get(dead) ?? 0) > 0) continue;         // only when IT has zero listings
      for (const twin of ids) {
        if (twin === dead) continue;
        const twinListings = listingsByCity.get(twin) ?? 0;
        if (twinListings > 0) { out.push({ dead_city_id: dead, live_city_id: twin, live_listings: twinListings }); break; }
      }
    }
  }
  return out;
}

// ── 1. EXECUTED: the pure detector against synthetic cases ─────────────────────────────────────
{
  // The exact بيشة shape: two city_ids, same norm, one has districts+0 listings, the other has
  // listings+no districts.
  const bisha = findOrphanedTwins(
    [{ city_id: 1514, city_norm: 'بيشه' }, { city_id: 1301, city_norm: 'بيشه' }],
    new Set([1514]), new Map([[1301, 149]]),
  );
  check('catches the exact بيشة shape (districts+0 listings, twin has listings)',
    bisha.length === 1 && bisha[0].dead_city_id === 1514 && bisha[0].live_city_id === 1301 && bisha[0].live_listings === 149,
    JSON.stringify(bisha));

  // The exact القوز shape: FOUR twins, all zero listings, one owns districts. Must NOT be flagged —
  // this is the false-positive guard: a common place name shared by unrelated towns is not one
  // place accidentally split in two, and there is no live twin to redirect the catalog to.
  const qouz = findOrphanedTwins(
    [{ city_id: 1628, city_norm: 'القوز' }, { city_id: 1677, city_norm: 'القوز' },
     { city_id: 1108, city_norm: 'القوز' }, { city_id: 1500, city_norm: 'القوز' }],
    new Set([1628]), new Map(),
  );
  check('does NOT flag four same-named twins that are ALL empty (القوز — no live twin to point to)',
    qouz.length === 0, JSON.stringify(qouz));

  // A normal city with no twin at all — never flagged, regardless of listing count.
  const normal = findOrphanedTwins(
    [{ city_id: 1, city_norm: 'الرياض' }], new Set([1]), new Map([[1, 40000]]),
  );
  check('does NOT flag an ordinary city with no same-named twin', normal.length === 0);

  // A city with districts and its OWN listings — never flagged even if a twin also has listings
  // (both are legitimately alive; nothing here is orphaned).
  const bothAlive = findOrphanedTwins(
    [{ city_id: 10, city_norm: 'x' }, { city_id: 11, city_norm: 'x' }],
    new Set([10]), new Map([[10, 5], [11, 5]]),
  );
  check('does NOT flag a city that has its own listings, even with a same-named twin', bothAlive.length === 0);

  mustCatch('the districts-ownership guard being dropped (would flag every empty-listing city, not just ones that own a picker catalog)',
    findOrphanedTwins(
      [{ city_id: 1514, city_norm: 'بيشه' }, { city_id: 1301, city_norm: 'بيشه' }],
      new Set(), new Map([[1301, 149]]),
    ).length === 0);
  mustCatch('the twin-has-listings guard being dropped (would flag القوز)',
    findOrphanedTwins(
      [{ city_id: 1628, city_norm: 'القوز' }, { city_id: 1677, city_norm: 'القوز' }],
      new Set([1628]), new Map(),
    ).length === 0);
}

// ── 2. EXECUTED: the real, live catalog — via the SAME RPCs the app itself calls ──────────────────
// top_cities_by_deal_ar(): the exact oracle for "does this city_id have a listing" — independent of
// whether any district catalog exists for it, so it never misses a live twin that has NO districts.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY!;
if (!url || !key) {
  console.log('  (skipped — EXPO_PUBLIC_SUPABASE_URL/KEY not set in this environment)');
  process.exit(0);
}
const sb = createClient(url, key);

async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || !data.length) break;
    out.push(...(data as T[]));
    if (data.length < page) break;
  }
  return out;
}

const [cities, districtRows, topCities] = await Promise.all([
  fetchAll<{ city_id: number; city_norm: string }>('loc_catalog_city', 'city_id,city_norm'),
  fetchAll<{ city_id: number }>('loc_catalog_district', 'city_id'),
  sb.rpc('top_cities_by_deal_ar', {}).then((r) => {
    if (r.error) throw new Error(`top_cities_by_deal_ar: ${r.error.message}`);
    return (r.data ?? []) as Array<{ city_id: number; listing_count: number }>;
  }),
]);

check('fetched a real, non-trivial catalog (a zero-row fetch would pass this file vacuously)',
  cities.length > 3000 && districtRows.length > 3000, `cities=${cities.length} districts=${districtRows.length}`);

const citiesWithDistricts = new Set(districtRows.map((d) => d.city_id));
const listingsByCity = new Map(topCities.map((c) => [c.city_id, c.listing_count]));
const orphans = findOrphanedTwins(cities, citiesWithDistricts, listingsByCity);

check('NO city owns a district catalog while zero and a same-named twin holds real listings',
  orphans.length === 0,
  orphans.length ? orphans.map((o) => `city_id ${o.dead_city_id} is orphaned — its twin ${o.live_city_id} holds ${o.live_listings} listings`).join('; ') : '');

// ── 3. Regression pin: the CONFIRMED pairs from PR #3813 stay fixed ────────────────────────────────
// Not "no orphan exists" in general — this names the exact two dead ids and asserts they now own
// ZERO catalog districts, so a future migration cannot silently re-point the catalog back at them.
for (const [name, deadId] of [['الدرعية', 828], ['بيشة', 1514]] as const) {
  check(`${name}'s dead twin (city_id ${deadId}) owns zero catalog districts`,
    !citiesWithDistricts.has(deadId), `city_id ${deadId} still owns districts — the 2026-09-23 fix regressed`);
}

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — a duplicate city id is hiding real listings behind an empty district picker\n`
  : '\n✓ no orphaned duplicate city; the confirmed 2026-09-23 fixes hold\n');
process.exit(failed ? 1 : 0);
