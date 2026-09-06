// A PASSING BARRIER LINE MUST NOT CARRY THE TEXT THAT DESCRIBES ITS FAILURE.
//
// WHY THIS EXISTS (incident #42, found by the routine-9 red team 2026-09-05).
// `scripts/verify-test-registry-complete.ts` appended its `detail` argument unconditionally, so a
// completely healthy run printed, four times:
//
//   ✓ MUTATION catches an exclusion naming a workflow that EXISTS but never invokes it
//       — the mutant survived — the home check is blind
//
// The ticks were right and the mutations really did pass; the prose next to them said the opposite.
// On the ONE barrier whose job is to stop checks going dark, a reader scanning output sees «the home
// check is blind» on a green run and either stops trusting the output or chases a defect that is not
// there. An instrument that reports its own failure on success is worse than no instrument.
//
// WHAT THIS GUARDS, AND WHY IT IS TWO HALVES.
//   1. THE DECISION, EXECUTED, IN BOTH DIRECTIONS. The real `renderLine` is lifted out of that file
//      and run: a PASS must drop `detail`, a FAIL must still carry it. The second direction is not
//      decoration — the lazy wrong "fix" is to delete `detail` altogether, which would make failures
//      unreadable and would satisfy a one-directional check.
//   2. THE REAL RUN. `renderLine` being correct proves nothing if `check()` stops calling it, so the
//      target barrier is actually executed and every ✓ line of its real output is read. That is the
//      difference between asserting a function and asserting the thing a human sees.
//
// Scope is deliberately this one file. Roughly eighteen sibling barriers also print `detail` on a
// pass, but theirs is INFORMATIONAL («341 entries», «none») — harmless, and the run's summary already
// repeats it. Only here was the argument a constant sentence describing a failure. Widening this to
// the whole fleet would rewrite seventeen other routines' output with no defect to point at.
//
//   node --experimental-strip-types scripts/verify-barrier-pass-line-carries-no-failure-text.ts   (in `npm test`)

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { argvFor } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const TARGET = 'verify-test-registry-complete.ts';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  // Dogfood: this file's own passing lines carry the name only.
  console.log(`  ${cond ? '✓' : '❌'} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};
const mustCatch = (label: string, caught: boolean) =>
  check(`MUTATION catches ${label}`, caught, 'the mutant survived — this barrier is blind');

console.log(`verify-barrier-pass-line-carries-no-failure-text: a ✓ in ${TARGET} says only what passed.`);

type Render = (cond: boolean, name: string, detail: string) => string;

// The REAL renderer, not a copy. A hand-copied duplicate here is a test that stays green while the
// barrier regresses (feedback_never-test-a-copy-of-production-code).
const { renderLine } = (await liftSymbols(
  join(root, 'scripts', TARGET),
  [{ header: 'const renderLine =', endsWith: /;\s*$/ }],
  ['renderLine'],
)) as { renderLine: Render };

// The predicate, applied to a renderer: does a PASS line leak the failure explanation?
const FAIL_TEXT = 'the mutant survived — the home check is blind';
const leaksOnPass = (r: Render) => r(true, 'a check', FAIL_TEXT).includes(FAIL_TEXT);

check('a PASS line carries the name only, never the failure explanation',
  !leaksOnPass(renderLine), renderLine(true, 'a check', FAIL_TEXT));
check('a FAIL line still carries it (the fix is not «delete detail», which would blind failures)',
  renderLine(false, 'a check', FAIL_TEXT).includes(FAIL_TEXT), renderLine(false, 'a check', FAIL_TEXT));
check('the tick and the cross themselves are unchanged',
  renderLine(true, 'a check', '') === '  ✓ a check' && renderLine(false, 'a check', '') === '  ❌ a check',
  `${renderLine(true, 'a check', '')} / ${renderLine(false, 'a check', '')}`);

// MUTATION, executed: incident #42's renderer, verbatim as it stood on 2026-09-05.
const legacy: Render = (cond, name, detail) => `  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`;
mustCatch('the unconditional-detail renderer (incident #42, verbatim)', leaksOnPass(legacy));
// …and the negative control: the shipped renderer is not flagged, so the check is not vacuously red.
mustCatch('…while the shipped renderer is NOT flagged (the proof is differential)', !leaksOnPass(renderLine));

// ── the real run: what a human actually reads ────────────────────────────────────────────────────
const r = spawnSync(process.execPath, argvFor(TARGET), { cwd: root, encoding: 'utf8' });
const passLines = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('  ✓'));
const dirty = passLines.filter((l) => l.includes(' — '));
// A vacuous zero is the failure mode here: no output, or a crashed child, would also yield 0 dirty
// lines. The target prints hundreds of ✓ lines on any healthy tree.
check(`the real ${TARGET} run produced pass lines to judge`, passLines.length >= 50,
  `${passLines.length} ✓ line(s) — ${(r.stderr ?? '').slice(0, 200) || 'no stderr'}`);
check('…and not one of them carries an explanation (so check() really renders through renderLine)',
  dirty.length === 0, `${dirty.length} leaking line(s): ${dirty.slice(0, 2).join(' | ')}`);

console.log(`\n  ${passLines.length} pass line(s) read from the real run`);
console.log(failures === 0
  ? '✅ verify-barrier-pass-line-carries-no-failure-text: all checks passed.'
  : `❌ verify-barrier-pass-line-carries-no-failure-text: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
