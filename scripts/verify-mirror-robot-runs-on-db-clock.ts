// THE MIGRATION MIRROR ROBOT IS DISPATCHED BY THE DATABASE CLOCK, NOT ONLY BY GITHUB'S (2026-11-06).
// migration-auto-mirror.yml has its own '7,22,37,52 * * * *' schedule, and GitHub fired it 3 times on 2026-11-05.
// Applied migrations then waited for mirror PRs nobody opened, and the drift gate refused every deploy for most of the
// day. 20261106015317 adds trigger_gh_workflow('migration-auto-mirror.yml') to the pg_cron bundle that already
// dispatches engineer-automerge.yml. RULE: the NEWEST committed migration that redefines bundle-quarter-hour must
// still dispatch the mirror robot — so a later rewrite of that bundle cannot silently drop it.
// Run: node --experimental-strip-types scripts/verify-mirror-robot-runs-on-db-clock.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
let failed = 0;
const check = (m: string, c: boolean, d = '') => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ❌ ${m}${d ? `\n      ${d}` : ''}`); failed++; } };
const mustCatch = (m: string, caught: boolean) => check(`(mutation) catches ${m}`, caught);

const code = (sql: string) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
/** The newest file whose executed SQL touches bundle-quarter-hour, and whether it dispatches the mirror robot. */
export function newestBundleDefinition(files: Array<{ name: string; sql: string }>): { name: string; dispatches: boolean } | null {
  const hits = files.filter((f) => /bundle-quarter-hour|cron\.alter_job\(\s*211\b/.test(code(f.sql))).sort((a, b) => a.name.localeCompare(b.name));
  const last = hits[hits.length - 1];
  return last ? { name: last.name, dispatches: /trigger_gh_workflow\(\s*''?migration-auto-mirror\.yml''?\s*\)/.test(code(last.sql)) } : null;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(DIR, name), 'utf8') }));
const got = newestBundleDefinition(files);
check('a committed migration defines bundle-quarter-hour', !!got);
check(`the newest one (${got?.name}) dispatches migration-auto-mirror.yml`, !!got?.dispatches);

const base = [{ name: '20261106015317_x.sql', sql: "select cron.alter_job(211, command := '... trigger_gh_workflow(''migration-auto-mirror.yml'') ...');" }];
mustCatch('a later rewrite of the bundle that drops the mirror robot',
  newestBundleDefinition([...base, { name: '20991231000000_y.sql', sql: "select cron.schedule('bundle-quarter-hour', '2-59/15 * * * *', $c$select public.trigger_gh_workflow('engineer-automerge.yml')$c$);" }])?.dispatches === false);
mustCatch('a dispatch that sits only in a comment', newestBundleDefinition([{ name: '1_z.sql', sql: "-- trigger_gh_workflow('migration-auto-mirror.yml')\nselect cron.alter_job(211, command := 'x');" }])?.dispatches === false);

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the migration mirror robot runs on the database clock');
