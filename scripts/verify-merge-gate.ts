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
  decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, ...CLEAN }).allow);

// ── every non-success conclusion, individually, blocks — this IS the incident ────────────────────
const BAD_CONCLUSIONS = ['CANCELLED', 'FAILURE', 'TIMED_OUT', 'SKIPPED', 'NEUTRAL', 'ACTION_REQUIRED', 'STALE', 'STARTUP_FAILURE'] as const;
for (const bad of BAD_CONCLUSIONS) {
  const checks = allGreen.map((c, i) => (i === 0 ? { ...c, conclusion: bad } : c));
  const v = decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks, ...CLEAN });
  check(`a required check reporting ${bad} → BLOCKED`, !v.allow, JSON.stringify(v.reasons));
}
// null conclusion (still queued/in_progress, no terminal state yet) — the exact shape `gh pr checks
// --watch` returning does NOT rule out if it raced a fresh push.
{
  const checks = allGreen.map((c, i) => (i === 0 ? { ...c, conclusion: null } : c));
  const v = decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks, ...CLEAN });
  check('a required check still PENDING (null conclusion) → BLOCKED', !v.allow);
}
// the context never appears in the rollup at all (e.g. reported against a stale SHA the PR no
// longer shows) — absence must be exactly as blocking as an explicit failure.
{
  const checks = allGreen.filter((c) => c.context !== REQ[0]);
  const v = decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks, ...CLEAN });
  check('a required context with NO reported result at all → BLOCKED', !v.allow);
}
// a stale SUCCESS sitting next to a fresh CANCELLED for the SAME context (a re-run scenario) — the
// bad one must still block; "it passed once" is not the same as "it currently passes."
{
  const checks: CheckRun[] = [...allGreen, { context: REQ[0], conclusion: 'CANCELLED' }];
  const v = decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks, ...CLEAN });
  check('a stale SUCCESS next to a fresh CANCELLED for the same context → BLOCKED', !v.allow);
}

// ── branch freshness / mergeable state ────────────────────────────────────────────────────────────
check('BEHIND base → BLOCKED even with all checks green',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' }).allow);
check('CONFLICTING mergeable state → BLOCKED',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }).allow);
check('UNKNOWN mergeable state → BLOCKED',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, mergeable: 'UNKNOWN', mergeStateStatus: 'UNSTABLE' }).allow);
check('BLOCKED mergeStateStatus → BLOCKED',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' }).allow);
check('CLEAN + MERGEABLE with all green → ALLOWED (the only fully-green path)',
  decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }).allow);

// ── file-list drift (shared-worktree mix-up class of bug) ────────────────────────────────────────
check('file list unchanged since recorded → ALLOWED',
  decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, ...CLEAN, expectedFiles: ['a.ts', 'b.ts'], actualFiles: ['a.ts', 'b.ts'] }).allow);
check('file list unchanged, different ORDER → still ALLOWED (order-insensitive)',
  decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, ...CLEAN, expectedFiles: ['a.ts', 'b.ts'], actualFiles: ['b.ts', 'a.ts'] }).allow);
check('an EXTRA file appeared since it was recorded → BLOCKED',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, ...CLEAN, expectedFiles: ['a.ts'], actualFiles: ['a.ts', 'c.ts'] }).allow);
check('a file DISAPPEARED since it was recorded → BLOCKED',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, ...CLEAN, expectedFiles: ['a.ts', 'b.ts'], actualFiles: ['a.ts'] }).allow);
check('no expectation recorded → file-list check is skipped, not a false block',
  decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, ...CLEAN }).allow);

// ── case normalisation (REST lowercase vs GraphQL uppercase) ─────────────────────────────────────
check('lowercase "success" (REST API shape) normalises to SUCCESS', normaliseConclusion('success') === 'SUCCESS');
check('lowercase "cancelled" normalises and still blocks',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen.map((c, i) => (i === 0 ? { ...c, conclusion: 'cancelled' as any } : c)), ...CLEAN }).allow);

// ── an empty required-context list (branch protection unreadable) never FALSELY allows on its own —
// mergeable/mergeStateStatus still gate, matching the CLI's documented fallback behaviour.
check('empty required-context list still enforces mergeable/mergeStateStatus',
  !decideMerge({ requiredContexts: [], requiredContextsKnown: true, checks: [], mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }).allow);
check('empty required-context list + clean mergeable state → ALLOWED (nothing left to check)',
  decideMerge({ requiredContexts: [], requiredContextsKnown: true, checks: [], ...CLEAN }).allow);

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────

// ── 2026-08-26: the cloud-transport fix must not have opened a hole ──────────────────────────────
// The old transport swallowed a 403 on the branch-protection endpoint and returned an EMPTY required
// list, so a merge could pass while NOTHING verified the required checks. Not knowing what is
// required is not the same as nothing being required, and only one of those is safe to merge on.
check('required contract UNREADABLE → BLOCKED even when everything else is green',
  !decideMerge({ requiredContexts: [], requiredContextsKnown: false, checks: allGreen, ...CLEAN }).allow);
check('required contract field ABSENT entirely → BLOCKED (fails closed by default)',
  !decideMerge({ requiredContexts: REQ, checks: allGreen, ...CLEAN } as any).allow);
check('required contract read and legitimately EMPTY → still ALLOWED (known ≠ unreadable)',
  decideMerge({ requiredContexts: [], requiredContextsKnown: true, checks: [], ...CLEAN }).allow);

// A failing check that is not on the REQUIRED list must still block: GitHub calls that UNSTABLE and
// the gate already refuses UNSTABLE, so stating it directly costs nothing and holds even when
// mergeStateStatus is stale or unavailable.
check('a NON-required check that FAILED still blocks the merge',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: [...allGreen, { context: 'optional-lint', conclusion: 'FAILURE' }], ...CLEAN }).allow);
check('a NON-required check still PENDING still blocks the merge',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: [...allGreen, { context: 'optional-lint', conclusion: null }], ...CLEAN }).allow);

// 0b′ (2026-11-07): an ADVISORY reviewer that had nothing to read (CodeRabbit «No files to review») is not a result.
const rabbit = (conclusion: CheckRun['conclusion']): CheckRun => ({ context: 'CodeRabbit', conclusion });
check('CodeRabbit SKIPPED (not required) → ALLOWED (#10856 sat blocked on exactly this)',
  decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: [...allGreen, rabbit('SKIPPED')], ...CLEAN }).allow);
for (const bad of ['FAILURE', 'CANCELLED', 'NEUTRAL', null] as const) {
  check(`CodeRabbit ${bad ?? 'PENDING'} still blocks`,
    !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: [...allGreen, rabbit(bad)], ...CLEAN }).allow);
}
// 0b″ (owner 2026-11-09): rate-limited CodeRabbit passes only after a real review with every Major resolved.
const limited: CheckRun = { context: 'CodeRabbit', conclusion: 'NEUTRAL', title: 'Review rate limited' };
const RL = { requiredContexts: REQ, requiredContextsKnown: true, checks: [...allGreen, limited], ...CLEAN };
check('CodeRabbit rate-limited after a review, no open Major → ALLOWED (#11367 sat 5 h on this)',
  decideMerge({ ...RL, codeRabbitReviewed: true, openReviewMajors: [] }).allow);
check('CodeRabbit rate-limited, never reviewed this PR → BLOCKED',
  !decideMerge({ ...RL, codeRabbitReviewed: false, openReviewMajors: [] }).allow);
check('CodeRabbit rate-limited, threads unreadable → BLOCKED',
  !decideMerge({ ...RL, codeRabbitReviewed: true, openReviewMajors: null }).allow);
check('CodeRabbit rate-limited with an open Major → BLOCKED',
  !decideMerge({ ...RL, codeRabbitReviewed: true, openReviewMajors: ['Make the area division safe.'] }).allow);
check('CodeRabbit NEUTRAL for any other reason → BLOCKED',
  !decideMerge({ ...RL, checks: [...allGreen, { ...limited, title: 'Review failed' }], codeRabbitReviewed: true, openReviewMajors: [] }).allow);
// 0b‴ (owner 2026-11-09, «Do both»): a PR that is ONLY the copy of SQL production already ran passes a rate-limited
// CodeRabbit that never read it. The proof is the caller's; the file-shape half is checked here too.
const COPY = ['supabase/migrations/20261109124506_x.sql', 'sql/mirrors/cron_schedule.json'];
const CP = { ...RL, codeRabbitReviewed: false, openReviewMajors: [] as string[], actualFiles: COPY, copyOfProduction: true };
check('copy of production, CodeRabbit rate-limited and never read it, no open Major → ALLOWED (ten mirrors froze every deploy)',
  decideMerge(CP).allow);
check('…the same PR without the proof → BLOCKED', !decideMerge({ ...CP, copyOfProduction: false }).allow && !decideMerge({ ...CP, copyOfProduction: undefined }).allow);
check('…a proof that is not exactly `true` → BLOCKED', !decideMerge({ ...CP, copyOfProduction: 'yes' as unknown as boolean }).allow);
check('…with one file outside the database lane → BLOCKED', !decideMerge({ ...CP, actualFiles: [...COPY, 'scripts/x.ts'] }).allow);
check('…with no migration file at all (mirrors only) → BLOCKED', !decideMerge({ ...CP, actualFiles: ['sql/mirrors/cron_schedule.json'] }).allow);
check('…with the file list missing or empty → BLOCKED', !decideMerge({ ...CP, actualFiles: undefined }).allow && !decideMerge({ ...CP, actualFiles: [] }).allow);
check('…with an open Major → BLOCKED', !decideMerge({ ...CP, openReviewMajors: ['Guard the drop.'] }).allow);
check('…with unreadable review threads → BLOCKED', !decideMerge({ ...CP, openReviewMajors: null }).allow && !decideMerge({ ...CP, openReviewMajors: undefined }).allow);
check('…when CodeRabbit is REQUIRED → BLOCKED', !decideMerge({ ...CP, requiredContexts: [...REQ, 'CodeRabbit'] }).allow);
check('…when CodeRabbit is NEUTRAL for another reason, FAILED, CANCELLED or pending → BLOCKED',
  (['Review failed', null] as const).every((title) => !decideMerge({ ...CP, checks: [...allGreen, { ...limited, title }] }).allow)
  && (['FAILURE', 'CANCELLED', null] as const).every((c) => !decideMerge({ ...CP, checks: [...allGreen, { ...limited, conclusion: c }] }).allow));
check('…when a required check is not SUCCESS → BLOCKED', !decideMerge({ ...CP, checks: [...allGreen.slice(1), { ...allGreen[0], conclusion: 'FAILURE' }, limited] }).allow);
{
  const lane = await import('./pr-migrations-match-production.ts');
  const gate = await import('./lib/mergeGate.ts');
  check('the gate\'s copy-lane patterns are the database lane\'s own (they cannot drift apart)',
    gate.COPY_LANE_FILE.source === lane.DB_LANE_FILE.source && gate.COPY_MIGRATION_FILE.source === lane.MIGRATION_FILE.source);
  check('judge() is the proof: a byte of difference, an unapplied version or an unreadable file is not a copy',
    lane.judge([{ path: COPY[0], text: 'select 1;' }], new Map([['20261109124506', 'select 1;']])).ok
    && !lane.judge([{ path: COPY[0], text: 'select 2;' }], new Map([['20261109124506', 'select 1;']])).ok
    && !lane.judge([{ path: COPY[0], text: 'select 1;' }], new Map()).ok
    && !lane.judge([{ path: COPY[0], text: null }], new Map([['20261109124506', 'select 1;']])).ok);
  const src = (await import('node:fs')).readFileSync(new URL('./safe-pr-merge.ts', import.meta.url), 'utf8');
  check('safe-pr-merge.ts computes the proof itself (judge() over the head SHA and ops_migration_sql), never takes it from a flag',
    /copyOfProduction: copy\?\.ok === true/.test(src) && /judge\(files, applied\)/.test(src) && /getFileAtRef\(slug, path, headSha\)/.test(src)
    && /rpc\/ops_migration_sql/.test(src) && !/--copy|argv[^\n]*copy/i.test(src));
  check('…and a missing key or a failed read is NOT a proof', /if \(!URL_BASE \|\| !KEY\) return \{ ok: false/.test(src) && /if \(!r\.ok\) return \{ ok: false/.test(src) && /catch \(e\) \{\n    return \{ ok: false/.test(src));
}
check('CodeRabbit SKIPPED when it IS required → BLOCKED (rule 1 governs)',
  !decideMerge({ requiredContexts: [...REQ, 'CodeRabbit'], requiredContextsKnown: true, checks: [...allGreen, rabbit('SKIPPED')], ...CLEAN }).allow);

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
      && decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen.map((c, i) => (i === 0 ? { ...c, conclusion: 'CANCELLED' } : c)), ...CLEAN }).allow === false;
  })());
mustCatch('a gate that ignores mergeStateStatus entirely would wrongly allow BEHIND',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' }).allow);
mustCatch('a gate that treats an ABSENT required context as "not my problem" would wrongly allow it',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen.filter((c) => c.context !== REQ[1]), ...CLEAN }).allow);
mustCatch('a gate that lets a stale SUCCESS mask a fresh CANCELLED for the same context',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: [...allGreen, { context: REQ[0], conclusion: 'CANCELLED' }], ...CLEAN }).allow);
mustCatch('a gate that skips the file-list check even when an expectation WAS recorded',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, ...CLEAN, expectedFiles: ['a.ts'], actualFiles: ['a.ts', 'sneaky.ts'] }).allow);
mustCatch('a gate that fails case-sensitively on REST-shaped lowercase conclusions',
  normaliseConclusion('cancelled') === 'CANCELLED');

mustCatch('a gate that treats an UNREADABLE required-check contract as "nothing required" would wrongly allow',
  (() => {
    // the exact old-transport regression: `catch { return [] }` on the protection endpoint
    const buggyContexts = (): string[] => [];
    return buggyContexts().length === 0
      && decideMerge({ requiredContexts: buggyContexts(), requiredContextsKnown: false, checks: allGreen, ...CLEAN }).allow === false;
  })());
mustCatch('a gate that inspects ONLY required contexts would wrongly allow a FAILING optional check',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: [...allGreen, { context: 'not-required', conclusion: 'FAILURE' }], ...CLEAN }).allow);

mustCatch('a skip exemption widened to ANY optional check would wrongly allow a SKIPPED optional-lint',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: [...allGreen, { context: 'optional-lint', conclusion: 'SKIPPED' }], ...CLEAN }).allow);
mustCatch('a skip exemption that ignores the REQUIRED list would wrongly allow a required CodeRabbit that skipped',
  !decideMerge({ requiredContexts: ['CodeRabbit'], requiredContextsKnown: true, checks: [{ context: 'CodeRabbit', conclusion: 'SKIPPED' }], ...CLEAN }).allow);

mustCatch('a rate-limit pass that skips the «reviewed before» test would merge a PR CodeRabbit never read',
  !decideMerge({ ...RL, openReviewMajors: [] }).allow);
mustCatch('a copy-only pass that trusts the proof flag alone would merge code CodeRabbit never read',
  !decideMerge({ ...RL, codeRabbitReviewed: false, openReviewMajors: [], copyOfProduction: true, actualFiles: ['src/app.tsx', 'supabase/migrations/20261109124506_x.sql'] }).allow);
mustCatch('a copy-only pass that trusts the file names alone would merge a migration production never ran',
  !decideMerge({ ...RL, codeRabbitReviewed: false, openReviewMajors: [], actualFiles: ['supabase/migrations/20261109124506_x.sql'] }).allow);
mustCatch('a rate-limit pass widened to a REQUIRED CodeRabbit would bypass branch protection',
  !decideMerge({ ...RL, requiredContexts: [...REQ, 'CodeRabbit'], codeRabbitReviewed: true, openReviewMajors: [] }).allow);
mustCatch('a gate that ignores unresolved CodeRabbit Majors would merge #11247 (9 unanswered, PRICE = SOURCE)',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, ...CLEAN, openReviewMajors: ['Preserve a separately published rate.'] }).allow);
mustCatch('a gate that treats UNREADABLE review threads as "none open" would wrongly allow',
  !decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, ...CLEAN, openReviewMajors: null }).allow);
check('zero open CodeRabbit Majors + all green → ALLOWED',
  decideMerge({ requiredContexts: REQ, requiredContextsKnown: true, checks: allGreen, ...CLEAN, openReviewMajors: [] }).allow);
{
  const { isCodeRabbitMajor } = await import('./lib/githubApi.ts');
  check('CodeRabbit severity marker: Major icon + bold label detected, Minor not',
    isCodeRabbitMajor('<img src="https://x/review-comment-icons-v1/major-16.svg"> **Major** · x')
      && isCodeRabbitMajor('_🟠 Major_ **Major** · Data') && !isCodeRabbitMajor('<img src="https://x/amber-16.svg"> **Minor** · x')
      // A Minor whose prose quotes «**Major**» is still a Minor (#11294's own review).
      && !isCodeRabbitMajor('<!-- x -->\n\n<img src="https://x/amber-16.svg"> **Minor** · x\n\nIf a reviewer posts a `**Major**` comment'));
}

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ the merge gate requires explicit SUCCESS on every required check, every time\n');
