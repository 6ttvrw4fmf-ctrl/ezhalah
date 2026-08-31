// A platform that can deactivate listings must be able to say why it deactivated each one.
//
// THE INCIDENT. On 2026-08-30 aqar deactivated 13,139 listings between 01:00 and 03:00, against a
// 20-day baseline of 250-650/day. The mechanism was sound — every row was at full grace (three
// consecutive DIRECT dead readings) and the sweeps were healthy (transient 0-18 per shard) — and
// the destructive cleanup gate separately did its job, ABORTING at 4,921 candidates rather than
// deleting anything.
//
// None of that could be shown. gathern had gathern_liveness_detail and wasalt had
// wasalt_liveness_pilot_detail, but aqar — 90,178 active rows, our largest platform, ~97k probes a
// day — had no per-row record at all. The run notes said `killed=1251`; nothing said WHICH rows, or
// what the source returned for each. The question "why did these 13,000 disappear" had no answer
// that went below an aggregate.
//
// So the rule: if a platform's strategy lets it remove inventory, it logs the readings that moved
// each row toward removal. This check fails when a DIRECT_REVISIT or CANDIDATE_PLUS_DIRECT platform
// has a liveness runner that can deactivate but no audit trail behind it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const JSON_MIRROR = join(ROOT, 'sql', 'mirrors', 'liveness_registry.json');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-liveness-has-audit-trail: a platform that can remove inventory must say why.');

type Row = { platform: string; strategy: string };
const registry: Row[] = JSON.parse(readFileSync(JSON_MIRROR, 'utf8'));
const removers = registry.filter((r) => r.strategy !== 'CRAWL_PRESENCE_ONLY');
check('the registry names at least one removing platform', removers.length > 0);

// Each removing platform's runner must write a per-row detail record. The table names differ by
// platform for historical reasons (gathern_liveness_detail, wasalt_liveness_pilot_detail,
// aqar_liveness_detail), so match on the shape rather than one hardcoded name.
const DETAIL_HINT = /_liveness(_pilot)?_detail/;

for (const { platform } of removers) {
  const candidates = ['liveness.py', 'liveness_run.py']
    .map((f) => join(ROOT, 'scrapers', platform, f))
    .filter((f) => existsSync(f));
  check(`${platform} has a liveness runner`, candidates.length > 0);
  if (candidates.length === 0) continue;

  const src = candidates.map((f) => readFileSync(f, 'utf8')).join('\n');

  // Only a runner that can actually deactivate needs the trail. dealapp writes `active: False`
  // through the contract; aqar/gathern/wasalt each set it directly.
  // Match every way this repo actually writes the flag. The first draft of this check tested only
  // the dict-literal form and so declared aqar "does not deactivate" — the one platform whose
  // 13,139 removals prompted the check. A barrier that misses its own motivating case is worse
  // than none, because it reports success.
  const canDeactivate = /["']active["']\s*:\s*False/.test(src)          // {"active": False}
    || /\[["']active["']\]\s*=\s*False/.test(src)                      // upd["active"] = False
    || /action == "deactivate"/.test(src);                              // via the contract
  if (!canDeactivate) {
    check(`${platform} runner does not deactivate (no trail required)`, true);
    continue;
  }

  check(`${platform} records per-row liveness readings`, DETAIL_HINT.test(src),
    `its runner can set active=false but writes to no *_liveness_detail table. An aggregate ` +
    `"killed=N" in the run notes cannot answer "why was THIS row removed" — which is exactly ` +
    `what 13,139 aqar deactivations on 2026-08-30 could not be asked.`);

  // Naming the table is not using it. The first draft checked only that the table name appeared
  // somewhere in the file, which the flush helper satisfies on its own — so deleting the logging
  // from the kill path itself left this green. The REMOVAL path specifically must record.
  // Each platform has its own death vocabulary — aqar 'kill', gathern 'dead_confirmed', wasalt
  // 'dead', dealapp 'kill' — so match the CONCEPT. Requiring one literal would have failed wasalt,
  // which logs one row per confirm decision and simply calls it 'dead'.
  check(`${platform} records the removal itself, not just the plumbing`,
    /["'](kill|dead|dead_confirmed|deactivate)["']/.test(src),
    'the detail table is referenced but no death verdict is ever recorded — the one reading this ' +
    'trail exists to explain is the one going unlogged');
}

// A runner writing to a table with no committed migration logs into nothing, and the failure is
// silent because the insert is deliberately non-fatal. So each trail needs a committed source.
const migs = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
const findMig = (table: string) => migs.find((f) =>
  readFileSync(join(MIGRATIONS, f), 'utf8').includes(`create table if not exists public.${table}`));

// The unusable-read verdict is named differently per platform on purpose: on aqar it is a rare
// transient, on dealapp it is the dominant outcome and the open question.
const TRAILS: Array<{ table: string; unusable: string }> = [
  { table: 'aqar_liveness_detail', unusable: 'transient' },
  { table: 'dealapp_liveness_detail', unusable: 'unknown' },
];

for (const { table, unusable } of TRAILS) {
  const mig = findMig(table);
  check(`${table} is created by a committed migration`, Boolean(mig),
    'the runner would insert into a table with no committed source (migration drift), and the ' +
    'insert is non-fatal by design so nothing would notice');
  if (!mig) continue;
  const sql = readFileSync(join(MIGRATIONS, mig), 'utf8');
  for (const col of ['http_status', 'verdict', 'missing_count_before', 'missing_count_after']) {
    check(`${table} records ${col}`, sql.includes(col),
      'without it the record cannot reconstruct the decision');
  }
  check(`${table} constrains its verdict set`, /check \(verdict in \(/.test(sql),
    'an unconstrained verdict column lets a future writer log anything and still look logged');
  check(`${table} records "${unusable}" rather than skipping an unusable read`,
    sql.includes(`'${unusable}'`),
    'a read we could not believe is the one thing that must never be mistaken for a death later');
}

// The logging must never be able to change or block a verdict — it is a record OF the decision.
for (const [platform, file] of [['aqar', 'liveness.py'], ['dealapp', 'liveness_run.py']] as const) {
  const src = readFileSync(join(ROOT, 'scrapers', platform, file), 'utf8');
  check(`${platform}: a failed audit insert cannot abort the sweep`,
    /liveness detail insert failed \(non-fatal/.test(src),
    'the audit is a record of the decision, never part of making it — a logging failure must not ' +
    'change what the sweep does to a listing');
  check(`${platform}: the audit is flushed at the end of a run, not only mid-batch`,
    /_flush_detail\(\)\s*#.*survive the run/.test(src),
    'without a final flush the last partial batch — including the last kills — is lost');
}

check('this barrier is discovered and run by npm test',
  npmTestRuns(ROOT, 'verify-liveness-has-audit-trail'));

console.log(
  failures === 0
    ? '\n✅ verify-liveness-has-audit-trail: all checks passed.'
    : `\n❌ verify-liveness-has-audit-trail: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
