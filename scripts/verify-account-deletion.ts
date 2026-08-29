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
//   node --experimental-strip-types scripts/verify-account-deletion.ts   (wired into `npm test`)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = readFileSync(join(root, 'src/store.tsx'), 'utf8');
const auth = readFileSync(join(root, 'src/lib/auth.ts'), 'utf8');
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
check('the function identifies the caller from their own token (auth.getUser)', /auth\.getUser\(\)/.test(fn));
check('it deletes exactly that id', /admin\.auth\.admin\.deleteUser\(uid\)/.test(fn));
check('it never reads a user id out of the request body',
  !/req\.json\(\)/.test(fn) && !/body\.(user_?id|uid|sub)/i.test(fn));
check('it refuses unauthenticated callers', /return json\(\{ error: "unauthenticated" \}, 401\)/.test(fn));
check('a misconfigured function fails loudly instead of reporting success',
  /if \(!SUPABASE_URL \|\| !SERVICE_ROLE_KEY\)[\s\S]{0,220}?not_configured/.test(fn));

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
check('a failed delete shows the user an error', /setDeleteError\(/.test(settings) && /s\.delError/.test(settings));

console.log(failed === 0 ? '\n✅ account-deletion contract holds.' : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
