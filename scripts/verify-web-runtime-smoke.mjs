// Permanent guard: the built web bundle must actually RUN. Drives the real primary journey
// (تصفية → «بحث» → results, then hard-refresh → NEW CHAT with zero search requests) in a headless
// browser against a
// locally-served production build.
//
// WHY THIS EXISTS (2026-08-15, Search & Matching QA):
// A one-line change in src/app/agent.tsx called `setQuery(q)` with a plain object. `setQuery` takes
// an UPDATER FUNCTION ((q) => SearchQuery), so internally `updater(q)` tried to call an object:
//     TypeError: e is not a function
// Pressing «بحث» blanked the page — search dead app-wide — and it SHIPPED TO PRODUCTION.
// Everything was green on that commit:
//   • `npm test` (1577 checks) is a source-grep / pure-logic suite. It never renders the app. Two of
//     those checks even asserted the source CONTAINS the offending call — green, and wrong.
//   • The repo has no `tsc`/typecheck script, so TypeScript never saw the signature mismatch.
//   • safe-deploy.sh's post-deploy smoke test calls the search RPC directly over HTTP. The RPC was
//     perfectly healthy (HTTP 200) the whole time the UI was dead, so it stayed green too.
// Every existing gate was blind to "the bundle parses and deploys, but throws the moment a user
// touches the primary control". This one is not: it clicks the button and demands results.
//
// DELIBERATELY NOT WIRED INTO `npm test`. That suite is a REQUIRED status check on every PR and is
// pure/hermetic (no build, no browser, seconds to run). Wiring a ~2-minute web build + headless
// Chromium into it would slow every unrelated PR and make the required check flaky on browser
// download/sandbox issues. Same reasoning, and same precedent, as the live migration-drift check
// (see AGENTS.md "Migration drift guard"): heavy checks get their own workflow.
// This runs from .github/workflows/web-runtime-smoke.yml on any PR touching the app.
//
//   npx expo export --platform web && node scripts/verify-web-runtime-smoke.mjs
//
// Proven three ways before it was trusted (2026-08-15, local production build):
//   • pre-fix main            → crash gate PASS, the 4 §29 refresh checks FAIL (defect reproduced)
//   • the broken setQuery(q)  → 11 FAIL: «body length went 1111 → 0», no navigation,
//                               «TypeError: e is not a function» — the production signature, caught
//   • the fixed setQuery(()=>q) → 12 PASS
//
// Env: PW_CHROMIUM overrides the browser binary; PW_PROXY sets an egress proxy (localhost always
// bypassed). Both optional — CI needs neither.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const DIST = new URL('../dist/', import.meta.url).pathname;
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('FAIL  dist/index.html missing — build first: npx expo export --platform web');
  process.exit(1);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

// Expo Router static export: /agent is emitted as agent.html, / as index.html.
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '');
    let file = join(DIST, rel || 'index.html');
    if (!rel) file = join(DIST, 'index.html');
    else if (existsSync(file) && (await stat(file)).isDirectory()) file = join(file, 'index.html');
    else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(500); res.end('err'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Click a control by its exact visible Arabic text. Scrolls the real (inner, overflow:auto)
// scroll container first — a control below the fold cannot be clicked by coordinates.
const CLICK_LEAF = (txt) => {
  let best = null;
  document.querySelectorAll('div,span,li,button').forEach((e) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  let a = best.parentElement, sc = null;
  while (a) {
    const s = getComputedStyle(a);
    if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight) { sc = a; break; }
    a = a.parentElement;
  }
  if (sc) {
    const er = best.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    sc.scrollTop += (er.top - sr.top) - sc.clientHeight / 2 + er.height / 2;
  } else best.scrollIntoView({ block: 'center' });
  const r = best.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

// React's minified hydration notices fire on this statically-rendered export and predate this
// guard; they do not break the journey. Anything else uncaught is treated as a crash.
const BENIGN = /Minified React error #(418|423|425)/;

const launchOpts = { args: ['--no-sandbox', '--ignore-certificate-errors', '--disable-quic'] };
if (process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
// A TLS-terminating egress proxy can reset Chromium's post-quantum ClientHello; pinning max TLS
// keeps the browser usable behind one. Harmless when no proxy is configured.
if (process.env.PW_PROXY) {
  launchOpts.args.push('--ssl-version-max=tls1.2');
  launchOpts.proxy = { server: process.env.PW_PROXY, bypass: '127.0.0.1,localhost' };
}

const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ar-SA', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const crashes = [];
page.on('pageerror', (e) => { const m = String(e); if (!BENIGN.test(m)) crashes.push(m.slice(0, 200)); });

const tap = async (txt) => {
  const box = await page.evaluate(CLICK_LEAF, txt);
  if (!box) throw new Error(`control not found: ${txt}`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(1200);
};
const pickCity = async (name) => {
  await page.click('input >> nth=0');
  await page.fill('input >> nth=0', '');
  await page.type('input >> nth=0', name, { delay: 60 });
  await page.waitForTimeout(2200);
  await tap(name);
};
const body = () => page.innerText('body');
// Poll instead of sleeping a fixed budget: this journey ends on a TYPEWRITER, whose duration varies
// with machine load, so any single number is either flaky or needlessly slow. (12s was marginal —
// the same build passed and failed on consecutive runs.)
const waitForBody = async (re, timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (re.test(await body())) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
const RESULT_COUNT = /لقينا|ما لقينا/;
const inputs = () => page.evaluate(() => Array.from(document.querySelectorAll('input')).map((e) => e.value));

try {
  // ---- Journey A: the primary CTA must produce results, not a blank page. ----
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  check('home renders', (await body()).includes('تصفية'));

  await tap('إيجار');
  await tap('سنوي');
  await pickCity('الرياض');
  await tap('الشقق والسكن المشترك');
  await tap('شقة');
  await page.fill('input >> nth=4', '30000');
  await page.fill('input >> nth=5', '60000');
  const beforeLen = (await body()).length;

  await tap('بحث');
  const gotResults = await waitForBody(RESULT_COUNT, 40000);
  const afterLen = (await body()).length;
  const afterText = await body();

  // THE assertion that would have caught the outage: the page must not go blank, must navigate,
  // and must render a result count.
  check('«بحث» does not blank the page', afterLen > 0, `body length went ${beforeLen} → ${afterLen}`);
  check('«بحث» navigates to the results screen', page.url().includes('/agent'), `url stayed ${page.url()}`);
  check('results render a count', gotResults);
  check('no uncaught runtime error during the search journey', crashes.length === 0, crashes.join(' | '));

  // ---- Journey B: A REFRESH MUST START A NEW CHAT AND EXECUTE NOTHING (owner 2026-08-16). ----
  // Reversal of the previous QA §29 contract (refresh used to re-run and restore the search); see
  // the header of scripts/verify-refresh-restores-filter-search.ts for the owner's wording.
  // This is the leg that measures the requirement at the NETWORK level, which is the only place
  // "zero duplicate search" can actually be proven.
  const resultsUrl = page.url();

  // Count real search traffic, not renders: the property-search RPC and the agent function.
  let searchCalls = 0;
  const countSearch = (u) => /\/rest\/v1\/rpc\/(location_search_candidates_ar|search_listings)/.test(u)
    || /\/functions\/v1\/agent/.test(u);
  page.on('request', (r) => { if (countSearch(r.url())) searchCalls++; });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  const afterRefresh = await body();

  check('a refresh issues ZERO search/AI requests', searchCalls === 0,
    `${searchCalls} search/AI request(s) fired on reload — a refresh must never count as a user search`);
  check('a refresh does not re-render the previous results', !/لقينا|ما لقينا/.test(afterRefresh));
  check('a refresh lands on the AI new-chat screen (empty composer present)',
    (await page.locator('textarea').count()) > 0);
  check('a refresh stays on the AI surface (not bounced to the filter home)',
    page.url().includes('/agent'), `url = ${page.url()}`);
  check('the consumed URL no longer carries an executable search param',
    !/[?&](filter|seed)=/.test(page.url()), `url = ${page.url().slice(0, 140)}`);
  check('the pre-refresh URL did carry the one-shot intent (so the clear is what emptied it)',
    resultsUrl.includes('filter=') || resultsUrl.endsWith('/agent'));

  // ---- Journey C: intentional behaviour still works — the fix must not mean "searches stop". ----
  await tap('تصفية');
  await page.waitForTimeout(2500);
  await pickCity('الرياض');
  await tap('بحث');
  const reSearched = await waitForBody(RESULT_COUNT, 40000);
  const t3 = await body();
  check('after a refresh, a NEW search still runs normally',
    reSearched && !t3.includes('الرجاء اختيار مدينة من القائمة.'));
  check('that new search did issue its request (the gate blocks reloads, not users)', searchCalls > 0,
    'no search request fired for a real user search — the gate is over-blocking');
  const summaries = (t3.match(/ملخص البحث/g) ?? []).length;
  check('the new search ran exactly once (no duplicate turn)', summaries <= 2,
    `«ملخص البحث» rendered ${summaries}×`);

  // ---- Journey D: the same refresh contract on MOBILE (owner asked for both viewports). ----
  // The agent screen is a different layout here (drawer sidebar, no docked column), so the refresh
  // path is re-driven rather than assumed to follow from desktop.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  check('[mobile] home renders', (await body()).includes('تصفية'));
  await pickCity('الرياض');
  await tap('بحث');
  const mobResults = await waitForBody(RESULT_COUNT, 40000);
  check('[mobile] a search produces results', mobResults);

  searchCalls = 0;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  check('[mobile] a refresh issues ZERO search/AI requests', searchCalls === 0, `${searchCalls} fired`);
  check('[mobile] a refresh does not re-render the previous results', !RESULT_COUNT.test(await body()));
  check('[mobile] a refresh lands on the AI new-chat screen', (await page.locator('textarea').count()) > 0);
  check('[mobile] the consumed URL carries no executable search param', !/[?&](filter|seed)=/.test(page.url()),
    `url = ${page.url().slice(0, 140)}`);

  check('no uncaught runtime error across the whole run', crashes.length === 0, crashes.join(' | '));
} catch (e) {
  failed++;
  console.log(`FAIL  journey threw: ${String(e).split('\n')[0].slice(0, 180)}`);
  if (crashes.length) console.log(`        uncaught: ${crashes.join(' | ')}`);
} finally {
  await browser.close();
  server.close();
}

console.log(failed ? `\n${failed} FAILED — the built app does not run correctly` : '\nweb runtime smoke passed — the built app runs and survives a refresh');
process.exit(failed ? 1 : 0);
