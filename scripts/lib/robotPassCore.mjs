// ROBOT PASS, CORE (docs/ops/SCRAPE_GUARD.md): the rule and the per-context hook, with no load-time side effects and no
// top-level await, so the Playwright test runner (which loads specs synchronously) can import it. robotPass.mjs builds
// on it and adds the automatic hook for standalone robot scripts.
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

/** Add the pass (front door) and the handshake (a test copy's direct database calls) to one Playwright context.
 *  Returns false when there is no secret: nothing changes. */
export async function grantRobotPass(context, secret = process.env.EZ_GATE_SECRET || '') {
  if (!secret || !context || typeof context.route !== 'function') return false;
  await context.route(ROBOT_PASS_PATH, (route) => {
    const req = route.request();
    const headers = robotPassHeaders(req.url(), req.headers(), secret);
    return headers ? route.continue({ headers }) : route.continue();
  });
  // A test copy of the site (CI's local build, a preview) has no front door, so its browser calls our database
  // directly: give those calls the secret handshake too (gateFetch.mjs decides which calls qualify).
  await context.route(/\.supabase\.co\/rest\/v1\//, (route) => {
    const req = route.request();
    const extra = gateHeaders(req.url(), secret);
    return extra ? route.continue({ headers: { ...req.headers(), ...extra } }) : route.continue();
  });
  return true;
}
