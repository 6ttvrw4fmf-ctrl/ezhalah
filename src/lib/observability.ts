// OBSERVABILITY — client error telemetry to Sentry, safe-by-default (owner request 2026-08-26).
//
// Ezhalah runs on real users' phones and desktops and had ZERO client-side error telemetry until
// this module. Every runtime defect the AF/persistence/scraper barriers didn't already predict
// showed up only when a user complained (or when a future session happened to hit it locally). This
// module closes that gap: `initObservability()` initializes Sentry ONLY if the environment supplies
// a DSN, and `reportError()` sends what escapes.
//
// SAFE-BY-DEFAULT — three PDPL/production properties enforced here, not opt-in:
//
//  1. **No DSN → total no-op.** `EXPO_PUBLIC_SENTRY_DSN` absent (dev / preview / any misconfigured
//     build) means every call in this module returns silently. The code can ship BEFORE the DSN
//     exists, and local dev never sends events.
//  2. **No PII leaves the device.** `sendDefaultPii: false`; `beforeSend` strips the auth token,
//     the Supabase publishable key, phone numbers, emails, and query strings from every event and
//     breadcrumb. The identified user is `sub` (a hash-shaped id) only — never phone/email/name.
//     If a future Sentry SDK adds a new PII field, the scrubber runs LAST so the SDK-added value
//     is redacted by the same rules.
//  3. **Errors only, no performance/replay by default.** `tracesSampleRate = 0`,
//     `replaysSessionSampleRate = 0`, `replaysOnErrorSampleRate = 0`. Turning any of these on is a
//     deliberate future change, not something an SDK upgrade can silently activate.
//
// PURE-LOGIC — the scrubber (`scrubEvent`) is exported so a barrier can EXECUTE it against sample
// events and prove the invariants above (same pattern as afRanking/afCohorts).

// The subset of Sentry's Event type we care about — kept structurally loose because the real type
// depends on which Sentry version is installed and we do not want an unrelated Sentry upgrade to
// break this file's typecheck.
export type SentryEventShape = {
  request?: { url?: string; query_string?: string; cookies?: string; headers?: Record<string, string> };
  user?: { id?: string; email?: string; ip_address?: string; username?: string; [k: string]: unknown };
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown>; [k: string]: unknown }>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  message?: string;
  exception?: { values?: Array<{ value?: string; [k: string]: unknown }> };
};

// Patterns that must never travel to Sentry. Applied to string fields recursively in scrubEvent.
const REDACT = '[redacted]';
// Saudi phone: '+9665XXXXXXXX' or '05XXXXXXXX' — kept broad so a stray formatting variant is
// caught too. E.164 general also covered.
const PHONE_RE = /\+?9665\d{8}\b|\b05\d{8}\b|\+\d{7,15}\b/g;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
// Supabase auth JWTs — a token surface that MUST NOT leave a device via a crash report.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
// Publishable Supabase key format `sb_publishable_...` — harmless if leaked (already client-side),
// but stripping it stops it appearing in every event and makes real secrets visually louder.
const PUB_KEY_RE = /sb_publishable_[A-Za-z0-9_-]{16,}/g;

function scrubString(s: string): string {
  return s
    .replace(JWT_RE, REDACT)
    .replace(PUB_KEY_RE, REDACT)
    .replace(PHONE_RE, REDACT)
    .replace(EMAIL_RE, REDACT);
}
function scrubValue<T>(v: T): T {
  if (typeof v === 'string') return scrubString(v) as unknown as T;
  if (Array.isArray(v)) return v.map(scrubValue) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = scrubValue(val);
    return out as unknown as T;
  }
  return v;
}

/**
 * Redact PII/secrets from a Sentry event before it leaves the device. Exported so a barrier can
 * execute it against sample events and prove: no query strings, no cookies, no IP, no phone, no
 * email, no JWT, no publishable key — anywhere in the payload. Returns null to drop an event
 * entirely (currently we never do, but the type keeps that door open).
 */
export function scrubEvent(event: SentryEventShape): SentryEventShape | null {
  if (event.request) {
    if (event.request.url) event.request.url = event.request.url.split('?')[0].split('#')[0];
    delete event.request.query_string;
    delete event.request.cookies;
    if (event.request.headers) {
      // header keys are case-insensitive; strip the ones that could hold tokens
      const dropKeys = ['authorization', 'cookie', 'set-cookie', 'x-supabase-auth', 'apikey'];
      const hdrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.request.headers)) {
        if (dropKeys.includes(k.toLowerCase())) continue;
        hdrs[k] = scrubString(String(v));
      }
      event.request.headers = hdrs;
    }
  }
  if (event.user) {
    // KEEP `id` (that's `sub` — the pseudonymous identifier that lets us group errors per user for
    // triage, deliberately not a phone/email/name). Strip every direct-PII field, including any
    // future ones the SDK adds — anything outside the allowlist is dropped.
    const id = typeof event.user.id === 'string' ? event.user.id : undefined;
    event.user = id ? { id: scrubString(id) } : undefined;
  }
  if (Array.isArray(event.breadcrumbs)) event.breadcrumbs = event.breadcrumbs.map((b) => scrubValue(b));
  if (event.extra) event.extra = scrubValue(event.extra);
  if (event.contexts) event.contexts = scrubValue(event.contexts);
  if (event.message) event.message = scrubString(event.message);
  if (event.exception?.values) {
    for (const v of event.exception.values) if (typeof v.value === 'string') v.value = scrubString(v.value);
  }
  return event;
}

// ── Live Sentry wiring ──────────────────────────────────────────────────────────────────────────
// A thin lazy loader so this module can be imported unconditionally (barriers, non-web builds, dev)
// without pulling Sentry's runtime into a bundle that isn't going to send anything.

type SentryLike = {
  init: (opts: Record<string, unknown>) => void;
  captureException: (err: unknown, ctx?: Record<string, unknown>) => void;
  captureMessage: (msg: string, ctx?: Record<string, unknown>) => void;
  setUser: (user: { id?: string } | null) => void;
  setTag: (key: string, value: string) => void;
};

let SentryImpl: SentryLike | null = null;
let initialized = false;
let hadDsn = false;

// STATIC env reads — Metro/Expo inline `process.env.EXPO_PUBLIC_*` ONLY when the property access
// is a literal identifier. `process.env[name]` with a dynamic key is a runtime lookup, and on web
// `process.env` is an empty polyfill — so a dynamic-key reader returns undefined even when the var
// is set in Vercel. That was the SECOND root cause of the 2026-08-29 certification finding: the
// first fix made the SDK branch to @sentry/browser, but init still returned early because the DSN
// read was dynamic and never inlined. Each var MUST be read by literal identifier here, never via
// a helper that takes a name string, or Metro will not inline it and web will silently degrade to
// "no DSN → no-op".
function readSentryDsn(): string | undefined {
  const v = process.env.EXPO_PUBLIC_SENTRY_DSN;
  return typeof v === 'string' && v.length ? v : undefined;
}
function readSentryEnv(): string | undefined {
  const v = process.env.EXPO_PUBLIC_SENTRY_ENV;
  return typeof v === 'string' && v.length ? v : undefined;
}
function readSentryRelease(): string | undefined {
  const v = process.env.EXPO_PUBLIC_SENTRY_RELEASE;
  return typeof v === 'string' && v.length ? v : undefined;
}

/**
 * Initialize Sentry if a DSN is present in the environment. Idempotent — safe to call twice, safe
 * to call on any platform, safe to call before Sentry is installed (returns silently).
 */
export function initObservability(): void {
  if (initialized) return;
  initialized = true;
  const dsn = readSentryDsn();
  hadDsn = !!(dsn && dsn.trim());
  if (!hadDsn) return; // no DSN → total no-op, the whole point of "safe-by-default"

  // Platform-branch: `@sentry/react-native` only initializes cleanly on native (iOS/Android). On
  // Expo web, requiring it silently no-oped every event we tried to report (root cause of the
  // 2026-08-29 certification finding — SDK-in-bundle string check passed, ingest POST never
  // happened). Web uses `@sentry/browser` directly, which is what Sentry docs recommend for React
  // web apps and works out of the box on Metro-web. Native falls back to `@sentry/react-native`.
  //
  // Failure is now LOUD: a swallowed exception in this block was how the web integration passed
  // every check while doing nothing in production. Any init error is logged and stashed on
  // `globalThis.__EZH_SENTRY_INIT_ERROR__` so a browser-side probe can see it.
  try {
    let mod: any;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      mod = require('@sentry/browser');
    } else {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      mod = require('@sentry/react-native');
    }
    SentryImpl = mod as SentryLike;
    SentryImpl.init({
      dsn: dsn!.trim(),
      environment: readSentryEnv() ?? 'production',
      release: readSentryRelease(),
      // ERRORS ONLY. Enabling any of these later is a deliberate, PDPL-reviewed change.
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      sendDefaultPii: false,
      // Our own scrubber runs LAST so any PII the SDK added itself is stripped before send.
      beforeSend: (event: SentryEventShape) => scrubEvent(event),
      beforeBreadcrumb: (crumb: any) => {
        // console.log spam is not signal — drop debug breadcrumbs; keep error/warn.
        if (crumb?.category === 'console' && crumb?.level === 'log') return null;
        return crumb;
      },
    });
    // Runtime probe — visible from the browser DevTools + deploy-verify scripts. If this flag is
    // missing after page load, the SDK didn't initialize (however green the code checks look).
    try { (globalThis as any).__EZH_SENTRY_LIVE__ = true; } catch {}
  } catch (err) {
    // LOUD failure — never swallow silently again. Two paths: console.error so a live debugging
    // session sees it immediately, and a globalThis stash so a scripted browser probe can prove
    // whether init crashed vs never ran.
    // eslint-disable-next-line no-console
    console.error('[ezhalah] Sentry init failed:', err);
    try { (globalThis as any).__EZH_SENTRY_INIT_ERROR__ = String((err as Error)?.stack ?? err); } catch {}
    SentryImpl = null;
  }
}

/** Report an error. No-op when Sentry is not initialized (no DSN, no package, or non-web). */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  if (SentryImpl) {
    try { SentryImpl.captureException(err, context ? { extra: scrubValue(context) } as any : undefined); } catch {}
  }
}

/** Report a non-error signal (e.g. a swallowed integrity violation). */
export function reportMessage(msg: string, context?: Record<string, unknown>): void {
  if (SentryImpl) {
    try { SentryImpl.captureMessage(scrubString(msg), context ? { extra: scrubValue(context) } as any : undefined); } catch {}
  }
}

/** Identify the current user by their `sub` (pseudonymous). Pass null on sign-out. */
export function identifyUser(sub: string | null): void {
  if (!SentryImpl) return;
  try {
    if (sub) SentryImpl.setUser({ id: sub });
    else SentryImpl.setUser(null);
  } catch {}
}

/** Introspection for tests/barriers — true once init has run AND a DSN was supplied. */
export function isEnabled(): boolean { return hadDsn && SentryImpl !== null; }
