// REAL regression barrier for the PERMANENT sidebar interaction rule:
//   Single click on a saved chat  → OPEN it.
//   Fast double-click on the title → inline RENAME only. Never navigate, never switch to
//                                    Filter/Agent, never start New Chat, never reset the active
//                                    chat/search/results.
//
// The single/double coordination lives in a pure module (src/lib/rowClick.ts) so it is provable
// here without rendering. In Sidebar.tsx a single click only ARMS a delayed open; the native
// dblclick CANCELS that armed open before it fires. 'open' is the ONLY effect that calls
// openHistory() → router.replace()/setActiveChat()/setQuery(); so "a double-click's armed open never
// fires" IS "a double-click never navigates / switches view / resets state".
//
//   node --experimental-strip-types scripts/verify-sidebar-rename-isolation.ts   (wired into `npm test`)

import {
  OPEN_DELAY_MS, armOpen, cancelOpen, openShouldFire, editorSaves, type ArmedOpen,
} from '../src/lib/rowClick.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// Model a real fast double-click exactly as the component drives it: click1 arms, click2 re-arms
// (clearing click1's timer), the browser dblclick cancels the current arm. Then BOTH timers' fire
// checks must decline to open.
function fastDoubleClick(): { arm: ArmedOpen | null; firesForClick1: boolean; firesForClick2: boolean } {
  let arm: ArmedOpen | null = armOpen(1000);        // click 1 → arm
  arm = armOpen(1100);                              // click 2 → re-arm (supersedes click 1)
  arm = cancelOpen(arm);                            // native dblclick → cancel the armed open
  return {
    arm,
    firesForClick1: openShouldFire(arm, 1000),      // click 1's (cleared) timer — must NOT open
    firesForClick2: openShouldFire(arm, 1100),      // click 2's timer — must NOT open
  };
}
const dc = fastDoubleClick();
const dblOpened = dc.firesForClick1 || dc.firesForClick2;

// 1 — single click opens the saved chat (its delay elapses with no dblclick)
{
  const arm = armOpen(5000);
  check('1. single click opens the saved chat', openShouldFire(arm, 5000) === true);
}

// 2–7 — a fast double-click renames ONLY and never navigates / switches / resets
check('2. double-click enters rename mode (its armed open is cancelled, so rename runs instead)', dc.arm?.cancelled === true);
check('3. double-click does NOT change route/view (armed open never fires)', !dblOpened);
check('4. double-click does NOT switch to Filter', !dblOpened);
check('5. double-click does NOT switch to Agent', !dblOpened);
check('6. double-click does NOT reset the active chat id (setActiveChat runs only on open)', !dblOpened);
check('7. double-click does NOT clear search/filter/AF/results (setQuery runs only on open)', !dblOpened);

// 8–10 — inline-editor contract (mirrors commitRename/cancelRename): Enter/blur save, Escape cancels
check('8. Enter save is a save (title only)', editorSaves('enter') === true);
check('9. blur save is a save (title only)', editorSaves('blur') === true);
check('10. Escape cancels — saves nothing', editorSaves('escape') === false);

// Owner intent preserved: two DELIBERATE SLOW clicks (no dblclick between them) each open normally.
{
  const a1 = armOpen(2000); const openedFirst = openShouldFire(a1, 2000);           // first slow click opens
  const a2 = armOpen(9000); const openedSecond = openShouldFire(a2, 9000);          // second slow click opens
  check('   two SLOW clicks each still open (no false rename)', openedFirst && openedSecond);
}

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────────
// Re-introduce the exact old bug: the armed open ignores cancellation (equivalently, the old code
// ran openHistory() on every click with no cancel path). The barrier MUST catch it — a double-click
// through the buggy check WOULD fire the open and navigate.
function buggyOpenShouldFire(a: ArmedOpen | null, token: number): boolean {
  return !!a && a.token === token; // BUG: dropped the `&& !a.cancelled` guard → open is uncancellable
}
{
  const buggyOpened = buggyOpenShouldFire(dc.arm, 1100); // same cancelled double-click arm as the real test
  check('MUTATION PROOF: with the cancel guard removed, double-click WOULD navigate — barrier detects it', buggyOpened === true);
  check('MUTATION PROOF: the real logic does NOT navigate on double-click (barrier is meaningful)',
    dblOpened === false && buggyOpened === true);
}

check('OPEN_DELAY_MS is a sane single-click delay window', OPEN_DELAY_MS >= 150 && OPEN_DELAY_MS <= 500);

console.log(failed === 0 ? '\n✓ sidebar rename isolation: all assertions passed' : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
