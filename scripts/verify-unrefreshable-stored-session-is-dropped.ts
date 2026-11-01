// A STORED SESSION WITH NO REFRESH TOKEN IS REMOVED BEFORE THE AUTH CLIENT READS IT (Sentry REACT-NATIVE-A/-B).
//   node --experimental-strip-types scripts/verify-unrefreshable-stored-session-is-dropped.ts   (npm test)
// Executes the real functions against a stub storage; also pins that supabase.ts runs it before createClient.
import { readFileSync } from 'node:fs';
import { dropUnrefreshableStoredSessions, isUnrefreshableSession } from '../src/lib/authStorageGuard.ts';

let failed = 0;
const check = (l: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); };
const now = 1_800_000_000;
const mk = (init: Record<string, string>) => {
  const m = new Map(Object.entries(init));
  return { m, length: 0 as number, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => { m.delete(k); },
    get size() { return m.size; } };
};
const st = (init: Record<string, string>) => { const s = mk(init); Object.defineProperty(s, 'length', { get: () => s.m.size }); return s; };

const dead = JSON.stringify({ access_token: 'a', refresh_token: '', expires_at: now - 1000 });
const noField = JSON.stringify({ access_token: 'a', expires_at: now - 1000 });
const refreshable = JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: now - 1000 });
const stillValid = JSON.stringify({ access_token: 'a', refresh_token: '', expires_at: now + 3600 });

check('expired + empty refresh_token is unrefreshable', isUnrefreshableSession(dead, now));
check('expired + missing refresh_token is unrefreshable', isUnrefreshableSession(noField, now));
check('expired but refreshable is KEPT (a real signed-in user)', !isUnrefreshableSession(refreshable, now));
check('unexpired access token is KEPT even with no refresh_token', !isUnrefreshableSession(stillValid, now));
check('garbage JSON / null left to auth-js', !isUnrefreshableSession('{oops', now) && !isUnrefreshableSession(null, now));

const s = st({ 'sb-abc-auth-token': dead, 'sb-xyz-auth-token': refreshable, other: dead });
const removed = dropUnrefreshableStoredSessions(s, now);
check('removes only the dead sb-*-auth-token key', removed.length === 1 && removed[0] === 'sb-abc-auth-token' && s.m.has('sb-xyz-auth-token') && s.m.has('other'));
check('throwing storage never throws', dropUnrefreshableStoredSessions({ length: 1, key() { throw new Error('blocked'); }, getItem: () => null, removeItem() {} } as never, now).length === 0);
check('null storage is a no-op', dropUnrefreshableStoredSessions(null, now).length === 0);

// ── MUTATION PROOFS: the same inputs through deliberately broken predicates must be CAUGHT ──
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught);
const verdicts = (f: (raw: string | null, n: number) => boolean) =>
  [dead, noField, refreshable, stillValid].map((r) => f(r, now));
const expected = [true, true, false, false];
const same = (a: boolean[]) => a.every((v, i) => v === expected[i]);
mustCatch('a guard that never drops anything (the production defect)', !same(verdicts(() => false)));
mustCatch('a guard that drops a refreshable session (signs real users out)', !same(verdicts((r) => !!r)));
mustCatch('a guard that ignores expiry (drops a still-valid token)', !same(verdicts((r) => !JSON.parse(r as string).refresh_token)));
mustCatch('the real predicate is not vacuous', same(verdicts(isUnrefreshableSession)));

const src = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8');
const g = src.indexOf('dropUnrefreshableStoredSessions(window.localStorage)'), c = src.indexOf('createClient(url');
check('supabase.ts drops the dead session BEFORE createClient', g > 0 && c > g);
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
