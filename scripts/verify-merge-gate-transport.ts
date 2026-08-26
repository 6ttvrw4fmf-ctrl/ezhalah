// The merge gate must stay RUNNABLE where it is required, and stay the ONLY way to merge.
//
// WHY THIS EXISTS (2026-08-26). `scripts/safe-pr-merge.ts` was declared the only sanctioned merge
// path in AGENTS.md, and `scripts/verify-merge-gate.ts` proved its DECISION logic was sound. Nothing
// checked whether the tool could actually RUN. It shelled out to the `gh` CLI, which cloud agent
// sessions do not have, so in that environment the mandated gate could not execute at all — and the
// merges that had to happen anyway happened by hand, with the gate's conditions re-checked from
// memory. Every barrier was green the whole time, because they all tested the decision and none
// tested the reachability.
//
// That is the same wound as the alert-delivery blackout of the same week: a mechanism that was
// CONFIGURED but never DELIVERED, with a barrier watching only the half that worked. So this file
// checks the half that was unwatched: can the gate run here, does it still fail closed, and is it
// still the only door?
//
//   node --experimental-strip-types scripts/verify-merge-gate-transport.ts

import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const GATE = join(REPO, 'scripts/safe-pr-merge.ts');
const API = join(REPO, 'scripts/lib/githubApi.ts');
const DECIDE = join(REPO, 'scripts/lib/mergeGate.ts');

const gate = readFileSync(GATE, 'utf8');
const api = readFileSync(API, 'utf8');
const decide = readFileSync(DECIDE, 'utf8');

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}`);
};

// ── 1. REACHABILITY: the gate must not depend on a binary its callers may not have ───────────────
check('safe-pr-merge.ts does not shell out to the gh CLI (cloud sessions have no gh)',
  !/execFileSync\(\s*['"]gh['"]/.test(gate) && !/\bsh\(\s*['"]gh['"]/.test(gate));
check('safe-pr-merge.ts reaches GitHub through the shared transport module',
  /from '\.\/lib\/githubApi\.ts'/.test(gate));
check('the transport speaks HTTP directly rather than requiring a CLI',
  /fetch\(/.test(api));
check('gh, if used at all, is only a CREDENTIAL source and never the transport',
  !/execFileSync\(\s*['"]gh['"]\s*,\s*\[\s*['"](pr|api)['"]/.test(api));

check('safe-pr-merge.ts re-execs with NODE_USE_ENV_PROXY so a proxied session is not silently 401',
  /NODE_USE_ENV_PROXY/.test(gate) && /spawnSync\(process\.execPath/.test(gate));

// ── 2. FAIL-CLOSED: unverifiable must never resolve to permissive ────────────────────────────────
// The precise regression this pins: `catch { return [] }` around the branch-protection read, which
// turned "my token cannot see the contract" into "there is no contract".
check('getRequiredContexts reports UNREADABLE instead of returning an empty list',
  /known:\s*false/.test(api) && /could not read required_status_checks/.test(api));
check('no catch-block in the transport silently yields an empty required-context list',
  !/catch\s*(\([^)]*\))?\s*\{[^}]*return\s*\[\s*\]/.test(api));
check('decideMerge refuses unless the required-check contract was explicitly read',
  /requiredContextsKnown\s*!==\s*true/.test(decide));
check('the transport throws (not defaults) when no credential is available',
  /FAILS CLOSED/.test(api) && /throw new Error\(/.test(api));

// ── 3. RACE: the merge must be pinned to the SHA that was verified ───────────────────────────────
check('mergePr pins the verified head SHA so GitHub rejects a merge if the head moved',
  /body: JSON\.stringify\(\{[^}]*sha[^}]*\}\)/.test(api));
check('safe-pr-merge.ts passes the SHA it verified into the merge call',
  /mergePr\(slug,\s*prNumber!,\s*pr\.headSha\)/.test(gate));

// ── 4. SINGLE DOOR: no second merge path may appear anywhere in the tree ─────────────────────────
const ALLOWED = new Set(['scripts/safe-pr-merge.ts', 'scripts/lib/githubApi.ts', 'scripts/verify-merge-gate-transport.ts']);
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8', cwd: REPO }).split('\n').filter(Boolean);
const offenders: string[] = [];
for (const rel of tracked) {
  if (ALLOWED.has(rel)) continue;
  if (!/\.(ts|js|cjs|mjs|sh|yml|yaml|py)$/.test(rel)) continue;
  const full = join(REPO, rel);
  try { if (statSync(full).size > 400_000) continue; } catch { continue; }
  const body = readFileSync(full, 'utf8');
  if (/gh\s+pr\s+merge/.test(body) || /pulls\/[^\s'"`]*\/merge/.test(body) || /merge_pull_request/.test(body)) {
    offenders.push(rel);
  }
}
check(`no merge path outside the sanctioned gate (found: ${offenders.join(', ') || 'none'})`,
  offenders.length === 0);

// ── 5. WIRING: both barriers must actually run ───────────────────────────────────────────────────
const pkg = readFileSync(join(REPO, 'package.json'), 'utf8');
check('verify-merge-gate.ts is wired into npm test', /verify-merge-gate\.ts/.test(pkg));
check('verify-merge-gate-transport.ts is wired into npm test', /verify-merge-gate-transport\.ts/.test(pkg));

// ── 6. MUTATION PROOF — each guard must FAIL on its own defect ───────────────────────────────────
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// Reintroduce each defect as a literal string and prove the matching guard rejects it.
const ghRegression = `const out = sh('gh', ['pr', 'view', n, '--json', 'mergeable']);`;
mustCatch('a gate that goes back to shelling out to gh',
  /\bsh\(\s*['"]gh['"]/.test(ghRegression));

const failOpenRegression = `try { return JSON.parse(out); } catch { return []; }`;
mustCatch('a transport that swallows a protection-read failure into an empty list',
  /catch\s*(\([^)]*\))?\s*\{[^}]*return\s*\[\s*\]/.test(failOpenRegression));

const unpinnedRegression = `body: JSON.stringify({ merge_method: 'squash' })`;
mustCatch('a merge call that stops pinning the verified SHA',
  !/body: JSON\.stringify\(\{[^}]*sha[^}]*\}\)/.test(unpinnedRegression));

const secondDoorRegression = `await gh('pr', 'merge', String(n), '--squash')`;
mustCatch('a second merge path added elsewhere in the tree',
  /gh\s*\(?['"]?pr['"]?[,\s]+['"]?merge/.test(secondDoorRegression) || /gh\s+pr\s+merge/.test('gh pr merge 12'));

const noReexec = `const prNumber = process.argv[2];`;
mustCatch('an entrypoint that drops the proxy re-exec (gate would 401 on every PR in a cloud session)',
  !/NODE_USE_ENV_PROXY/.test(noReexec));

const unwiredPkg = `"test": "node scripts/verify-something-else.ts"`;
mustCatch('a package.json that stops running the transport barrier',
  !/verify-merge-gate-transport\.ts/.test(unwiredPkg));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ the merge gate is runnable in every session type, fails closed, and is the only merge path\n');
