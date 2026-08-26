// THE only sanctioned way to merge a PR in this repo — supersedes bare `gh pr merge` calls, which
// have no way to distinguish "the watch call returned" from "it is actually safe to merge" (see
// scripts/lib/mergeGate.ts for the incident this closes: PR #1046, 2026-08-24).
//
// Re-reads the PR's CURRENT state right before merging — never trusts a `gh pr checks --watch` that
// returned moments (or a rebase) ago — and refuses if any required check is not exactly SUCCESS, the
// branch is behind, the mergeable state isn't clean, or the file list moved since it was recorded.
//
// TRANSPORT (2026-08-26): this tool used to shell out to the `gh` CLI, which cloud agent sessions do
// not have — so the ONLY sanctioned merge path could not run in the environment that most needed it,
// and merges there happened by hand instead. It now talks to the REST API through
// scripts/lib/githubApi.ts, which works in a cloud session, in CI and on a laptop. There is still
// exactly ONE merge path and ONE decision function; only the transport changed. Every read fails
// CLOSED: anything the gate cannot verify refuses the merge instead of defaulting to permissive.
//
// USAGE:
//   node --experimental-strip-types scripts/safe-pr-merge.ts <PR_NUMBER> [--expect-files a.ts,b.ts]
//
// --expect-files is optional but recommended: pass the file list you verified right after opening
// the PR (per AGENTS.md's existing "verify file list right after creation AND again immediately
// before merge" rule) and this tool enforces the "again" half automatically instead of relying on
// the caller to remember.

import { spawnSync } from 'node:child_process';
import { decideMerge, type CheckRun } from './lib/mergeGate.ts';
import { getPr, getChecks, getRequiredContexts, mergePr, repoSlug } from './lib/githubApi.ts';

// Cloud sessions route egress through a policy proxy that injects the real GitHub credential, and
// Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set BEFORE the process
// starts (the proxy's own documented fix; Node >= 22.21). Setting it from inside the module is too
// late — undici has already built its global dispatcher — so re-exec ourselves once with it set.
// Without this the gate reads 401 "Bad credentials" and refuses every PR: fail-closed, but useless.
// Doing it here rather than in a wrapper keeps ONE entrypoint and no second merge path.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
}

const prNumber = process.argv[2];
if (!prNumber || !/^\d+$/.test(prNumber)) {
  console.error('usage: safe-pr-merge.ts <PR_NUMBER> [--expect-files a.ts,b.ts]');
  process.exit(2);
}
const expectFlagIdx = process.argv.indexOf('--expect-files');
const expectedFiles = expectFlagIdx >= 0 ? process.argv[expectFlagIdx + 1].split(',').map((s) => s.trim()).filter(Boolean) : undefined;

async function main() {
  const slug = repoSlug();
  const pr = await getPr(slug, prNumber!);

  // The required-check CONTRACT, read for the PR's OWN base branch (not a hardcoded "main").
  const required = await getRequiredContexts(slug, pr.baseRef);

  // Checks are read for the EXACT head SHA the gate is about to merge — never "the PR's checks"
  // in the abstract, which can lag a push.
  const checks: CheckRun[] = (await getChecks(slug, pr.headSha)).map((c) => ({
    context: c.context,
    conclusion: (c.conclusion ?? null) as CheckRun['conclusion'],
  }));

  console.log(`PR #${prNumber} @ ${pr.headSha.slice(0, 7)} (base ${pr.baseRef})`);
  console.log(`  required contexts: ${required.known ? (required.contexts.join(', ') || '(none configured)') + ` [${required.source}]` : `UNREADABLE — ${required.why}`}`);
  for (const c of checks) console.log(`  ${c.context}: ${c.conclusion ?? 'PENDING'}`);
  console.log(`  mergeable=${pr.mergeable} mergeStateStatus=${pr.mergeStateStatus}`);
  console.log(`  files: ${pr.files.join(', ')}`);

  const verdict = decideMerge({
    requiredContexts: required.known ? required.contexts : [],
    requiredContextsKnown: required.known,
    checks,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    expectedFiles,
    actualFiles: pr.files,
  });

  if (!verdict.allow) {
    console.error(`\n\u2717 REFUSING TO MERGE PR #${prNumber}:`);
    for (const r of verdict.reasons) console.error(`  - ${r}`);
    process.exit(1);
  }

  console.log(`\n\u2713 every required check is SUCCESS, branch is clean and up to date \u2014 merging PR #${prNumber}`);
  // Pinned to the SHA that was just verified: if anything pushed to the head in the meantime,
  // GitHub rejects this merge rather than landing code no check ran against.
  const res = await mergePr(slug, prNumber!, pr.headSha);
  console.log(`merged. ${res.sha}`);
}

main();
