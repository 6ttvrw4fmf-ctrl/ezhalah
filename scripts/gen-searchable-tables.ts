// Regenerate SEARCHABLE_TABLES in src/data/remote.ts from production's own searchable inventory.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-searchable-tables.ts
//   node ... scripts/gen-searchable-tables.ts --check     # print the diff, write nothing
//
// THE INVENTORY IS A JOIN OF TWO PRODUCTION FACTS:
//   · the union arms of active_listing_ids_v2 — the matview sync_search_listings_ar reads to build
//     search_listings_ar. Being an arm is what "this table's rows CAN reach the search index" means.
//   · platform_registry.status <> 'retired' — whether the source is MEANT to be searched at all.
//     platform_registry's own note on `deal` reads "deprecated 2026-06-26, excluded from search".
// `dormant` is deliberately NOT excluded: a dormant scraper is a paused CRAWL, not withdrawn
// inventory (muktamel is dormant and has 523 live searchable rows).
//
// Deliberately NOT `select distinct source_table from search_listings_ar`, which answers the
// different and much worse question "which tables have rows RIGHT NOW" — a platform whose active
// rows momentarily hit zero would leave the inventory and then silently fail to come back.
//
// NEEDS A PRIVILEGED CONNECTION (pg_get_viewdef on a matview). This is a developer tool run by hand
// when a platform is activated, not a barrier: the BARRIER is
// scripts/verify-searchable-scope-matches-inventory.ts, which needs only the anon key and runs on a
// schedule. Set DATABASE_URL (or SUPABASE_DB_URL) to a connection string with catalog read access.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const TARGET = join(ROOT, 'src/data/remote.ts');
const CHECK = process.argv.includes('--check');

const DB = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
if (!DB) {
  console.error('✗ set DATABASE_URL (or SUPABASE_DB_URL) — this generator reads pg_get_viewdef, which the anon key cannot.');
  process.exit(1);
}

// The arms, straight out of the live matview definition. `psql -At` so the output is one bare name
// per line with no formatting to parse around.
const SQL = `
  with arms as (
    select distinct regexp_replace(m[1], '^public\\.', '') as t
    from regexp_matches(
           pg_get_viewdef('public.active_listing_ids_v2'::regclass),
           '(?:from|FROM)\\s+((?:public\\.)?[a-z0-9_]+_(?:residential|commercial)_listings)', 'g') m)
  select t from arms
  where split_part(t, '_', 1) not in (
          select platform from public.platform_registry where status = 'retired')
  order by 1`;

const out = execFileSync('psql', [DB, '-At', '-c', SQL], { encoding: 'utf8' });
const tables = out.split('\n').map((l) => l.trim()).filter(Boolean);

// A parse that silently returned nothing would rewrite the client scope to the empty list and take
// the whole search offline. Refuse to write anything that is not plausibly the fleet.
if (tables.length < 50) {
  console.error(`✗ only ${tables.length} arm(s) parsed out of active_listing_ids_v2 — refusing to write. Has the matview been rebuilt in a shape this regex cannot read?`);
  process.exit(1);
}

const LINE = /^const SEARCHABLE_TABLES = \[.*\];$/m;
const src = readFileSync(TARGET, 'utf8');
if (!LINE.test(src)) {
  console.error('✗ could not find the `const SEARCHABLE_TABLES = [...];` line in src/data/remote.ts — has it been renamed or reformatted onto several lines?');
  process.exit(1);
}
const next = src.replace(LINE, `const SEARCHABLE_TABLES = [${tables.map((t) => `'${t}'`).join(', ')}];`);

if (next === src) {
  console.log(`✅ SEARCHABLE_TABLES already matches the live inventory (${tables.length} tables).`);
  process.exit(0);
}
const before = new Set(JSON.parse((src.match(LINE)![0].match(/\[.*\]/)![0]).replace(/'/g, '"')) as string[]);
const added = tables.filter((t) => !before.has(t));
const removed = [...before].filter((t) => !tables.includes(t));
for (const t of added) console.log(`  + ${t}`);
for (const t of removed) console.log(`  - ${t}`);

if (CHECK) {
  console.log(`\n✗ src/data/remote.ts is ${added.length + removed.length} table(s) out of date. Re-run without --check to write it.`);
  process.exit(1);
}
writeFileSync(TARGET, next);
console.log(`\n✅ wrote ${tables.length} tables into src/data/remote.ts.`);
