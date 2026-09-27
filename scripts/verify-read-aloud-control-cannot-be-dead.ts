// THE 🔊 CONTROL IS OFFERED EXACTLY WHEN A TAP CAN DO SOMETHING.
//
//   node --experimental-strip-types scripts/verify-read-aloud-control-cannot-be-dead.ts   (npm test)
//
// TWO PREDICATES ASKED THE SAME QUESTION AND DISAGREED, AND THE GAP WAS SILENT.
//
//   render (FeedbackRow)       readAloudSegments?.length      — the SEGMENT count
//   act    (speakReadAloud)    !buildUnits(segments).length   — the SPEAKABLE UNIT count
//
// buildUnits() skips any segment whose `text.trim()` is empty, so a NON-EMPTY segment list can yield
// ZERO units. In that gap the control rendered and its tap did nothing a user could see — because the
// refusal that follows is readAloudRefusalVerdict({ voiceConfirmed: true, … }) → 'none' →
// readAloudRefusalMessageKey('none') → null. That null is right on its own terms (inventing a device
// verdict while the voice is fine would be the same class of lie in a new place), which is precisely
// why the control must not be OFFERED in that state rather than explained away in it.
// PART 5 shape #6: a control doing nothing on a genuine tap.
//
// WHAT THIS DOES AND DOES NOT CLAIM (ops_incident #856). It closes a defect PROVEN HERE by execution:
// the render/act disagreement is real and reachable. It is NOT claimed as the proven cause of the
// production observation (a silent 🔊, 3 occurrences in 32 runs on 2026-09-27, both viewports). That
// observation has a SECOND candidate this change does not touch — an utterance that starts against a
// stale cached voice and dies inside the journey's 700 ms read, which also shows no message — and the
// two have not been discriminated. Saying so is the point: PART 10.2's lesson is that when a surface
// is hard to observe, you make the failure VISIBLE rather than guess a third time. The journey now
// polls tightly after the tap to tell those two apart on the next occurrence.
//
// THE REAL SYMBOLS ARE LIFTED, NEVER RE-IMPLEMENTED. src/lib/readAloud.ts imports through the `@/`
// alias, which Node's ESM loader rejects, so it cannot be imported directly — and keeping a
// hand-copied buildUnits here is the drift class scripts/lib/liftSymbols.ts exists to kill
// (feedback_never-test-a-copy-of-production-code). The lift pulls the three real declarations that
// decide this question — splitIntoChunks, buildUnits and hasSpeakableContent — out of the shipped
// file and runs them.
import { readFileSync } from 'node:fs';
import { liftSymbols } from './lib/liftSymbols.ts';

type ReadAloudSegment = { text: string; pauseAfterMs?: number };

const lifted = await liftSymbols(
  'src/lib/readAloud.ts',
  [{ header: 'function splitIntoChunks(' },
   { header: 'export function hasSpeakableContent(' },
   { header: 'function buildUnits(' }],
  ['hasSpeakableContent'],
  "type Unit = { kind: 'speak'; text: string } | { kind: 'pause'; ms: number };\n"
  + 'type ReadAloudSegment = { text: string; pauseAfterMs?: number };\n',
);
const hasSpeakableContent = lifted.hasSpeakableContent as
  (s: ReadAloudSegment[] | undefined | null) => boolean;

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertions above are blind to the defect this file exists to catch');

const seg = (text: string, pauseAfterMs?: number): ReadAloudSegment =>
  ({ text, ...(pauseAfterMs ? { pauseAfterMs } : {}) }) as ReadAloudSegment;

// The pre-fix render predicate, verbatim in shape.
const renderedBefore = (s: ReadAloudSegment[] | undefined | null) => !!s?.length;

console.log('§1  THE DISAGREEMENT, EXECUTED — a non-empty segment list with nothing speakable in it');

// Every case is (segments, is there anything a voice could say?). The DEAD cases are the ones where
// the old render predicate said yes and speaking was impossible.
const CASES: Array<{ why: string; segs: ReadAloudSegment[]; speakable: boolean }> = [
  { why: 'ordinary Arabic prose',                segs: [seg('شقة للإيجار في الرياض')],      speakable: true  },
  { why: 'several real segments',                segs: [seg('عنوان'), seg('تفاصيل')],       speakable: true  },
  { why: 'real text with a trailing pause',      segs: [seg('نعم', 300)],                   speakable: true  },
  { why: 'text needing a trim but non-empty',    segs: [seg('  مرحبا  ')],                  speakable: true  },
  { why: 'ONE blank segment',                    segs: [seg('')],                           speakable: false },
  { why: 'ONE whitespace-only segment',          segs: [seg('   ')],                        speakable: false },
  { why: 'whitespace variants (tab/newline/nbsp)', segs: [seg('\t'), seg('\n'), seg(' ')], speakable: false },
  { why: 'several segments, all blank',          segs: [seg(''), seg('  '), seg('\n')],     speakable: false },
  { why: 'a blank segment carrying a pause',     segs: [seg('', 500)],                      speakable: false },
  { why: 'an empty list',                        segs: [],                                  speakable: false },
  // THE DISCRIMINATING PAIR, added because the half-fix mutant below SURVIVED without them: with no
  // case where the FIRST segment is blank and a LATER one speaks, "look at segments[0]" agrees with
  // the correct answer everywhere and the proof cannot see it. A mutation that survives is a hole in
  // the case table, not a passing check.
  { why: 'first segment blank, a LATER one speaks', segs: [seg(''), seg('نص حقيقي')],        speakable: true  },
  { why: 'first speaks, the rest blank',           segs: [seg('نص حقيقي'), seg('  ')],       speakable: true  },
];

for (const c of CASES) {
  check(`1.  ${c.why} → offered=${c.speakable}`,
    hasSpeakableContent(c.segs) === c.speakable,
    `hasSpeakableContent returned ${hasSpeakableContent(c.segs)}, expected ${c.speakable}`);
}
check('1.a  undefined/null segments are not offerable',
  !hasSpeakableContent(undefined) && !hasSpeakableContent(null));

// THE DEAD SET: exactly the cases where the OLD predicate offered a control that could not act.
const dead = CASES.filter((c) => renderedBefore(c.segs) && !c.speakable);
check(`1.b  the pre-fix predicate really did offer a dead control (${dead.length} such cases here)`,
  dead.length >= 5, `found ${dead.length}`);
check('1.c  …and the shipped predicate offers NONE of them',
  dead.every((c) => hasSpeakableContent(c.segs) === false));
check('1.d  …while every genuinely speakable case is STILL offered (the fix did not over-narrow — '
  + 'hiding a working control would be the opposite defect)',
  CASES.filter((c) => c.speakable).every((c) => hasSpeakableContent(c.segs) === true));

console.log('\n§1b MUTATION PROOF');
mustCatch('the pre-fix render predicate (production until this change), on the dead set',
  dead.length > 0 && dead.every((c) => renderedBefore(c.segs) === true && hasSpeakableContent(c.segs) === false));
// A "fix" that just returns false everywhere would pass §1.c and remove the feature.
mustCatch('a predicate that never offers the control at all',
  CASES.some((c) => c.speakable && hasSpeakableContent(c.segs) === true));
// A "fix" that only trimmed the FIRST segment — the plausible half-fix.
const halfFix = (s: ReadAloudSegment[]) => s.length > 0 && s[0].text.trim().length > 0;
const halfFixWrong = CASES.filter((c) => halfFix(c.segs) !== c.speakable);
mustCatch('a half-fix that only looks at the first segment',
  halfFixWrong.length === 0
    ? false   // if it happens to agree everywhere, say so rather than claim a kill
    : halfFixWrong.every((c) => hasSpeakableContent(c.segs) === c.speakable));

console.log('\n§2  WIRING — the component asks THIS predicate, not a second one');
const fr = readFileSync('src/components/FeedbackRow.tsx', 'utf8');
check('2.a  FeedbackRow gates the 🔊 on hasSpeakableContent(...)',
  /hasSpeakableContent\(readAloudSegments\)\s*\?/.test(fr),
  'the control must be rendered behind the same predicate speakReadAloud() enforces');
check('2.b  …and no longer on the bare segment count',
  !/\{readAloudSegments\?\.length\s*\?/.test(fr),
  'the pre-fix `readAloudSegments?.length ?` render gate is still present');

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
