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
 *  IT IS NOT SUFFICIENT, AND SAYING SO IS THE POINT. Against a local `dist/` every SIDEBAR journey
 *  still skips — «row ⋯ menu would not open» — and that is measured on the EXISTING, known-good
 *  `sidebar-row-actions` as well as on a new one (2/2 each, 2026-09-04), while both pass against
 *  production. Same journeys, same harness, different target: the local static export is the
 *  differing variable, not the journey and not the app (PART 9.1's inverse rule — a failure is
 *  closed as harness/target only on positive proof, and this is that proof).
 *
 *  CONSEQUENCE FOR A `src/` FIX: local-build verification of anything behind the signed-in sidebar
 *  is NOT available in this container today. Such a fix is proved by the production journey AFTER
 *  deploy (PART 7), and a run must not report a local green as if it were that. Making the local
 *  export usable for signed-in journeys is unfinished work, recorded here rather than rediscovered. */
function launchOpts(engine) {
  const proxy = process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } }
    : {};
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
