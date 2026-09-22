// THE PLAYWRIGHT SUITE MUST ACTUALLY LOAD — AND A SPEC THAT LOADS BUT CONTRIBUTES NOTHING IS A
// FAILURE, NOT A PASS (routine #6, 2026-09-22, ops_incident #564).
//
// WHAT THIS EXISTS FOR, measured. e2e/ui-parity.spec.ts statically imported e2e/lib/
// resultsSentence.mjs — a real ESM module that reads `import.meta.url`. Playwright compiles specs
// through its CommonJS transform, where `import.meta` is a SyntaxError, so the failure landed while
// the FILE was being loaded rather than while a test ran:
//
//     SyntaxError: Cannot use 'import.meta' outside a module
//        at ui-parity.spec.ts:2
//     Total: 0 tests in 0 files
//
// One unloadable spec aborts the WHOLE run, so e2e/selector.spec.ts went down with it: 14 tests
// became 0. ui-parity.yml kept running nightly, kept going red in ~63 s, and kept raising its
// alert — but nothing in the repo could tell "the suite ran and something failed" from "the suite
// never ran at all", and the second is strictly worse. It is the AGENTS.md PART 1.11 shape:
// a green-looking apparatus standing in for coverage that is not happening.
//
// WHY A SOURCE-TEXT TRIPWIRE WOULD NOT DO. docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md §9.5 is explicit
// that a grep over these exact lines passes for the entire time the defect is live — five defects of
// 2026-09-04 wore precisely that shape, two of them pinning the defective line as correct. Whether a
// module graph survives Playwright's transform is not decidable by reading it: it depends on the
// loader, the file extension, and the nearest package.json. So this check RUNS `playwright test
// --list` and reads what the runner actually discovered.
//
// HERMETIC. `--list` loads the config and the spec modules and stops; it launches no browser and
// makes no request, so this belongs in the required suite (AGENTS.md, "the required suite is
// HERMETIC"). It needs only @playwright/test, which is a devDependency `npm ci` installs.
// It fails CLOSED: an unreadable listing is a refusal, never a pass.
import { readdirSync, statSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}${ok || !extra ? '' : ` — ${extra}`}`);
  if (!ok) failed++;
};
// The repo's convention for an assertion that is a MUTATION PROOF: the same predicate, applied to a
// deliberately broken input, asserted to come back RED. Pinned by
// scripts/verify-new-barriers-are-mutation-proven.ts.
const mustCatch = check;

// Playwright's default testMatch: **/*.@(spec|test).?(c|m)[jt]s?(x). Discovered from disk by SHAPE,
// never from a list someone has to remember to extend — a spec added tomorrow is covered for free.
const SPEC = /\.(spec|test)\.(c|m)?[jt]sx?$/;
const specsOnDisk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...specsOnDisk(p));
    else if (SPEC.test(entry)) out.push(p);
  }
  return out;
};

/** Runs `playwright test --list` and reports what the runner really discovered. */
export function listSuite(cwd: string, configArg: string[] = []): {
  ok: boolean; total: number; files: Set<string>; out: string;
} {
  const r = spawnSync('npx', ['playwright', 'test', '--list', ...configArg],
    { cwd, encoding: 'utf8', timeout: 180_000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  // "Total: 14 tests in 2 files" — absent when the run aborted before discovery finished.
  const m = out.match(/Total:\s+(\d+)\s+tests?\s+in\s+(\d+)\s+files?/);
  const files = new Set<string>();
  for (const line of out.split('\n')) {
    const f = line.match(/›\s+(\S+?\.(?:spec|test)\.(?:c|m)?[jt]sx?):\d+/);
    if (f) files.add(basename(f[1]));
  }
  // status === null is a timeout/signal kill: a refusal, never a pass (run-tests.mjs fails the same
  // way for the same reason).
  return { ok: r.status === 0 && m !== null, total: m ? Number(m[1]) : 0, files, out };
}

// ── §1 · THE REAL SUITE ─────────────────────────────────────────────────────────────────────────
const onDisk = specsOnDisk(join(ROOT, 'e2e')).map((p) => basename(p)).sort();
const live = listSuite(ROOT);

check(live.ok, 'playwright discovers the suite (exit 0 and a parsable "Total:" line)',
  `exit was non-zero or no Total line — a spec failed to LOAD, so the whole run aborted and every `
  + `test in every spec silently did not execute. Output:\n${live.out.slice(0, 1200)}`);

// A spec present on disk but absent from the listing contributes nothing and says nothing.
const missing = onDisk.filter((f) => !live.files.has(f));
check(missing.length === 0,
  `every spec on disk is discovered by the runner (${onDisk.length} on disk, ${live.files.size} listed)`,
  `these exist but the runner listed no test from them: ${missing.join(', ')} — either the file fails `
  + 'to load, or it matched no testMatch pattern. Both mean it is not protecting anything.');

// SHRINK-ONLY FLOOR. Measured 14 on 2026-09-22 (e2e/selector.spec.ts 6 + e2e/ui-parity.spec.ts 8).
// Raise it when the suite genuinely grows; lowering it is a deliberate, reviewed reduction in
// coverage, never a side effect of a rename or a bad glob.
const TEST_FLOOR = 14;
check(live.total >= TEST_FLOOR,
  `the suite still carries at least ${TEST_FLOOR} tests (found ${live.total})`,
  `${live.total} < ${TEST_FLOOR} — tests disappeared from discovery.`);

// ── §2 · MUTATION PROOF — the predicate is WATCHED catching the real defect ──────────────────────
// Executed against a scratch project rather than asserted in prose, and deliberately NOT written
// into e2e/: a barrier that mutates the real tree can leave it broken when it dies.
const tmp = mkdtempSync(join(tmpdir(), 'pw-load-'));
try {
  mkdirSync(join(tmp, 'e2e'), { recursive: true });
  // The scratch project sits outside the repo, so Node's upward resolution never reaches the repo's
  // node_modules and every arm would fail with "Cannot find module '@playwright/test'" — a failure
  // that looks exactly like the mutant's and would make the proof meaningless. Link it explicitly.
  symlinkSync(join(ROOT, 'node_modules'), join(tmp, 'node_modules'), 'dir');
  writeFileSync(join(tmp, 'playwright.config.ts'),
    "export default { testDir: './e2e', projects: [{ name: 'chromium' }] };\n");
  // A healthy spec, present in BOTH arms: it is what proves the failing arm fails because of the
  // mutant and not because the scratch project was broken to begin with.
  writeFileSync(join(tmp, 'e2e', 'healthy.spec.ts'),
    "import { test } from '@playwright/test';\ntest('a', async () => {});\ntest('b', async () => {});\n");
  // The ESM-only helper, reproduced exactly: a .mjs that touches import.meta.
  writeFileSync(join(tmp, 'e2e', 'esmOnly.mjs'),
    "export const ROOT = import.meta.url;\nexport const src = () => 'x';\n");

  const configArg = ['--config', join(tmp, 'playwright.config.ts')];

  // NEGATIVE CONTROL first. A rule that is red for everything guards nothing, so the clean arm must
  // be GREEN before the mutant's redness means anything.
  const clean = listSuite(ROOT, configArg);
  check(clean.ok && clean.total === 2 && clean.files.has('healthy.spec.ts'),
    'negative control: the scratch project lists its 2 tests cleanly',
    `ok=${clean.ok} total=${clean.total} — the control is broken, so the mutation below proves nothing.`);

  // THE MUTANT: the real 2026-09-20 defect — a spec statically importing the ESM-only module.
  writeFileSync(join(tmp, 'e2e', 'mutant.spec.ts'),
    "import { test } from '@playwright/test';\nimport { src } from './esmOnly.mjs';\n"
    + "test('c', async () => { src(); });\n");
  const mutated = listSuite(ROOT, configArg);

  mustCatch(!mutated.ok,
    'MUTATION: a spec that statically imports an ESM-only module turns §1 RED',
    'the listing still succeeded — this check would NOT have caught the defect it exists for.');
  mustCatch(/import\.meta|SyntaxError|Cannot use/.test(mutated.out),
    'MUTATION: the failure names the import.meta load error (the measured signature)',
    mutated.out.slice(0, 600));
  // The half that matters most: the healthy spec is collateral. One bad file darkens the others,
  // which is why "0 tests in 0 files" and not "1 spec failed".
  mustCatch(!mutated.files.has('healthy.spec.ts'),
    'MUTATION: the UNRELATED healthy spec is darkened too (one bad spec aborts the whole run)',
    'the healthy spec still listed — the blast radius assumption behind this barrier is wrong.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failed === 0
  ? `\n✅ the Playwright suite loads: ${live.total} tests across ${live.files.size} spec file(s).`
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
