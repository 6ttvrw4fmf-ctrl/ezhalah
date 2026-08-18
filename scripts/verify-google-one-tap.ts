// GOOGLE ONE TAP — pins OUR side of the contract with Google.
//
// Measured on live production 2026-08-15: GIS loaded and FedCM genuinely started (network calls to
// gsi/fedcm.json + gsi/fedcm/listaccounts), yet our `[GoogleOneTap]` moment log NEVER appeared. Under
// `use_fedcm_for_prompt: true` Google does NOT invoke the PromptMomentNotification callback — the
// browser owns the UI and those moment APIs are deprecated there. The old component nested its
// FedCM→legacy fallback INSIDE that callback, so the fallback was UNREACHABLE: when FedCM failed
// ("FedCM get() rejects with NetworkError") One Tap silently never appeared and we never retried.
//
// What we can and cannot promise: Google suppresses the prompt whenever the browser has no Google
// session, after dismissal cooldowns (2h→1d→7d→30d), on opt-out, and under various privacy settings.
// None of that is ours to override. OUR contract, pinned here:
//   logged out  → initialize() + prompt() run on every page load, by a path that can actually work
//   logged in   → never initialize, never prompt
//   we never burn Google's cooldown ourselves (no cancel() except on real sign-in)
//   whatever reason Google does give us is captured, not swallowed
//
//   node --experimental-strip-types scripts/verify-google-one-tap.ts     (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'GoogleOneTap.tsx'), 'utf8');
// Strip comments: prose describing a rule must never be what satisfies the check for it.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nGoogle One Tap — our side of the contract\n');

// getSession() is LOCAL-only. A deleted account / revoked token can still parse locally, so it would
// report "signed in" and we would never prompt — the owner's exact case (2026-08-18): a deleted
// account, or someone who never signed up, must still get the prompt. getUser() validates server-side.
check('logged-out state is resolved via server-validated getUser(), never getSession() alone',
  /supabase\.auth\.getUser\(\)/.test(code) && /setSignedOut/.test(code)
  && !/supabase\.auth\.getSession\(\)/.test(code),
  'getSession() only reads local storage — a stale/deleted-account token then suppresses One Tap forever');
check('any getUser error counts as signed out (deleted user, revoked token, network)',
  /!!error\s*\|\|\s*!data\?\.user/.test(code));

// Measured live 2026-08-18: with an invalid refresh token supabase-js retries the refresh with
// backoff, so getUser() may never settle — and while it is unresolved we never prompt, which is worse
// than the bug it fixed (a stale token produced 0 prompt attempts). The call must be time-bounded and
// must default to SIGNED OUT, the safe direction: a real signed-in user is still covered by the store
// `user` gate and the cancel-on-sign-in effect.
check('getUser is time-bounded and defaults to signed-out on timeout',
  /GETUSER_TIMEOUT_MS/.test(code) && /setTimeout\([\s\S]{0,120}?decide\(true\)/.test(code),
  'an unresolved getUser() silently blocks One Tap forever');

// auto_select:true silently signs a RETURNING visitor in and never renders the prompt — that is how
// "it used to appear and then stopped" happens. The owner requires the prompt to be SHOWN.
check('auto_select is false so Google actually RENDERS the prompt',
  /auto_select:\s*false/.test(code),
  'auto_select:true auto-signs returning visitors and the prompt is never displayed');

// A failed token exchange looks identical to "Google suppressed it" unless we say so.
check('token-exchange failures are recorded, never swallowed',
  /exchangeError/.test(code) && !/signInWithIdToken\([^)]*\)\.catch\(\(\)\s*=>\s*\{\}\)/.test(code),
  'swallowing this hides a real sign-in failure behind an apparent "no prompt"');
check('prompt gate uses ONLY the server-validated answer, never the local-session store user',
  /signedOut\s*!==\s*true\) return;/.test(code) && !/signedOut\s*!==\s*true\s*\|\|\s*user/.test(code),
  'the store user comes from a LOCAL getSession, so a stale/deleted token would block the prompt');

check('calls google.accounts.id.initialize()', /google\.accounts\.id\.initialize\(/.test(code));
check('calls google.accounts.id.prompt()', /google\.accounts\.id\.prompt\(/.test(code));
check('prompt runs at most once per page load (guard ref)', /startedRef\.current\s*=\s*true/.test(code));

// THE root-cause pin: the fallback must not depend on a callback Google will not call under FedCM.
check('a timer-based fallback exists (reachable without the moment callback)',
  /setTimeout\(/.test(code) && /FEDCM_FALLBACK_MS/.test(code));
const runFalse = (code.match(/run\(false\)/g) ?? []).length;
check('the legacy path is reached exactly twice: no-FedCM browsers, and the timer retry',
  runFalse === 2, `found ${runFalse} run(false) call sites — expected exactly 2`);
check('browsers without FedCM go straight to the legacy path',
  /IdentityCredential' in window/.test(code) && /!fedcmSupported/.test(code));
check('the timer retry is skipped when a moment already arrived or GIS UI is present',
  /momentSeen/.test(code) && /credential_picker/.test(code));

// cancel() is a USER dismissal to Google → exponential cooldown. Legitimate exactly once: after sign-in.
const cancels = (code.match(/accounts\??\.id\??\.cancel\(\)/g) ?? []).length;
check('cancel() appears exactly once (the sign-in effect only)', cancels === 1,
  `found ${cancels} — a cancel() in cleanup silently triggers the 2h→1d→7d→30d cooldown`);
check('the surviving cancel() is guarded on a signed-in user',
  /if\s*\(Platform\.OS\s*!==\s*'web'\s*\|\|\s*!user\)\s*return;[\s\S]{0,120}cancel\(\)/.test(code));
check('cancel_on_tap_outside is disabled (stray clicks must not start a cooldown)',
  /cancel_on_tap_outside:\s*false/.test(code));

check('suppression reasons are captured (all four moment kinds)',
  /getNotDisplayedReason/.test(code) && /getSkippedReason/.test(code)
  && /getDismissedReason/.test(code) && /isDisplayed/.test(code));
check('diagnostics are inspectable in production without a rebuild', /__ezOneTap/.test(code));
check('diagnostics record which path ran and whether the fallback fired',
  /attempts/.test(code) && /fallbackFired/.test(code) && /fedcmSupported/.test(code));
check('component renders nothing itself (Google owns the UI)', /return null;/.test(code));

console.log(failures === 0
  ? '\n✓ One Tap contract intact: authoritative logged-out gate, reachable fallback, no self-inflicted cooldown, reasons captured\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
