// PERMANENT BARRIER — a request that timed out is not a run that was killed (2026-11-10).
//
// THE INCIDENT. mon_detect_run_killed_by_timeout() matched scrape_runs.notes against a phrase list
// that included the bare words «timed out». curl prints those same words for ONE slow request, and
// scrapers quote that error in their notes. So a P1 "run killed by timeout" stood open on
// fleet_liveness for ok=true, 3-4 minute runs whose note only said one probe's connection «timed out
// after 40002 milliseconds» — while the note the gathern sweep writes when a GitHub runner really
// vanishes («runner lost — …») matched nothing at all.
//
// WHAT IS ASSERTED, BY EXECUTION. The phrase list is lifted out of the LATEST committed migration
// that defines public.mon_note_is_run_kill() and run against real production notes: every end-state
// note our own code writes must read as a kill; a quoted request timeout and the healthy metric
// «killed=0» must not. The detector must decide through that function and nothing else.
//
// MUTATION PROOF (in-file): the pre-fix list (with bare «timed out», without «runner lost») is run
// through the same cases and must FAIL them — a guard that passes the old list guards nothing.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const KILLS = [
  'killed by SIGINT before end_run() — CI job most likely hit its timeout-minutes',
  'killed by SIGTERM before end_run()',
  'orphaned — presumed killed (SIGKILL/OOM/lost runner): no end_run() after 12h',
  'runner lost — GitHub run 42602133546 finished without end_run(); closed by the next sweep',
  'The operation was canceled.',
];
const NOT_KILLS = [
  'QUARANTINED 1 (kept, not applied): Failed to connect: Connection timed out after 40002 milliseconds',
  'Failed to perform, curl: (28) Operation timed out after 45002 milliseconds with 0 bytes received.',
  'scanned=1500 alive=1490 killed=0 pruned=0 complete=True',
  'list page 9 gave no response in 4 tries: curl: (28) Operation timed out',
  '',
];

export function problems(pattern: string): string[] {
  const re = new RegExp(pattern, 'i');
  const out: string[] = [];
  for (const k of KILLS) if (!re.test(k)) out.push(`a real kill note is NOT seen: «${k}»`);
  for (const n of NOT_KILLS) if (re.test(n)) out.push(`a note that is not a kill reads as one: «${n}»`);
  return out;
}

// The latest migration that (re)defines each function wins — the same rule production follows.
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const latest = (needle: RegExp): { file: string; sql: string } | null => {
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(join(dir, files[i]), 'utf8');
    if (needle.test(sql)) return { file: files[i], sql };
  }
  return null;
};

const FN = /create or replace function public\.mon_note_is_run_kill\s*\(/i;
const DET = /create or replace function public\.mon_detect_run_killed_by_timeout\s*\(/i;
const fail: string[] = [];
const fn = latest(FN);
if (!fn) fail.push('no committed migration defines public.mon_note_is_run_kill()');
else {
  const m = fn.sql.slice(fn.sql.search(FN)).match(/p_notes\s*~\*\s*'([^']+)'/);
  if (!m) fail.push(`${fn.file}: could not read the phrase list out of mon_note_is_run_kill()`);
  else fail.push(...problems(m[1]).map((p) => `${fn.file}: ${p}`));
}
const det = latest(DET);
if (!det) fail.push('no committed migration defines mon_detect_run_killed_by_timeout()');
else {
  const body = det.sql.slice(det.sql.search(DET)).split('$function$;')[0];
  if (!/and public\.mon_note_is_run_kill\(notes\)/.test(body))
    fail.push(`${det.file}: the detector no longer decides through mon_note_is_run_kill(notes)`);
  if (/notes\s*~\*/.test(body))
    fail.push(`${det.file}: the detector carries its own second phrase list (notes ~* …)`);
}

// Mutation proof: the list as it was before the fix must be caught, in both directions.
const OLD = 'SIGINT|SIGKILL|timed out|timeout-minutes|operation was canceled|was cancelled|killed by';
const oldProblems = problems(OLD);
if (!oldProblems.some((p) => p.includes('40002')) || !oldProblems.some((p) => p.includes('runner lost')))
  fail.push('MUTATION NOT CAUGHT: the pre-fix phrase list passes this guard');
if (!problems('SIGINT|killed').some((p) => p.includes('killed=0')))
  fail.push('MUTATION NOT CAUGHT: bare «killed» (which matches the healthy metric killed=0) passes');

if (fail.length) {
  console.error('✗ run-kill phrase guard:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log(`✓ run-kill phrases: ${KILLS.length} real kill notes seen, ${NOT_KILLS.length} non-kills ignored; old list and bare «killed» both caught (${fn!.file})`);
