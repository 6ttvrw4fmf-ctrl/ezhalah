// A HIT TEST THAT FOUND NOTHING IS NOT A NEIGHBOUR STEALING THE PRESS (ops_incident #120).
//
// `tap-targets-meet-44` probes five points of every 44px-marked control and asks who owns each one.
// It collapsed two different answers into the single string `'nothing'` and reported BOTH under a
// message that names a cause: «an expanded tap area is capturing presses meant for this control».
//
// That cause is only ever true when the point resolved to ANOTHER CONTROL — and in that case the
// probe already holds that control's label. When `document.elementFromPoint()` returns null, or
// lands on an element inside no control at all, nothing captured anything: the hit test found no
// control there. Reporting the first as the second is PART 9's error in its quietest form — a
// message that sounds like a diagnosis and is really a guess, filed against a product that may be
// behaving perfectly.
//
// WHAT HAPPENED. Journey sweep run 15 (main, 2026-09-06): the FIRST time this journey ever ran on
// WebKit and Firefox it produced 12 defects, and every one was the null branch — at all five points
// including the centre, on controls the rest of the same sweep taps successfully to navigate
// («تصفية» and «الوكيل الذكي» among them). The ledger confirms it was first contact, not a
// regression: `tap-targets-meet-44:webkit:mobile` and `:firefox:mobile` both at times_tested = 1,
// while `:mobile` (chromium) sat at 5 and passing.
//
// Whether that null is a genuinely unreachable control on those engines or a probe artifact is NOT
// established, and neither this barrier nor the fix decides it. What they do is make the two shapes
// SAY WHAT THEY ARE, and carry the rect and viewport numbers, so the next per-engine sweep answers
// the question instead of restating the guess (PART 11.2 rule 4; the #1053 precedent — instrument
// rather than guess a third time).
//
// NEITHER SHAPE IS EXCUSED. Both still fail the journey, and §2 asserts that in both directions: a
// discriminator that only ever excuses is the blindfold PART 9 warns about.
//
// Run: node --experimental-strip-types scripts/verify-journey-tap-ownership-discriminator.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';
import { classifyTapOwnership } from '../e2e/journeys/harness.mjs';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, cond: boolean) => {
  if (cond) console.log(`  ok  ${m}`);
  else { console.error(`  FAIL  ${m}`); failed++; }
};
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught);

// ═══ §1 · the classifier, executed, on every shape the probe can produce ════════════════════════
console.log('§1 the three answers a probed point can give');
{
  // A real neighbour capture — the finding this journey exists for. Must stay a capture.
  const r = classifyTapOwnership({ left: { hitNull: false, hitTag: 'div', ownerLabel: 'sidebar-toggle' } });
  check('a point resolving to ANOTHER CONTROL is a capture, named by that control',
    r.stolen.left === 'sidebar-toggle' && Object.keys(r.blind).length === 0);
}
{
  // The #120 shape: elementFromPoint returned null. Nothing captured anything.
  const r = classifyTapOwnership({ centre: { hitNull: true, hitTag: null, ownerLabel: null } });
  check('a NULL hit test is blind, never a capture',
    Object.keys(r.stolen).length === 0 && r.blind.centre === 'the hit test returned no element at all');
}
{
  // Hit something real, but it is inside no control — also not a capture, and a different story
  // from a null: the engine resolved the point, it just did not land in a control.
  const r = classifyTapOwnership({ top: { hitNull: false, hitTag: '<span> 10x10 at 0,0 z=auto pos=static pointer-events=auto', ownerLabel: null } });
  check('a point landing on a NON-CONTROL element is blind, and says what it landed on',
    Object.keys(r.stolen).length === 0
      && r.blind.top === 'the hit test landed on <span> 10x10 at 0,0 z=auto pos=static pointer-events=auto, which is inside no control');
}
{
  // THE MEASURED CASE (#120, WebKit sweep 2026-09-06): the point resolved to a THIRD-PARTY
  // OVERLAY, not to app furniture and not to nothing. Naming it — and its box — is what turned
  // «resolves to nothing» into a diagnosis, so the descriptor must survive into the message
  // intact: an overlay's identity, geometry and z-index are the finding.
  const GIS = '<iframe src=https://accounts.google.com/gsi/iframe/select> 375x144 at 0,668 z=9999 pos=fixed pointer-events=auto';
  const r = classifyTapOwnership({ centre: { hitNull: false, hitTag: GIS, ownerLabel: null } });
  check('an overlaying third-party frame is reported with its src, box and z-index, not as «nothing»',
    r.blind.centre === `the hit test landed on ${GIS}, which is inside no control`
      && r.blind.centre.includes('accounts.google.com') && r.blind.centre.includes('z=9999'));
}
{
  // A descriptor the page could not build must not silently become an empty message.
  const r = classifyTapOwnership({ left: { hitNull: false, hitTag: null, ownerLabel: null } });
  check('an undescribable hit still reports a blind point rather than an empty string',
    r.blind.left === 'the hit test landed on an element it could not describe, which is inside no control');
}
{
  // Mixed: the two must not contaminate each other.
  const r = classifyTapOwnership({
    centre: { hitNull: true, hitTag: null, ownerLabel: null },
    right: { hitNull: false, hitTag: 'div', ownerLabel: 'another control' },
  });
  check('a control with one captured point and one blind point reports BOTH, separately',
    r.stolen.right === 'another control' && r.blind.centre && Object.keys(r.stolen).length === 1
      && Object.keys(r.blind).length === 1);
}
{
  // Owned points never reach the classifier — the probe drops them at `if (o === e) continue`.
  const r = classifyTapOwnership({});
  check('a control that owns every point produces no finding at all',
    Object.keys(r.stolen).length === 0 && Object.keys(r.blind).length === 0);
  const n = classifyTapOwnership(undefined as never);
  check('a missing point map is empty, not a crash',
    Object.keys(n.stolen).length === 0 && Object.keys(n.blind).length === 0);
}
// THE DIRECTION THAT MUST NOT BE EXCUSED. The whole 12-defect WebKit observation must still be 12
// findings — split into the right bucket, not silenced.
{
  const fivePoints = ['centre', 'left', 'right', 'top', 'bottom'];
  const pts = Object.fromEntries(fivePoints.map((k) => [k, { hitNull: true, hitTag: null, ownerLabel: null }]));
  const r = classifyTapOwnership(pts);
  check('the measured WebKit shape (all five points null) still produces five findings — nothing is swallowed',
    Object.keys(r.blind).length === 5 && Object.keys(r.stolen).length === 0);
}

// ═══ §2 · mutations — the real file is edited and re-executed ═══════════════════════════════════
console.log('\n§2 mutations');
{
  const HARNESS = join(ROOT, 'e2e/journeys/harness.mjs');
  const original = readFileSync(HARNESS, 'utf8');
  const { writeFileSync } = await import('node:fs');

  // Signal-safe restore — see the identical block in verify-guardian-oracles-discriminate.ts for the
  // full reasoning. In short: this mutates a TRACKED file in place, the `finally` below does not run
  // on a signal, scripts/run-tests.mjs treats a signal-killed child as a failure because it happens,
  // and this working directory is shared by concurrent sessions with no isolation — so a mutant left
  // by a timeout is one `git add -A` away from being committed by someone else.
  const restore = () => { try { writeFileSync(HARNESS, original); } catch { /* best effort */ } };
  const onSignal = (sig: NodeJS.Signals) => {
    restore();
    process.removeListener(sig, onSignal);
    process.kill(process.pid, sig);
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  process.once('exit', restore);

  let n = 0;
  const withMutation = async (
    label: string,
    mutate: (s: string) => string,
    expectBroken: (r: { stolen: Record<string, string>; blind: Record<string, string> }) => boolean,
    pts: unknown,
  ) => {
    const mutated = mutate(original);
    if (mutated === original) {
      console.error(`  FAIL  (mutation) «${label}» changed nothing — the anchor missed`); failed++; return;
    }
    writeFileSync(HARNESS, mutated);
    try {
      const mod = await import(`../e2e/journeys/harness.mjs?tapmut=${++n}`);
      mustCatch(label, expectBroken(mod.classifyTapOwnership(pts)));
    } catch (e) {
      // A THROW IS NOT A KILLED MUTATION — the evidence has to be the behaviour changing, never the
      // module falling over (the same rule verify-guardian-oracles-discriminate.ts states).
      console.error(`  FAIL  (mutation) «${label}» broke the module instead of changing its `
        + `behaviour — no behavioural evidence was obtained: ${String(e).slice(0, 120)}`);
      failed++;
    } finally {
      writeFileSync(HARNESS, original);
    }
  };

  const NULL_PT = { centre: { hitNull: true, hitTag: null, ownerLabel: null } };

  // M1 — THE DEFECT ITSELF: fold the null branch back into the capture bucket, which is what the
  // journey did for the whole time this went unnoticed.
  await withMutation(
    'folding a null hit test back into the capture bucket (#120: «nothing» reported as a neighbour stealing the press)',
    (s) => s.replace(
      "    if (p && p.ownerLabel) stolen[k] = p.ownerLabel;\n    else if (p && p.hitNull) blind[k] = 'the hit test returned no element at all';",
      "    if (p && p.ownerLabel) stolen[k] = p.ownerLabel;\n    else if (p && p.hitNull) stolen[k] = 'nothing';"),
    (r) => r.stolen.centre !== undefined && r.blind.centre === undefined,
    NULL_PT,
  );

  // M2 — THE QUIET DIRECTION, and the one that would look like a fix: excuse the null entirely.
  // The 12 WebKit findings would vanish and the journey would go green on an unanswered question.
  await withMutation(
    'excusing a null hit test entirely, so an unreachable control would report nothing at all',
    (s) => s.replace(
      "    else if (p && p.hitNull) blind[k] = 'the hit test returned no element at all';",
      '    else if (p && p.hitNull) continue;'),
    (r) => Object.keys(r.blind).length === 0 && Object.keys(r.stolen).length === 0,
    NULL_PT,
  );

  // M3 — the opposite contamination: a genuine neighbour capture demoted to blind, which would
  // retire the finding this journey was built for.
  await withMutation(
    'demoting a real neighbour capture to a blind hit test, retiring the journey\'s original finding',
    (s) => s.replace('    if (p && p.ownerLabel) stolen[k] = p.ownerLabel;',
      '    if (p && p.ownerLabel) blind[k] = p.ownerLabel;'),
    (r) => Object.keys(r.stolen).length === 0,
    { left: { hitNull: false, hitTag: 'div', ownerLabel: 'sidebar-toggle' } },
  );
}

// ═══ §3 · the journey actually routes through it, and still carries the evidence ════════════════
// The classifier is worthless if run.mjs keeps its own copy of the verdict, and the null branch is
// worthless as a lead if the message does not carry the numbers needed to read it next run.
console.log('\n§3 the journey uses the classifier and reports what it measured');
{
  const runner = readFileSync(join(ROOT, 'e2e/journeys/run.mjs'), 'utf8');
  check('tap-targets-meet-44 gets its verdict from classifyTapOwnership, not a local re-derivation',
    runner.includes('classifyTapOwnership(c.stolen)'));
  check('the blind case is reported under its own message, not the capture one',
    runner.includes('the tap-target hit test found no control at the control'));
  check('the blind message carries the rect and the viewport it was measured against',
    /rect\(x,y,w,h\)=\$\{JSON\.stringify\(c\.rect\)\} viewport=\$\{JSON\.stringify\(vp\)\}/.test(runner));
  check('the probe still reports raw facts (hitNull / ownerLabel), so the verdict stays in one place',
    runner.includes('hitNull: !hit') && runner.includes('ownerLabel: o ?'));
  check('the probe NAMES and MEASURES what it hit (src, box, z-index) — the half that ended #120\'s diagnosis',
    runner.includes('hitTag: hit ? desc(hit) : null')
      && /src=.*String\(el\.src\)/.test(runner) && runner.includes("' z=' + cs.zIndex"));
  check('this barrier runs in npm test', npmTestRuns(ROOT, 'verify-journey-tap-ownership-discriminator'));
}

if (failed) { console.error(`\nverify-journey-tap-ownership-discriminator: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-journey-tap-ownership-discriminator: a hit test that found nothing says so, and still fails.');
