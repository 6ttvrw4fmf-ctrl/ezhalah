// THE "IS THE DRAWER OPEN?" ORACLE MUST NOT ANSWER YES TO A CONTROL OUTSIDE THE DRAWER.
//
// `e2e/journeys/harness.mjs`'s `openMobileSidebar()` returns early when it believes the drawer is
// already on screen. Every mobile journey's coverage rests on that belief: if it is wrong in the
// TRUE direction, the function opens nothing, reports success, and every assertion downstream is
// judged against a screen that does not contain the thing being judged.
//
// That happened (measured 2026-09-03, routine #6). The guest oracle matched the CTA's visible TEXT,
// «إنشاء حساب / تسجيل الدخول» — a string `src/app/index.tsx` also renders in the mobile TOP BAR
// (`s.topSignIn`, owner 2026-08-19, added precisely because the drawer hides the CTA until the
// hamburger is tapped). So on any signed-out mobile screen the oracle said "open" before a tap.
//
// The cost was three assertions in `signout-leaves-no-trace` that could not fail on mobile —
// "signed-in chrome is gone after sign-out", the on-screen leak check, and the post-reload leak
// check — because with the drawer closed neither `account-menu-trigger` nor any seeded chat title is
// rendered, for reasons that have nothing to do with sign-out. The ledger recorded 4/4 passes. This
// is PART 9.4's harness defect in its most expensive costume: not a red run, a green one.
//
// WHAT THIS PINS, by EXECUTING the real predicate (never string-matching it) against a fake page:
//   1. guest, drawer CLOSED  → false. The top bar's identical CTA text must not read as "open".
//   2. guest, drawer OPEN    → true  (via `sidebar-signin-cta`, which only the drawer renders).
//   3. signed-in, closed/open→ false / true (via `sidebar-search-btn`).
//   4. guestOk defaults to OFF: a signed-in journey must not accept the guest marker, so a failed
//      session seed stays an honest skip instead of a confusing mid-journey failure.
//   5. The oracle stays SELECTOR-only. `getByText` is what made it match the wrong node, and a fake
//      page proves nothing if the predicate can reach for text again — so a text read throws here.
//   6. The app still ships both markers: `sidebar-signin-cta` in Sidebar.tsx's guest branch and
//      `sidebar-search-btn` in its signed-in branch. An oracle keyed on a testID nobody renders is
//      the same blindness with a different selector.
//
// Run: node --experimental-strip-types scripts/verify-journey-mobile-sidebar-oracle.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sidebarIsOpen, SIDEBAR_OPEN_MARKER, SIDEBAR_OPEN_MARKER_GUEST,
  topDockBandBottom, pickHamburgerRect, isBottomDocked,
  APP_MIN_FRACTION, TOP_DOCK_MIN_SPAN_FRACTION, dockedBandCap,
} from '../e2e/journeys/harness.mjs';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, cond: boolean) => {
  if (cond) console.log(`  ok  ${m}`);
  else { console.error(`  FAIL  ${m}`); failed++; }
};

/**
 * A page that renders exactly the selectors it is given — and THROWS on any text read, because
 * reaching for visible text is the specific mistake this barrier exists to prevent.
 */
function fakePage(selectors: string[]) {
  return {
    locator: (sel: string) => ({ count: async () => (selectors.includes(sel) ? 1 : 0) }),
    getByText: () => { throw new Error('the open-oracle read visible TEXT — that is the defect'); },
    getByPlaceholder: () => { throw new Error('the open-oracle read a placeholder — see above'); },
  };
}

// The mobile home for a signed-out visitor with the drawer CLOSED: the top bar's own sign-in
// button is on screen, and nothing the sidebar renders is.
const GUEST_CLOSED = fakePage([]);
const GUEST_OPEN = fakePage([SIDEBAR_OPEN_MARKER_GUEST]);
const SIGNED_IN_CLOSED = fakePage([]);
const SIGNED_IN_OPEN = fakePage([SIDEBAR_OPEN_MARKER]);

/**
 * Ask the oracle, and turn a THROW into a named failure rather than a stack trace. A text-based
 * oracle trips fakePage()'s guard, and "the oracle read visible text" is the diagnosis the next
 * reader needs — PART 11.2 rule 4: the failure message must distinguish the two shapes itself.
 */
/**
 * THE ORACLE'S JUDGEMENT AS A PURE PREDICATE (routine #10, 2026-09-26, ops_incident #728).
 *
 * This used to be six `await asks(...)` calls straight onto `sidebarIsOpen`. That EXECUTES the right
 * function — which is why this barrier was never a source-text tripwire — but it leaves no seam to
 * hand a BROKEN oracle to, so the barrier's own judgement could never be watched to fail. The
 * mutations behind it were run by hand in the session that landed it (PR #4317) and nothing
 * re-executed them, which is the PART 1.11 shape at one remove: a claim of proof reading as coverage.
 *
 * So the verdict takes the oracle as an argument. The real check below passes the REAL
 * `sidebarIsOpen`; §E passes deliberately broken ones — including the text-reading oracle that is the
 * defect this file was written for. There is no second copy of the judgement (R1 step 2).
 *
 * A THROW is turned into a named problem rather than a stack trace: a text-based oracle trips
 * fakePage()'s guard, and "the oracle read visible text" is the diagnosis the next reader needs.
 */
type Oracle = (page: unknown, opts: { guestOk?: boolean }) => Promise<boolean>;

const oracleProblems = async (oracle: Oracle): Promise<string[]> => {
  const p: string[] = [];
  const asks = async (label: string, page: unknown, opts: { guestOk?: boolean }, want: boolean) => {
    let got: boolean;
    try { got = await oracle(page, opts); }
    catch (e) { p.push(`${label} — the oracle threw: ${String((e as Error).message)}`); return; }
    if (got !== want) p.push(`${label} (got ${got}, want ${want})`);
  };
  await asks('guest + drawer CLOSED reads as CLOSED (the top-bar CTA must not count)', GUEST_CLOSED, { guestOk: true }, false);
  await asks('guest + drawer OPEN reads as OPEN', GUEST_OPEN, { guestOk: true }, true);
  await asks('signed-in + drawer CLOSED reads as CLOSED', SIGNED_IN_CLOSED, {}, false);
  await asks('signed-in + drawer OPEN reads as OPEN', SIGNED_IN_OPEN, {}, true);
  await asks('guestOk is OFF by default — the guest marker alone does not satisfy a signed-in journey', GUEST_OPEN, {}, false);
  await asks('the signed-in marker still satisfies a guest-tolerant call', SIGNED_IN_OPEN, { guestOk: true }, true);
  return p;
};

const realOracleProblems = await oracleProblems(sidebarIsOpen as Oracle);
check(`the drawer oracle answers only to the drawer, and guestOk stays OFF by default${realOracleProblems.length ? ` — ${realOracleProblems.join(' | ')}` : ''}`,
  realOracleProblems.length === 0);

// (5) is enforced by fakePage() throwing; prove the throw is real rather than trusting it.
try {
  (fakePage([]) as unknown as { getByText: () => void }).getByText();
  check('the fake page rejects a text read', false);
} catch { check('the fake page rejects a text read (so a text-based oracle cannot pass here)', true); }

// (6) — the markers must exist in the app, in the branch each one is supposed to identify.
const sidebar = readFileSync(join(ROOT, 'src/components/Sidebar.tsx'), 'utf8');
const testId = (sel: string) => sel.replace('[data-testid="', '').replace('"]', '');
check(`Sidebar.tsx renders the guest marker (${testId(SIDEBAR_OPEN_MARKER_GUEST)})`,
  sidebar.includes(`'${testId(SIDEBAR_OPEN_MARKER_GUEST)}'`) || sidebar.includes(`"${testId(SIDEBAR_OPEN_MARKER_GUEST)}"`));
check(`Sidebar.tsx renders the signed-in marker (${testId(SIDEBAR_OPEN_MARKER)})`,
  sidebar.includes(`'${testId(SIDEBAR_OPEN_MARKER)}'`) || sidebar.includes(`"${testId(SIDEBAR_OPEN_MARKER)}"`));

// The top bar's duplicate CTA is the reason a text oracle is unsafe. If it ever moves, this
// barrier's premise is worth re-reading rather than silently outliving it.
const home = readFileSync(join(ROOT, 'src/app/index.tsx'), 'utf8');
check('src/app/index.tsx still renders its own top-bar sign-in CTA (the node the old oracle matched)',
  /topSignIn/.test(home) && /Sign up \/ Log in/.test(home));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §B — AND THE OTHER HALF OF openMobileSidebar(): FINDING THE HAMBURGER AT ALL
//      (ops_incident #593, routine #6, 2026-09-23)
//
// §A above pins the question "is the drawer open?". This pins "where is the button that opens it?",
// because the same function can be defeated at either end — and it was, for as long as the top-bar
// locator used an ABSOLUTE window, `r.y < 80`.
//
// That constant is true only while nothing is docked over the app's top edge, and the app itself
// moves the top bar down whenever something is: `src/app/_layout.tsx:103` applies
// `paddingTop: promptInset.top`, which is the owner rule of 2026-09-06 being obeyed («One Tap must
// never cover, block, or intercept any Ezhalah controls»). So the RESERVATION WORKING is what hid
// the control from the probe — the identical shape as PART 5 #13 / ops_incident #262, where a
// control clipped by a correctly-working inset was filed as «blocked».
//
// MEASURED on production, Chromium, 375x812, signed out, 2/2 fresh contexts, 2026-09-23, with the
// WebKit top-dock shape injected (static gsi iframe inside a fixed #credential_picker_container,
// 375x158 at 0,20 — the shape ops_incident #202 measured on WebKit):
//   no dock  → hamburger [18,22,34,34]  → old locator finds (35,39)
//   top dock → hamburger [18,174,34,34] → old locator returns **null**, 2/2
//   clicking the real displaced hamburger opened the drawer 2/2 — the product was never broken
// On WebKit, One Tap docks to the TOP rather than the bottom, so the two journeys that run SIGNED
// OUT on mobile (`guestOk: true` — the only two that ever meet a prompt) skipped on every sweep
// with «the mobile drawer would not open», while Chromium stayed green.
//
// WHAT THIS PINS, by EXECUTING the real pure functions (never string-matching them):
//   B1. No dock → the band is 0 and the original behaviour is preserved, byte for byte.
//   B2. The measured WebKit top dock → the band is the CONTAINER's bottom (178), not the static
//       iframe's (170), and the displaced hamburger at y=174 is found.
//   B3. A BOTTOM dock (Chromium's own shape) reserves nothing up here — the top bar stays put.
//   B4. A desktop CORNER card does not span the viewport and must reserve nothing.
//   B5. A hidden / zero-height prompt reserves nothing.
//   B6. The probe must not pick a control belonging to the PROMPT: a box inside the reserved band
//       is above the content's top edge and loses.
//   B7. The window stays RELATIVE and BOUNDED — a control far below the band is not the top bar.
// The two engines' measured container shapes, from src/lib/bottomPromptInset.ts's own notes.
const WEBKIT_TOP_DOCK = { top: 20, bottom: 178, height: 158, width: 375 };   // fixed container
const WEBKIT_INNER_IFRAME = { top: 20, bottom: 170, height: 150, width: 375 }; // static iframe
const CHROMIUM_BOTTOM_SHEET = { top: 668, bottom: 812, height: 144, width: 375 };
const DESKTOP_CORNER_CARD = { top: 20, bottom: 210, height: 190, width: 280 };

const HAMB_TOP = { x: 18, y: 22, width: 34, height: 34 };       // measured, no dock
const HAMB_DISPLACED = { x: 18, y: 174, width: 34, height: 34 }; // measured, top dock
// A control belonging to the PROMPT: inside the 178px band, and WIDER than the hamburger, so a
// probe that searched from y=0 would sort it ahead of the real top bar.
const PROMPT_BUTTON = { x: 10, y: 60, width: 60, height: 40 };

const hamburgerProblems = (
  band: (rects: unknown[], vw?: number) => number,
  pick: (rects: unknown[], bandBottom: number) => { y: number } | null,
): string[] => {
  const p: string[] = [];
  const eq = (label: string, got: unknown, want: unknown) => { if (got !== want) p.push(`${label} (got ${String(got)}, want ${String(want)})`); };
  eq('B1 no docked prompt → band 0 (original behaviour preserved)', band([]), 0);
  eq('B1 no dock → the hamburger at y=22 is still found', pick([HAMB_TOP], 0)?.y, 39);
  eq('B2 the WebKit top dock reserves the CONTAINER bottom (178), not the static iframe (170)',
    band([WEBKIT_TOP_DOCK, WEBKIT_INNER_IFRAME]), 178);
  if (pick([HAMB_DISPLACED], band([WEBKIT_TOP_DOCK])) === null)
    p.push('B2 with the top dock, the displaced hamburger at y=174 is NOT found (the #593 defect)');
  // The defect is real, not hypothetical: the old absolute window was `r.y < 80`.
  if (HAMB_DISPLACED.y < 80) p.push('B2 the measured displaced hamburger is no longer outside the old absolute window — this premise needs re-measuring');
  eq('B3 a BOTTOM-docked sheet reserves nothing at the top', band([CHROMIUM_BOTTOM_SHEET]), 0);
  if (pick([HAMB_TOP], band([CHROMIUM_BOTTOM_SHEET])) === null)
    p.push('B3 the hamburger at y=22 is not findable on Chromium');
  eq('B4 a desktop corner card does not span the viewport → reserves nothing', band([DESKTOP_CORNER_CARD], 1440), 0);
  eq('B5 a hidden prompt reserves nothing', band([{ ...WEBKIT_TOP_DOCK, hidden: true }]), 0);
  eq('B5 a zero-height prompt reserves nothing', band([{ top: 0, bottom: 0, height: 0, width: 375 }]), 0);
  // B6 — the prompt's own controls sit INSIDE the band, i.e. above where the app's content starts.
  // A probe that searched from y=0 would sort a wide prompt button ahead of the real hamburger.
  eq('B6 a control inside the reserved band is not mistaken for the top bar',
    pick([PROMPT_BUTTON, HAMB_DISPLACED], band([WEBKIT_TOP_DOCK]))?.y, 191);
  // B7 — relative, and still bounded. A control a long way below the band is not the top bar.
  if (pick([{ x: 18, y: 400, width: 34, height: 34 }], band([WEBKIT_TOP_DOCK])) !== null)
    p.push('B7 a control far below the band was accepted as the top bar');
  if (pick([{ x: 18, y: 324, width: 34, height: 34 }], band([{ top: 0, bottom: 320, height: 320, width: 375 }])) === null)
    p.push('B7 the window is not RELATIVE — the same offset from a DIFFERENT band was rejected');
  return p;
};

const realHamburgerProblems = hamburgerProblems(
  (rects, vw = 375) => topDockBandBottom(rects as never, vw),
  (rects, bandBottom) => pickHamburgerRect(rects as never, bandBottom) as { y: number } | null,
);
check(`the hamburger probe follows the app's own top edge rather than a viewport constant${realHamburgerProblems.length ? ` — ${realHamburgerProblems.join(' | ')}` : ''}`,
  realHamburgerProblems.length === 0);

// ── §C — THE SAME CLASS, THE OTHER EDGE: «is this prompt bottom-docked?» ────────────────────────
// `auth-overlay-clears-controls` decided that with `sheet.bottom < 660 && !mobile`, and the desktop
// viewport in this harness is 1440x**1000** — so 660 did not mean "not docked to the bottom", it
// meant "in the top two thirds of the screen". On the composer path that literal guarded a
// `pass(); return;`, so a prompt resting anywhere above y=660 recorded a PASS having asserted
// nothing about whether it covered the composer: PART 9.5's «a run that asserted nothing» wearing
// an explicit pass rather than a skip.
//
// Tightening it to the rule `bottomPromptInset()` itself uses is a provable NO-OP on every measured
// configuration — the desktop corner prompt sits at bottom ~210 and a bottom-docked sheet at ~1000,
// both far from the 998 boundary — and it closes the gap between them, where a floating prompt used
// to collect a free pass. Filed as a latent oracle weakness, NOT as a measured live defect: no
// prompt has been observed at bottom ∈ (660, 998) on desktop, and PART 9.1 forbids filing one
// without N>=2. It is fixed anyway because the probe is ours and PART 9.4 makes it ours to fix.
type DockedFn = (rect: { top: number; bottom: number; height: number } | null, vh: number) => boolean;

const bottomDockProblems = (docked: DockedFn): string[] => {
  const p: string[] = [];
  const eq = (label: string, got: boolean, want: boolean) => { if (got !== want) p.push(`${label} (got ${got}, want ${want})`); };
  eq('C1 a bottom-flush sheet IS bottom-docked (1000px desktop viewport)', docked({ top: 856, bottom: 1000, height: 144 }, 1000), true);
  eq('C1 …and within the 2px tolerance, as sub-pixel layout requires', docked({ top: 856, bottom: 998, height: 142 }, 1000), true);
  eq('C2 the desktop CORNER prompt is not bottom-docked (the measured shape, bottom ~210)', docked({ top: 20, bottom: 210, height: 190 }, 1000), false);
  // THE GAP THE OLD 660 LITERAL GAVE A FREE PASS. Both directions, because only the pair shows it:
  // 700 must NOT be docked, and 999 must BE — the old literal called 999 "not bottom-docked" too.
  eq('C3 a prompt at bottom 700 is not docked', docked({ top: 500, bottom: 700, height: 200 }, 1000), false);
  eq('C3 …but one at bottom 999 IS (the old literal said otherwise)', docked({ top: 800, bottom: 999, height: 199 }, 1000), true);
  eq('C4 mobile: a 144px sheet flush at 812 is bottom-docked', docked({ top: 668, bottom: 812, height: 144 }, 812), true);
  eq('C5 a zero-height prompt is never "docked"', docked({ top: 0, bottom: 0, height: 0 }, 1000), false);
  eq('C5 an absent prompt is never "docked"', docked(null, 1000), false);
  eq('C6 an unknown viewport height is never "docked" (a failed measurement is not a verdict)', docked({ top: 856, bottom: 1000, height: 144 }, 0), false);
  return p;
};

const realDockProblems = bottomDockProblems(isBottomDocked as DockedFn);
check(`«is this prompt bottom-docked?» uses the app's own rule, not an absolute literal${realDockProblems.length ? ` — ${realDockProblems.join(' | ')}` : ''}`,
  realDockProblems.length === 0);

// The journey must actually USE the predicate — a pure function nothing calls is decoration.
const journeys = readFileSync(join(ROOT, 'e2e/journeys/run.mjs'), 'utf8');
check('auth-overlay-clears-controls asks isBottomDocked(), not an absolute literal',
  /isBottomDocked\(sheet, sheet\.vh\)/.test(journeys)
  && !/sheet\.bottom < 660/.test(journeys));

// The premise: the app really does reserve the band on its root, which is why the bar moves at all.
const layout = readFileSync(join(ROOT, 'src/app/_layout.tsx'), 'utf8');
check('src/app/_layout.tsx still reserves the top band on the app root (the cause of the displacement)',
  /paddingTop:\s*promptInset\.top/.test(layout));

// ── §D — EVERY FRACTION THE HARNESS MIRRORS MUST STILL MATCH THE APP'S OWN ───────────────────────
// routine #6, 2026-09-25. The same class as §B and §C, in its third form: a number retyped into the
// harness that the app also owns. Measured cost: `docked-prompts-stack` computed the combined-band
// cap as `floor(vh * 0.5)` while the app uses `floor(vh * (1 - MIN_APP_FRACTION))` = `floor(vh * 0.7)`
// — 406 vs 568 at 812px, so the oracle was loose by 162px and a genuine shortfall anywhere in
// (406, 568] would have passed. `TOP_DOCK_MIN_SPAN_FRACTION` was mirrored from
// `MIN_SHEET_SPAN_FRACTION` with a comment saying so and NOTHING checked it at all.
//
// Read out of `src/` by value rather than trusted: if either constant moves, this goes RED at the
// PR that moves it, which is the only moment the drift is cheap to fix.
const inset = readFileSync(join(ROOT, 'src/lib/bottomPromptInset.ts'), 'utf8');
const appFraction = (name: string) => {
  const m = inset.match(new RegExp(`const ${name}\\s*=\\s*([0-9.]+)\\s*;`));
  return m ? Number(m[1]) : NaN;
};
const appMinApp = appFraction('MIN_APP_FRACTION');
const appMinSpan = appFraction('MIN_SHEET_SPAN_FRACTION');
check('D0 both app fractions were actually READ (a failed match must not pass as agreement)',
  Number.isFinite(appMinApp) && Number.isFinite(appMinSpan));
check(`D1 the harness's APP_MIN_FRACTION matches the app's MIN_APP_FRACTION (${appMinApp})`,
  APP_MIN_FRACTION === appMinApp);
check(`D2 the harness's TOP_DOCK_MIN_SPAN_FRACTION matches the app's MIN_SHEET_SPAN_FRACTION (${appMinSpan})`,
  TOP_DOCK_MIN_SPAN_FRACTION === appMinSpan);
// The cap helper must compute the APP's formula, not merely hold the right fraction.
check('D3 dockedBandCap() is the app\'s own cap formula at the measured mobile viewport',
  dockedBandCap(812) === Math.floor(812 * (1 - appMinApp)) && dockedBandCap(812) === 568);
check('D4 …and at the desktop viewport this harness really uses (1000px, not 812)',
  dockedBandCap(1000) === Math.floor(1000 * (1 - appMinApp)));
check('D5 a zero or absent viewport caps at 0 rather than producing NaN/-0',
  dockedBandCap(0) === 0 && Object.is(dockedBandCap(0), 0));
// THE DEFECT ITSELF: the retyped 0.5 must be gone, and the journey must ask the shared helper.
check('D6 docked-prompts-stack no longer retypes a 0.5 cap',
  !/Math\.floor\(after\.vh \* 0\.5\)/.test(journeys) && /dockedBandCap\(after\.vh\)/.test(journeys));
// And the verdict must be COVERAGE, not a bare reservation-to-reservation comparison. The old first
// branch filed a defect on any decrease and fired 2/2 on healthy production, printing «0px of app
// content is now under an opaque card» in its own failure text.
check('D7 …and no longer files a defect on a bare reservation DECREASE',
  !/if \(after\.reserved < before\.reserved\) \{/.test(journeys)
  && /after\.reserved \+ 1 < need/.test(journeys));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §E — MUTATION PROOFS: every predicate above, watched to go RED
//      (routine #10, 2026-09-26, ops_incident #728)
//
// This file landed in PR #4317, whose body says «MUTATION-PROVEN 14/14, each watched red and
// restored» and names this barrier by section. The mutations were real — they were run by hand in
// that session — but a one-time act is not coverage: nothing re-executed them, so the barrier sat on
// `scripts/mutation-proof-grandfathered.txt` protected by a sentence in a merged PR body. That is
// the PART 1.11 shape at one remove, a CLAIM of proof reading as durable protection.
//
// Every mutant below is the shape of a real edit: the defect this file was written for, the
// simplification that looks harmless, or the literal someone would reach for. The healthy controls
// matter as much as the mutants — a predicate red for everything is as useless as one green for
// everything (PART 3, R1 step 4).
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  ok  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  (mutation) BLIND to ${label}`);
};

// — healthy controls: none of the three predicates is vacuously red —
mustCatch('…while the REAL oracle is NOT flagged (oracleProblems is not vacuously red)',
  (await oracleProblems(sidebarIsOpen as Oracle)).length === 0);
mustCatch('…while the REAL band/pick pair is NOT flagged (hamburgerProblems is not vacuously red)',
  hamburgerProblems(
    (rects, vw = 375) => topDockBandBottom(rects as never, vw),
    (rects, bandBottom) => pickHamburgerRect(rects as never, bandBottom) as { y: number } | null,
  ).length === 0);
mustCatch('…while the REAL dock rule is NOT flagged (bottomDockProblems is not vacuously red)',
  bottomDockProblems(isBottomDocked as DockedFn).length === 0);

// — §A: the oracle. The first mutant IS the measured defect (routine #6, 2026-09-03) —
// The guest oracle matched the CTA's visible TEXT, which src/app/index.tsx also renders in the
// mobile TOP BAR. fakePage() throws on any text read precisely so this cannot pass here.
type FakePage = { locator: (s: string) => { count: () => Promise<number> }; getByText: () => never };
mustCatch('THE DEFECT: an oracle that reads visible TEXT, which the top bar renders identically',
  (await oracleProblems(async (page) => { (page as FakePage).getByText(); return true; })).length > 0);
mustCatch('an oracle that always answers OPEN — openMobileSidebar() then taps nothing and every downstream assertion is judged against the wrong screen',
  (await oracleProblems(async () => true)).length > 0);
mustCatch('an oracle that never answers OPEN — the drawer is tapped forever and the journey skips',
  (await oracleProblems(async () => false)).length > 0);
mustCatch('guestOk defaulting ON, so a FAILED session seed passes as a signed-in screen instead of an honest skip',
  (await oracleProblems(async (page) =>
    (await (page as FakePage).locator(SIDEBAR_OPEN_MARKER).count()) > 0
    || (await (page as FakePage).locator(SIDEBAR_OPEN_MARKER_GUEST).count()) > 0)).length > 0);
mustCatch('an oracle keyed on a marker the app does not render at all (the same blindness, a different selector)',
  (await oracleProblems(async (page) =>
    (await (page as FakePage).locator('[data-testid="sidebar-not-a-real-testid"]').count()) > 0)).length > 0);

// — §B: the hamburger probe. The first mutant IS ops_incident #593 —
const ABSOLUTE_WINDOW = (rects: unknown[]) => {
  const hit = (rects as { x: number; y: number; width: number; height: number }[])
    .filter((b) => b && b.y < 80 && b.x < 80 && b.width >= 18 && b.width <= 70 && b.height >= 18 && b.height <= 70)
    .sort((a, b) => b.width - a.width);
  return hit.length ? { y: hit[0]!.y + hit[0]!.height / 2 } : null;
};
const realBand = (rects: unknown[], vw = 375) => topDockBandBottom(rects as never, vw);
const realPick = (rects: unknown[], bandBottom: number) => pickHamburgerRect(rects as never, bandBottom) as { y: number } | null;
mustCatch('ops_incident #593: an ABSOLUTE `r.y < 80` window, which loses the hamburger the app itself moved down',
  hamburgerProblems(realBand, ABSOLUTE_WINDOW).length > 0);
// The inner static iframe's bottom is 170 and the fixed container's is 178. Reserving the iframe's
// leaves the real hamburger 8px above the band's floor — inside the slack today, so this mutant is
// asserted through the BAND value itself rather than through the pick.
mustCatch('a band that reserves the inner static iframe (170) instead of the fixed container (178)',
  hamburgerProblems((rects, vw = 375) => {
    const rs = (rects as { top: number; bottom: number; height: number; width: number; hidden?: boolean }[]) || [];
    const eligible = rs.filter((r) => r && !r.hidden && r.height > 0 && r.top <= 2 && r.width >= vw * 0.8);
    return eligible.length ? Math.min(...eligible.map((r) => r.bottom)) : 0;
  }, realPick).length > 0);
mustCatch('a band that reserves for a BOTTOM-docked sheet too (Chromium’s own shape), pushing the probe past a top bar that never moved',
  hamburgerProblems((rects, vw = 375) => {
    const rs = (rects as { top: number; bottom: number; height: number; width: number; hidden?: boolean }[]) || [];
    let band = 0;
    for (const r of rs) { if (r && !r.hidden && r.height > 0 && r.width >= vw * 0.8 && r.bottom > band) band = r.bottom; }
    return band;
  }, realPick).length > 0);
mustCatch('a band that reserves for a HIDDEN prompt — a display:none One Tap container is not covering anything',
  hamburgerProblems((rects, vw = 375) => {
    const rs = (rects as { top: number; bottom: number; height: number; width: number }[]) || [];
    const eligible = rs.filter((r) => r && r.top <= 2 && r.width >= vw * 0.8);
    return eligible.length ? Math.max(...eligible.map((r) => r.bottom)) : 0;
  }, realPick).length > 0);
mustCatch('a probe with NO lower bound, so a control 400px down the page is accepted as the top bar',
  hamburgerProblems(realBand, (rects, bandBottom) => {
    const hit = (rects as { x: number; y: number; width: number; height: number }[])
      .filter((b) => b && b.y >= bandBottom - 4 && b.x < 80 && b.width >= 18 && b.width <= 70 && b.height >= 18 && b.height <= 70)
      .sort((a, b) => b.width - a.width);
    return hit.length ? { y: hit[0]!.y + hit[0]!.height / 2 } : null;
  }).length > 0);
mustCatch('a probe that searches from y=0 regardless of the band, so the PROMPT’s own wider button outranks the hamburger',
  hamburgerProblems(realBand, (rects) => realPick(rects, 0)).length > 0);

// — §C: the bottom-dock rule —
mustCatch('the old absolute 660 literal, which called a prompt at bottom 999 «not bottom-docked» on a 1000px viewport',
  bottomDockProblems((rect) => !!rect && rect.bottom >= 660).length > 0);
mustCatch('a rule with no tolerance at all, so sub-pixel layout reads a flush sheet as floating',
  bottomDockProblems((rect, vh) => !!rect && vh > 0 && rect.height > 0 && rect.bottom >= vh).length > 0);
mustCatch('a rule that answers YES on an unmeasurable viewport — a failed measurement becoming a verdict',
  bottomDockProblems((rect, vh) => !!rect && rect.height > 0 && rect.bottom >= vh - 2).length > 0);
mustCatch('a rule that treats an ABSENT prompt as docked',
  bottomDockProblems((rect, vh) => !rect || (vh > 0 && rect.bottom >= vh - 2)).length > 0);

if (mutFail) { console.error(`\nverify-journey-mobile-sidebar-oracle: ${mutFail} mutation(s) went UNCAUGHT — a predicate above cannot fail`); process.exit(1); }
if (failed) { console.error(`\nverify-journey-mobile-sidebar-oracle: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-journey-mobile-sidebar-oracle: the drawer oracle answers only to the drawer,');
console.log('and the hamburger probe follows the app\'s own top edge rather than a viewport constant.');
