// A DETECTOR_CRASH ALERT MUST RESOLVE ONCE THE DETECTOR RUNS CLEAN AGAIN — AND ONLY THEN (QA, 2026-10-06).
//
// Measured: 3 P1 detector_crash alerts (40P01 deadlocks of 10-03/10-04) stayed open although each
// detector had run clean 34–61 times since: mon_run_all_detectors() raises a date-keyed alert and
// nothing ever resolved it. Migration 20261006135727 adds mon_resolve_recovered_detector_crashes()
// (called by run_remediation every 15 min). This hermetic check pins its two-sided rule in the
// committed SQL — >= 2 clean runs after the alert AND no crash after it — and proves each loosening
// is caught.
//
//   node --experimental-strip-types scripts/verify-detector-crash-resolves-after-clean-runs.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const sql = readFileSync(
  join(root, 'supabase/migrations/20261006135727_detector_crash_resolves_after_clean_runs.sql'), 'utf8');

// Tag-generic body reader: reads the dollar tag after `as`, returns '' when it has no close.
function bodyOf(src: string, start: number): string {
  if (start < 0) return '';
  const m = /\bas\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/.exec(src.slice(start));
  if (!m) return '';
  const open = start + m.index + m[0].length;
  const close = src.indexOf(m[1], open);
  return close < 0 ? '' : src.slice(start, close);
}

export function problems(s: string): string[] {
  const out: string[] = [];
  const start = s.indexOf('create or replace function public.mon_resolve_recovered_detector_crashes()');
  const fn = bodyOf(s, start);
  if (!fn) { out.push('mon_resolve_recovered_detector_crashes() is not defined'); return out; }
  if (!/where e\.kind = 'detector_crash'\s+and e\.resolved_at is null/.test(fn)) out.push('the sweep no longer looks only at OPEN detector_crash alerts');
  const clean = fn.match(/t\.swept_at > r\.created_at\s+and not coalesce\(t\.crashed, false\) and not coalesce\(t\.skipped, false\)\) >= (\d+)/);
  if (!clean) out.push('the clean-run count no longer requires runs AFTER the alert that neither crashed nor were skipped');
  else if (Number(clean[1]) < 2) out.push(`one lucky run is not recovery: the threshold is ${clean[1]}, must be >= 2`);
  if (!/and not exists \(select 1 from public\.ops_detector_timing t\s+where t\.detector = r\.det and t\.swept_at > r\.created_at\s+and coalesce\(t\.crashed, false\)\)/.test(fn))
    out.push('an alert can resolve although the detector crashed AGAIN after it');
  if (!/perform public\.mon_resolve_key\('detector_crash', r\.dedup_key\)/.test(fn)) out.push('the sweep no longer resolves through mon_resolve_key');
  if (!/repl\s+text := E'[^']*perform public\.mon_resolve_recovered_detector_crashes\(\);/.test(s)) out.push('run_remediation() no longer calls the sweep');
  if (!/length\(needle\) <> 1/.test(s)) out.push('the run_remediation edit is no longer occurrence-guarded');
  return out;
}

const fail = problems(sql);
const mustCatch = (label: string, m: string) => {
  if (m === sql) { fail.push(`mutation «${label}» did not apply (stale needle)`); return; }
  if (problems(m).length === 0) fail.push(`mutation NOT caught: ${label}`);
};
mustCatch('one clean run is enough', sql.replace('coalesce(t.skipped, false)) >= 2', 'coalesce(t.skipped, false)) >= 1'));
mustCatch('skipped runs count as clean', sql.replace(' and not coalesce(t.skipped, false)) >= 2', ') >= 2'));
mustCatch('a new crash no longer blocks', sql.replace(/\s+and not exists \(select 1 from public\.ops_detector_timing t\s+where t\.detector = r\.det and t\.swept_at > r\.created_at\s+and coalesce\(t\.crashed, false\)\)/, ''));
mustCatch('runs BEFORE the alert count', sql.replace('t.swept_at > r.created_at\n           and not coalesce', 't.swept_at > r.created_at - interval \'30 days\'\n           and not coalesce'));
mustCatch('run_remediation no longer calls it', sql.replace("E'  perform public.mon_resolve_orphaned_escalations();\\n  perform public.mon_resolve_recovered_detector_crashes();\\n'", "E'  perform public.mon_resolve_orphaned_escalations();\\n'"));

if (fail.length) {
  console.error('❌ detector_crash resolution:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log('✅ detector_crash resolves only after >= 2 clean runs and no new crash: 6 invariants; 5 mutations caught');
