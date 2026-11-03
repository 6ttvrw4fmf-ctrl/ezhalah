/**
 * dealapp_shard_coverage must not call a shard that is RUNNING a shard that did not run
 * (⚡ Scraping Engineer 2026-11-03, alert 12799, migration 20261103052507).
 *
 * dealapp-sharded.yml is dispatched once a day (~02:33 UTC) and a shard takes up to ~4 h. The detector
 * required an ok run STARTED in the last 24 h, so the 02:59 sweep named every shard still in flight as
 * «missing» (11-03: 9 of 24, all with finished_at NULL) and counted those same runs as blocked zero-row
 * runs — 80 raises of a P1 that described the nightly crawl working normally. The window is now 30 h (one
 * daily cycle + the longest shard) and an unfinished run is not a blocked one.
 *
 * Hermetic: reads the LATEST committed definition. Mutations at the bottom prove each check fails on the
 * broken shape it guards.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { windowBetween } from './lib/sourceWindow.ts';

const MIGRATIONS = join(new URL('..', import.meta.url).pathname, 'supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const hits = files.filter((f) => readFileSync(join(MIGRATIONS, f), 'utf8').toLowerCase()
  .includes('function public.mon_detect_dealapp_shard_coverage('));
const def = hits.length ? readFileSync(join(MIGRATIONS, hits[hits.length - 1]), 'utf8') : '';

function problems(sql: string): string[] {
  const out: string[] = [];
  if (!sql) return ['a committed migration defines mon_detect_dealapp_shard_coverage()'];
  let missing: string, blocked: string;
  try {
    missing = windowBetween(sql, 'into v_missing', 'into v_blocked', 'dealapp_shard_coverage');
    blocked = windowBetween(sql, 'into v_blocked', 'v_cov :=', 'dealapp_shard_coverage');
  } catch (e) {
    return [`the missing-shard and blocked-run queries are where this check expects them (${(e as Error).message})`];
  }
  const m = /r\.started_at > now\(\) - interval '(\d+) hours'\s+and r\.ok/.exec(missing);
  if (!m || Number(m[1]) < 26) {
    out.push('a shard is covered by an ok run within one daily cycle plus the longest shard (≥ 26 h), not a bare 24 h');
  }
  if (m && Number(m[1]) > 48) out.push('the window stays under two days, so a shard that misses a day is still caught');
  if (!/finished_at is not null/.test(blocked)) out.push('a run still in flight is not counted as a blocked zero-row run');
  return out;
}

let failures = 0;
const real = problems(def);
for (const p of real) { failures++; console.error(`  ✗ ${p}`); }
if (!real.length) console.log(`  ✓ ${hits[hits.length - 1]}: in-flight shards are neither «missing» nor «blocked»`);

function mutation(name: string, broken: string): void {
  if (problems(broken).length) { console.log(`  ✓ (mutation) catches ${name}`); return; }
  failures++;
  console.error(`  ✗ (mutation) NOT caught: ${name}`);
}
mutation('the bare 24 h window back', def.replace("interval '30 hours'", "interval '24 hours'"));
mutation('a window so wide a skipped day hides', def.replace("interval '30 hours'", "interval '72 hours'"));
mutation('in-flight runs counted as blocked again', def.replace('and finished_at is not null', ''));
mutation('the definition missing', '');

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\nPASS — dealapp_shard_coverage judges a nightly that is still running as running.');
