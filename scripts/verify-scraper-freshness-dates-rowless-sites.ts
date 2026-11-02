// Regression guard — check_scraper_freshness() must date a site that stores NO row by its crawler's last ok run,
// never by the epoch. ⚡ 2026-11-02 (alert 4194, migration 20261102054212): alhumaidan (every ad «تم الإيجار», 0 rows)
// read «498,216 hours stale» and raised a critical row every 6 h for six weeks while its crawl ran ok nightly.
// OFFLINE: the LAST committed migration that rewrites check_scraper_freshness must carry the no-row branch.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const BRANCH = /if latest is null then\s+select max\(sr\.finished_at\) into latest from public\.scrape_runs sr where sr\.platform = rec\.p and sr\.ok;/;
type F = { name: string; text: string };

export function problem(files: F[]): string | null {
  const writers = [...files].sort((a, b) => a.name.localeCompare(b.name))
    .filter(f => /check_scraper_freshness/.test(f.text) &&
      (/create\s+or\s+replace\s+function\s+(public\.)?check_scraper_freshness/i.test(f.text) ||
       /pg_get_functiondef\('public\.check_scraper_freshness\(\)'/.test(f.text)));
  const last = writers.at(-1);
  if (!last) return 'no committed migration rewrites check_scraper_freshness';
  return BRANCH.test(last.text) ? null : `last writer ${last.name} dates a row-less site by the epoch`;
}

const files: F[] = readdirSync(DIR).filter(n => n.endsWith('.sql')).map(name => ({ name, text: readFileSync(join(DIR, name), 'utf8') }));
let fail = 0;
const p = problem(files);
if (p) { console.error(`✗ ${p}`); fail++; } else console.log('✓ check_scraper_freshness dates a row-less site by its last ok run');
const mutant = [...files, { name: '29991231000000_m.sql', text: "create or replace function public.check_scraper_freshness() returns setof record as $f$ begin hs := coalesce(latest, 'epoch'); end $f$;" }];
if (problem(mutant) === null) { console.error('✗ mutation NOT caught: a later rewrite without the no-row branch'); fail++; }
else console.log('✓ mutation caught: a later rewrite without the no-row branch');
process.exit(fail ? 1 : 0);
