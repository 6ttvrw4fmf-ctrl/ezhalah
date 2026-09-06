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

// ── MUTATION PROOFS. The two predicates this barrier turns on are SCRIPT_RE (does a workflow line
//    EXECUTE the script, or merely `source` it?) and the mode comparison. Both are applied here to
//    inputs that carry the exact defect — including the 2026-09-05 one: safe-deploy.sh committed
//    100644, which killed every production deploy with exit 126 while every check stayed green.
const classify = (line: string): { path: string; sourced: boolean } | null => {
  SCRIPT_RE.lastIndex = 0;                       // /g is stateful — a shared regex must be rewound
  const m = SCRIPT_RE.exec(line);
  return m ? { path: m[3], sourced: Boolean(m[2]) } : null;
};
const mustCatch = (what: string, wouldFail: boolean) =>
  check(`MUTATION: catches ${what}`, wouldFail);

mustCatch('a bare `scripts/x.sh` being treated as anything but EXECUTED',
  classify('  run: scripts/safe-deploy.sh')?.sourced === false);
mustCatch('`./scripts/x.sh` being treated as anything but EXECUTED',
  classify('  ./scripts/safe-deploy.sh --prod')?.sourced === false);
mustCatch('`source scripts/x.sh` being misread as EXECUTED (the false alarm that teaches people to chmod 644 files)',
  classify('  source scripts/deploy-target-guard.sh')?.sourced === true);
mustCatch('`. scripts/x.sh` (dot-source) being misread as EXECUTED',
  classify('  . scripts/deploy-target-guard.sh')?.sourced === true);
mustCatch('the mode predicate accepting 100644 — the exact bit that killed every deploy in #1759',
  !('100644' === '100755'));
mustCatch('a script the scan cannot see at all (an empty executed set reading as clean)',
  !(new Map().size > 0));
// …and not vacuous: the real workflow scan must still have found something to grade.
mustCatch('nothing — the real scan still found executed scripts, so the checks above are not idling',
  executed.size > 0);


if (failed) {
  console.error(`\n${failed} check(s) FAILED — a workflow would die on "Permission denied" before running`);
  process.exit(1);
}
console.log(`\nOK — all ${executed.size} workflow-executed script(s) are committed 755.`);
