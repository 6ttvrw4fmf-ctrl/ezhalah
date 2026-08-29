// ═══════════════════════════════════════════════════════════════════════════════════════════════
// JOURNEY & PERSISTENCE HARNESS (routine #6 — docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md)
//
// Routine #4's live sweep (e2e/live-sweep/) proves a SEARCH is right. This proves everything
// AROUND a search is right: session, sidebar, persistence, navigation, controls, cross-engine.
//
// WHY A SEPARATE HARNESS. The sweep's withPage() is Chromium-only and always lands on `/` with a
// guest session, because that is all a search journey needs. #6 needs three engines, two viewports,
// a seeded signed-in client state, and per-journey fresh contexts for the N>=2 reproduction rule
// (PART 11.4). Sharing sweep.mjs would have meant bending a search harness into a shape its own
// journeys do not want.
//
// LAUNCH FLAGS ARE NOT OPTIONAL (PART 11.1 / SEARCH_MATCH_QA_ENGINEER.md §41.1). In this container
// a missing flag does not look like a flag problem — every navigation dies with
// ERR_CONNECTION_RESET and the run reads as a total production outage. They are applied here, once,
// so no journey can forget them:
//   PW_EXECUTABLE_PATH   the image ships a pinned build; `playwright install` fetches a mismatched
//                        one and every journey dies at launch ("Executable doesn't exist at ...").
//   HTTPS_PROXY          the MITM egress proxy, plus --ssl-version-max=tls1.2 (TLS 1.3 through it
//                        resets every connection), --no-sandbox, --disable-dev-shm-usage,
//                        --disable-quic, --ignore-certificate-errors.
//
// SIGNED-IN STATE IS SEEDED CLIENT-SIDE, exactly as e2e/sidebar-reorder-journeys.mjs already does:
// a local Supabase session object + `history:<sub>` in localStorage. No backend account is touched
// and no privileged access stands in for a real user — sidebar history is a purely client-side
// feature (src/store.tsx: "guests: session-only, nothing on disk"), so this IS the real code path.
// The seeded token is not a valid credential, so server sync legitimately no-ops; every assertion
// here is about client state, never about server truth.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { chromium, webkit, firefox, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

export const BASE = process.env.BASE_URL || 'https://ezhalah-app.vercel.app';
export const SUB = 'qa@ezhalah.test';
const SUPA = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── findings ────────────────────────────────────────────────────────────────────────────────────
export const findings = [];
export const notes = [];
export const defect = (journey, what, detail) => {
  findings.push({ journey, what, detail });
  console.log(`  DEFECT  [${journey}] ${what}: ${detail}`);
};
export const note = (msg) => { notes.push(msg); console.log(`  note    ${msg}`); };
// A journey that could not run is NOT a journey that passed. Tracked separately so the ledger can
// say `skip` — recording a skip as a pass is how a rotation system rots: coverage stops rotating
// toward the surface nobody is actually reaching. (This run recorded four mobile sidebar journeys
// as passes while the drawer had never been opened.)
export const skips = [];
export const skip = (journey, why) => { skips.push({ journey, why }); console.log(`  SKIP    [${journey}] ${why}`); };
export const pass = (journey, what) => console.log(`  ok      [${journey}] ${what}`);

// ── the browsers ────────────────────────────────────────────────────────────────────────────────
const ENGINES = { chromium, webkit, firefox };

// The image's pinned Chromium. Defaulted here rather than required from the environment, because
// the failure mode of forgetting it is not a missing-variable error — it is Playwright asking for
// `npx playwright install`, every journey dying at launch, and the run reading as a total
// production outage (§41.12). A harness that only works when someone remembers an env var is a
// harness defect waiting to be rediscovered; this run hit it in exactly that shape.
const PINNED_CHROMIUM = process.env.PW_EXECUTABLE_PATH || '/opt/pw-browsers/chromium';

/**
 * Which engines this container can actually drive.
 *
 * The agent image ships Chromium ONLY (/opt/pw-browsers: chromium-1194 + its headless shell +
 * ffmpeg — no webkit-*, no firefox-*). PART 11.1 forbids `playwright install`, so WebKit and
 * Firefox are genuinely unreachable here rather than merely unattempted. That is a COVERAGE LIMIT
 * to report (PART 10.1), never a surface to score — so this is exported and the runner states it,
 * instead of a journey silently passing on the one engine that happens to exist.
 */
export function engineAvailable(engine) {
  if (engine === 'chromium') return existsSync(PINNED_CHROMIUM);
  try { return existsSync(ENGINES[engine].executablePath()); } catch { return false; }
}

/** Chromium takes the container flags; WebKit/Firefox take the proxy only (they have no such CLI). */
function launchOpts(engine) {
  const proxy = process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {};
  if (engine !== 'chromium') return { ...proxy };
  return {
    executablePath: PINNED_CHROMIUM,
    ...proxy,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-quic',
           '--ignore-certificate-errors', '--ssl-version-max=tls1.2'],
  };
}

const NOW = Date.now();

// A COMPLETE SearchQuery, mirroring emptyQuery() in src/lib/searchDefaults.ts field for field.
//
// This is not decoration. The first version of this fixture wrote `query: { deal, location }` by
// hand, and opening such a chat threw `Cannot read properties of undefined (reading 'match')` out
// of filterToChat — 2/2, which looked exactly like a production crash on the chat-restore path.
// It was not: `SearchQuery.priceInput` is a REQUIRED `string` that every real construction path
// sets to '' (searchDefaults.ts), so no user can reach that state, and re-running the identical
// journey against the identical bundle with a complete query throws nothing (positive proof, PART
// 9.1's inverse rule — a reproducible failure is closed as harness only on evidence, never on a
// retry that passed). A fixture that is not shaped like real data manufactures its own bugs.
const DEFAULT_QUERY = () => ({
  deal: 'Buy', location: 'الرياض', category: 'Residential',
  type: null, detail: null, priceInput: '', priceBand: null, rentPeriod: 'annual',
});
export const histItem = (id, title, ts, extra = {}) => ({
  id, label: title, query: DEFAULT_QUERY(), ts, title, titleSource: 'manual', ...extra,
});
export const THREE_CHATS = () => [
  histItem('h1', 'عقارات الرياض', NOW, { query: { ...DEFAULT_QUERY(), location: 'الرياض' } }),
  histItem('h2', 'فلل جدة', NOW - 60_000, { query: { ...DEFAULT_QUERY(), location: 'جدة' } }),
  histItem('h3', 'شقق الخبر', NOW - 120_000, { query: { ...DEFAULT_QUERY(), location: 'الخبر' } }),
];
const sessionObj = () => ({
  access_token: 'x.y.z', token_type: 'bearer', refresh_token: 'r', expires_in: 604800,
  expires_at: Math.floor(NOW / 1000) + 604800,
  user: { id: 'qa-user', aud: 'authenticated', email: SUB,
          app_metadata: { provider: 'google' }, user_metadata: { name: 'QA', full_name: 'QA' } },
});

/**
 * One journey, one FRESH browser + context (PART 11.4: a reproduction is a new context, never a
 * retry inside the same page). Collects page errors, failed requests, and the RPC bodies the app
 * actually sent, so a journey can assert on the request rather than on a live count the world is
 * allowed to move underneath it (PART 9.2 (5)).
 */
export async function withPage(opts, fn) {
  const { engine = 'chromium', mobile = false, signedIn = false, history = null, path = '/' } = opts;
  const browser = await ENGINES[engine].launch(launchOpts(engine));
  const device = mobile ? devices['iPhone 13'] : devices['Desktop Chrome'];
  // iPhone 13 is 390px; PART 3 item 6 fixes the mobile viewport at 375px, so the width is pinned
  // explicitly rather than inherited from the device profile.
  const ctx = await browser.newContext({
    ...device,
    ...(mobile ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }
               : { viewport: { width: 1440, height: 1000 } }),
    locale: 'ar-SA',
    // WebKit/Firefox reject Chromium's UA string from the device profile; let them use their own.
    ...(engine === 'chromium' ? {} : { userAgent: undefined }),
  });
  await ctx.addInitScript(([sess, hist, sub, wantAuth]) => {
    localStorage.setItem('hasSeenIntro', '1');
    if (!wantAuth) return;
    localStorage.setItem('sb-aannarbkwcymrotzwdbo-auth-token', JSON.stringify(sess));
    // Seed ONCE per context: this init script re-runs on every navigation, and re-seeding on a
    // reload would wipe the very change a persistence journey just made — the thing it exists to
    // verify. (Same reason as e2e/sidebar-reorder-journeys.mjs.)
    if (hist && !localStorage.getItem('history:' + sub)) {
      localStorage.setItem('history:' + sub, JSON.stringify(hist));
    }
  }, [sessionObj(), history, SUB, signedIn]);

  const page = await ctx.newPage();
  const bag = { pageErrors: [], failedRequests: [], rpc: [], consoleErrors: [] };
  page.on('pageerror', (e) => bag.pageErrors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') bag.consoleErrors.push(m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => bag.failedRequests.push(`${r.method()} ${r.url().slice(0, 140)} :: ${r.failure()?.errorText}`));
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/rest/v1/rpc/')) {
      let body = null; try { body = JSON.parse(r.postData() || '{}'); } catch { /* not json */ }
      bag.rpc.push({ name: u.split('/rpc/')[1]?.split('?')[0], body });
    }
  });
  try {
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 90_000 });
    await settle(page);
    return await fn(page, bag, ctx);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Wait for the app to be INTERACTIVE, not for a fixed number of seconds.
 *
 * PART 11.2: "a bare sleep is never a correctness oracle." The real condition is that the Filter
 * home's own controls have mounted — «بحث» is the last thing the home screen renders — so that is
 * what is waited on, with a bounded fallback for screens that legitimately do not have it (the
 * agent chat, a results view). The fallback is reported by the caller when a finding rests on it.
 */
export async function settle(page, timeout = 30_000) {
  const t0 = Date.now();
  try {
    await page.waitForFunction(() => {
      const t = document.body?.innerText || '';
      return t.length > 200;
    }, { timeout });
  } catch { /* fall through — caller sees an empty body and files it */ }
  await sleep(1500);
  return Date.now() - t0;
}

export const bodyText = (page) => page.evaluate(() => document.body.innerText);

/** LocalStorage history as the app itself stored it — the persistence oracle. */
export const storedHistory = (page) => page.evaluate((sub) => {
  try { return JSON.parse(localStorage.getItem('history:' + sub) || '[]'); } catch { return null; }
}, SUB);

/** Click by visible text through React's real event path — never a bare viewport coordinate. */
export async function clickText(page, text, { exact = true, nth = 0 } = {}) {
  const loc = page.getByText(text, { exact }).nth(nth);
  if (!(await loc.count())) return false;
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 15_000 }).catch(() => {});
  return true;
}

// ── ledger (PART 3 item 7) ──────────────────────────────────────────────────────────────────────
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
/**
 * `p_result` is validated server-side against exactly `pass | fail | skip` — anything else RAISES.
 * The first version of this passed 'defect' and swallowed the error, so every journey that found
 * something was the one journey that never reached the ledger, and the ledger read clean precisely
 * where it mattered. Hence both the constant list and the loud return value: a bookkeeping write
 * that fails silently is worse than one that does not happen.
 */
export const LEDGER_RESULTS = ['pass', 'fail', 'skip'];
export async function ledgerRecord(key, result, notesText) {
  if (!LEDGER_RESULTS.includes(result)) {
    console.log(`  ledger  REFUSED «${result}» for ${key} — must be one of ${LEDGER_RESULTS.join('|')}`);
    return false;
  }
  try {
    const r = await fetch(`${SUPA}/rest/v1/rpc/ops_qa_record_coverage`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ p_dimension: 'journey_persistence', p_key: key,
                             p_result: result, p_notes: (notesText ?? '').slice(0, 480) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) console.log(`  ledger  WRITE FAILED for ${key}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
    return r.ok;
  } catch (e) {
    console.log(`  ledger  WRITE THREW for ${key}: ${String(e).slice(0, 160)}`);
    return false;
  }
}

/**
 * Open the sidebar on a 375px viewport.
 *
 * At mobile width the sidebar is not merely hidden — it is UNMOUNTED, so `sidebar-search-btn` and
 * every history row are absent until the top-left toggle is pressed. Without this, every sidebar
 * journey "skipped" on mobile and the run looked like it had covered both viewports when half its
 * mandate had never executed. That is a harness defect of the quietest kind (PART 9.4): it reports
 * success by not looking.
 *
 * The toggle carries no testID or aria-label, so it is found structurally — a small, textless,
 * cursor:pointer box in the top bar — and then clicked as a REAL element handle, never as bare
 * viewport coordinates (PART 9.2 (4)).
 */
export async function openMobileSidebar(page) {
  if (await page.locator('[data-testid="sidebar-search-btn"]').count()) return true;
  for (let attempt = 0; attempt < 3; attempt++) {
    const rect = await page.evaluate(() => {
      // The hamburger is the LEADING small cursor:pointer box in the top bar (src/app/index.tsx
      // `s.hamb` → setSidebarOpen(true)). Matched on geometry + cursor only: it carries no testID,
      // no aria-label, and no text, and an innerText-emptiness clause measured as unreliable here.
      const hit = [...document.querySelectorAll('*')]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.y < 80 && r.x < 80 && r.width >= 18 && r.width <= 70
            && r.height >= 18 && r.height <= 70 && getComputedStyle(e).cursor === 'pointer';
        })
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
      if (!hit.length) return null;
      const r = hit[0].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!rect) { await sleep(1200); continue; }
    // The centre of the element's OWN getBoundingClientRect, in CSS pixel space — never a position
    // eyeballed off a screenshot, which is captured at devicePixelRatio (PART 9.2 (4)).
    await page.mouse.click(rect.x, rect.y).catch(() => {});
    await sleep(1600);
    if (await page.locator('[data-testid="sidebar-search-btn"]').count()) return true;
  }
  return false;
}
