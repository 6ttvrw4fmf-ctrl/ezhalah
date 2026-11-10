// A PACED RUN THAT FINISHED ITS WHOLE SLICE IS SLOW, NOT STALLED — AND THE DETECTOR SAYS WHICH.
//
// THE DEFECT THIS PINS (2026-11-09, alert_event 13962 run_duration_explosion:dealapp:10/24).
// `mon_run_duration_is_stall()` judges wall-clock × throughput. dealapp:10/24 ran 157 minutes at
// 15 rows/min — and its job log shows «…100 parsed/upserted» every 6-7 minutes from first line to
// last: 2,526 ids attempted, 2,394 upserted, end_run() reached, ok=true, 0 time-budget misses. Every
// page was an ORIGIN render paced at 9/min per IP by OriginBudget (the login-wall protection), because
// the CloudFront edge was cold for that slice; the night before the same shard took 4 minutes on edge
// hits. The detector called that a STALL, the shape whose response is "find the stuck page / fix the
// timeout" — and there was none to find.
//
// THE RULE. The discriminator is unchanged (seven canonical cases still gate every sweep). On top of
// it, `mon_run_duration_shape()` splits what is_stall() flags into 'stall' (dangling, ok<>true, rows
// collapsed below 75% of the platform median, or no rows baseline) and 'slow_complete' (finished,
// ok=true, >= 75% of median rows). The detector raises run_duration_explosion (P1) for the first and
// run_duration_slow_complete (P2) for the second, and resolves stale keys for BOTH kinds — so nothing
// is silenced, and the two shapes stop sharing one name. Judged on the latest committed definitions,
// code only, and proven by mutation.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const DETECTOR = 'mon_detect_run_duration_explosion';
const SHAPE = 'mon_run_duration_shape';

const codeOnly = (sql: string) => sql.replace(/^\s*--.*$/gm, '').replace(/\s--.*$/gm, '');

function latestDefining(files: Record<string, string>, fn: string): string | undefined {
  return Object.keys(files)
    .filter((f) => new RegExp(`function\\s+public\\.${fn}\\s*\\(`).test(files[f]))
    .sort().slice(-1)[0];
}

export function shapeProblems(files: Record<string, string>): string[] {
  const bad: string[] = [];
  const shapeFile = latestDefining(files, SHAPE);
  const detFile = latestDefining(files, DETECTOR);
  if (!shapeFile) bad.push(`no committed migration defines public.${SHAPE}()`);
  if (!detFile) bad.push(`no committed migration defines public.${DETECTOR}()`);
  if (!shapeFile || !detFile) return bad;

  // ── the shape function: never flags less than is_stall(), and slow_complete has all three legs ──
  const s = codeOnly(files[shapeFile]);
  const body = s.slice(s.indexOf(`function public.${SHAPE}(`));
  const need = (label: string, re: RegExp, text = body, file = shapeFile) => {
    if (!re.test(text)) bad.push(`${file}: ${label}`);
  };
  need('shape() must return null exactly when mon_run_duration_is_stall() is false (it can never flag less than the discriminator)',
    /when\s+not\s+public\.mon_run_duration_is_stall\s*\([^)]*\)\s+then\s+null/);
  need("'slow_complete' requires the run to have FINISHED", /p_finished\s+is\s+true[\s\S]{0,400}?'slow_complete'/);
  need("'slow_complete' requires ok = true", /p_ok\s+is\s+true[\s\S]{0,400}?'slow_complete'/);
  need("'slow_complete' requires >= 75% of the platform's median rows",
    /coalesce\(p_rows,\s*0\)\s*>=\s*0\.75\s*\*\s*p_med_rows[\s\S]{0,200}?'slow_complete'/);
  need("everything else is_stall() flags is 'stall'", /else\s+'stall'/);

  // ── the detector: uses shape(), raises both kinds, resolves both kinds, self-proves the split ──
  const d = codeOnly(files[detFile]);
  const det = d.slice(d.indexOf(`function public.${DETECTOR}(`));
  const needD = (label: string, re: RegExp) => { if (!re.test(det)) bad.push(`${detFile}: ${label}`); };
  needD('the detector does not call mon_run_duration_shape()', /public\.mon_run_duration_shape\s*\(/);
  needD("a 'stall' raises run_duration_explosion at P1", /'P1',\s*'run_duration_explosion'/);
  needD("a 'slow_complete' raises run_duration_slow_complete at P2", /'P2',\s*'run_duration_slow_complete'/);
  needD('stale run_duration_explosion keys are resolved', /mon_resolve_stale_keys\('run_duration_explosion'/);
  needD('stale run_duration_slow_complete keys are resolved (a kind nothing resolves is a stuck alert)',
    /mon_resolve_stale_keys\('run_duration_slow_complete'/);
  // The seven original discriminator cases survive.
  for (const c of ['134.0, 5.48,   0.0,  11.0', ' 89.5, 2.82,   0.0,  44.0', ' 51.0, 0.37,   0.0, 268.6',
                   '100.0, 0.40,  50.0,  null', '260.3, 0.37, 386.9, 268.6', '104.9, 0.42,  78.2, 175.7',
                   ' 10.0, 0.40,   0.0, 100.0']) {
    if (!det.includes(`mon_run_duration_is_stall(${c})`)) bad.push(`${detFile}: canonical is_stall case (${c.trim()}) is gone from the self-proof`);
  }
  // The split's own self-proof cases, executed on every sweep in production.
  needD('self-proof: the measured dealapp:10/24 run must read slow_complete',
    /mon_run_duration_shape\(156\.9,\s*30\.5,\s*15\.3,\s*77\.6,\s*true,\s*true,\s*2394,\s*2450\)\s+is distinct from\s+'slow_complete'/);
  needD('self-proof: a finished ok run whose rows collapsed must still read stall',
    /mon_run_duration_shape\(120\.0,\s*20\.0,\s*2\.5,\s*50\.0,\s*true,\s*true,\s*300,\s*1000\)\s+is distinct from\s+'stall'/);
  needD('self-proof: a dangling run must read stall',
    /mon_run_duration_shape\(134\.0,\s*5\.48,\s*0\.0,\s*11\.0,\s*false,\s*null,\s*0,\s*300\)\s+is distinct from\s+'stall'/);
  needD('self-proof: a healthy long job must stay null',
    /mon_run_duration_shape\(260\.3,\s*0\.37,\s*386\.9,\s*268\.6,\s*true,\s*true,\s*99999,\s*100\)\s+is not null/);
  return bad;
}

function load(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(MIGRATIONS)) if (f.endsWith('.sql')) out[f] = readFileSync(join(MIGRATIONS, f), 'utf8');
  return out;
}

const files = load();
const real = shapeProblems(files);
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
console.log('verify-run-duration-shape-separates-paced-from-stalled');
if (real.length) for (const p of real) fail(p); else ok('shape() and the detector carry the split, both kinds, both resolves, and the self-proof');

const shapeFile = latestDefining(files, SHAPE)!;
const detFile = latestDefining(files, DETECTOR)!;
const mustCatch = (what: string, file: string, mutate: (s: string) => string) => {
  if (!file) { fail(`MUTATION ${what}: no file`); return; }
  const mutated = mutate(files[file]);
  if (mutated === files[file]) { fail(`MUTATION ${what}: the mutation did not change the file (stale test)`); return; }
  const caught = shapeProblems({ ...files, [file]: mutated }).length > real.length;
  if (caught) ok(`MUTATION ${what} — caught`); else fail(`MUTATION ${what} — NOT caught`);
};
mustCatch('slow_complete no longer requires ok = true', shapeFile, (s) => s.replace(/and p_ok is true\s*\n/, '\n'));
mustCatch('slow_complete no longer requires the run to have finished', shapeFile, (s) => s.replace(/when p_finished is true and p_ok is true/, 'when p_ok is true'));
mustCatch('the 75% rows floor is lowered to 25%', shapeFile, (s) => s.replace('0.75 * p_med_rows', '0.25 * p_med_rows'));
mustCatch('shape() starts flagging less than is_stall()', shapeFile,
  (s) => s.replace(/when not public\.mon_run_duration_is_stall\(([^)]*)\) then null/, 'when $1 is null then null'));
mustCatch('the detector stops raising slow_complete (the shape is dropped on the floor)', detFile,
  (s) => s.replace(/'P2',\s*'run_duration_slow_complete'/, "'P2', 'run_duration_slow_complete_x'"));
mustCatch('the detector stops resolving stale slow_complete keys', detFile,
  (s) => s.replace("mon_resolve_stale_keys('run_duration_slow_complete'", "mon_resolve_stale_keys('run_duration_slow_complete_x'"));
mustCatch('the dealapp slow_complete self-proof case is deleted', detFile,
  (s) => s.replace(/\s*or mon_run_duration_shape\(156\.9[^\n]*\n/, '\n'));
mustCatch('a canonical is_stall case is deleted', detFile,
  (s) => s.replace(/\s*or not mon_run_duration_is_stall\( 51\.0, 0\.37,   0\.0, 268\.6\)[^\n]*\n/, '\n'));
{
  const later = '29991231000000_a_later_migration_redefines_the_detector.sql';
  const blind = `create or replace function public.${DETECTOR}() returns integer language plpgsql as $$ begin return 0; end $$;`;
  const caught = shapeProblems({ ...files, [later]: blind }).length > real.length;
  if (caught) ok('MUTATION a later migration redefines the detector without the split — caught');
  else fail('MUTATION a later migration redefines the detector without the split — NOT caught');
}
{
  const caught = shapeProblems({}).length > 0;
  if (caught) ok('no committed definition at all fails CLOSED'); else fail('no committed definition read as fine');
}

if (failures) {
  console.log(`\n❌ verify-run-duration-shape-separates-paced-from-stalled: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ verify-run-duration-shape-separates-paced-from-stalled: a paced, complete run is named for what it is.');
