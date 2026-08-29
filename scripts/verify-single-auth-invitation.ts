// EXACTLY ONE AUTHENTICATION INVITATION SURFACE (owner 2026-08-29)
//
//   node --experimental-strip-types scripts/verify-single-auth-invitation.ts   (auto-discovered)
//
// THE INCIDENT THIS PINS. The desktop SignInDock side card (2026-08-26) was replaced two days later
// by the movable AuthModal popup (PR #1205), which also de-duplicated the sidebar guest CTA that
// rendered TWICE. Between those two changes reaching production, the owner opened the live site and
// found the retired right-side card still on screen next to the decision that had removed it. The
// owner's standing order from that morning: «exactly one authentication invitation surface at a
// time» — and never merely hidden with CSS, the obsolete render path must be GONE.
//
// verify-auth-popup.ts owns the popup's own behaviour (when it raises, drag, dismissal). THIS file
// owns the fleet-level invariant that no SECOND invitation surface exists or comes back:
//
//   invitation surfaces, by owner decision:
//     • AuthModal        the ONE popup — raises itself via shouldAutoShowAuthPopup, reopened by
//                        explicit sign-in controls. The only in-app invitation.
//     • GoogleOneTap     DELIBERATELY RETAINED alongside it (PR #1187 invested in it the same
//                        week #1205 kept it mounted). It is Google-rendered browser chrome, not an
//                        in-app card, and it is not this barrier's target — recorded here so its
//                        presence is a decision, not an oversight.
//   entry CONTROLS (a button that OPENS auth on tap) are not invitation SURFACES and are exempt:
//     the top-bar «إنشاء حساب / تسجيل الدخول» pill on Filter/Agent and the single sidebar CTA.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
// CODE-ONLY view of each source file: line and block comments stripped before matching. The files
// that replaced the dock rightly cite it in their comments ("replaces the retired SignInDock side
// card") — provenance is welcome; only a CODE reference (import/JSX/identifier) is a render path.
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/([^:'"])\/\/[^\n]*/g, '$1');
const sources = walk(SRC).map((p) => {
  const text = readFileSync(p, 'utf8');
  return { path: p.slice(ROOT.length + 1), text, code: stripComments(text) };
});

// ── 1. THE RETIRED DOCK STAYS DEAD — files gone, and no source path back to it ───────────────────
check('the retired SignInDock component file does not exist', !existsSync(join(SRC, 'components/SignInDock.tsx')));
check('its visibility module does not exist either', !existsSync(join(SRC, 'lib/signInDockVisibility.ts')));
{
  const refs = sources.filter((s) => /SignInDock|shouldShowSignInDock|signin-dock/.test(s.code));
  check('no source file references the retired dock IN CODE (comments citing its retirement are provenance, not a render path)',
    refs.length === 0, `code references in: ${refs.map((r) => r.path).join(', ')}`);
}

// ── 2. THE SIDEBAR GUEST CTA RENDERS EXACTLY ONCE — the duplicate stays de-duplicated ────────────
{
  const sidebar = read('src/components/Sidebar.tsx');
  const ctaMounts = (sidebar.match(/sidebar-signin-cta/g) ?? []).length;
  check('the sidebar guest CTA carries its testid exactly once', ctaMounts === 1, `got ${ctaMounts}`);
  const titleRenders = (sidebar.match(/\{t\('Sign up \/ Log in'\)\}/g) ?? []).length;
  check('…and «Sign up / Log in» is rendered exactly once in the sidebar (the pre-#1205 duplicate stays gone)',
    titleRenders === 1, `got ${titleRenders}`);
}

// ── 3. EXACTLY ONE AUTO-RAISING IN-APP SURFACE — the AuthModal popup ─────────────────────────────
{
  const layout = read('src/app/_layout.tsx');
  check('the layout mounts exactly ONE <AuthModal />', (layout.match(/<AuthModal \/>/g) ?? []).length === 1);
  const autoShowCallers = sources.filter((s) => /shouldAutoShowAuthPopup\(/.test(s.code) && s.path !== 'src/lib/authPopupBehavior.ts');
  check('exactly ONE caller decides auto-show (the layout) — no second component can raise an invitation',
    autoShowCallers.length === 1 && autoShowCallers[0].path === 'src/app/_layout.tsx',
    `callers: ${autoShowCallers.map((c) => c.path).join(', ')}`);
  // A resurrected fixed side card would need position:'fixed' plumbing in a component that also
  // invites auth. Only AuthModal (the popup) may combine the two.
  // Two components legitimately combine fixed positioning with auth wording, both by design:
  // AuthModal IS the popup, and Sidebar is a fixed docked rail whose single CTA is an exempt entry
  // CONTROL (checked to be exactly one above). Anything NEW that combines the two is a card
  // sneaking back — the exact shape of the retired dock.
  const FIXED_AUTH_ALLOWED = new Set(['src/components/AuthModal.tsx', 'src/components/Sidebar.tsx']);
  const fixedAuth = sources.filter((s) =>
    s.path.startsWith('src/components/') && !FIXED_AUTH_ALLOWED.has(s.path)
    && /'fixed'/.test(s.code) && /openAuth|Sign up \/ Log in/.test(s.code));
  check('no component beyond the two known-legit ones combines fixed positioning with an auth invitation',
    fixedAuth.length === 0, `offenders: ${fixedAuth.map((f) => f.path).join(', ')}`);
}

// ── 4. GoogleOneTap's coexistence is the recorded decision — mounted once, never more ────────────
{
  const layout = read('src/app/_layout.tsx');
  check('GoogleOneTap is mounted exactly once (kept by owner decisions #1187 + #1205)',
    (layout.match(/<GoogleOneTap \/>/g) ?? []).length === 1);
}

// ── MUTATION PROOFS — each resurrection path must be CAUGHT by the checks above ──────────────────
console.log('\n── mutation proofs ──');
{
  // M1: the dock file comes back (revert of #1205).
  const dockRefs = (t: string) => /SignInDock|shouldShowSignInDock|signin-dock/.test(t);
  check('MUT-1 a file re-importing SignInDock would be caught (while comment provenance stays clean)',
    dockRefs(stripComments("import SignInDock from '@/components/SignInDock';"))
    && !dockRefs(stripComments("// replaces the retired SignInDock side card"))
    && !sources.some((s) => dockRefs(s.code)));
  // M2: the sidebar CTA duplicates again (the exact pre-#1205 state).
  const dupCta = read('src/components/Sidebar.tsx').replace(/\{t\('Sign up \/ Log in'\)\}/, "{t('Sign up / Log in')}\n<Text>{t('Sign up / Log in')}</Text>");
  check('MUT-2 a duplicated sidebar CTA would be caught',
    (dupCta.match(/\{t\('Sign up \/ Log in'\)\}/g) ?? []).length !== 1);
  // M3: a second AuthModal mount.
  const dualModal = read('src/app/_layout.tsx').replace('<AuthModal />', '<AuthModal />\n      <AuthModal />');
  check('MUT-3 a second <AuthModal /> mount would be caught', (dualModal.match(/<AuthModal \/>/g) ?? []).length !== 1);
  // M4: a second component starts deciding auto-show for itself.
  const rogue = { path: 'src/components/Rogue.tsx', text: 'if (shouldAutoShowAuthPopup(g)) show();' };
  const callers = [...sources.map((x) => ({ path: x.path, text: x.code })), rogue].filter((s) => /shouldAutoShowAuthPopup\(/.test(s.text) && s.path !== 'src/lib/authPopupBehavior.ts');
  check('MUT-4 a second auto-show caller would be caught', callers.length !== 1);
  // M5: a fixed-position auth card outside AuthModal.
  const card = { path: 'src/components/NewCard.tsx', text: "style={{ position: 'fixed' }} onPress={openAuth}" };
  check('MUT-5 a new fixed-position auth card would be caught',
    /'fixed'/.test(card.text) && /openAuth/.test(card.text));
}

console.log(failed ? `\n${failed} FAILED` : '\nexactly one authentication invitation surface — invariant holds');
process.exit(failed ? 1 : 0);
