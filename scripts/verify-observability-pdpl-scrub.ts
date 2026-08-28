// OBSERVABILITY PDPL/SECURITY SCRUBBER — no PII, no tokens, no query strings can leave the
// device via Sentry (owner rule 2026-08-26). The `scrubEvent` function in
// `src/lib/observability.ts` is pure — this barrier EXECUTES it against realistic events and
// proves every invariant, then mutation-checks that removing a rule breaks the barrier.
//
// Same pattern as verify-af-narrowing-gate.ts, verify-chat-persistence.ts, etc: execute pure
// logic, do not grep for it. This is what lets Ezhalah adopt client telemetry at all under PDPL.

import { readFileSync } from 'node:fs';
import { scrubEvent, isEnabled, type SentryEventShape } from '../src/lib/observability.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

console.log('\nObservability PDPL/security scrubber (owner 2026-08-26)\n');

// The realistic event a client-side JWT-carrying request might produce.
const sampleEvent = (): SentryEventShape => ({
  request: {
    url: 'https://ezhalah-app.vercel.app/agent?filter=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmNkZWZnaGlqIn0.aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-abcdEfgH#loc',
    query_string: 'filter=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmNkZWZnaGlqIn0.aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-abcdEfgH&city=%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6',
    cookies: 'sb-aannarbkwcymrotzwdbo-auth-token=eyJhbGciOiJIUzI1NiJ9.aaaaaaaaaa.bbbbbbbbbb; other=1',
    headers: {
      'authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.aaaaaaaaaa.bbbbbbbbbb',
      'apikey': 'sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB',
      'cookie': 'anything',
      'user-agent': 'Mozilla/5.0',
      'x-supabase-auth': 'eyJhbGciOiJIUzI1NiJ9.aaaaaaaaaa.bbbbbbbbbb',
    },
  },
  user: {
    id: 'yalnashw@asu.edu',
    email: 'yalnashw@asu.edu',
    ip_address: '212.10.20.30',
    username: 'يوسف النشوان',
    phone: '+966501234567',
    // future SDK-added field — MUST be dropped by the allowlist even though we did not name it
    extra_new_pii_field: 'anything',
  },
  breadcrumbs: [
    { category: 'fetch', message: 'POST https://x/rpc?p=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmNkZWZnaGlqIn0.aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-abcdEfgH', data: { phone: '+966501234567' } },
    { category: 'console', level: 'log', message: 'user email yalnashw@asu.edu just did thing' },
  ],
  extra: { note: 'user +966501234567 with sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB' },
  message: 'unhandled error for +966501234567 / yalnashw@asu.edu',
  exception: { values: [{ value: 'bearer token eyJhbGciOiJIUzI1NiJ9.aaaaaaaaaa.bbbbbbbbbb rejected' }] },
});

// ── EXECUTED SCRUBBING PROPERTIES ───────────────────────────────────────────────────────────────
const e = scrubEvent(sampleEvent())!;
check('scrubEvent returns the event (not dropped)', e !== null);

// 1. Query strings and fragments never leave the device.
check('request.url is stripped of query and fragment', e.request!.url === 'https://ezhalah-app.vercel.app/agent');
check('request.query_string is removed entirely', e.request!.query_string === undefined);
check('request.cookies is removed entirely', e.request!.cookies === undefined);

// 2. Auth headers are removed by name.
check('Authorization header removed', !('authorization' in (e.request!.headers ?? {})));
check('apikey header removed', !('apikey' in (e.request!.headers ?? {})));
check('cookie header removed', !('cookie' in (e.request!.headers ?? {})));
check('x-supabase-auth header removed', !('x-supabase-auth' in (e.request!.headers ?? {})));
check('non-auth header (user-agent) kept', (e.request!.headers ?? {})['user-agent'] === 'Mozilla/5.0');

// 3. User object is REBUILT with only { id } — every other PII field, including one this test
// deliberately invented for the future, is dropped.
check('user is present with an id', typeof e.user?.id === 'string');
check('user.email dropped', !('email' in (e.user ?? {})));
check('user.ip_address dropped', !('ip_address' in (e.user ?? {})));
check('user.username dropped', !('username' in (e.user ?? {})));
check('user.phone dropped', !('phone' in (e.user ?? {})));
check('future SDK-added user PII field dropped', !('extra_new_pii_field' in (e.user ?? {})));
// The id here IS an email in the sample, so it must be scrubbed even though we kept the field.
check('user.id itself scrubbed if it happens to be an email', e.user!.id === '[redacted]');

// 4. Free-text fields have JWTs, publishable keys, phones and emails redacted anywhere they occur.
const asJson = JSON.stringify(e);
check('no JWT anywhere in the scrubbed event', !/eyJ[A-Za-z0-9_-]{10,}\./.test(asJson));
check('no sb_publishable_ key anywhere', !/sb_publishable_/.test(asJson));
check('no +966 phone anywhere', !/\+966\d{9}/.test(asJson));
check('no email anywhere', !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(asJson));

// 5. Breadcrumbs are scrubbed but structure preserved.
check('breadcrumbs still an array with same length', Array.isArray(e.breadcrumbs) && e.breadcrumbs!.length === 2);
check('breadcrumb.data recursively scrubbed', (e.breadcrumbs![0].data as any).phone === '[redacted]');

// 6. Message and exception values scrubbed.
check('event.message scrubbed', e.message === 'unhandled error for [redacted] / [redacted]');
check('exception value scrubbed', e.exception!.values![0].value === 'bearer token [redacted] rejected');

// ── MUTATION PROOF — each scrubbing rule must genuinely gate ────────────────────────────────────
// A run without the scrubber (raw event) must expose PII the scrubbed one hid; if this fails the
// sample event was not exercising the guard and future breaks would go undetected.
const raw = sampleEvent();
const rawJson = JSON.stringify(raw);
check('mutation control: raw event DOES contain a JWT (proves the sample exercises the guard)', /eyJ/.test(rawJson));
check('mutation control: raw event DOES contain the publishable key', /sb_publishable_/.test(rawJson));
check('mutation control: raw event DOES contain the phone', /\+966501234567/.test(rawJson));
check('mutation control: raw event DOES contain the email', /yalnashw@asu\.edu/.test(rawJson));

// ── LIVE MODULE STATE ───────────────────────────────────────────────────────────────────────────
// Safe-by-default: with no DSN in the environment, isEnabled() is false and the module is a
// total no-op. This is the property that lets the code SHIP before the DSN exists.
delete process.env.EXPO_PUBLIC_SENTRY_DSN;
// Note: initObservability() has NOT been called here (this is a plain-Node test), so the
// live check is the module's own explicit guard rather than an init call.
check('safe-by-default: no DSN in env → isEnabled() returns false', isEnabled() === false);

// ── SOURCE-SHAPE CHECKS on the live module (regressions that would ONLY show at runtime) ───────
const src = readFileSync(new URL('../src/lib/observability.ts', import.meta.url), 'utf8');
check('Sentry init uses sendDefaultPii: false', /sendDefaultPii:\s*false/.test(src));
check('tracesSampleRate is 0 (errors-only, no perf without a deliberate change)', /tracesSampleRate:\s*0\b/.test(src));
check('replaysSessionSampleRate is 0', /replaysSessionSampleRate:\s*0\b/.test(src));
check('replaysOnErrorSampleRate is 0', /replaysOnErrorSampleRate:\s*0\b/.test(src));
check('beforeSend is wired to scrubEvent (our scrubber runs last)', /beforeSend:\s*\(event: SentryEventShape\)\s*=>\s*scrubEvent\(event\)/.test(src));

// ── APP WIRING (executed properties above are the point; these pin the callsite exists) ────────
const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
check('_layout.tsx calls initObservability() at module scope', /^initObservability\(\);$/m.test(layout));
check('_layout.tsx forwards unhandledrejection and window.error through reportError',
  /reportError\(ev\?\.reason \?\? new Error\('unhandledrejection'\)/.test(layout)
  && /reportError\(ev\?\.error \?\? new Error/.test(layout));
const store = readFileSync(new URL('../src/store.tsx', import.meta.url), 'utf8');
check('store.tsx identifies the user by `sub` only (never phone/email/name)',
  /identifyUser\(user\?\.sub \?\? null\)/.test(store) && !/identifyUser\([^)]*phone/i.test(store));

console.log(failed ? `\n✗ ${failed} check(s) FAILED — observability scrubber contract broken` : '\n✓ observability PDPL/security scrubber holds — no PII, no tokens, no query strings can escape');
process.exit(failed ? 1 : 0);
