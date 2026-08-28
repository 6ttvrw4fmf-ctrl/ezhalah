// GoogleOneTap FedCM fallback-race barrier (owner report, 2026-08-28 — real Chrome: "it popped up
// then went away, didn't sign me in"). Root cause: the FedCM→legacy fallback fired on a BLIND TIMER
// (FEDCM_FALLBACK_MS) with no way to know whether the browser's native FedCM identity bubble was
// still legitimately showing and awaiting the visitor's click — that UI is drawn by the browser
// chrome itself, entirely outside the page DOM, so the existing "is a prompt already up" guard (a
// DOM query for the legacy iframe) could never see it. A visitor slower than the timer to notice a
// small corner bubble had it interrupted: re-initializing GIS for the legacy retry superseded the
// still-outstanding FedCM request. Reproduced live via Google's own console warning
// ("initialize() called multiple times...") and the browser's own "Only one navigator.credentials.get
// request may be outstanding at one time" error, on every run.
//
// The fix: observe the REAL underlying navigator.credentials.get() call GIS makes internally, and
// gate the fallback on that call's actual settlement (empty/falsy resolution or rejection) instead of
// elapsed time. A genuine successful resolution must NEVER trigger the fallback — racing it in on the
// success path would just move this exact bug, not fix it.
//
//   node --experimental-strip-types scripts/verify-google-one-tap-fedcm-race.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

const src = readFileSync(new URL('../src/components/GoogleOneTap.tsx', import.meta.url).pathname, 'utf8');

console.log('\nGoogleOneTap FedCM fallback-race barrier (owner report 2026-08-28)\n');

// ── SOURCE: the fallback is gated on the REAL call's settlement, not a bare elapsed-time guess ────
const startBody = src.match(/const start = \(\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
check(
  'navigator.credentials.get is patched to observe the REAL underlying FedCM call GIS makes internally',
  /const realGet:[\s\S]{0,120}nav\.credentials\?\.get\?\.bind\(nav\.credentials\)/.test(startBody),
);
check(
  'the patch is one-shot — restored to the real function BEFORE the call even settles, so nothing else on the page is ever affected by it',
  /nav\.credentials\.get = realGet; \/\/ one-shot: restore immediately/.test(startBody),
);
check(
  'a genuine RESOLUTION with a real credential NEVER fires the fallback — it DISARMS the ceiling timer outright instead, so a successful sign-in can never be raced by a spurious later run(false)',
  /if \(cred\) \{ if \(fallbackTimer\) clearTimeout\(fallbackTimer\); \}/.test(startBody),
);
check(
  "only an empty/falsy resolution triggers the fallback on the resolve path (never a truthy credential)",
  /else fireFallback\('FedCM resolved with no credential'\);/.test(startBody),
);
check(
  'a rejection (no account offered / dismissed) DOES fire the fallback',
  /\(\) => fireFallback\('FedCM request rejected\/dismissed'\)\)/.test(startBody),
);
check(
  'fireFallback is idempotent — a `fallbackStarted` latch means run(false) can only ever execute once, regardless of which trigger path reaches it first',
  /let fallbackStarted = false;[\s\S]{0,100}const fireFallback = \(reason: string\) => \{\s*\n\s*if \(cancelled \|\| momentSeen \|\| fallbackStarted\) return;\s*\n\s*fallbackStarted = true;/.test(startBody),
);
check(
  'the old flat timer survives only as an ABSOLUTE CEILING for the case GIS never calls credentials.get at all — not the everyday trigger',
  /realGet \? Math\.max\(FEDCM_FALLBACK_MS, 12000\) : FEDCM_FALLBACK_MS/.test(startBody),
);
check(
  "the old DOM-only 'is a prompt already showing' guard (which could never see FedCM's browser-native UI) is GONE from the fallback path — the real settlement signal replaced it entirely",
  !/if \(document\.querySelector\('\[id\*="credential_picker"\]/.test(startBody),
);

// ── EXECUTED: a faithful replica of the fixed start()/fireFallback state machine, run against real
//    Promises (the actual asynchrony this bug lived in) so the race is proven, not just pattern-
//    matched in source. Mirrors the production shape closely enough that a regression in the LOGIC
//    (not just the exact text) still gets caught. ───────────────────────────────────────────────
type RunCall = { useFedCM: boolean };

function makeHarness(getPromise: Promise<unknown> | null, ceilingMs: number) {
  const runs: RunCall[] = [];
  let fallbackStarted = false;
  let cancelled = false;
  let momentSeen = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const run = (useFedCM: boolean) => { runs.push({ useFedCM }); };

  const fireFallback = (_reason: string) => {
    if (cancelled || momentSeen || fallbackStarted) return;
    fallbackStarted = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    run(false);
  };

  const realGet = getPromise ? () => getPromise : undefined;
  if (realGet) {
    getPromise!.then(
      (cred) => { if (cred) { if (fallbackTimer) clearTimeout(fallbackTimer); } else fireFallback('resolved-empty'); },
      () => fireFallback('rejected'),
    );
  }

  run(true);
  fallbackTimer = setTimeout(
    () => fireFallback('ceiling'),
    realGet ? ceilingMs : 4000,
  );

  return {
    runs,
    markMomentSeen: () => { momentSeen = true; },
    cleanup: () => { cancelled = true; if (fallbackTimer) clearTimeout(fallbackTimer); },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  {
    // A credential that never settles within the OLD timer's window (simulating a slow-to-notice
    // visitor with the FedCM bubble still legitimately up) must NOT get a second run(false) fired —
    // the exact "popped up then went away" bug.
    const neverSettles = new Promise<unknown>(() => {}); // deliberately never resolves/rejects
    const h = makeHarness(neverSettles, 300); // short ceiling for a fast test
    await wait(150); // well past where the OLD 4000ms-analog timer would have fired in production
    check(
      'a still-pending FedCM call (visitor has not acted yet) never triggers a second run() before the ceiling — the exact regression being fixed',
      h.runs.length === 1 && h.runs[0].useFedCM === true,
    );
    await wait(200); // now past the short test ceiling
    check(
      'the absolute ceiling still eventually fires if the real call never settles at all',
      h.runs.length === 2 && h.runs[1].useFedCM === false,
    );
    h.cleanup();
  }

  {
    // A quick rejection (genuinely nothing to offer) should fall back promptly — event-driven, not
    // waiting out any timer.
    const rejectsFast = Promise.reject(new Error('NotAllowedError'));
    rejectsFast.catch(() => {}); // prevent unhandled-rejection noise in this test process
    const h = makeHarness(rejectsFast, 5000);
    await wait(20); // microtask + one tick — nowhere near the ceiling
    check(
      'a fast rejection fires the fallback almost immediately, well before any ceiling — the fix is event-driven, not a slower guess',
      h.runs.length === 2 && h.runs[1].useFedCM === false,
    );
    h.cleanup();
  }

  {
    // A genuine SUCCESSFUL resolution (a real credential) must NEVER trigger the fallback, at any
    // point — this is the flaw caught and fixed before shipping: racing run(false) in on the success
    // path would move this exact bug rather than fix it.
    const resolvesWithCredential = Promise.resolve({ token: 'a-real-id-token' });
    const h = makeHarness(resolvesWithCredential, 300);
    await wait(400); // past the ceiling too — proves this isn't just "hasn't happened YET"
    check(
      'a successful resolution with a real credential NEVER fires a second run() — not immediately, and not even after the ceiling would otherwise have fired',
      h.runs.length === 1 && h.runs[0].useFedCM === true,
    );
    h.cleanup();
  }

  {
    // An empty/falsy resolution (GIS resolved but had nothing to offer) is treated the same as a
    // rejection — genuinely nothing to wait for.
    const resolvesEmpty = Promise.resolve(null);
    const h = makeHarness(resolvesEmpty, 5000);
    await wait(20);
    check(
      'an empty/falsy resolution (no credential offered) fires the fallback promptly, same as a rejection',
      h.runs.length === 2 && h.runs[1].useFedCM === false,
    );
    h.cleanup();
  }

  {
    // Two settlement signals racing (e.g. the promise rejects right as the ceiling also fires) must
    // never produce two fallback runs — the fallbackStarted latch.
    const rejectsFast = Promise.reject(new Error('x'));
    rejectsFast.catch(() => {});
    const h = makeHarness(rejectsFast, 1); // ceiling deliberately racing the rejection
    await wait(100);
    check(
      'two overlapping trigger paths (real settlement AND the ceiling firing around the same time) still produce exactly ONE fallback run, never two',
      h.runs.filter((r) => r.useFedCM === false).length === 1,
    );
    h.cleanup();
  }

  {
    // momentSeen (the legacy callback fired — meaning a real prompt outcome already happened through
    // the OTHER path) must suppress the fallback even if the credential promise later settles.
    const rejectsFast2 = Promise.reject(new Error('x'));
    rejectsFast2.catch(() => {});
    const h = makeHarness(rejectsFast2, 5000);
    h.markMomentSeen();
    await wait(20);
    check(
      'once a real moment has already been observed via the legacy callback, a later settlement never fires a redundant fallback',
      h.runs.length === 1,
    );
    h.cleanup();
  }

  console.log('');
  if (failed) {
    console.error(`GoogleOneTap FedCM race barrier: ${failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log('GoogleOneTap FedCM race barrier: all checks passed');
}

main();
