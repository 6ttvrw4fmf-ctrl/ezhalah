// DAILY ROBOT: every NEW ad on a district-map platform (DISTRICT_MAP_PLATFORMS: Aqar, Aqar Monthly,
// Wasalt since 2026-10-19) must get a map on its ad page (owner, 2026-10-18).
//
// The owner: «make sure automatically it knows if we have the pin — perfect; if not, we do the
// boundaries». The ad page decides it in this order, and this check runs THE SAME CODE, lifted from
// src/data/adPageData.ts, never a copy:
//   1. the source published a pin            → mapPoint(row)
//   2. no pin, a district + city             → «حي X، City» (Google's own district border)
//   3. no pin, a city only                   → the city border
//   4. no pin, no city in our index          → the town the ad's own sa.aqar.fm link names
// An ad that falls through all four shows NO map. This script lists those ads, prints why, and exits 1
// so the workflow goes red and the alert bridge raises it. Read-only, anon key, a few small requests.
//
// A FAILED FETCH IS NOT AN EMPTY ANSWER: any request that errors exits 2 (red), never "0 problems".
//
//   node --experimental-strip-types scripts/check-aqar-map-coverage-live.ts [--hours 26]

import { liftSymbols } from './lib/liftSymbols.ts';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from './lib/public-supabase.ts';

type Row = { platform?: string | null; city_ar?: string | null; district_ar?: string | null; latitude?: unknown; longitude?: unknown; source_table?: string; listing_id?: number };
type Place = { query: string; district: string; city: string } | null;

const FILE = new URL('../src/data/adPageData.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const lifted = await liftSymbols(FILE, [
  { header: 'const num = (', endsWith: /: NaN;$/ },
  { header: 'export function mapPoint(' },
  { header: 'export const isCoarse = ', endsWith: /< 1e-6;$/ },
  { header: 'export const DISTRICT_MAP_PLATFORMS: ', endsWith: /^\];$/ },
  { header: 'export function aqarTownFromUrl(' },
  { header: 'export function districtPlace(' },
], ['mapPoint', 'districtPlace', 'DISTRICT_MAP_PLATFORMS']);
const PLATFORMS = lifted.DISTRICT_MAP_PLATFORMS as readonly string[];   // the SAME list the page uses
const mapPoint = lifted.mapPoint as (r: Row) => unknown;
const districtPlace = lifted.districtPlace as (r: Row, url?: string | null) => Place;

const hoursArg = process.argv.indexOf('--hours');
const HOURS = hoursArg > 0 ? Number(process.argv[hoursArg + 1]) : 26;
const since = new Date(Date.now() - HOURS * 3600_000).toISOString();
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

// 1. Every district-map ad first seen in the window THAT SEARCH SERVES, paged. production_ready=true only
// (2026-10-21): an unready row is held out of every search, so no customer can open its page; the 10-21 run
// went red on 29 wasalt rows of which 23 were unready and the 6 served ones already had a city + district.
const rows: Row[] = [];
for (let from = 0; ; from += 1000) {
  const page = await get<Row[]>(`search_listings_ar?select=platform,city_ar,district_ar,latitude,longitude,source_table,listing_id`
    + `&platform=in.(${PLATFORMS.join(',')})&production_ready=eq.true&first_seen_at=gte.${encodeURIComponent(since)}&order=listing_id.asc&offset=${from}&limit=1000`);
  rows.push(...page);
  if (page.length < 1000) break;
}

// 2. Sort each ad into the path its page will take.
const tally = { pin: 0, district: 0, city: 0, town: 0, none: 0 };
const needLink: Row[] = [];
for (const r of rows) {
  if (mapPoint(r)) { tally.pin++; continue; }
  const p = districtPlace(r);
  if (p?.district) tally.district++;
  else if (p) tally.city++;
  else needLink.push(r);
}

// 3. No city in our index: the ad's own link is the last chance (the town fallback).
const missing: { row: Row; url: string | null }[] = [];
const byTable = new Map<string, Row[]>();
for (const r of needLink) byTable.set(String(r.source_table), [...(byTable.get(String(r.source_table)) ?? []), r]);
for (const [table, list] of byTable) {
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const links = await get<{ id: number; listing_url: string | null }[]>(`${table}?select=id,listing_url&id=in.(${chunk.map((r) => r.listing_id).join(',')})`);
    const urlOf = new Map(links.map((x) => [Number(x.id), x.listing_url]));
    for (const r of chunk) {
      const url = urlOf.get(Number(r.listing_id)) ?? null;
      if (districtPlace(r, url)) tally.town++;
      else { tally.none++; missing.push({ row: r, url }); }
    }
  }
}

console.log(`${PLATFORMS.join(' + ')} ads first seen in the last ${HOURS}h: ${rows.length}`);
console.log(`  pin ${tally.pin} | district border ${tally.district} | city border ${tally.city} | town from link ${tally.town} | NO MAP ${tally.none}`);
if (missing.length) {
  console.log('\nThese new ads will show NO map (no pin, no city, and their link names no town):');
  for (const m of missing.slice(0, 50)) console.log(`  ${m.row.platform} ${m.row.source_table}#${m.row.listing_id}  ${m.url ?? '(no link)'}`);
  process.exit(1);
}
console.log('OK — every new ad gets a map.');
