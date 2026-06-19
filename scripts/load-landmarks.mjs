// One-time loader: reads the 14 local landmark JSON catalogs and bulk-upserts every record into the
// Supabase `landmarks` table. The data flows file → script → DB and never passes through the chat.
// Run:  SUPABASE_SERVICE_ROLE_KEY=... node scripts/load-landmarks.mjs   (URL is read from .env)
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/data/landmarks');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

const rows = [];
for (const f of files) {
  const base = f.replace('.json', '');
  const arr = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  arr.forEach((lm, idx) => {
    rows.push({
      landmark_id: `${base}:${idx}`, // synthesized → guaranteed unique across catalogs
      landmark_name: lm.landmark_name,
      aliases: Array.isArray(lm.aliases) ? lm.aliases : [],
      category: lm.category ?? '',
      region: lm.region ?? '',
      city: lm.city ?? '',
      region_id: lm.region_id ?? null,
      city_id: lm.city_id ?? null,
      batch: lm.batch ?? null,
    });
  });
}
console.log(`Loaded ${rows.length} landmarks from ${files.length} catalogs.`);

for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500);
  const { error } = await sb.from('landmarks').upsert(chunk, { onConflict: 'landmark_id' });
  if (error) {
    console.error(`Batch at ${i} failed:`, error.message);
    process.exit(1);
  }
  console.log(`  upserted ${Math.min(i + 500, rows.length)} / ${rows.length}`);
}
console.log('Done.');
