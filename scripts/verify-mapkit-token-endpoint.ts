// The website map's token endpoint (api/mapkit-token.ts) — executed, not grepped (owner 2026-10-30: Apple Maps on
// the «خريطة» tab, key kept on the server):
//   1. mints a valid ES256 JWT {iss: team, iat, exp: +30 min, origin} that verifies against the key's public half;
//   2. accepts the .p8 flattened onto one line (a paste that lost its line breaks) exactly like the multi-line file;
//   3. GET without the three MAPKIT_WEB_* variables answers 503 «not configured», never a 200 with an empty token;
//   4. GET with them answers 200 {ok, token}, uncached.
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { GET, mintMapKitToken, normalizeP8 } from '../api/mapkit-token.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
};
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());
const verifies = (jwt: string) => {
  const [h, b, sig] = jwt.split('.');
  return createVerify('SHA256').update(`${h}.${b}`).verify({ key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
};

// 1. a real, verifiable MapKit token
const now = 1_800_000_000;
const tok = mintMapKitToken(p8, 'KEYID12345', 'TEAMID1234', now, 'https://ezhalah.com');
const [h, b] = tok.split('.');
check('header is ES256 with the key id', decode(h).alg === 'ES256' && decode(h).kid === 'KEYID12345');
check('claims: iss = team, exp = iat + 30 min, origin pinned', (() => { const c = decode(b); return c.iss === 'TEAMID1234' && c.iat === now && c.exp === now + 1800 && c.origin === 'https://ezhalah.com'; })());
check('signature verifies against the public key', verifies(tok));
check('a token signed with another key does NOT verify (the check is real)', !verifies(mintMapKitToken(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 'K', 'T', now)));

// 2. a flattened .p8 (Vercel paste without line breaks) still signs
const flat = p8.replace(/\n/g, '');
check('flattened .p8 is rebuilt into the same PEM', normalizeP8(flat) === normalizeP8(p8) && normalizeP8(p8) === p8);
check('flattened .p8 signs a token that verifies', verifies(mintMapKitToken(flat, 'K', 'T', now)));
check('a .p8 with literal \\n sequences signs too', verifies(mintMapKitToken(p8.replace(/\n/g, '\\n'), 'K', 'T', now)));

// 3 + 4. the HTTP handler
const req = new Request('https://ezhalah.com/api/mapkit-token', { headers: { origin: 'https://ezhalah.com' } });
delete process.env.MAPKIT_WEB_P8; delete process.env.MAPKIT_WEB_KEY_ID; delete process.env.MAPKIT_WEB_TEAM_ID;
const r503 = await GET(req);
check('not configured → 503 and no token', r503.status === 503 && !('token' in await r503.json()));
process.env.MAPKIT_WEB_P8 = p8; process.env.MAPKIT_WEB_KEY_ID = 'KEYID12345'; process.env.MAPKIT_WEB_TEAM_ID = 'TEAMID1234';
const r200 = await GET(req);
const j200 = await r200.json() as { ok: boolean; token: string };
check('configured → 200 with a verifiable token, origin = the asking site', r200.status === 200 && j200.ok && verifies(j200.token) && decode(j200.token.split('.')[1]).origin === 'https://ezhalah.com');
check('token answers are never cached', r200.headers.get('cache-control') === 'no-store');
process.env.MAPKIT_WEB_P8 = 'garbage';
check('an unreadable key → 503, not a crash', (await GET(req)).status === 503);

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\n✓ /api/mapkit-token mints verifiable, origin-pinned, uncached MapKit tokens and fails closed without a key');
