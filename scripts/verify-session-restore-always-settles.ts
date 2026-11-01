// THE LAUNCH GATE ALWAYS OPENS — `authChecked` is set on every path, including the ones that fail.
//
//   node --experimental-strip-types scripts/verify-session-restore-always-settles.ts   (npm test)
//
// WHY THIS EXISTS (routine #6, 2026-09-27, ops_incident filed this run). `authChecked` gates the
// local history restore, the server pull, the sign-in card, the cookie-consent banner and the intro
// (`if (!authChecked) return` × 5 in src/store.tsx). The launch restore awaited
// `supabase.auth.getSession()` with NO timeout and NO `.catch()`, and getSession() is not the
// local-only read its name suggests: on an expired session @supabase/auth-js calls _callRefreshToken
// over the network. Measured on production, Chromium 1440x900, 2/2 fresh contexts per arm, oracle =
// [data-testid="cookie-consent"] + [data-testid="signin-card"] (both gated on authChecked && !user),
// against a true-guest control rendering BOTH on the same served bundle:
//
//   expired + refresh_token: ''   → both ABSENT at 20s, 40s AND 75s (PERMANENT; getSession() rejects
//                                   with AuthSessionMissingError, 3 uncaught page errors per load)
//   expired + refresh BLOCKED     → both absent at 20s and 40s, back by 75s (>40s of a dead-looking
//                                   app with ZERO error signal)
//
// A catch alone cannot fix the second arm (it never rejects) and a timeout alone cannot fix the first
// (it rejects). Both are required.
//
// ── THIS BARRIER EXECUTES THE REAL FUNCTION AGAINST INJECTED FAILURES ──
// It does NOT grep the line. AGENTS.md ("A FAILED FETCH IS NOT AN EMPTY ANSWER") is explicit that
// every defect of this class already had a source-TEXT tripwire over the exact line, and every one of
// those tripwires passed for the whole time the defect was live — two of them pinned the defective
// line as correct. §1 drives `beginSessionRestore` with stub clients that fail the way supabase-js
// really fails (RESOLVING `{data:null}`, REJECTING, and never settling at all); §2 pins the class so
// a new unbounded auth gate cannot be added silently.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beginSessionRestore, GETSESSION_TIMEOUT_MS } from '../src/lib/sessionRestore.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// A CONTROLLABLE CLOCK, so the 6s timeout is proven by EXECUTION without the suite sleeping for it.
// A fixed sleep would make this check slow AND would stop pinning the value: with an injected timer
// the assertion is "it armed a timer for exactly GETSESSION_TIMEOUT_MS", which a change to the
// constant cannot quietly pass.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
type Armed = { fn: () => void; ms: number; cleared: boolean };
const clock = () => {
  const timers: Armed[] = [];
  return {
    timers,
    setTimer: (fn: () => void, ms: number) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (h: unknown) => { (h as Armed).cleared = true; },
    /** Fire every armed, uncleared timer — i.e. let the wall clock reach the timeout. */
    advance: () => timers.filter((t) => !t.cleared).forEach((t) => t.fn()),
  };
};

const USER = { app_metadata: { provider: 'google' } };

// A LEAKED REJECTION IS ITSELF ONE OF THE FINDINGS, not a reason for this file to die.
// The production defect surfaced exactly this way: an un-caught getSession() rejection reached the
// page as `AuthSessionMissingError: Auth session missing!`, 3× per load. Node's default for an
// unhandled rejection is to kill the process, which would take this barrier down mid-report the
// moment a mutant reproduced the defect — so rejections are collected and judged instead.
const leaked: unknown[] = [];
process.on('unhandledRejection', (e) => { leaked.push(e); });
// Two macrotask turns: `unhandledRejection` is not emitted until the microtask queue has drained.
const settleTurns = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };

type Outcome = { checked: number; users: number; armedMs: number[] };

// THE RESTORE UNDER TEST, as an injectable — so the mutation section at the bottom can hand this same
// oracle a DELIBERATELY BROKEN implementation and watch the oracle reject it. Testing a hand-copied
// duplicate of production instead is the drift class scripts/lib/liftSymbols.ts exists to kill
// (feedback_never-test-a-copy-of-production-code); the real import above stays the default.
type Restore = typeof beginSessionRestore;

const drive = async (
  getSession: () => Promise<never> | Promise<unknown>,
  opts: { advance?: boolean; impl?: Restore } = {},
) => {
  const c = clock();
  const out: Outcome = { checked: 0, users: 0, armedMs: [] };
  const cancel = (opts.impl ?? beginSessionRestore)({
    getSession: getSession as never,
    onUser: () => { out.users++; },
    onChecked: () => { out.checked++; },
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
  });
  // Let the getSession() promise's .then/.catch microtasks drain before judging.
  await new Promise((r) => setTimeout(r, 0));
  if (opts.advance) { c.advance(); await new Promise((r) => setTimeout(r, 0)); }
  out.armedMs = c.timers.map((t) => t.ms);
  return { out, cancel };
};

/**
 * THE ORACLE, in one place: what must hold of ANY launch restore. Returns the problems it found, so
 * §1 can assert the real unit has none and the mutation section can assert a broken one has some.
 * Every arm corresponds to a shape measured on production — see the header.
 */
const gateProblems = async (impl: Restore): Promise<string[]> => {
  const bad: string[] = [];
  const ok = (u: unknown) => async () => ({ data: { session: u ? { user: u } : null } });
  leaked.length = 0;

  const a = await drive(ok(USER), { impl });
  if (a.out.checked !== 1 || a.out.users !== 1) bad.push('a session did not settle exactly once with its user');

  const b = await drive(ok(null), { impl });
  if (b.out.checked !== 1 || b.out.users !== 0) bad.push('an empty session did not settle exactly once as a guest');

  // The PERMANENT production arm: getSession() rejects (expired + refresh_token: '').
  const c2 = await drive(() => Promise.reject(new Error('AuthSessionMissingError')), { impl });
  await settleTurns();
  if (c2.out.checked !== 1) bad.push('a REJECTED getSession() left the gate closed');
  if (leaked.length) {
    bad.push(`a REJECTED getSession() leaked ${leaked.length} unhandled rejection(s) — which is how `
      + 'this reached production: AuthSessionMissingError as an uncaught page error, 3× per load');
    leaked.length = 0;
  }

  // The >40s arm: getSession() never settles while auth-js retries a blocked refresh.
  const d = await drive(() => new Promise(() => {}), { advance: true, impl });
  if (d.out.checked !== 1) bad.push('a getSession() that never settles left the gate closed');

  // Bounded, at the stated value — pinned BY VALUE, never retyped (PART 5 shape #14).
  const e = await drive(() => new Promise(() => {}), { impl });
  if (e.out.armedMs.length !== 1 || e.out.armedMs[0] !== GETSESSION_TIMEOUT_MS) {
    bad.push(`the wait was not bounded at GETSESSION_TIMEOUT_MS (armed ${JSON.stringify(e.out.armedMs)})`);
  }

  // Exactly once: a timeout followed by a late resolution must not double-settle.
  let release: (v: unknown) => void = () => {};
  const f = await drive(() => new Promise((r) => { release = r; }), { advance: true, impl });
  release({ data: { session: { user: USER } } });
  await new Promise((r) => setTimeout(r, 0));
  if (f.out.checked !== 1) bad.push(`timeout then a late resolution settled ${f.out.checked}×, not once`);

  // cancel() (the effect cleanup) must suppress a later settle entirely.
  const cl = clock();
  let checked = 0;
  let rel2: (v: unknown) => void = () => {};
  const cancel = impl({
    getSession: (() => new Promise((r) => { rel2 = r; })) as never,
    onUser: () => {}, onChecked: () => { checked++; },
    setTimer: cl.setTimer, clearTimer: cl.clearTimer,
  });
  cancel();
  rel2({ data: { session: { user: USER } } });
  cl.advance();
  await new Promise((r) => setTimeout(r, 0));
  if (checked !== 0) bad.push('a cancelled restore still opened the gate');

  return bad;
};

console.log('§1  THE GATE OPENS ON EVERY PATH — the real function, executed against real failure shapes');
{
  const bad = await gateProblems(beginSessionRestore);
  check('1.1  src/lib/sessionRestore.ts satisfies every arm of the oracle', bad.length === 0,
    bad.map((b) => `- ${b}`).join('\n        '));
  console.log(`      arms exercised: a session · an empty session · a REJECTED getSession() (the`
    + ` permanent production arm) · a getSession() that NEVER settles (the >40s arm) ·`
    + ` the bound is exactly ${GETSESSION_TIMEOUT_MS}ms · timeout-then-late-resolution settles once ·`
    + ` cancel() suppresses both`);
  check(`1.2  the bound is under auth-js AUTO_REFRESH_TICK_DURATION_MS (30000) — a bound longer than the`
    + ` library's own retry window would be decoration`,
    GETSESSION_TIMEOUT_MS < 30_000, `${GETSESSION_TIMEOUT_MS}`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n§1b MUTATION PROOF — the oracle above is watched REJECTING each half of the real defect');
// Not prose: each stand-in below is a restore that is broken in exactly one way production was, and
// `gateProblems` — the same function that cleared the real unit — is asked to find it. A barrier
// nobody watched fail is a comment that runs.
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — §1 is blind to the defect it exists to catch');

type Deps = Parameters<typeof beginSessionRestore>[0];

// THE ORIGINAL DEFECT, verbatim in shape: awaited, unbounded, un-caught.
const noBoundNoCatch: Restore = (d: Deps) => {
  d.getSession().then((r) => { const su = (r as never as { data: { session?: { user?: unknown } } })
    .data?.session?.user; if (su) d.onUser(su as never); d.onChecked(); });
  return () => {};
};
mustCatch('a restore with NO timeout and NO catch (production before this fix)',
  (await gateProblems(noBoundNoCatch)).length > 0);

// Half a fix, each direction — the two ways someone "fixes" this and leaves an arm live.
const catchOnly: Restore = (d: Deps) => {
  const settle = (su: unknown) => { if (su) d.onUser(su as never); d.onChecked(); };
  d.getSession().then((r) => settle((r as never as { data: { session?: { user?: unknown } } })
    .data?.session?.user ?? null)).catch(() => settle(null));
  return () => {};
};
mustCatch('a catch with NO timeout (leaves the >40s blocked-refresh arm dead)',
  (await gateProblems(catchOnly)).length > 0);

const timeoutOnly: Restore = (d: Deps) => {
  let settled = false;
  const settle = (su: unknown) => { if (settled) return; settled = true; if (su) d.onUser(su as never); d.onChecked(); };
  const st = d.setTimer ?? ((f, m) => setTimeout(f, m));
  st(() => settle(null), d.timeoutMs ?? GETSESSION_TIMEOUT_MS);
  d.getSession().then((r) => settle((r as never as { data: { session?: { user?: unknown } } })
    .data?.session?.user ?? null));
  return () => {};
};
mustCatch('a timeout with NO catch (leaves the PERMANENT rejected-refresh arm dead)',
  (await gateProblems(timeoutOnly)).length > 0);

// A bound so generous it sits past auth-js's own 30s retry ceiling is not a bound.
const tooSlow: Restore = (d: Deps) => beginSessionRestore({ ...d, timeoutMs: 45_000 });
mustCatch('a bound loosened past the library retry window',
  (await gateProblems(tooSlow)).length > 0);

// The opposite failure: a restore that opens the gate but LOSES the signed-in user, which would
// silently log everyone out. An oracle that only counted onChecked would pass this.
const dropsUser: Restore = (d: Deps) => beginSessionRestore({ ...d, onUser: () => {} });
mustCatch('a restore that opens the gate but discards the signed-in user',
  (await gateProblems(dropsUser)).length > 0);

// And a restore that ignores cleanup — the stale-write-after-unmount shape.
const ignoresCancel: Restore = (d: Deps) => { beginSessionRestore(d); return () => {}; };
mustCatch('a restore whose cancel() does not actually cancel',
  (await gateProblems(ignoresCancel)).length > 0);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n§2  THE CLASS — no auth call may gate the UI unbounded');
// §1 proves THIS function. §2 is why a fourth call site added tomorrow cannot repeat the defect:
// it DISCOVERS every supabase.auth.getSession()/getUser() in src/ by shape and requires each one to
// be accounted for. The ledger is shrink-only — a new site is RED until someone states how it is
// bounded, which is the review conversation this defect never got.
//
// Scoped to the two READS that can trigger a network refresh. Mutating calls (signOut,
// signInWithOAuth, updateUser) are user-initiated actions with their own error paths, not silent
// gates on first paint.
const SRC = 'src';
const walk = (d: string, out: string[] = []): string[] => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
};

// file → how it is bounded. Every entry is a STATEMENT someone had to make, not a silence.
const ACCOUNTED: Record<string, string> = {
  'src/store.tsx':
    'the call survives here only as the thunk handed to beginSessionRestore() — the timeout, the '
    + 'catch and the settle-once rule all live in that unit, which §1 executes. §3.1 pins the '
    + 'delegation, so reverting to a bare `.then()` here fails this file rather than passing it.',
  'src/lib/sessionRestore.ts':
    'the unit §1 executes: timeout + catch, onChecked exactly once on all four paths',
  'src/components/GoogleOneTap.tsx':
    'GETUSER_TIMEOUT_MS + .catch() + a settled flag, defaulting to SIGNED OUT (measured 2026-08-18)',
  'src/lib/devices.ts':
    'try/catch returning null, and the caller treats null as "could not load" rather than "none" — '
    + 'it decorates a device list, it does not gate first paint',
  'src/lib/auth.ts':
    'getCurrentUser(): try/catch returning null; gates nothing (no call sites in src/)',
};

const offenders: string[] = [];
for (const f of walk(SRC)) {
  const src = readFileSync(f, 'utf8');
  // Comment lines are excluded deliberately: this file's own prose names these calls repeatedly, and
  // a corpus built from raw text would flag every file that merely DISCUSSES the hazard — the exact
  // mistake verify-e2e-targets-still-exist-in-the-product.ts documents.
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  if (!/\.auth\s*\.\s*(getSession|getUser)\s*\(/.test(code)) continue;
  const norm = f.split(/[\\/]/).join('/');
  if (!(norm in ACCOUNTED)) offenders.push(norm);
}
check('2.1  every src/ auth READ that could gate the UI is accounted for',
  offenders.length === 0,
  offenders.length
    ? `UNACCOUNTED: ${offenders.join(', ')}\n        `
      + 'A getSession()/getUser() on an expired session is a NETWORK call that can hang. If this new '
      + 'site gates any UI, bound it (timeout + catch) as src/lib/sessionRestore.ts does; then add it '
      + 'to ACCOUNTED in this file saying how. Do not delete this check.'
    : '');

// The ledger cannot rot into a list of files that no longer exist — a stale entry would quietly
// reserve room for a real offender to reappear under the same path.
const stale = Object.keys(ACCOUNTED).filter((f) => {
  try { return !/\.auth\s*\.\s*(getSession|getUser)\s*\(/.test(readFileSync(f, 'utf8')); }
  catch { return true; }
});
check('2.2  no stale ACCOUNTED entry (shrink-only: a fixed/removed site must leave the ledger)',
  stale.length === 0, stale.length ? `stale: ${stale.join(', ')}` : '');

// §3 — the gate this all exists for is really still a gate. If store.tsx ever stops gating on
// authChecked, §1's guarantees still hold but this barrier's PREMISE would be gone, and a reader
// would be told a stronger thing than is true (AGENTS.md PART 1.11: a pointer reads as coverage).
const store = readFileSync('src/store.tsx', 'utf8');
const gates = (store.match(/if\s*\(!authChecked\)\s*return/g) || []).length;
check('3.1  store.tsx still gates on authChecked (so the invariant §1 proves still matters)',
  gates >= 3 && /beginSessionRestore\(/.test(store),
  `gates=${gates}, delegates=${/beginSessionRestore\(/.test(store)}`);

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
