// THE WELCOME ROBOT — opens the BUILT app as a signed-in phone user and fails the change if the personal headline
// («جمعة مباركة يوسف 🕌، تدري إن …») pops in late or changes after it appears.
//
// Owner 2026-11-06: «I never want it to pop up late … if it pops up late let a robot see it». Until that day the first
// open of each day hid the headline for up to 2.5 s while today's fact was read from the server, and on a phone the line
// then popped in late. The fix (src/lib/useFilterWelcome.ts «NEVER LATE») decides the line at mount from what the device
// already holds; the server read only prepares the NEXT open. This robot replays the worst case on every PR
// (.github/workflows/web-runtime-smoke.yml): a mid-range phone (iPhone 13 screen, 4× slower CPU), a signed-in device
// with NO fact stored today, and a facts server that takes 4 s and then fails. It samples the headline every frame and
// compares with a GUEST opening of the same build (the headline of every visitor waits for the app to start; that part
// is the same for both and is not what the owner saw):
//   • the personal line must be on screen no later than LATE_MS after the guest's headline (median of ROUNDS each), and
//   • once on screen its text must never change for the next WATCH_MS, and
//   • it must be the personal line (it carries the test name), so the signed-in path really ran.
// The session is a stored copy only (`sb-robot-auth-token`, the shape src/lib/useFilterWelcome.ts readStoredSession
// reads, with a future expiry so src/lib/authStorageGuard.ts keeps it); supabase-js never sees it, so nothing signs in
// and no account is touched.
//
// Run:  node scripts/verify-web-welcome-never-late.mjs        (after `npx expo export --platform web`)
//       WELCOME_ROBOT_DIST=/path/to/dist node scripts/verify-web-welcome-never-late.mjs
// Kept out of `npm test` (a real browser): it runs in .github/workflows/web-runtime-smoke.yml on every PR.
import './lib/robotPass.mjs'; // robot pass for our own browser robots (docs/ops/SCRAPE_GUARD.md)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const DIST = process.env.WELCOME_ROBOT_DIST || new URL('../dist/', import.meta.url).pathname;
export const LATE_MS = 500;        // the personal line may trail a guest's headline by at most this (median)
export const WATCH_MS = 6000;      // how long it must then stay the same line
const NAME = 'يوسف';
const FACTS_DELAY_MS = 4000;       // longer than the old 2.5 s hidden wait, so the old code is caught every time
const ROUNDS = 3;

let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`); };

// ── the verdict, pure — so the robot proves it would fail before it opens a browser ──────────────────────────────────
// One opening = its samples [{ t, opacity, text }] (page time, ms). shown() = the first frame the headline is on screen.
export function shown(samples) {
  const first = samples.find((x) => x.opacity >= 0.99 && x.text.trim().length > 0);
  if (!first) return null;
  const changed = samples.find((x) => x.t > first.t && x.t <= first.t + WATCH_MS && x.opacity >= 0.99 && x.text !== first.text);
  return { at: first.t, text: first.text, changedTo: changed ? changed.text : null };
}
const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : Infinity; };
export function verdict(guestRuns, signedRuns) {
  const g = guestRuns.map(shown), u = signedRuns.map(shown);
  if (u.some((x) => !x)) return { ok: false, why: 'the personal headline never showed' };
  if (g.some((x) => !x)) return { ok: false, why: 'the guest headline never showed (no reference)' };
  const swap = u.find((x) => x.changedTo);
  if (swap) return { ok: false, why: `the headline changed after it showed: «${swap.text}» → «${swap.changedTo}»` };
  const notPersonal = u.find((x) => !x.text.includes(NAME));
  if (notPersonal) return { ok: false, why: `not the personal line: «${notPersonal.text}»` };
  const late = median(u.map((x) => x.at)) - median(g.map((x) => x.at));
  if (late > LATE_MS) return { ok: false, why: `the personal line showed ${Math.round(late)} ms after a guest's headline (limit ${LATE_MS} ms)` };
  return { ok: true, why: `${Math.round(late)} ms after a guest's headline, unchanged for ${WATCH_MS} ms: «${u[0].text}»` };
}
const mustCatch = (label, caught) => check(`MUTATION — ${label}`, caught);
const line = `صباح الخير ${NAME}، تدري إن …`;
const guestLine = 'موقع واحد للبحث في كل المنصات';
const run = (...xs) => xs.map(([t, opacity, text]) => ({ t, opacity, text }));
const guests = [run([900, 0, guestLine], [1000, 1, guestLine]), run([950, 1, guestLine]), run([1050, 1, guestLine])];
mustCatch('the old 2.5 s hidden wait (personal line ~2.5 s after a guest\'s headline) is rejected',
  !verdict(guests, [run([1000, 0, guestLine], [3500, 1, line]), run([3550, 1, line]), run([3600, 1, line])]).ok);
mustCatch('a headline that appears and then turns into another line is rejected',
  !verdict(guests, [run([1000, 1, `مساء الخير ${NAME}، حتى المدن الصغيرة …`], [3500, 1, line]), run([1000, 1, line]), run([1000, 1, line])]).ok);
mustCatch('a personal headline that never shows is a failure, never skipped', !verdict(guests, [run([1000, 0, line]), run([1000, 1, line]), run([1000, 1, line])]).ok);
mustCatch('the guest line (no name) does not count as the signed-in path', !verdict(guests, [run([1000, 1, guestLine]), run([1000, 1, guestLine]), run([1000, 1, guestLine])]).ok);
check('…and an instant, unchanging personal line is accepted (the verdict is not simply always-false)',
  verdict(guests, [run([1050, 1, line], [7000, 1, line]), run([1100, 1, line]), run([980, 1, line])]).ok);

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
const done = async (code) => { await browser.close().catch(() => {}); server.close(); process.exit(code); };

// One opening in a fresh phone: signed in (a stored session, no fact stored today) or a guest. Today's facts arrive late
// and then fail, so the headline must not be waiting for them.
async function open(signedIn) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar-SA', ignoreHTTPSErrors: true });
  await ctx.addInitScript(({ name, signedIn }) => {
    if (signedIn) {
      try {
        localStorage.setItem('sb-robot-auth-token', JSON.stringify({
          expires_at: Math.floor(Date.now() / 1000) + 30 * 86400,
          user: { id: 'welcome-robot', created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-01-01T00:00:00Z',
            user_metadata: { full_name: name, name_prompt_seen: true } },
        }));
      } catch { /* the verdict then fails on «not the personal line» */ }
    }
    const out = (globalThis.__welcome = { samples: [] });
    const tick = () => {
      const h = document.querySelector('[data-ezh-shine]');
      if (h) out.samples.push({ t: performance.now(), opacity: Number(getComputedStyle(h).opacity), text: h.textContent ?? '' });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { name: NAME, signedIn });
  let factsAsked = 0;
  await ctx.route('**/rest/v1/rpc/welcome_insights_pick**', async (route) => {
    factsAsked++;
    await new Promise((r) => setTimeout(r, FACTS_DELAY_MS));
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"welcome robot: slow facts"}' }).catch(() => {});
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });   // a mid-range phone
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(WATCH_MS + FACTS_DELAY_MS);
  const samples = await page.evaluate(() => globalThis.__welcome?.samples ?? []);
  await ctx.close().catch(() => {});
  return { samples, factsAsked };
}

const guestRuns = [], signedRuns = [];
let asked = 0;
for (let r = 0; r < ROUNDS; r++) {
  guestRuns.push((await open(false)).samples);
  const s = await open(true);
  signedRuns.push(s.samples);
  asked += s.factsAsked;
}
const v = verdict(guestRuns, signedRuns);
console.log(`      guest headline at ${JSON.stringify(guestRuns.map((x) => Math.round(shown(x)?.at ?? NaN)))} ms · personal at ${JSON.stringify(signedRuns.map((x) => Math.round(shown(x)?.at ?? NaN)))} ms · facts asked ${asked}×`);
check(`the personal headline is on screen with a guest's and never changes — ${v.why}`, v.ok);
if (failed) { console.error(`\n❌ verify-web-welcome-never-late: ${failed} check(s) failed — the welcome line pops in late or changes.`); await done(1); }
console.log('\nverify-web-welcome-never-late: the welcome line is there at once and stays');
await done(0);
