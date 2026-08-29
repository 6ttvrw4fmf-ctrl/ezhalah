// mark_stale_listings_inactive()'s two fraction-based safety checks (30% stale-of-active circuit
// breaker; 50% coverage-of-active coverage gate) must never be evaluated below a minimum active-row
// population, or a tiny table's ordinary week-to-week noise reads as a real problem.
//
// Concrete incident, 2026-08-14 (root-caused during the listing-lifecycle audit): the floor was
// `act >= 8`. sadin_commercial_listings had 15 active rows and 5 stale (33% > 30% max_frac) — the
// circuit breaker TRIPPED for 12 CONSECUTIVE DAYS even though sadin's scraper was perfectly healthy
// the entire time (ok=true daily, rows_seen=82/87 ≈ 94% coverage, sadin_residential 100% fresh).
// Fixed by raising the floor to 30 (mirrors cleanup.py's FRAC_GUARD_MIN_ROWS reasoning: "the
// fraction guard is meaningless on a tiny table"). Verified live the same day: sadin_commercial's
// breaker cleared to 0 under the new floor while dealapp_commercial_listings (522 active, 171
// stale = 32.8% — a REAL, externally-driven coverage gap) correctly kept tripping — so this is not
// a blanket weakening of the guard, only a fix to when it's statistically meaningful to apply it.
//
//   node --experimental-strip-types scripts/verify-stale-breaker-min-population.ts   (wired into `npm test`)

import { replayFunction, codeOnly, MIGRATIONS_DIR } from './lib/rpcReplay.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nStale-breaker minimum-population floor — asserted against the REPLAYED final state\n');

const FN = 'mark_stale_listings_inactive';
const r = replayFunction(MIGRATIONS_DIR, FN);

check(`replay resolves ${FN} to a single effective body`, r.body !== null && r.unresolved.length === 0,
  r.body === null ? 'no CREATE OR REPLACE found in any migration'
    : `cannot interpret: ${r.unresolved.join('; ')}`);

if (r.body) {
  const b = codeOnly(r.body);

  check('a named min_population constant exists (not a bare magic number)',
    /min_population\s+constant\s+int\s*:=\s*(\d+)/i.test(b));

  const m = b.match(/min_population\s+constant\s+int\s*:=\s*(\d+)/i);
  const floor = m ? parseInt(m[1], 10) : 0;
  check(`min_population floor is >= 30 (was 8 — too low for a 30% fraction to mean anything)`,
    floor >= 30, `found ${floor}`);

  // Both fraction-based branches (the circuit breaker AND the coverage gate) must gate on the
  // SAME named floor — fixing only one branch would leave the other with the original false-positive
  // bug under a different guard.
  const circuitBreakerGuard = /if\s+act\s*>=\s*min_population\s+and\s+stale\s*>\s*max_frac\s*\*\s*act\s+then/i;
  // Deliberately NOT pinned to the coverage EXPRESSION. What this barrier protects is the FLOOR —
  // that both fraction-based branches are gated by the same named min_population — and the
  // expression is a separate concern that legitimately changed on 2026-08-29 (migration
  // 20260829142111: max(rows_seen) of a single run → distinct active rows refreshed inside a
  // cadence-derived rolling window, because the old form had no reachable green state for a
  // scraper that crawls itself in ~24 slices). Pinning the arithmetic here made a correct fix look
  // like a regression; the arithmetic is owned by verify-stale-coverage-gate.ts §D, which asserts
  // it against the md5-pinned mirror. So: match the guard and the branch it guards, not the
  // comparison in between.
  const coverageGateGuard = /if\s+act\s*>=\s*min_population\s+and\s+[^;]*?coverage_floor[^;]*?\s+then/i;
  check('circuit-breaker branch (30% stale) gates on min_population', circuitBreakerGuard.test(b));
  check('coverage-gate branch (50% coverage) gates on min_population', coverageGateGuard.test(b));

  // The bare `act >= 8` (or any number under 30) must not still be reachable anywhere in the body —
  // that would mean a stray un-migrated branch still carries the old, too-low floor.
  check('no remaining hardcoded act >= N check under 30 (old floor fully replaced)',
    !/act\s*>=\s*([0-7])\b/.test(b));

  // This function must still be report-only — the min-population fix must never resurrect the old
  // blind time-based deactivation this function had deliberately been neutered of.
  check('function still never sets active=false directly (report-only, unchanged)',
    !/set\s+active\s*=\s*false/i.test(b));
}

console.log(failures === 0
  ? '\n✓ stale-breaker minimum-population floor intact in the replayed final state\n'
  : `\n✗ ${failures} check(s) FAILED — the false-positive-suppression fix is not intact\n`);
process.exit(failures === 0 ? 0 : 1);
