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
process.exit(failed ? 1 : 0);
