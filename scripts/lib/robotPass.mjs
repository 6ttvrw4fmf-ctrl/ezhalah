// ROBOT PASS (security plan Phase 4.4, owner 2026-10-21; docs/ops/SCRAPE_GUARD.md).
//
// Our own browser robots (journeys, live checks, the deploy's hydration check) run from server networks (GitHub,
// Google Cloud) that the network guard refuses, and a headless browser is exactly what BotID and Turnstile exist to
// catch. So every standalone robot script that browses the real site imports this file once (a side-effect import).
// When the job provides EZ_GATE_SECRET, every Playwright browser context the robot opens adds `x-ezhalah-robot:
// <secret>` to requests for OUR front door only (/sb/rest/v1/ on ezhalah-app.vercel.app), and the secret handshake to a
// test copy's direct database calls; never anything to Google, Cloudflare or any other host. api/sb.ts checks the pass
// in constant time and tells the database only «robot: 1». Without the secret this file does nothing at all.
//
// The rule and the per-context hook live in robotPassCore.mjs (no top-level await): Playwright TEST SPECS import that
// directly and call grantRobotPass(context) in a beforeEach, because the test runner cannot load a module that awaits
// at load time (2026-10-22: importing this file from playwright.config.ts made every spec fail to load).
import { grantRobotPass } from './robotPassCore.mjs';

export { ROBOT_PASS_HOSTS, ROBOT_PASS_PATH, robotPassHeaders, grantRobotPass } from './robotPassCore.mjs';

// Side effect: wrap every Playwright browser type this process can load, so each new context gets the pass with no
// change to the robot's own code beyond importing this file.
const SECRET = process.env.EZ_GATE_SECRET || '';
if (SECRET) {
  const seen = new Set();
  for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
    let mod;
    try { mod = await import(name); } catch { continue; }
    for (const type of [mod.chromium, mod.firefox, mod.webkit]) {
      const proto = type && Object.getPrototypeOf(type);
      if (!proto || seen.has(proto) || proto.__ezRobotPass) continue;
      seen.add(proto);
      proto.__ezRobotPass = true;
      const launch = proto.launch;
      proto.launch = async function (...args) {
        const browser = await launch.apply(this, args);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (...opts) => { const ctx = await newContext(...opts); await grantRobotPass(ctx, SECRET); return ctx; };
        return browser;
      };
      const persistent = proto.launchPersistentContext;
      proto.launchPersistentContext = async function (...args) {
        const ctx = await persistent.apply(this, args);
        await grantRobotPass(ctx, SECRET);
        return ctx;
      };
    }
  }
}
