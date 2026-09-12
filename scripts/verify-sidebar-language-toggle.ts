// SIDEBAR LANGUAGE TOGGLE IS GUEST-REACHABLE (owner, 2026-09-11 — "look for the english make it a
// button on the side above setting ok user can change the language ok").
//
// AccountMenu.tsx's two Language rows (verify-account-menu-contract.ts) are the FULL picker, but
// they sit behind openAccountMenu()/openSignIn() — a guest tapping the gear only ever reaches
// sign-in, never the language rows. This barrier pins the SEPARATE, always-reachable row Sidebar.tsx
// now renders directly in the nav column, with no user-gate at all, positioned ABOVE Settings.
//
//   node --experimental-strip-types scripts/verify-sidebar-language-toggle.ts   (wired into npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[^\n:]\/\/[^\n]*$/gm, '');
const sidebar = readFileSync(join(root, 'src/components/Sidebar.tsx'), 'utf8');
const sidebarCode = codeOnly(sidebar);

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}`);
};
const mustCatch = check;

console.log('\nSidebar language toggle — guest-reachable, above Settings\n');

// The real predicate — GUEST-REACHABLE wiring: the language row's own OPENING-TAG LINE calls
// setLocale directly, with no `user ?` / openSignIn conditional anywhere on that line. (A plain
// [^>]* span can't be used here — the props themselves contain arrow functions, i.e. literal `>`
// characters, so it would stop short of onPress on every real render of this row.)
const rowLine = (code: string) => code.split('\n').find((l) => l.includes('testID="sidebar-language-toggle"')) ?? '';
const WIRED_RE = /onPress=\{\(\) => setLocale\(locale === 'ar' \? 'en' : 'ar'\)\}/;
const isGuestReachable = (code: string) => {
  const line = rowLine(code);
  return WIRED_RE.test(line) && !line.includes('user ?') && !line.includes('openSignIn');
};
// The real predicate — ABOVE SETTINGS: both rows present and the language row's testID appears
// first in source order.
const isAboveSettings = (code: string) => {
  const langIdx = code.indexOf('testID="sidebar-language-toggle"');
  const settingsIdx = code.indexOf('testID="sidebar-settings-link"');
  return langIdx >= 0 && settingsIdx >= 0 && langIdx < settingsIdx;
};

// ── 1) The row exists, calls the real setLocale (no sign-in gate on its onPress) ──────────────────
check('sidebar renders a language-toggle row', /testID="sidebar-language-toggle"/.test(sidebarCode));
check('its onPress calls setLocale directly — no `user ?` / openSignIn gate like the Settings row has',
  isGuestReachable(sidebarCode));
check('useI18n is destructured for setLocale (not just t/isRTL/locale)',
  /const \{ t, isRTL, locale, setLocale \} = useI18n\(\);/.test(sidebarCode));

// ── 2) Positioned ABOVE the Settings row, not below or interleaved elsewhere ───────────────────────
check('the language row sits BEFORE (above) the Settings row in the nav column', isAboveSettings(sidebarCode));

// ── 3) Mutation proofs: EXECUTE the same predicates against hand-built before/after code shapes ────
const signInGatedRow = `<Pressable testID="sidebar-language-toggle" style={s} onPress={() => (user ? setLocale(locale === 'ar' ? 'en' : 'ar') : openSignIn())}>`;
mustCatch('(mutation) a sign-in-gated same-testID row does NOT satisfy the guest-reachable wiring predicate',
  !isGuestReachable(signInGatedRow));
mustCatch('(mutation) the real wired row in the actual file DOES satisfy that same predicate',
  isGuestReachable(sidebarCode));

const reorderedCode = [
  '<Pressable testID="sidebar-settings-link">Settings</Pressable>',
  '<Pressable testID="sidebar-language-toggle">Language</Pressable>',
].join('\n');
const correctOrderCode = [
  '<Pressable testID="sidebar-language-toggle">Language</Pressable>',
  '<Pressable testID="sidebar-settings-link">Settings</Pressable>',
].join('\n');
mustCatch('(mutation) Settings-before-language FAILS the above-Settings predicate', !isAboveSettings(reorderedCode));
mustCatch('(mutation) language-before-Settings PASSES the same predicate', isAboveSettings(correctOrderCode));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log('\nAll checks passed.\n');
