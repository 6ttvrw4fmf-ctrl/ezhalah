// Load data/place-shapes.geojson.gz (OSM district / city / region boundaries, © OpenStreetMap contributors, ODbL) into
// public.place_shapes through place_shapes_upsert() — the only writer of that table (service role).
//
// Run by .github/workflows/place-shapes-load.yml with the repository secrets; never from an agent container (no
// service key there, by design). Idempotent: rows are keyed by (osm_type, osm_id) and upserted.
//
//   node --experimental-strip-types scripts/load-place-shapes.ts [--dry-run] [--chunk 150]
import './lib/gateFetch.mjs'; // secret handshake for our own database calls (docs/ops/SCRAPE_GUARD.md)
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dry = process.argv.includes('--dry-run');
const chunkArg = process.argv.indexOf('--chunk');
const CHUNK = chunkArg > 0 ? Number(process.argv[chunkArg + 1]) : 150;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dry && (!url || !key)) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'); process.exit(2); }

type Row = { osm_type: string; osm_id: number; kind: string; admin_level: string | null; name_ar: string | null; name_en: string | null; geometry: unknown };
const rows: Row[] = JSON.parse(gunzipSync(readFileSync(join(root, 'data/place-shapes.geojson.gz'))).toString('utf8'));
const kinds = rows.reduce<Record<string, number>>((m, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {});
console.log(`place-shapes: ${rows.length} rows ${JSON.stringify(kinds)} in chunks of ${CHUNK}${dry ? ' (dry run — nothing written)' : ''}`);
if (dry) process.exit(0);

let written = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  let attempt = 0;
  for (;;) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const res = await fetch(`${url}/rest/v1/rpc/place_shapes_upsert`, {
        method: 'POST', signal: ctrl.signal,
        headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_rows: chunk }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
      written += Number(text) || 0;
      console.log(`  ${i + chunk.length}/${rows.length} → upserted ${text}`);
      break;
    } catch (e) {
      if (++attempt >= 4) { console.error(`chunk at ${i} failed ${attempt}×:`, e); process.exit(1); }
      await new Promise((r) => setTimeout(r, 3_000 * attempt));
    } finally { clearTimeout(timer); }
  }
}
console.log(`place-shapes: ${written} rows upserted`);
