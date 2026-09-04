// A LIVE CHECK MUST ANSWER "IS THE DEPLOYED APP CORRECT?", NOT "DID ONE TCP CONNECTION COMPLETE?"
// Auto-discovered barrier (scripts/verify-*.ts), offline, executes the real helper against a fake page.
//
// WHY (2026-09-02). The post-deploy run of verify-af-live-truth.ts went red twice in a row, on a
// DIFFERENT journey each time, both before a single assertion had run:
//
//     Error: page.goto: net::ERR_TIMED_OUT at https://ezhalah-app.vercel.app/
//
// The app was fine — 20 of 20 sequential curl loads returned 200 from the same container in the same
// minute, and the other four live browser checks were green against the same bundle. The difference
// is volume: that check navigates NINE times per run where the others navigate once, so it draws nine
// chances at a transport hiccup, and the container's egress proxy is simultaneously refusing every
// listing-photo CDN the page requests.
//
// A barrier that cries wolf gets ignored, and this one is homed in af-live-truth-check.yml where it
// runs after every production deploy. But the fix must not become "retry until green" — that would
// turn the one check that proves production correct into a check that cannot fail. So the contract
// pinned here is narrow and two-sided:
//
//   RETRY the transport   — only the initial navigation, never anything that has observed behaviour.
//   STILL FAIL when the page genuinely never loads, with a message that says so, so an unreachable
//                           site is never mistaken for a wrong one.
//
// This file proves BOTH directions by executing scripts/lib/liveNav.ts against a fake page, and pins
// that every live browser check actually routes through it — otherwise the next one added
// reintroduces the bare single-attempt goto.
//
//   node --experimental-strip-types scripts/verify-live-nav-retries-transport-only.ts

import { readFileSync, readdirSync } from 'node:fs';
import { gotoLive, type Navigable } from './lib/liveNav.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

/** A page whose goto fails `failFirst` times and then succeeds; records every call. */
const fakePage = (failFirst: number) => {
  const calls: Array<{ url: string; timeout: number }> = [];
  const page: Navigable = {
    goto: async (url, opts) => {
      calls.push({ url, timeout: opts.timeout });
      if (calls.length <= failFirst) throw new Error('page.goto: net::ERR_TIMED_OUT at ' + url);
      return null;
    },
  };
  return { page, calls };
};
const QUIET = { backoffMs: 0, sleep: async () => {}, log: () => {} };

// ── 1. THE TRANSPORT IS RETRIED ───────────────────────────────────────────────────────────────────
console.log('── a transport failure is retried, not fatal ──');
{
  const { page, calls } = fakePage(0);
  const n = await gotoLive(page, 'https://x/', QUIET);
  check('a first-try success navigates exactly once', n === 1 && calls.length === 1, `attempts=${n} calls=${calls.length}`);
}
{
  const { page, calls } = fakePage(2);
  const n = await gotoLive(page, 'https://x/', QUIET);
  check('two timeouts then success: reports attempt 3, having navigated 3 times',
    n === 3 && calls.length === 3, `attempts=${n} calls=${calls.length}`);
}
{
  // The retry must be VISIBLE. A silent one hides a degrading network until it becomes a hard failure.
  const lines: string[] = [];
  const { page } = fakePage(1);
  await gotoLive(page, 'https://x/', { ...QUIET, log: (m) => lines.push(m) });
  check('a retry that succeeds is announced', lines.length === 1 && /attempt 2\/3/.test(lines[0]),
    JSON.stringify(lines));
}

// ── 2. IT IS STILL FAIL-CLOSED — the half that makes the retry legitimate ─────────────────────────
console.log('\n── exhausting the attempts still FAILS, and says why ──');
{
  const { page, calls } = fakePage(99);
  let err: unknown = null;
  try { await gotoLive(page, 'https://x/', QUIET); } catch (e) { err = e; }
  check('every attempt failing THROWS — a real outage is still a red barrier', err !== null);
  check('...after exactly the configured number of attempts (no unbounded looping)', calls.length === 3,
    `navigated ${calls.length} times`);
  const msg = String(err);
  check('...and the message distinguishes "never loaded" from "loaded but wrong"',
    /PAGE NEVER LOADED/.test(msg) && /nothing after this\s+was tested/.test(msg),
    `got: ${msg.split('\n')[0]}`);
  check('...and it carries every underlying error, not just the last',
    (msg.match(/attempt \d+:/g) ?? []).length === 3, `got: ${msg}`);
}
{
  // attempts:1 must behave exactly like the old bare goto — the helper cannot silently add tries.
  const { page, calls } = fakePage(99);
  let threw = false;
  try { await gotoLive(page, 'https://x/', { ...QUIET, attempts: 1 }); } catch { threw = true; }
  check('attempts:1 navigates once and throws (no hidden retry floor)', threw && calls.length === 1,
    `calls=${calls.length}`);
}
{
  // The per-attempt timeout must reach playwright unchanged — a helper that quietly shortened it
  // would make journeys fail for a new reason.
  const { page, calls } = fakePage(1);
  await gotoLive(page, 'https://x/', { ...QUIET, timeout: 90_000 });
  check('the caller\'s timeout is passed through on every attempt',
    calls.length === 2 && calls.every((c) => c.timeout === 90_000), JSON.stringify(calls));
}

// ── 3. ONLY THE NAVIGATION IS RETRIED ─────────────────────────────────────────────────────────────
// The helper is handed a page and a url and nothing else — it cannot re-run an assertion even in
// principle, because it never sees one. Pinned structurally rather than by reading the call sites:
// its whole surface is `goto`.
console.log('\n── the helper can only ever retry a navigation ──');
const lib = readFileSync(new URL('./lib/liveNav.ts', import.meta.url), 'utf8');
check('the helper calls nothing on the page but goto()',
  (lib.match(/page\.\w+\(/g) ?? []).every((m) => m === 'page.goto('),
  `found: ${JSON.stringify([...new Set(lib.match(/page\.\w+\(/g) ?? [])])}`);
check('the Navigable contract exposes only goto', /export type Navigable = \{\s*\n\s*goto:/.test(lib));

// ── 4. EVERY LIVE BROWSER CHECK ROUTES THROUGH IT ─────────────────────────────────────────────────
// Otherwise the next live check added reintroduces the single-attempt goto and the class comes back.
//
// WHO IS POLICED is derived from the source, not a hand-kept list: a check qualifies if it drives
// playwright AND names the production host. One that serves its own build on 127.0.0.1
// (verify-web-runtime-smoke.mjs, verify-chat-persistence-live.mjs) has no egress hop to lose, and
// exempting it by that fact means a future local-server check is exempt automatically while a future
// PRODUCTION one is policed automatically. Neither can be got wrong by editing a list.
console.log('\n── no production browser check keeps a bare, single-attempt goto ──');
const dir = new URL('./', import.meta.url);
const PROD_HOST = 'ezhalah-app.vercel.app';
const browserChecks = readdirSync(dir)
  .filter((f) => /^verify-.*\.(ts|mjs)$/.test(f))
  .map((f) => ({ f, src: readFileSync(new URL(f, dir), 'utf8') }))
  .filter(({ src }) => /from ['"]playwright['"]/.test(src));
const local = browserChecks.filter(({ src }) => !src.includes(PROD_HOST));
const prod = browserChecks.filter(({ src }) => src.includes(PROD_HOST));
check(`found the browser checks (${browserChecks.length}: ${prod.length} production, ${local.length} local-server)`,
  prod.length >= 5 && local.length >= 1, browserChecks.map((b) => b.f).join(', '));
check('the local-server checks really do serve themselves (that is WHY they are exempt)',
  local.every(({ src }) => /127\.0\.0\.1|localhost/.test(src)),
  `not self-served: ${local.filter(({ src }) => !/127\.0\.0\.1|localhost/.test(src)).map((b) => b.f).join(', ')}`);

// The ONE production check that cannot import the helper: verify-live-hydration.mjs is .mjs, and
// deploy-frontend.yml invokes it as a bare `node scripts/verify-live-hydration.mjs` — no
// --experimental-strip-types, so a .ts import fails to resolve (verified on node v22.22.2). Adding
// that flag means editing the sanctioned deploy entrypoint's command, which is not a change to make
// inside a test-hygiene fix. It also navigates with waitUntil:'networkidle', a different contract
// from the one this helper hardcodes. Exempt by NAME here, and the exemption is self-limiting: the
// count is pinned, so a second file cannot quietly join it.
const CANNOT_IMPORT_TS = ['verify-live-hydration.mjs'];
const bare = prod.filter(({ f, src }) => !CANNOT_IMPORT_TS.includes(f) && /\bpage\.goto\(/.test(src));
check('every production browser check that CAN use gotoLive() does, with no bare page.goto() left',
  bare.length === 0,
  `still bare: ${bare.map((b) => b.f).join(', ')} — import gotoLive from './lib/liveNav.ts' and use it`);
const exempt = prod.filter(({ f }) => CANNOT_IMPORT_TS.includes(f));
check('the exemption list names exactly one file, and that file exists',
  exempt.length === CANNOT_IMPORT_TS.length && CANNOT_IMPORT_TS.length === 1,
  `expected the 1 named file to be present among the production checks; found ${exempt.length}`);
check('...and it is exempt for the stated reason — still a .mjs invoked without --experimental-strip-types',
  /node scripts\/verify-live-hydration\.mjs/.test(
    readFileSync(new URL('../.github/workflows/deploy-frontend.yml', import.meta.url), 'utf8')),
  'deploy-frontend.yml no longer invokes it that way — the reason has expired, so route it through '
  + 'gotoLive() and delete it from CANNOT_IMPORT_TS');
const routed = prod.filter(({ src }) => /gotoLive\(page,/.test(src));
check('...and the rest are actually calling it (not merely importing it)', routed.length >= 5,
  `${routed.length} of ${prod.length} production checks call gotoLive`);

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — live navigation is not retry-transport-only/fail-closed`);
  process.exit(1);
}
console.log('\nOK — the transport is retried, an unreachable page still fails loudly, and every live check routes through it');
