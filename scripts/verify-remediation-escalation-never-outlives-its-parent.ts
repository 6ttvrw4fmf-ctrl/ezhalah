// A REMEDIATION ESCALATION MUST NOT OUTLIVE ITS PARENT CONDITION (QA & Repair, 2026-10-06).
//
// Measured that morning: 11 P0 `remediation_exhausted:dangling_scrape_run:*` alerts open since
// 2026-09-23 whose parent alerts had all been resolved by their own detector, with 0 dangling runs
// left. run_remediation() only resolved an escalation while looping over an OPEN parent, so once the
// parent closed by another path the P0 stayed open forever — eleven stale P0s hiding a real one.
// Migration 20261006135440 adds mon_resolve_orphaned_escalations() and calls it first in
// run_remediation(). This hermetic check pins, in the committed SQL, the three things that make it
// safe and effective, and proves each removal is caught.
//
//   node --experimental-strip-types scripts/verify-remediation-escalation-never-outlives-its-parent.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const sql = readFileSync(
  join(root, 'supabase/migrations/20261006135440_remediation_escalation_never_outlives_its_parent.sql'), 'utf8');

export function problems(s: string): string[] {
  const out: string[] = [];
  const start = s.indexOf('create or replace function public.mon_resolve_orphaned_escalations()');
  const fn = start >= 0 ? s.slice(start, s.indexOf('$function$;', start)) : '';
  if (!fn) { out.push('mon_resolve_orphaned_escalations() is not defined'); return out; }
  if (!/where e\.kind = 'remediation_exhausted'\s+and e\.resolved_at is null/.test(fn))
    out.push('the sweep no longer looks only at OPEN remediation_exhausted alerts');
  if (!/if not exists \(select 1 from public\.alert_event p\s+where p\.kind = r\.pkind and p\.dedup_key = r\.pkey and p\.resolved_at is null\) then/.test(fn))
    out.push('an escalation is resolved without proving its parent (same kind AND key) has no OPEN alert');
  if (!/perform public\.mon_resolve_key\('remediation_exhausted', r\.dedup_key\)/.test(fn))
    out.push('the sweep no longer resolves through mon_resolve_key');
  if (!/repl\s+text := E'begin\\n[^']*perform public\.mon_resolve_orphaned_escalations\(\);\\n  if not v_enabled then'/.test(s))
    out.push('run_remediation() no longer calls the sweep BEFORE its enabled check');
  if (!/length\(needle\) <> 1/.test(s)) out.push('the run_remediation edit is no longer occurrence-guarded');
  if (!/REGRESSION: an escalation whose parent is OPEN was resolved/.test(s) || !/FIX DID NOT TAKE: an orphaned escalation stayed open/.test(s))
    out.push('the apply-time proof no longer checks both directions');
  return out;
}

const fail = problems(sql);
const mutate = (label: string, m: string) => {
  if (m === sql) { fail.push(`mutation «${label}» did not apply (stale needle)`); return; }
  if (problems(m).length === 0) fail.push(`mutation NOT caught: ${label}`);
};
mutate('resolve every escalation regardless of parent', sql.replace(/if not exists \(select 1 from public\.alert_event p\s+where p\.kind = r\.pkind and p\.dedup_key = r\.pkey and p\.resolved_at is null\) then/, 'if true then'));
mutate('parent matched on key only, not kind', sql.replace('where p.kind = r.pkind and p.dedup_key = r.pkey', 'where p.dedup_key = r.pkey'));
mutate('closed escalations re-swept', sql.replace("where e.kind = 'remediation_exhausted'\n       and e.resolved_at is null", "where e.kind = 'remediation_exhausted'"));
mutate('sweep only when the worker is enabled', sql.replace("perform public.mon_resolve_orphaned_escalations();\\n  if not v_enabled then", "if not v_enabled then"));
mutate('edit not occurrence-guarded', sql.replace('length(needle) <> 1', 'length(needle) < 0'));

if (fail.length) {
  console.error('❌ remediation escalation outlives its parent:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log('✅ remediation escalation never outlives its parent: 6 invariants hold; 5 mutations caught');
