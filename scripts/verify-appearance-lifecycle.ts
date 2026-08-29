// AUTH-GATED APPEARANCE LIFECYCLE (owner 2026-08-28, second directive of the day) — extends the
// theme-contract barrier (scripts/verify-theme-contract.ts owns the CSS-var mechanism; this file
// owns the AUTH rule layered on top). The rule:
//
//   • Dark and System-following belong to the AUTHENTICATED experience. Signed out — a guest, or
//     the instant a sign-out / account deletion COMPLETES — Ezhalah is always LIGHT.
//   • A completed sign-out or server-confirmed deletion CLEARS the stored appearance keys: the
//     previous user's preference never leaks into the logged-out app or the next account.
//   • Merely opening a confirmation popup — or إلغاء — never touches the theme. Only the store's
//     completed-action paths reset.
//
// The RESOLUTION half is executed (repo rule — run the real module, never grep for its shape);
// the React/store wiring half is structural (string-pinned), same split as the theme contract.
//
// Run: node --experimental-strip-types scripts/verify-appearance-lifecycle.ts

import { readFileSync } from 'node:fs';
import { resolveAppTheme, resolveTheme } from '../src/theme/themeMode.ts';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ✓ ${name}`);
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── 1. the gate, executed ───────────────────────────────────────────────────────────────────────
check("signed-in + 'dark' → dark", resolveAppTheme(true, 'dark', false) === 'dark');
check("signed-in + 'system' + OS dark → dark", resolveAppTheme(true, 'system', true) === 'dark');
check("signed-in + 'light' + OS dark → light", resolveAppTheme(true, 'light', true) === 'light');
check("signed-out + 'system' + OS dark → light (System is an authenticated preference)",
  resolveAppTheme(false, 'system', true) === 'light');
check("signed-out + stored 'dark' + OS dark → light (the leak rule, executed)",
  resolveAppTheme(false, 'dark', true) === 'light');
check('signed-in delegates to resolveTheme (one decision, not two systems)',
  (['system', 'light', 'dark'] as const).every((m) =>
    resolveAppTheme(true, m, true) === resolveTheme(m, true)
    && resolveAppTheme(true, m, false) === resolveTheme(m, false)));

// ── 2. provider + boot: guests pinned Light at both layers ──────────────────────────────────────
const theme = readFileSync('src/theme/theme.tsx', 'utf8');
check('provider resolves through the auth gate', theme.includes('resolveAppTheme(auth.signedIn, mode, systemDark)'));
check("provider pins data-theme='light' for guests (media query cannot darken them)",
  theme.includes("if (!auth.signedIn) { d.setAttribute('data-theme', 'light'); return; }"));
check('provider leaves the boot attribute alone until auth is KNOWN (no light stomp mid-boot)',
  theme.includes('if (!auth.known) return;'));
check('reset clears the stored preference (web, sync)', theme.includes('window.localStorage?.removeItem(THEME_KEY)'));
check('reset clears the stored preference (AsyncStorage mirror)', theme.includes('AsyncStorage.removeItem(THEME_KEY)'));
check('reset also returns the in-memory mode to its default', /if \(reset\) setModeState\('system'\);/.test(theme));

const html = readFileSync('src/app/+html.tsx', 'utf8');
check('pre-hydration boot gates dark on a Supabase auth token',
  html.includes("indexOf('sb-')") && html.includes('-auth-token'));
check("pre-hydration boot pins guests to 'light'", html.includes(":'light'"));

// ── 3. store: reset wired to COMPLETED transitions only ─────────────────────────────────────────
const store = readFileSync('src/store.tsx', 'utf8');
const signOutBody = store.slice(store.indexOf('signOut: () => {'), store.indexOf('deleteAccount: async () => {'));
const delStart = store.indexOf('deleteAccount: async () => {');
const delBody = store.slice(delStart, store.indexOf('return true;', delStart));
check('signOut() resets the appearance', signOutBody.includes('resetThemeForSignOut()'));
check('deleteAccount() resets the appearance', delBody.includes('resetThemeForSignOut()'));
check('deleteAccount resets ONLY after the server-confirmed guard',
  delBody.indexOf('if (!serverDeleted) return false;') !== -1
  && delBody.indexOf('resetThemeForSignOut()') > delBody.indexOf('if (!serverDeleted) return false;'));
check('store mirrors adoption into the theme (setThemeAuthState(true))', store.includes('setThemeAuthState(true)'));
check('store resets on an observed signed-in→signed-out transition',
  /themeWasSignedInRef\.current\) resetThemeForSignOut\(\)/.test(store));
check('store announces known-guest without clearing (boot is not a transition)',
  store.includes('else setThemeAuthState(false);'));

// The confirmation popups live in AccountMenu (post-#1210) and Sidebar. Opening one — or إلغاء —
// must NEVER reset: the reset belongs exclusively to the store's completed-action paths.
for (const f of ['src/components/AccountMenu.tsx', 'src/components/Sidebar.tsx']) {
  check(`${f} never calls the theme reset (cancel keeps Dark)`,
    !readFileSync(f, 'utf8').includes('resetThemeForSignOut'));
}

if (failed) { console.error(`\n✗ verify-appearance-lifecycle: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ verify-appearance-lifecycle: all checks passed');
