// A ROW STILL INSIDE ITS STRIKE GRACE IS NOT A STUCK DEATH — AND A STUCK ONE MUST STILL RAISE.
//
// THE DEFECT THIS PINS (2026-11-10, alert_event 12977). `mon_detect_served_despite_direct_404()`
// raised a P1 for every served row whose latest direct reading was a 404, with no regard for
// strike grace. gathern answers 404 on the first strike, so a new cohort (72 rows that day, all
// verified alive the day before, all at 1-2 of 3 strikes) sat in the alert every day while the
// sweep re-read and retired the previous day's cohort about 13 hours after its first strike. The
// P1 had been open for six days and could not say when the chain really stopped.
//
// THE RULE (v7). Each flagged row gets `dead_since` = the first reading of its current unbroken
// run of dead readings, and `ops_direct_dead_class()` decides:
//   overdue  — the ledger reached a kill and the row is still served, OR the streak start is
//              unknown (fail closed), OR the row has read dead for more than 24 hours;
//   in_grace — otherwise.
// The alert raises when any row is overdue. This file pins the DANGEROUS direction, the one that
// would turn "tell the cases apart" into "silence": the window may not grow past 24 hours, a
// ledger kill and an unknown streak may not wait, only a LIVE reading may reset the streak, and
// the classifier must be fed the streak start (never the latest probe, which is always recent).
// Judged on the LATEST committed definitions, code only, and proven by mutation.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const DETECTOR = 'mon_detect_served_despite_direct_404';
const CLASSIFIER = 'ops_direct_dead_class';
const MAX_GRACE_HOURS = 24;

/** SQL with `--` comments removed, so prose can never be read as code. */
const codeOnly = (sql: string) => sql.replace(/^\s*--.*$/gm, '').replace(/\s--.*$/gm, '');

/** The body of the LAST committed `create or replace function public.<fn>(` … `$function$;`. */
function latestBody(files: Record<string, string>, fn: string): { file: string; body: string } | null {
  const defs = Object.keys(files)
    .filter((f) => new RegExp(`function\\s+public\\.${fn}\\s*\\(`).test(codeOnly(files[f])))
    .sort();
  if (defs.length === 0) return null;
  const file = defs[defs.length - 1];
  const sql = codeOnly(files[file]);
  const start = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`));
  if (start < 0) return null;
  // the dollar tag is READ, never assumed: no tag or no matching close means no body (fail closed)
  const tag = sql.slice(start).match(/\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
  if (!tag || tag.index === undefined) return null;
  const open = start + tag.index + tag[0].length;
  const close = sql.indexOf(tag[0], open);
  if (close < 0) return null;
  return { file, body: sql.slice(open, close) };
}

const hoursOf = (n: string, unit: string) => Number(n) * (/^day/.test(unit) ? 24 : /^min/.test(unit) ? 1 / 60 : 1);

/** One problem per broken guarantee. */
export function inGraceProblems(files: Record<string, string>): string[] {
  const bad: string[] = [];
  const cls = latestBody(files, CLASSIFIER);
  const det = latestBody(files, DETECTOR);
  if (!cls) bad.push(`no committed migration defines public.${CLASSIFIER}()`);
  if (!det) bad.push(`no committed migration defines public.${DETECTOR}()`);
  if (!cls || !det) return bad;

  // ── the classifier ────────────────────────────────────────────────────────────────────────
  const c = cls.body.replace(/\s+/g, ' ');
  if (!/when p_ledger_dead is true then 'overdue'/.test(c)) {
    bad.push(`${cls.file}: a ledger kill that is still served must be 'overdue' at once`);
  }
  if (!/when p_dead_since is null then 'overdue'/.test(c)) {
    bad.push(`${cls.file}: an unknown streak start must fail closed to 'overdue'`);
  }
  const windows = [...c.matchAll(/when p_dead_since <= p_now - interval '(\d+(?:\.\d+)?) (hours?|days?|minutes?)' then 'overdue'/g)];
  if (windows.length !== 1) {
    bad.push(`${cls.file}: expected exactly one "dead for longer than N" arm, found ${windows.length}`);
  } else if (hoursOf(windows[0][1], windows[0][2]) > MAX_GRACE_HOURS) {
    bad.push(`${cls.file}: the grace window is ${windows[0][1]} ${windows[0][2]} — it may not exceed ${MAX_GRACE_HOURS} hours`);
  }
  // nothing may classify in_grace before the overdue arms have had their say
  const firstInGrace = c.indexOf("'in_grace'");
  const lastOverdue = c.lastIndexOf("'overdue'");
  if (firstInGrace < 0) bad.push(`${cls.file}: the classifier never answers 'in_grace' (the split is gone)`);
  else if (firstInGrace < lastOverdue) bad.push(`${cls.file}: an 'in_grace' answer comes before an 'overdue' arm and can pre-empt it`);

  // ── the detector ──────────────────────────────────────────────────────────────────────────
  const d = det.body.replace(/\s+/g, ' ');
  // every call is compared to a label: capture everything up to the `) = '` that closes it
  const calls = [...d.matchAll(/ops_direct_dead_class\((.*?)\) = '/g)].map((m) => m[1].trim());
  if (calls.length !== (d.match(/ops_direct_dead_class\(/g) ?? []).length) {
    bad.push(`${det.file}: an ops_direct_dead_class() call is not compared to a label — it cannot be checked`);
  }
  if (calls.length === 0) {
    // a detector that does not classify at all raises on every row (v6): stricter, not a defect
  } else {
    for (const args of calls) {
      if (args !== 'f.ledger_dead, st.dead_since, now()') {
        bad.push(`${det.file}: ops_direct_dead_class(${args}) — it must be fed the streak start `
          + '(f.ledger_dead, st.dead_since, now()); the latest probe is always recent and would never be overdue');
      }
    }
    if (!/min\(q\.run_at\) as dead_since/.test(d)) {
      bad.push(`${det.file}: dead_since must be the FIRST reading of the dead streak (min(q.run_at))`);
    }
    if (!/where a\.http_status = 200 and a\.ledger_dead is not true/.test(d)) {
      bad.push(`${det.file}: only a LIVE reading (a 200 the ledger did not call dead) may reset the dead streak`);
    }
    if (!/\(la\.alive_at is null or q\.run_at > la\.alive_at\)/.test(d)) {
      bad.push(`${det.file}: the dead streak must start after the last live reading, not before it`);
    }
    if (!/having count\(\*\) filter \(where public\.ops_direct_dead_class\(f\.ledger_dead, st\.dead_since, now\(\)\) = 'overdue'\) > 0/.test(d)) {
      bad.push(`${det.file}: the raise must be gated on at least one 'overdue' row and on nothing else`);
    }
    if (!/'in_grace', r\.in_grace/.test(d) || !/'overdue', r\.overdue/.test(d)) {
      bad.push(`${det.file}: the alert detail must carry both counts (in_grace rows stay visible)`);
    }
  }
  return bad;
}

function load(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(MIGRATIONS)) {
    if (f.endsWith('.sql')) out[f] = readFileSync(join(MIGRATIONS, f), 'utf8');
  }
  return out;
}

const files = load();
const real = inGraceProblems(files);
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);

console.log('verify-served-despite-404-in-grace-is-not-stuck');
if (real.length) for (const p of real) fail(p);
else ok('the latest committed definitions keep a stuck row raising and the window at ≤ 24 hours');

// ── Mutation proofs ───────────────────────────────────────────────────────────────────────────
const clsFile = latestBody(files, CLASSIFIER)?.file ?? '';
const detFile = latestBody(files, DETECTOR)?.file ?? '';
const mustCatch = (what: string, file: string, mutate: (s: string) => string) => {
  if (!file) { fail(`MUTATION ${what}: nothing to mutate`); return; }
  const mutated = mutate(files[file]);
  if (mutated === files[file]) { fail(`MUTATION ${what}: the mutation did not change the file (stale test)`); return; }
  const caught = inGraceProblems({ ...files, [file]: mutated }).length > real.length;
  if (caught) ok(`MUTATION ${what} — caught`); else fail(`MUTATION ${what} — NOT caught`);
};
mustCatch('widen the window to 72 hours', clsFile,
  (s) => s.replace("when p_dead_since <= p_now - interval '24 hours' then 'overdue'", "when p_dead_since <= p_now - interval '72 hours' then 'overdue'"));
mustCatch('widen the window to 3 days', clsFile,
  (s) => s.replace("when p_dead_since <= p_now - interval '24 hours' then 'overdue'", "when p_dead_since <= p_now - interval '3 days' then 'overdue'"));
mustCatch('let a ledger kill wait in grace', clsFile,
  (s) => s.replace("    when p_ledger_dead is true then 'overdue'\n", ''));
mustCatch('read an unknown streak start as in_grace', clsFile,
  (s) => s.replace("when p_dead_since is null then 'overdue'", "when p_dead_since is null then 'in_grace'"));
mustCatch('feed the classifier the latest probe instead of the streak start', detFile,
  (s) => s.replaceAll('public.ops_direct_dead_class(f.ledger_dead, st.dead_since, now())', 'public.ops_direct_dead_class(f.ledger_dead, f.run_at, now())'));
mustCatch('take the LAST dead reading as the streak start', detFile,
  (s) => s.replace('min(q.run_at) as dead_since', 'max(q.run_at) as dead_since'));
mustCatch('let any non-dead probe (a 403, a timeout) reset the streak', detFile,
  (s) => s.replace('where a.http_status = 200 and a.ledger_dead is not true', 'where a.ledger_dead is not true'));
mustCatch('drop the in_grace count from the alert detail', detFile,
  (s) => s.replace("        'in_grace', r.in_grace,\n", ''));
{
  const later = '29991231000000_a_later_migration_widens_the_window.sql';
  const wide = `create or replace function public.${CLASSIFIER}(p_ledger_dead boolean, p_dead_since timestamptz, p_now timestamptz) `
    + "returns text language sql immutable as $function$ select case when p_ledger_dead is true then 'overdue' "
    + "when p_dead_since is null then 'overdue' when p_dead_since <= p_now - interval '7 days' then 'overdue' else 'in_grace' end $function$;";
  const caught = inGraceProblems({ ...files, [later]: wide }).length > real.length;
  if (caught) ok('MUTATION a later migration widens the window to 7 days — caught');
  else fail('MUTATION a later migration widens the window to 7 days — NOT caught');
}
{
  const caught = inGraceProblems({}).length > 0;
  if (caught) ok('no committed definition at all fails CLOSED'); else fail('no committed definition read as fine');
}
{
  const withProse = files[clsFile] + "\n-- old idea: when p_dead_since <= p_now - interval '72 hours' then 'overdue'\n";
  const still = inGraceProblems({ ...files, [clsFile]: withProse }).length;
  if (still === real.length) ok('prose quoting a wider window is ignored'); else fail('prose changed the verdict');
}

if (failures) {
  console.log(`\n❌ verify-served-despite-404-in-grace-is-not-stuck: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ verify-served-despite-404-in-grace-is-not-stuck: in-grace rows do not raise; stuck rows still do.');
