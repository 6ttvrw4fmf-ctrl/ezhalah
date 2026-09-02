// THIRD-PARTY SENTRY NOISE MUST BE DROPPED ON THE DEVICE.
// Routine #7 (Daily Systems Seam Engineer), 2026-09-02. Offline, deterministic, in `npm test`.
//
// THE HOLE THIS CLOSES. docs/ops/SENTRY_ROUTING.md §2.1 states that third-party script errors
// (Google One Tap/GSI, browser-extension noise, ResizeObserver loop) "should drop [in beforeSend]
// before they cost anyone a triage", and names routine #7 as the owner of that list. The list did
// not exist: scrubEvent's return type allowed null, and the comment underneath it read "currently
// we never do". Nothing was ever dropped.
//
// So REACT-NATIVE-7 reached the queue on 2026-09-02 — `Error: pa`, culprit `_.ok(gsi/client)`,
// Chrome 117/Windows: Google Identity Services throwing inside its own XHR readystatechange
// handler, with no first-party code involved. The fixture below is that event's real shape.
//
// THE PROPERTY THAT MATTERS MOST IS THE NEGATIVE ONE. A drop rule that is too eager silently
// deletes real crashes, which is strictly worse than the noise it removes. Every "kept" case below
// exists to pin that, especially KEPT #1: the noisy event's two OUTERMOST frames are our own
// bundle (Sentry's XHR instrumentation wrapper lives there), so a naive "no first-party frame"
// rule would keep the noise, and an inverted one would drop real errors that merely pass through
// instrumented code.
//
// Run: node --experimental-strip-types scripts/verify-sentry-third-party-noise-dropped.ts
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { npmTestRuns } from './lib/testRegistry.ts';
import { scrubEvent, isThirdPartyNoise, type SentryEventShape } from '../src/lib/observability.ts';

const ROOT = join(import.meta.dirname, '..');
const SOURCE = 'src/lib/observability.ts';
const ROUTING_DOC = 'docs/ops/SENTRY_ROUTING.md';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// ── 1. DROPPED: the real REACT-NATIVE-7 event, frame for frame ────────────────────────────────
// Sentry orders frames oldest-first, so the LAST frame is the one that actually threw.
const gsiEvent: SentryEventShape = {
  culprit: '_.ok(gsi/client)',
  exception: {
    values: [
      {
        value: 'pa',
        stacktrace: {
          frames: [
            { filename: '/_expo/static/js/web/entry-b234f27ecb15e19d955ae275a397864d.js' },
            { filename: '/_expo/static/js/web/entry-b234f27ecb15e19d955ae275a397864d.js' },
            { filename: '/gsi/client' },
            { filename: '/gsi/client' },
            { filename: '/gsi/client' },
          ],
        },
      },
    ],
  },
};
check(
  isThirdPartyNoise(gsiEvent),
  'the real REACT-NATIVE-7 GSI event is recognised as third-party noise',
  'REACT-NATIVE-7 is NOT recognised — the exact event this rule was written for still reaches the queue',
);
check(
  scrubEvent(structuredClone(gsiEvent)) === null,
  'scrubEvent DROPS the GSI event (beforeSend returns null)',
  'scrubEvent no longer drops the GSI event — the ignore list is disconnected from beforeSend',
);

// ── 2. DROPPED: the other origins §2.1 names ──────────────────────────────────────────────────
const dropCases: Array<[string, SentryEventShape]> = [
  ['ResizeObserver loop', { message: 'ResizeObserver loop limit exceeded' }],
  ['ResizeObserver undelivered', { message: 'ResizeObserver loop completed with undelivered notifications.' }],
  ['chrome extension', { exception: { values: [{ value: 'x', stacktrace: { frames: [{ filename: 'chrome-extension://abcd/inject.js' }] } }] } }],
  ['firefox extension', { exception: { values: [{ value: 'x', stacktrace: { frames: [{ filename: 'moz-extension://abcd/inject.js' }] } }] } }],
  ['GSI by culprit only', { culprit: 'accounts.google.com/gsi/client' }],
  ['abs_path fallback', { exception: { values: [{ value: 'x', stacktrace: { frames: [{ abs_path: 'https://accounts.google.com/gsi/client' }] } }] } }],
];
for (const [name, ev] of dropCases) {
  check(isThirdPartyNoise(ev), `dropped: ${name}`, `NOT dropped: ${name} — §2.1 names it and it still costs a triage`);
}

// ── 3. KEPT: everything first-party. The half that must never regress ─────────────────────────
const keepCases: Array<[string, SentryEventShape]> = [
  // #1 THE TRAP: a real app error whose OUTER frames are third-party (a callback invoked by GSI)
  // but which THREW in our own code. The innermost frame is ours, so it must be kept.
  ['app error thrown inside a GSI callback', {
    culprit: 'onCredentialResponse(src/components/GoogleOneTap.tsx)',
    exception: { values: [{ value: 'Cannot read properties of undefined', stacktrace: { frames: [
      { filename: '/gsi/client' },
      { filename: '/_expo/static/js/web/entry-abc.js' },
    ] } }] },
  }],
  ['ordinary app error', {
    exception: { values: [{ value: 'TypeError: x is not a function', stacktrace: { frames: [
      { filename: '/_expo/static/js/web/entry-abc.js' },
    ] } }] },
  }],
  ['message-only app error', { message: 'search RPC returned 500' }],
  ['no stack, no culprit', { exception: { values: [{ value: 'boom' }] } }],
  ['empty event', {}],
  // A message that merely MENTIONS ResizeObserver is a real report, not the browser's own noise.
  ['app error mentioning ResizeObserver', { message: 'our ResizeObserver loop guard failed to install' }],
];
for (const [name, ev] of keepCases) {
  check(!isThirdPartyNoise(ev), `kept: ${name}`, `WRONGLY DROPPED: ${name} — a real crash is being deleted on the device`);
}
check(
  scrubEvent({ message: 'search RPC returned 500' }) !== null,
  'scrubEvent still returns first-party events',
  'scrubEvent is dropping first-party events — every real crash is being deleted before it is sent',
);

// ── 4. Dropping happens BEFORE scrubbing, and PII redaction still runs on kept events ──────────
const withPii = scrubEvent({ message: 'contact me at a@b.com or 0512345678' });
check(
  !!withPii && !/a@b\.com/.test(withPii.message ?? '') && !/0512345678/.test(withPii.message ?? ''),
  'PII redaction still runs on events that are kept',
  'PII is no longer redacted — the drop rule broke the scrubber it sits in front of',
);

// ── 5. The source and the routing doc still agree that this list exists here ──────────────────
const src = existsSync(join(ROOT, SOURCE)) ? readFileSync(join(ROOT, SOURCE), 'utf8') : '';
check(
  /if \(isThirdPartyNoise\(event\)\) return null;/.test(src),
  'scrubEvent drops third-party noise as its first action',
  'the drop call is gone from scrubEvent — the ignore list is dead code',
);
const doc = existsSync(join(ROOT, ROUTING_DOC)) ? readFileSync(join(ROOT, ROUTING_DOC), 'utf8') : '';
check(
  doc.includes('beforeSend') && doc.includes('ignore list'),
  `${ROUTING_DOC} still assigns the scrubber ignore list to routine #7`,
  `${ROUTING_DOC} no longer describes the ignore list — the owner of this file is unrecorded`,
);

// ── 6. Wiring. Never string-match package.json — ask the registry ─────────────────────────────
check(
  npmTestRuns(ROOT, 'verify-sentry-third-party-noise-dropped'),
  'this barrier runs in `npm test`',
  'this barrier is not discovered by the test registry — it would never run',
);

for (const o of ok) console.log(`  ✓ ${o}`);
if (problems.length) {
  console.error(`\n✗ third-party Sentry noise barrier is not intact:`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}
console.log(`\n✓ third-party Sentry noise barrier intact — ${ok.length} checks passed.`);
