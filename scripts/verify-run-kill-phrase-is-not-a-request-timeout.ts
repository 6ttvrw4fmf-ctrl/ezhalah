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
import { replayFunction } from './lib/rpcReplay.ts';
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

// The effective body after replaying every committed definition — the same rule production follows,
// read through the shared tag-generic reader (never a hardcoded dollar tag).
const fail: string[] = [];
const fn = replayFunction(dir, 'mon_note_is_run_kill');
const fnFile = fn.touchedBy[fn.touchedBy.length - 1] ?? '(none)';
if (!fn.body || fn.unresolved.length) fail.push(`mon_note_is_run_kill() is not readable from committed migrations (unresolved: ${fn.unresolved.join(', ') || 'never defined'})`);
else {
  const m = fn.body.match(/p_notes\s*~\*\s*'([^']+)'/);
  if (!m) fail.push(`${fnFile}: could not read the phrase list out of mon_note_is_run_kill()`);
  else fail.push(...problems(m[1]).map((p) => `${fnFile}: ${p}`));
}
const det = replayFunction(dir, 'mon_detect_run_killed_by_timeout');
const detFile = det.touchedBy[det.touchedBy.length - 1] ?? '(none)';
if (!det.body || det.unresolved.length) fail.push(`mon_detect_run_killed_by_timeout() is not readable from committed migrations (unresolved: ${det.unresolved.join(', ') || 'never defined'})`);
else {
  if (!/and public\.mon_note_is_run_kill\(notes\)/.test(det.body))
    fail.push(`${detFile}: the detector no longer decides through mon_note_is_run_kill(notes)`);
  if (/notes\s*~\*/.test(det.body))
    fail.push(`${detFile}: the detector carries its own second phrase list (notes ~* …)`);
}

// Mutation proof: each broken phrase list must be caught by the same predicate the real list passes.
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) fail.push(`MUTATION NOT CAUGHT: ${label}`);
};
const OLD = 'SIGINT|SIGKILL|timed out|timeout-minutes|operation was canceled|was cancelled|killed by';
mustCatch('the pre-fix list reads a quoted request timeout as a kill',
  problems(OLD).some((x) => x.includes('40002')));
mustCatch('the pre-fix list does not see «runner lost»',
  problems(OLD).some((x) => x.includes('runner lost')));
mustCatch('bare «killed» reads the healthy metric killed=0 as a kill',
  problems('SIGINT|killed').some((x) => x.includes('killed=0')));

if (fail.length) {
  console.error('✗ run-kill phrase guard:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log(`✓ run-kill phrases: ${KILLS.length} real kill notes seen, ${NOT_KILLS.length} non-kills ignored; old list and bare «killed» both caught (${fnFile})`);
