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

if (failed) { console.error(`\nverify-journey-mobile-sidebar-oracle: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-journey-mobile-sidebar-oracle: the drawer oracle answers only to the drawer.');
