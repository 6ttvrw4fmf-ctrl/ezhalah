// THE TAB ROBOT — drives the BUILT app like a phone user and fails the change if moving between the three tabs gets slow.
//
// Owner 2026-11-04: «changing between filter, smart broker and map … can we create something that always fixes it».
// The live speed watch (e2e/speed/site-speed-live.mjs, every 30 min) catches a slowdown AFTER it ships; this robot runs
// on every PR (.github/workflows/web-runtime-smoke.yml) and stops it from shipping at all. It builds nothing itself: it
// serves the `dist/` the workflow just exported, opens it as a mid-range phone (iPhone 13 screen, 4× slower CPU), and
// times each switch from the tap until the new tab can be used:
//   «الوسيط الذكي» → its message box is on screen
//   «تصفية»        → the «بحث» button is on screen
//   «خريطة»        → the map screen's search field is on screen (Apple's map itself needs ezhalah.com's key, so the
//                    live watch times the city names; this robot times the screen)
// Three rounds; a step fails when its MEDIAN is over budget. Measured on the build of 2026-11-04 (4× CPU, local server):
// Smart Broker 177 ms, Filter 276 ms, Map 194 ms. Budgets leave ~4-5× headroom for a slower CI runner; a regression that
// rebuilds a tab from scratch or adds a blocking wait shows up as seconds. Raise a budget only with a measured reason.
//
// Run:  node scripts/verify-web-tab-switch-speed.mjs        (after `npx expo export --platform web`)
//       TAB_ROBOT_DIST=/path/to/dist node scripts/verify-web-tab-switch-speed.mjs
// Kept out of `npm test` (a real browser): it runs in .github/workflows/web-runtime-smoke.yml on every PR.
import './lib/robotPass.mjs'; // robot pass for our own browser robots (docs/ops/SCRAPE_GUARD.md)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const DIST = process.env.TAB_ROBOT_DIST || new URL('../dist/', import.meta.url).pathname;
export const BUDGET_MS = { broker: 1200, filter: 1000, map: 1000 };
const ROUNDS = 3;

let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`); };

// ── the verdict, pure — so the robot proves it would fail before it opens a browser ──────────────────────────────────
const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : Infinity; };
const stepOk = (step, samples) => median(samples) <= BUDGET_MS[step] && samples.filter((x) => !Number.isFinite(x)).length < Math.ceil(ROUNDS / 2);
const mustCatch = (label, caught) => check(`MUTATION — ${label}`, caught);
mustCatch('a Smart Broker switch of 1.5-1.8 s on a phone with its 500 KB chunk fetched on the tap is not «fast enough» at 3 s', !stepOk('broker', [3100, 3300, 3000]));
mustCatch('a tab that never appears (a timeout) is a failure, never skipped', !stepOk('filter', [Infinity, Infinity, 400]));
mustCatch('a switch that rebuilds the map screen with a 4 s blocking wait is rejected', !stepOk('map', [4200, 4000, 4100]));
check('…and the 2026-11-04 build\'s switches are accepted (the verdict is not simply always-false)', stepOk('broker', [900, 1100, 1000]) && stepOk('filter', [300, 350, 400]) && stepOk('map', [500, 600, 700]));

if (!existsSync(join(DIST, 'index.html'))) { console.error(`FAIL  ${DIST}index.html missing — build first: npx expo export --platform web`); process.exit(1); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '');
    let file = join(DIST, rel || 'index.html');
    if (rel && existsSync(file) && (await stat(file)).isDirectory()) file = join(file, 'index.html');
    else if (rel && !existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(500); res.end('err'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const launchOpts = { args: ['--no-sandbox', '--ignore-certificate-errors', '--disable-quic'] };
if (process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
if (process.env.PW_PROXY) { launchOpts.args.push('--ssl-version-max=tls1.2'); launchOpts.proxy = { server: process.env.PW_PROXY, bypass: '127.0.0.1,localhost' }; }
const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar-SA', ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });   // a mid-range phone
const done = async (code) => { await browser.close().catch(() => {}); server.close(); process.exit(code); };

const READY = {
  broker: () => location.pathname === '/agent' && [...document.querySelectorAll('textarea')].some((t) => t.getBoundingClientRect().width > 0),
  filter: () => location.pathname === '/' && !!document.querySelector('[data-testid="home-search-button"]') && document.querySelector('[data-testid="home-search-button"]').getBoundingClientRect().width > 0,
  map: () => location.pathname === '/map' && [...document.querySelectorAll('input')].some((i) => /منطقة|Region/.test(i.getAttribute('placeholder') ?? '') && i.getBoundingClientRect().width > 0),
};
const LABEL = { broker: 'الوسيط الذكي', filter: 'تصفية', map: 'خريطة' };
async function switchTo(step) {
  const tab = page.locator('[role=tab]', { hasText: LABEL[step] }).first();
  const t0 = Date.now();
  await tab.click({ timeout: 10000 });
  const ok = await page.waitForFunction(READY[step], null, { timeout: 15000, polling: 20 }).then(() => true, () => false);
  return ok ? Date.now() - t0 : Infinity;
}

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(READY.filter, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(6000);   // a reader's pause: the page settles and the quiet warm-up runs (src/lib/mapWarmup.ts)
const consent = page.getByText('الضروري فقط', { exact: true });
if (await consent.isVisible().catch(() => false)) await consent.click();

const samples = { broker: [], filter: [], map: [] };
for (let r = 0; r < ROUNDS; r++) {
  for (const step of ['broker', 'filter', 'map', 'filter']) {
    const ms = await switchTo(step);
    samples[step].push(ms);
    await page.waitForTimeout(800);
  }
}
for (const step of Object.keys(BUDGET_MS)) {
  check(`switch to ${step}: median ${median(samples[step])} ms (budget ${BUDGET_MS[step]} ms) samples ${JSON.stringify(samples[step])}`, stepOk(step, samples[step]));
}
if (failed) { console.error(`\n❌ verify-web-tab-switch-speed: ${failed} check(s) failed — a tab switch got slow.`); await done(1); }
console.log('\nverify-web-tab-switch-speed: every tab switch within budget');
await done(0);
