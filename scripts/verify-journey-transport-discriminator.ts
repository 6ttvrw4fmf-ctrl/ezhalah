// A TRANSPORT FAILURE IS NOT A PRODUCT DEFECT — AND A REAL OUTAGE MUST STILL BE ONE.
//
// `e2e/journeys/run.mjs` wraps every journey in `catch (e) { defect(key, 'journey threw', …) }`. That
// is correct for anything the app does, and wrong for the one failure that happens BEFORE the app
// exists: an opening `page.goto` that never completed at the transport layer. No app code ran, no
// assertion could have failed, and yet the sweep filed it as an Ezhalah bug — the first of the two
// opposite errors `docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md` PART 9 opens by naming, and the one
// that lands a permanent barrier pinning a harness quirk as product behaviour.
//
// MEASURED (2026-09-02, routine #6): a 72-journey production sweep reported exactly 2 defects, both
// `net::ERR_TIMED_OUT` on the opening navigation, in two unrelated journeys (`search-readonly`,
// `double-click-search`), each 1/2 — while the other 70 runs loaded the identical URL and served
// bundle in the same window. PART 9.1 condition 3: the same bundle behaving correctly elsewhere
// indicts the harness, not the code.
//
// WHAT THIS BARRIER PROTECTS IS THE DISCRIMINATOR, IN BOTH DIRECTIONS. The dangerous "fix" for the
// above is a swallow or a blanket retry, which would hide a genuine outage — PART 9's second and
// worse error. So this proves, executably, that:
//   · a transport-class error is retried exactly ONCE and, on success, is neither pass nor defect;
//   · a SECOND transport failure RETHROWS, so a real outage stays exactly as loud as before;
//   · a NON-transport error is never retried and never reclassified;
//   · `withPage` — the only place journeys navigate from — actually routes through it.
//
// Run: node --experimental-strip-types scripts/verify-journey-transport-discriminator.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isTransportError, gotoOrRetryTransport } from '../e2e/journeys/harness.mjs';

const root = join(import.meta.dirname, '..');
let failed = 0;
const ok = (m: string) => console.log(`  ok  ${m}`);
const check = (m: string, cond: boolean) => { if (cond) ok(m); else { console.error(`  FAIL  ${m}`); failed++; } };

// ── 1. classification, both directions ──────────────────────────────────────────────────────────
// The exact string Playwright produced in the measured run, not a paraphrase of it.
const REAL = 'page.goto: net::ERR_TIMED_OUT at https://ezhalah-app.vercel.app/\nCall log:\n  - navigating to "https://ezhalah-app.vercel.app/", waiting until "load"';
check('the exact ERR_TIMED_OUT text measured on 2026-09-02 classifies as transport', isTransportError(new Error(REAL)));
for (const code of ['ERR_CONNECTION_RESET', 'ERR_CONNECTION_REFUSED', 'ERR_NAME_NOT_RESOLVED', 'ERR_PROXY_CONNECTION_FAILED', 'ERR_EMPTY_RESPONSE', 'ERR_SSL_PROTOCOL_ERROR', 'ERR_INTERNET_DISCONNECTED']) {
  check(`${code} classifies as transport`, isTransportError(new Error(`page.goto: net::${code} at https://x/`)));
}
// ONE CONDITION, TWO MESSAGES. A network-layer failure does not always carry a net:: code: Chromium
// may navigate to its own error page instead, and Playwright reports that with no ERR_* in the
// string at all. Measured on the verification sweep for this very fix (2026-09-02) — the first sweep
// produced ERR_TIMED_OUT, the re-run produced this, in the SAME journey. Classifying only the first
// left the discriminator half-built and still filing network blips as Ezhalah defects.
const CHROME_ERROR_PAGE = 'page.goto: Navigation to "https://ezhalah-app.vercel.app/" is interrupted by another navigation to "chrome-error://chromewebdata/"';
check('the exact chrome-error://chromewebdata text measured on 2026-09-02 classifies as transport',
  isTransportError(new Error(CHROME_ERROR_PAGE)));
// The inverse has equal force: these are the app failing, and must never be retried away.
for (const notTransport of [
  'expect(received).toBe(expected)',
  'locator.click: Timeout 15000ms exceeded.',
  'page.goto: net::ERR_ABORTED at https://ezhalah-app.vercel.app/',   // a navigation the PAGE cancelled
  'Target page, context or browser has been closed',
]) {
  check(`«${notTransport.slice(0, 44)}…» is NOT treated as transport`, !isTransportError(new Error(notTransport)));
}

// ── 2. the retry is exactly one, and only for transport ─────────────────────────────────────────
const fakePage = (outcomes: (string | null)[]) => {
  const calls: string[] = [];
  return {
    calls,
    goto: async (url: string) => {
      const o = outcomes[calls.length];
      calls.push(url);
      if (o) throw new Error(o);
      return { status: () => 200 };
    },
  };
};

const blip = fakePage([`page.goto: net::ERR_TIMED_OUT at https://x/`, null]);
let threw: unknown = null;
try { await gotoOrRetryTransport(blip as never, 'https://x/'); } catch (e) { threw = e; }
check('a transport blip that recovers does NOT throw (so it is never filed as a defect)', threw === null);
check('a transport blip is retried exactly once — two navigations, not more', blip.calls.length === 2);

// FAIL CLOSED. This is the assertion that stops the fix from becoming the worse bug: if the retry
// also fails, the error must propagate so run.mjs files it, so a genuine outage still reads as one.
const outage = fakePage([`page.goto: net::ERR_TIMED_OUT at https://x/`, `page.goto: net::ERR_TIMED_OUT at https://x/`]);
threw = null;
try { await gotoOrRetryTransport(outage as never, 'https://x/'); } catch (e) { threw = e; }
check('a SECOND transport failure rethrows — a real outage is still a loud defect', threw !== null);
check('a real outage is not retried more than once either', outage.calls.length === 2);

const appBug = fakePage(['expect(received).toBe(expected)', null]);
threw = null;
try { await gotoOrRetryTransport(appBug as never, 'https://x/'); } catch (e) { threw = e; }
check('a non-transport error throws immediately', threw !== null);
check('a non-transport error is NOT retried — one navigation only', appBug.calls.length === 1);

const healthy = fakePage([null]);
await gotoOrRetryTransport(healthy as never, 'https://x/');
check('a healthy navigation costs exactly one goto (no speculative second hit on production)', healthy.calls.length === 1);

// ── 3. the sweep actually routes through it ─────────────────────────────────────────────────────
// A discriminator nothing calls is decoration (AGENTS.md: "a detector outside the roster"). withPage
// is the single place every journey navigates from, so that is the call site that must be wired.
const harness = readFileSync(join(root, 'e2e/journeys/harness.mjs'), 'utf8');
const withPageBody = harness.slice(harness.indexOf('export async function withPage'));
check('withPage navigates via gotoOrRetryTransport', /gotoOrRetryTransport\(page,/.test(withPageBody));
check('withPage no longer calls page.goto directly for its opening navigation',
  !/await page\.goto\(BASE \+ path/.test(withPageBody));

// The in-journey reload must stay un-retried: it is an assertion about the app, and the sidebar
// journeys' post-reload re-checks are only meaningful if a failed reload actually fails.
const runner = readFileSync(join(root, 'e2e/journeys/run.mjs'), 'utf8');
check('in-journey page.reload() is deliberately NOT routed through the transport retry',
  runner.includes('page.reload(') && !/gotoOrRetryTransport\([^)]*reload/.test(runner));

console.log(failed
  ? `\nFAIL: ${failed} check(s) failed — the transport/product discriminator is not holding.`
  : '\nPASS: transport blips are reclassified, real outages still fail loudly, app errors are untouched.');
process.exit(failed ? 1 : 0);
