// WEEKLY ROBOT: does any site publish a pin we failed to save? (owner 2026-10-20: «we keep getting
// mistakes» → «yeah do that»). Every «no pin» claim we made that night was wrong at least once, because a
// static read missed an escaped JSON blob, a DMS link, a hidden field or a short link. This robot does what
// finally found them: for every DISTRICT_MAP_PLATFORMS site (the SAME list the ad page uses, lifted from
// src/data/adPageData.ts), it opens a few ads WE SHOW WITH A BORDER in a real Chromium, collects the page
// HTML, every frame URL, every maps link and every map-ish network URL, and asks
// scripts/lib/missedPinCandidates.ts which pairs on it are the ad's OWN unsaved pin (office/default points,
// «similar ads» cards and rows we strip on purpose are excluded — see that file). A site where ≥ 2 sampled
// ads carry one is printed with the exact ad and the pair, and the run exits 1 so the alert bridge raises it.
//
// A FAILED FETCH IS NOT AN EMPTY ANSWER: an Ezhalah REST request that fails exits 2. A source page that
// will not load is counted as UNREACHABLE (never as «no pin»), and the run is red (exit 2) when more than
// half the sites were unreachable, because then the robot has proved nothing.
//
// Load: read-only anon REST (a few small queries per site) + ONE browser against the SOURCE sites,
// sequential. It never opens ezhalah-app.vercel.app and never calls a search RPC.
//
//   node --experimental-strip-types scripts/check-border-ads-for-missed-pins.ts [--per-site 6] [--sites a,b]

import { chromium } from '@playwright/test';
import { liftSymbols } from './lib/liftSymbols.ts';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from './lib/public-supabase.ts';
import { judgeSite, pairsIn, key, type AdSample } from './lib/missedPinCandidates.ts';

const FILE = new URL('../src/data/adPageData.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const lifted = await liftSymbols(FILE, [{ header: 'export const DISTRICT_MAP_PLATFORMS: ', endsWith: /^\];$/ }], ['DISTRICT_MAP_PLATFORMS']);
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const PER_SITE = Number(arg('--per-site') ?? 6);
const ONLY = arg('--sites')?.split(',');
const PLATFORMS = (lifted.DISTRICT_MAP_PLATFORMS as readonly string[]).filter((p) => !ONLY || ONLY.includes(p));
const headers = { apikey: PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${PUBLIC_SUPABASE_ANON_KEY}` };

async function get<T>(path: string): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const r = await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { headers, signal: ac.signal });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as T;
  } catch (e) {
    console.error(`FETCH FAILED (not an empty answer): ${path.slice(0, 120)} — ${(e as Error).message}`);
    process.exit(2);
  } finally { clearTimeout(timer); }
}

// Points and rows we strip ON PURPOSE: a source page still shows them, and that is not a miss.
const defaults = await get<Array<{ lat: number; lng: number }>>('ops_default_pin_register?select=lat,lng');
const far = await get<Array<{ source_table: string; listing_id: number; lat: number; lng: number }>>('ops_far_pin_register?select=source_table,listing_id,lat,lng');
const skipPoints = new Set([...defaults, ...far].map((d) => key(Number(d.lat), Number(d.lng))));

// A pair another ad of the SAME platform already carries is a «similar ads» card, not this ad's pin.
async function storedElsewhere(platform: string, lat: number, lng: number): Promise<boolean> {
  const d = 0.00006;
  const hit = await get<unknown[]>(`search_listings_ar?select=listing_id&platform=eq.${encodeURIComponent(platform)}`
    + `&latitude=gte.${lat - d}&latitude=lte.${lat + d}&longitude=gte.${lng - d}&longitude=lte.${lng + d}&limit=1`);
  return hit.length > 0;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });   // CI: playwright install; locally: any Chromium
const ctx = await browser.newContext({ locale: 'ar-SA', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' });
type Report = { platform: string; border: number; sampled: number; loaded: number; missed: Array<{ url: string; pair: string; shape: string }> };
const reports: Report[] = [];

for (const platform of PLATFORMS) {
  const served = await get<Array<{ listing_id: number; source_table: string }>>('search_listings_ar?select=listing_id,source_table'
    + `&platform=eq.${encodeURIComponent(platform)}&latitude=is.null&production_ready=eq.true&limit=500`);
  const pick = served.sort(() => Math.random() - 0.5).slice(0, PER_SITE);
  const rows: Array<{ id: number; listing_url: string; table: string; saved?: unknown }> = [];
  for (const table of new Set(pick.map((p) => p.source_table))) {
    const ids = pick.filter((p) => p.source_table === table).map((p) => p.listing_id);
    // saved = the pin is already in the source row and only waits for the hourly search refresh — not a miss.
    const got = await get<Array<{ id: number; listing_url: string; saved?: unknown }>>(`${table}?select=id,listing_url,saved:additional_info->latitude&id=in.(${ids.join(',')})`);
    rows.push(...got.map((r) => ({ ...r, table })));
  }
  const farIds = new Set(far.filter((f) => rows.some((r) => r.table === f.source_table)).map((f) => f.listing_id));
  for (const r of rows) if (r.saved != null && r.saved !== '') farIds.add(r.id);
  const samples: AdSample[] = [];
  for (const r of rows) {
    if (!r.listing_url) continue;
    const page = await ctx.newPage();
    const network: string[] = [];
    page.on('request', (q) => { const u = q.url(); if (/map|lat|lng|geo|location/i.test(u)) network.push(u); });
    try {
      await page.goto(r.listing_url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      const html = await page.content();
      const frames = page.frames().map((f) => f.url());
      const links = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href).filter((h) => /goo\.gl|maps/i.test(h))).catch(() => [] as string[]);
      samples.push({ url: r.listing_url, listingId: r.id, html, frames: [...frames, ...links], network });
    } catch { /* unreachable — counted below, never read as «no pin» */ }
    await page.close();
  }
  // Pins stored on OTHER ads, asked per candidate pair (a handful of tiny queries, never a platform dump).
  const known = new Set<string>();
  for (const s of samples) for (const p of pairsIn(s)) if (await storedElsewhere(platform, p.lat, p.lng)) known.add(key(p.lat, p.lng));
  const v = judgeSite(samples, known, { points: skipPoints, listingIds: farIds });
  const r: Report = { platform, border: served.length, sampled: rows.length, loaded: samples.length,
    missed: v.flagged ? v.missed.map((m) => ({ url: m.url, pair: key(m.pair.lat, m.pair.lng), shape: m.pair.shape })) : [] };
  reports.push(r);
  const icon = r.missed.length ? '🔴' : r.border === 0 ? '⚪' : r.loaded === 0 ? '🟡' : '🟢';
  console.log(`${icon} ${platform}: border ${r.border >= 500 ? '500+' : r.border} · opened ${r.loaded}/${r.sampled}`
    + (r.missed.length ? ` · MISSED PIN on ${r.missed.length} ad(s)` : ''));
  for (const m of r.missed) console.log(`     ${m.url}  →  ${m.pair}  (${m.shape})`);
}
await browser.close();

const flagged = reports.filter((r) => r.missed.length);
const tried = reports.filter((r) => r.sampled > 0);
const unreachable = tried.filter((r) => r.loaded === 0);
console.log(`\n${tried.length} sites with border ads · ${flagged.length} publish a pin we did not save · ${unreachable.length} unreachable`
  + (unreachable.length ? ` (${unreachable.map((r) => r.platform).join(', ')})` : ''));
if (flagged.length) { console.log('❌ A site publishes pins we show as a border. Fix its scraper to read them (scrapers/common/page_pin.py has the readers).'); process.exit(1); }
if (tried.length && unreachable.length * 2 > tried.length) { console.log('❌ More than half the sites would not load — this run proved nothing.'); process.exit(2); }
console.log('✅ No site publishes a pin on the border ads we sampled.');
