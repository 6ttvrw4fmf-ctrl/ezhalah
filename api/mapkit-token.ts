// GET /api/mapkit-token → { token } : a short-lived Apple MapKit JS token for the website's map (owner 2026-10-30:
// Apple Maps on the «خريطة» tab, map only for now).
//
// The private key never reaches a browser: it lives in Vercel (MAPKIT_WEB_P8 / MAPKIT_WEB_KEY_ID / MAPKIT_WEB_TEAM_ID,
// the «maps.com.ezhalah.web» key) and this function signs a 30-minute ES256 JWT with it, which is all MapKit JS needs.
// These are SEPARATE from the nightly district job's APPLE_MAPS_* key (scripts/pin-district-nightly.mjs): one key per
// job, so the website's map loads can never eat the geocoding quota and either key can be replaced on its own.
//
// Not configured (no key in the environment) → 503, and the page shows «تعذّر تحميل الخريطة» — never a blank map
// pretending to load (A FAILED FETCH IS NOT AN EMPTY ANSWER).
/// <reference types="node" />
import { createSign } from 'node:crypto';

const TOKEN_SECONDS = 30 * 60;

/** The .p8 as Vercel may hand it back: with its line breaks, or flattened onto one line by a paste. Rebuilt into PEM. */
export function normalizeP8(raw: string): string {
  const body = raw.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n/g, '\n').replace(/\s+/g, '');
  if (!body) return '';
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** A MapKit JS token: ES256 JWT {iss: team, iat, exp}, optionally pinned to one web origin. */
export function mintMapKitToken(p8: string, keyId: string, teamId: string, nowSeconds: number, origin?: string): string {
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const claims: Record<string, unknown> = { iss: teamId, iat: nowSeconds, exp: nowSeconds + TOKEN_SECONDS };
  if (origin) claims.origin = origin;
  const body = b64(claims);
  const sig = createSign('SHA256').update(`${head}.${body}`).sign({ key: normalizeP8(p8), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}

export async function GET(request: Request): Promise<Response> {
  const p8 = process.env.MAPKIT_WEB_P8 || '', keyId = process.env.MAPKIT_WEB_KEY_ID || '', teamId = process.env.MAPKIT_WEB_TEAM_ID || '';
  if (!p8 || !keyId || !teamId) return Response.json({ ok: false, reason: 'not configured' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  // Pin the token to the site that asked for it (Apple refuses it from any other page). Same-origin fetches carry
  // Origin only on some browsers, so fall back to the request's own host.
  const origin = request.headers.get('origin') || (() => { try { return new URL(request.url).origin; } catch { return undefined; } })();
  let token: string;
  try {
    token = mintMapKitToken(p8, keyId, teamId, Math.floor(Date.now() / 1000), origin);
  } catch {
    return Response.json({ ok: false, reason: 'bad key' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ ok: true, token }, { headers: { 'cache-control': 'no-store' } });
}
