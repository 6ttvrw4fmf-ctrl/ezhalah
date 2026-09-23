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
  topDockBandBottom, pickHamburgerRect,
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
const asks = async (label: string, page: unknown, opts: { guestOk?: boolean }, want: boolean) => {
  let got: boolean;
  try {
    got = await sidebarIsOpen(page, opts);
  } catch (e) {
    check(`${label} — the oracle threw: ${String((e as Error).message)}`, false);
    return;
  }
  check(label, got === want);
};

await asks('guest + drawer CLOSED reads as CLOSED (the top-bar CTA must not count)', GUEST_CLOSED, { guestOk: true }, false);
await asks('guest + drawer OPEN reads as OPEN', GUEST_OPEN, { guestOk: true }, true);
await asks('signed-in + drawer CLOSED reads as CLOSED', SIGNED_IN_CLOSED, {}, false);
await asks('signed-in + drawer OPEN reads as OPEN', SIGNED_IN_OPEN, {}, true);
await asks('guestOk is OFF by default — the guest marker alone does not satisfy a signed-in journey', GUEST_OPEN, {}, false);
await asks('the signed-in marker still satisfies a guest-tolerant call', SIGNED_IN_OPEN, { guestOk: true }, true);

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
const banded = (rects: unknown[], vw = 375) => topDockBandBottom(rects as never, vw);

// The two engines' measured container shapes, from src/lib/bottomPromptInset.ts's own notes.
const WEBKIT_TOP_DOCK = { top: 20, bottom: 178, height: 158, width: 375 };   // fixed container
const WEBKIT_INNER_IFRAME = { top: 20, bottom: 170, height: 150, width: 375 }; // static iframe
const CHROMIUM_BOTTOM_SHEET = { top: 668, bottom: 812, height: 144, width: 375 };
const DESKTOP_CORNER_CARD = { top: 20, bottom: 210, height: 190, width: 280 };

const HAMB_TOP = { x: 18, y: 22, width: 34, height: 34 };       // measured, no dock
const HAMB_DISPLACED = { x: 18, y: 174, width: 34, height: 34 }; // measured, top dock

check('B1 no docked prompt → band 0 (original behaviour preserved)', banded([]) === 0);
check('B1 no dock → the hamburger at y=22 is still found',
  pickHamburgerRect([HAMB_TOP], 0)?.y === 39);

check('B2 the WebKit top dock reserves the CONTAINER bottom (178), not the static iframe (170)',
  banded([WEBKIT_TOP_DOCK, WEBKIT_INNER_IFRAME]) === 178);
check('B2 with the top dock, the displaced hamburger at y=174 IS found (the #593 defect)',
  pickHamburgerRect([HAMB_DISPLACED], banded([WEBKIT_TOP_DOCK])) !== null);
check('B2 …and the old absolute window would NOT have found it (the defect is real)',
  HAMB_DISPLACED.y >= 80);

check('B3 a BOTTOM-docked sheet reserves nothing at the top', banded([CHROMIUM_BOTTOM_SHEET]) === 0);
check('B3 …so the hamburger stays findable at y=22 on Chromium',
  pickHamburgerRect([HAMB_TOP], banded([CHROMIUM_BOTTOM_SHEET])) !== null);

check('B4 a desktop corner card does not span the viewport → reserves nothing',
  banded([DESKTOP_CORNER_CARD], 1440) === 0);
check('B5 a hidden prompt reserves nothing',
  banded([{ ...WEBKIT_TOP_DOCK, hidden: true }]) === 0);
check('B5 a zero-height prompt reserves nothing',
  banded([{ top: 0, bottom: 0, height: 0, width: 375 }]) === 0);

// B6 — the prompt's own controls sit INSIDE the band, i.e. above where the app's content starts.
// A probe that searched from y=0 would sort a wide prompt button ahead of the real hamburger.
const PROMPT_BUTTON = { x: 10, y: 60, width: 60, height: 40 };  // inside the 178px band, wider
check('B6 a control inside the reserved band is not mistaken for the top bar',
  pickHamburgerRect([PROMPT_BUTTON, HAMB_DISPLACED], banded([WEBKIT_TOP_DOCK]))?.y === 191);

// B7 — relative, and still bounded. A control a long way below the band is not the top bar.
check('B7 a control far below the band is rejected',
  pickHamburgerRect([{ x: 18, y: 400, width: 34, height: 34 }], banded([WEBKIT_TOP_DOCK])) === null);
check('B7 the window is RELATIVE: the same offset from a DIFFERENT band is accepted',
  pickHamburgerRect([{ x: 18, y: 324, width: 34, height: 34 }],
    banded([{ top: 0, bottom: 320, height: 320, width: 375 }])) !== null);

// The premise: the app really does reserve the band on its root, which is why the bar moves at all.
const layout = readFileSync(join(ROOT, 'src/app/_layout.tsx'), 'utf8');
check('src/app/_layout.tsx still reserves the top band on the app root (the cause of the displacement)',
  /paddingTop:\s*promptInset\.top/.test(layout));

if (failed) { console.error(`\nverify-journey-mobile-sidebar-oracle: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-journey-mobile-sidebar-oracle: the drawer oracle answers only to the drawer,');
console.log('and the hamburger probe follows the app\'s own top edge rather than a viewport constant.');
