// POST-DEPLOY HYDRATION GATE — load the REAL production URL in a REAL browser and fail on a React
// hydration mismatch.
//
// WHY THIS EXISTS (2026-08-15). The "Both" rent-period feature was shipped twice by two independent
// sessions (PR #634 and PR #637) and reverted twice (PR #635, PR #639) for the same symptom: React
// error #418 (hydration mismatch) on the home page, seen only AFTER the deploy went live. Both PRs had
// passed `tsc`, the full string-pin suite, AND a local static-export render. Both revert write-ups
// independently reached the same conclusion: nothing in the repo could have caught it, because the
// failure is a property of the SERVED page, not of the source.
//
// A static fetch cannot detect this either — a hydration mismatch only exists once React runs and
// compares its client render against the server-rendered DOM. So this gate drives a real Chromium
// (Playwright is already a devDependency), loads the live origin, and fails on:
//   • any React hydration error (#418/#423/#425 are the minified hydration family), and
//   • the home page not actually rendering its filter card — the exact user-visible symptom both
//     incidents reported ("the filter card never rendered past the hero header").
//
// It is deliberately NOT a pre-merge test: the thing it checks cannot exist until a build is live.
// It runs as the last step of the deploy workflow, so a hydration break fails the deploy run loudly
// instead of being discovered by whoever happens to open the site next.
//
//   node scripts/verify-live-hydration.mjs [url]      (default: https://ezhalah-app.vercel.app)

import { chromium } from 'playwright';

const URL = process.argv[2] || process.env.HYDRATION_CHECK_URL || 'https://ezhalah-app.vercel.app';

// Minified React errors that mean "server HTML and client render disagree".
const HYDRATION_ERR = /Minified React error #(418|423|425)\b/;
// A marker that only appears once the home page's filter card has really rendered. Arabic, because the
// product is Arabic-only — see ARCHITECTURE §8.
const FILTER_CARD_MARKER = 'أي مدينة؟';

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1; };

// EVERY VIEWPORT, NOT JUST ONE (2026-08-21). This gate used to open a single default 1280×720 page.
// A width-gated hydration bug is invisible at every width on the wrong side of its breakpoint, so one
// viewport is one sample on the exact axis the defect varies along. The P0 of 2026-08-21 proved it:
// 0 errors at 375 and 768, 2 errors at 900 and above. These widths bracket both real breakpoints
// (CARD_WIDE 820, DOCK 900) on both sides, including the exact boundary.
const VIEWPORTS = [
  { label: 'phone',            width: 375,  height: 812 },
  { label: 'tablet',           width: 768,  height: 1024 },
  { label: 'dock boundary',    width: 900,  height: 900 },
  { label: 'desktop',          width: 1280, height: 720 },
  { label: 'wide desktop',     width: 1920, height: 1080 },
];

const browser = await chromium.launch();
console.log(`\nPost-deploy hydration gate → ${URL}`);
console.log(`Checking ${VIEWPORTS.length} viewports (a width-gated mismatch hides at the wrong width)\n`);

const otherErrorsAll = [];
for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  let bodyText = '';
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 });
    // Hydration errors surface during/just after the client render, not necessarily by networkidle.
    await page.waitForTimeout(4000);
    bodyText = await page.evaluate(() => document.body.innerText);
  } catch (e) {
    fail(`[${vp.label} ${vp.width}px] could not load ${URL}: ${e.message}`);
  }

  const hydrationErrors = consoleErrors.filter((t) => HYDRATION_ERR.test(t));
  if (hydrationErrors.length) {
    fail(`[${vp.label} ${vp.width}px] REACT HYDRATION MISMATCH — the served HTML and the client render disagree.`);
    for (const e of hydrationErrors.slice(0, 2)) console.error(`      ${e.slice(0, 300)}`);
    console.error('      This is the PR #634 / #637 / 2026-08-21 failure class. Do NOT leave this deploy live:');
    console.error('      re-verify the served bundle, and roll back with scripts/emergency-rollback.sh if it persists.');
  } else {
    console.log(`PASS  [${vp.label} ${String(vp.width).padStart(4)}px] no React hydration error`);
  }

  if (bodyText && !bodyText.includes(FILTER_CARD_MARKER)) {
    fail(`[${vp.label} ${vp.width}px] home page did not render its filter card (missing «${FILTER_CARD_MARKER}»)`);
  } else if (bodyText) {
    console.log(`PASS  [${vp.label} ${String(vp.width).padStart(4)}px] filter card rendered`);
  }

  otherErrorsAll.push(...consoleErrors.filter((t) => !HYDRATION_ERR.test(t)));
  await page.close();
}

// Surface non-hydration console errors as INFORMATION, never as a failure: the live page always logs a
// Google-identity/FedCM error for a logged-out visitor, and failing on that would make this gate cry
// wolf until someone mutes it — which is how the real protection gets lost.
if (otherErrorsAll.length) {
  console.log(`\n(info) ${otherErrorsAll.length} non-hydration console error(s) across all viewports, not failing on these:`);
  for (const e of [...new Set(otherErrorsAll)].slice(0, 5)) console.log(`      ${e.slice(0, 160)}`);
}

await browser.close();
console.log(process.exitCode ? '\n✗ hydration gate FAILED\n' : '\n✓ live page hydrates cleanly at every viewport\n');
