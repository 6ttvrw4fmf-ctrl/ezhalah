/**
 * The dealapp shard fleet must END before the 05:00 UTC engineer window, i.e. in the first half-hour of the
 * 04:22 small-sources nightly at worst (⚡ 2026-11-03, backlog 1164,
 * migration 20261103052955).
 *
 * The fleet takes up to ~4 h (longest shard 231 min on 2026-11-01; job timeout 250) and holds up to 12 of
 * the repo's 20 runners. Started at 02:33 it ran into the nightly's 144 jobs and the 05:00+ engineer window:
 * 11-03 05:30 UTC, 20 of 20 runners busy (dealapp 9), ~70 jobs queued — PR checks and every engineer proof.
 *
 * Hermetic: reads the LATEST committed migration that schedules gh-dealapp-sharded (cron.schedule or
 * cron.alter_job) and requires start + the job's timeout-minutes (250) to land at or before 05:00 UTC.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const WINDOW_MIN = 5 * 60;   // ⚡ starts 05:00 UTC; the nightly's first ~38 min may share runners
const wf = readFileSync(join(ROOT, '.github/workflows/dealapp-sharded.yml'), 'utf8');
const timeout = Number(/timeout-minutes:\s*(\d+)/.exec(wf)?.[1] ?? NaN);

function scheduleOf(sql: string): string | null {
  if (!/gh-dealapp-sharded/.test(sql)) return null;
  const m = /schedule\s*:=\s*'([^']+)'/.exec(sql) ?? /'gh-dealapp-sharded'\s*,\s*'([^']+)'/.exec(sql);
  return m ? m[1] : null;
}

function problems(cron: string | null, timeoutMin: number): string[] {
  if (!cron) return ['a committed migration schedules gh-dealapp-sharded'];
  if (!Number.isFinite(timeoutMin)) return ['dealapp-sharded.yml declares timeout-minutes'];
  const [mm, hh] = cron.trim().split(/\s+/);
  const start = Number(hh) * 60 + Number(mm);
  if (!Number.isInteger(start)) return [`the schedule «${cron}» is one fixed daily time`];
  // A start late in the previous day (e.g. 22:33) counts as negative minutes before midnight.
  const startRel = start >= 12 * 60 ? start - 24 * 60 : start;
  const end = startRel + timeoutMin;
  return end <= WINDOW_MIN ? [] : [`the fleet (start ${hh}:${mm} + ${timeoutMin} min) ends after 05:00 UTC`];
}

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
let latest: { f: string; cron: string } | null = null;
for (const f of files) {
  const c = scheduleOf(readFileSync(join(MIGRATIONS, f), 'utf8'));
  if (c) latest = { f, cron: c };
}

let failures = 0;
const real = problems(latest?.cron ?? null, timeout);
for (const p of real) { failures++; console.error(`  ✗ ${p}`); }
if (!real.length) console.log(`  ✓ ${latest!.f}: «${latest!.cron}» + ${timeout} min ends before 05:00 UTC`);

function mutation(name: string, cron: string | null, t = timeout): void {
  if (problems(cron, t).length) { console.log(`  ✓ (mutation) catches ${name}`); return; }
  failures++; console.error(`  ✗ (mutation) NOT caught: ${name}`);
}
mutation('the old 02:33 slot', '33 2 * * *');
mutation('a timeout raised past the gap', latest?.cron ?? null, 400);
mutation('no schedule at all', null);
if (problems('33 22 * * *', timeout).length) { failures++; console.error('  ✗ (control) a 22:33 start must be accepted'); }
else console.log('  ✓ (control) a 22:33 start (previous evening) is accepted');

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\nPASS — the dealapp fleet ends before the engineer window.');
