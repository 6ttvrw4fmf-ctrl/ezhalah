// THE DESKTOP SIGN-IN DOCK'S VISIBILITY CONTRACT (owner 2026-08-26)
//
//   node --experimental-strip-types scripts/verify-signin-dock.ts        (wired into `npm test`)
//
// A floating prompt that appears at the wrong moment is worse than none: shown to a signed-in user
// it looks broken, shown during a search it covers results, shown on mobile it breaks the layout.
// Each of those is one boolean away, so the rule lives in ONE pure function
// (src/lib/signInDockVisibility.ts) and this barrier EXECUTES it over the full truth table rather
// than grepping the component for a conditional.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldShowSignInDock, type DockGate } from '../src/lib/signInDockVisibility.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};

// The one state in which the card is wanted: desktop web, session restored, signed out, no open
// conversation, on the filter home.
const SHOWN: DockGate = { isWeb: true, docked: true, authChecked: true, user: null, activeChatId: null, pathname: '/' };

check('SHOWS for a signed-out desktop visitor on the home screen', shouldShowSignInDock(SHOWN));

// ── EACH GATE, FLIPPED ALONE — every one must be sufficient to hide it ───────────────────────────
check('HIDDEN on mobile / below the dock breakpoint', !shouldShowSignInDock({ ...SHOWN, docked: false }));
check('HIDDEN on native (not web)',                   !shouldShowSignInDock({ ...SHOWN, isWeb: false }));
check('HIDDEN when a user is signed in',              !shouldShowSignInDock({ ...SHOWN, user: { id: 'u1' } }));
check('HIDDEN while the session is still restoring (no flash at a logged-in visitor)',
  !shouldShowSignInDock({ ...SHOWN, authChecked: false }));
check('HIDDEN once a conversation is open (a search landed)',
  !shouldShowSignInDock({ ...SHOWN, activeChatId: 'h123' }));
check('HIDDEN away from the filter home', !shouldShowSignInDock({ ...SHOWN, pathname: '/agent' }));

// THE FLASH CASE, stated on its own because it is the subtle one: mid-restore a signed-in visitor
// still looks signed out (`user` is null), and only authChecked separates them.
check('a signed-in visitor mid-restore is NEVER shown the card',
  !shouldShowSignInDock({ ...SHOWN, authChecked: false, user: null }),
  'this is the frame where `!user` alone would wrongly say "logged out"');

// ── THE OWNER'S JOURNEY, END TO END ──────────────────────────────────────────────────────────────
{
  const home = SHOWN;                                        // 1. desktop visitor opens Ezhalah
  const searching = { ...SHOWN, activeChatId: 'h1', pathname: '/agent' };  // 2. runs a search
  const freshNewChat = { ...SHOWN, activeChatId: null, pathname: '/' };    // 3. «محادثة جديدة»
  const signedIn = { ...SHOWN, user: { id: 'u1' } };                       // 4. signs in
  check('journey: visible on first open', shouldShowSignInDock(home));
  check('journey: gone as soon as the search lands', !shouldShowSignInDock(searching));
  check('journey: back on a fresh New Chat while still signed out', shouldShowSignInDock(freshNewChat));
  check('journey: gone the moment they sign in', !shouldShowSignInDock(signedIn));
}

// ── FULL TRUTH TABLE — exactly ONE of the 64 combinations may show it ────────────────────────────
{
  let shown = 0;
  for (const docked of [true, false]) for (const authChecked of [true, false])
    for (const user of [null, { id: 'u' }]) for (const activeChatId of [null, 'h1'])
      for (const pathname of ['/', '/agent']) for (const isWeb of [true, false])
        if (shouldShowSignInDock({ docked, authChecked, user, activeChatId, pathname, isWeb })) shown++;
  check('exactly one of the 64 gate combinations shows the card', shown === 1, `got ${shown}`);
}

// ── WIRING — the rule is inert if the component does not use it, or nothing mounts it ────────────
const SRC = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8');
const comp = SRC('components/SignInDock.tsx'), layout = SRC('app/_layout.tsx');

check('WIRING the component delegates to the shared rule (no second copy of the conditional)',
  /shouldShowSignInDock\(\{/.test(comp) && !/docked && authChecked && !user/.test(comp));
check('WIRING it is mounted at the app root', /<SignInDock \/>/.test(layout));
check('WIRING it uses the SSR-safe viewport gate, never an inline width read',
  /useDocked\(\)/.test(comp) && !/useWindowDimensions/.test(comp));
// The point is that this card must not grow its OWN auth UI — it hands off to the store's openAuth,
// which drives the one AuthModal mounted at the root. Mentioning AuthModal in a comment is fine;
// importing or rendering one here is not, so assert on those rather than on the word.
check('WIRING tapping it opens the EXISTING auth modal (no parallel auth UI)',
  /openAuth/.test(comp)
  && !/^\s*import[^\n]*AuthModal/m.test(comp)
  && !/<AuthModal/.test(comp)
  && !/TextInput/.test(comp),
  'this card must delegate to the single root AuthModal, never render credential fields itself');
check('WIRING the card is draggable with pointer capture and 1:1 tracking',
  /setPointerCapture/.test(comp) && /pointermove/.test(comp));
check('WIRING a press that never moved is a tap, not a drag',
  /if \(!moved\) \{ openAuth\(\); return; \}/.test(comp));
check('WIRING the moved position is remembered for the session only',
  /sessionStorage\.setItem\(POS_KEY/.test(comp) && !/localStorage\.setItem\(POS_KEY/.test(comp));
check('WIRING reduced motion is honoured', /prefers-reduced-motion/.test(comp));
check('WIRING the card is clamped inside the viewport (never off-screen or over the rail)',
  /Math\.min\(Math\.max\(x, EDGE\)/.test(comp));

// ── MUTATION PROOFS ──────────────────────────────────────────────────────────────────────────────
console.log('\n── mutation proofs ──');
{
  const dropAuthChecked = (g: DockGate) => g.isWeb && g.docked && !g.user && !g.activeChatId && g.pathname === '/';
  check('MUT-1 dropping the authChecked gate shows the card mid-restore → caught',
    dropAuthChecked({ ...SHOWN, authChecked: false }) === true
    && shouldShowSignInDock({ ...SHOWN, authChecked: false }) === false);
  const dropChat = (g: DockGate) => g.isWeb && g.docked && g.authChecked && !g.user && g.pathname === '/';
  check('MUT-2 dropping the conversation gate leaves it up during a search → caught',
    dropChat({ ...SHOWN, activeChatId: 'h1' }) === true
    && shouldShowSignInDock({ ...SHOWN, activeChatId: 'h1' }) === false);
  const dropDocked = (g: DockGate) => g.isWeb && g.authChecked && !g.user && !g.activeChatId && g.pathname === '/';
  check('MUT-3 dropping the viewport gate shows it on mobile → caught',
    dropDocked({ ...SHOWN, docked: false }) === true
    && shouldShowSignInDock({ ...SHOWN, docked: false }) === false);
  const dropUser = (g: DockGate) => g.isWeb && g.docked && g.authChecked && !g.activeChatId && g.pathname === '/';
  check('MUT-4 dropping the signed-in gate shows it to a logged-in user → caught',
    dropUser({ ...SHOWN, user: { id: 'u' } }) === true
    && shouldShowSignInDock({ ...SHOWN, user: { id: 'u' } }) === false);
  check('CONTROL the shipped rule still shows it in the one intended state', shouldShowSignInDock(SHOWN));
}

console.log(failed ? `\n${failed} FAILED` : '\nSign-in dock visibility contract holds');
process.exit(failed ? 1 : 0);
