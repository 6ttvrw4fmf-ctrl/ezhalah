// A BARRIER THAT MUTATES A TRACKED FILE MUST RESTORE IT WHEN IT IS KILLED, NOT ONLY WHEN IT RETURNS.
//
// WHY THIS EXISTS (2026-09-11, routine #10). The strongest mutation proofs in this repo edit a REAL
// file and re-execute it — `verify-guardian-oracles-discriminate.ts` and
// `verify-journey-tap-ownership-discriminator.ts` both rewrite an `e2e/**/harness.mjs` in place, run
// the mutated module, and restore the original in a `finally`.
//
// A `finally` does not run when the process is killed by a signal. `scripts/run-tests.mjs` treats a
// signal-killed child (`status === null` — timeout, OOM) as a FAILURE precisely because that happens,
// and AGENTS.md states this working directory is shared by concurrent sessions with no isolation. So
// a timeout during one of those proofs leaves a SEMANTIC mutant — a deleted `else` branch that still
// parses and still runs — sitting in a shared working tree, where the next `git add -A` in any
// session commits it. Nothing in the suite would notice: the mutant is valid code.
//
// This is not hypothetical. During the 2026-09-11 apparatus sweep `git status` showed exactly that
// diff in `e2e/guardian/harness.mjs` while the suite was mid-proof. It restored on that run; the
// window is the point. BARRIER_ENGINEER PART 4.8's own rule is "plant no mutant you do not restore,
// and merge no branch that carries one" — a proof that can only restore on the happy path does not
// meet it.
//
// SIGKILL and a hard OOM cannot be trapped by anyone, and this check does not pretend otherwise.
// SIGTERM and SIGINT — the realistic timeout and Ctrl-C cases — can be, so they are required.
//
// This reads source text by necessity: which handlers a script REGISTERS is a property of the file,
// and by the time the process is dying there is nobody left to observe it. The predicate is pure and
// mutation-proven in both directions. It takes TWO readings of each file — see the comment inside
// the predicate — because the structure question and the handler question need different strippings,
// and conflating them made every correctly-repaired file read as unrepaired on the first run.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments, stripCommentsAndStrings } from './lib/stripComments.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MUTATES_IN_PLACE = /\b(?:writeFileSync|appendFileSync|copyFileSync|renameSync|rmSync|unlinkSync)\s*\(/;
const TARGETS_REPO_FILE = /\b(?:join|resolve)\s*\(\s*(?:ROOT|root|REPO)\b/;
const USES_TMPDIR = /\btmpdir\s*\(\s*\)/;
const HANDLES_SIGTERM = /process\s*\.\s*(?:once|on)\s*\(\s*['"`]SIGTERM['"`]/;
const HANDLES_SIGINT = /process\s*\.\s*(?:once|on)\s*\(\s*['"`]SIGINT['"`]/;

/**
 * The predicate, pure so a proof can hand it a broken file.
 *
 * A script qualifies as an in-place mutator when it writes with a sync fs call AND builds its target
 * from the repo root AND is not working in a temp directory. Such a script must register BOTH signal
 * handlers; a `finally` alone is exactly the gap.
 */
export function unsafeInPlaceMutators(files: { name: string; src: string }[]): string[] {
  const problems: string[] = [];
  for (const { name, src } of files) {
    // TWO READINGS, ON PURPOSE — and getting this wrong was caught by this file's own negative
    // control on its first run. STRUCTURE ("does this file really mutate a repo file in place?") is
    // asked of fully stripped code, so a barrier quoting the anti-pattern inside a proof fixture —
    // as this one does, twice, below — is not mistaken for committing it. HANDLERS ("does it
    // register SIGTERM/SIGINT?") must be asked of code with STRINGS INTACT, because the signal name
    // *is* a string literal: blanking it made every correctly-repaired file read as unrepaired,
    // including the two this change fixes. Comments are still stripped there, so a commented-out
    // handler does not count as protection.
    const code = stripCommentsAndStrings(src);
    const withStrings = stripComments(src);
    if (!MUTATES_IN_PLACE.test(code)) continue;
    if (!TARGETS_REPO_FILE.test(code)) continue;     // writes somewhere else entirely
    if (USES_TMPDIR.test(code)) continue;            // already working on a copy
    const missing: string[] = [];
    if (!HANDLES_SIGTERM.test(withStrings)) missing.push('SIGTERM');
    if (!HANDLES_SIGINT.test(withStrings)) missing.push('SIGINT');
    if (missing.length) {
      problems.push(
        `${name} rewrites a tracked repo file in place but registers no ${missing.join('/')} handler — ` +
        `a timeout or Ctrl-C skips its \`finally\` and leaves the mutant in a working tree that ` +
        `AGENTS.md says is shared by concurrent sessions.`,
      );
    }
  }
  return problems;
}

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAn in-place mutation proof restores its file on a signal, not only on return\n');

const names = readdirSync(join(root, 'scripts')).filter((f) => /^verify-.*\.(ts|mjs)$/.test(f));
check('the barrier corpus was readable and non-empty', names.length > 0,
  'an empty corpus would make this vacuously green — it fails closed instead');

const files = names.map((name) => ({ name, src: readFileSync(join(root, 'scripts', name), 'utf8') }));
const problems = unsafeInPlaceMutators(files);
check(`every in-place mutator across ${files.length} barriers restores on a signal`,
  problems.length === 0, problems.join('\n      '));

// ── mutation proofs ─────────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};
const F = (src: string) => [{ name: 'f.ts', src }];

const FINALLY_ONLY = `
const HARNESS = join(ROOT, 'e2e/guardian/harness.mjs');
const original = readFileSync(HARNESS, 'utf8');
writeFileSync(HARNESS, mutate(original));
try { run(); } finally { writeFileSync(HARNESS, original); }
`;
const SIGNAL_SAFE = `
const HARNESS = join(ROOT, 'e2e/guardian/harness.mjs');
const original = readFileSync(HARNESS, 'utf8');
const restore = () => writeFileSync(HARNESS, original);
process.once('SIGTERM', restore);
process.once('SIGINT', restore);
writeFileSync(HARNESS, mutate(original));
try { run(); } finally { restore(); }
`;

mustCatch('the exact shape this was written for: an in-place mutator with only a `finally`',
  unsafeInPlaceMutators(F(FINALLY_ONLY)).length === 1);
mustCatch('a mutator that traps SIGINT but forgets SIGTERM — the signal a TIMEOUT actually sends',
  unsafeInPlaceMutators(F(FINALLY_ONLY + "process.once('SIGINT', restore);")).length === 1);

// Negative controls — a check red for everything is as useless as one green for everything.
mustCatch('…while the repaired, signal-safe form is NOT flagged (this is the fix, and it must pass)',
  unsafeInPlaceMutators(F(SIGNAL_SAFE)).length === 0);
mustCatch('…and a barrier that mutates only a file in tmpdir() is NOT flagged',
  unsafeInPlaceMutators(F("const p = join(ROOT, 'x'); const t = join(tmpdir(), 'copy.mjs');\nwriteFileSync(t, s);")).length === 0);
mustCatch('…and a read-only barrier that never writes anything is NOT flagged',
  unsafeInPlaceMutators(F("const src = readFileSync(join(ROOT, 'src/app/index.tsx'), 'utf8');\ncheck('x', /y/.test(src));")).length === 0);
mustCatch('…and a file that only DESCRIBES the anti-pattern in a comment is not committing it',
  unsafeInPlaceMutators(F("// never writeFileSync(join(ROOT, 'e2e/h.mjs'), m) without a signal handler\nconst a = 1;")).length === 0);
mustCatch('an empty corpus yielding no findings — which is why the corpus read is checked separately',
  unsafeInPlaceMutators([]).length === 0);

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ no proof can leave a mutant behind in a shared working tree\n');
