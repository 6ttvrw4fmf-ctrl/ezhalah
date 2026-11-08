// THE P0 FAST LANE MUST SURVIVE THE SWEEP'S ROW LOCKS (QA & Repair, 2026-10-06).
//
// DEFECT (cron.job_run_details): mon-p0-fast-lane (jobid 86) FAILED at 23:01 and 23:04 on 10-04,
// 02:01 on 10-06 and 9 more times on 10-04 with «canceling statement due to statement timeout …
// while updating tuple … in relation "alert_event"»; 40P01 deadlocks on 10-03/10-04. The sweep
// (jobid 38) runs every detector in ONE transaction for 7-12 min, so each alert_event row its
// mon_raise() touches stays locked until it commits. A lane detector reaching that row waited out
// the lane's 45s statement_timeout, and query_canceled is NOT caught by plpgsql `when others` —
// so the whole lane, P0 dispatch included, rolled back.
//
// THE FIX (migration 20261006132142): each lane detector runs under a short lock_timeout, a lock
// wait surfaces as lock_not_available (catchable), the lane continues to the dispatch, and the
// deferral is excused only while the sweep is the one running (otherwise it is reported as a
// crash, so the P1 «p0_lane_detector_unavailable» stays loud).
//
// WHAT THIS CHECKS: the NEWEST committed migration that (re)defines mon_run_p0_detectors() — the
// one production runs once applied — still carries every part of that fix. It is a hermetic
// check of committed SQL (no database), so it belongs in `npm test`; the mutation proofs at the
// bottom show that removing any one part turns it red.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(process.cwd(), 'supabase', 'migrations');
// Tag-generic body reader: reads the dollar tag after `as`, returns '' when it has no close.
function bodyOf(src: string, start: number): string {
  if (start < 0) return '';
  const m = /\bas\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/.exec(src.slice(start));
  if (!m) return '';
  const open = start + m.index + m[0].length;
  const close = src.indexOf(m[1], open);
  return close < 0 ? '' : src.slice(start, close);
}

const DEF = /create\s+or\s+replace\s+function\s+public\.mon_run_p0_detectors\s*\(\s*\)/i;

function newestDefinition(): { file: string; body: string } {
  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(join(MIG, files[i]), 'utf8');
    const m = DEF.exec(sql);
    if (!m) continue;
    const body = bodyOf(sql, m.index);
    if (!body) throw new Error(`${files[i]}: mon_run_p0_detectors() body has no closing dollar tag`);
    return { file: files[i], body };
  }
  throw new Error('no committed migration defines public.mon_run_p0_detectors()');
}

export function problems(body: string): string[] {
  const out: string[] = [];
  const setTimeout = body.search(/set_config\(\s*'lock_timeout'\s*,\s*'\d+(ms|s)'\s*,\s*true\s*\)/);
  const exec = body.search(/execute\s+format\(\s*'select public\.%I\(\)'/);
  if (setTimeout < 0) out.push('no per-detector lock_timeout (set_config(\'lock_timeout\', \'<n>s\', true))');
  else if (exec < 0 || setTimeout > exec) out.push('the lock_timeout is not set BEFORE the detector executes');
  const lna = body.search(/when\s+lock_not_available\s+then/i);
  const others = body.search(/when\s+others\s+then/i);
  if (lna < 0) out.push('no `when lock_not_available` handler: a lock wait kills the lane again');
  else if (others >= 0 && lna > others) out.push('`when lock_not_available` comes after `when others` and never fires');
  if (!/set_config\(\s*'lock_timeout'\s*,\s*v_lock_prev\s*,\s*true\s*\)/.test(body))
    out.push('the caller\'s lock_timeout is never restored (it would leak into mon_dispatch_p0_fast)');
  if (!/jobid\s*=\s*38\s+and\s+status\s*=\s*'running'/.test(body))
    out.push('a deferral is excused without checking that the sweep (jobid 38) is the one running');
  if (!/'deferred'\s*,\s*v_deferred/.test(body)) out.push('the return value does not report deferrals');
  return out;
}

const { file, body } = newestDefinition();
const found = problems(body);
let failed = false;
if (found.length) {
  failed = true;
  console.error(`❌ ${file}: mon_run_p0_detectors() lost its sweep-lock fix:\n  - ${found.join('\n  - ')}`);
} else {
  console.log(`✓ ${file}: the P0 lane defers on a sweep row lock instead of dying`);
}

// MUTATION PROOFS: each removal must be caught.
const mutations: Array<[string, (s: string) => string]> = [
  ['drop the per-detector lock_timeout', (s) => s.replace(/perform set_config\('lock_timeout', '2s', true\);/, '')],
  ['drop the lock_not_available handler', (s) => s.replace(/when lock_not_available then\s+v_deferred := v_deferred \|\| d;/, '')],
  ['move the handler after when others', (s) => s.replace(/(when lock_not_available then\s+v_deferred := v_deferred \|\| d;)\s+(when others then)/, '$2 null; $1')],
  ['never restore lock_timeout', (s) => s.replace(/set_config\('lock_timeout', v_lock_prev, true\)/g, "set_config('lock_timeout', '2s', true)")],
  ['excuse every deferral', (s) => s.replace(/jobid = 38 and status = 'running'/, 'true')],
  ['hide deferrals', (s) => s.replace(/'deferred', v_deferred/, "'x', 1")],
];
function mustCatch(name: string, mutated: string): void {
  if (mutated === body) {
    failed = true;
    console.error(`❌ mutation «${name}» did not apply — the proof is stale`);
  } else if (problems(mutated).length === 0) {
    failed = true;
    console.error(`❌ mutation «${name}» was NOT caught`);
  }
}
for (const [name, mutate] of mutations) mustCatch(name, mutate(body));
if (!failed) console.log(`✓ ${mutations.length}/${mutations.length} mutations caught`);

// THE SWEEP PROBE MUST SEE A SWEEP THAT ENDED DURING THE LANE (🔧 2026-11-08, migration 20261108141042).
// The probe above ran AFTER the detector loop, so a sweep that committed while the lane was still working read as
// «no sweep running» and a harmless deferral became a P1 (p0_lane_detector_unavailable: 7 raises in 7 days, every
// one a :04/:07 tick overlapping the last seconds of the hourly sweep). The lane now stamps v_t0 at entry and the
// probe also counts a sweep whose end_time >= v_t0. That fix is a PATCH (do $$ … replace() … execute) over the live
// body, so the newest *definition* above is not the live shape: this half reads the newest migration that touches
// mon_run_p0_detectors at all, and (a) requires the overlap-aware probe there, (b) refuses a later patch that puts
// the running-only probe back (its replacement text — the LAST probe spelling in the file — would be the old one).
const TOUCH = /mon_run_p0_detectors/;
const OLD_PROBE = /jobid\s*=\s*38\s+and\s+status\s*=\s*'+running'+\s*\)\s*into\s+v_sweep_on/g;
const NEW_PROBE = /status\s*=\s*'+running'+\s+or\s+end_time\s*>=\s*v_t0\s*\)\s*\)\s*into\s+v_sweep_on/g;
const STAMP = /v_t0\s+timestamptz\s*:=\s*clock_timestamp\(\)/;
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, '');
const lastIndex = (s: string, re: RegExp): number => { let i = -1; for (const m of s.matchAll(re)) i = m.index!; return i; };
export function probeProblems(sqlRaw: string): string[] {
  const sql = stripSqlComments(sqlRaw);
  const out: string[] = [];
  const newAt = lastIndex(sql, NEW_PROBE);
  const oldAt = lastIndex(sql, OLD_PROBE);
  if (newAt < 0) out.push('the newest touch of mon_run_p0_detectors has no overlap-aware sweep probe (status = running OR end_time >= v_t0)');
  if (!STAMP.test(sql)) out.push('no lane start stamp (v_t0 timestamptz := clock_timestamp())');
  if (oldAt > newAt) out.push('the LAST probe spelling in the file is the running-only one: a sweep that ends during the lane reads as absent again');
  return out;
}
function newestTouch(): { file: string; sql: string } {
  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(join(MIG, files[i]), 'utf8');
    if (TOUCH.test(stripSqlComments(sql))) return { file: files[i], sql };
  }
  throw new Error('no committed migration touches mon_run_p0_detectors');
}
const touch = newestTouch();
const probeFound = probeProblems(touch.sql);
if (probeFound.length) {
  failed = true;
  console.error(`❌ ${touch.file}: the lane's sweep probe is blind to a sweep that ended during the lane:\n  - ${probeFound.join('\n  - ')}`);
} else {
  console.log(`✓ ${touch.file}: the sweep probe counts a sweep that ended after the lane began`);
}
// Mutation proofs for this half.
{
  const fixIdx = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().findIndex((f) => f.startsWith('20261108141042'));
  if (fixIdx < 0) { failed = true; console.error('❌ the probe fix migration 20261108141042 is not committed'); }
  // (1) the pre-fix tree: the newest definition alone (the shape production ran until 2026-11-08) is caught.
  if (probeProblems(body).length === 0) { failed = true; console.error('❌ mutation «pre-fix definition» was NOT caught'); }
  // (2) today's patch with the overlap clause removed from its replacement text is caught.
  const noOverlap = touch.sql.replace(/\s*and \(status = ''running'' or end_time >= v_t0\)\)/, ' and status = \'\'running\'\')');
  if (noOverlap === touch.sql) { failed = true; console.error('❌ mutation «drop the overlap clause» did not apply — the proof is stale'); }
  else if (probeProblems(noOverlap).length === 0) { failed = true; console.error('❌ mutation «drop the overlap clause» was NOT caught'); }
  // (3) a later patch that reverts to the running-only probe (new spelling as anchor, old spelling as replacement) is caught.
  const revert = `do $$ declare d text; begin
  select pg_get_functiondef('public.mon_run_p0_detectors'::regproc) into d;
  d := replace(d, E'where jobid = 38 and start_time <= clock_timestamp()\\n and (status = ''running'' or end_time >= v_t0)) into v_sweep_on;',
                  E'where jobid = 38 and status = ''running'') into v_sweep_on;');
  execute d; end $$;`;
  if (probeProblems(revert).length === 0) { failed = true; console.error('❌ mutation «revert to the running-only probe» was NOT caught'); }
  if (!failed) console.log('✓ 3/3 probe mutations caught (pre-fix definition, dropped overlap clause, revert patch)');
}
process.exit(failed ? 1 : 0);
