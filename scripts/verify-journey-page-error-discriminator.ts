// A NETWORK FAILURE IS NOT AN APPLICATION EXCEPTION — AND AN APPLICATION EXCEPTION MUST NEVER BE
// FILED AS ONE.
//
// Eighteen journeys end with "any uncaught page error is a product defect". That premise is right
// on Chromium and wrong on WebKit, where a dead cross-origin fetch surfaces as a PAGE error rather
// than a console message — so a runner network blip reads as an Ezhalah bug (PART 9's first and
// costliest error, arriving from inside the harness).
//
// HOW IT WAS ADJUDICATED, 2026-09-03 (not assumed — PART 9.1's inverse rule requires positive proof
// before a reproducible failure may be called environment):
//   · `appearance-guest-light` failed 4/10 desktop and 2/10 mobile on WebKit with
//     «Fetch API cannot load …/rpc/top_cities_by_deal_ar due to access control checks», while EVERY
//     product assertion in the same journey passed, on every run.
//   · Chromium (42 cells) and Firefox (full sweep) were clean on the identical bundle.
//   · The deciding experiment forced that exact request to fail on CHROMIUM
//     (`route.abort('failed')`, 2/2 fresh contexts against production): the app produced
//     **0 page errors** — three `requestfailed` entries and nothing else — because
//     `src/data/locations.ts` catches it and returns `[]`.
// So the app's handling is correct and engine-independent; only WebKit's REPORTING differs.
//
// THE RISK THIS BARRIER GUARDS is the opposite one: a classifier that quietly swallows a real
// crash. Every check below is therefore paired — a network shape must be excused, and a genuine
// exception with similar-looking words must NOT be. `TypeError: Failed to fetch` is transport;
// `TypeError: undefined is not an object (evaluating 'x.y')` is a defect and stays one.
//
// Run: node --experimental-strip-types scripts/verify-journey-page-error-discriminator.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appPageErrors, isTransportPageError } from '../e2e/journeys/harness.mjs';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, cond: boolean) => {
  if (cond) console.log(`  ok  ${m}`);
  else { console.error(`  FAIL  ${m}`); failed++; }
};

// ── 1. Network shapes each engine actually emits ⇒ TRANSPORT ────────────────────────────────────
const TRANSPORT = [
  // The exact WebKit string measured on production, including its odd `https: /` spacing.
  'Fetch API cannot load https: /aannarbkwcymrotzwdbo.supabase.co/rest/v1/rpc/top_cities_by_deal_ar due to access control checks.',
  'Fetch API cannot load https://example.com/x due to access control checks.',
  'Load failed',
  'TypeError: Load failed',
  'The network connection was lost.',
  'TypeError: Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'net::ERR_TIMED_OUT',
  'Error: net::ERR_CONNECTION_RESET at https://ezhalah-app.vercel.app/',
];
for (const e of TRANSPORT) {
  check(`TRANSPORT: «${e.slice(0, 62)}${e.length > 62 ? '…' : ''}»`, isTransportPageError(e) === true);
}

// ── 2. Real application exceptions ⇒ NEVER excused ──────────────────────────────────────────────
// Several are deliberately worded to look adjacent to the transport set: they mention fetch, load,
// or network without BEING a network failure. Each one must still file as a defect.
const APP = [
  "TypeError: undefined is not an object (evaluating 'x.y')",
  'TypeError: null is not an object (evaluating \'listing.price.amount\')',
  'ReferenceError: Can\'t find variable: filterToChat',
  'TypeError: chat.query.match is not a function',
  'RangeError: Maximum call stack size exceeded',
  'Error: Rendered more hooks than during the previous render.',
  // Adjacent wording, genuinely the app's fault:
  'TypeError: fetchListings is not a function',
  'ReferenceError: Can\'t find variable: loadFailedBanner',
  'Error: Minified React error #310',
  'SecurityError: The operation is insecure.', // storage/DOM, not a dead request
];
for (const e of APP) {
  check(`APP DEFECT (never excused): «${e.slice(0, 62)}${e.length > 62 ? '…' : ''}»`, isTransportPageError(e) === false);
}

// ── 3. The partition itself, executed ───────────────────────────────────────────────────────────
const bagOf = (pageErrors: string[]) => ({ pageErrors });
check('a bag of only transport errors yields NO product defects',
  appPageErrors(bagOf(['Load failed', 'net::ERR_TIMED_OUT']), 'unit').length === 0);
check('a bag of only app errors yields all of them',
  appPageErrors(bagOf(["TypeError: undefined is not an object (evaluating 'x.y')"]), 'unit').length === 1);
check('a MIXED bag keeps the app error and drops only the transport one — a real crash is not masked by a blip alongside it',
  (() => {
    const out = appPageErrors(bagOf(['Load failed', "TypeError: undefined is not an object (evaluating 'x.y')"]), 'unit');
    return out.length === 1 && out[0].startsWith('TypeError');
  })());
check('an empty bag is empty', appPageErrors(bagOf([]), 'unit').length === 0);

// ── 4. Nothing is SILENT: a transport error is still announced ──────────────────────────────────
// The whole defence against this becoming a blindfold is that the run still says it happened, so a
// genuine outage reads as one (every journey noting the same failure) rather than as silence.
{
  const seen: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => { seen.push(a.join(' ')); };
  appPageErrors(bagOf(['Load failed']), 'some-journey:mobile375');
  console.log = origLog;
  check('a dropped transport page error is REPORTED as a note carrying its text, never swallowed',
    seen.some((l) => /TRANSPORT-class page error/.test(l) && /Load failed/.test(l) && /some-journey/.test(l)));
}

// ── 5. Every journey routes through it — a discriminator nothing calls is decoration ────────────
const run = readFileSync(join(ROOT, 'e2e/journeys/run.mjs'), 'utf8');
const rawReads = run.match(/if \(bag\.pageErrors\.length\)/g) || [];
check('no journey still treats bag.pageErrors directly as a defect list',
  rawReads.length === 0);
check('every page-error check goes through appPageErrors()',
  (run.match(/appPageErrors\(bag, name\)/g) || []).length >= 18);

if (failed) { console.error(`\nverify-journey-page-error-discriminator: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-journey-page-error-discriminator: dead requests excused, real crashes never.');
