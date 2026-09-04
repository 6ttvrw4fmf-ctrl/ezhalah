// PERMANENT BARRIER: after a destructive flow ENDS, the account menu is neutral again.
// (ops_incident hunt-2026-09-04:modal:04, owner routine-6 journey.)
//
// THE DEFECT THIS EXISTS FOR. `setLoggingOut(true)` and `setDeleting(true)` had no `false` anywhere
// in the tree on the success path — `grep -n setLoggingOut` returned only the `useState(false)` and
// the setter. AccountMenu is MOUNTED for the whole app life (`<AccountMenu visible={acctOpen} …>` in
// both Sidebar trees) and merely RENDERS NULL while `!user`, so its state survives a sign-out. Any
// return to the signed-in state without a page reload — a failed deletion, an auth-state restore,
// or the silent-sign-out bug this shipped alongside (hunt-2026-09-04:auth:03) — re-opened a stuck
// destructive confirmation whose only button was permanently disabled.
//
// WHY THE EXISTING BARRIER MISSED IT. verify-account-menu-contract.ts pins structure and testIDs by
// reading source text; a state flag that is never reset leaves no textual trace to pin. This one
// EXECUTES the real handlers and reads what they actually called.
//
// WHAT IS LOCKED (each falls RED under the named mutation, proven at the bottom):
//   1. A completed sign-out releases `loggingOut` AND closes the menu.   [M-stuck-logout → RED]
//   2. A completed deletion releases `deleting` AND closes the menu.     [M-stuck-delete → RED]
//   3. A FAILED destructive action releases the flag but KEEPS the dialog open — the user has to be
//      able to read the error and retry.                                 [M-close-on-error → RED]
//   4. Opening the menu starts neutral, so any future path back to signed-in also lands clean.
//                                                                        [M-no-open-reset → RED]
//
//   node --experimental-strip-types scripts/verify-account-menu-neutral-after-destructive.ts   (auto-discovered by npm test)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
const MENU = join(root, 'src/components/AccountMenu.tsx');
const menuSrc = readFileSync(MENU, 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const mutantOf = (from: string, to: string): string => {
  if (!menuSrc.includes(from)) throw new Error(`mutation anchor missing:\n${from}`);
  const f = join(mkdtempSync(join(tmpdir(), 'ezhalah-menu-mut-')), 'mutant.tsx');
  writeFileSync(f, menuSrc.replace(from, to));
  return f;
};

// ── the recorders the real handlers close over ──────────────────────────────────────────────────
type Bus = { calls: string[]; backendOk: boolean; deleteOk: boolean };
const gb = globalThis as unknown as { __bus: Bus };
const PRELUDE = [
  'const bus: any = (globalThis as any).__bus;',
  'const loggingOut = false;',
  'const deleting = false;',
  'const setLoggingOut = (v: boolean) => bus.calls.push(`setLoggingOut(${v})`);',
  'const setDeleting = (v: boolean) => bus.calls.push(`setDeleting(${v})`);',
  'const setLogoutError = (v: any) => bus.calls.push(v === null ? `setLogoutError(null)` : `setLogoutError(msg)`);',
  'const setDeleteError = (v: any) => bus.calls.push(v === null ? `setDeleteError(null)` : `setDeleteError(msg)`);',
  'const t = (k: string) => k;',
  'const signOutBackend = async () => bus.backendOk;',
  'const signOut = () => bus.calls.push(`store.signOut()`);',
  'const deleteAccount = async () => bus.deleteOk;',
  'const router = { replace: (p: string) => bus.calls.push(`router.replace(${p})`) };',
  'const onClose = () => bus.calls.push(`onClose()`);',
  'const setTimeout = (fn: any, _ms: number) => { fn(); };',
].join('\n');

/** Run ONE of the real destructive handlers, lifted out of AccountMenu.tsx. */
const run = async (
  handler: 'onLogout' | 'onDeleteAccount', outcome: boolean, file = MENU,
): Promise<Bus> => {
  gb.__bus = { calls: [], backendOk: outcome, deleteOk: outcome };
  const m = await liftSymbols(
    file,
    [{ header: `  const ${handler} = async () => {`, endsWith: /^  \};$/ }],
    [handler],
    PRELUDE,
  );
  await (m[handler] as () => Promise<void>)();
  return gb.__bus;
};

// The invariants, as predicates the real handlers AND the mutants are judged by.
const neutralAndClosed = (b: Bus, flag: 'setLoggingOut' | 'setDeleting') =>
  b.calls.includes(`${flag}(false)`) && b.calls.includes('onClose()');
const readableFailure = (b: Bus, flag: 'setLoggingOut' | 'setDeleting') =>
  b.calls.includes(`${flag}(false)`) && !b.calls.includes('onClose()')
  && !b.calls.some((c) => c.startsWith('router.replace'));

console.log('\nNo stuck destructive dialog: a finished flow leaves the account menu neutral\n');

// ── 1. Sign-out ─────────────────────────────────────────────────────────────────────────────────
const outOk = await run('onLogout', true);
check('a COMPLETED sign-out releases loggingOut and closes the menu',
  neutralAndClosed(outOk, 'setLoggingOut'), `calls: ${JSON.stringify(outOk.calls)}`);
check('…after the app has actually been cleared (the reset never front-runs signOut/navigation)',
  outOk.calls.indexOf('store.signOut()') < outOk.calls.indexOf('setLoggingOut(false)'),
  `calls: ${JSON.stringify(outOk.calls)}`);

const outFail = await run('onLogout', false);
check('a FAILED sign-out releases the button but KEEPS the dialog open so the error can be read',
  readableFailure(outFail, 'setLoggingOut'), `calls: ${JSON.stringify(outFail.calls)}`);

// ── 2. Deletion ─────────────────────────────────────────────────────────────────────────────────
const delOk = await run('onDeleteAccount', true);
check('a COMPLETED deletion releases deleting and closes the menu',
  neutralAndClosed(delOk, 'setDeleting'), `calls: ${JSON.stringify(delOk.calls)}`);
check('…and still lands in the canonical logged-out state (owner rule: navigate on success)',
  delOk.calls.includes('router.replace(/)'), `calls: ${JSON.stringify(delOk.calls)}`);

const delFail = await run('onDeleteAccount', false);
check('a FAILED deletion releases the button, says so, and destroys/navigates nothing',
  readableFailure(delFail, 'setDeleting') && delFail.calls.includes('setDeleteError(msg)'),
  `calls: ${JSON.stringify(delFail.calls)}`);

// ── 3. Every open starts neutral ────────────────────────────────────────────────────────────────
// The handlers above cover the paths that COMPLETE. This covers the ones that do not: the menu is
// never unmounted, so opening it is the one moment where any leftover flag must be dropped.
const OPEN_RESET = /setShown\(true\);\s*setView\('root'\);[\s\S]{0,400}?setLoggingOut\(false\); setDeleting\(false\); setLogoutError\(null\); setDeleteError\(null\);/;
check('opening the menu resets both busy flags and both error slots, exactly like the view',
  OPEN_RESET.test(menuSrc));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the real handlers, deliberately re-broken\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// M-stuck-logout: the exact pre-fix tail — sign out, navigate, and leave the flag latched true.
mustCatch('a completed sign-out that leaves loggingOut latched and the menu open',
  !neutralAndClosed(await run('onLogout', true, mutantOf(
    `    setLoggingOut(false);
    onClose();
  };`, '  };')), 'setLoggingOut'));

// M-stuck-delete: same shape on the deletion path.
mustCatch('a completed deletion that leaves deleting latched and the menu open',
  !neutralAndClosed(await run('onDeleteAccount', true, mutantOf(
    `    setDeleting(false);
    onClose();
  };`, '  };')), 'setDeleting'));

// M-close-on-error: resetting by closing the dialog would ALSO hide the error the user needs.
mustCatch('a failed sign-out that closes the dialog and takes its own error message with it',
  !readableFailure(await run('onLogout', false, mutantOf(
    `      setLogoutError(t("Couldn't sign out this device. Try again."));
      return;`,
    `      setLogoutError(t("Couldn't sign out this device. Try again."));
      onClose();
      return;`)), 'setLoggingOut'));

// M-no-open-reset: the open path silently stops guaranteeing a neutral surface.
mustCatch('the menu re-opening onto whatever busy state the last flow left behind',
  !OPEN_RESET.test(menuSrc.replace(
    'setLoggingOut(false); setDeleting(false); setLogoutError(null); setDeleteError(null);', '')));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
console.log(failures === 0
  ? '\n✓ account menu: no destructive flow can leave a stuck dialog behind\n'
  : `\n✗ ${failures} check(s) FAILED — a finished flow could strand the menu again\n`);
process.exit(failures === 0 ? 0 : 1);
