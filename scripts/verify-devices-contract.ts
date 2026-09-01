// PERMANENT BARRIER: «الأجهزة المسجّل عليها الدخول» tells the truth and keeps its privacy
// contract (owner Phase 2, 2026-08-29).
//
// WHAT THIS LOCKS (each rule falls RED under the named mutation):
//   1. PRIVACY — the devices endpoint returns ONLY {session_id, device_class, browser,
//      created_at, refreshed_at}. EXECUTED: toClientSession() is fed a row carrying the raw
//      user_agent AND ip and must emit exactly those five keys.       [M-privacy: add ip → RED]
//   2. ONE DETECTOR — the edge copy of deviceInfo.ts is byte-identical to src/lib/deviceInfo.ts,
//      and the mapping agrees with the src detector when EXECUTED.    [M-fork: diverge copy → RED]
//   3. OWNERSHIP — DELETE_SQL revokes only rows matching BOTH id AND the caller's user_id
//      (which index.ts takes from auth.getUser, never the body).      [M-owner: drop user_id → RED]
//   4. CONFIRMATION GATE — the client removes a device card only AFTER the backend confirms
//      the revocation; no optimistic removal exists.                  [M-optimistic: remove first → RED]
//   5. IDENTITY, NOT POSITION — «هذا الجهاز» comes from the client's OWN JWT session_id claim
//      (sessionIdFromJwt EXECUTED here), never from list order.       [M-position: badge [0] → RED]
//   6. HONEST TIME — lastActiveLabel (EXECUTED) never claims more precision than the ~hourly
//      refresh: another device is at best «نشط خلال الساعة الأخيرة», never «نشط الآن».
//
// Structural pins carry their own anti-vacuous proof: the exact mutant line is constructed in
// this file and shown to FAIL the predicate, so a drifted regex cannot pass silently.
//
//   node --experimental-strip-types scripts/verify-devices-contract.ts   (auto-discovered by npm test)

import { readFileSync } from 'node:fs';
import { detectDevice } from '../src/lib/deviceInfo.ts';
import { lastActiveLabel, sessionIdFromJwt } from '../src/lib/deviceSessions.ts';
import {
  DELETE_SQL, LIST_SQL, toClientSession, type SessionRow,
} from '../supabase/functions/devices/contract.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/[^\n]*$/gm, '$1');

const srcDetector = read('src/lib/deviceInfo.ts');
const edgeDetector = read('supabase/functions/devices/deviceInfo.ts');
const indexSrc = read('supabase/functions/devices/index.ts');
const indexCode = codeOnly(indexSrc);
const menuSrc = read('src/components/AccountMenu.tsx');
const menuCode = codeOnly(menuSrc);
const devicesLib = codeOnly(read('src/lib/devices.ts'));
const i18nSrc = read('src/i18n.tsx');

// ── 1+2. ONE detector, byte-pinned, and the mapping EXECUTED through it ──────────────────────────
check('detector: edge copy is byte-identical to src/lib/deviceInfo.ts (no fork of the rules)',
  srcDetector === edgeDetector);

const RAW_ROW = {
  id: '9e3a0000-1111-2222-3333-444455556666',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ip: '203.0.113.7', // the server-side row HAS this — the client must never see it
  created_at: '2026-08-29T10:00:00Z',
  refreshed_at: '2026-08-29T12:00:00Z',
  aal: 'aal1',
  tag: 'x',
} as unknown as SessionRow;

const mapped = toClientSession(RAW_ROW) as unknown as Record<string, unknown>;
const KEYS = Object.keys(mapped).sort().join(',');
check('privacy: toClientSession emits EXACTLY the five approved fields',
  KEYS === 'browser,created_at,device_class,refreshed_at,session_id', `got: ${KEYS}`);
check('privacy: neither the raw user_agent nor the ip survives the mapping',
  !('user_agent' in mapped) && !('ip' in mapped)
  && !Object.values(mapped).some((v) => typeof v === 'string' && (v.includes('Mozilla/') || v.includes('203.0.113.7'))));
check('one detector: the edge mapping agrees with the src detector, executed on the same UA',
  mapped.device_class === detectDevice({ userAgent: RAW_ROW.user_agent ?? '', platform: '', maxTouchPoints: 0 }).deviceClass
  && mapped.device_class === 'iPhone' && mapped.browser === 'Safari');
{
  const webview = toClientSession({ ...RAW_ROW, user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0' });
  check('one detector: unknown webview stays browser=null through the endpoint too (never "Safari")',
    webview.browser === null && webview.device_class === 'iPhone');
}

// ── 3. Ownership + endpoint structure ────────────────────────────────────────────────────────────
const ownershipPin = (sqlText: string) =>
  /delete from auth\.sessions\s+where id = \$1 and user_id = \$2/.test(sqlText);
check('ownership: DELETE_SQL requires BOTH the session id AND the caller\'s user_id',
  ownershipPin(DELETE_SQL));
check('ownership (anti-vacuous): the ownerless mutant fails the same pin',
  !ownershipPin('delete from auth.sessions where id = $1 returning id::text as id'));

const listPin = (sqlText: string) =>
  /where user_id = \$1/.test(sqlText) && /not_after is null or not_after > now\(\)/.test(sqlText)
  && /coalesce\(refreshed_at, created_at at time zone 'utc'\)/.test(sqlText) && !/\bip\b/.test(sqlText);
check('list: LIST_SQL is caller-scoped, live-only, coalesces refreshed_at truthfully, selects no ip',
  listPin(LIST_SQL));
check('list (anti-vacuous): an unscoped SELECT fails the same pin',
  !listPin('select id::text, user_agent, ip from auth.sessions'));

check('endpoint: identity comes from auth.getUser on the caller\'s own JWT',
  /auth\.getUser\(\)/.test(indexCode) && /Authorization/.test(indexSrc));
check('endpoint: the request body is never an identity source (no body.user_id anywhere)',
  !/body[^\n]*user_id|user_id[^\n]*body/i.test(indexCode));
check('endpoint: GET maps rows ONLY through toClientSession',
  /rows\.map\(toClientSession\)/.test(indexCode));
check('endpoint: no raw user_agent or ip identifier appears in the handler code at all',
  !/user_agent/.test(indexCode) && !/\bip\b/.test(indexCode));
check('endpoint: statements come only from contract.ts (every sql.unsafe names a pinned constant)',
  (indexCode.match(/sql\.unsafe\(/g) ?? []).length === 3
  && /sql\.unsafe\(LIST_SQL/.test(indexCode) && /sql\.unsafe\(DELETE_SQL/.test(indexCode)
  && /sql\.unsafe\(EXISTS_SQL/.test(indexCode));
check('endpoint: a 0-row delete splits honestly — foreign session refused, gone session "already"',
  /probe\?\.found\) return json\(\{ error: 'forbidden' \}, 403\)/.test(indexCode)
  && /revoked: true, already: true/.test(indexCode));

// ── 4. The confirmation gate in the client ───────────────────────────────────────────────────────
// The card-removal (setDevSessions filter) must sit AFTER the awaited backend result and AFTER
// the !res.ok early-return. The predicate runs on the real handler AND on a constructed
// remove-first mutant, so the pin cannot rot into vacuity.
const gateHolds = (handler: string): boolean => {
  const iAwait = handler.indexOf('await revokeDeviceSession');
  const iGate = handler.indexOf('if (!res.ok)');
  const iRemove = handler.indexOf('setDevSessions(');
  return iAwait > 0 && iGate > iAwait && iRemove > iGate
    && handler.slice(iGate, iRemove).includes('return') // the failure path bails before any removal
    && handler.slice(0, iGate).indexOf('setDevSessions(') === -1;
};
const revokeHandler = menuCode.slice(
  menuCode.indexOf('const onRevokeDevice'),
  menuCode.indexOf('const onSignOutOthers'),
);
check('client gate: cards are removed only AFTER the backend confirms the revocation',
  gateHolds(revokeHandler));
check('client gate (anti-vacuous): the optimistic-removal mutant fails the same predicate',
  !gateHolds(`const onRevokeDevice = async (sid) => {
    setDevSessions((list) => list.filter((s0) => s0.session_id !== sid));
    const res = await revokeDeviceSession(sid);
    if (!res.ok) { return; }
  };`));
check('client gate: revokeDeviceSession itself believes only an explicit revoked:true',
  /d\?\.revoked === true \? \{ ok: true/.test(devicesLib));

const othersHandler = menuCode.slice(
  menuCode.indexOf('const onSignOutOthers'),
  menuCode.indexOf('if (!shown || !user) return null;'),
);
check('client gate: «الأجهزة الأخرى» clears cards via a REFETCH after a confirmed sign-out, never locally',
  othersHandler.indexOf('await signOutOtherDevices()') > 0
  && othersHandler.indexOf('fetchDevices()') > othersHandler.indexOf('if (!ok)')
  && othersHandler.indexOf('setDevSessions(') === -1);

// ── 5. «هذا الجهاز» is identity from the caller's OWN JWT ────────────────────────────────────────
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FIXTURE_SID = '11111111-2222-3333-4444-555555555555';
const jwt = `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'u', session_id: FIXTURE_SID })}.sig`;
check('jwt: sessionIdFromJwt reads the standard session_id claim (executed)',
  sessionIdFromJwt(jwt) === FIXTURE_SID);
check('jwt: garbage tokens yield null, never a guessed id',
  sessionIdFromJwt('') === null && sessionIdFromJwt('a.b') === null
  && sessionIdFromJwt(`${b64url({ alg: 'x' })}.${b64url({ sub: 'u' })}.s`) === null
  && sessionIdFromJwt(null) === null);
check('menu: the other-device split is by session_id !== the JWT session id',
  /\.filter\(\(s0\) => s0\.session_id !== mySid\)/.test(menuCode)
  && /currentSessionId\(\)/.test(menuCode));
check('menu: nothing badges the current device by list position',
  !/devSessions\[0\]|otherSessions\[0\]|\bindex === 0\b|\bi === 0\b/.test(menuCode));
check('menu: the current card renders from LOCAL detection (self-correcting), server list or not',
  /device-card-current/.test(menuSrc)
  && /device\.deviceClass \? t\(device\.deviceClass\) : t\('This device'\)/.test(menuCode));
check('menu: revoking the CURRENT device routes through the existing sign-out flow, not the edge DELETE',
  /testID="device-signout-current"[\s\S]{0,200}?onPress=\{\(\) => go\('signout', 1\)\}/.test(menuSrc));

// ── 5b. SIGN-OUT SCOPE: one device out ≠ every device out ────────────────────────────────────────
// supabase-js defaults signOut() to scope 'global', which revokes EVERY session the user has.
// Measured on production GoTrue 2026-08-30: a plain signOut() on one browser made a second, untouched
// device's refresh token return refresh_token_not_found. That silently contradicts this very screen
// (per-device revoke + «تسجيل الخروج من جميع الأجهزة الأخرى» both become meaningless if the ordinary
// sign-out already nuked everything) and matches no mainstream app. All assertions run on
// comment-stripped code — a comment mentioning the scope must never satisfy this barrier.
const authCode = codeOnly(read('src/lib/auth.ts'));
check("auth: signOutBackend signs out THIS device only (explicit scope 'local')",
  /signOutBackend[\s\S]{0,400}?supabase\.auth\.signOut\(\s*\{[^}]*scope:\s*'local'[^}]*\}\s*\)/.test(authCode));
check('auth: no argument-less supabase.auth.signOut() in src/ — the global-scope default is never taken implicitly',
  !/supabase\.auth\.signOut\(\s*\)/.test(authCode) && !/supabase\.auth\.signOut\(\s*\)/.test(devicesLib));
check("devices: «all other devices» stays the deliberate 'others' scope (current session survives)",
  /signOutOtherDevices[\s\S]{0,300}?supabase\.auth\.signOut\(\s*\{\s*scope:\s*'others'\s*\}\s*\)/.test(devicesLib));
check("auth: no signOut({ scope: 'global' }) anywhere — revoking every session is never the ordinary path",
  !/scope:\s*'global'/.test(authCode) && !/scope:\s*'global'/.test(devicesLib));

// ── 6. Honest Arabic activity buckets (executed) ─────────────────────────────────────────────────
const NOW = Date.parse('2026-08-29T12:00:00Z');
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString();
check('time: within the refresh interval says «خلال الساعة الأخيرة» — never «نشط الآن» for another device',
  lastActiveLabel(ago(30), NOW) === 'نشط خلال الساعة الأخيرة'
  && !lastActiveLabel(ago(30), NOW).includes('نشط الآن'));
check('time: dual and plural agree in Arabic (2h → ساعتين, 3d → ٣ أيام, 15h → ١٥ ساعة)',
  lastActiveLabel(ago(125), NOW) === 'آخر نشاط قبل ساعتين'
  && lastActiveLabel(ago(3 * 24 * 60), NOW) === 'آخر نشاط قبل ٣ أيام'
  && lastActiveLabel(ago(15 * 60), NOW) === 'آخر نشاط قبل ١٥ ساعة');
check('time: unusable timestamps render NOTHING rather than a guess',
  lastActiveLabel('garbage', NOW) === '' && lastActiveLabel(ago(-10), NOW) === '');

// ── UI surface + i18n ────────────────────────────────────────────────────────────────────────────
for (const id of ['devices-list', 'device-card"', 'device-card-current', 'device-signout"', 'device-signout-confirm', 'devices-signout-others', 'devices-retry']) {
  check(`menu: testID ${id.replace('"', '')} present`, menuSrc.includes(`testID="${id.replace('"', '')}"`));
}
check('menu: loading state is the two shimmer cards, not a spinner',
  (menuSrc.match(/<ShimmerDeviceCard/g) ?? []).length === 2);
for (const [en, ar] of [
  ['Devices signed in', 'الأجهزة المسجّل عليها الدخول'],
  ['Active now', 'نشط الآن'],
  ['Log out from all other devices', 'تسجيل الخروج من جميع الأجهزة الأخرى'],
  ['Signs out within an hour at most', 'سيتم تسجيل الخروج خلال ساعة على الأكثر'],
] as const) {
  check(`i18n: «${ar}»`, i18nSrc.includes(`'${en}'`) && i18nSrc.includes(ar));
}

console.log(failures === 0
  ? '\n✓ devices list: real sessions only, five fields only, owned revocation only, confirmed removal only\n'
  : `\n✗ ${failures} check(s) FAILED — the devices experience could lie or leak again\n`);
process.exit(failures === 0 ? 0 : 1);
