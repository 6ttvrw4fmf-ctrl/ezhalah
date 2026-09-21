// THE REMEDIATION LOOP MUST VERIFY BEFORE IT CLOSES, ESCALATE WHEN IT CANNOT FIX, AND BE GUARDED.
//
// WHY THIS EXISTS (owner mandate, 2026-09-21). The auto-remediation worker run_remediation() closes
// alerts. The single most dangerous regression it could take is closing an alert because a fix
// COMMAND RAN, without re-checking that the production condition actually cleared — that would mark
// real problems "fixed" while they persist. This barrier pins the safety invariants of the loop:
//   1. an alert is resolved ONLY on a verified condition (mon_resolve_key gated on the verify result);
//   2. a fix that keeps failing ESCALATES (remediation_exhausted) instead of retrying forever;
//   3. the worker has a kill switch and a per-run cap (guardrails);
//   4. each fix runs in its own subtransaction (a failure cannot half-apply or abort the sweep);
//   5. the escalation + worker-liveness kinds are ROUTED to an owner;
//   6. the deterministic chain self-test exists (its live run proves both success and failure paths).
//
//   node --experimental-strip-types scripts/verify-remediation-loop-is-verified-and-guarded.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const FW = 'supabase/migrations/20260921183000_remediation_loop_autofix_verify_escalate.sql';
const ST = 'supabase/migrations/20260921183500_remediation_loop_selftest_chain.sql';
const ROUTING = 'scripts/lib/alertRouting.ts';

const ok: string[] = [];
const problems: string[] = [];
const check = (cond: boolean, pass: string, fail: string) => cond ? ok.push(pass) : problems.push(fail);

const fw = readFileSync(join(ROOT, FW), 'utf8');
const st = readFileSync(join(ROOT, ST), 'utf8');
const routing = readFileSync(join(ROOT, ROUTING), 'utf8');

// isolate the worker body
const wStart = fw.indexOf('create or replace function public.run_remediation');
const wEnd = fw.indexOf('$fn$;', wStart);
const worker = wStart >= 0 ? fw.slice(wStart, wEnd) : '';
check(worker.length > 0, 'run_remediation() is defined', 'run_remediation() not found — wrong file or renamed');

// ── 1. Resolve is GATED on verification. ──────────────────────────────────────────────────────
// The resolve call must sit under the verified branch; a bare resolve after the fix is the defect.
const verifyGatesResolve =
  /if\s+coalesce\(v_verified,\s*false\)\s+then\s+perform public\.mon_resolve_key/s.test(worker);
check(verifyGatesResolve,
  'an alert is resolved ONLY inside the verified branch',
  'DANGER: mon_resolve_key is not gated on the verify result — the loop could close a real problem ' +
  'because a fix ran, without re-checking production. This is the exact regression this barrier exists for.');

// verify is actually executed (not just declared)
check(/execute format\('select public\.%I\(\$1,\$2\)', pol\.verify_fn\)\s+into v_verified/.test(worker),
  'the worker executes verify_fn and captures its result',
  'the worker no longer runs verify_fn — "fix executed" would be treated as success');

// ── 2. Escalation on repeated failure (not endless ret/spam). ─────────────────────────────────
check(/mon_raise\('P0', 'remediation_exhausted'/.test(worker),
  'a fix that reaches its attempt limit escalates to remediation_exhausted (P0)',
  'ESCALATION LOST: run_remediation no longer raises remediation_exhausted — a fix could fail forever silently');
check(/v_attempts_today\s*>=\s*pol\.max_attempts/.test(worker) && /make_interval\(mins => pol\.cooldown_minutes\)/.test(worker),
  'the worker enforces max_attempts and a per-alert cooldown',
  'the attempt cap or cooldown is gone — the worker could hammer a failing fix');

// ── 3. Guardrails: kill switch + global cap. ──────────────────────────────────────────────────
check(/remediation_enabled/.test(worker) && /if not v_enabled then/.test(worker),
  'the worker has a kill switch (mon_config.remediation_enabled)',
  'the kill switch is gone — auto-fixing cannot be paused without code');
check(/remediation_max_fixes_per_run/.test(worker) && /v_attempted >= v_cap/.test(worker),
  'the worker enforces a global per-run fix cap',
  'the per-run cap is gone — a bad registration could storm production');

// ── 4. Each fix runs in its own subtransaction. ───────────────────────────────────────────────
check(/begin\s+execute format\('select public\.%I\(\$1,\$2\)', pol\.fix_fn\)[\s\S]*?exception when others then/.test(worker),
  'each fix runs in its own subtransaction (begin/exception)',
  'a fix is no longer wrapped — one failing fix could abort the whole sweep or half-apply');

// ── 5. The new kinds are routed to an owner. ──────────────────────────────────────────────────
check(/\{\s*routine:\s*7,\s*test:\s*\/\^remediation_\/\s*\}/.test(routing),
  'remediation_* alerts are routed to an owning routine (7-seam)',
  'remediation_exhausted / remediation_worker_stale are unrouted — an escalation nobody owns');

// ── 6. The chain self-test exists (its live run is the execution proof). ──────────────────────
check(/create or replace function public\.mon_selftest_remediation_chain/.test(st) &&
      /ROLLBACK_SELFTEST/.test(st),
  'the deterministic chain self-test exists and rolls back (zero residue)',
  'the chain self-test is missing — the fix→verify→close and fix-fails→escalate paths are unproven');

check(npmTestRuns(ROOT, 'verify-remediation-loop-is-verified-and-guarded'),
  'npm test runs this guard', '`npm test` no longer runs this guard');

// ── Mutation proofs ───────────────────────────────────────────────────────────────────────────
const mutations: string[] = [];
const mustCatch = (what: string, wouldFail: boolean) =>
  wouldFail ? mutations.push(what) : problems.push(`MUTATION SURVIVED: ${what} would NOT be caught`);

mustCatch('resolve moved out from under the verify gate (close-without-verify)',
  !/if\s+coalesce\(v_verified,\s*false\)\s+then\s+perform public\.mon_resolve_key/s.test(
    worker.replace(/if\s+coalesce\(v_verified,\s*false\)\s+then\s+perform public\.mon_resolve_key/s,
                   'perform public.mon_resolve_key')));
mustCatch('remediation_exhausted escalation removed',
  !/mon_raise\('P0', 'remediation_exhausted'/.test(worker.replace(/remediation_exhausted/g, 'x')));
mustCatch('kill switch removed',
  !/if not v_enabled then/.test(worker.replace(/if not v_enabled then/g, 'if false then')));

console.log('remediation-loop-is-verified-and-guarded: verify before close, escalate on failure, stay guarded\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const m of mutations) console.log(`  ✓ mutation caught: ${m}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the remediation loop's safety invariants have regressed.`);
  process.exit(1);
}
console.log(`\n✅ remediation-loop-is-verified-and-guarded: passed (${ok.length} checks, ${mutations.length} mutations).`);
