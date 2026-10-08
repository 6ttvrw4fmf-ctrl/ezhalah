// Refresh the small coverage snapshot using the same production city-count RPC as Trending.
// node --experimental-strip-types scripts/generate-platform-picker-coverage.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
const target = new URL('../src/data/platformPickerCoverage.json', import.meta.url);
const previous = JSON.parse(readFileSync(target, 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('../src/data/sa-locations.json', import.meta.url), 'utf8'));
const regionEn = new Map(catalog.regions.map((row: any[]) => [row[0], row[1]]));
const cityEn = new Map(catalog.cities.map((row: any[]) => [row[3], row[2]]));
const { url, key } = resolvePublicSupabase();
const platforms: Record<string, any> = {};
for (const [name, old] of Object.entries(previous.platforms) as [string, any][]) {
  const started = Date.now();
  const response = await fetch(`${url}/rest/v1/rpc/top_cities_by_deal_ar`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_deal: null, p_platforms: old.slugs }), signal: AbortSignal.timeout(15000),
  });
  // A failed read never overwrites the last measured snapshot with an invented empty coverage.
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}; snapshot unchanged`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`${name}: invalid response; snapshot unchanged`);
  if (!rows.length) {
    platforms[name] = old.state === 'source-examples' ? old
      : { slugs: old.slugs, state: 'known', total: null, regions: [], cityCount: 0, topCity: null };
  } else {
    const total = Number(rows[0].total_in_cohort);
    if (!Number.isFinite(total) || total <= 0) throw new Error(`${name}: invalid total; snapshot unchanged`);
    const regions: Record<number, any> = {};
    for (const row of rows) {
      const count = Number(row.listing_count);
      if (!Number.isFinite(count) || count < 0) throw new Error(`${name}: invalid count; snapshot unchanged`);
      if (row.region_id && row.region_ar) {
        const region = regions[row.region_id] ??= { id: row.region_id, name: row.region_ar, en: regionEn.get(row.region_id), count: 0 };
        if (!region.en) throw new Error(`${name}: uncatalogued region; snapshot unchanged`);
        region.count += count;
      }
    }
    const top = rows.slice().sort((a: any, b: any) => Number(b.listing_count) - Number(a.listing_count))[0];
    platforms[name] = { slugs: old.slugs, state: 'known', total,
      regions: Object.values(regions).sort((a: any, b: any) => b.count - a.count), cityCount: rows.length,
      topCity: { name: top.city_ar, en: cityEn.get(top.city_ar), count: Number(top.listing_count) } };
  }
  // Below the canonical 1.5 searches/second sustained ceiling; one request at a time.
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 750 - (Date.now() - started))));
}
const next = { measuredAt: new Date().toISOString(), rpc: previous.rpc, scope: { p_deal: null }, platforms };
const header = JSON.stringify({ measuredAt: next.measuredAt, rpc: next.rpc, scope: next.scope }).slice(1, -1);
const records = Object.entries(platforms).map(([name, row]) => `    ${JSON.stringify(name)}: ${JSON.stringify(row)}`).join(',\n');
writeFileSync(target, `{${header},\n  "platforms": {\n${records}\n  }\n}\n`);
console.log(`Updated ${Object.keys(platforms).length} listing-location profiles; no service or office-location copy.`);
