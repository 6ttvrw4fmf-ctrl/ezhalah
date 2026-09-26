// CAN THIS PLATFORM'S ORACLE EVER RETIRE ANYTHING? — the judgement, in one place.
//
// WHY IT EXISTS (routine #3, 2026-09-26). muktamel's prune_unseen.verify_gone oracle had been asked
// 1,132 times and had returned UNKNOWN on every single one — zero GONE, zero LIVE — while every
// monitor read green over 3,864 active listings, 443 of them under strike.
//
// The thing that hid it is the shape LISTING_LIVENESS.md §9.6 names: a tier is a MECHANISM,
// coverage is EVIDENCE, and reading one as the other switches monitors off.
// mon_detect_oracle_chain_never_observed() clears a platform on
//     verified_ever > 0  OR  verdicts > 0
// and BOTH limbs cleared muktamel: `verdicts` counted probe rows of ANY verdict (so UNKNOWN — the
// oracle saying "I could not tell" — read as proof the chain works), and its own-page ALIVE stamps
// put verified_ever at 1,703. A detector asking "has this chain EVER been observed?" structurally
// cannot see a platform that can confirm life and never death.
//
// UNKNOWN never kills — liveness_contract.decide() returns action='none' — so this deactivates
// nothing and no listing needs restoring. The harm runs the other way, and it is the owner's own
// second sentence in §9: a checker that has stopped working must itself be detected, "instead of
// silently accumulating stale listings".
//
// This module is the WHERE clause of public.mon_oracle_never_retires() expressed as a pure
// function, so the rule can be fed a broken world and watched to fail. The live half
// (scripts/verify-oracle-never-retires-live.ts) applies THIS function to production's raw counts
// and asserts the real SQL returns the identical platform set — so if the two ever drift apart,
// that is RED, and neither copy can quietly become the only one that is right.

/** The floor is not a new number: it is liveness_trust.MIN_PROBES_FOR_TRUST, the same value
 *  mon_detect_liveness_oracle_untrustworthy() uses, so "asked enough to judge" means one thing
 *  across the fleet. Below it, an all-UNKNOWN run is two timeouts, not a broken oracle. */
export const MIN_ASKS_FOR_JUDGEMENT = 25;

/** Only these two are answers. UNKNOWN is the absence of one. */
export const AFFIRMATIVE_VERDICTS = ['GONE', 'LIVE'] as const;

/** A platform only claims a direct oracle under these two strategies; CRAWL_PRESENCE_ONLY makes no
 *  such claim, so it is a different detector's question (mon_detect_unknown_treated_as_dead). */
export const ORACLE_CLAIMING_STRATEGIES = ['DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT'] as const;

export type PlatformOracleFacts = {
  platform: string;
  strategy: string;
  /** active listings held by the platform */
  active: number;
  /** verify_gone probe rows recorded, of ANY verdict */
  asks: number;
  /** verify_gone probe rows whose verdict was GONE or LIVE */
  affirmative: number;
};

/**
 * True when this platform claims a direct oracle, holds inventory, has been asked enough times to
 * judge, and has NEVER received an affirmative answer.
 *
 * Every clause is load-bearing and each is mutation-proven by the hermetic half:
 *  - strategy    a CRAWL_PRESENCE_ONLY platform makes no oracle claim to falsify;
 *  - active > 0  a platform holding nothing strands nothing;
 *  - asks >= min a handful of UNKNOWNs is a bad afternoon, not a broken oracle;
 *  - affirm == 0 ONE real GONE or LIVE proves the chain can answer. This is the clause the old
 *                detector was missing: it counted UNKNOWN as an answer.
 */
export function oracleNeverRetires(
  f: PlatformOracleFacts,
  minAsks: number = MIN_ASKS_FOR_JUDGEMENT,
): boolean {
  if (!(ORACLE_CLAIMING_STRATEGIES as readonly string[]).includes(f.strategy)) return false;
  if (f.active <= 0) return false;
  if (f.asks < minAsks) return false;
  return f.affirmative === 0;
}

/** The flagged set, sorted, so two sources of the same truth can be compared as strings. */
export function neverRetiringPlatforms(
  rows: readonly PlatformOracleFacts[],
  minAsks: number = MIN_ASKS_FOR_JUDGEMENT,
): string[] {
  return rows.filter((r) => oracleNeverRetires(r, minAsks)).map((r) => r.platform).sort();
}
