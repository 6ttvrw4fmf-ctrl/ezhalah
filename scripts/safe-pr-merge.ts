// THE only sanctioned way to merge a PR in this repo — supersedes bare `gh pr merge` calls, which
// have no way to distinguish "the watch call returned" from "it is actually safe to merge" (see
// scripts/lib/mergeGate.ts for the incident this closes: PR #1046, 2026-08-24).
//
// Re-reads the PR's CURRENT state right before merging — never trusts a `gh pr checks --watch` that
// returned moments (or a rebase) ago — and refuses if any required check is not exactly SUCCESS, the
// branch is behind, the mergeable state isn't clean, or the file list moved since it was recorded.
//
// USAGE:
//   node --experimental-strip-types scripts/safe-pr-merge.ts <PR_NUMBER> [--expect-files a.ts,b.ts]
//
// --expect-files is optional but recommended: pass the file list you verified right after opening
// the PR (per AGENTS.md's existing "verify file list right after creation AND again immediately
// before merge" rule) and this tool enforces the "again" half automatically instead of relying on
// the caller to remember.

import { execFileSync } from 'node:child_process';
import { decideMerge, type CheckRun } from './lib/mergeGate.ts';

const prNumber = process.argv[2];
if (!prNumber || !/^\d+$/.test(prNumber)) {
  console.error('usage: safe-pr-merge.ts <PR_NUMBER> [--expect-files a.ts,b.ts]');
  process.exit(2);
}
const expectFlagIdx = process.argv.indexOf('--expect-files');
const expectedFiles = expectFlagIdx >= 0 ? process.argv[expectFlagIdx + 1].split(',').map((s) => s.trim()).filter(Boolean) : undefined;

const sh = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' });

function repoSlug(): string {
  const url = sh('git', ['remote', 'get-url', 'origin']).trim();
  const m = url.match(/[:/]([^/]+\/[^/]+?)(\.git)?$/);
  if (!m) throw new Error(`could not parse owner/repo from remote URL: ${url}`);
  return m[1];
}

function requiredContexts(slug: string): string[] {
  // Falls back to [] (nothing enforced beyond mergeable/mergeStateStatus) if branch protection is
  // unreadable rather than throwing — a token without admin read on protection must not silently
  // disable the whole gate, but it also must not crash a merge that GitHub itself is willing to do.
  try {
    const out = sh('gh', ['api', `repos/${slug}/branches/main/protection`, '--jq', '.required_status_checks.contexts']);
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error('WARNING: could not read branch protection required_status_checks — proceeding with an EMPTY required-context list. mergeable/mergeStateStatus and file-list checks below still apply.');
    return [];
  }
}

type PrView = {
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: string;
  statusCheckRollup: Array<{ name?: string; context?: string; conclusion?: string | null; status?: string }>;
  files: Array<{ path: string }>;
  headRefOid: string;
};

function viewPr(n: string): PrView {
  const out = sh('gh', ['pr', 'view', n, '--json', 'mergeable,mergeStateStatus,statusCheckRollup,files,headRefOid']);
  return JSON.parse(out);
}

function main() {
  const slug = repoSlug();
  const required = requiredContexts(slug);
  const pr = viewPr(prNumber!);

  const checks: CheckRun[] = pr.statusCheckRollup.map((c) => ({
    context: c.context ?? c.name ?? '(unnamed)',
    conclusion: (c.conclusion ?? null) as CheckRun['conclusion'],
  }));
  const actualFiles = pr.files.map((f) => f.path);

  console.log(`PR #${prNumber} @ ${pr.headRefOid.slice(0, 7)}`);
  console.log(`  required contexts: ${required.length ? required.join(', ') : '(none readable)'}`);
  for (const c of checks) console.log(`  ${c.context}: ${c.conclusion ?? 'PENDING'}`);
  console.log(`  mergeable=${pr.mergeable} mergeStateStatus=${pr.mergeStateStatus}`);
  console.log(`  files: ${actualFiles.join(', ')}`);

  const verdict = decideMerge({
    requiredContexts: required,
    checks,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    expectedFiles,
    actualFiles,
  });

  if (!verdict.allow) {
    console.error(`\n✗ REFUSING TO MERGE PR #${prNumber}:`);
    for (const r of verdict.reasons) console.error(`  - ${r}`);
    process.exit(1);
  }

  console.log(`\n✓ every required check is SUCCESS, branch is clean and up to date — merging PR #${prNumber}`);
  sh('gh', ['pr', 'merge', prNumber!, '--squash']);
  console.log('merged.');
}

main();
