// 🔧 Quality & Repair — PAGE PROBE: open one production page in a real browser, tap like a customer, and
// report every runtime error the page threw. Built 2026-11-01 so a Sentry fix can be PROVEN from CI the way the
// rulebook demands («tested like a real user»): the cloud sessions cannot reach ezhalah.com (backlog 924), and
// customer-journey.mjs only knows the search path. Sentry REACT-NATIVE-F (a skipped View Transition on /map
// surfacing as an unhandled rejection) is the first customer: tap the mode pills quickly, read 0 errors.
//
//   node e2e/engineers/page-probe.mjs --url https://ezhalah-app.vercel.app/map \
//        --taps 'tab:تصفية,tab:خريطة,tab:الوسيط الذكي,tab:خريطة' --repeat 3 --gap 120 --phone
//
// Flags: --url (default the production /map) · --taps a comma list of targets, each `tab:<aria-label>`,
//        `text:<exact visible text>` or `testid:<data-testid>` · --repeat N rounds (default 2) · --gap ms between
//        taps (default 150 — «twice fast» is the shape the Sentry event came from) · --phone (mobile emulation)
//        · --settle ms to wait after the last tap (default 2500) · --json (machine output only) · --selftest.
//
// Verdict: PASS when the page loaded, every tap found its target, and the browser reported 0 uncaught exceptions and
// 0 unhandled rejections — the two shapes Sentry's `onerror` / `onunhandledrejection` would have sent; FAIL otherwise,
// with each message. `console.error` lines are REPORTED as warnings, never the verdict (measured on the first PR run,
// 41311890931: a clean /map printed 11 of them, all third-party — Google One Tap's FedCM with no account on the robot,
// Cloudflare Turnstile's `data:,` CSP probe, React's `%c%d font-size:0` console trick); `--strict-console` makes them
// fail too. UNKNOWN is impossible here on purpose: a page that did not load is a FAIL. Exit code = 0 on PASS.
import '../../scripts/lib/robotPass.mjs'; // robot pass: our own robot is never blocked by the network guard (docs/ops/SCRAPE_GUARD.md)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (name, dflt = null) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const has = (name) => process.argv.includes(`--${name}`);

/** `tab:الخريطة` → { kind: 'tab', value: 'الخريطة' }; a target without a kind is a `text:` target. Pure, self-tested. */
export const parseTaps = (spec) => String(spec || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
  const m = s.match(/^(tab|text|testid):(.+)$/);
  return m ? { kind: m[1], value: m[2].trim() } : { kind: 'text', value: s };
});

/** The CSS selector a target resolves to inside the page. Pure, self-tested. */
export const selectorFor = (t) => {
  const q = (v) => JSON.stringify(String(v));
  if (t.kind === 'tab') return `[role="tab"][aria-label=${q(t.value)}]`;
  if (t.kind === 'testid') return `[data-testid=${q(t.value)}]`;
  return null; // text targets are found by exact innerText (see CLICK_LEAF)
};

/** The verdict from what the browser reported. Pure, self-tested: ANY error is a FAIL; a console warning is not,
 *  unless `strict` asks for it. */
export const verdictFor = ({ loaded, missedTaps, errors, warnings = [], strict = false }) =>
  loaded && missedTaps.length === 0 && errors.length === 0 && (!strict || warnings.length === 0) ? 'PASS' : 'FAIL';

if (has('selftest')) {
  const assert = (await import('node:assert/strict')).default;
  assert.deepEqual(parseTaps('tab:الخريطة, text:بحث ,testid:price-min-input'), [
    { kind: 'tab', value: 'الخريطة' }, { kind: 'text', value: 'بحث' }, { kind: 'testid', value: 'price-min-input' }]);
  assert.deepEqual(parseTaps('الفلتر'), [{ kind: 'text', value: 'الفلتر' }], 'a bare target is a text target');
  assert.deepEqual(parseTaps(''), []);
  assert.equal(selectorFor({ kind: 'tab', value: 'الخريطة' }), '[role="tab"][aria-label="الخريطة"]');
  assert.equal(selectorFor({ kind: 'testid', value: 'x' }), '[data-testid="x"]');
  assert.equal(selectorFor({ kind: 'text', value: 'x' }), null);
  assert.equal(verdictFor({ loaded: true, missedTaps: [], errors: [] }), 'PASS');
  assert.equal(verdictFor({ loaded: true, missedTaps: [], errors: ['InvalidStateError'] }), 'FAIL', 'one error fails');
  assert.equal(verdictFor({ loaded: true, missedTaps: ['tab:x'], errors: [] }), 'FAIL', 'a tap that found nothing fails');
  assert.equal(verdictFor({ loaded: false, missedTaps: [], errors: [] }), 'FAIL', 'a page that did not load is never PASS');
  assert.equal(verdictFor({ loaded: true, missedTaps: [], errors: [], warnings: ['console.error: [GSI_LOGGER] …'] }), 'PASS',
    'a third-party console.error is reported, not the verdict (run 41311890931)');
  assert.equal(verdictFor({ loaded: true, missedTaps: [], errors: [], warnings: ['console.error: x'], strict: true }), 'FAIL',
    '--strict-console makes a console error fail');
  console.log('page-probe self-check: OK');
  process.exit(0);
}

// ── environment (same resolution as customer-journey.mjs) ──────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
const pwPath = ['/opt/node22/lib/node_modules/playwright', 'playwright'].find((p) => {
  try { require.resolve(p); return true; } catch { return false; }
});
if (!pwPath) { console.error('playwright not found (container path or node_modules)'); process.exit(2); }
const { chromium } = require(pwPath);
const CONTAINER = fs.existsSync('/opt/pw-browsers');
const exe = CONTAINER
  ? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p))
  : undefined;

const URL_ = arg('url', 'https://ezhalah-app.vercel.app/map');
const TAPS = parseTaps(arg('taps', 'tab:تصفية,tab:خريطة,tab:الوسيط الذكي,tab:خريطة'));
const REPEAT = Math.max(1, Number(arg('repeat', 2)) || 1);
const GAP = Math.max(0, Number(arg('gap', 150)) || 0);
const SETTLE = Math.max(0, Number(arg('settle', 2500)) || 0);
const PHONE = has('phone');
const STRICT = has('strict-console');
const JSON_ONLY = has('json');
const OUT_DIR = process.env.PROBE_OUT_DIR || path.join(os.tmpdir(), 'page-probe');
const log = (...m) => { if (!JSON_ONLY) console.log(...m); };

// Click the smallest visible element whose text is exactly `txt` (the customer-journey shape).
const CLICK_LEAF = (txt) => {
  let best = null;
  document.querySelectorAll('div,span,li,button,a').forEach((e) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  best.scrollIntoView({ block: 'center' });
  const r = best.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    ...(CONTAINER ? ['--ssl-version-max=tls1.2'] : []),
    ...(CONTAINER && process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [])],
});
const errors = [];
const warnings = [];
const missedTaps = [];
let loaded = false;
let screenshot = null;
try {
  const ctx = await browser.newContext({
    locale: 'ar-SA', viewport: { width: 390, height: 844 },
    ...(PHONE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
  });
  // Unhandled rejections are what Sentry's `onunhandledrejection` sees — record them inside the page too, so a
  // rejection the browser never promotes to `pageerror` is still counted.
  await ctx.addInitScript(() => {
    window.__probeRejections = [];
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason; window.__probeRejections.push(String((r && (r.stack || r.message)) || r));
    });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e?.message || e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') warnings.push(`console.error: ${m.text().slice(0, 300)}`); });
  log(`▶ page probe — ${URL_} · ${TAPS.map((t) => `${t.kind}:${t.value}`).join(' → ')} × ${REPEAT} · gap ${GAP} ms${PHONE ? ' · phone' : ''}`);
  const resp = await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  loaded = !!resp && resp.status() < 400;
  if (!loaded) errors.push(`load: HTTP ${resp ? resp.status() : 'no response'} on ${URL_}`);
  await page.waitForTimeout(4000); // the app shell mounts and the first screen renders
  for (let round = 1; loaded && round <= REPEAT; round++) {
    for (const t of TAPS) {
      const sel = selectorFor(t);
      let hit = false;
      if (sel) {
        const el = await page.$(sel);
        if (el) { await el.click({ force: true }); hit = true; }
      } else {
        const box = await page.evaluate(CLICK_LEAF, t.value);
        if (box) { await page.mouse.click(box.x, box.y); hit = true; }
      }
      if (!hit) missedTaps.push(`${t.kind}:${t.value} (round ${round})`);
      log(`    · round ${round} tap ${t.kind}:${t.value} ${hit ? '✓' : '✗ not found'}`);
      await page.waitForTimeout(GAP);
    }
  }
  await page.waitForTimeout(SETTLE);
  const rejections = await page.evaluate(() => window.__probeRejections || []).catch(() => []);
  for (const r of rejections) errors.push(`unhandledrejection: ${String(r).slice(0, 300)}`);
  if (errors.length || missedTaps.length || (STRICT && warnings.length)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    screenshot = path.join(OUT_DIR, `probe-${Date.now()}.png`);
    await page.screenshot({ path: screenshot, fullPage: false }).catch(() => { screenshot = null; });
  }
} catch (e) {
  errors.push(`probe: ${String(e?.message || e).slice(0, 300)}`);
} finally {
  await browser.close().catch(() => {});
}
const verdict = verdictFor({ loaded, missedTaps, errors, warnings, strict: STRICT });
const out = { url: URL_, taps: TAPS, repeat: REPEAT, gapMs: GAP, phone: PHONE, loaded, missedTaps, errors, warnings, screenshot, status: verdict };
console.log(JSON.stringify(out));
log(`SUMMARY page-probe ${verdict} · loaded=${loaded} · taps missed=${missedTaps.length} · errors=${errors.length} · console warnings=${warnings.length}${STRICT ? ' (strict)' : ''}`);
process.exit(verdict === 'PASS' ? 0 : 1);
