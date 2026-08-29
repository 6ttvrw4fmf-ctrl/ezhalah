// TRUTHFUL device/browser detection (owner 2026-08-29). Replaces the fabricated account-menu row
// that derived "Android / Chrome" vs "iPhone" from the LOGIN PROVIDER (user.method) — a Google
// user on an iPhone was told they were on Android. The rule now: show only what the current
// browser environment can support truthfully, and OMIT what it cannot.
//
//   • deviceClass ∈ { iPhone, iPad, Android, Mac, Windows } or null (UI shows «هذا الجهاز»).
//     NEVER an exact model ("iPhone 15 Pro" is unknowable from a browser and must not be faked).
//   • browser ∈ { Chrome, Safari, Firefox, Edge, Opera } or null — null means the line is OMITTED.
//     On iOS, CriOS/FxiOS/EdgiOS are trustworthy positives; the ABSENCE of those tokens does NOT
//     prove Safari — an unknown in-app webview (Instagram, GSA, LINE…) must yield null, never a
//     defaulted "Safari". Genuine Safari = the UA *ends* in "Version/… [Mobile/…] Safari/…" with
//     no suffix — every in-app browser appends or strips something there.
//   • iPadOS 13+ masquerades as "Macintosh": Macintosh UA + maxTouchPoints > 1 ⇒ iPad, not Mac.
//
// PURE on purpose: detectDevice() takes the environment as data so the barrier
// (scripts/verify-device-truth.ts) EXECUTES it against real UA fixtures. Only readDeviceEnv()
// touches the real navigator. Barrier is mutation-proven; keep both in sync.

export type DeviceEnv = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  userAgentDataBrands?: string[];
};

export type DeviceClass = 'iPhone' | 'iPad' | 'Android' | 'Mac' | 'Windows';
export type Browser = 'Chrome' | 'Safari' | 'Firefox' | 'Edge' | 'Opera';
export type DeviceInfo = { deviceClass: DeviceClass | null; browser: Browser | null };

// Genuine Safari (iOS or Mac) ends exactly here; in-app browsers break the anchor (LINE appends
// "Line/…", the Google app has no "Version/…", bare WKWebView has neither token).
const PLAIN_SAFARI_TAIL = / Version\/[\d.]+ (?:Mobile\/\w+ )?Safari\/[\d.]+$/;

function classify(env: DeviceEnv): DeviceClass | null {
  const ua = env.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Macintosh/.test(ua) || env.platform === 'MacIntel') {
    return env.maxTouchPoints > 1 ? 'iPad' : 'Mac'; // iPadOS-as-Mac case
  }
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua) || /^Win/.test(env.platform)) return 'Windows';
  return null; // Linux desktop, bots, native shells… — honest unknown
}

function browserOf(env: DeviceEnv, deviceClass: DeviceClass | null): Browser | null {
  const ua = env.userAgent;

  // Chromium's own brand list outranks UA-string archaeology when present.
  const brands = (env.userAgentDataBrands ?? []).filter((b) => !/Chromium|Not.*Brand/i.test(b));
  if (brands.length) {
    if (brands.some((b) => /Microsoft Edge/i.test(b))) return 'Edge';
    if (brands.some((b) => /Opera/i.test(b))) return 'Opera';
    if (brands.some((b) => /Google Chrome/i.test(b))) return 'Chrome';
    return null; // a browser that names itself something else (Brave, Vivaldi…) — omit, never relabel
  }

  if (deviceClass === 'iPhone' || deviceClass === 'iPad') {
    if (/CriOS\//.test(ua)) return 'Chrome';
    if (/FxiOS\//.test(ua)) return 'Firefox';
    if (/EdgiOS\//.test(ua)) return 'Edge';
    if (/OPiOS\/|OPT\//.test(ua)) return 'Opera';
    return PLAIN_SAFARI_TAIL.test(ua) ? 'Safari' : null; // unknown iOS webview ⇒ OMIT, not "Safari"
  }

  // Order matters: Edge/Opera embed "Chrome/"; Chromium skins are NOT Chrome.
  if (/EdgA?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera[\/ ]/.test(ua)) return 'Opera';
  if (/SamsungBrowser\/|YaBrowser\/|UCBrowser\/|Whale\//.test(ua)) return null;
  if (/Chrome\/|CrMo\//.test(ua)) {
    // "Version/… Chrome/…" (or "; wv)") is the Android WebView, not Chrome.
    return /Version\/|; wv\)/.test(ua) ? null : 'Chrome';
  }
  if (/Firefox\//.test(ua) && !/Seamonkey/i.test(ua)) return 'Firefox';
  if (deviceClass === 'Mac' && PLAIN_SAFARI_TAIL.test(ua)) return 'Safari';
  return null;
}

export function detectDevice(env: DeviceEnv): DeviceInfo {
  const deviceClass = classify(env);
  return { deviceClass, browser: browserOf(env, deviceClass) };
}

// The ONLY impure reader — the component calls this once and hands the result to detectDevice().
export function readDeviceEnv(): DeviceEnv {
  const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    userAgent: typeof nav?.userAgent === 'string' ? nav.userAgent : '',
    platform: typeof nav?.platform === 'string' ? nav.platform : '',
    maxTouchPoints: typeof nav?.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0,
    userAgentDataBrands: Array.isArray(nav?.userAgentData?.brands)
      ? nav.userAgentData.brands.map((b: any) => String(b?.brand ?? '')).filter(Boolean)
      : undefined,
  };
}
