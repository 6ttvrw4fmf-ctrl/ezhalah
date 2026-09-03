// SENTRY-ON-WEB ACTUALLY INITIALIZES — 2026-08-29 certification finding.
//
// THE BUG THIS CATCHES. Before this test, observability.ts required '@sentry/react-native' on
// every platform. On Expo web the require either failed or returned a module whose init() threw;
// the bare `catch {}` swallowed the failure and left `SentryImpl = null`. Every check we had
// passed (the SDK string was in the bundle, the DSN was in the env, the scrubber worked in
// isolation) yet not a single production event ever reached Sentry — proven at certification
// time by throwing a uniquely-named error from the served bundle and seeing zero POSTs to
// sentry.io. Baseline direct-POST to the DSN succeeded, ruling out DSN/network/project.
//
// WHAT THIS TEST ACTUALLY DOES. It runs the real initObservability() twice against a stubbed
// require() so no network call happens, once with `window+document` defined (web platform) and
// once without (native platform). It asserts:
//   - the WEB path resolves `@sentry/browser` (never `@sentry/react-native`)
//   - the NATIVE path resolves `@sentry/react-native`
//   - init() is called with dsn + errors-only sampling
//   - beforeSend is wired to scrubEvent
//   - isEnabled() returns true after successful init
//   - a failed init is LOUD: it logs console.error AND stashes on __EZH_SENTRY_INIT_ERROR__,
//     never a silent no-op again
//   - the runtime probe `globalThis.__EZH_SENTRY_LIVE__` is set on successful web init so a
//     browser-side smoke check can prove "SDK actually initialized" from outside the closure

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, extra?: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && extra ? ` — ${extra}` : ''}`);
  if (!ok) failed++;
};

console.log('\nSentry-on-web actually initializes (owner certification 2026-08-29)\n');

// ── 1. Source shape: the require MUST be platform-branched, not a single require('@sentry/react-native') ─
const src = readFileSync(new URL('../src/lib/observability.ts', import.meta.url), 'utf8');

check("observability.ts branches on typeof window/document (web vs native)",
  /typeof window !== 'undefined'\s*&&\s*typeof document !== 'undefined'/.test(src));
check("observability.ts requires '@sentry/browser' on web",
  /require\(['"]@sentry\/browser['"]\)/.test(src));
check("observability.ts requires '@sentry/react-native' on native (fallback branch)",
  /require\(['"]@sentry\/react-native['"]\)/.test(src));
check("observability.ts sets globalThis.__EZH_SENTRY_LIVE__ on successful init (browser probe)",
  /globalThis[\s\S]{0,50}__EZH_SENTRY_LIVE__\s*=\s*true/.test(src));
check("observability.ts stashes init failure on globalThis.__EZH_SENTRY_INIT_ERROR__",
  /__EZH_SENTRY_INIT_ERROR__/.test(src));
check("observability.ts LOGS init failure via console.error (never a silent no-op again)",
  /console\.error\(['"]?\[ezhalah\] Sentry init failed/.test(src));

// SECOND ROOT CAUSE the certification found (2026-08-29): the original readEnv(name) used a dynamic
// key (`process.env[name]`), which Metro/Expo cannot statically inline — the DSN was set in Vercel,
// baked into the CI build's env, and still absent from the runtime bundle because the property
// access wasn't a literal identifier. The fix is one static reader per env var. If anyone
// reintroduces `process.env[name]` (dynamic-key) or `process.env[...]` where `...` isn't a static
// identifier, this barrier turns red — because the runtime consequence is silent no-op again.
check("observability.ts uses STATIC identifier env reads (Metro can inline EXPO_PUBLIC_*)",
  /process\.env\.EXPO_PUBLIC_SENTRY_DSN\b/.test(src));
// Strip line and block comments before scanning so a comment that DESCRIBES the anti-pattern (as
// this file's header does) doesn't trip the check on itself.
const srcNoComments = src
  .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (avoid URL scheme "://")
check("observability.ts does NOT use dynamic-key env reads (process.env[name] silently no-ops on web)",
  !/process\.env\[\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\]/.test(srcNoComments));

// ── 2. package.json actually depends on both SDKs — the require can't be a dead branch ────────
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
check("package.json depends on @sentry/browser (web)", typeof pkg.dependencies?.['@sentry/browser'] === 'string');
check("package.json depends on @sentry/react-native (native)", typeof pkg.dependencies?.['@sentry/react-native'] === 'string');

// ── 3. EXECUTED contract: run initObservability against a stubbed require, prove behavior ─────
// Reset module state between runs — the module holds init flags in closure variables.
async function freshObservability() {
  const spec = new URL('../src/lib/observability.ts', import.meta.url).pathname + `?cacheBust=${Math.random().toString(36).slice(2)}`;
  // @ts-expect-error dynamic import bypasses Node's ESM cache via query-string
  return await import(spec);
}

// Stub `require` on native branch: overriding globalThis.require in a plain-Node run so the
// CommonJS require the source uses resolves to a fake SDK we can inspect. The source uses
// `require(...)` (not `import`), which under esbuild/tsx runs against a shim we can shape.
type StubbedInit = { calls: any[]; sdkResolved: string | null; enabled: boolean };
function buildStub(sdkName: 'browser' | 'react-native'): [StubbedInit, (m: string) => any] {
  const state: StubbedInit = { calls: [], sdkResolved: null, enabled: false };
  const impl = {
    init: (opts: any) => { state.calls.push(opts); state.enabled = true; },
    captureException: () => {},
    captureMessage: () => {},
    setUser: () => {},
    setTag: () => {},
  };
  const req = (name: string) => {
    if (name === `@sentry/${sdkName}`) { state.sdkResolved = name; return impl; }
    if (name === '@sentry/browser' || name === '@sentry/react-native') {
      throw new Error(`Refusing to resolve ${name} in ${sdkName} test`);
    }
    // Fall back to the real Node require for anything else the module might pull.
    return (globalThis as any).__realRequire__(name);
  };
  return [state, req];
}

// Node ESM doesn't expose require() directly to the source file's scope in the way a bundler does;
// esbuild-strip-types compiles `require(...)` to a call against a captured `require` symbol.
// To make this test executed-not-shape, we monkey-patch process.env and the global require, then
// re-import fresh module instances.
(globalThis as any).__realRequire__ = (globalThis as any).require ?? ((n: string) => { throw new Error('no require in scope: ' + n); });

process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@o0.ingest.us.sentry.io/1';

// ── 3a. NATIVE branch — no window/document ────────────────────────────────────────────────────
{
  // Ensure window/document are undefined for this branch. If jsdom already leaked a `window`,
  // undo it for this test's scope.
  const savedWindow = (globalThis as any).window;
  const savedDocument = (globalThis as any).document;
  delete (globalThis as any).window;
  delete (globalThis as any).document;

  const [state, req] = buildStub('react-native');
  (globalThis as any).require = req;
  try {
    const mod = await freshObservability();
    mod.initObservability();
    check('NATIVE branch: resolves @sentry/react-native', state.sdkResolved === '@sentry/react-native',
      `got: ${state.sdkResolved}`);
    check('NATIVE branch: SentryImpl.init() called exactly once', state.calls.length === 1,
      `calls: ${state.calls.length}`);
    check('NATIVE branch: init opts pass the DSN', state.calls[0]?.dsn?.startsWith('https://'));
    check('NATIVE branch: init opts are errors-only (tracesSampleRate: 0)',
      state.calls[0]?.tracesSampleRate === 0 && state.calls[0]?.replaysSessionSampleRate === 0);
    check('NATIVE branch: isEnabled() returns true after init', mod.isEnabled() === true);
  } finally {
    (globalThis as any).window = savedWindow;
    (globalThis as any).document = savedDocument;
    (globalThis as any).require = (globalThis as any).__realRequire__;
  }
}

// ── 3b. WEB branch — window + document present ────────────────────────────────────────────────
{
  (globalThis as any).window = { addEventListener: () => {} };
  (globalThis as any).document = { createElement: () => ({}) };
  const [state, req] = buildStub('browser');
  (globalThis as any).require = req;
  try {
    const mod = await freshObservability();
    mod.initObservability();
    check('WEB branch: resolves @sentry/browser (NEVER @sentry/react-native)',
      state.sdkResolved === '@sentry/browser', `got: ${state.sdkResolved}`);
    check('WEB branch: SentryImpl.init() called exactly once', state.calls.length === 1,
      `calls: ${state.calls.length}`);
    check('WEB branch: init opts pass the DSN', state.calls[0]?.dsn?.startsWith('https://'));
    check('WEB branch: init opts pass beforeSend (scrubber wired)',
      typeof state.calls[0]?.beforeSend === 'function');
    check('WEB branch: isEnabled() returns true after init', mod.isEnabled() === true);
    check('WEB branch: runtime probe globalThis.__EZH_SENTRY_LIVE__ is set',
      (globalThis as any).__EZH_SENTRY_LIVE__ === true);
  } finally {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    (globalThis as any).require = (globalThis as any).__realRequire__;
    delete (globalThis as any).__EZH_SENTRY_LIVE__;
  }
}

// ── 3c. Init failure is LOUD — a throw inside init must log AND stash, never silent-no-op ─────
{
  (globalThis as any).window = { addEventListener: () => {} };
  (globalThis as any).document = {};
  const boom = new Error('E2E_INIT_BOOM_PROBE');
  const failingReq = (name: string) => {
    if (name === '@sentry/browser') { throw boom; }
    return (globalThis as any).__realRequire__(name);
  };
  (globalThis as any).require = failingReq;
  const logs: string[] = [];
  const origErr = console.error;
  console.error = (...a: any[]) => { logs.push(a.map(String).join(' ')); };
  try {
    const mod = await freshObservability();
    mod.initObservability();
    check('FAIL branch: console.error emitted on init failure (never silent again)',
      logs.some((l) => l.includes('[ezhalah] Sentry init failed') && l.includes('E2E_INIT_BOOM_PROBE')));
    check('FAIL branch: globalThis.__EZH_SENTRY_INIT_ERROR__ stashed for browser probe',
      typeof (globalThis as any).__EZH_SENTRY_INIT_ERROR__ === 'string'
        && (globalThis as any).__EZH_SENTRY_INIT_ERROR__.includes('E2E_INIT_BOOM_PROBE'));
    check('FAIL branch: isEnabled() returns false after init failure', mod.isEnabled() === false);
  } finally {
    console.error = origErr;
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    (globalThis as any).require = (globalThis as any).__realRequire__;
    delete (globalThis as any).__EZH_SENTRY_INIT_ERROR__;
  }
}

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — Sentry on web will not receive events; DO NOT ship with this red`
  : '\n✓ Sentry web+native init contract holds — SDK actually initializes on both platforms, failures are LOUD');
process.exit(failed ? 1 : 0);
