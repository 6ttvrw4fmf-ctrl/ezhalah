// THE RECOVERY JOB NEVER UNDOES A HIDE THAT CARRIES ITS OWN FRESH «GONE» READING (♻️ 2026-11-05).
//
// auto_recover_false_inactive() (pg_cron 05:20 UTC) switches back on every row that is inactive with
// missing_count = 0, was deactivated in the last 24 h, and is not adjudicated. A hide path that reads the
// ad's OWN page as gone but writes no strike and no adjudication looks exactly like an accident to it.
// Measured 2026-11-05: dwelleo's owner-ordered follow-source path hid 4,789 rows at 03:08-04:09 UTC, each
// proven gone two ways (API 422 + page 404) with a GONE row in ops_stale_inactivation_probe; the 05:20 run
// switched all of them back on and 4,369 dead ads were served until 11:11. Migration 20261105110916 adds
// the clause: a GONE own-page reading inside the window, newer than the row's last ALIVE stamp, is the
// reason for the hide, not an accident.
//
// This judges the LAST committed definition (what production runs): the clause must read the evidence
// ledger, by id AND by ad_number (some oracles record only the ad number), and must compare the reading
// with last_verified_alive_at (so a later ALIVE stamp still recovers a row). Mutation-proven below.
//
//   node --experimental-strip-types scripts/verify-recovery-respects-own-page-gone.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations');
const DEF = /create\s+or\s+replace\s+function\s+public\.auto_recover_false_inactive\b/i;

export function problems(files: Record<string, string>): string[] {
  const defs = Object.keys(files).filter((f) => DEF.test(files[f])).sort();
  if (defs.length === 0) return ['no committed migration defines public.auto_recover_false_inactive'];
  const latest = defs[defs.length - 1];
  const sql = files[latest].replace(/^\s*--.*$/gm, '');
  const out: string[] = [];
  const need = (label: string, re: RegExp) => { if (!re.test(sql)) out.push(`${latest}: ${label}`); };
  need('the recovery predicate no longer reads the own-page evidence ledger', /not\s+exists\s*\(\s*select\s+1\s+from\s+public\.ops_stale_inactivation_probe/i);
  need('the evidence clause no longer requires a GONE verdict', /p\.verdict\s*=\s*''GONE''/i);
  need('the evidence clause no longer matches by listing id', /p\.listing_id\s*=\s*t\.id/i);
  need('the evidence clause no longer matches by ad_number (follow-source records only the ad number)', /p\.ad_number\s*=\s*t\.ad_number/i);
  need('a later ALIVE stamp no longer lets a row recover (reading must be newer than last_verified_alive_at)',
    /p\.probed_at\s*>=\s*coalesce\(\s*t\.last_verified_alive_at/i);
  need('the evidence clause is built but never spliced into the UPDATE', /%s\s*\$f\$\s*,\s*t\s*,\s*t\s*,\s*sib_clause\s*,\s*gone_clause/i);
  return out;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`);
  if (!ok) failed++;
};

const files: Record<string, string> = {};
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) files[f] = readFileSync(join(MIGRATIONS, f), 'utf8');
const real = problems(files);
check('auto_recover_false_inactive() honours a fresh own-page GONE reading', real.length === 0, real.join('; '));

// Mutations on the latest definition: each must turn the check red.
const latest = Object.keys(files).filter((f) => DEF.test(files[f])).sort().pop()!;
const mutate = (label: string, from: RegExp, to: string) => {
  const m = { ...files, [latest]: files[latest].replace(from, to) };
  check(`(mutation) catches ${label}`, m[latest] !== files[latest] && problems(m).length > 0);
};
mutate('the ledger clause removed', /public\.ops_stale_inactivation_probe/g, 'public.some_other_table');
mutate('the GONE verdict dropped', /p\.verdict = ''GONE''/g, 'true');
mutate('the alive-stamp comparison dropped', /p\.probed_at >= coalesce\(t\.last_verified_alive_at/g, 'true or (p.probed_at');
mutate('the clause never spliced in', /sib_clause, gone_clause\)/, 'sib_clause, \'\')');
check('(mutation) a newer redefinition without the clause is judged, not the old one',
  problems({ ...files, '29990101000000_x.sql': 'create or replace function public.auto_recover_false_inactive() returns void language sql as $$ select 1 $$;' }).length > 0);

if (failed) { console.log(`\n❌ verify-recovery-respects-own-page-gone: ${failed} failure(s)`); process.exit(1); }
console.log('\n✅ verify-recovery-respects-own-page-gone');
