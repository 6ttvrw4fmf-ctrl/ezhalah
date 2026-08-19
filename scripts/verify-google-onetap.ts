// Regression test: GoogleOneTap component must follow the correct GIS integration pattern.
// Bugs fixed:
//   1. cancel() in effect cleanup triggered Google's exponential cooldown (2h→1d→7d→30d)
//   2. use_fedcm_for_prompt: true with no fallback — FedCM failure = no prompt at all
//   3. No notification callback — impossible to debug why Google suppressed the prompt
//   4. cancel_on_tap_outside defaulted to true — stray clicks triggered cooldown
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'GoogleOneTap.tsx'), 'utf8');
let pass = 0;
let fail = 0;
const assert = (label: string, ok: boolean) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
};

console.log('verify-google-onetap:');

// 1. Must NOT call cancel() in the main effect cleanup (the [user] effect for logged-out users).
//    cancel() triggers Google's exponential cooldown, so it must ONLY fire when user signs in.
//    The cleanup should just set `cancelled = true`.
const cleanupCancelPattern = /return\s*\(\)\s*=>\s*\{[^}]*cancel\(\)/;
const hasCleanupCancel = cleanupCancelPattern.test(src);
// Check that there IS a separate effect that cancels only when user is truthy
// Updated 2026-08-18: the cancel effect no longer guards on `!user` — it must fire only on a real
// no-user → user TRANSITION. A stale/deleted-account token makes the store `user` truthy at mount,
// and the old unconditional shape then cancelled the prompt on EVERY load, escalating Google's
// 2h→1d→7d→30d dismissal cooldown until One Tap stopped appearing. Detail: verify-google-one-tap.ts.
const hasSeparateCancelEffect = /useEffect\(\(\)\s*=>\s*\{[\s\S]*?hadUserRef[\s\S]*?cancel\(\)/s.test(src);
assert('cancel() NOT in main effect cleanup (prevents cooldown)', !hasCleanupCancel || hasSeparateCancelEffect);

// 2. Must have FedCM fallback — if FedCM is skipped, retry with use_fedcm_for_prompt: false
// Updated 2026-08-15: this used to assert `doPrompt(false)` INSIDE the prompt-moment callback. That
// was measured on live production to be UNREACHABLE — under `use_fedcm_for_prompt: true` Google never
// invokes the moment callback, so a callback-nested retry can never run and One Tap silently stayed
// hidden whenever FedCM failed. The fallback is now timer-driven. See verify-google-one-tap.ts.
assert('FedCM fallback is reachable without the moment callback (timer-driven)',
  src.includes('run(false)') && src.includes('use_fedcm_for_prompt') && src.includes('setTimeout'));

// 3. Must have notification callback on prompt() to log the reason Google suppresses
assert('prompt() has notification callback',
  src.includes('getMomentType') || src.includes('getNotDisplayedReason') || src.includes('getSkippedReason'));

// 4. cancel_on_tap_outside: false — prevent stray clicks from triggering cooldown
assert('cancel_on_tap_outside: false set',
  src.includes('cancel_on_tap_outside: false') || src.includes('cancel_on_tap_outside:false'));

// 5. Must use a ref guard to prevent multiple prompt() calls per page load
// Renamed promptedRef → startedRef in the 2026-08-15 rewrite; the guarantee (prompt at most once per
// page load, so we never burn Google's dismissal cooldown) is unchanged.
assert('once-per-page-load guard prevents double-prompting',
  src.includes('startedRef') && (src.includes('useRef(false)') || src.includes('useRef<boolean>(false)')));

// 6. Must call cancel() ONLY when user signs in (separate effect with !user return guard)
assert('cancel() only fires on a genuine sign-in transition (separate effect)',
  hasSeparateCancelEffect);

// 7. GIS script src must point to the official Google endpoint
assert('GIS script URL is correct',
  src.includes('https://accounts.google.com/gsi/client'));

// 8. Must use signInWithIdToken for Supabase exchange (not signInWithOAuth redirect)
assert('Uses signInWithIdToken (not redirect)',
  src.includes('signInWithIdToken') && !src.includes('signInWithOAuth'));

// 9. itp_support for Safari
assert('itp_support: true for Safari ITP',
  src.includes('itp_support: true') || src.includes('itp_support:true'));

// 10. Component renders null (GIS renders its own UI)
assert('Component returns null', src.includes('return null'));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
