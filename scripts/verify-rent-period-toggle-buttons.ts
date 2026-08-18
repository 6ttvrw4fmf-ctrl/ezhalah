// RENT PERIOD TOGGLE BUTTONS (owner feature 2026-08-19) — سنوي + شهري are two INDEPENDENT toggle
// buttons, no third «كلاهما» button, but selecting BOTH must reach the exact same 'both' query value
// the already-proven backend كلاهما architecture expects (docs/ARCHITECTURE.md §17).
//
// src/lib/searchDefaults.ts is a real, importable zero-dependency module (unlike most of src/app and
// src/data), so this test executes the ACTUAL function — not a source-text regex proxy — covering
// every transition the owner explicitly asked to be tested.
//
//   node --experimental-strip-types scripts/verify-rent-period-toggle-buttons.ts   (wired into `npm test`)

import { togglePeriodButton, validRentPeriod, sanitizeForFilterRestore } from '../src/lib/searchDefaults.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

type P = 'monthly' | 'annual' | 'both';
const t = (current: P, which: 'annual' | 'monthly', expected: P, label: string) =>
  check(label, togglePeriodButton(current, which) === expected);

// ── The owner's explicit transition list ────────────────────────────────────────────────────────────
t('annual', 'monthly', 'both', "annual → tap شهري → both");
t('monthly', 'annual', 'both', "monthly → tap سنوي → both");
t('both', 'annual', 'monthly', "both → tap سنوي (turn it off) → monthly");
t('both', 'monthly', 'annual', "both → tap شهري (turn it off) → annual");
// annual→شهري already covered above as the same case as "annual → tap شهري"; explicit سنوي→شهري and
// شهري→سنوي DIRECT single-tap transitions are not reachable in one tap (toggling a button only ever
// turns ITS OWN period on/off) — that is BY DESIGN: the owner's spec describes reachable END STATES
// (annual-only, monthly-only, both), not a forced radio-swap. Reaching "شهري only" from "سنوي only"
// takes two taps (سنوي→both, then شهري off→ no: both→tap سنوي off→monthly) — proven below as a real
// two-step sequence, matching how a user would actually operate two independent toggle buttons.
{
  let state: P = 'annual';
  state = togglePeriodButton(state, 'monthly'); // annual → both
  check('two-tap sequence annual → both (tap شهري)', state === 'both');
  state = togglePeriodButton(state, 'annual');  // both → monthly (turn سنوي off)
  check('two-tap sequence both → monthly (tap سنوي off): reaches شهري-only from سنوي-only', state === 'monthly');
}

// ── The no-op invariant: cannot deselect the only active button (always >= 1 selected) ─────────────
check("annual-only: tapping سنوي again is a no-op (can't reach zero-selected)",
  togglePeriodButton('annual', 'annual') === 'annual');
check("monthly-only: tapping شهري again is a no-op (can't reach zero-selected)",
  togglePeriodButton('monthly', 'monthly') === 'monthly');

// ── Idempotence: tapping the ALREADY-on button in 'both' turns only that one off (not both) ────────
check("both: tapping سنوي (already on) turns OFF سنوي only, شهري survives", togglePeriodButton('both', 'annual') === 'monthly');
check("both: tapping شهري (already on) turns OFF شهري only, سنوي survives", togglePeriodButton('both', 'monthly') === 'annual');

// ── Owner hardening (2026-08-19): "nothing downstream can produce an empty period array from some
// other path (stale/restored state, a URL param, back/forward navigation)" — validRentPeriod is the
// one guard applied at every state-origin boundary, not just the button tap. ──────────────────────
check("validRentPeriod accepts all three real tokens", ['monthly', 'annual', 'both'].every((v) => validRentPeriod(v) === v));
check("validRentPeriod rejects garbage strings (never lets an invalid value through)", validRentPeriod('garbage') === undefined);
check("validRentPeriod rejects undefined/null (caller supplies its own default)", validRentPeriod(undefined) === undefined && validRentPeriod(null) === undefined);
check("validRentPeriod rejects a stray boolean/number (defends against a corrupted persisted value)", validRentPeriod(true) === undefined && validRentPeriod(1) === undefined);

// A "restored" query carrying a corrupted rentPeriod must fall back to the safe default, never pass
// the garbage value through — this is the exact "stale/restored state" origin the owner named.
{
  const restored = sanitizeForFilterRestore({ rentPeriod: 'corrupted-value' } as any);
  check("sanitizeForFilterRestore falls back to a valid default when the restored rentPeriod is garbage",
    restored.rentPeriod === 'monthly' || restored.rentPeriod === 'annual' || restored.rentPeriod === 'both');
}
{
  const restored = sanitizeForFilterRestore({ rentPeriod: 'monthly' } as any);
  check("sanitizeForFilterRestore still passes through a genuinely valid restored rentPeriod", restored.rentPeriod === 'monthly');
}

console.log(failed === 0
  ? '\n✓ rent-period toggle buttons intact: every owner-specified transition reaches the right state, zero-selected unreachable\n'
  : `\n✗ ${failed} assertion(s) FAILED — rent-period toggle button logic is broken\n`);
process.exit(failed === 0 ? 0 : 1);
