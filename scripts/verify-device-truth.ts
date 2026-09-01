// PERMANENT BARRIER: the account-menu device/browser row tells the TRUTH (owner 2026-08-29).
//
// THE BUG THIS LOCKS OUT (live on prod until 2026-08-29): AccountMenu derived the "device" from
// the LOGIN PROVIDER — `m === 'google' ? 'Android / Chrome' : 'iPhone'` — so every Google user
// saw "Android / Chrome" on any hardware and everyone else saw "iPhone", fabricated both ways.
//
// THE RULE. Device and browser come ONLY from what the current browser environment supports
// truthfully (src/lib/deviceInfo.ts, a PURE module this barrier EXECUTES with real UA fixtures):
//   • deviceClass vocabulary is EXACTLY { iPhone, iPad, Android, Mac, Windows } ∪ { null } —
//     null renders «هذا الجهاز». Never an exact model. Never login-provider-derived.
//   • iPadOS 13+ masquerades as "Macintosh": Macintosh UA + maxTouchPoints > 1 ⇒ iPad, not Mac.
//   • Browser only on trustworthy evidence (CriOS/FxiOS/EdgiOS are honest iOS positives); an
//     unknown iOS webview yields NULL — the line is omitted — never a defaulted "Safari".
//
// Mutation-proven (run these by hand if you touch this area):
//   M1 restore `loginDevice = m === 'google' ? …` in AccountMenu.tsx            → this file goes RED
//   M2 break the iPad check (ignore maxTouchPoints) in deviceInfo.ts            → RED
//   M3 default unknown iOS webviews to 'Safari' in deviceInfo.ts                → RED
//
//   node --experimental-strip-types scripts/verify-device-truth.ts   (auto-discovered by npm test)

import { readFileSync } from 'node:fs';
import { detectDevice, type DeviceEnv } from '../src/lib/deviceInfo.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const env = (userAgent: string, maxTouchPoints = 0, platform = '', userAgentDataBrands?: string[]): DeviceEnv =>
  ({ userAgent, platform, maxTouchPoints, userAgentDataBrands });

// ── REAL user-agent fixtures (verbatim from the named environments) ──────────────────────────────
const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/126.0.2592.66 Version/17.0 Mobile/15E148 Safari/605.1.15',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', // iPadOS 13+ lies "Macintosh"; touch tells the truth
  ipadClassic: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  androidWebview: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UD1A.230803.041; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  winOpera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  // Unknown iOS webviews — the environments the old code (and lazy detectors) mislabel "Safari":
  iosInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98',
  iosBareWebview: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iosGoogleApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/307.0.632911286 Mobile/15E148 Safari/604.1',
  iosLine: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1 Line/13.9.0',
  androidStockOld: 'Mozilla/5.0 (Linux; U; Android 4.3; en-us; GT-I9300 Build/JSS15J) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
};

type Want = { device: string | null; browser: string | null };
const cases: Array<[name: string, e: DeviceEnv, want: Want]> = [
  ['iPhone Safari',                 env(UA.iphoneSafari, 5),            { device: 'iPhone', browser: 'Safari' }],
  ['iPhone Chrome (CriOS)',         env(UA.iphoneChrome, 5),            { device: 'iPhone', browser: 'Chrome' }],
  ['iPhone Firefox (FxiOS)',        env(UA.iphoneFirefox, 5),           { device: 'iPhone', browser: 'Firefox' }],
  ['iPhone Edge (EdgiOS)',          env(UA.iphoneEdge, 5),              { device: 'iPhone', browser: 'Edge' }],
  ['iPadOS desktop-mode Safari',    env(UA.ipadDesktopMode, 5, 'MacIntel'), { device: 'iPad', browser: 'Safari' }],
  ['iPad classic UA',               env(UA.ipadClassic, 5),             { device: 'iPad', browser: 'Safari' }],
  ['Mac Safari (no touch)',         env(UA.macSafari, 0, 'MacIntel'),   { device: 'Mac', browser: 'Safari' }],
  ['Mac Chrome',                    env(UA.macChrome, 0, 'MacIntel'),   { device: 'Mac', browser: 'Chrome' }],
  ['Android Chrome',                env(UA.androidChrome, 5),           { device: 'Android', browser: 'Chrome' }],
  ['Android WebView (wv)',          env(UA.androidWebview, 5),          { device: 'Android', browser: null }],
  ['Samsung Internet ≠ Chrome',     env(UA.androidSamsung, 5),          { device: 'Android', browser: null }],
  ['Windows Chrome',                env(UA.winChrome, 0, 'Win32'),      { device: 'Windows', browser: 'Chrome' }],
  ['Windows Edge',                  env(UA.winEdge, 0, 'Win32'),        { device: 'Windows', browser: 'Edge' }],
  ['Windows Firefox',               env(UA.winFirefox, 0, 'Win32'),     { device: 'Windows', browser: 'Firefox' }],
  ['Windows Opera (OPR)',           env(UA.winOpera, 0, 'Win32'),       { device: 'Windows', browser: 'Opera' }],
  ['Linux Firefox → device unknown', env(UA.linuxFirefox, 0, 'Linux x86_64'), { device: null, browser: 'Firefox' }],
  ['iOS Instagram webview',         env(UA.iosInstagram, 5),            { device: 'iPhone', browser: null }],
  ['iOS bare WKWebView',            env(UA.iosBareWebview, 5),          { device: 'iPhone', browser: null }],
  ['iOS Google-app webview',        env(UA.iosGoogleApp, 5),            { device: 'iPhone', browser: null }],
  ['iOS LINE webview',              env(UA.iosLine, 5),                 { device: 'iPhone', browser: null }],
  ['Old Android stock ≠ Safari',    env(UA.androidStockOld, 5),         { device: 'Android', browser: null }],
  ['Empty environment → all unknown', env('', 0, ''),                   { device: null, browser: null }],
  ['UA-CH brands: Edge wins over Chrome token', env(UA.winEdge, 0, 'Win32', ['Chromium', 'Microsoft Edge', 'Not;A=Brand']), { device: 'Windows', browser: 'Edge' }],
  ['UA-CH brands: unknown brand (Brave) → omit', env(UA.winChrome, 0, 'Win32', ['Brave', 'Chromium', 'Not_A Brand']), { device: 'Windows', browser: null }],
];

// ── A. Execute the detector against every fixture ────────────────────────────────────────────────
for (const [name, e, want] of cases) {
  const got = detectDevice(e);
  check(`A: ${name}`, got.deviceClass === want.device && got.browser === want.browser,
    `want ${want.device}/${want.browser}, got ${got.deviceClass}/${got.browser}`);
}

// ── B. The owner's five, named explicitly ────────────────────────────────────────────────────────
// B1. A Google login on an iPhone can NOT produce "Android / Chrome": the detector has no login
//     input at all — same env, any provider, same truthful answer.
{
  const got = detectDevice(env(UA.iphoneSafari, 5));
  check('B1: iPhone environment never yields Android (login provider is not an input)',
    got.deviceClass === 'iPhone');
}
// B2. A non-Google login does not default to iPhone.
{
  const win = detectDevice(env(UA.winChrome, 0, 'Win32'));
  const unknown = detectDevice(env('', 0, ''));
  check('B2: non-iPhone environments never default to iPhone',
    win.deviceClass === 'Windows' && unknown.deviceClass === null);
}
// B3. iPadOS 13+ desktop-mode: Macintosh UA + maxTouchPoints 5 ⇒ iPad, not Mac.
{
  const got = detectDevice(env(UA.ipadDesktopMode, 5, 'MacIntel'));
  check('B3: Macintosh UA + maxTouchPoints 5 ⇒ iPad', got.deviceClass === 'iPad',
    `got ${got.deviceClass}`);
}
// B4. No fixture can produce a model string — output vocabulary is EXACTLY the 5 classes + null.
{
  const DEVICE_VOCAB = new Set<string | null>(['iPhone', 'iPad', 'Android', 'Mac', 'Windows', null]);
  const BROWSER_VOCAB = new Set<string | null>(['Chrome', 'Safari', 'Firefox', 'Edge', 'Opera', null]);
  let ok = true; let bad = '';
  for (const [name, e] of cases) {
    const got = detectDevice(e);
    if (!DEVICE_VOCAB.has(got.deviceClass) || !BROWSER_VOCAB.has(got.browser)) {
      ok = false; bad = `${name} → ${got.deviceClass}/${got.browser}`; break;
    }
  }
  check('B4: output vocabulary is exactly the 5 device classes + null (no model strings ever)', ok, bad);
}
// B5. Unknown iOS webview ⇒ browser null (line omitted), never a defaulted "Safari".
{
  const ig = detectDevice(env(UA.iosInstagram, 5));
  const bare = detectDevice(env(UA.iosBareWebview, 5));
  const gsa = detectDevice(env(UA.iosGoogleApp, 5));
  check('B5: unknown iOS webviews yield browser=null, not "Safari"',
    ig.browser === null && bare.browser === null && gsa.browser === null,
    `Instagram=${ig.browser} bare=${bare.browser} GSA=${gsa.browser}`);
}

// ── C. Source pins: the fabrication cannot come back ─────────────────────────────────────────────
const menuSrc = readFileSync(new URL('../src/components/AccountMenu.tsx', import.meta.url), 'utf8');
const i18nSrc = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');

// Anti-vacuous: each pin's pattern must catch the EXACT line that shipped the bug.
const OLD_LINE = "const loginDevice = m === 'google' ? t('Android / Chrome') : t('iPhone');";
const PIN_FABRICATED_LITERAL = /Android \/ Chrome/;
const PIN_LOGIN_DEVICE = /loginDevice/;
const PIN_METHOD_TERNARY = /(?:\bm\s*===|\bmethod\b)[^\n]*\?[^\n]*t\('(?:iPhone|iPad|Android|Mac|Windows)/;
check('C0: pins are not vacuous (each catches the original buggy line)',
  PIN_FABRICATED_LITERAL.test(OLD_LINE) && PIN_LOGIN_DEVICE.test(OLD_LINE) && PIN_METHOD_TERNARY.test(OLD_LINE));

check('C1: AccountMenu no longer contains the fabricated "Android / Chrome" value',
  !PIN_FABRICATED_LITERAL.test(menuSrc));
check('C2: AccountMenu no longer contains the loginDevice derivation',
  !PIN_LOGIN_DEVICE.test(menuSrc));
check('C3: no login-method ternary yields a device string anywhere in AccountMenu',
  !PIN_METHOD_TERNARY.test(menuSrc));
check('C4: AccountMenu is wired to the truthful detector (detectDevice + readDeviceEnv)',
  /detectDevice\(readDeviceEnv\(\)\)/.test(menuSrc));
check('C5: the browser row is conditional — omitted when detection is untrustworthy',
  /device\.browser\s*\?/.test(menuSrc));
check('C6: i18n no longer carries the fabricated "Android / Chrome" key',
  !PIN_FABRICATED_LITERAL.test(i18nSrc));

console.log(failures === 0
  ? '\n✓ the device/browser row states only what the environment proves — no fabrication paths left\n'
  : `\n✗ ${failures} check(s) FAILED — the account menu could lie about device or browser again\n`);
process.exit(failures === 0 ? 0 : 1);
