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
// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import '../../scripts/lib/searchPacer.mjs';
import { chromium, webkit, firefox, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// The production target lock (AGENTS.md): the ONE URL these journeys score. Named rather than
// inlined so `ledgerRecord` can refuse to mint coverage for anything else.
export const PROD_BASE = 'https://ezhalah-app.vercel.app';
export const BASE = process.env.BASE_URL || PROD_BASE;
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
  // CHROMIUM LIVES IN TWO DIFFERENT PLACES, and checking only one of them made the fail-closed
  // guard refuse a perfectly good browser. In the agent container it is the image's pinned
  // /opt/pw-browsers build; on a GitHub runner `npx playwright install chromium` puts it in
  // Playwright's own cache and PINNED_CHROMIUM does not exist at all. Measured 2026-09-03: the
  // all-engines dispatch exited 2 with «JOURNEY_ENGINE=chromium is not installed here» on a runner
  // that had just installed it — the guard doing real damage in the direction it exists to prevent,
  // by calling a present engine absent. Accept EITHER location; the launcher picks the same one.
  if (engine === 'chromium' && existsSync(PINNED_CHROMIUM)) return true;
  try { return existsSync(ENGINES[engine].executablePath()); } catch { return false; }
}

/** Chromium takes the container flags; WebKit/Firefox take the proxy only (they have no such CLI).
 *
 *  THE LOCALHOST BYPASS IS NOT A CONVENIENCE. Production is the only thing these journeys score
 *  (PART 3), but a `src/` fix has to be provable in a real browser BEFORE it ships, and the only
 *  build that carries an unmerged fix is a local one — `scripts/verify-web-runtime-smoke.mjs`
 *  serves `dist/` on 127.0.0.1 for exactly that reason, and sets this same bypass.
 *
 *  With the proxy set and no bypass, 127.0.0.1 is routed through the egress proxy and never
 *  resolves; unsetting the proxy (the obvious workaround) loads the page but cuts the browser off
 *  from Supabase entirely. The bypass is the only combination that can be both, so it belongs here.
 *
 *  THE BYPASS ALONE IS NOT ENOUGH, AND THE SECOND HALF IS THE ONE THAT COSTS A RUN. Build the
 *  bundle the obvious way and EVERY signed-in journey skips with «row ⋯ menu would not open», on
 *  the existing known-good `sidebar-row-actions` as much as on a new journey, while both pass
 *  against production. `verify-web-runtime-smoke.mjs` fails the same build at
 *  «pickCity(الرياض): the app never confirmed the selection» — on plain `main`, which CI is green
 *  on. Nothing is wrong with the app: the bundle simply has no backend.
 *
 *  TWO THINGS ARE REQUIRED, and the second is invisible:
 *    1. EXPORT THE CLIENT ENV BEFORE BUILDING. `src/lib/supabase.ts` reads
 *       `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY` at BUILD time; unset, the client
 *       builds as null and every search, location lookup and auth check dies. This container does
 *       not set them (CI does, in web-runtime-smoke.yml, with public fallbacks — they are
 *       client-public by definition and inlined into every served page; the service-role key
 *       NEVER goes here).
 *    2. CLEAR METRO'S CACHE IF AN EARLIER BUILD RAN WITHOUT THEM. `process.env.EXPO_PUBLIC_*` is
 *       inlined at TRANSFORM time and the transform is cached, so exporting the variables and
 *       rebuilding silently reuses the `undefined` from the first attempt. That is the whole trap:
 *       the second build looks correct, changes nothing, and sends you hunting a product bug.
 *       `grep -rl "<the supabase ref>" dist/` is the one-second check that the env actually landed.
 *
 *  With both done, the same local `dist/` goes from 1 smoke check passing to 52, the sidebar
 *  journeys stop skipping, and a `src/` fix becomes provable before it ships (measured 2026-09-04).
 *  Production remains the only thing scored (PART 3/PART 7) — a local green is evidence the fix
 *  works, never a substitute for verifying production after deploy. */
function launchOpts(engine) {
  const proxy = process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } }
    : {};
  if (engine !== 'chromium') return { ...proxy };
  return {
    // Only pin the path when that binary actually exists (the agent container). On a runner,
    // letting Playwright resolve its own installed build is correct — and forcing a nonexistent
    // executablePath would fail every launch.
    ...(existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {}),
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
// The context fixture's storage seeding, as a SELF-CONTAINED function so a barrier can EXECUTE it
// against a fake localStorage instead of string-matching it. Playwright serialises this to the
// browser, so it must not reference anything in module scope — that constraint is what kept this
// logic untestable, and inlining it in the addInitScript call is what let the session-resurrection
// bug below live here unnoticed. Exported for scripts/verify-journey-fixture-session-seed.ts.
export const seedInitScript = ([sess, hist, sub, wantAuth]) => {
  // AN INIT SCRIPT RUNS ON EVERY DOCUMENT, INCLUDING about:blank — where touching localStorage
  // throws `SecurityError: Access is denied for this document`. Playwright reports that as a
  // PAGE ERROR on the page object, so it lands in `bag.pageErrors` and every journey that checks
  // them files it as a production defect. `adv-modeswitch-back-push-vs-replace` hit exactly that
  // on its first run (2/2, desktop and mobile): all three product assertions passed and the
  // journey still went red, blaming the app for the harness's own throw on the about:blank the
  // fresh context starts at and goBack() returns to. That is PART 9's first expensive error —
  // a harness artifact filed as an Ezhalah bug — reaching the report from inside the harness
  // itself. `back-after-search` never saw it only because it returns early when Back leaves the
  // origin, before its pageErrors check.
  if (!location.protocol.startsWith('http')) return;
  try { localStorage.setItem('hasSeenIntro', '1'); } catch { return; }
  if (!wantAuth) return;
  // THE SESSION IS SEEDED ONCE PER CONTEXT — for the same reason the history seed below is, and
  // this line used to miss it. Re-writing the auth token on EVERY navigation silently RESURRECTS a
  // session the app deliberately destroyed, so any journey that signs out or deletes the account
  // was untestable: measured 2026-09-02, `signout-leaves-no-trace` went red 4/4 (both viewports,
  // fresh contexts) on "the previous account's chats came back after a reload" while the product
  // was entirely correct. The probe that settled it read the key directly across the flow —
  //   seeded: authToken PRESENT, chrome signed-in
  //   after sign-out, before reload: authToken ABSENT, chrome guest   ← the app did its job
  //   after reload: authToken PRESENT, chrome signed-in               ← only this script writes it
  // — which is PART 9.1's required positive proof that a reproducible failure is harness, not code.
  // Worse than a false positive: it would have made a REAL "sign-out doesn't stick" bug invisible,
  // because the fixture re-signs-in exactly like the bug would.
  //
  // A presence check on the token itself is NOT enough and was the tempting wrong fix: after a
  // sign-out the token is legitimately absent, so `if (!token) seed()` re-seeds it and reproduces
  // this bug exactly. The sentinel is therefore a separate key that sign-out does not clear — it
  // records "this context has been seeded", which is the fact we actually depend on.
  if (!localStorage.getItem('__ez_qa_session_seeded')) {
    localStorage.setItem('sb-aannarbkwcymrotzwdbo-auth-token', JSON.stringify(sess));
    localStorage.setItem('__ez_qa_session_seeded', '1');
  }
  // Seed ONCE per context: this init script re-runs on every navigation, and re-seeding on a
  // reload would wipe the very change a persistence journey just made — the thing it exists to
  // verify. (Same reason as e2e/sidebar-reorder-journeys.mjs.)
  if (hist && !localStorage.getItem('history:' + sub)) {
    localStorage.setItem('history:' + sub, JSON.stringify(hist));
  }
};

/**
 * The engine this process drives, when a journey does not name one.
 *
 * PART 3 item 6 asks for a rotation across Safari/Chrome/Firefox; §11.5 recorded WebKit and Firefox
 * as unreachable, which is true OF THIS CONTAINER (Chromium only, and PART 11.1 rightly forbids
 * `playwright install` here — a mismatched build kills every journey at launch and reads as an
 * outage). It was never true of CI: six workflows already run `npx playwright install --with-deps
 * chromium` on a GitHub runner. What was missing is that NO workflow ran this sweep at all, so it
 * only ever executed where only Chromium exists. `.github/workflows/journey-sweep.yml` runs it once
 * per engine; this variable is how that matrix reaches every journey without touching one of them.
 */
export const ENGINE = process.env.JOURNEY_ENGINE || 'chromium';

export async function withPage(opts, fn) {
  const { engine = ENGINE, mobile = false, signedIn = false, history = null, path = '/' } = opts;
  const browser = await ENGINES[engine].launch(launchOpts(engine));
  const device = mobile ? devices['iPhone 13'] : devices['Desktop Chrome'];
  // FIREFOX REJECTS `isMobile` OUTRIGHT — `browser.newContext: options.isMobile is not supported in
  // Firefox`, thrown at context creation, i.e. before a single journey body runs. The iPhone 13
  // profile carries `isMobile: true` inside the spread as well as the explicit pair below, so BOTH
  // have to be stripped; dropping only the explicit one leaves the device profile's copy to throw.
  // Gecko has no mobile-emulation mode at all, so this is a genuine engine limit, not a workaround:
  // Firefox mobile runs are a 375px viewport with touch, and the report says exactly that rather
  // than implying a device profile it never had.
  const mobileCtx = mobile
    ? (engine === 'firefox'
        ? { viewport: { width: 375, height: 812 }, hasTouch: true }
        : { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
    : { viewport: { width: 1440, height: 1000 } };
  const { isMobile: _deviceIsMobile, ...deviceRest } = device;
  const ctx = await browser.newContext({
    // iPhone 13 is 390px; PART 3 item 6 fixes the mobile viewport at 375px, so the width is pinned
    // explicitly rather than inherited from the device profile.
    ...(engine === 'firefox' ? deviceRest : device),
    ...mobileCtx,
    locale: 'ar-SA',
    // WebKit/Firefox reject Chromium's UA string from the device profile; let them use their own.
    ...(engine === 'chromium' ? {} : { userAgent: undefined }),
  });
  await ctx.addInitScript(seedInitScript, [sessionObj(), history, SUB, signedIn]);

  // A SEEDED SESSION MUST NOT SUMMON A PROMPT A REAL SIGNED-IN USER NEVER SEES.
  //
  // GoogleOneTap.tsx gates on `supabase.auth.getUser()` — SERVER-validated, deliberately, so that a
  // deleted account or revoked token still gets prompted (owner rule; the comment there records
  // that gating on the local `user` produced 0 prompt attempts for the deleted-account case). Our
  // seeded token is a fake JWT, so the server rejects it, the component correctly concludes "signed
  // out", and One Tap prompts. That is the product behaving as specified — for a state no real
  // signed-in visitor is ever in.
  //
  // The damage was measured, not theorised. At 375px GIS renders `ui_mode=bottom_sheet`, and its
  // `credential_picker_iframe` sits over the sidebar's account row (trigger box y=739 h=59 in an
  // 812px viewport). Playwright reports «<iframe id="credential_picker_iframe" …> intercepts
  // pointer events», the account menu never opens, and `appearance-cancel-keeps-dark` skipped
  // «account menu would not open» 2/2 on mobile in the 2026-08-31 sweep — an entire owner rule
  // (إلغاء must not touch the theme) going untested behind a tidy skip. Desktop never saw it: there
  // the same trigger sits at y=927 of a 1000px viewport and the prompt renders in the corner.
  //
  // So GIS is blocked ONLY for seeded-signed-in contexts, which restores the state the journey
  // means to test. Guest contexts are untouched: One Tap legitimately belongs there, and blocking
  // it everywhere would hide the real thing. This is the harness's own "a fixture that is not
  // shaped like real data manufactures its own bugs" lesson (see DEFAULT_QUERY above), applied to
  // auth state rather than to a query.
  if (signedIn) {
    await ctx.route(/accounts\.google\.com|\/gsi\//, (route) => route.abort().catch(() => {}));
  }

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
    await gotoOrRetryTransport(page, BASE + path);
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

/**
 * Click by visible text through React's real event path — never a bare viewport coordinate.
 *
 * A CLICK THAT NEVER LANDED RETURNS FALSE. The first version of this ended `.click().catch(() =>
 * {})` and returned `true` unconditionally, so an intercepted click — the commonest failure on a
 * 375px viewport, where an open drawer covers the whole screen — was reported to the caller as a
 * success. The caller then carried on and blamed whatever was missing downstream: `new-chat-blank`
 * skipped «composer not found» on mobile for two consecutive runs (2026-08-28 and 2026-08-29)
 * while the real event was that the agent tab was never opened, because the drawer ate the tap.
 * That is PART 11.2 rule 2 and PR #1146's swallowed `.catch(() => {})` in a different costume: a
 * failure absorbed into silence points the next reader at the wrong screen, and — worse — the
 * flagship New Chat guarantee (PART 5 shape 1) reported a tidy `skip` on mobile rather than the
 * missing coverage it actually was.
 *
 * `clickReason()` carries WHY the last click did not land, so a skip/defect message can name the
 * real event ("intercepted") instead of its downstream symptom.
 */
let lastClickReason = '';
export const clickReason = () => lastClickReason;

export async function clickText(page, text, { exact = true, nth = 0, timeout = 15_000 } = {}) {
  const loc = page.getByText(text, { exact }).nth(nth);
  if (!(await loc.count())) { lastClickReason = `«${text}» is not present`; return false; }
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await loc.click({ timeout });
    lastClickReason = '';
    return true;
  } catch (e) {
    // Playwright's own log names the interceptor ("… subtree intercepts pointer events"), which is
    // exactly the discriminator PART 9.1 asks a finding to state. Keep it; do not swallow it.
    const first = String(e).split('\n').find((l) => /intercepts pointer events/.test(l));
    lastClickReason = first
      ? `«${text}» was intercepted by ${first.trim().slice(0, 120)}`
      : `«${text}» click failed: ${String(e).split('\n')[0].slice(0, 140)}`;
    console.log(`  click   DID NOT LAND — ${lastClickReason}`);
    return false;
  }
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

/**
 * A LEDGER ROW MAY ONLY EXIST FOR A JOURNEY THE COMMITTED RUNNER CAN RE-RUN.
 *
 * PART 3 item 7 gives the ledger one job: make "have we tried this exact sequence before" a QUERY
 * rather than a memory, so coverage rotates toward whatever has gone longest untested. A row whose
 * journey exists in no committed file breaks exactly that: it reads as coverage forever and can
 * never be reproduced, re-run, or rotated to.
 *
 * THIS IS NOT HYPOTHETICAL. On 2026-08-30 an ad-hoc probe script wrote three rows —
 * `adv-favorites-remove`, `adv-favorite-survives-navigation`, `adv-modeswitch-back-push-vs-replace`
 * — and was never committed, so it died with its container. On 2026-08-31 nothing in the repo could
 * produce those keys (`grep -rl` across the tree: no match), yet two of them claimed coverage for
 * PART 1 mandate clauses no committed journey actually tested: "the favorited state surviving
 * NAVIGATION" and the mode toggle's push-vs-replace Back behaviour. The ledger was asserting a
 * clean bill of health over a hole — the same shape AGENTS.md records for the nine dark detectors
 * and `mon_detect_orphaned_detectors()`, which exists because "a detector nothing reaches is
 * decoration."
 *
 * So the guard is at the WRITE POINT, where it fails closed: an unregistered writer records
 * nothing. Exploration stays free — an adversarial probe can drive any journey it likes — but it
 * cannot mint PERMANENT COVERAGE for itself. To claim a ledger row, land the journey in
 * `run.mjs` first, which is PART 5's rule ("add a permanent regression barrier") already.
 */
let ownedLedgerKeys = null;

/** Both viewport rows the runner emits for a journey. The single source of the key shape. */
/**
 * Ledger keys for a set of journeys, on the engine this process is driving.
 *
 * CHROMIUM KEEPS THE UNQUALIFIED KEY ON PURPOSE. The ledger's job is "what has gone longest
 * untested" (PART 3 item 7), and that answer lives in `times_tested`/`last_tested_at` accumulated
 * across ~20 runs per key. Qualifying every key with an engine would have reset all 38 of them to
 * zero and blinded the rotation for weeks — paying for multi-engine coverage by destroying the
 * history that makes coverage legible. Non-Chromium engines are genuinely new coverage, so they get
 * their own rows and their own honest count starting at 1.
 */
export const ledgerKeysFor = (names, engine = ENGINE) => {
  const suffix = engine === 'chromium' ? '' : `:${engine}`;
  return names.flatMap((n) => [`${n}${suffix}:desktop`, `${n}${suffix}:mobile`]);
};

/** Called by the runner with its own `Object.keys(JOURNEYS)` before any row is written. */
export function registerJourneys(names) {
  ownedLedgerKeys = new Set(ledgerKeysFor(names));
  return ownedLedgerKeys.size;
}

/** Unregistered ⇒ nothing is owned. Fails CLOSED: a writer that never registered records nothing. */
export const isOwnedLedgerKey = (key) => !!ownedLedgerKeys && ownedLedgerKeys.has(key);

export async function ledgerRecord(key, result, notesText) {
  // A ROW MUST MEAN "PRODUCTION WAS TESTED", OR IT MEANS NOTHING.
  //
  // The ledger is not a log — it is what decides which surface gets attacked next (PART 3 item 7),
  // so a row minted from anywhere else rotates coverage AWAY from a surface production has never
  // exercised. `BASE_URL` is overridable for local-build verification (see launchOpts), and nothing
  // stopped such a run from writing here: this run drove `http://127.0.0.1:8899` and wrote
  // `adv-crosstab-no-clobber` rows claiming production coverage for a journey production had never
  // executed, and could not have — the fix it guards was not deployed yet. Those rows were removed.
  //
  // This is the same failure the `registerJourneys` guard below exists for — a row asserting
  // coverage nothing can reproduce — reached through the other door: that one checks WHICH journey,
  // this one checks WHAT WAS DRIVEN. Both have to hold for a row to be worth reading.
  if (BASE !== PROD_BASE) {
    console.log(`  ledger  REFUSED «${key}» — this run drove ${BASE}, not production (${PROD_BASE}). `
      + `A ledger row means production was tested; a local build has proved a fix, not covered a surface.`);
    return false;
  }
  if (!LEDGER_RESULTS.includes(result)) {
    console.log(`  ledger  REFUSED «${result}» for ${key} — must be one of ${LEDGER_RESULTS.join('|')}`);
    return false;
  }
  if (!isOwnedLedgerKey(key)) {
    console.log(`  ledger  REFUSED «${key}» — no committed journey in run.mjs produces this key, so `
      + `the row could never be re-run (PART 3 item 7). Land the journey first, then record it.`);
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
/**
 * Close the 375px drawer so the screen underneath can be driven.
 *
 * NEEDED BECAUSE THE DRAWER COVERS THE MODE SWITCH. Measured on production 2026-08-31, mobile375:
 * the drawer panel is x=0 w=307.5 of a 375px viewport, and «الوكيل الذكي» sits at x=217 — INSIDE
 * the panel's span, so any tap on it while the drawer is open is intercepted. That is the exact
 * failure `new-chat-blank` was rewritten to dodge by re-ordering its steps; a journey that must
 * open the drawer FIRST (star a row) and navigate SECOND cannot dodge it and needs a real close.
 *
 * The backdrop (`s.backdrop` in Sidebar.tsx: position absolute, inset 0, rgba(8,18,12,0.42),
 * `onPress={close}`) is rendered UNDER the panel, so the strip from the panel's right edge to the
 * viewport edge is the one place a tap reaches it. Both rects are read at runtime and the hit is
 * confirmed with elementFromPoint before clicking — never a hard-coded x, which would rot the day
 * the panel width changes (PART 9.2 (4): the element's own geometry in CSS pixel space).
 */
export async function closeMobileSidebar(page) {
  if (!(await page.locator('[data-testid="sidebar-search-btn"]').count())) return true;
  const pt = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="sidebar-search-btn"]');
    if (!btn) return null;
    let panel = null;
    for (let n = btn, i = 0; i < 12 && n; i++, n = n.parentElement) {
      const r = n.getBoundingClientRect();
      if (r.width > 100 && r.width < innerWidth) panel = r;
    }
    if (!panel) return null;
    const x = (panel.x + panel.width + innerWidth) / 2;   // midpoint of the exposed strip
    const y = innerHeight / 2;
    const hit = document.elementFromPoint(x, y);
    // Only click if the backdrop really is the topmost element there. If the panel has grown to
    // full width there is no strip, and clicking anyway would hit a sidebar row instead.
    if (!hit || !getComputedStyle(hit).backgroundColor.includes('8, 18, 12')) return null;
    return { x, y };
  });
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y).catch(() => {});
  await sleep(1200);
  return (await page.locator('[data-testid="sidebar-search-btn"]').count()) === 0;
}

// `guestOk` widens the OPEN oracle, and exists because the default one is auth-scoped in a way that
// silently defeats any logged-out mobile journey. `sidebar-search-btn` renders only inside
// Sidebar.tsx's `user ? (…)` branch, so for a GUEST this function could never return true no matter
// how perfectly the drawer opened — a post-sign-out check keyed on it would skip 100% of the time
// and read as "nothing to see", which is exactly the shape of blindness PART 9.4 makes ours to fix.
// Opt-in rather than always-on: for a SIGNED-IN journey, accepting the guest marker would turn a
// failed session seed from an honest skip into a confusing mid-journey failure.
//
// THE GUEST MARKER MUST BE DRAWER-ONLY, AND THE FIRST ONE WAS NOT (measured 2026-09-03, routine #6).
// This oracle used to match the CTA's visible TEXT, «إنشاء حساب / تسجيل الدخول», on the stated
// premise that "the guest branch has no testID". That premise was simply false — Sidebar.tsx's guest
// CTA carries `dataSet={{ testid: 'sidebar-signin-cta' }}` — and the string it used instead is NOT
// unique to the drawer: `src/app/index.tsx` renders the identical label in the mobile TOP BAR
// (`s.topSignIn`), added by the owner on 2026-08-19 for exactly the reason that makes it fatal here
// ("on mobile the sidebar is a drawer, so without this the sign-in CTA is invisible until the
// hamburger is tapped"). So on any signed-out mobile screen the oracle answered "the drawer is open"
// before a single tap, and `openMobileSidebar` returned true having opened nothing.
//
// That is not a cosmetic wart — it silently voided the mobile half of `signout-leaves-no-trace`.
// With the drawer never opened, `account-menu-trigger` cannot be on screen and no seeded chat title
// can be in `bodyText`, so THREE assertions passed for the trivial reason that nothing was rendered:
// "signed-in chrome is gone after sign-out", the on-screen leak check, and the post-reload leak
// check. Assertions that cannot fail; the ledger recorded 4/4 passes. The journey's own comment
// ("Only judgeable if the sidebar is actually on screen … a guaranteed pass that proves nothing")
// names the trap precisely, and the guard it built was defeated by this oracle answering true.
//
// Measured proof, 2/2 in fresh mobile contexts against production:
//   drawer CLOSED → CTA text matches 1 node (the top bar); [data-testid="sidebar-signin-cta"] → 0
//   drawer OPEN   → [data-testid="sidebar-signin-cta"] → 1, and «المساعدة/تواصل معنا» is in the drawer
// So the testID is the marker, and the guest drawer's own contents were never the problem.
export const SIDEBAR_OPEN_MARKER = '[data-testid="sidebar-search-btn"]';
export const SIDEBAR_OPEN_MARKER_GUEST = '[data-testid="sidebar-signin-cta"]';

/**
 * Is the sidebar ACTUALLY on screen? Exported and page-shaped-by-contract (it touches nothing but
 * `page.locator(sel).count()`) so `scripts/verify-journey-mobile-sidebar-oracle.ts` can EXECUTE the
 * real predicate against a fake page — the same "execute it, don't string-match it" rule the
 * fixture-seed barrier follows. A selector-only oracle is what makes that possible: the moment this
 * reaches for visible text again, the barrier can no longer tell the drawer from the top bar, and
 * neither can the journeys.
 */
export async function sidebarIsOpen(page, { guestOk = false } = {}) {
  if (await page.locator(SIDEBAR_OPEN_MARKER).count()) return true;
  if (!guestOk) return false;
  return (await page.locator(SIDEBAR_OPEN_MARKER_GUEST).count()) > 0;
}

// ── A COMMITTED CITY IS THE ONLY THING THAT MAKES A SEARCH VALID ────────────────────────────────
// src/app/index.tsx:1219 renders this image ONLY when `citySelected` is non-null, and `onSearch`
// (index.tsx:712) returns at `if (!citySelected)` with a validation message and ZERO requests. That
// refusal is the owner's spec, 2026-07-17: "The user must select a valid city result. Do not accept
// arbitrary free text and never guess a location." `citySelected` is cleared on every keystroke, so
// only a TAPPED suggestion row sets it.
//
// A journey that types a city, fails to land the suggestion tap, presses «بحث» and observes no
// request has therefore observed the app OBEYING ITS SPEC — not a broken control. Measured
// 2026-09-04: `double-click-search` filed «dead control: «بحث» single click fired no search at all»
// on WebKit desktop from exactly that state. This marker is what lets a journey tell the two apart
// BEFORE it reaches a verdict, and it is a testID rather than visible text for the same reason the
// sidebar oracle is (see above): text answers true from the wrong screen.
export const SELECTED_CITY_MARKER = '[data-testid="selected-city-visual"]';

// ── ONE RPC NAME, THREE DIFFERENT QUESTIONS ─────────────────────────────────────────────────────
// `location_search_candidates_ar` is not "a search". src/data/remote.ts calls it from three places:
//   · line 1476 — the RESULTS query, `p_limit: pageLimit` (1500 in production)
//   · line  920 — fetchScopeOptionCounts,      `p_limit: 1`, ONE CALL PER VISIBLE SCOPE OPTION
//   · line  965 — fetchDistrictEligibleCounts, `p_limit: 1`, ONE CALL PER VISIBLE DISTRICT OPTION,
//                 and only "when a narrowing filter beyond district_options_ar's scope is active"
// The count helpers fan out in parallel, one call per option ON SCREEN, so the raw number of calls
// is a property of what the results screen decided to decorate — not of how many searches were
// submitted. Measured on production 2026-09-04, mobile, 2/2 each: one press → 6 calls = 1 results
// (p_limit 1500) + 5 option counts; a DOUBLE press → also 6 = 1 results + 5 option counts.
//
// So `double (6) > single (1)` says nothing about double-submission, which is precisely the verdict
// `double-click-search` filed on WebKit mobile. Counting the RESULTS class alone answers the
// question the journey is actually asking, and gives the same number on both sides.
//
// An unparsable body is 'unknown' rather than being folded into either class: guessing would push
// it into 'results' and manufacture the very double-fire this is meant to measure.
export function classifySearchRpc(r) {
  if (!r || r.name !== 'location_search_candidates_ar') return 'other';
  const lim = r.body ? r.body.p_limit : undefined;
  if (lim === 1) return 'option-count';
  if (typeof lim === 'number' && lim > 1) return 'results';
  return 'unknown';
}
// ── THE OPENING NAVIGATION: TRANSPORT FAILURE IS NOT A PRODUCT DEFECT ───────────────────────────
// PART 9 opens by naming two opposite errors, and this function exists because the runner was
// committing the FIRST one automatically. `run.mjs` wraps each journey in
// `catch (e) { defect(key, 'journey threw', …) }`, so a `page.goto` that never completed at the
// TRANSPORT layer — before a single byte of app code ran, before any assertion existed to fail —
// was filed as an Ezhalah defect. Measured 2026-09-02: a 72-journey production sweep reported
// exactly 2 defects, both `net::ERR_TIMED_OUT` on the opening `page.goto`, in two unrelated
// journeys, each 1/2 — while the other 70 runs loaded that identical URL and bundle fine in the
// same window. That is this container's egress, not the product (PART 9.1 condition 3).
//
// THE FIX IS A DISCRIMINATOR, NOT A SWALLOW, AND NOT A BIGGER TIMEOUT (PART 11.2 rule 3). The 90 s
// budget is untouched. A transport-class failure gets exactly ONE genuinely fresh navigation:
//   · it succeeds  → the blip is NAMED in the run output as a transport note, never as a pass and
//                    never as a defect, so the rate stays visible across runs instead of vanishing;
//   · it fails too → the original error is rethrown UNCHANGED and the journey fails exactly as
//                    loudly as before.
// A real outage fails both attempts on every journey, so it still reads as a total outage — which
// is precisely the signal PART 9.4 warns must not be papered over. Only the one-off blip is
// reclassified, and only after it has demonstrably stopped happening.
//
// Scoped to the OPENING navigation only. An in-journey `page.reload()` is an assertion about the
// app (the sidebar journeys' post-reload re-checks depend on it) and is deliberately not retried.
// `chrome-error://chromewebdata/` is in this list because the SAME failure does not always carry a
// net:: code. When a navigation fails at the network layer Chromium may navigate to its internal
// error page instead, and Playwright then reports «Navigation to "<url>" is interrupted by another
// navigation to "chrome-error://chromewebdata/"» with no ERR_* anywhere in the string. Measured on
// the verification sweep for this very fix (2026-09-02): the first sweep produced two ERR_TIMED_OUT
// blips, the re-run produced this shape instead, in the same journey — one condition, two messages.
// Classifying only the first would have left the discriminator half-built and still filing network
// blips as Ezhalah defects. It is safe to treat as transport: Chromium shows that error page for
// network, DNS, proxy and TLS failures, never for an app error or a failed assertion.
const TRANSPORT_ERRORS = [
  'ERR_TIMED_OUT', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_REFUSED',
  'ERR_NETWORK_CHANGED', 'ERR_NAME_NOT_RESOLVED', 'ERR_PROXY_CONNECTION_FAILED', 'ERR_EMPTY_RESPONSE',
  'ERR_SSL_PROTOCOL_ERROR', 'ERR_ADDRESS_UNREACHABLE', 'ERR_INTERNET_DISCONNECTED',
  'chrome-error://chromewebdata',
];
export const isTransportError = (err) => {
  const s = String(err && err.message ? err.message : err);
  return TRANSPORT_ERRORS.some((code) => s.includes(code));
};

// ── A NETWORK FAILURE IS NOT AN APPLICATION EXCEPTION, EVEN WHEN THE ENGINE REPORTS IT AS ONE ────
//
// Eighteen journeys end with `if (bag.pageErrors.length) defect(...)`, on the reasonable premise
// that an uncaught page error is a product defect. On WebKit that premise breaks: a failed
// cross-origin fetch surfaces as a PAGE error, not merely a console message, so a network blip on
// a GitHub runner reads as an Ezhalah bug — PART 9's first and most expensive error, arriving from
// inside the harness.
//
// ADJUDICATED, NOT ASSUMED (2026-09-03). `appearance-guest-light` failed 4/10 desktop and 2/10
// mobile on WebKit with «Fetch API cannot load …/rpc/top_cities_by_deal_ar due to access control
// checks», while every product assertion in the same journey passed, and Chromium and Firefox were
// clean on the identical bundle. The deciding experiment forced that exact request to fail on
// CHROMIUM (`route.abort('failed')`, 2/2 fresh contexts): the app produced **0 page errors** — three
// `requestfailed` entries and nothing else — because `src/data/locations.ts` catches it and returns
// `[]`. So the app's handling is correct and engine-independent, and what differs is purely how
// WebKit REPORTS a dead request. That is the positive proof PART 9.1's inverse rule demands before
// a reproducible failure may be called environment.
//
// THIS MUST NEVER SWALLOW A REAL EXCEPTION, so it matches only network-specific wording. A
// `TypeError: Failed to fetch` is transport; a `TypeError: undefined is not an object (evaluating
// 'x.y')` is a product defect and stays one. The partition is REPORTED as a note either way —
// exactly as `gotoOrRetryTransport` names its blip — so the rate stays visible across runs instead
// of disappearing.
const TRANSPORT_PAGE_ERROR_SHAPES = [
  /Fetch API cannot load [\s\S]*due to access control checks/i, // WebKit's wording for a dead fetch
  /\bLoad failed\b/,                                            // WebKit's generic fetch failure
  /The network connection was lost/i,                           // WebKit/CFNetwork
  /Failed to fetch/i,                                           // Blink
  /NetworkError when attempting to fetch resource/i,            // Gecko
  /\bERR_[A-Z_]+\b/,                                            // net:: codes, wherever they surface
];

/** Is this page error a NETWORK failure rather than an application exception? */
export const isTransportPageError = (err) => {
  const s = String(err && err.message ? err.message : err);
  return isTransportError(s) || TRANSPORT_PAGE_ERROR_SHAPES.some((re) => re.test(s));
};

/**
 * The page errors that are actually the APP's, with the network-class ones split off and named.
 *
 * Journeys call this instead of reading `bag.pageErrors` directly. Nothing is hidden: a transport
 * page error is announced as a note carrying its full text, so a genuine outage still reads as one
 * (every journey noting the same failure) and a one-off runner blip stops being filed as a defect.
 */
/**
 * Poll `readCount` until it STOPS GROWING, from a non-zero start.
 *
 * A fixed sleep is never a correctness oracle (PART 11.2), and this is the measured proof: one press
 * of «بحث» fires SIX `location_search_candidates_ar` calls (§11.3), and a WebKit mobile run on
 * 2026-09-03 captured only ONE inside a 10s window. The comparison then read `double (6) > single
 * (1)` and filed «double-click fired the search twice» against a correct app. The dangerous
 * direction is the mirror: a short capture on the DOUBLE side compares as `double <= single` and
 * PASSES, hiding the exact regression the journey exists to catch.
 *
 * A zero count is never "settled" — the app types an intro before the first request, so an early
 * zero means "not started", not "fired nothing" (PART 11.2 rule 1). `settled:false` is returned
 * rather than a number the caller might compare, because an unfinished count is not a measurement.
 *
 * `sleepFn` is injectable so `scripts/verify-journey-settled-count.ts` can EXECUTE this instead of
 * grepping it, without spending real seconds.
 */
export async function settledCount(readCount, { budgetMs = 45_000, stableMs = 5_000, minObserveMs = 12_000, sleepFn = sleep, now = () => Date.now() } = {}) {
  const started = now();
  const until = started + budgetMs;
  let last = -1, stableSince = started;
  while (now() < until) {
    const n = readCount();
    if (n !== last) { last = n; stableSince = now(); }
    // THE CONTRACT: settled = no new call for `stableMs`. That constant must exceed the plausible
    // gap BETWEEN arrivals, or a slow trickle settles early on a partial count — the original bug
    // wearing a confident label. The six calls from one press are fired concurrently and arrive
    // within jitter of each other, not seconds apart, so 5s is comfortably above the real gap while
    // staying well inside the 45s budget. A trickle slower than `stableMs` is outside this
    // function's contract by construction; `minObserveMs` is the floor that makes "stopped growing" mean it. Stability ALONE settles too
    // early when calls TRICKLE: six arriving 6s apart look stable for 6s between each, so a 3s
    // window would return `{n: 1, settled: true}` — the original partial capture wearing a
    // confident label, which is worse than the fixed sleep it replaced. Requiring a minimum
    // observation before any verdict removes that, and costs a few seconds per measurement.
    else if (n > 0 && now() - stableSince >= stableMs && now() - started >= minObserveMs) return { n, settled: true };
    await sleepFn(250);
  }
  return { n: readCount(), settled: false };
}

export function appPageErrors(bag, journey) {
  const app = [], transport = [];
  for (const e of bag.pageErrors) (isTransportPageError(e) ? transport : app).push(e);
  if (transport.length) {
    note(`${journey}: ${transport.length} TRANSPORT-class page error(s) — a dead request, not an app `
      + `exception, so NOT counted as a product defect (see harness.mjs): ${transport.join(' | ').slice(0, 300)}`);
  }
  return app;
}
export async function gotoOrRetryTransport(page, url, { timeout = 90_000 } = {}) {
  try {
    return await page.goto(url, { waitUntil: 'load', timeout });
  } catch (e) {
    if (!isTransportError(e)) throw e;              // a real app/navigation failure — unchanged
    const first = String(e).split('\n')[0];
    const res = await page.goto(url, { waitUntil: 'load', timeout });
    note(`TRANSPORT BLIP (not a product defect): the opening navigation to ${url} failed with «${first}» `
      + `and succeeded on one immediate retry. Counted as neither pass nor defect — see harness.mjs.`);
    return res;
  }
}

export async function openMobileSidebar(page, { guestOk = false } = {}) {
  const isOpen = () => sidebarIsOpen(page, { guestOk });
  if (await isOpen()) return true;
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
    if (await isOpen()) return true;
  }
  return false;
}
