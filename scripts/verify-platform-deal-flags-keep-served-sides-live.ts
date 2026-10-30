// LIVE half of verify-sale-and-rent-flags-keep-served-sides.ts (backlog 1097, falcon 2026-10-30).
// For every platform the loader calls active, and each deal side, it asks production for one served row,
// reads that row's own `source` (the value supports() really sees on the card path), and fails when a
// flag in src/data/platforms.ts would drop the side after the count: the sakani / wajaf class of 10-30.
// A site that starts selling, or starts renting, turns this red within hours, not at the next audit.
//
// FAILS CLOSED: an unreachable endpoint, a non-200, or an implausibly small fleet exits 1 — never «clean».
// Needs SUPABASE_SERVICE_ROLE_KEY (platform tables are not anon-readable). Home: platform-deal-flags-live.yml.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-platform-deal-flags-keep-served-sides-live.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { hiddenServedSides, type ServedSide } from './lib/platformDealFlags.ts';
import { supports } from '../src/data/platforms.ts';

const { url: BASE, key: ANON } = resolvePublicSupabase();
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!SERVICE) { console.error('FAIL: SUPABASE_SERVICE_ROLE_KEY is not set — cannot read a row\'s source'); process.exit(1); }
const REST = `${BASE}/rest/v1`;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(path: string, key: string, init?: RequestInit): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${REST}/${path}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as any);
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${path.slice(0, 80)} → HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    await pause(2000 * attempt);
  }
}

const slugs: string[] = await get('rpc/loader_active_platforms_ar', ANON, { method: 'POST', body: '{}' });
if (!Array.isArray(slugs) || slugs.length < 50) { console.error(`FAIL: implausible fleet (${slugs?.length} slugs)`); process.exit(1); }

const served: ServedSide[] = [];
for (const slug of slugs) {
  for (const [dealAr, deal] of [['بيع', 'Buy'], ['إيجار', 'Rent']] as const) {
    const rows = await get(`search_listings_ar?select=source_table,listing_id&production_ready=is.true&platform=eq.${encodeURIComponent(slug)}&deal_ar=eq.${encodeURIComponent(dealAr)}&limit=1`, ANON);
    await pause(250);
    if (!rows.length) continue;
    const { source_table, listing_id } = rows[0];
    const src = await get(`${encodeURIComponent(source_table)}?select=source&id=eq.${encodeURIComponent(listing_id)}`, SERVICE);
    await pause(250);
    if (!src.length || !src[0].source) { console.error(`FAIL: ${source_table}:${listing_id} has no readable source`); process.exit(1); }
    served.push({ slug, source: src[0].source, deal, sample: `${source_table}:${listing_id}` });
  }
}
if (served.length < 50) { console.error(`FAIL: only ${served.length} served sides read — not a measurement`); process.exit(1); }

const problems = hiddenServedSides(served, supports);
console.log(`checked ${served.length} served sides across ${slugs.length} active platforms`);
if (problems.length) { for (const p of problems) console.error(`  ✗ ${p}`); process.exit(1); }
console.log('✓ no platform flag hides a deal side production serves');
