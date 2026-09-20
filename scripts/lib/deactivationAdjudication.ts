// A DELIBERATE DEACTIVATION AND AN ACCIDENTAL ONE ARE THE SAME ROW — THE REGISTER IS WHAT SEPARATES THEM.
//
// `auto_recover_false_inactive()` (pg_cron jobid 30, 05:20 UTC daily) reactivates every listing that
// is inactive with zero strikes, because that is the signature of a row flipped by something other
// than the strike ladder. A deliberate withdrawal has EXACTLY that signature, for the same reason:
// it was never struck, because a decision was made about it instead. The job's own clauses are the
// only things that can tell the two apart:
//
//     active = false
//     and coalesce(missing_count, 0) = 0          <- a raised strike count also protects
//     and deactivated_at >= now() - 24h           <- true for anything just applied
//     and not exists (... ops_adjudicated_listing ...)   <- the documented protection
//
// So a migration that deliberately deactivates listings and does NEITHER is undone within a day,
// silently, and the symptom looks exactly like a scraper bug. That is not hypothetical: the owner
// said «delete the 99» about راكز's off-plan units on 2026-09-14, migration 20260914181618
// deactivated them, nothing was registered, and they were active again the next morning. Three days
// were then spent suspecting a scraper that was innocent throughout.
//
// AGENTS.md records the rule (2026-09-18). It records no CHECK — which is why, in the three
// deactivating migrations that landed AFTER it, the documented register was used exactly zero times.
// Measured 2026-09-20: 20260919010944 (six wasalt listings proven 404 on both language routes)
// survives only because its author raised missing_count to 3 for *monitoring consistency*, a reason
// the migration's own comment gives as internal tidiness rather than as the thing keeping six dead
// listings out of search; and 20260919230553 (four down sites) survives only because the owner
// reversed it five minutes later. Neither used the register. Nothing would have said so.
//
// This module is the predicate; `scripts/verify-deliberate-deactivation-is-adjudicated.ts` is the
// barrier over it. Both import the ONE migration parser the repo already uses for this shape
// (`repairClassifier.ts`) rather than adding a second — an UPDATE inside a `create function` body is
// a definition, not an execution, and a register named in a COMMENT is documentation, not a write.

import { executedSql, stripSqlComments, LISTING_TABLE, migrationVersion } from './repairClassifier.ts';

/** The two ledgers behind `ops_adjudicated_listing`. Consumers read the VIEW; a migration WRITES to
 *  a ledger, so the write side has to name both. Kept in step with
 *  `scripts/verify-adjudication-is-never-undone.ts`, which owns the read side of the same rule. */
export const ADJUDICATION_LEDGERS = [
  'ops_adjudicated_retraction',
  'ops_res_com_collision_adjudication',
] as const;

/** The recovery job's schedule, as a UTC hour/minute. pg_cron jobid 30: `20 5 * * *`. */
export const RECOVERY_HOUR_UTC = 5;
export const RECOVERY_MINUTE_UTC = 20;

/** Enforcement starts with the rule (AGENTS.md, 2026-09-18). Everything earlier is pinned as
 *  KNOWN_BACKLOG by the barrier — visible on every run, never silently waived. */
export const ADJUDICATION_ERA_BASELINE = '20260918000000';

/** Does this migration's EXECUTED sql set `active = false` on a listing table?
 *
 *  Two shapes both count, because the repo writes both: a literal `update <t> set active = false`,
 *  and the dynamic `execute format('update public.%I set active = false ...', v_tbl)` loop that
 *  20260919230553 used over eight tables at once. A checker that saw only the literal shape would
 *  have scored the four-down-sites migration as touching nothing. */
export function deactivatesListings(sql: string): boolean {
  const body = executedSql(stripSqlComments(sql));

  const re = /\bupdate\s+(?:only\s+)?([a-z_][a-z0-9_.]*)/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const table = m[1].toLowerCase().replace(/^public\./, '');
    if (!LISTING_TABLE.test(table)) continue;
    // `set ... active = false` within the statement that follows.
    if (/\bset\b[\s\S]{0,400}?\bactive\s*=\s*false\b/i.test(body.slice(m.index, m.index + 600))) {
      return true;
    }
  }
  // Dynamic, table-name-interpolated deactivation.
  return /format\(\s*['"][\s\S]{0,300}?update[\s\S]{0,300}?active\s*=\s*false/i.test(body);
}

export type Protection = 'adjudicated' | 'missing_count' | 'reactivated';

/** Which of the recovery job's escape clauses does this migration's EXECUTED sql actually satisfy?
 *
 *  `missing_count` counts because the LIVE function counts it — `coalesce(missing_count,0) = 0` is a
 *  real clause, and pretending only the register protects would fail migrations that are genuinely
 *  safe. It is recorded as a WEAKER protection than the register and the barrier says so: it is a
 *  number any later re-scrape may reset, where an adjudication is a decision that persists. */
export function protectionsIn(sql: string): Set<Protection> {
  const body = executedSql(stripSqlComments(sql));
  const found = new Set<Protection>();

  const ledgers = ADJUDICATION_LEDGERS.join('|');
  if (new RegExp(`insert\\s+into\\s+(?:public\\.)?(?:${ledgers})\\b`, 'i').test(body)) {
    found.add('adjudicated');
  }
  // A non-zero strike count. `missing_count = 0` is the OPPOSITE of a protection — it puts the row
  // squarely back inside the recovery predicate — so it must not match. Read the assigned value and
  // judge it; a negative lookahead cannot do this job, because `\s*` backtracks to zero width and
  // the lookahead then reads the SPACE instead of the `0` and succeeds. (Watched that exact mutation
  // survive on 2026-09-20 before this was rewritten.)
  for (const m of body.matchAll(/missing_count\s*=\s*([^\s,;)]+)/gi)) {
    if (!/^0+$/.test(m[1])) { found.add('missing_count'); break; }
  }
  if (/\bactive\s*=\s*true\b/i.test(body)) found.add('reactivated');

  return found;
}

/** `20260919230553` → epoch ms, read as UTC. Migration versions are UTC wall-clock stamps minted
 *  server-side by `apply_migration`, so they are directly comparable to the cron schedule. */
export function versionToUtcMs(version: string): number {
  const v = version.padEnd(14, '0');
  return Date.UTC(
    Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)),
    Number(v.slice(8, 10)), Number(v.slice(10, 12)), Number(v.slice(12, 14)),
  );
}

/** Does a recovery run (05:20 UTC) fall in the half-open interval (from, to]?
 *
 *  THIS is why a companion migration is not automatically a rescue. Protection landing five minutes
 *  later (20260919230553 → 20260919231035) is genuinely safe: no 05:20 passed in between, so the
 *  job never saw the rows unprotected. Protection landing the NEXT AFTERNOON is not safe, however
 *  short the diff looks in a file listing — that is the rakez shape exactly, where 20260914181618
 *  deactivated and 20260918172239 adjudicated, with four 05:20 runs in between and the rows live
 *  again after the first one. A window measured in hours would have called that a rescue. */
export function recoveryRunsBetween(fromVersion: string, toVersion: string): number {
  const from = versionToUtcMs(fromVersion);
  const to = versionToUtcMs(toVersion);
  if (!(to > from)) return 0;

  let runs = 0;
  // First candidate run at or after `from`, walking day by day.
  const d = new Date(from);
  d.setUTCHours(RECOVERY_HOUR_UTC, RECOVERY_MINUTE_UTC, 0, 0);
  let t = d.getTime();
  if (t <= from) t += 86_400_000;
  for (; t <= to; t += 86_400_000) runs++;
  return runs;
}

export type DeactivationInput = {
  version: string;
  /** Protections satisfied by the deactivating migration itself. */
  own: Set<Protection>;
  /** Later migrations that satisfy a protection, as `[version, protections]`, any order. */
  companions: Array<[string, Set<Protection>]>;
  /** A waiver reason, if one is registered for this version. */
  waiver?: string;
};

export type DeactivationVerdict = {
  protected: boolean;
  via: 'own' | 'companion' | 'waiver' | 'none';
  /** Which clause protects it, when one does. */
  clause?: Protection;
  /** The companion migration that rescued it, when one did. */
  companionVersion?: string;
  reason: string;
};

export const MIN_WAIVER_REASON = 20;

/** The whole rule, in one pure function so the barrier and its mutation proofs test the same code. */
export function deactivationVerdict(input: DeactivationInput): DeactivationVerdict {
  // 1. The migration protects itself. Strongest and the only shape that is safe by construction.
  for (const clause of ['adjudicated', 'missing_count', 'reactivated'] as const) {
    if (input.own.has(clause)) {
      return { protected: true, via: 'own', clause, reason: `same migration sets ${clause}` };
    }
  }

  // 2. A companion rescues it ONLY if no recovery run got there first.
  const rescues = input.companions
    .filter(([v]) => versionToUtcMs(v) > versionToUtcMs(input.version))
    .sort((a, b) => versionToUtcMs(a[0]) - versionToUtcMs(b[0]));
  for (const [v, prot] of rescues) {
    if (prot.size === 0) continue;
    if (recoveryRunsBetween(input.version, v) === 0) {
      const clause = (['adjudicated', 'reactivated', 'missing_count'] as const).find((c) => prot.has(c))!;
      return {
        protected: true, via: 'companion', clause, companionVersion: v,
        reason: `${v} sets ${clause} before any 05:20 UTC recovery run`,
      };
    }
  }

  // 3. A waiver is a REASON, not a mute button.
  if (input.waiver && input.waiver.trim().length >= MIN_WAIVER_REASON) {
    return { protected: true, via: 'waiver', reason: input.waiver.trim() };
  }

  const late = rescues.find(([v, p]) => p.size > 0);
  return {
    protected: false, via: 'none',
    reason: late
      ? `unprotected: the nearest protection is ${late[0]}, ${recoveryRunsBetween(input.version, late[0])} recovery run(s) too late`
      : 'unprotected: neither the adjudication register, a raised missing_count, nor a reactivation',
  };
}
