// Permanent guard: DELETING AN ACCOUNT MUST ACTUALLY DELETE IT — on the server, and on the device.
//
// Two real defects, both reported by the owner on 2026-08-17 ("when i deleted my account it still
// shows the side chat history"):
//
//   1. THE DEVICE WIPE LOST A RACE. deleteAccount() removed storage keys with AsyncStorage only —
//      which resolves on a later tick — while settings.tsx navigates ~1.2s later. A reload landing
//      in that window re-hydrated the history the user had just deleted. The same file already
//      writes SYNCHRONOUSLY in toggleStar/deleteHistory for exactly this reason; delete never got
//      the treatment. Fix: removeKeysSync() (localStorage.removeItem, synchronous) before the async
//      call, in BOTH deleteAccount and signOut.
//
//   2. THE ACCOUNT WAS NEVER DELETED AT ALL. deleteAccount() made no server call: it cleared local
//      state and signed out, so the Supabase auth user survived and signing in again with the same
//      provider returned the same account. Meanwhile About promises: "your searches and account are
//      kept until you delete your account, then permanently removed" — untrue as shipped. Fix: the
//      `delete-account` edge function deletes the caller's own auth user, and the store calls it
//      FIRST, destroying nothing unless the server confirms.
//
// The security property this pins: the function deletes the id proved by the CALLER'S OWN token and
// never an id from the request body — otherwise it would be "delete any account you can name".
//
// 2026-09-14 (routine #10, R1 + R3). Until today every one of these checks was a source-TEXT
// tripwire and none had ever been watched to fail — over an IRREVERSIBLE action whose stated
// security property is "not an account-takeover primitive". The security half is now EXECUTED: the
// real `Deno.serve` handler is lifted out of the real function file and run against a stubbed
// Supabase client, so "it deletes the caller, never an id it was handed" is proven by calling it
// with a body that names someone else's id, rather than by matching the spelling of a line. The
// mutation proofs at the bottom re-introduce each defect and watch the check go red.
//
//   node --experimental-strip-types scripts/verify-account-deletion.ts   (wired into `npm test`)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = readFileSync(join(root, 'src/store.tsx'), 'utf8');
const auth = readFileSync(join(root, 'src/lib/auth.ts'), 'utf8');
// The delete UI moved (owner 2026-08-28): the centered /settings modal was replaced by the
// sidebar-anchored account menu. The truth-telling contract rides along unchanged.
const settings = readFileSync(join(root, 'src/components/AccountMenu.tsx'), 'utf8');
const fnPath = join(root, 'supabase/functions/delete-account/index.ts');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// Isolate deleteAccount's body so a match elsewhere in the file can't satisfy these.
const delStart = store.indexOf('deleteAccount: async () =>');
const delBody = delStart >= 0 ? store.slice(delStart, store.indexOf('runQuery:', delStart)) : '';

// ── 1) SERVER-SIDE DELETION IS REAL, AND HAPPENS BEFORE ANYTHING IS DESTROYED ──
check('an edge function exists to delete the account', existsSync(fnPath));
const fn = existsSync(fnPath) ? readFileSync(fnPath, 'utf8') : '';
check('auth.ts exposes deleteAccountBackend()', /export async function deleteAccountBackend\(\): Promise<boolean>/.test(auth));
check('it invokes the delete-account function', /functions\.invoke\('delete-account'/.test(auth));
check('it reports FALSE unless the server confirmed the delete', /if \(!deleted\) return false;/.test(auth));
check('deleteAccount awaits the server BEFORE touching local state',
  /const serverDeleted = await deleteAccountBackend\(\);[\s\S]{0,200}?if \(!serverDeleted\) return false;/.test(delBody)
  && delBody.indexOf('deleteAccountBackend()') < delBody.indexOf('removeKeysSync('));
check('deleteAccount resolves a boolean the caller can act on', /deleteAccount: \(\) => Promise<boolean>;/.test(store));

// ── 2) THE FUNCTION DELETES THE CALLER, NEVER AN ID IT WAS HANDED ──
//
// EXECUTED, not grepped. `supabase/functions/delete-account/index.ts` cannot be imported (Deno APIs
// at module scope, a `jsr:` specifier), so the REAL handler is lifted out of the REAL file and run
// against a stub client. Everything the handler decides — who gets deleted, what status comes back,
// whether the admin client is touched at all — is observed from the call, never from the text.

/** What the stubbed Supabase client saw. */
type Seen = { deleted: string[]; adminClients: number };

/**
 * Run the REAL handler against a stubbed environment.
 * `tokenOwner` is who Supabase says the Authorization token belongs to (null = invalid/expired).
 */
async function runHandler(opts: {
  env?: Record<string, string>;
  tokenOwner?: string | null;
  deleteError?: { message: string } | null;
  source?: string;
}): Promise<{ status: number; body: any; seen: Seen }> {
  const seen: Seen = { deleted: [], adminClients: 0 };
  const env = opts.env ?? {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    SUPABASE_ANON_KEY: 'anon',
  };
  const PRELUDE = `
const __env = ${JSON.stringify(env)};
const __seen = ${JSON.stringify({ deleted: [], adminClients: 0 })};
const __tokenOwner = ${JSON.stringify(opts.tokenOwner === undefined ? 'caller-uid' : opts.tokenOwner)};
const __deleteError = ${JSON.stringify(opts.deleteError ?? null)};
let __handler: any = null;
const Deno = {
  env: { get: (k: string) => __env[k] },
  serve: (h: any) => { __handler = h; },
};
// The stub distinguishes the two clients the handler builds: the CALLER client (anon key + the
// caller's Authorization header) and the ADMIN client (service-role key). Only the admin one can
// delete, and only the caller one can answer "who is this token".
const createClient = (_url: string, key: string, _opts: any) => {
  if (key === __env.SUPABASE_SERVICE_ROLE_KEY) {
    __seen.adminClients++;
    return { auth: { admin: { deleteUser: async (id: string) => { __seen.deleted.push(id); return { error: __deleteError }; } } } };
  }
  return { auth: { getUser: async () => (__tokenOwner ? { data: { user: { id: __tokenOwner } }, error: null } : { data: { user: null }, error: { message: 'invalid token' } }) } };
};
const __call = async (req: any) => __handler(req);
`;
  if (opts.source === undefined) return await runLifted(fnPath, PRELUDE, seen);
  // A mutant is written to a TEMP dir, never next to the real function: nothing this barrier does
  // may leave a file in supabase/functions/ that could be committed or parsed as a real function.
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const file = join(mkdtempSync(join(tmpdir(), 'ezhalah-delacct-')), 'index.ts');
  writeFileSync(file, opts.source);
  return await runLifted(file, PRELUDE, seen);
}

async function runLifted(file: string, prelude: string, seen: Seen) {
  const mod = await liftSymbols(file, [
    { header: 'const SUPABASE_URL = ', endsWith: /;$/ },
    { header: 'const SERVICE_ROLE_KEY = ', endsWith: /;$/ },
    { header: 'const ANON_KEY = ', endsWith: /;$/ },
    { header: 'const CORS = {', endsWith: /^\};$/ },
    { header: 'function json(', endsWith: /^\}$/ },
    { header: 'Deno.serve(', endsWith: /^\}\);$/ },
  ], ['__call', '__seen'], prelude) as unknown as {
    __call: (req: unknown) => Promise<Response>;
    __seen: Seen;
  };
  const req = (globalThis as any).__pendingReq;
  const res = await mod.__call(req);
  const body = await res.json().catch(() => null);
  Object.assign(seen, mod.__seen);
  return { status: res.status, body, seen };
}

/** A Request the handler can read, without needing a real fetch stack. */
const request = (opts: { method?: string; auth?: string | null; body?: unknown }) => ({
  method: opts.method ?? 'POST',
  headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? (opts.auth ?? null) : null) },
  json: async () => opts.body ?? {},
});

const call = async (req: unknown, o: Parameters<typeof runHandler>[0] = {}) => {
  (globalThis as any).__pendingReq = req;
  return await runHandler(o);
};

// THE SECURITY PROPERTY, EXECUTED: the caller names someone else's id in the body and it is the
// TOKEN's id that gets deleted. This is the assertion that makes this not an account-takeover
// primitive, and until today it was a `!/req\.json\(\)/` grep.
const attack = await call(
  request({ auth: 'Bearer victim-is-not-me', body: { user_id: 'VICTIM-UID', uid: 'VICTIM-UID', sub: 'VICTIM-UID' } }),
  { tokenOwner: 'caller-uid' });
check('the id deleted is the one the TOKEN proves, never one supplied in the request body',
  attack.seen.deleted.length === 1 && attack.seen.deleted[0] === 'caller-uid');
check('…and no id from the body reaches the delete at all', !attack.seen.deleted.includes('VICTIM-UID'));
check('a successful delete reports {deleted:true}', attack.status === 200 && attack.body?.deleted === true);

const anon = await call(request({ auth: null }), { tokenOwner: 'caller-uid' });
check('an unauthenticated caller is refused 401 and NOTHING is deleted',
  anon.status === 401 && anon.body?.error === 'unauthenticated' && anon.seen.deleted.length === 0);

const forged = await call(request({ auth: 'Bearer forged-or-expired' }), { tokenOwner: null });
check('a token Supabase cannot resolve is refused 401 and NOTHING is deleted',
  forged.status === 401 && forged.seen.deleted.length === 0);
check('…and the service-role client is never even constructed for a caller who failed auth',
  forged.seen.adminClients === 0);

const misconfigured = await call(request({ auth: 'Bearer real' }), {
  env: { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ANON_KEY: '' }, tokenOwner: 'caller-uid' });
check('a misconfigured function fails loudly (500 not_configured) instead of reporting success',
  misconfigured.status === 500 && misconfigured.body?.error === 'not_configured'
  && misconfigured.body?.deleted !== true && misconfigured.seen.deleted.length === 0);

const wrongMethod = await call(request({ method: 'GET', auth: 'Bearer real' }), { tokenOwner: 'caller-uid' });
check('a non-POST request is refused and deletes nothing',
  wrongMethod.status === 405 && wrongMethod.seen.deleted.length === 0);

const alreadyGone = await call(request({ auth: 'Bearer real' }),
  { tokenOwner: 'caller-uid', deleteError: { message: 'User not found' } });
check('an already-deleted account reads as success (a retry cannot strand a half-deleted user)',
  alreadyGone.status === 200 && alreadyGone.body?.deleted === true && alreadyGone.body?.already === true);

const failedDelete = await call(request({ auth: 'Bearer real' }),
  { tokenOwner: 'caller-uid', deleteError: { message: 'database is on fire' } });
check('a genuinely FAILED delete never reports deleted:true (the client must not tell the user their account is gone)',
  failedDelete.status === 500 && failedDelete.body?.error === 'delete_failed' && failedDelete.body?.deleted !== true);

// ── 3) THE DEVICE WIPE IS SYNCHRONOUS (the race that showed the history) ──
check('removeKeysSync exists and uses synchronous localStorage.removeItem',
  /const removeKeysSync = \(keys: string\[\]\)/.test(store) && /localStorage\.removeItem\(k\)/.test(store));
check('deleteAccount erases synchronously BEFORE the async AsyncStorage call',
  delBody.indexOf('removeKeysSync(keys)') >= 0
  && delBody.indexOf('removeKeysSync(keys)') < delBody.indexOf('AsyncStorage.multiRemove(keys)'));
check('signOut erases synchronously too (same 1.2s navigation race)',
  /removeKeysSync\(\['pendingMessage', LEGACY_HISTORY_KEY, historyKey\('guest'\)\]\)/.test(store));
check('deleteAccount clears the guest bucket as well as this account’s',
  /const keys = \['pendingMessage', 'locale', LEGACY_HISTORY_KEY, historyKey\('guest'\)\];/.test(delBody));
check('deleteAccount still clears the signed-in account’s own bucket',
  /keys\.push\(historyKey\(user\.sub\)\)/.test(delBody));

// ── 4) THE UI TELLS THE TRUTH ──
check('settings awaits the result instead of assuming success', /const ok = await deleteAccount\(\);/.test(settings));
check('a failed delete does NOT navigate away', /if \(!ok\) \{[\s\S]{0,220}?return;\s*\}/.test(settings));
check('a failed delete shows the user an error', /setDeleteError\(/.test(settings) && /s\.deleteError/.test(settings));

// ── 5) WORTHLESS IF NOTHING RUNS IT ──
check('npm test runs this guard', npmTestRuns(root, 'verify-account-deletion'));

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION PROOFS. Each re-introduces a real defect into a COPY of the real edge function and
// watches the EXECUTED assertions above go red. The last one is the negative control.
// ─────────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

const attackReq = () => request({
  auth: 'Bearer victim-is-not-me',
  body: { user_id: 'VICTIM-UID', uid: 'VICTIM-UID', sub: 'VICTIM-UID' },
});

// THE account-takeover primitive: the handler starts honouring an id from the body.
const takeover = fn.replace(
  '  const { error: delErr } = await admin.auth.admin.deleteUser(uid);',
  '  const body = await req.json().catch(() => ({}));\n' +
  '  const { error: delErr } = await admin.auth.admin.deleteUser(body.user_id ?? uid);');
const takeoverRun = await call(attackReq(), { tokenOwner: 'caller-uid', source: takeover });
mustCatch('"delete any account you can name": an id from the request BODY reaching deleteUser',
  takeoverRun.seen.deleted.includes('VICTIM-UID'));

// The auth check removed — anyone, with no token at all, deletes.
const noAuth = fn.replace('  if (!token) return json({ error: "unauthenticated" }, 401);', '');
const noAuthRun = await call(request({ auth: null }), { tokenOwner: 'caller-uid', source: noAuth });
mustCatch('the unauthenticated refusal being deleted, so a caller with NO token reaches the delete path',
  !(noAuthRun.status === 401 && noAuthRun.seen.deleted.length === 0));

// A token Supabase could not resolve is trusted anyway.
const trustForged = fn.replace('  if (whoErr || !uid) return json({ error: "unauthenticated" }, 401);', '');
const forgedRun = await call(request({ auth: 'Bearer forged' }), { tokenOwner: null, source: trustForged });
mustCatch('a token Supabase REFUSED to resolve no longer stopping the delete',
  !(forgedRun.status === 401 && forgedRun.seen.deleted.length === 0));

// Misconfiguration reported as a successful deletion — the user is told their account is gone.
const silentMisconfig = fn.replace(/  if \(!SUPABASE_URL \|\| !SERVICE_ROLE_KEY\) \{[\s\S]*?\n  \}\n/,
  '  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ deleted: true });\n');
const misconfigRun = await call(request({ auth: 'Bearer real' }), {
  env: { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ANON_KEY: '' },
  tokenOwner: 'caller-uid', source: silentMisconfig });
mustCatch('a MISCONFIGURED function reporting deleted:true — the user is told their account is gone while it is still there',
  misconfigRun.body?.deleted === true && misconfigRun.status === 200);

// A real delete failure reported as success.
const swallowFailure = fn.replace('    return json({ error: "delete_failed" }, 500);', '    return json({ deleted: true });');
const swallowRun = await call(request({ auth: 'Bearer real' }),
  { tokenOwner: 'caller-uid', deleteError: { message: 'database is on fire' }, source: swallowFailure });
mustCatch('a FAILED delete reported as deleted:true (A FAILED FETCH IS NOT AN EMPTY ANSWER, in the delete path)',
  swallowRun.body?.deleted === true);

// Negative control: the function as it actually ships passes every executed assertion.
const shipped = await call(attackReq(), { tokenOwner: 'caller-uid' });
mustCatch('…while the function as it actually ships deletes ONLY the token owner (the assertions are not vacuously red)',
  shipped.seen.deleted.length === 1 && shipped.seen.deleted[0] === 'caller-uid' && shipped.status === 200);

if (failed || mutFail) {
  if (failed) console.error(`\n❌ ${failed} check(s) failed.`);
  if (mutFail) console.error(`❌ ${mutFail} mutation(s) went UNCAUGHT — this guard cannot see the defects it exists for.`);
  process.exit(1);
}
console.log('\n✅ account-deletion contract holds, and is proven to fail on every defect it exists for.');
