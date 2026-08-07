// Regression guard (2026-08-07) for the `refresh-loc-rel-signals` (jobid 22) outage.
//
// THE BUG THIS EXISTS TO PREVENT: `loc_rel_refresh_tick()` is a PROCEDURE containing internal
// `commit;` calls (added 2026-08-05 to fix a different head-of-line-blocking incident). A COMMIT
// inside a called procedure is only valid when the CALL is the SOLE top-level statement of its
// own transaction. On 2026-08-06 something combined the cron command into
//   set statement_timeout to '600s'; call loc_rel_refresh_tick()
// — two statements in one string, which Postgres wraps in an implicit transaction block, making
// the procedure's internal COMMIT invalid (error 2D000 "invalid transaction termination"). Every
// run failed from 2026-08-06 17:30 UTC onward, starving the entire location-relation refresh
// rotation. Fixed in supabase/migrations/20260807130000_fix_loc_rel_refresh_tick_transaction_control.sql
// by moving the timeout into the procedure body (`set local`) and reverting the cron command to
// the single bare statement `call public.loc_rel_refresh_tick()`.
//
// This guard scans every migration file for any `cron.alter_job` / `cron.schedule` call whose
// command string touches `loc_rel_refresh_tick` and fails if that command combines it with any
// other statement (a `;`-separated prefix like `set ...;`) — the exact anti-pattern that broke
// production. No network, no DB, fully deterministic — pure source-lint over supabase/migrations.
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}`);
  if (!cond) failures++;
};

console.log('verify-loc-rel-tick-single-statement-cron: loc_rel_refresh_tick must be the sole');
console.log('  top-level statement of any cron command that invokes it (its body COMMITs).');

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

// Find every command string passed to cron.alter_job(...) or cron.schedule(...) that mentions
// loc_rel_refresh_tick, across all migrations (chronological order doesn't matter — the LATEST
// state is what matters, and every mention must independently satisfy the invariant so an old
// migration can never be "the broken one that still matches" if replayed standalone).
const CALL_RE = /\bcall\s+(?:public\.)?loc_rel_refresh_tick\s*\(\s*\)/i;
let mentions = 0;

for (const file of files) {
  const body = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
  if (!CALL_RE.test(body)) continue;

  // Pull out command strings: either a $$ ... $$ / $tag$ ... $tag$ dollar-quoted body, or a plain
  // '...' quoted string, passed as an argument to cron.alter_job/cron.schedule.
  const cmdRe = /cron\.(?:alter_job|schedule)\s*\([\s\S]{0,400}?(\$[a-zA-Z]*\$([\s\S]*?)\$[a-zA-Z]*\$|'((?:[^']|'')*)')/g;
  let m: RegExpExecArray | null;
  while ((m = cmdRe.exec(body)) !== null) {
    const cmd = (m[2] ?? m[3] ?? '').trim();
    if (!CALL_RE.test(cmd)) continue; // this particular arg isn't the command mentioning the call
    mentions++;

    // Strip a trailing semicolon, then split on ';' — the command must be ONLY the CALL, nothing else.
    const statements = cmd
      .replace(/;\s*$/, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);

    check(
      `${file}: command is the sole statement (found: ${JSON.stringify(cmd)})`,
      statements.length === 1 && CALL_RE.test(statements[0]),
    );
  }
}

check('at least one cron command mentioning loc_rel_refresh_tick was found and checked', mentions > 0);

// The procedure body must keep re-asserting its own statement_timeout via SET LOCAL (the safe
// place for it) rather than relying on the cron command to set it (the unsafe place, per above).
const latestProcDef = files
  .filter((f) => {
    const body = readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8');
    return /create\s+or\s+replace\s+procedure\s+public\.loc_rel_refresh_tick/i.test(body);
  })
  .sort() // filenames are date-prefixed, so lexical sort is chronological
  .pop();

check('a CREATE OR REPLACE PROCEDURE loc_rel_refresh_tick migration exists', !!latestProcDef);
if (latestProcDef) {
  const body = readFileSync(`${MIGRATIONS_DIR}/${latestProcDef}`, 'utf8');
  check(
    `${latestProcDef}: procedure body sets its own statement_timeout via SET LOCAL`,
    /set\s+local\s+statement_timeout/i.test(body),
  );
}

console.log('');
if (failures > 0) {
  console.error(`❌ verify-loc-rel-tick-single-statement-cron: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ verify-loc-rel-tick-single-statement-cron: all checks passed.');
