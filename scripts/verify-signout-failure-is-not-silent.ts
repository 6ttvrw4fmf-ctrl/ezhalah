// PERMANENT BARRIER: a FAILED sign-out is never dressed up as a successful one.
// (ops_incident hunt-2026-09-04:auth:03, owner routine-6 journey.)
//
// THE DEFECT THIS EXISTS FOR. `signOutBackend()` returned `void` and swallowed the `{ error }`
// supabase-js hands back:
//
//     export async function signOutBackend(): Promise<void> {
//       if (!supabase) return;
//       try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
//     }
//
// gotrue-js forgives an already-dead token (401/403/404) and clears storage anyway — but on ANY
// other failure it returns `{ error }` and LEAVES THE SESSION IN LOCALSTORAGE, still valid, still
// auto-refreshing. The UI meanwhile dropped to the guest home on a 1.2s timer, so blocking
// `*/auth/v1/logout` produced a logged-out screen sitting on a live token, and the next reload
// signed the user straight back in.
//
// WHY THE EXISTING BARRIERS MISSED IT. verify-devices-contract.ts pins the sign-out SCOPE and
// verify-account-menu-contract.ts pinned the confirm handler's SHAPE — both by reading source text.
// Neither ever ran the function, so neither could notice that its RESULT was thrown away. This one
// EXECUTES the real code against a stub client whose signOut fails.
//
// WHAT IS LOCKED (each falls RED under the named mutation, proven at the bottom):
//   1. signOutBackend REPORTS the outcome — false on `{ error }`, false on a throw, true only on a
//      clean sign-out.                                        [M-swallow: the old void body → RED]
//   2. The executed call still carries `scope: 'local'` — this fix is about the RESULT being
//      checked, never about widening the scope (verify-devices-contract.ts owns that rule).
//   3. onLogout NEVER shows the logged-out UI on a failed sign-out: no store signOut(), no
//      navigation, and the user is told in Arabic.            [M-ungated: `if (false)` → RED]
//   4. The 1.2s beat runs ALONGSIDE the backend call (Promise.all), not instead of it.
//
//   node --experimental-strip-types scripts/verify-signout-failure-is-not-silent.ts   (auto-discovered by npm test)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
const AUTH = join(root, 'src/lib/auth.ts');
const MENU = join(root, 'src/components/AccountMenu.tsx');
const authSrc = readFileSync(AUTH, 'utf8');
const menuSrc = readFileSync(MENU, 'utf8');
const i18nSrc = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

/** Write a deliberately broken copy of a real file so the REAL lift can be run against it. */
const mutantOf = (src: string, from: string, to: string): string => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing:\n${from}`);
  const f = join(mkdtempSync(join(tmpdir(), 'ezhalah-signout-mut-')), 'mutant.ts');
  writeFileSync(f, src.replace(from, to));
  return f;
};

// ── the seam: a stub supabase client the barrier drives ─────────────────────────────────────────
type SignOutStub = (opts: unknown) => Promise<{ error: unknown }>;
const g = globalThis as unknown as { __sb: unknown; __signOut: SignOutStub };
const scopes: unknown[] = [];
g.__sb = { auth: { signOut: (o: unknown) => { scopes.push(o); return g.__signOut(o); } } };

// THE REAL signOutBackend, lifted out of src/lib/auth.ts (it cannot be imported: auth.ts pulls in
// react-native and @/i18n). `supabase` is the only thing it closes over.
const loadSignOut = async (file: string, backend: unknown = g.__sb) => {
  g.__sb = backend;
  const m = await liftSymbols(
    file,
    [{ header: 'export async function signOutBackend(', endsWith: /^\}$/ }],
    ['signOutBackend'],
    'const supabase: any = (globalThis as any).__sb;',
  );
  return m.signOutBackend as () => Promise<unknown>;
};

console.log('\nA failed sign-out is REPORTED, never silently shown as success\n');

// ── 1. The real function, executed against a failing backend ────────────────────────────────────
// The predicate the whole incident turns on: does a failed sign-out come back as a FAILURE?
const reportsFailure = (v: unknown) => v === false;
const reportsSuccess = (v: unknown) => v === true;

const realSignOut = await loadSignOut(AUTH);

g.__signOut = async () => ({ error: { message: 'Failed to fetch', status: 500 } });
check('signOutBackend returns FALSE when supabase-js reports { error } (the session is still stored)',
  reportsFailure(await realSignOut()));

g.__signOut = async () => { throw new Error('network down'); };
check('signOutBackend returns FALSE when the call throws',
  reportsFailure(await realSignOut()));

g.__signOut = async () => ({ error: null });
check('signOutBackend returns TRUE only on a clean sign-out',
  reportsSuccess(await realSignOut()));

// gotrue-js clears storage itself on 401/403/404 and reports { error: null } — the device IS signed
// out, so that path must stay a success rather than a scary message about nothing.
check("an already-dead token still counts as signed out (gotrue-js resolves { error: null })",
  reportsSuccess(await realSignOut()));

check("the executed call carries scope: 'local' — the fix is about the RESULT, never the scope",
  scopes.length > 0 && scopes.every((o) => JSON.stringify(o) === JSON.stringify({ scope: 'local' })),
  `saw: ${JSON.stringify(scopes)}`);

// Preview builds have no backend at all: there is no stored session to end, so «signed out» is true.
const previewSignOut = await loadSignOut(AUTH, null);
check('with no backend configured (preview) it reports success — nothing is stored to end',
  reportsSuccess(await previewSignOut()));

// ── 2. The real confirm handler, executed against a failed sign-out ─────────────────────────────
// THE REAL onLogout, lifted out of AccountMenu.tsx. Everything it closes over is a recorder; the
// branching, the ordering and the message key are production's own.
type Bus = { calls: string[]; tKeys: string[]; beats: number[]; backendOk: boolean };
const gb = globalThis as unknown as { __bus: Bus };
const PRELUDE = [
  'const bus: any = (globalThis as any).__bus;',
  'const loggingOut = false;',
  'const setLoggingOut = (v: boolean) => bus.calls.push(`setLoggingOut(${v})`);',
  'const setLogoutError = (v: string | null) => bus.calls.push(v === null ? `setLogoutError(null)` : `setLogoutError(msg)`);',
  'const t = (k: string) => { bus.tKeys.push(k); return k; };',
  'const signOutBackend = async () => bus.backendOk;',
  'const signOut = () => bus.calls.push(`store.signOut()`);',
  'const router = { replace: (p: string) => bus.calls.push(`router.replace(${p})`) };',
  'const onClose = () => bus.calls.push(`onClose()`);',
  // The beat is recorded and fired immediately — the barrier proves it is 1200ms and that it does
  // not gate the decision, without spending 1.2s of suite time per scenario.
  'const setTimeout = (fn: any, ms: number) => { bus.beats.push(ms); fn(); };',
].join('\n');

const runLogout = async (file: string, backendOk: boolean): Promise<Bus> => {
  gb.__bus = { calls: [], tKeys: [], beats: [], backendOk };
  const m = await liftSymbols(
    file,
    [{ header: '  const onLogout = async () => {', endsWith: /^  \};$/ }],
    ['onLogout'],
    PRELUDE,
  );
  await (m.onLogout as () => Promise<void>)();
  return gb.__bus;
};

// The invariant, as a predicate both the real handler and the mutant are judged by.
const staysSignedIn = (b: Bus) =>
  !b.calls.includes('store.signOut()') && !b.calls.some((c) => c.startsWith('router.replace'));

const failed = await runLogout(MENU, false);
check('a FAILED sign-out never clears the app: no store signOut(), no navigation to the guest home',
  staysSignedIn(failed), `calls: ${JSON.stringify(failed.calls)}`);
check('a FAILED sign-out TELLS the user (an error message is set) and releases the button',
  failed.calls.includes('setLogoutError(msg)') && failed.calls.includes('setLoggingOut(false)'),
  `calls: ${JSON.stringify(failed.calls)}`);
check('the message is a real i18n key with an Arabic translation — never raw English on screen',
  failed.tKeys.length === 1
  && i18nSrc.includes(`"${failed.tKeys[0]}": 'تعذّر`),
  `key: ${JSON.stringify(failed.tKeys)}`);

const ok = await runLogout(MENU, true);
check('a CONFIRMED sign-out does clear the app and land on the logged-out home, in that order',
  ok.calls.indexOf('store.signOut()') >= 0
  && ok.calls.indexOf('store.signOut()') < ok.calls.indexOf('router.replace(/)'),
  `calls: ${JSON.stringify(ok.calls)}`);
check('the 1.2s beat still runs — alongside the backend call, not instead of it',
  ok.beats.includes(1200) && failed.beats.includes(1200)
  && /await Promise\.all\(\[signOutBackend\(\),[\s\S]{0,80}?1200\)\)\]\)/.test(menuSrc));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the real code, deliberately re-broken\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// M-swallow: the exact pre-fix body — awaits the call, inspects nothing, returns void.
const swallowed = await loadSignOut(mutantOf(authSrc,
  `    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return !error;`,
  `    await supabase.auth.signOut({ scope: 'local' });`), g.__sb);
g.__signOut = async () => ({ error: { message: 'Failed to fetch' } });
mustCatch('the fire-and-forget body that never inspects { error } (returns void on a failed logout)',
  !reportsFailure(await swallowed()));

// M-truthy: a body that returns something truthy regardless — "reported" but not honestly.
const alwaysTrue = await loadSignOut(mutantOf(authSrc, '    return !error;', '    return true;'), g.__sb);
mustCatch('a sign-out that reports success no matter what the backend said',
  !reportsFailure(await alwaysTrue()));

// M-ungated: the result is computed but the UI ignores it — the incident's user-visible half.
mustCatch('onLogout signing the UI out even though the backend sign-out failed',
  !staysSignedIn(await runLogout(mutantOf(menuSrc, '    if (!ok) {', '    if (false) {'), false)));

// M-silent: it stops, but says nothing — a dead button and no explanation is still a lie.
mustCatch('a failed sign-out that stops silently, with no message to the user',
  !(await runLogout(
    mutantOf(menuSrc, 'setLogoutError(t("Couldn\'t sign out this device. Try again."));', ''), false,
  )).calls.includes('setLogoutError(msg)'));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
console.log(failures === 0
  ? '\n✓ sign-out: the backend decides, and a failure is said out loud\n'
  : `\n✗ ${failures} check(s) FAILED — a failed sign-out could look successful again\n`);
process.exit(failures === 0 ? 0 : 1);
