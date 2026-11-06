// THE APP FILLS THE WHOLE PHONE SCREEN WHEN NOBODY IS TYPING (owner 2026-11-05: an iPhone screenshot showed the page
// ending ~60% down — the form cut at «District», bare sky below — and «make sure it doesn't happen»). The root is pinned
// to the visual viewport for the keyboard; iOS does not always report that viewport growing back, so it stayed at the
// keyboard-open height. EXECUTES liveFrame/isEditing and pins the hook's re-measure triggers. Hermetic.
import { readFileSync } from 'node:fs';
import { liveFrame, isEditing, rootFrame } from '../src/lib/visualViewportFrame.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => { console.log(`${caught ? '✓' : '✗'} mutation caught: ${name}`); if (!caught) failed++; };

const stale = { visualHeight: 508, visualOffsetTop: 0, layoutHeight: 844, editing: false, scale: 1 };   // keyboard gone, iOS still says 508
const typing = { visualHeight: 508, visualOffsetTop: 150, layoutHeight: 844, editing: true, scale: 1 };
const zoomed = { visualHeight: 422, visualOffsetTop: 90, layoutHeight: 844, editing: true, scale: 2 };
check('not typing + a stale (keyboard-height) visual viewport → the root takes the full screen', JSON.stringify(liveFrame(stale)) === JSON.stringify({ top: 0, height: 844 }));
check('typing → the root is the visible window above the keyboard (unchanged behaviour)', JSON.stringify(liveFrame(typing)) === JSON.stringify(rootFrame(typing)));
check('pinch-zoomed → the root keeps the full screen', liveFrame(zoomed).height === 844 && liveFrame(zoomed).top === 0);
check('isEditing: text input / textarea / contenteditable yes; button, checkbox, a div no',
  isEditing({ tagName: 'INPUT', type: 'text' }) && isEditing({ tagName: 'TEXTAREA' }) && isEditing({ tagName: 'DIV', isContentEditable: true })
  && !isEditing({ tagName: 'INPUT', type: 'checkbox' }) && !isEditing({ tagName: 'BUTTON' }) && !isEditing({ tagName: 'DIV' }) && !isEditing(null));

const lib = readFileSync(new URL('../src/lib/visualViewportFrame.ts', import.meta.url), 'utf8');
const hookOk = (s: string) => /const f = liveFrame\(\{ visualHeight: vv\.height, visualOffsetTop: vv\.offsetTop, layoutHeight: window\.innerHeight,/.test(s)
  && /const winEvents = \['focusin', 'focusout', 'resize', 'orientationchange', 'pageshow'\] as const;/.test(s)
  && /document\.addEventListener\('visibilitychange', onVisible\);/.test(s) && /for \(const ms of \[120, 350, 800\]\)/.test(s);
check('the hook sizes the root with liveFrame and re-measures on focus out, resize, rotate, return to the tab', hookOk(lib));
mustCatch('the hook back on the visual viewport alone', !hookOk(lib.replace('const f = liveFrame(', 'const f = rootFrame(')));
mustCatch('no re-measure when the keyboard closes (focusout)', !hookOk(lib.replace("'focusin', 'focusout', ", "'focusin', ")));
const brokenLive = (v: typeof stale) => rootFrame(v);   // the old rule
mustCatch('the old rule (visual viewport even when not typing) leaves the 60% page', brokenLive(stale).height !== 844);

if (failed) { console.error(`\n❌ verify-root-fills-screen-when-not-typing: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-root-fills-screen-when-not-typing: off the keyboard, the app always fills the screen.');
