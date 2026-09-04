// Permanent guard: the built web bundle must actually RUN. Drives the real primary journey
// (تصفية → «بحث» → results, then hard-refresh → FILTER HOME with zero search requests) in a headless
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
// JOURNEY I FLAKE — DIAGNOSED AND FIXED 2026-08-26. «[I] Advanced Filter opens on this large
// multi-district scope» and the narrowing check that depends on it were flipping fail->pass on
// IDENTICAL code (twice on one PR branch, with main green on the same base). Recorded so nobody
// re-derives it:
//
//   IT WAS THE HARNESS, NOT THE PRODUCT. Evidence, heaviest first:
//     * This journey's PRODUCT assertions — double-tap-never-re-presents and
//       count-never-goes-back-up, the whole reason it exists — have NEVER failed in the recorded run
//       history. Only the OPEN step and its dependent narrowing check ever did.
//     * commitGuidedStep's ageFlowCommittingRef guard is correct by construction: synchronous
//       check-and-set, held across `await presentGuided(...)` INSIDE the try, released in finally —
//       so the duplicate-tap window it exists to close really is closed.
//     * Failures cluster ACROSS BRANCHES, not within one: four runs on four different branches
//       failed inside 30 minutes on 2026-08-24 (13:06-13:36). Shared backend load, not shared code.
//     * The open step's budget was ~14.4s, of which only the first ~2.4s was a real attempt — the
//       CTA renders behind `!ageFlow` so the first tap unmounts it, and retries 2..6 threw «control
//       not found» into a swallowed catch while still costing 2.4s each.
//
//   MEASURED against this journey's exact scope (Buy · annual · الرياض · 6 districts · فيلا):
//     one af_eligible_count        =   920 ms   (vs the 338 ms/search baseline in §40.1)
//     the five Villa/Buy questions = 3,433 ms   server-side only, quiet DB, before HTTP/render/load
//   docs/ops/SEARCH_MATCH_QA_ENGINEER.md §40.1 puts the concurrency knee at 3, so rankQuestions'
//   five concurrent per-question counts are already past it and degrade further when CI is busy.
//
//   RE-MEASURING THIS LATER: there is no workflow_dispatch on this workflow, so the only ways to
//   run one commit N times are pushing (changes the thing under test) or `gh run rerun` — which
//   OVERWRITES the previous conclusion, so each measurement erases the one before it. That is why
//   two Journey I failures on PR #1129 left no trace in the run history. Adding workflow_dispatch is
//   worth doing, but it is deliberately NOT bundled here: it cannot be exercised until it is on the
//   default branch, so it would ship unverified inside a fix whose whole point is verifiability.
//
//   THE FIX WAS NOT A BIGGER TIMEOUT: tap once instead of six, poll on the same 45s budget the count
//   waits already use, print WHY on failure, and stop reporting the dependent narrowing check as a
//   second independent failure. IF IT EVER FAILS AGAIN, READ THE DETAIL LINE FIRST:
//     cta-returned=true       -> startAgeFlow ran and DECLINED (short plan). Ambiguous by design in
//                                the product today: either the scope really certifies too few
//                                questions, OR every per-question count probe timed out (4s each)
//                                and the empty result was read as a data verdict. See below.
//     cta-returned=false      -> the open never landed at all
//     final=null              -> the count never settled: load/harness symptom
//     final>=start            -> a REAL narrowing regression
//     a double-tap assertion  -> a REAL product regression in the reentrancy guard
//
//   KNOWN PRODUCT WEAKNESS THIS INSTRUMENTATION EXPOSED (2026-08-26, not fixed here): startAgeFlow
//   cannot tell "this scope has nothing worth asking" from "my probes failed". rankQuestions gives
//   each question one count RPC with a 4s timeout; a timed-out probe yields no options, the question
//   is dropped, and if every question drops the plan is empty and AF silently declines to open. A
//   transient load blip is therefore rendered to the user as a settled verdict about their search —
//   the same shape of error the repo forbids elsewhere under SOURCE-IS-TRUTH (a failed probe is not
//   a negative result). Fixing it changes when AF opens, so it is an owner-facing product decision
//   rather than something to smuggle into a test-harness PR.
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
// The signed-out SIGN-IN CARD (owner 2026-08-29) floats at the side of the filter home for a
// fresh logged-out load. It never blocks the journeys (no scrim, side slot, and it retires on the
// journey's own first send) — but its phone form contains a «متابعة» button and its X shares the
// auth-popup-close testid, so the journey closes it up front the way a real guest might, keeping
// text-targeted taps unambiguous. The dismissal is in-memory: it survives client-side navigation
// but a RELOAD brings the card back (by design) — safe here, because after any reload the next
// journey's own send re-dismisses it before any «متابعة» tap happens.
const dismissAuthPopup = async (windowMs = 4000) => {
  const until = Date.now() + windowMs;
  while (Date.now() < until && !(await page.$('[data-testid="auth-popup-close"]'))) {
    await page.waitForTimeout(250);
  }
  const close = await page.$('[data-testid="auth-popup-close"]');
  if (!close) return; // no card (dismissed already, signed in, or narrow viewport) — nothing to do
  await close.click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="signin-card"]'), { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
};
// For ASYNC-rendered suggestion rows only (run 32681927077: «حي النرجس» rendered after the fixed
// 2200ms wait on a loaded runner and the strict tap threw). Polls for the row, then taps. Static
// controls keep the strict tap — a missing static control is a real defect, not a render race.
const tapWhenRendered = async (txt, timeoutMs = 8000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await page.evaluate(CLICK_LEAF, txt)) return tap(txt);
    await page.waitForTimeout(300);
  }
  throw new Error(`control never rendered: ${txt}`);
};
// VERIFIED select (2026-08-24): type → tap the suggestion → CONFIRM the app registered it, retrying
// the whole gesture when it did not. On a loaded CI runner the suggestion row can render after the
// tap fires; the tap then hits nothing, the city stays unresolved, and «بحث» rightly refuses with
// «الرجاء اختيار مدينة من القائمة» — which surfaced as journey [H] "count=null" three runs straight
// while the app itself was fine (run 32679574637's page dump). `selected-city-visual` renders iff
// `citySelected` (src/app/index.tsx), so it is the app's OWN confirmation, not a DOM guess.
const pickCity = async (name) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.click('input >> nth=0');
    await page.fill('input >> nth=0', '');
    await page.type('input >> nth=0', name, { delay: 60 });
    await tapWhenRendered(name).catch(() => {}); // confirmation below decides; a miss just retries

    const took = await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 4000 }).catch(() => null);
    if (took) return;
  }
  throw new Error(`pickCity(${name}): the app never confirmed the selection after 3 attempts`);
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
// Input snapshots deliberately EXCLUDE the sign-in card's own phone field (owner 2026-08-29): the
// card is a floating auth overlay, not filter state — and it legitimately disappears when a
// journey's own send dismisses it, which would otherwise shift these snapshots mid-journey
// (run 33224*: [E]/[F] "restores EXACTLY" failed on exactly that).
const inputs = () => page.evaluate(() => Array.from(document.querySelectorAll('input')).filter((e) => !e.closest('[data-testid="signin-card"]')).map((e) => e.value));
// Expo Router's Stack keeps a replaced screen's prior instance mounted-but-hidden rather than fully
// unmounting it (confirmed pre-existing: the plain «تصفية» tab click — no Stop involved — produces
// the identical doubled, half-hidden input set). Harmless and invisible to a real user; scoping to
// `offsetParent !== null` reads exactly what the user actually sees, same as a human tester would.
const visibleInputs = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('input')).filter((e) => e.offsetParent !== null && !e.closest('[data-testid="signin-card"]')).map((e) => e.value));

try {
  // ---- Journey A: the primary CTA must produce results, not a blank page. ----
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  check('home renders', (await body()).includes('تصفية'));
  await dismissAuthPopup(); // a real guest closes the sign-in prompt before searching

  // Buy+Rent combined multi-select (owner 2026-08-20): شراء/إيجار are now two independent toggles,
  // mirroring سنوي/شهري exactly — a single tap on the OFF button ADDS it (→ both), it never swaps.
  // Home starts on شراء (HOME_DEFAULT_QUERY), so reaching إيجار-ONLY needs the same two-tap sequence
  // reaching a single period already requires: tap إيجار (→ both), tap شراء (turns Buy off → Rent-only).
  await tap('إيجار');
  await tap('شراء');
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
  // The last MAIN property-search RPC body seen. This is the Stop/resubmit oracle (2026-08-23, see
  // the [E] comment below): identical QUERY, not identical live count.
  //
  // MAIN means the body carries p_per_platform — sent by exactly ONE call site in the app, the
  // results fetch in src/data/remote.ts fetchListings (always present, always null). Without that
  // gate the listener records ANY search-RPC body, and the district-marking count calls
  // (fetchDistrictEligibleCounts: p_limit:1, per-district p_districts override, no p_per_platform)
  // that fire around the results screen can land AFTER the main request and poison the capture:
  // CI run 32730714706 (2026-08-24) recorded a p_limit:1 marking probe for حي العقيق — a district
  // the user never picked, straight from the trending list — as the [E] baseline, failing all
  // three E/F/H signature checks at once while the app behaved perfectly.
  let lastSearchBody = null;
  const countSearch = (u) => /\/rest\/v1\/rpc\/(location_search_candidates_ar|search_listings)/.test(u)
    || /\/functions\/v1\/agent/.test(u);
  const isSearchRpc = (u) => /\/rest\/v1\/rpc\/(location_search_candidates_ar|search_listings)/.test(u);
  page.on('request', (r) => {
    if (countSearch(r.url())) searchCalls++;
    if (isSearchRpc(r.url()) && r.method() === 'POST'
      && (r.postData() ?? '').includes('"p_per_platform"')) lastSearchBody = r.postData();
  });
  // Key-order-insensitive signature of a search request body, so an incidental serializer reorder
  // can never masquerade as a query change. A body that does not parse is compared verbatim.
  const reqSig = (body) => {
    if (body == null) return null;
    try { const o = JSON.parse(body); return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); }
    catch { return body; }
  };

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  const afterRefresh = await body();

  check('a refresh issues ZERO search/AI requests', searchCalls === 0,
    `${searchCalls} search/AI request(s) fired on reload — a refresh must never count as a user search`);
  check('a refresh does not re-render the previous results', !/لقينا|ما لقينا/.test(afterRefresh));
  // Owner rule 2 (2026-08-16, same day as rule 1): "when i refresh takes me to the filter page …
  // not this here" — an emptied AI chat is a dead end, so the refresh lands on the Filter home.
  check('a refresh lands on the FILTER HOME (owner 2026-08-16 rule 2)',
    !page.url().includes('/agent'), `url = ${page.url()}`);
  check('the filter home actually rendered (city field present, not a blank bounce)',
    /أي مدينة؟/.test(afterRefresh));
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
  check('[mobile] a refresh lands on the FILTER HOME', !page.url().includes('/agent'), `url = ${page.url()}`);
  check('[mobile] the consumed URL carries no executable search param', !/[?&](filter|seed)=/.test(page.url()),
    `url = ${page.url().slice(0, 140)}`);

  // ---- Journeys E-G: FILTER → SEARCH → STOP → SAME FILTER (owner 2026-08-18). ----
  // Owner's own worked example: إيجار + سنوي + الرياض + حي النرجس + شقة + 3 غرف + 80-150 م².
  // The strongest proof that "restore the exact Filter state" actually held is not reading input
  // values back (fragile against markup changes) — it's RESUBMITTING «بحث» untouched after Stop and
  // getting the EXACT SAME landed count as an uninterrupted run of the identical filter. If Stop had
  // silently dropped the district, widened the type, or reset the bedroom count, the resubmitted
  // count would differ. That is what E/F assert.
  const stopSel = '[aria-label="إيقاف"]';
  const tapStop = async () => { await page.click(stopSel, { timeout: 5000 }); await page.waitForTimeout(600); };
  const landedCount = async () => {
    const m = [...(await body()).matchAll(/لقينا ([\d,٬،]+) إعلان/g)];
    return m.length ? parseInt(m[m.length - 1][1].replace(/[^\d]/g, ''), 10) : null;
  };
  // Poll for the count directly instead of `waitForBody(RESULT_COUNT,...)` + an immediate
  // `landedCount()` read. The result intro line types itself out character-by-character, so the
  // loose RESULT_COUNT text ("لقينا") can be on screen for a beat before its own trailing number
  // finishes typing — reading the strict count the instant the loose text appears is a race
  // (CI's slower main-thread scheduling loses it far more often than a fast local run does, which is
  // why this passed locally every time yet failed once in CI: bug-hunt 2026-08-21, [E] baseline
  // count=null while every Stop-then-resubmit check — reading the SAME text later — got 320). Poll
  // for the digit-bearing pattern itself so "landed" and "readable" are the same instant.
  const waitForCount = async (timeoutMs) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const c = await landedCount();
      if (c !== null) return c;
      await page.waitForTimeout(500);
    }
    return null;
  };
  // Submit that CONFIRMS a search request left the app, re-tapping when one did not (2026-08-24).
  // Four CI runs failed [H mobile] with a tap that fired nothing while the same build+script+backend
  // passed locally end to end: after Stop's restore the form REHYDRATES citySelected in an effect
  // (src/app/index.tsx ~426), and on a loaded runner a fast follow-up tap lands inside that gap —
  // the app correctly refuses to search with an unresolved city, exactly once. A real user's second
  // tap succeeds; so does this one. A genuinely wedged app fires nothing in 3 attempts and still
  // fails — and every capture window starts null, so the sig oracle only ever sees THIS submit.
  const submitSearch = async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      lastSearchBody = null;
      await tap('بحث');
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        if (lastSearchBody != null) return;
        await page.waitForTimeout(250);
      }
    }
    // leave lastSearchBody null — the request-sig check fails and says exactly why
  };
  const fillOwnerExample = async () => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    // Same two-tap deal sequence as journey A above (Buy+Rent combined multi-select, 2026-08-20).
    await tap('إيجار'); await tap('شراء'); await tap('سنوي');
    await pickCity('الرياض');
    await page.click('input >> nth=1');
    await page.type('input >> nth=1', 'النرجس', { delay: 60 });
    await tapWhenRendered('حي النرجس');
    await tap('الشقق والسكن المشترك'); await tap('شقة');
    await tap('3');
    await page.fill('input >> nth=2', '80');
    await page.fill('input >> nth=3', '150');
    await page.waitForTimeout(400);
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await fillOwnerExample();
  const preStopInputs = await visibleInputs();
  await submitSearch(); // each capture window starts empty — a check must never read a leftover body
  const baselineCount = await waitForCount(45000);
  check('[E] baseline (uninterrupted) owner-example search lands with a real count', Number.isFinite(baselineCount), `count=${baselineCount}`);
  const baselineReq = lastSearchBody;
  check('[E] baseline search request was captured (the oracle below depends on it)', baselineReq != null);

  // ---- E: rapid Stop — pressed the instant the search starts. ----
  await fillOwnerExample();
  await tap('بحث');
  const stopVisible = await page.waitForSelector(stopSel, { timeout: 5000 }).catch(() => null);
  check('[E] Stop control appears while the Filter search is running', !!stopVisible);
  await tapStop();
  check('[E] rapid-Stop lands back on the Filter home', page.url() === `${BASE}/` || page.url() === BASE, `url=${page.url()}`);
  check('[E] rapid-Stop shows no results/partial text', !RESULT_COUNT.test(await body()));
  const postRapidInputs = await visibleInputs();
  check('[E] rapid-Stop restores city/district/area EXACTLY', JSON.stringify(postRapidInputs) === JSON.stringify(preStopInputs),
    `pre=${JSON.stringify(preStopInputs)} post=${JSON.stringify(postRapidInputs)}`);
  await submitSearch(); // the sig below must be THIS resubmit's request, never [E]-baseline leftovers
  const rapidResubmitCount = await waitForCount(90000);
  // ORACLE CHANGE (2026-08-23). This used to assert resubmitCount === baselineCount — but both are
  // LIVE production reads taken minutes apart, and this suite runs against real prod on a schedule.
  // Any run straddling a data-refresh tick (MV refresh at :00, sync_search_listings_ar at :14) sees
  // the inventory legitimately move and fails with a huge honest delta (observed 2026-08-23:
  // baseline=347 resubmit=1940 — on main itself, commit 6146bc0, alongside two innocent PR heads).
  // What Stop must actually guarantee is that the QUERY survived intact — so the oracle is the
  // serialized search request, compared key-order-insensitively. The count stays only as a
  // liveness check: the resubmit must land real results, whatever today's inventory is.
  check('[E] resubmitting untouched after rapid-Stop fires the EXACT SAME serialized search request as the uninterrupted baseline',
    reqSig(lastSearchBody) != null && reqSig(lastSearchBody) === reqSig(baselineReq),
    `baselineReq=${baselineReq} resubmitReq=${lastSearchBody}`);
  check('[E] the rapid-Stop resubmit still lands a real result count', Number.isFinite(rapidResubmitCount), `count=${rapidResubmitCount}`);

  // ---- F: Stop pressed mid-flight (network artificially slowed), and the late response — which
  // resolves AFTER the user is already back on Filter — must never repopulate results or write history.
  let inFlightSeen = false;
  const delayRoute = async (route) => {
    inFlightSeen = true;
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  };
  await page.route('**/rest/v1/rpc/location_search_candidates_ar', delayRoute);
  await fillOwnerExample();
  await tap('بحث');
  await page.waitForTimeout(1500); // land inside the artificial delay window — genuinely mid-flight
  check('[F] the slowed request is confirmed in flight before Stop is pressed', inFlightSeen);
  await tapStop();
  check('[F] mid-flight Stop lands back on the Filter home immediately (does not wait out the slow request)',
    page.url() === `${BASE}/` || page.url() === BASE, `url=${page.url()}`);
  const postMidInputs = await visibleInputs();
  check('[F] mid-flight Stop restores city/district/area EXACTLY', JSON.stringify(postMidInputs) === JSON.stringify(preStopInputs));
  // Let the slow response actually land now, well after Stop + navigation.
  await page.waitForTimeout(6000);
  check('[F] the late response (resolved after Stop) never populated results on the Filter screen',
    !RESULT_COUNT.test(await body()));
  check('[F] still on the Filter home after the late response lands (no surprise navigation into results)',
    page.url() === `${BASE}/` || page.url() === BASE, `url=${page.url()}`);
  await page.unroute('**/rest/v1/rpc/location_search_candidates_ar', delayRoute);
  await submitSearch();
  const midResubmitCount = await waitForCount(90000);
  check('[F] resubmitting untouched after a mid-flight Stop still fires the EXACT SAME serialized search request',
    reqSig(lastSearchBody) != null && reqSig(lastSearchBody) === reqSig(baselineReq),
    `baselineReq=${baselineReq} resubmitReq=${lastSearchBody}`);
  check('[F] the mid-flight-Stop resubmit still lands a real result count', Number.isFinite(midResubmitCount), `count=${midResubmitCount}`);

  // ---- G: a CHAT-originated Stop must NOT navigate home — origin-tracking must not over-apply. ----
  // ZERO PAID AI (owner rule 2026-08-29: CI must not call paid DeepSeek unless the test genuinely
  // requires a real model). This journey asserts CLIENT origin-tracking — that pressing Stop on a
  // chat turn keeps you on /agent — which has nothing to do with what the model replies. It used to
  // run a real paid classification on EVERY pull request, the single largest source of CI spend.
  //
  // The stub also makes the test BETTER: a deliberately slow response guarantees the Stop control is
  // on screen, instead of racing live model latency (~1.8s) and flaking when the model is quick.
  await page.route('**/functions/v1/agent', async (route) => {
    await new Promise((r) => setTimeout(r, 6000));   // hold the turn open so Stop is visible
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ kind: 'message', reply: 'ابحث لك الحين.' }),
    });
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await tap('الوكيل الذكي');
  await page.waitForTimeout(2000);
  await page.click('textarea');
  await page.type('textarea', 'ابغى شقة للايجار في جدة', { delay: 30 });
  await page.keyboard.press('Enter');
  const chatStopVisible = await page.waitForSelector(stopSel, { timeout: 8000 }).catch(() => null);
  check('[G] Stop control appears for a chat-originated turn too', !!chatStopVisible);
  if (chatStopVisible) {
    await tapStop();
    check('[G] chat-originated Stop stays on /agent (origin tracking does not over-apply to chat turns)',
      page.url().includes('/agent'), `url=${page.url()}`);
    check('[G] chat-originated Stop still shows the existing stop-in-place acknowledgement',
      /وقفت البحث/.test(await body()));
  }
  await page.unroute('**/functions/v1/agent');

  // ---- H: same rapid-Stop + exact-restore proof on MOBILE. ----
  await page.setViewportSize({ width: 390, height: 844 });
  await fillOwnerExample();
  const preStopInputsMobile = await visibleInputs();
  await tap('بحث');
  const mobStopVisible = await page.waitForSelector(stopSel, { timeout: 5000 }).catch(() => null);
  check('[H mobile] Stop control appears while the Filter search is running', !!mobStopVisible);
  await tapStop();
  check('[H mobile] rapid-Stop lands back on the Filter home', page.url() === `${BASE}/` || page.url() === BASE, `url=${page.url()}`);
  check('[H mobile] rapid-Stop shows no results/partial text', !RESULT_COUNT.test(await body()));
  const postMobileInputs = await visibleInputs();
  check('[H mobile] rapid-Stop restores city/district/area EXACTLY',
    JSON.stringify(postMobileInputs) === JSON.stringify(preStopInputsMobile));
  await submitSearch(); // never inherit [F]/[G] traffic — this window proves the MOBILE resubmit
  const mobResubmitCount = await waitForCount(90000);
  check('[H mobile] resubmitting untouched after rapid-Stop fires the EXACT SAME serialized search request as baseline',
    reqSig(lastSearchBody) != null && reqSig(lastSearchBody) === reqSig(baselineReq),
    `baselineReq=${baselineReq} resubmitReq=${lastSearchBody}`);
  // Failed twice in CI (2026-08-24) while the request fired+matched, [E] desktop landed, a direct
  // prod repro rendered in 5s, and [I] read a fresh count seconds later — so on a null read, dump
  // the page state: the next failure must explain itself instead of costing another guessing round.
  check('[H mobile] the mobile resubmit still lands a real result count', Number.isFinite(mobResubmitCount),
    `count=${mobResubmitCount} url=${page.url()} body=${(await body()).slice(0, 400).replace(/\n/g, ' | ')}`);

  // ---- Journey I: Advanced Filter reentrancy — a rapid double-tap on «متابعة»/confirm must never
  // downgrade or lose an already-recorded answer (bug-hunt 2026-08-23, fixed in commitGuidedStep's
  // ageFlowCommittingRef guard). presentGuided's re-rank is a real network round trip before the next
  // question replaces the current one on screen; a second tap landing in that gap used to be
  // processed as a second answer to the SAME step, and a single-select re-click reads as "clear the
  // selection" — silently downgrading a real answer to unanswered and re-showing the same question.
  // This journey deliberately fires that double-tap on several questions and asserts none of it ever
  // happened: no question is ever re-presented, the live count never goes back UP after an answer,
  // and the interview lands on a genuinely narrowed set — never back at the unfiltered start count.
  // Expo Router's Stack keeps a replaced screen's prior instance mounted-but-hidden rather than
  // fully unmounting it (the SAME pre-existing behaviour `visibleInputs` above already works
  // around) — a stale af-card can briefly linger alongside the fresh one. `document.querySelector`
  // returns the FIRST match in document order, which is not guaranteed to be the visible one.
  // Scope every AF read to `offsetParent !== null`, exactly like `visibleInputs`.
  const afPresent = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="af-card"]')).some((e) => e.offsetParent !== null));
  const afSnapshot = () => page.evaluate(() => {
    const visible = (sel) => Array.from(document.querySelectorAll(sel)).find((e) => e.offsetParent !== null);
    const title = visible('[data-testid="af-question-title"]')?.innerText?.trim() ?? null;
    const options = Array.from(document.querySelectorAll('[data-testid^="af-option-"]')).filter((e) => e.offsetParent !== null).map((e) => e.getAttribute('data-testid'));
    const countChip = visible('[data-testid="af-count-chip"]')?.innerText?.trim() ?? null;
    return { title, options, count: countChip ? parseInt(countChip.replace(/[^\d]/g, ''), 10) : null };
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await tap('إيجار'); await tap('شراء'); await tap('سنوي');
  await pickCity('الرياض');
  for (const name of ['النرجس', 'الملقا', 'الياسمين', 'الربيع', 'القيروان', 'العارض']) {
    await page.click('input >> nth=1');
    await page.type('input >> nth=1', name, { delay: 40 });
    await page.waitForTimeout(1600);
    await tap(`حي ${name}`);
    await page.waitForTimeout(300);
  }
  await tap('الفلل والبيوت'); await tap('فيلا');
  await tap('بحث');
  const reentrancyStart = await waitForCount(45000);
  check('[I] reentrancy-journey scope lands with a real start count', Number.isFinite(reentrancyStart), `start=${reentrancyStart}`);

  // FLAKE FIX (2026-08-26): this used to tap the CTA up to SIX times, waiting 1200ms after each —
  // a ~14.4s budget for a network-bound open. Two things were wrong with it, and neither was a
  // timeout that merely needed raising:
  //
  //   1. THE RETRIES WERE NO-OPS THAT ATE THE BUDGET. The CTA renders behind `!ageFlow`, so the
  //      FIRST tap unmounts it; taps 2..6 threw «control not found» straight into `.catch(() => {})`
  //      while still burning their 2.4s each. Only the first ~2.4s was ever a real attempt.
  //   2. WHAT IT WAS WAITING FOR COSTS MORE THAN THAT. Opening AF runs rankQuestions(), which fires
  //      ONE live count RPC per eligible question, concurrently. Measured 2026-08-26 against this
  //      journey's exact scope (Buy · annual · الرياض · 6 districts · فيلا): 920 ms for a single
  //      count, and 3,433 ms for the five certified Villa/Buy questions — server-side only, on a
  //      quiet database, before HTTP, PostgREST, the client's own render, or any concurrent load.
  //      docs/ops/SEARCH_MATCH_QA_ENGINEER.md §40.1 puts the baseline at 338 ms/search with a
  //      concurrency knee of 3, so five concurrent counts are already past the knee and degrade
  //      further under CI load. ~4x headroom on an idle backend, none on a busy one.
  //
  // Failures duly clustered ACROSS BRANCHES rather than tracking any one branch's code: four runs on
  // four different branches failed inside 30 minutes on 2026-08-24 (13:06-13:36). The product's own
  // reentrancy assertions below (double-tap, count-never-increases) have NEVER failed in the
  // recorded history — only this open step and the narrowing check that DEPENDS on it. That is what
  // makes this a harness bug and not non-determinism in commitGuidedStep's ageFlowCommittingRef.
  //
  // So: tap ONCE, then poll on the same 45s budget the count waits already use, and say WHY on
  // failure instead of printing a bare `false` (the [H mobile] precedent).
  await tap('خلّنا نحدد الطلب أكثر').catch(() => {});
  let afOpened = false;
  const afOpenUntil = Date.now() + 45000;
  while (Date.now() < afOpenUntil) {
    afOpened = await afPresent();
    if (afOpened) break;
    await page.waitForTimeout(500);
  }
  if (!afOpened) {
    // Distinguish the two ways this legitimately ends up false, so the next failure explains itself:
    // the CTA coming BACK means AF opened and closed again (fell back to refine), which is a real
    // product signal; the CTA still absent means the open is simply still in flight.
    const ctaBack = await page.evaluate(() =>
      Array.from(document.querySelectorAll('div,span,button,a,[role="button"]'))
        .some((e) => (e.innerText || '').trim().includes('خلّنا نحدد الطلب أكثر') && e.getBoundingClientRect().width > 0));
    // UNKNOWN IS NOT A DEFECT (owner 2026-08-26, PR #1152). AF now distinguishes "the sources say
    // there is nothing useful to ask" from "the probes never answered". On the SECOND verdict the
    // product deliberately declines to open and offers NOTHING in place of AF — that is the correct,
    // specified behaviour, so failing the journey for it would flag a fix as a defect.
    // The two are told apart by what is on screen: 'known-empty' hands the user the legacy refine
    // chips, 'unknown' leaves the CTA alone and adds nothing. A genuine "AF stopped opening"
    // regression still FAILS here, because that path shows the chips.
    const refineChipsShown = await page.evaluate(() => {
      const t = document.body.innerText;
      return ['أي حي تفضّل', 'كم ميزانيتك', 'كم غرفة'].some((c) => t.includes(c));
    });
    if (ctaBack && !refineChipsShown) {
      console.log('SKIP  [I] Advanced Filter opens on this large multi-district scope '
        + '— AF declined on an UNDETERMINED probe batch (no refine chips offered), which is the '
        + 'specified behaviour under «UNKNOWN must never become NO». This is an environment/latency '
        + 'symptom, not a product defect: the per-question count probes did not answer within 4s. '
        + 'A REAL regression would instead show the refine chips (a probe-backed "nothing to narrow").');
    } else
    check('[I] Advanced Filter opens on this large multi-district scope', false,
      `af-card never appeared within 45s. cta-returned=${ctaBack}\n`
      + `        cta-returned=true  => startAgeFlow RAN and DECLINED: its ranked plan came back shorter\n`
      + `                              than MIN_USEFUL_QUESTIONS_TO_SHOW, so it setAgeFlow(null) and fell\n`
      + `                              back to refine. That has TWO causes and they look identical here:\n`
      + `                                (i)  the scope genuinely certifies too few useful questions, or\n`
      + `                                (ii) the per-question count probes TIMED OUT (4s each,\n`
      + `                                     AGE_COUNT_TIMEOUT_MS) so every question lost its options.\n`
      + `                              (ii) is a load artefact being rendered as a data verdict — see the\n`
      + `                              JOURNEY I note in this file's header before calling it a regression.\n`
      + `        cta-returned=false => the open never landed at all (still in flight / crashed).\n`
      + `        url=${page.url()} body=${(await body()).slice(0, 300).replace(/\n/g, ' | ')}`);
  } else {
    check('[I] Advanced Filter opens on this large multi-district scope', true);
  }
  // `afOpened` is the interview LOOP's own variable below and flips to false the moment the card
  // closes — which is the normal, successful end of the interview. The gates further down must ask
  // "did it ever open?", so latch that here rather than re-reading a variable that means something
  // else by then.
  const afEverOpened = afOpened;

  const seenTitles = [];
  let doubleProcessed = 0, countIncreased = 0, prevCount = reentrancyStart;
  let guard = 0;
  while (afOpened && guard < 10) {
    guard++;
    let snap = await afSnapshot();
    for (let r = 0; r < 10 && !snap.title; r++) { await page.waitForTimeout(800); snap = await afSnapshot(); }
    if (!snap.title || !snap.options.length) break;
    if (seenTitles.includes(snap.title)) doubleProcessed++;
    seenTitles.push(snap.title);
    if (snap.count !== null && snap.count > prevCount) countIncreased++;
    await page.waitForTimeout(1200); // let the just-rendered row finish mounting before targeting it
    // Pick the option covering the LARGEST slice (a real, meaningfully-narrowing answer).
    const opt = snap.options[0];
    const askedTitle = snap.title;
    await page.locator(`[data-testid="${opt}"]:visible`).first().click({ timeout: 10000 });
    await page.waitForTimeout(300);
    // THE double-tap: fire the confirm click TWICE back-to-back, no wait in between — exactly the
    // race window commitGuidedStep's reentrancy guard exists to close.
    const confirmSel = page.locator('[data-testid="af-confirm"]:visible').first();
    await Promise.allSettled([confirmSel.click({ timeout: 8000 }), confirmSel.click({ timeout: 8000 })]);
    // af-card stays MOUNTED continuously between questions (only unmounts once the mining
    // transition starts) — so "is af-card present" is a no-op wait condition mid-interview. Poll for
    // the actual signal: either the QUESTION TITLE changing (the next card really replaced this one)
    // or the card disappearing (interview finished) or the real results text landing. Racing this
    // read against the still-in-flight rankQuestions() call is the same class of bug PR#842 fixed
    // for Stop/resubmit reads — wait for the real signal, not a fixed delay.
    let waited = 0;
    // NOTE: RESULT_COUNT (`لقينا|ما لقينا`) is NOT a valid exit signal here — the results screen
    // stays mounted (dimmed) BEHIND this overlay the whole time, so that text is on the page from
    // the very first check regardless of whether the interview has actually advanced or finished.
    while (waited < 45000) {
      await page.waitForTimeout(500); waited += 500;
      const stillThere = await afPresent();
      if (!stillThere) break; // interview genuinely finished (mining phase unmounts af-card)
      const nowTitle = (await afSnapshot()).title;
      if (nowTitle && nowTitle !== askedTitle) break; // the next question really replaced this one
    }
    afOpened = await afPresent();
    if (afOpened) {
      const s2 = await afSnapshot();
      if (s2.count !== null) { if (s2.count > prevCount) countIncreased++; prevCount = s2.count; }
    }
  }
  const reentrancyFinalOpen = await afPresent();
  // af-card disappearing does NOT mean the new search has landed — finishGuided's mining transition
  // has its own guaranteed minimum beat (>=1.4s hold + 1.1s fade, src/app/agent.tsx finishGuided)
  // during which the OLD (pre-AF) results are still what's on screen underneath. Reading the count
  // the instant af-card vanishes catches that stale text — the same class of race PR#842 fixed for
  // Stop/resubmit. Give the mining beat's own floor time to elapse, then require the count to be
  // STABLE across two reads a second apart before trusting it.
  let reentrancyFinal = null;
  if (!reentrancyFinalOpen) {
    await page.waitForTimeout(3000);
    let stableSince = null;
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      const c = await landedCount();
      if (c !== null) {
        if (stableSince !== null && stableSince.value === c && Date.now() - stableSince.at >= 1000) { reentrancyFinal = c; break; }
        if (stableSince === null || stableSince.value !== c) stableSince = { value: c, at: Date.now() };
      }
      await page.waitForTimeout(500);
    }
  }
  // These two ARE the product invariant this journey exists for (a double-tap silently downgrading a
  // recorded AF answer to unanswered). They are asserted only when the interview actually ran —
  // vacuously passing them on a journey that never opened would be worse than skipping, because it
  // would report the guard as proven when nothing exercised it.
  if (!afEverOpened) {
    console.log('SKIP  [I] double-tap reentrancy assertions — the interview never opened, so nothing exercised the guard');
  } else {
    check('[I] double-tap NEVER re-presents an already-answered question', doubleProcessed === 0, `repeats=${doubleProcessed} sequence=${JSON.stringify(seenTitles)}`);
    check('[I] the live count NEVER goes back up after an answer (no silent downgrade-to-unanswered)', countIncreased === 0, `count-increases=${countIncreased}`);
  }
  // DEPENDENT, NOT INDEPENDENT (2026-08-26). This can only mean anything if the interview actually
  // ran. When the open above failed, this used to fail too — reporting TWO failures for ONE cause and
  // making a harness timeout look like a narrowing regression. It now states the dependency instead,
  // so the failure count equals the number of real problems.
  if (!afEverOpened) {
    console.log('SKIP  [I] the interview lands on a genuinely narrowed set '
      + '— dependent on the AF-open check above, which already failed; not an independent defect');
  } else {
    check('[I] the interview lands on a genuinely narrowed set, never back at the unfiltered start',
      !reentrancyFinalOpen && Number.isFinite(reentrancyFinal) && reentrancyFinal < reentrancyStart && reentrancyFinal !== reentrancyStart,
      `start=${reentrancyStart} final=${reentrancyFinal} af-still-open=${reentrancyFinalOpen} `
      + `(final=null => the count never settled within 45s, which is a HARNESS/load symptom; `
      + `final>=start => a REAL narrowing regression) url=${page.url()}`);
  }

  // ---- Journey J: MIN_USEFUL_QUESTIONS_TO_SHOW's 1-question case (owner 2026-08-24 — supersedes
  // the original ">=2" brief: 0 useful questions closes cleanly, 1+ opens and asks every one of them,
  // down to the last — a lone genuinely useful question is still a real, honest narrowing step, not a
  // "tax on attention" to withhold). src/data/advancedFilters.ts pins the threshold value and
  // scripts/verify-af-min-useful-questions-gate.ts pins the source shape, but neither ever drives the
  // real interview against real data — this does. Factory + Annual Rent + الرياض is a REAL, currently
  // live cohort with EXACTLY one certified question (src/lib/afCohorts.ts: `Factory: { RentAnnual:
  // ['street_width'] }`, evidence n=72 nationwide, 10/10 exact against aqar's own structured field) —
  // chosen because a same-type, same-city scope with Buy ADDED (dealCombined) has ZERO certified
  // questions (street_width is Buy+RentAnnual certified but not RentMonthly, so the 3-way combined
  // intersection is empty), giving both boundary cases (0 and 1) real, live coverage in one journey
  // without inventing synthetic data.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await tap('تجاري');
  await tap('الصناعة واللوجستيات'); await page.waitForTimeout(300);
  await tap('مصنع'); await page.waitForTimeout(300);
  await tap('إيجار'); await page.waitForTimeout(300); // add Rent (Buy is on by default)
  await tap('شراء'); await page.waitForTimeout(300);  // then drop Buy — Rent-only, never combined
  await pickCity('الرياض');
  await tap('بحث');
  const jStart = await waitForCount(45000);
  check('[J] 1-question scope (Factory/RentAnnual/الرياض) lands with a real start count', Number.isFinite(jStart), `start=${jStart}`);

  let jOpened = false;
  for (let i = 0; i < 6 && !jOpened; i++) {
    await tap('خلّنا نحدد الطلب أكثر').catch(() => {});
    await page.waitForTimeout(1200);
    jOpened = await afPresent();
  }
  check('[J] Advanced Filter OPENS for a cohort with exactly ONE useful question (the 1-question fix)', jOpened);

  let jTitles = [];
  let jAnswered = null;                 // the option testid actually clicked, or null if none was offered
  if (jOpened) {
    // Same render race Journey I already guards against: af-card can mount a beat before its
    // question TITLE/options actually paint (real network round trip via rankQuestions), and CI's
    // slower main thread loses this far more often than a fast local run does — poll instead of a
    // single immediate read.
    let snap = await afSnapshot();
    for (let r = 0; r < 10 && !snap.title; r++) { await page.waitForTimeout(800); snap = await afSnapshot(); }
    if (snap.title) jTitles.push(snap.title);
    check('[J] exactly one question is shown (street_width)', jTitles.length === 1, JSON.stringify(jTitles));
    // RECORD WHETHER AN ANSWER ACTUALLY HAPPENED. When the per-question count probes come back
    // UNDETERMINED, resolveOptions returns ZERO options on purpose — «UNKNOWN must never become NO»
    // — so there is nothing to click. Journey I already skips for exactly that; this journey used to
    // click nothing and then assert narrowing anyway, which is a demand the product does not owe:
    // an unanswered interview MUST leave the count alone. (CI 2026-09-04, start=26 final=26 on
    // Factory/RentAnnual/الرياض: DB truth for that scope is base 26 → ≥15m 24, ≥25m 8, ≥30m 6, so
    // no offered option could ever return 26 — the run simply never answered one.)
    if (snap.options.length) {
      await page.locator(`[data-testid="${snap.options[0]}"]:visible`).first().click({ timeout: 8000 });
      await page.waitForTimeout(300);
      await page.locator('[data-testid="af-confirm"]:visible').first().click({ timeout: 8000 });
      jAnswered = snap.options[0];
    }
    let waited = 0;
    while (waited < 45000) {
      await page.waitForTimeout(500); waited += 500;
      if (!(await afPresent())) break;
    }
  }
  const jFinalOpen = await afPresent();
  check('[J] after answering the single question, the interview closes CLEANLY (no second question)', !jFinalOpen);
  // Same staleness trap Journey I already documents: af-card unmounting is NOT "the new count
  // landed" — finishGuided's mining transition holds the OLD pre-AF results on screen underneath for
  // a guaranteed minimum beat first. Give that floor time, then require two reads a second apart to
  // agree before trusting the number (else this reads back the stale pre-answer count, e.g. 43 when
  // the true narrowed count is 39 — a HARNESS race, not a product defect).
  let jFinal = null;
  if (!jFinalOpen) {
    await page.waitForTimeout(3000);
    let stableSince = null;
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      const c = await landedCount();
      if (c !== null) {
        if (stableSince !== null && stableSince.value === c && Date.now() - stableSince.at >= 1000) { jFinal = c; break; }
        if (stableSince === null || stableSince.value !== c) stableSince = { value: c, at: Date.now() };
      }
      await page.waitForTimeout(500);
    }
  }
  // The narrowing demand applies ONLY when an option was actually answered. This does NOT relax the
  // rule: if options WERE offered and one was committed, the count must still genuinely narrow, and
  // that is exactly the regression this journey exists to catch. What it stops doing is failing for
  // the OPPOSITE of a defect — the product correctly declining to invent options it has no counts for.
  if (jOpened && !jAnswered) {
    console.log('SKIP  [J] narrowing assertion — AF offered NO options for this cohort, so nothing '
      + 'was answered and no narrowing is owed. That is the specified behaviour when the per-question '
      + 'count probes return UNDETERMINED («UNKNOWN must never become NO»), the same environment/'
      + 'latency symptom Journey I skips for. A REAL regression looks different: options ARE offered, '
      + 'one is committed, and the count still does not move — which the check below still enforces.');
  } else {
    check('[J] the closed interview lands on a genuinely narrowed, non-null result',
      !jFinalOpen && Number.isFinite(jFinal) && jFinal < jStart,
      `answered=${jAnswered ?? '(none)'} start=${jStart} final=${jFinal}`);
  }

  // Boundary case: the SAME type+city with Buy ALSO selected (dealCombined) has ZERO certified
  // questions (street_width is Buy+RentAnnual certified but not RentMonthly, so the 3-way
  // Buy∩RentAnnual∩RentMonthly intersection cohortAllowsCombined requires is empty) — the interview
  // must never open at all; the button falls through to plain refine chips. Fresh page load rather
  // than mutating the just-finished journey's state — a clean, independently reproducible scope.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await tap('تجاري');
  await tap('الصناعة واللوجستيات'); await page.waitForTimeout(300);
  await tap('مصنع'); await page.waitForTimeout(300);
  await tap('إيجار'); await page.waitForTimeout(300); // Buy is on by default; add Rent → combined
  await pickCity('الرياض');
  await tap('بحث');
  const jZeroStart = await waitForCount(45000);
  check('[J0] 0-question scope (Factory/Buy+Rent-combined/الرياض) lands with a real start count', Number.isFinite(jZeroStart), `start=${jZeroStart}`);
  let jZeroOpened = false;
  for (let i = 0; i < 4 && !jZeroOpened; i++) {
    await tap('خلّنا نحدد الطلب أكثر').catch(() => {});
    await page.waitForTimeout(1200);
    jZeroOpened = await afPresent();
  }
  check('[J0] 0-question cohort (same type+city, Buy+Rent combined) never opens Advanced Filter', !jZeroOpened);

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
