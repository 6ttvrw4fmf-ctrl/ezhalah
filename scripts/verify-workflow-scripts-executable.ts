#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
/**
 * verify-workflow-scripts-executable — auto-discovered barrier (scripts/run-tests.mjs).
 *
 * A shell script a workflow EXECUTES must be committed mode 755. If the executable bit is lost,
 * the step dies with "Permission denied" (exit 126) before a single line of it runs.
 *
 * WHY THIS EXISTS (2026-09-05). `scripts/safe-deploy.sh` was committed 100644 in #1759. Every
 * production frontend deploy after that failed instantly:
 *     .../8ca276a3.sh: line 2: scripts/safe-deploy.sh: Permission denied
 *     Process completed with exit code 126
 * Nothing caught it. `npm test` never executes that script, review does not show a mode change in a
 * diff, and the failure looks like a deploy problem rather than a repo problem — so the next person
 * debugs Vercel instead of `git ls-files -s`. The whole deploy path was dead and every check was green.
 *
 * SOURCED IS NOT EXECUTED. `source scripts/deploy-target-guard.sh` runs in the caller's shell and
 * needs no executable bit; that file is legitimately 644. Demanding +x on it would be a false alarm
 * that teaches people to chmod things that do not need it, so the check reads the token before the
 * path and skips `source` / `.` invocations.
 *
 * The MODE READ IS FROM GIT, not the filesystem: the index is what CI checks out, and a local chmod
 * that was never committed is exactly the state this barrier has to fail on.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const WF_DIR = '.github/workflows';
const SCRIPT_RE = /(^|[\s;&|(])(?:(source|\.)\s+)?(?:\.\/)?(scripts\/[A-Za-z0-9._-]+\.sh)\b/g;

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

function gitMode(path: string): string | null {
  try {
    const out = execFileSync('git', ['ls-files', '-s', '--', path], { encoding: 'utf8' }).trim();
    return out ? out.split(/\s+/)[0] : null;
  } catch { return null; }
}

// path → true if ANY workflow executes it (a single sourced use does not excuse an executed one)
const executed = new Map<string, string>();
const sourcedOnly = new Set<string>();

for (const f of readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
  const yml = readFileSync(`${WF_DIR}/${f}`, 'utf8');
  for (const m of yml.matchAll(SCRIPT_RE)) {
    const [, , sourcedWith, path] = m;
    if (sourcedWith) { if (!executed.has(path)) sourcedOnly.add(path); continue; }
    executed.set(path, f);
    sourcedOnly.delete(path);
  }
}

check('at least one workflow-executed script was found (the scan itself still works)', executed.size > 0);

for (const [path, wf] of [...executed].sort()) {
  const mode = gitMode(path);
  check(`${path} is committed executable (run by ${wf})`, mode === '100755',
    mode === null ? 'not tracked by git' : `mode is ${mode}, needs 100755 — the step would die with "Permission denied" (exit 126)`);
}
for (const path of [...sourcedOnly].sort()) {
  console.log(`SKIP  ${path} is only sourced, never executed — no executable bit required`);
}

if (failed) {
  console.error(`\n${failed} check(s) FAILED — a workflow would die on "Permission denied" before running`);
  process.exit(1);
}
console.log(`\nOK — all ${executed.size} workflow-executed script(s) are committed 755.`);
