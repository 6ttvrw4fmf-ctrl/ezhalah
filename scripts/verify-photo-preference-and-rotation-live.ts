// LIVE BEHAVIORAL regression barrier for PHOTO PREFERENCE + CONTROLLED ROTATION (owner PERMANENT
// rule, 2026-08-29: MATCH -> PLATFORM DIVERSITY -> PHOTO PREFERENCE -> CONTROLLED ROTATION).
//
// Same shape and reasoning as verify-platform-diversity-live.ts (which this complements, not
// replaces): a static guard on the RPC's ORDER-BY text can pass while behavior drifts another way
// (a new UNION arm, a changed CASE, a data shift). This calls the REAL production RPC through the
// same anon key the app uses and asserts the owner's rules on the actual returned rows:
//
//   - a rotation seed produces a STABLE order across repeat calls (deterministic, never random)
//   - a DIFFERENT seed produces a DIFFERENT order over the SAME matched set (rotation actually rotates)
//   - an explicit objective sort (price_asc) is byte-identical with or without a rotation seed
//     (explicit sort always wins - rotation never silently overrides it)
//   - a multi-page walk under one seed has ZERO duplicates and covers the exact same set an unpaged
//     fetch does (total-order pagination holds under rotation)
//   - within one platform's own returned rows, a confirmed-has_photo row never sorts after a
//     confirmed-no_photo row (photo preference is actually applied, not just present in the SQL text)
//   - total_count and the full matched id-set are IDENTICAL with and without a rotation seed
//     (rotation/photo preference never change eligibility or the honest count)
//
// NOT wired into `npm test` (no network/DB there). Runs from
// .github/workflows/photo-rotation-live-check.yml on a schedule. Manual:
//   node --experimental-strip-types scripts/verify-photo-preference-and-rotation-live.ts

import { resolvePublicSupabase } from './lib/public-supabase.ts';
const { url: URL_BASE, key: KEY } = resolvePublicSupabase();

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const BUY = 'بيع';

type Row = {
  source_table: string;
  listing_id: number;
  platform: string;
  effective_price: number | null;
  total_count: number;
};

async function rpc(args: Record<string, unknown>): Promise<Row[]> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/location_search_candidates_ar`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ p_per_platform: null, p_limit: 200, p_offset: 0, ...args }),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}: ${await res.text()}`);
  return (await res.json()) as Row[];
}

// has_photo for a batch of (source_table, listing_id) rows, via the search_listings_ar REST table -
// same anon/RLS path real cards read from, not a privileged shortcut.
async function hasPhotoMap(rows: { source_table: string; listing_id: number }[]): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  const byTable = new Map<string, number[]>();
  for (const r of rows) {
    let a = byTable.get(r.source_table);
    if (!a) { a = []; byTable.set(r.source_table, a); }
    a.push(r.listing_id);
  }
  for (const [table, ids] of byTable) {
    const res = await fetch(
      `${URL_BASE}/rest/v1/search_listings_ar?select=source_table,listing_id,has_photo&source_table=eq.${encodeURIComponent(table)}&listing_id=in.(${ids.join(',')})`,
      { headers: HEADERS },
    );
    if (!res.ok) throw new Error(`table ${res.status}: ${await res.text()}`);
    for (const r of (await res.json()) as { source_table: string; listing_id: number; has_photo: boolean | null }[]) {
      out.set(`${r.source_table}:${r.listing_id}`, r.has_photo);
    }
  }
  return out;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const seq = (rows: Row[]) => rows.map((r) => `${r.source_table}:${r.listing_id}`).join(',');
const idSet = (rows: Row[]) => new Set(rows.map((r) => `${r.source_table}:${r.listing_id}`));

type Q = { name: string; args: Record<string, unknown> };
const QUERIES: Q[] = [
  { name: 'Buy · الرياض (broad)', args: { p_deal: BUY, p_cities: ['الرياض'] } },
  { name: 'Buy · جدة · فيلا', args: { p_deal: BUY, p_cities: ['جدة'], p_types: ['فيلا'] } },
];

async function main() {
  for (const q of QUERIES) {
    const baseline = await rpc(q.args);
    if (!baseline.length) { check(`${q.name}: has results`, false, 'RPC returned 0 rows'); continue; }
    const total = Number(baseline[0].total_count);

    // (1) determinism: two calls with NO seed are byte-identical (no accidental randomness anywhere).
    const noSeedA = await rpc(q.args);
    const noSeedB = await rpc(q.args);
    check(`${q.name}: no-seed order is deterministic across repeat calls`, seq(noSeedA) === seq(noSeedB));

    // (2) same seed -> identical order across repeat calls.
    const seedA1 = await rpc({ ...q.args, p_rotation_seed: 'live-check-seed-A' });
    const seedA2 = await rpc({ ...q.args, p_rotation_seed: 'live-check-seed-A' });
    check(`${q.name}: same seed -> identical order across repeat calls`, seq(seedA1) === seq(seedA2));

    // (3) different seed -> different order, SAME matched set (rotation reorders, never re-filters).
    // The same-set comparison is only meaningful window-to-window when the whole matched set fits in
    // one page: rotation's tie-breaking scope is narrow (only rows sharing the same div_rank+photo_rank
    // tier), so a page-0 window comparison across two DIFFERENT orderings of a set far larger than the
    // page can legitimately show different ids near the boundary without that being a bug - a fair
    // total_count/full-set proof needs the whole set, which the p_limit:total call below provides.
    const seedB = await rpc({ ...q.args, p_rotation_seed: 'live-check-seed-B-different' });
    if (total <= 200) {
      const sameSet = idSet(seedA1).size === idSet(seedB).size
        && [...idSet(seedA1)].every((k) => idSet(seedB).has(k));
      check(`${q.name}: different seed -> same matched set (whole set fits in one page)`, sameSet,
        `A=${idSet(seedA1).size} B=${idSet(seedB).size}`);
    }
    if (total > baseline.length) {
      // only meaningful when there's more than one page's worth to actually reorder
      check(`${q.name}: different seed -> different order`, seq(seedA1) !== seq(seedB));
    }

    // (4) rotation NEVER changes eligibility/count - identical total_count with vs without a seed.
    // A page-0 WINDOW comparison would be wrong when total exceeds the page size: reordering the
    // rows legitimately changes which ids land in the first N, that's rotation doing its job, not an
    // eligibility change. Full id-set equality is only a meaningful check when the whole set fits in
    // one page; otherwise total_count (cardinality) plus the multi-page walk-coverage check below are
    // the correct proof that nothing was gained, lost, or duplicated.
    check(`${q.name}: total_count unchanged by rotation seed`,
      Number(seedA1[0]?.total_count) === total, `no-seed=${total} seeded=${seedA1[0]?.total_count}`);
    if (total <= 200) {
      check(`${q.name}: matched id-set unchanged by rotation seed (whole set fits in one page)`,
        idSet(noSeedA).size === idSet(seedA1).size && [...idSet(noSeedA)].every((k) => idSet(seedA1).has(k)));
    }

    // (5) multi-page walk under ONE seed: zero duplicates, covers the full set an unpaged fetch does.
    if (total > 50 && total <= 5000) {
      const p0 = await rpc({ ...q.args, p_rotation_seed: 'live-check-walk-seed', p_limit: 50, p_offset: 0 });
      const p1 = await rpc({ ...q.args, p_rotation_seed: 'live-check-walk-seed', p_limit: 50, p_offset: 50 });
      const p2 = await rpc({ ...q.args, p_rotation_seed: 'live-check-walk-seed', p_limit: total, p_offset: 100 });
      const walked = [...p0, ...p1, ...p2];
      const ids = walked.map((r) => `${r.source_table}:${r.listing_id}`);
      check(`${q.name}: rotated multi-page walk has zero duplicates`, new Set(ids).size === ids.length,
        `fetched=${ids.length} distinct=${new Set(ids).size}`);
      const full = await rpc({ ...q.args, p_rotation_seed: 'live-check-walk-seed', p_limit: total, p_offset: 0 });
      check(`${q.name}: rotated multi-page walk covers exactly the unpaged set (no skips)`,
        idSet(full).size === new Set(ids).size && [...idSet(full)].every((k) => new Set(ids).has(k)));

      // the rigorous, non-windowed version of "different seed -> same matched set": fetch the FULL
      // set under two different seeds and compare, rather than a page-0 window (see the comment above).
      const fullOther = await rpc({ ...q.args, p_rotation_seed: 'live-check-seed-B-different', p_limit: total, p_offset: 0 });
      check(`${q.name}: full matched set identical across two different seeds`,
        idSet(full).size === idSet(fullOther).size && [...idSet(full)].every((k) => idSet(fullOther).has(k)),
        `seedA=${idSet(full).size} seedB=${idSet(fullOther).size}`);
    }

    // (6) photo preference actually applies: within ONE platform's own subset, a confirmed-has_photo
    // row never sorts after a confirmed-no_photo row (unknown/NULL rows are exempt by design - they
    // are neither rewarded nor punished, see the PHOTO PREFERENCE rule).
    const byPlat = new Map<string, Row[]>();
    for (const r of baseline) { let a = byPlat.get(r.platform); if (!a) { a = []; byPlat.set(r.platform, a); } a.push(r); }
    const sample = baseline.slice(0, 150);
    const photoMap = await hasPhotoMap(sample);
    for (const [plat, rows] of byPlat) {
      const known = rows.filter((r) => photoMap.has(`${r.source_table}:${r.listing_id}`));
      if (known.length < 2) continue;
      let sawFalse = false;
      let violated = false;
      for (const r of known) {
        const hp = photoMap.get(`${r.source_table}:${r.listing_id}`);
        if (hp === false) sawFalse = true;
        else if (hp === true && sawFalse) { violated = true; break; }
      }
      check(`${q.name} · ${plat}: no confirmed-no-photo row precedes a confirmed-has-photo row`, !violated);
    }
  }

  // (7) explicit sort wins: price_asc is byte-identical with and without a rotation seed.
  const priceNoSeed = await rpc({ p_deal: BUY, p_cities: ['الرياض'], p_sort_by: 'price_asc', p_limit: 200 });
  const priceSeeded = await rpc({ p_deal: BUY, p_cities: ['الرياض'], p_sort_by: 'price_asc', p_rotation_seed: 'live-check-seed-A', p_limit: 200 });
  check('price_asc: byte-identical order with vs without a rotation seed (explicit sort wins)',
    seq(priceNoSeed) === seq(priceSeeded));

  console.log(failed === 0
    ? '\n✓ photo-preference + rotation live behavior holds — deterministic, seed-varying, count-honest, sort-safe'
    : `\n✗ ${failed} live photo/rotation check(s) FAILED against production`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
