// ROBOT PASS (security plan Phase 4.4, owner 2026-10-21; docs/ops/SCRAPE_GUARD.md).
//
// Our own browser robots (journeys, live checks, the deploy's hydration check) run from server networks (GitHub,
// Google Cloud) that the network guard refuses, and a headless browser is exactly what BotID and Turnstile exist to
// catch. So every robot that browses the real site imports this file once (a side-effect import). When the job
// provides EZ_GATE_SECRET, every Playwright browser context the robot opens adds `x-ezhalah-robot: <secret>` to
// requests for OUR front door only (/sb/rest/v1/ on ezhalah-app.vercel.app), never to Google, Cloudflare or any other
// host. api/sb.ts checks it in constant time and tells the database only «robot: 1». Without the secret this file does
// nothing at all, so local runs and fork PRs behave exactly as before.

import { gateHeaders } from './gateFetch.mjs';

export const ROBOT_PASS_HOSTS = ['ezhalah-app.vercel.app'];
export const ROBOT_PASS_PATH = /\/sb\/rest\/v1\//;

/** The headers a robot request should carry: the original ones, plus the pass only for our own front door. */
export function robotPassHeaders(url, headers, secret) {
  if (!secret) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!ROBOT_PASS_HOSTS.includes(u.hostname) || !ROBOT_PASS_PATH.test(u.pathname)) return null;
  return { ...headers, 'x-ezhalah-robot': secret };
}

/** Add the pass to one Playwright browser context. Returns false when there is no secret (nothing changes). */
export async function grantRobotPass(context, secret = process.env.EZ_GATE_SECRET || '') {
  if (!secret || !context || typeof context.route !== 'function') return false;
  await context.route(ROBOT_PASS_PATH, (route) => {
    const req = route.request();
    const headers = robotPassHeaders(req.url(), req.headers(), secret);
    return headers ? route.continue({ headers }) : route.continue();
  });
  // A test copy of the site (CI's local build, a preview) has no front door, so its browser calls our database
  // directly: give those calls the secret handshake too (scripts/lib/gateFetch.mjs decides which calls qualify).
  await context.route(/\.supabase\.co\/rest\/v1\//, (route) => {
    const req = route.request();
    const extra = gateHeaders(req.url(), secret);
    return extra ? route.continue({ headers: { ...req.headers(), ...extra } }) : route.continue();
  });
  return true;
}

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
