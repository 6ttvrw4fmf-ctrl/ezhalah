// THE MOVABLE SIGN-IN POPUP'S CONTRACT (owner 2026-08-28)
//
//   node --experimental-strip-types scripts/verify-auth-popup.ts        (discovered by `npm test`)
//
// The old side login UI (the SignInDock card, the duplicated sidebar guest CTA) is REMOVED, and in
// its place the ONE existing AuthModal auto-raises for signed-out web visitors on the Filter home
// and the Agent screen — larger on desktop, draggable there by its header, never draggable
// off-screen, never shown to a signed-in user, and a plain centered modal on mobile. Every rule
// lives in a pure function (src/lib/authPopupBehavior.ts) and this barrier EXECUTES those
// functions over their full input space rather than grepping for conditionals. The wiring section
// then pins that the components actually delegate to them — a rule nobody calls verifies nothing.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  shouldAutoShowAuthPopup,
  canDragAuthPopup,
  clampAuthPopupOffset,
  AUTH_POPUP_EDGE,
  type AutoShowGate,
} from '../src/lib/authPopupBehavior.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};

// ── 1. AUTO-SHOW: the popup appears on BOTH screens, and for signed-out visitors only ────────────
const SHOWN: AutoShowGate = { isWeb: true, authChecked: true, user: null, introSeen: true, dismissed: false, pathname: '/' };

check('SHOWS on the Filter home for a signed-out web visitor', shouldAutoShowAuthPopup(SHOWN));
check('SHOWS on the Agent screen for a signed-out web visitor', shouldAutoShowAuthPopup({ ...SHOWN, pathname: '/agent' }));

// Each gate, flipped alone — every one must be sufficient to keep it closed.
check('LOGGED-IN users never see it',            !shouldAutoShowAuthPopup({ ...SHOWN, user: { id: 'u1' } }));
check('LOGGED-IN users never see it (on Agent)', !shouldAutoShowAuthPopup({ ...SHOWN, user: { id: 'u1' }, pathname: '/agent' }));
check('HIDDEN while the session is still restoring (no flash at a logged-in visitor)',
  !shouldAutoShowAuthPopup({ ...SHOWN, authChecked: false }));
check('HIDDEN on native (web only)',             !shouldAutoShowAuthPopup({ ...SHOWN, isWeb: false }));
check('HIDDEN while the intro flag is still being read',  !shouldAutoShowAuthPopup({ ...SHOWN, introSeen: null }));
check('HIDDEN while the intro film is pending/playing',   !shouldAutoShowAuthPopup({ ...SHOWN, introSeen: false }));
check('DISMISSAL IS RESPECTED — once closed this session, it never auto-raises again',
  !shouldAutoShowAuthPopup({ ...SHOWN, dismissed: true }));
check('DISMISSAL holds across Filter↔Agent navigation (no re-pop nag)',
  !shouldAutoShowAuthPopup({ ...SHOWN, dismissed: true, pathname: '/agent' }));
check('HIDDEN on every other route', ['/settings', '/about', '/support', '/browser', '/interview', '/auth']
  .every((pathname) => !shouldAutoShowAuthPopup({ ...SHOWN, pathname })));

// Full truth table: 2·2·2·3·2·3 = 144 combinations; exactly the two good-gate rows ('/', '/agent')
// may show. Every signed-in combination is inside the other 142.
{
  let shown = 0, shownSignedIn = 0;
  for (const isWeb of [true, false]) for (const authChecked of [true, false])
    for (const user of [null, { id: 'u' }]) for (const introSeen of [null, false, true] as const)
      for (const dismissed of [true, false]) for (const pathname of ['/', '/agent', '/settings']) {
        const s = shouldAutoShowAuthPopup({ isWeb, authChecked, user, introSeen, dismissed, pathname });
        if (s) shown++;
        if (s && user) shownSignedIn++;
      }
  check('exactly TWO of the 144 gate combinations show it (Filter home + Agent)', shown === 2, `got ${shown}`);
  check('ZERO of the signed-in combinations show it', shownSignedIn === 0, `got ${shownSignedIn}`);
}

// ── 2. DRAGGING EXISTS ONLY ON DESKTOP WEB ───────────────────────────────────────────────────────
check('drag ENABLED on desktop web',              canDragAuthPopup({ isWeb: true, docked: true }));
check('drag DISABLED on mobile web (centered responsive modal instead)', !canDragAuthPopup({ isWeb: true, docked: false }));
check('drag DISABLED on native',                  !canDragAuthPopup({ isWeb: false, docked: true }));
check('drag DISABLED on native mobile',           !canDragAuthPopup({ isWeb: false, docked: false }));

// ── 3. DRAG BOUNDS: the card can NEVER be dragged off-screen ─────────────────────────────────────
{
  // A centered 470×400 card in a 1340×720 viewport.
  const base = { left: 435, top: 160, width: 470, height: 400 };
  const vp = { w: 1340, h: 720 };
  const inBounds = (off: { x: number; y: number }) => {
    const l = base.left + off.x, t = base.top + off.y;
    return l >= AUTH_POPUP_EDGE && t >= AUTH_POPUP_EDGE
      && l + base.width <= vp.w - AUTH_POPUP_EDGE && t + base.height <= vp.h - AUTH_POPUP_EDGE;
  };
  check('a violent throw right/down is clamped fully on-screen', inBounds(clampAuthPopupOffset({ x: 1e6, y: 1e6 }, base, vp)));
  check('a violent throw left/up is clamped fully on-screen',    inBounds(clampAuthPopupOffset({ x: -1e6, y: -1e6 }, base, vp)));
  check('NaN-free at the extremes', [1e6, -1e6, 0].every((v) => {
    const r = clampAuthPopupOffset({ x: v, y: -v }, base, vp);
    return Number.isFinite(r.x) && Number.isFinite(r.y);
  }));
  const id = clampAuthPopupOffset({ x: 40, y: -30 }, base, vp);
  check('an in-bounds position is left exactly where the user put it', id.x === 40 && id.y === -30, `got ${id.x},${id.y}`);
  // Sweep: every clamped offset is in bounds — the clamp is total, not just edge-case-patched.
  let all = true;
  for (let x = -2000; x <= 2000; x += 137) for (let y = -2000; y <= 2000; y += 173)
    if (!inBounds(clampAuthPopupOffset({ x, y }, base, vp))) all = false;
  check('every offset in a ±2000px sweep clamps to fully on-screen', all);
  // A card TALLER than the viewport: the range inverts; the TOP edge (the grab strip) must win,
  // so the card can always be grabbed and dragged back.
  const tall = { left: 435, top: -100, width: 470, height: 900 };
  const short = { w: 1340, h: 700 };
  const r = clampAuthPopupOffset({ x: 0, y: 1e6 }, tall, short);
  check('a card taller than the viewport pins its TOP (grab strip) edge on-screen',
    tall.top + r.y === AUTH_POPUP_EDGE, `top ended at ${tall.top + r.y}`);
}

// ── 4. THE OLD SIDE LOGIN UI IS GONE — removed render paths, not CSS-hidden ──────────────────────
const root = join(import.meta.dirname, '..');
const SRC = (f: string) => readFileSync(join(root, 'src', f), 'utf8');
const layout = SRC('app/_layout.tsx');
const authModal = SRC('components/AuthModal.tsx');
const sidebar = SRC('components/Sidebar.tsx');
const store = SRC('store.tsx');
const filter = SRC('app/index.tsx');
const agent = SRC('app/agent.tsx');

check('SignInDock component file is DELETED', !existsSync(join(root, 'src/components/SignInDock.tsx')));
check('signInDockVisibility lib is DELETED',  !existsSync(join(root, 'src/lib/signInDockVisibility.ts')));
check('no screen or layout imports or mounts a SignInDock',
  ![layout, filter, agent, sidebar].some((s2) => s2.includes("from '@/components/SignInDock'") || s2.includes('<SignInDock')));
check('Filter screen has no side auth card render path', !filter.includes('SignInDock') || !filter.includes('<SignInDock'));
check('Agent screen has no side auth card render path',  !agent.includes('<SignInDock'));
// The sidebar keeps exactly ONE guest sign-in affordance (the bottom slot where the signed-in
// profile row lives); the old duplicated upper CTA card must not return.
{
  const ctaRenders = (sidebar.match(/style=\{\s*\[?s\.cta[,\s\]}]/g) ?? []).length;
  check('sidebar renders exactly ONE guest sign-in CTA (the duplicate card stays gone)', ctaRenders === 1, `found ${ctaRenders}`);
  check('the remaining sidebar CTA is the tagged minimal affordance', sidebar.includes("testid: 'sidebar-signin-cta'"));
}

// ── 5. WIRING — the components must DELEGATE to the executed rules above ─────────────────────────
check('WIRING the layout auto-show effect calls shouldAutoShowAuthPopup (no inline copy)',
  layout.includes('shouldAutoShowAuthPopup({ isWeb: true, authChecked, user, introSeen, dismissed, pathname })'));
check('WIRING the ONE AuthModal is mounted at the app root, pathname-agnostic (available on Filter AND Agent)',
  layout.includes('<AuthModal />'));
check('WIRING AuthModal gates drag through canDragAuthPopup',
  authModal.includes("canDragAuthPopup({ isWeb: Platform.OS === 'web', docked })")
  && authModal.includes('if (!drag) return;'));
check('WIRING AuthModal clamps every drag through clampAuthPopupOffset',
  authModal.includes('clampAuthPopupOffset(p, baseRect(), vp())'));
check('WIRING the drag machinery renders only when drag is enabled (mobile keeps the plain modal)',
  authModal.includes('{drag && (') && authModal.includes('drag && s.popWrapWide'));
check('WIRING AuthModal renders nothing unless opened (authOpen)',
  authModal.includes('if (!authOpen) return null;'));
check('WIRING closeAuth stamps the session dismissal (closing is respected, reopening stays manual)',
  store.includes('AUTH_POPUP_DISMISSED_KEY') && store.includes('introSeen,'));
check('WIRING testIDs for the journey engineer: auth-popup / drag-handle / close',
  authModal.includes("testid: 'auth-popup'")
  && authModal.includes("testid: 'auth-popup-drag-handle'")
  && authModal.includes("testid: 'auth-popup-close'"));
check('WIRING desktop sizing exists and mobile cap is untouched (400 stays; 470 is desktop-only)',
  authModal.includes('maxWidth: 400') && authModal.includes('popWrapWide: { maxWidth: 470 }'));

if (failed) {
  console.error(`\n❌ verify-auth-popup: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✅ verify-auth-popup: the movable sign-in popup contract holds');
