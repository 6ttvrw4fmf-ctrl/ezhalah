// OUR FRONT DOOR, ON EVERY HOST WE SERVE (falcon 2026-10-30). Since 2026-10-21 the app reads through
// /sb/rest/v1/ on its own site, and since 2026-10-26 that site is ezhalah.com (the old vercel.app address
// forwards there). Two live robots recognised the front door only as `${'https://ezhalah-app.vercel.app'}/sb/…`,
// so on a correct production they saw «origins seen: https://ezhalah.com» and failed every real
// af-live-truth-check run from 10-26 to 10-30. One predicate, the same host list the robot pass uses.
import { ROBOT_PASS_HOSTS } from './robotPassCore.mjs';

/** True when `url` is a call to our own /sb/rest/v1/ proxy (the same Supabase project) on any host we serve. */
export function isFrontDoorUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && ROBOT_PASS_HOSTS.includes(u.hostname) && u.pathname.startsWith('/sb/rest/v1/');
}

/** True when `url` is an RPC on our backend: the project's own origin, or the front door on any served host. */
export function isOurRpcUrl(url: string, supabaseOrigin: string): boolean {
  if (url.startsWith(`${supabaseOrigin}/rest/v1/rpc/`)) return true;
  return isFrontDoorUrl(url) && new URL(url).pathname.startsWith('/sb/rest/v1/rpc/');
}
