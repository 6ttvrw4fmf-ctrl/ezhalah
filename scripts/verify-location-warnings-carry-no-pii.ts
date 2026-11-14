// THE LOCATION-POOL WARNINGS CARRY NO PERSONAL DATA — EVENT LEVEL (CodeRabbit on #11370, 2026-11-08).
// src/data/locations.ts reports three warnings (city give-up, district give-up, cluster read). Sentry attaches
// the current user to every event, and AuthUser.sub is `email || name`, so before #11370 each warning would
// have carried the customer's email or name. This check EXECUTES the real identifyUser + reportError against a
// recording Sentry that models the inherited scope (setUser → every later event) and runs the real beforeSend
// (scrubEvent), then reads the events that would leave the device:
//   signed in (accountId) · signed in with no accountId · signed out → user, level, fingerprint, no name/email.
// The three reportError calls are taken from locations.ts itself, so a changed call is what gets tested.
//   node --experimental-strip-types scripts/verify-location-warnings-carry-no-pii.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { identifyUser, reportError, scrubEvent, __setSentryForTest, type SentryEventShape } from '../src/lib/observability.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `  → ${why}`}`); if (!ok) failed++; };

// A recording Sentry: the user set by setUser is inherited by every later event (Sentry's scope), and every
// event goes through the REAL beforeSend (scrubEvent) before it would be sent.
const sent: SentryEventShape[] = [];
let scopeUser: { id?: string } | null = null;
__setSentryForTest({
  init: () => {},
  setTag: () => {},
  setUser: (u) => { scopeUser = u; },
  captureMessage: () => {},
  captureException: (err, ctx) => {
    const c = (ctx ?? {}) as Record<string, any>;
    const ev = { user: scopeUser ? { ...scopeUser, email: 'leak@example.com', username: 'يوسف النشوان' } : undefined,
      level: c.level, fingerprint: c.fingerprint, extra: c.extra, tags: c.tags,
      exception: { values: [{ type: 'Error', value: String((err as Error)?.message ?? err) }] } } as unknown as SentryEventShape;
    const out = scrubEvent(ev);
    if (out) sent.push(out);
  },
} as any);

// The three warnings exactly as locations.ts calls them.
const src = readFileSync(join(import.meta.dirname, '..', 'src/data/locations.ts'), 'utf8');
const calls = [...src.matchAll(/reportError\(((?:new Error\('[^']*'\))|e), (\{[^}]*\}), (\{[^\n]*\})\);/g)];
check('locations.ts still makes exactly three warning calls (city give-up, district give-up, cluster read)', calls.length === 3, `found ${calls.length}`);
const fire = () => {
  for (const m of calls) {
    // eslint-disable-next-line no-new-func
    const [err, ctx, opts] = new Function('e', `return [${m[1]}, ${m[2]}, ${m[3]}];`)(new Error('loc_city_cluster: aborted'));
    reportError(err, ctx, opts);
  }
};
const PII = /@|يوسف|النشوان|leak/;
const noPii = (evs: SentryEventShape[]) => evs.every((e) => !PII.test(JSON.stringify(e)));

// 1. Signed in, with the account UUID (store.tsx: identifyUser(user?.accountId ?? null)).
identifyUser('6f1c2a7e-0b3d-4c55-9a11-2f8e9d0c4b21'); sent.length = 0; fire();
check('signed in: three warnings leave the device', sent.length === 3, `got ${sent.length}`);
check('signed in: each carries only an opaque u_<16 hex> id', sent.every((e) => /^u_[0-9a-f]{16}$/.test(e.user?.id ?? '') && Object.keys(e.user ?? {}).length === 1));
check('signed in: no name or email anywhere in the events (scope-inherited email/username dropped)', noPii(sent));
check('every warning is level «warning»', sent.every((e: any) => e.level === 'warning'));
const fps = sent.map((e: any) => (e.fingerprint ?? []).join('/')).sort();
check('fingerprints are the three location-pool ones', JSON.stringify(fps) === JSON.stringify(['location-pool/cluster-read', 'location-pool/give-up/city', 'location-pool/give-up/district']), fps.join(' | '));

// 2. Signed in but no accountId (store passes null) → no user at all.
identifyUser(null); sent.length = 0; fire();
check('no accountId: the warnings carry no user', sent.length === 3 && sent.every((e) => !e.user), JSON.stringify(sent.map((e) => e.user)));
check('no accountId: no name or email', noPii(sent));

// 3. A mistaken caller passes the raw sub (an email) → it still leaves only as a hash.
identifyUser('yalnashw@asu.edu'); sent.length = 0; fire();
check('a raw email passed by mistake leaves only as a hash, never the address', sent.every((e) => /^u_[0-9a-f]{16}$/.test(e.user?.id ?? '')) && noPii(sent));

// 4. Sign-out clears the user.
identifyUser(null); sent.length = 0; fire();
check('signed out: no user on the warnings', sent.every((e) => !e.user));

// MUTATION PROOFS — the same predicates applied to deliberately broken events.
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
const unscrubbed = { user: { id: 'yalnashw@asu.edu', email: 'leak@example.com', username: 'يوسف النشوان' }, level: 'warning' } as unknown as SentryEventShape;
mustCatch('a beforeSend that skips scrubEvent (the inherited email/name reach the event)', !noPii([unscrubbed]));
mustCatch('a raw sub kept as user.id (the pre-#11370 identifyUser)', !noPii([{ user: { id: 'yalnashw@asu.edu' } } as SentryEventShape]));
mustCatch('a warning sent at the default level', !([{ level: 'error' }] as any[]).every((e) => e.level === 'warning'));

__setSentryForTest(null);
if (failed) { console.error(`\n❌ verify-location-warnings-carry-no-pii: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ verify-location-warnings-carry-no-pii: the three location warnings leave the device with no name or email');
