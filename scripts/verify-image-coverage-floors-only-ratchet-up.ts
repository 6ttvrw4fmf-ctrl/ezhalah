// THE RATCHET IS NOW ACTUALLY A RATCHET — barrier engineer, 2026-09-13.
//
// scripts/image-coverage-baseline.json has carried this line in its own header since it was created:
//
//     "Raise floors when a fix lands; never lower one to clear a red — a drop is an incident."
//
// NOTHING ENFORCED IT. I found that out by breaking it. On 2026-09-13 I lowered wasalt's floor from
// 90 to 86 to clear a standing red, on an adjudication that was circular: I read
// source_capture->>'image_count' = 0 as the source saying "no photos", when that field is written as
// len(photo_urls) — a restatement of what WE stored, so a photo-less row reads 0 by construction and
// says nothing about the source (PR #2506; retraction on PR #2512). The edit was caught only because
// another session happened to land the fix that exposed the circularity, and `npm test` was green
// the whole time the change sat in review.
//
// So the rule that would have stopped me did not exist. It does now.
//
// WHAT IS ASSERTED, by diffing the WORKING TREE against the COMMITTED baseline at HEAD:
//   * a floor may RISE freely — that is a fix landing, and needs no ceremony;
//   * a floor may FALL only with a complete `rebased` declaration on that platform's entry
//     ({from, to, why, evidence}) whose numbers match the actual change;
//   * REMOVING a floor is lowering it to zero, and is refused the same way;
//   * a `rebased` block that misstates the move it describes is itself a failure, because a false
//     record is worse than none.
//
// It cannot judge whether a reason is a GOOD one — no file-level check can. It forces the claim to be
// written, in the first person, where a reviewer reads it. That is strictly more than zero, which is
// what the prose rule had.
//
// WHY THE DIFF IS AGAINST git HEAD and not a second checked-in copy: a mirrored "previous floors"
// file is one more thing to forget to update, and its staleness would be invisible. The committed
// file IS the previous state, by definition, and `git show HEAD:<path>` is exact.
//
//   node --experimental-strip-types scripts/verify-image-coverage-floors-only-ratchet-up.ts
//   (in `npm test`)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { floorRatchetProblems, type FloorMap } from './lib/floorRatchet.ts';

const ROOT = join(import.meta.dirname, '..');
const REL = 'scripts/image-coverage-baseline.json';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

console.log('\nImage-coverage floors ratchet UP only (a lowered floor must declare itself)\n');

const after = (JSON.parse(readFileSync(join(ROOT, REL), 'utf8')).platforms ?? {}) as FloorMap;

// The committed state. If HEAD has no such file (a fresh branch that adds it), there is no previous
// floor to lower and the ratchet has nothing to say — but a FAILED read must never be mistaken for
// that, so the two cases are distinguished rather than both falling through to "{}".
let before: FloorMap | null = null;
let headMissing = false;
try {
  const raw = execFileSync('git', ['show', `HEAD:${REL}`], { cwd: ROOT, encoding: 'utf8' });
  before = (JSON.parse(raw).platforms ?? {}) as FloorMap;
} catch (e) {
  const msg = String((e as Error).message || e);
  // git says "path ... does not exist" / "exists on disk, but not in HEAD" when the file is new.
  headMissing = /does not exist|exists on disk/i.test(msg);
  if (!headMissing) {
    check('the committed baseline could be read from git HEAD', false,
      `${msg.trim().split('\n')[0]} — refusing to report a ratchet verdict this run could not compute`);
  }
}

if (before) {
  const problems = floorRatchetProblems(before, after);
  check(`every floor in ${REL} is >= its committed value, or declares why not`,
    problems.length === 0, problems.join('\n      '));
  console.log(`      compared ${Object.keys(after).length} platform(s) against HEAD`);
} else if (headMissing) {
  check(`${REL} is new in this change — no previous floor exists to lower`, true);
}

// ── MUTATION PROOF — the real predicate, against the exact edit I made and others ────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

const W = (floor: number, rebased?: Record<string, unknown>) =>
  ({ wasalt: { floor_pct: floor, ...(rebased ? { rebased } : {}) } } as FloorMap);

// THE REAL EDIT OF 2026-09-13, replayed. This is the one that must never pass silently again.
mustCatch('the actual wasalt 90 -> 86 edit, undeclared (the defect this file exists for)',
  floorRatchetProblems(W(90), W(86)).length > 0);

// A declaration that is present but hollow is not a declaration.
mustCatch('a lowered floor whose `rebased` omits its evidence',
  floorRatchetProblems(W(90), W(86, { from: 90, to: 86, why: 'source changed' })).length > 0);
mustCatch('a lowered floor whose `rebased` omits its reason',
  floorRatchetProblems(W(90), W(86, { from: 90, to: 86, evidence: 'measured' })).length > 0);

// A declaration that misdescribes its own change is a false record.
mustCatch('a `rebased` block that misstates the floor it came from',
  floorRatchetProblems(W(90), W(86, { from: 95, to: 86, why: 'w', evidence: 'e' })).length > 0);
mustCatch('a `rebased` block that misstates the floor it moved to',
  floorRatchetProblems(W(90), W(86, { from: 90, to: 88, why: 'w', evidence: 'e' })).length > 0);

// Deleting the floor is lowering it, with extra steps.
mustCatch('a floor REMOVED rather than lowered',
  floorRatchetProblems(W(90), { wasalt: {} }).length > 0);

// ── And the other direction, so this is not a rule that is red for everything ───────────────────
mustCatch('a RAISED floor being refused (a fix landing needs no ceremony)',
  floorRatchetProblems(W(90), W(93)).length === 0);
mustCatch('an UNCHANGED floor being refused',
  floorRatchetProblems(W(90), W(90)).length === 0);
mustCatch('a COMPLETE rebase declaration being refused',
  floorRatchetProblems(W(90), W(86, {
    from: 90, to: 86, why: 'the source now publishes fewer photos', evidence: 'measured on N rows',
  })).length === 0);
mustCatch('a NEWLY declared platform being treated as a lowered floor',
  floorRatchetProblems({}, W(72)).length === 0);
mustCatch('a platform declared imageless_at_source being treated as a removed floor',
  floorRatchetProblems(W(90), { wasalt: { imageless_at_source: true } }).length === 0);

console.log('');
console.log(failed === 0
  ? 'PASS — floors ratchet up; a fall must declare itself, and the declaration must be true.'
  : `FAIL — ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
