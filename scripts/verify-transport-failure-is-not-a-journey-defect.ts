// A NETWORK FAILURE IS NOT A PRODUCT DEFECT — executed, not read.
//
// THE DEFECT (measured, 2026-09-15 chromium sweep, 108 runs against production). The journey
// runner's catch-all recorded EVERY escaped throw as «journey threw», a finding. So when
// `auth-overlay-clears-controls` failed to reach the site at all —
//
//   journey threw: Error: page.goto: Navigation to "https://ezhalah-app.vercel.app/" is
//   interrupted by another navigation to "chrome-error://chromewebdata/"
//
// — it landed in the DEFECTS list beside six real consent-card findings, as if production had
// misbehaved. It had not; the browser never got there. That is PART 9's first and most expensive
// error (filing a harness artifact as an Ezhalah bug), arriving through the one code path that
// cannot tell the two apart.
//
// `gotoOrRetryTransport` already knew the signature — `chrome-error://chromewebdata` is in
// TRANSPORT_ERRORS and the FIRST attempt was correctly retried. The hole was that the retry itself
// was an unguarded `page.goto`, so a second blip escaped untyped. It now makes three bounded
// attempts and, if all three are transport failures, throws an error carrying `isTransport` so the
// runner can record a SKIP — a measurement that did not happen (§9.5) — instead of a defect.
//
// WHY THE FLAG AND NOT A MESSAGE MATCH. A skip is a weaker claim than a pass but it is still an
// escape hatch, and the one thing that must never happen is a PRODUCT bug talking its way into one
// by mentioning a network string in its message. So `classifyJourneyThrow` keys ONLY on the flag
// that gotoOrRetryTransport sets after it has already proven transport three times over. Both
// directions are asserted below.
//
//   node --experimental-strip-types scripts/verify-transport-failure-is-not-a-journey-defect.ts
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyJourneyThrow, isTransportError } from '../e2e/journeys/harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
// An EXECUTABLE mutation proof: apply this barrier's own predicate to a deliberately broken input
// and assert the predicate rejects it. `caught` is always a computed expression, never a literal.
// (Recognised by scripts/verify-new-barriers-are-mutation-proven.ts.)
const mutation = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) ${label}`); return; }
  failures++;
  console.error(`FAIL  (mutation) ${label} — the barrier did NOT reject the broken input`);
};

const transport = (msg: string) => Object.assign(new Error(msg), { isTransport: true });

// ── 1. THE TRUTH TABLE, executed ─────────────────────────────────────────────────────────────────
{
  check('a flagged transport failure is a SKIP, not a defect',
    classifyJourneyThrow(transport('TRANSPORT: unreachable after 3 attempts')) === 'skip');

  // THE LOAD-BEARING NEGATIVES. Everything else must stay a defect — the safe direction.
  check('an ordinary journey throw is still a DEFECT',
    classifyJourneyThrow(new Error('expected 3 rows, got 0')) === 'defect');
  check('a PRODUCT error that merely MENTIONS a transport string is still a DEFECT',
    classifyJourneyThrow(new Error('render failed after ERR_CONNECTION_RESET was displayed to the user')) === 'defect',
    'message-matching here would let any product bug name a network code and be skipped');
  check('…even the exact chrome-error string, unflagged, is still a DEFECT',
    classifyJourneyThrow(new Error('chrome-error://chromewebdata')) === 'defect');
  check('isTransport must be exactly true — a truthy value does not qualify',
    classifyJourneyThrow(Object.assign(new Error('x'), { isTransport: 'yes' })) === 'defect');
  check('null/undefined throws are DEFECTS, never skips',
    classifyJourneyThrow(null) === 'defect' && classifyJourneyThrow(undefined) === 'defect');
  check('a plain string throw is a DEFECT', classifyJourneyThrow('boom' as unknown as Error) === 'defect');
}

// ── 2. THE SIGNATURE THAT STARTED IT ─────────────────────────────────────────────────────────────
{
  const real = 'page.goto: Navigation to "https://ezhalah-app.vercel.app/" is interrupted by '
    + 'another navigation to "chrome-error://chromewebdata/"';
  check('the sweep\'s real failure IS recognised as transport by isTransportError',
    isTransportError(new Error(real)),
    'if this is false the retry never engages and the throw reaches the runner as a defect');
  check('a genuine product failure is NOT recognised as transport',
    !isTransportError(new Error('expected the composer to be enabled, it was not')));
}

// ── 3. WIRING — the runner must actually consult the predicate ───────────────────────────────────
// Narrow and secondary: the loop lives inside the runner's own scope and cannot be lifted, but the
// predicate it calls is executed in full above.
{
  const run = readFileSync(join(ROOT, 'e2e/journeys/run.mjs'), 'utf8');
  check('WIRING the runner routes an escaped throw through classifyJourneyThrow',
    /classifyJourneyThrow\(e\) === 'skip'\) skip\(/.test(run),
    'a re-inlined `e.isTransport` check would drift from the predicate this file proves');
  check('WIRING …and every other throw is still recorded as a defect',
    /else defect\(key, 'journey threw'/.test(run));

  const harness = readFileSync(join(ROOT, 'e2e/journeys/harness.mjs'), 'utf8');
  check('WIRING the retry is itself guarded (the hole that let attempt 2 escape untyped)',
    /catch \(again\)/.test(harness) && /isTransportError\(again\)/.test(harness),
    'an unguarded second page.goto is exactly how the 2026-09-15 throw reached the DEFECTS list');
  check('WIRING …and a surviving transport failure is flagged for the runner',
    /err\.isTransport = true/.test(harness));
}

// ── 4. MUTATION PROOFS ───────────────────────────────────────────────────────────────────────────
{
  // MUT-1: the pre-fix runner — every throw is a defect, so a transport failure is misfiled.
  const oldClassify = () => 'defect';
  mutation('the pre-fix catch-all (everything is a defect) misfiles a transport failure → assertion 1 rejects it',
    oldClassify() === 'defect' && classifyJourneyThrow(transport('x')) === 'skip');

  // MUT-2: the tempting-but-wrong widening — match the MESSAGE instead of the flag.
  const badClassify = (e: unknown) => (isTransportError(e) ? 'skip' : 'defect');
  const productBugMentioningNetwork = new Error('the UI printed ERR_CONNECTION_RESET to the user');
  mutation('a message-matching classifier would skip a PRODUCT bug that names a network code → the negative assertions reject it',
    badClassify(productBugMentioningNetwork) === 'skip'
    && classifyJourneyThrow(productBugMentioningNetwork) === 'defect');

  // MUT-3: loosening the flag test to truthiness.
  const loose = (e: any) => (e && e.isTransport ? 'skip' : 'defect');
  const truthy = Object.assign(new Error('x'), { isTransport: 'yes' });
  mutation('a truthiness check accepts a non-boolean flag → the strict-equality assertion rejects it',
    loose(truthy) === 'skip' && classifyJourneyThrow(truthy) === 'defect');
}

console.log(failures === 0
  ? '\nA journey that could not reach production is a skip, and nothing else is'
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
