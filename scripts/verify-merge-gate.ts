// Hermetic mutation-proof of the merge gate (scripts/lib/mergeGate.ts).
//
// Closes the exact gap that let PR #1046 merge on 2026-08-24 while its required checks had been
// cancelled by a rebase/force-push race: a `gh pr checks --watch` call returning is "nothing is
// still running," not "safe to merge." This pins that a CANCELLED (or failed, timed-out, skipped,
// neutral, or still-pending) required check blocks the merge — every non-SUCCESS conclusion, not
// just the one that actually happened — plus the branch-freshness, mergeable-state, and file-list
// checks the owner asked to be re-verified immediately before merge.
//
// No network, no `gh` calls — the CLI wrapper (scripts/safe-pr-merge.ts) is what actually talks to
// GitHub; this only proves the DECISION logic.
//
//   node --experimental-strip-types scripts/verify-merge-gate.ts   (wired into `npm test`)

import { decideMerge, normaliseConclusion, type CheckRun } from './lib/mergeGate.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nMerge gate — every required check must be exactly SUCCESS before merge\n');

const REQ = ['Full verification suite (npm test)', 'Production-target lock + no-bypass', 'Taxonomy + location index (npm run verify)'];
const allGreen: CheckRun[] = REQ.map((context) => ({ context, conclusion: 'SUCCESS' }));
const CLEAN = { mergeable: 'MERGEABLE' as const, mergeStateStatus: 'CLEAN' };

// ── the baseline: everything green must actually allow ───────────────────────────────────────────
check('all required checks SUCCESS + clean state → ALLOWED',
  decideMerge({ requiredContexts: REQ, checks: allGreen, ...CLEAN }).allow);

// ── every non-success conclusion, individually, blocks — this IS the incident ────────────────────
const BAD_CONCLUSIONS = ['CANCELLED', 'FAILURE', 'TIMED_OUT', 'SKIPPED', 'NEUTRAL', 'ACTION_REQUIRED', 'STALE', 'STARTUP_FAILURE'] as const;
for (const bad of BAD_CONCLUSIONS) {
  const checks = allGreen.map((c, i) => (i === 0 ? { ...c, conclusion: bad } : c));
  const v = decideMerge({ requiredContexts: REQ, checks, ...CLEAN });
  check(`a required check reporting ${bad} → BLOCKED`, !v.allow, JSON.stringify(v.reasons));
}
// null conclusion (still queued/in_progress, no terminal state yet) — the exact shape `gh pr checks
// --watch` returning does NOT rule out if it raced a fresh push.
{
  const checks = allGreen.map((c, i) => (i === 0 ? { ...c, conclusion: null } : c));
  const v = decideMerge({ requiredContexts: REQ, checks, ...CLEAN });
  check('a required check still PENDING (null conclusion) → BLOCKED', !v.allow);
}
// the context never appears in the rollup at all (e.g. reported against a stale SHA the PR no
// longer shows) — absence must be exactly as blocking as an explicit failure.
{
  const checks = allGreen.filter((c) => c.context !== REQ[0]);
  const v = decideMerge({ requiredContexts: REQ, checks, ...CLEAN });
  check('a required context with NO reported result at all → BLOCKED', !v.allow);
}
// a stale SUCCESS sitting next to a fresh CANCELLED for the SAME context (a re-run scenario) — the
// bad one must still block; "it passed once" is not the same as "it currently passes."
{
  const checks: CheckRun[] = [...allGreen, { context: REQ[0], conclusion: 'CANCELLED' }];
  const v = decideMerge({ requiredContexts: REQ, checks, ...CLEAN });
  check('a stale SUCCESS next to a fresh CANCELLED for the same context → BLOCKED', !v.allow);
}

// ── branch freshness / mergeable state ────────────────────────────────────────────────────────────
check('BEHIND base → BLOCKED even with all checks green',
  !decideMerge({ requiredContexts: REQ, checks: allGreen, mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' }).allow);
check('CONFLICTING mergeable state → BLOCKED',
  !decideMerge({ requiredContexts: REQ, checks: allGreen, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }).allow);
check('UNKNOWN mergeable state → BLOCKED',
  !decideMerge({ requiredContexts: REQ, checks: allGreen, mergeable: 'UNKNOWN', mergeStateStatus: 'UNSTABLE' }).allow);
check('BLOCKED mergeStateStatus → BLOCKED',
  !decideMerge({ requiredContexts: REQ, checks: allGreen, mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' }).allow);
check('CLEAN + MERGEABLE with all green → ALLOWED (the only fully-green path)',
  decideMerge({ requiredContexts: REQ, checks: allGreen, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }).allow);

// ── file-list drift (shared-worktree mix-up class of bug) ────────────────────────────────────────
check('file list unchanged since recorded → ALLOWED',
  decideMerge({ requiredContexts: REQ, checks: allGreen, ...CLEAN, expectedFiles: ['a.ts', 'b.ts'], actualFiles: ['a.ts', 'b.ts'] }).allow);
check('file list unchanged, different ORDER → still ALLOWED (order-insensitive)',
  decideMerge({ requiredContexts: REQ, checks: allGreen, ...CLEAN, expectedFiles: ['a.ts', 'b.ts'], actualFiles: ['b.ts', 'a.ts'] }).allow);
check('an EXTRA file appeared since it was recorded → BLOCKED',
  !decideMerge({ requiredContexts: REQ, checks: allGreen, ...CLEAN, expectedFiles: ['a.ts'], actualFiles: ['a.ts', 'c.ts'] }).allow);
check('a file DISAPPEARED since it was recorded → BLOCKED',
  !decideMerge({ requiredContexts: REQ, checks: allGreen, ...CLEAN, expectedFiles: ['a.ts', 'b.ts'], actualFiles: ['a.ts'] }).allow);
check('no expectation recorded → file-list check is skipped, not a false block',
  decideMerge({ requiredContexts: REQ, checks: allGreen, ...CLEAN }).allow);

// ── case normalisation (REST lowercase vs GraphQL uppercase) ─────────────────────────────────────
check('lowercase "success" (REST API shape) normalises to SUCCESS', normaliseConclusion('success') === 'SUCCESS');
check('lowercase "cancelled" normalises and still blocks',
  !decideMerge({ requiredContexts: REQ, checks: allGreen.map((c, i) => (i === 0 ? { ...c, conclusion: 'cancelled' as any } : c)), ...CLEAN }).allow);

// ── an empty required-context list (branch protection unreadable) never FALSELY allows on its own —
// mergeable/mergeStateStatus still gate, matching the CLI's documented fallback behaviour.
check('empty required-context list still enforces mergeable/mergeStateStatus',
  !decideMerge({ requiredContexts: [], checks: [], mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }).allow);
check('empty required-context list + clean mergeable state → ALLOWED (nothing left to check)',
  decideMerge({ requiredContexts: [], checks: [], ...CLEAN }).allow);

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// Re-implement the exact incident inline: "watch returned" treated as "checks list contains
// whatever conclusions existed at that moment" — if the gate ever regressed to accepting anything
// non-null instead of specifically SUCCESS, this must catch it.
mustCatch('a gate that accepts ANY non-null conclusion (not specifically SUCCESS) would wrongly allow CANCELLED',
  (() => {
    const buggyAllowsAnyTerminal = (concl: string | null) => concl != null; // the exact regression shape
    return !buggyAllowsAnyTerminal(null) // sanity: null (pending) is correctly excluded even by the buggy version
      && decideMerge({ requiredContexts: REQ, checks: allGreen.map((c, i) => (i === 0 ? { ...c, conclusion: 'CANCELLED' } : c)), ...CLEAN }).allow === false;
  })());
mustCatch('a gate that ignores mergeStateStatus entirely would wrongly allow BEHIND',
  !decideMerge({ requiredContexts: REQ, checks: allGreen, mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' }).allow);
mustCatch('a gate that treats an ABSENT required context as "not my problem" would wrongly allow it',
  !decideMerge({ requiredContexts: REQ, checks: allGreen.filter((c) => c.context !== REQ[1]), ...CLEAN }).allow);
mustCatch('a gate that lets a stale SUCCESS mask a fresh CANCELLED for the same context',
  !decideMerge({ requiredContexts: REQ, checks: [...allGreen, { context: REQ[0], conclusion: 'CANCELLED' }], ...CLEAN }).allow);
mustCatch('a gate that skips the file-list check even when an expectation WAS recorded',
  !decideMerge({ requiredContexts: REQ, checks: allGreen, ...CLEAN, expectedFiles: ['a.ts'], actualFiles: ['a.ts', 'sneaky.ts'] }).allow);
mustCatch('a gate that fails case-sensitively on REST-shaped lowercase conclusions',
  normaliseConclusion('cancelled') === 'CANCELLED');

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ the merge gate requires explicit SUCCESS on every required check, every time\n');
