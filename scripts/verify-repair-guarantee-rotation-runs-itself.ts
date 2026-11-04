// The repair-guarantee rotation runs itself, and it never claims more than it measured (2026-11-04).
//
// HOW THIS WAS EARNED (alerts 10003 repair_guarantee_stale, 12983/12984 repair enrollment). The registry promises
// permanent oldest-first re-verification, but its only writer of last_verified_at was routine #7, deleted with the
// other routines on 2026-09-27. Nothing replaced it: 120 of 215 entries went past the 30-day window and the stale alarm
// could never close. Migration *_repair_guarantee_rotation_runs_itself.sql adds ops_repair_guarantee_rotate() and
// calls it from the stale detector.
//
// The rotation must stay HONEST in four ways, and each loosening below must turn this red:
//   1. it stamps last_verified_at only when the watching detector RAN cleanly in the last 26 h (not crashed/skipped);
//   2. a detector whose kinds cannot be read, or that did not run, is 'undetermined' and is NOT stamped;
//   3. it never writes 'holds' (only a per-invariant evidence re-check earns that) and never overwrites 'violated';
//   4. the stale detector calls it inside an exception block that RAISES on failure (never a silent stale limb).
// This lifts the rotation's decision out of the committed SQL and EXECUTES a model of it on recorded cases.
//
//   node --experimental-strip-types scripts/verify-repair-guarantee-rotation-runs-itself.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_repair_guarantee_rotation_runs_itself\.sql$/.test(f)).sort().at(-1);
if (!file) { console.error('✗ migration *_repair_guarantee_rotation_runs_itself.sql is missing'); process.exit(1); }
const SQL = readFileSync(join(dir, file), 'utf8');
// The registry's own CHECK must admit both rotation verdicts, or the rotation fails on its first row (it did, 2026-11-04,
// and raised repair_guarantee_rotation_failed as designed). Every migration that redefines the check is read; the LAST wins.
const checkFile = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f))
  .filter((f) => /ops_repair_guarantee_registry_last_verdict_check\s+check\s*\(/i.test(readFileSync(join(dir, f), 'utf8'))).sort().at(-1);
const CHECK_SQL = checkFile ? readFileSync(join(dir, checkFile), 'utf8') : '';
const checkAdmits = (sql: string) => {
  const m = /add constraint ops_repair_guarantee_registry_last_verdict_check\s+check \(last_verdict = any \(array\[([\s\S]*?)\]\)\)/i.exec(sql);
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
};

type Case = { label: string; ran: boolean; crashed?: boolean; kinds: string[]; open: string[]; prev: string | null;
  want: { stamped: boolean; verdict: string | null } };

const CASES: Case[] = [
  { label: 'detector ran, nothing open (mon_detect_price_eq_area_or_ppm, 2026-11-04)', ran: true, kinds: ['price_eq_area_or_ppm'],
    open: [], prev: 'holds', want: { stamped: true, verdict: 'detector_clean' } },
  { label: 'detector ran, its kind has an open alert', ran: true, kinds: ['price_source_mismatch'], open: ['price_source_mismatch:aqar'],
    prev: null, want: { stamped: true, verdict: 'detector_raising' } },
  { label: 'a VIOLATED verdict is kept, never laundered to clean', ran: true, kinds: ['k'], open: [], prev: 'violated',
    want: { stamped: true, verdict: 'violated' } },
  { label: 'detector has not run in 26 h (mon_detect_price_fidelity shape) — undetermined, NOT stamped', ran: false, kinds: ['k'],
    open: [], prev: null, want: { stamped: false, verdict: null } },
  { label: 'detector crashed — undetermined, NOT stamped', ran: true, crashed: true, kinds: ['k'], open: [], prev: null,
    want: { stamped: false, verdict: null } },
  { label: 'no readable mon_raise kind (mon_detect_aqarmonthly_street_as_district shape) — NOT stamped', ran: true, kinds: [],
    open: [], prev: null, want: { stamped: false, verdict: null } },
];

function problems(sql: string): string[] {
  const out: string[] = [];
  const fn = /create or replace function public\.ops_repair_guarantee_rotate\(\)[\s\S]*?\$function\$;/.exec(sql)?.[0];
  if (!fn) return ['ops_repair_guarantee_rotate() is missing'];
  // the decision, lifted
  const ranNeedsClean = /d\.swept_at > now\(\) - interval '(\d+) hours'\s+and not d\.crashed and not d\.skipped/.exec(fn);
  if (!ranNeedsClean) out.push('a detector "ran" without requiring a clean (not crashed, not skipped) sweep');
  const windowH = ranNeedsClean ? Number(ranNeedsClean[1]) : 0;
  if (windowH > 26) out.push(`the "ran" window is ${windowH} h — wider than one gated daily run (26 h)`);
  const undeterminedGate = /if cardinality\(v_kinds\) = 0 or not v_ran then[\s\S]*?continue;\s*end if;/.exec(fn)?.[0] ?? '';
  if (!undeterminedGate) out.push('no undetermined branch for an unreadable or un-run detector');
  if (/last_verified_at/.test(undeterminedGate)) out.push('the undetermined branch stamps last_verified_at');
  if (/'holds'|'clean'|'ok'/.test(fn.replace(/'detector_clean'/g, ''))) out.push('the rotation writes an earned verdict (holds/clean/ok)');
  const keepsViolated = /last_verdict = case when rec\.last_verdict = 'violated' then 'violated' else v_verdict end/.test(fn);
  if (!keepsViolated) out.push('a violated verdict can be overwritten');
  if (!/coalesce\(r\.detector, ''\) <> ''/.test(fn)) out.push('the rotation visits repairs that have no detector');
  // the call site
  if (!/begin\\n'[\s\S]*?perform public\.ops_repair_guarantee_rotate\(\);[\s\S]*?exception when others then\\n'\s*\|\| E'    n := n \+ public\.mon_raise\(''P2'', ''repair_guarantee'', ''monitoring'', ''repair_guarantee_rotation_failed''/.test(sql)) {
    out.push('the stale detector does not call the rotation inside an exception block that raises');
  }
  if (!/raise exception 'mon_detect_repair_guarantee_stale: anchor not found exactly once/.test(sql)) out.push('the detector edit is not anchored fail-closed');

  // execute the model the SQL now states, on the recorded cases
  for (const c of CASES) {
    const ran = c.ran && !(c.crashed && !!ranNeedsClean);
    const undetermined = undeterminedGate ? (c.kinds.length === 0 || !ran) : false;
    const stamped = !undetermined || /last_verified_at/.test(undeterminedGate);
    const verdict = undetermined ? null : (keepsViolated && c.prev === 'violated') ? 'violated'
      : (c.open.length ? 'detector_raising' : 'detector_clean');
    if (stamped !== c.want.stamped || verdict !== c.want.verdict) {
      out.push(`${c.label}: stamped=${stamped} verdict=${verdict}, want ${JSON.stringify(c.want)}`);
    }
  }
  return out;
}

const admitted = checkAdmits(CHECK_SQL);
const checkProblems = (a: string[]) => ['detector_clean', 'detector_raising'].filter((v) => !a.includes(v))
  .map((v) => `the registry CHECK does not admit '${v}' (newest check: ${checkFile ?? 'none'})`);
const bad = [...problems(SQL), ...checkProblems(admitted)];
if (bad.length) { console.error('✗ repair-guarantee rotation:\n  ' + bad.join('\n  ')); process.exit(1); }

let missed = 0;
const mustCatch = (label: string, mutated: string) => {
  if (mutated === SQL) { console.error(`✗ mutation did not apply: ${label}`); missed++; return; }
  if (problems(mutated).length === 0) { console.error(`✗ mutation NOT caught: ${label}`); missed++; }
};
mustCatch('a crashed sweep counted as "ran"', SQL.replace('and not d.crashed and not d.skipped', 'and not d.skipped'));
mustCatch('a 30-day "ran" window', SQL.replace("d.swept_at > now() - interval '26 hours'", "d.swept_at > now() - interval '720 hours'"));
mustCatch('undetermined stamps last_verified_at', SQL.replace(
  "set last_detail = last_detail || jsonb_build_object('rotation', jsonb_build_object(\n               'at', now(), 'verdict', 'undetermined',",
  "set last_verified_at = now(), last_detail = last_detail || jsonb_build_object('rotation', jsonb_build_object(\n               'at', now(), 'verdict', 'undetermined',"));
mustCatch('the rotation writes holds', SQL.replace("else 'detector_clean' end;", "else 'holds' end;"));
mustCatch('violated laundered to clean', SQL.replace("last_verdict = case when rec.last_verdict = 'violated' then 'violated' else v_verdict end", 'last_verdict = v_verdict'));
mustCatch('the undetermined branch removed', SQL.replace('if cardinality(v_kinds) = 0 or not v_ran then', 'if false then'));
mustCatch('a rotation failure swallowed', SQL.replace("exception when others then\\n'", "exception when others then null;\\n'"));
mustCatch('repairs without a detector visited', SQL.replace("where coalesce(r.detector, '') <> ''", 'where true'));
if (checkProblems(checkAdmits(CHECK_SQL.replace(", 'detector_raising'", ''))).length === 0) { console.error('✗ mutation NOT caught: the CHECK dropping detector_raising'); missed++; }
if (missed) process.exit(1);

console.log(`✓ the repair-guarantee rotation stamps only what its detector measured, keeps violations, and raises on failure (${CASES.length} cases, 9 mutations caught)`);
