// A DOWN SITE'S LISTINGS NEVER REACH A USER — NOT EVEN ITS UNLOCATED ONES ON A NO-LOCATION SEARCH.
//
// Owner rule 2026-09-26: a site that is down on its side goes platform_registry 'dormant' and its
// listings leave search. The v2 gate sets production_ready = false, which hides its LOCATED rows.
// But every search RPC also admits NON-ready rows that have no city/region when the search itself
// has no location (location_search_candidates_ar, the AF counts, district_options_ar,
// top_cities_by_deal_ar all carry the same carve-out). Measured 2026-10-09: 1 nafithh row (domain
// NXDOMAIN since 2026-10-06) was still servable that way.
//
// Fixed in ONE place every RPC reads: sync_search_listings_ar() deletes a dormant platform's
// unlocated rows from search_listings_ar and does not re-insert them while it stays dormant
// (migration 20261009191544, a live-body rewrite like 20260920071128).
//
// This guard is hermetic. It lifts the two predicates the migration writes into the sync, turns
// them into JS, and runs them through the RPC's own admission rule for every case: dormant/active
// × located/unlocated × production_ready × search with/without a location. Mutations prove each
// half is load-bearing.
//
//   node --experimental-strip-types scripts/verify-down-site-unlocated-rows-leave-index.ts
//   (auto-discovered by npm test — scripts/lib/testRegistry.ts)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const MIG = '20261009191544_search_index_drops_down_sites_unlocated_rows.sql';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

const committed = readdirSync(join(root, 'supabase/migrations')).includes(MIG);
check('the fix migration is committed (no production-only drift)', committed, `${MIG} missing`);
const sql = committed ? readFileSync(join(root, 'supabase/migrations', MIG), 'utf8') : '';

// The two predicates exactly as the migration writes them into the sync body.
const DELETE_RE = /delete from search_listings_ar s\s+where (s\.platform = any\(v_dormant\) and \(s\.region_id is null or s\.city_id is null\));/;
const INSERT_RE = /and not (\(v\.platform = any\(v_dormant\) and \(v\.region_id is null or v\.city_id is null\)\))\n/;
const del = sql.match(DELETE_RE)?.[1];
const ins = sql.match(INSERT_RE)?.[1];
check('the sync removes a dormant platform\'s unlocated rows from the index', !!del);
check('the sync does not re-insert them while the platform stays dormant', !!ins);
check('the dormant set is read from platform_registry (source, dormant)',
  /v_dormant := array\(select platform from public\.platform_registry where kind = ''source'' and status = ''dormant''\);/.test(sql));
// Outside the doomed-keys circuit breaker: the delete is written right after the writer-lock line,
// i.e. before the breaker's count — a big site going down must not freeze everyone's deletes.
const lockAt = sql.indexOf("'  if not public.search_index_writer_lock() then return; end if;\n  -- A down site");
check('the delete runs right after the writer lock, outside the circuit breaker', lockAt > 0 && sql.indexOf('delete from search_listings_ar s', lockAt) > lockAt);

type Row = { platform: string; region_id: number | null; city_id: number | null; production_ready: boolean };
// SQL → JS for exactly the operators these predicates use.
const toJs = (p: string, alias: string) => new Function('r', 'v_dormant', 'return ' + p
  .replaceAll(`${alias}.`, 'r.')
  .replace(/(r\.\w+) = any\(v_dormant\)/g, 'v_dormant.includes($1)')
  .replace(/(r\.\w+) is null/g, '($1 == null)')
  .replace(/\band\b/g, '&&').replace(/\bor\b/g, '||')) as (r: Row, d: string[]) => boolean;

// The RPCs' admission rule (location_search_candidates_ar and its count siblings, read side).
const served = (r: Row, searchHasLocation: boolean) =>
  r.production_ready || (!searchHasLocation && (r.region_id == null || r.city_id == null));
// v2 marks every dormant row not production-ready; a row without a location is never ready.
const v2Row = (platform: string, located: boolean, dormant: boolean): Row => ({
  platform, region_id: located ? 1 : null, city_id: located ? 10 : null, production_ready: located && !dormant,
});

// One sync pass: the delete runs first, then the upsert inserts every v2 row the index lacks unless
// the insert filter skips it. So a row ends up indexed if it was NOT deleted (it was there from
// before the site went down) OR it was re-inserted.
const scenario = (delP: string | undefined, insP: string | undefined) => {
  const dormant = ['downsite'];
  const deleted = delP ? toJs(delP, 's') : () => false;
  const skipped = insP ? toJs(insP, 'v') : () => false;
  const out: { platform: string; located: boolean; search: boolean; indexed: boolean; shown: boolean }[] = [];
  for (const platform of ['downsite', 'livesite']) for (const located of [true, false]) {
    const r = v2Row(platform, located, dormant.includes(platform));
    const indexed = !deleted(r, dormant) || !skipped(r, dormant);
    for (const search of [true, false]) out.push({ platform, located, search, indexed, shown: indexed && served(r, search) });
  }
  return out;
};
const downShown = (res: ReturnType<typeof scenario>) => res.some((x) => x.platform === 'downsite' && x.shown);

if (del && ins) {
  const res = scenario(del, ins);
  check('a down site is never shown — any row, any search', !downShown(res), JSON.stringify(res));
  check('a live site\'s unlocated rows still show on a no-location search (nothing over-hidden)',
    res.some((x) => x.platform === 'livesite' && !x.located && !x.search && x.shown));
  check('a down site\'s LOCATED rows stay indexed (auto-return still counts them)',
    res.filter((x) => x.platform === 'downsite' && x.located).every((x) => x.indexed));
  check('a live site keeps every row indexed', res.filter((x) => x.platform === 'livesite').every((x) => x.indexed));
  // MUTATIONS — each half is load-bearing: break it and the down site shows again.
  mustCatch('without the delete, the row indexed before the site went down still shows', downShown(scenario(undefined, ins)));
  mustCatch('without the insert filter, the same pass puts it straight back', downShown(scenario(del, undefined)));
  mustCatch('the index before this fix shows the down site on a no-location search', downShown(scenario(undefined, undefined)));
}

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\n✓ a down site\'s listings never reach a search, located or not');
