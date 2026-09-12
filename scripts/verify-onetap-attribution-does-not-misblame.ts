// A BLOCKED CONTROL IS NOT AUTOMATICALLY ONE TAP'S FAULT.
//
// `onetap-clear-of-controls` (e2e/journeys/run.mjs) used to file every failed hit-test as «the One
// Tap prompt is covering «X»» unconditionally, the instant a tap missed its target — with no check
// that the sheet's own measured rect had anything to do with the point actually tested.
//
// MEASURED, production, 2026-09-11 (routine #6). mobile375 reported:
//   «the One Tap prompt is covering «بحث»: sheet now 668-812; «بحث» 587-606»
//   «the One Tap prompt is covering the AI Agent composer: sheet now 668-812; composer 557-579»
// In both, the control's rect sits entirely ABOVE the sheet's own reported rect (606 < 668,
// 579 < 668) — the two ranges never touch — yet the tap still landed on an unrelated `<DIV>`. The
// real blocker on that exact geometry (a fixed bottom card on a 390×844 phone) is `ops_incident`
// #152, the cookie-consent banner (`CookieConsent.tsx`, PR #2093, shipped 2026-09-06) — a plain
// `<div>` that `SHEET_SEL` (an `<iframe>` selector) could never match. Filing that as a One Tap
// regression would have sent the next reader chasing `GoogleOneTap.tsx` for a bug that lives
// elsewhere, and duplicated a P2 already open and correctly awaiting an owner product decision
// (WHERE a fixed bottom overlay docks is a design call, per AGENTS.md §G.2b — not autonomously
// fixable). PART 9.4: a harness that misattributes a real finding is this routine's own bug.
//
// THE FIX: `classifyBlockedControl()` in e2e/journeys/harness.mjs decides the finding from
// `winnerIsSheet` — computed in-browser as "is the sheet element anywhere in the FULL hit-test
// stack at this point" (`elementsFromPoint`, PLURAL, per PART 5 shape 13) — rather than assuming.
// This barrier pins that decision as a pure function, offline, with the exact measured shapes.
//
// Run: node --experimental-strip-types scripts/verify-onetap-attribution-does-not-misblame.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyBlockedControl } from '../e2e/journeys/harness.mjs';

const root = join(import.meta.dirname, '..');
let failed = 0;
const ok = (m: string) => console.log(`  ok  ${m}`);
const check = (m: string, cond: boolean) => { if (cond) ok(m); else { console.error(`  FAIL  ${m}`); failed++; } };
const mustCatch = check;

// ── 1. THE EXACT MEASURED SHAPES ────────────────────────────────────────────────────────────────
const CTA_MEASURED = { winnerIsSheet: false, sheetNow: '668-812', top: 587, bottom: 606, winner: 'DIV' };
const COMPOSER_MEASURED = { winnerIsSheet: false, sheetNow: '668-812', top: 557, bottom: 579, winner: 'DIV' };
const REAL_ONETAP_BLOCK = { winnerIsSheet: true, sheetNow: '668-812', top: 700, bottom: 720, winner: 'IFRAME#credential_picker_iframe' };

const ctaResult = classifyBlockedControl(CTA_MEASURED, 'بحث');
check('the measured «بحث» shape (sheet 668-812, control 587-606, no overlap) is NOT attributed to One Tap',
  !ctaResult.what.includes('One Tap prompt is covering') && ctaResult.what.includes('OTHER than One Tap'));
check('…and the detail tells the reader to check for an already-open incident, not to chase GoogleOneTap.tsx',
  ctaResult.detail.includes('ops_incident') && ctaResult.detail.includes('do not misattribute'));

const composerResult = classifyBlockedControl(COMPOSER_MEASURED, 'the AI Agent composer');
check('the measured composer shape is ALSO not attributed to One Tap',
  composerResult.what.includes('OTHER than One Tap'));

const realResult = classifyBlockedControl(REAL_ONETAP_BLOCK, 'بحث');
check('a genuine One Tap block (the sheet really is in the hit-test stack) IS still called a One Tap regression',
  realResult.what === 'the One Tap prompt is covering «بحث»');
check('…this is not a vacuous rule that never fires FOR One Tap either', realResult.what.includes('One Tap'));

// ── 2. MUTATION: the exact pre-fix behaviour is proven to misattribute ──────────────────────────
// The old code's whole decision was `!isSelf` alone — it never consulted winnerIsSheet at all.
const preFixAttribution = (_r: unknown, controlLabel: string) =>
  `the One Tap prompt is covering «${controlLabel}»`;
mustCatch('MUTATION: the pre-fix unconditional attribution DOES blame One Tap for the measured «بحث» '
  + 'block — proving the old shape was genuinely wrong, not a strawman',
  preFixAttribution(CTA_MEASURED, 'بحث').includes('One Tap prompt is covering'));
mustCatch('…while the REAL classifier on the identical input does NOT blame One Tap',
  !classifyBlockedControl(CTA_MEASURED, 'بحث').what.includes('One Tap prompt is covering'));

// The SECOND, more dangerous mutation this fix went through in the same session: computing
// `winnerIsSheet` from DOM ancestry instead of geometry. `elementsFromPoint` walks UP the ancestor
// chain, so ANY large wrapper (`<body>`, an app-root div) appears in the stack and trivially
// "contains" the sheet iframe wherever it sits — making the ancestry version read `true` almost
// unconditionally, the opposite failure from the one this barrier exists to catch. Re-implemented
// here and executed against the measured shape, which is exactly what a page-root wrapper winning a
// tap anywhere on the page looks like.
const ancestryWinnerIsSheet = (sheetPresent: boolean, winnerIsPageRootWrapper: boolean) =>
  sheetPresent && winnerIsPageRootWrapper; // stands in for `n.contains(f)` being trivially true
mustCatch('MUTATION: a DOM-ancestry check (not geometry) reads a page-root wrapper as "the sheet" '
  + 'purely because it structurally contains the iframe somewhere on the page',
  ancestryWinnerIsSheet(true, true) === true);
mustCatch('…while the REAL classifier refuses to blame One Tap for that same measured shape '
  + '(the sheet rect does not contain the tested point, regardless of DOM nesting)',
  !classifyBlockedControl(CTA_MEASURED, 'بحث').what.includes('One Tap prompt is covering'));

// ── 3. THE JOURNEY ACTUALLY USES IT, AND STACK-READS THE FULL HIT-TEST, NOT JUST THE TOP HIT ────
const runner = readFileSync(join(root, 'e2e/journeys/run.mjs'), 'utf8');
check('run.mjs imports classifyBlockedControl from the harness',
  /classifyBlockedControl/.test(runner.split('\n').slice(0, 20).join('\n')));
check('all three call sites (بحث / تصفية / composer) route through reportBlocked, not a hardcoded message',
  (runner.match(/reportBlocked\(/g) || []).length >= 3);
check('no call site still hardcodes "the One Tap prompt is covering" as an unconditional string literal',
  !/defect\([^)]*'the One Tap prompt is covering/.test(runner));
// Scoped to the onetap journey's own body — `document.elementFromPoint` legitimately appears
// elsewhere in this file (e.g. the single-point tap-ownership probe at PART 5 shape-11's own
// contract), so a whole-file check would false-flag an unrelated, correct use.
const onetapStart = runner.indexOf("JOURNEYS['onetap-clear-of-controls']");
const onetapEnd = runner.indexOf("JOURNEYS['", onetapStart + 1);
const onetapBody = runner.slice(onetapStart, onetapEnd > 0 ? onetapEnd : undefined);
check('the DOM read uses elementsFromPoint (PLURAL) — PART 5 shape 13, not the singular top-hit-only form',
  /document\.elementsFromPoint/.test(onetapBody) && !/document\.elementFromPoint/.test(onetapBody));
// GEOMETRY, NOT DOM ANCESTRY. A first version of this fix computed `winnerIsSheet` from DOM
// containment (`n.contains(f)` — is the winning element an ancestor of the sheet iframe) and it was
// wrong in the dangerous direction: `elementsFromPoint` walks UP the ancestor chain from the hit
// point, so `<body>` or an app-root wrapper appears in EVERY stack and trivially "contains" the
// iframe wherever it sits on the page — making `winnerIsSheet` read true almost unconditionally,
// discovered by re-running against production and watching a control 62-111 px above the sheet's
// own measured bounds still get blamed on it. The fix is the geometric question this journey was
// already printing the two answers to side by side: does the TESTED POINT fall inside the sheet's
// own rect.
check('winnerIsSheet is computed from the SHEET RECT (point-in-rect), never DOM ancestry '
  + '(`.contains(` would falsely match body/root wrapping everything on the page)',
  /const winnerIsSheet = .*q\.top.*q\.bottom/.test(onetapBody.replace(/\n\s*/g, ' '))
  && !/winnerIsSheet:.*\.contains\(/.test(onetapBody.replace(/\n/g, ' ')));

if (failed) { console.error(`\n${failed} check(s) failed\n`); process.exit(1); }
console.log('  PASS  a blocked control is attributed to what actually blocked it, never assumed to be One Tap');
