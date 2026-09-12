// THE ORDERING RULE FOR JOBS THAT READ WHAT ANOTHER JOB WRITES — ONE DECISION, SHARED.
//
// WHY THIS EXISTS (routine #10, ops_incident #185, 2026-09-12).
// ------------------------------------------------------------
// `public.ops_cron_ordering_contract` declares, as DATA, that one cron job CONSUMES what another
// PRODUCES, and by how many minutes the consumer must trail its producer. It is enforced in
// production by `mon_detect_cron_ordering_contract()`, which runs twice an hour.
//
// That detector is good and it fails closed. What it cannot do is answer at REVIEW time: a migration
// that reschedules a contracted job passed every PR check and was caught only once it was already
// live. Measured: the contract was violated at ~14:00Z on 2026-09-11 by a migration applied to
// production, and a grep over scripts/ found `ops_cron_ordering_contract` in exactly one place —
// a migration-content baseline file. No `scripts/verify-*.ts` covered it at all.
//
// So this file holds the ordering decision as a PURE function, so that:
//   • `scripts/verify-cron-ordering-contract.ts` can apply it per-PR to the COMMITTED mirror
//     (sql/mirrors/cron_ordering_contract.json) and be mutation-proven against the real historical
//     violations, and
//   • the semantics cannot drift from the detector's, because they are written down once, here,
//     deliberately mirroring the SQL rather than re-deciding it.
//
// THE SEMANTICS ARE COPIED FROM THE LIVE DETECTOR ON PURPOSE, INCLUDING THE PART THAT LOOKS WRONG.
// The detector computes `gap := dn_min - up_min` — plain subtraction, NOT modulo 60. So a consumer at
// :05 behind a producer at :36 is a gap of -31 and is REFUSED, rather than being read as "29 minutes
// later, in the next hour". That is the stricter and intended reading: the contract is about the
// consumer trailing its producer WITHIN THE HOUR, because an hourly consumer that runs first reads an
// input that is up to a full cycle stale — which is the exact defect row 1 records (the overlay ran
// at :06 and the sync at :14, so every newly ingested listing with a resolvable English city stayed
// unlocated for ~52 extra minutes). If this ever needs to become modular arithmetic, it must change
// in the SQL first and here second, never here alone.

/** One declared producer→consumer dependency, as `ops_cron_ordering_contract` stores it. */
export type ContractRow = {
  upstream_job: string;
  downstream_job: string;
  min_gap_minutes: number;
};

/** jobname → cron expression, as `cron.job.schedule` stores it. */
export type Schedules = Record<string, string>;

/**
 * A plain hourly schedule, and nothing else, is evaluable: `^\d+ \* \* \* \*$`.
 * Same regex as the detector. Anything else means the ordering guarantee cannot be computed.
 */
const HOURLY = /^\d+ \* \* \* \*$/;

export const hourlyMinute = (schedule: string): number | null =>
  HOURLY.test(schedule) ? Number(schedule.split(' ')[0]) : null;

/**
 * Every way the declared schedules VIOLATE the declared contract. Empty means the ordering holds.
 *
 * FAILS CLOSED, in all three directions the detector does:
 *   • a contracted job with no schedule at all is a problem, never a skip — an absent entry and a
 *     healthy one must never look the same (AGENTS.md: A FAILED FETCH IS NOT AN EMPTY ANSWER, which
 *     binds a barrier's own reads too);
 *   • a schedule that is not plain-hourly is "unevaluable", which is a finding: the guarantee is gone
 *     and somebody has to re-derive it by hand;
 *   • an EMPTY contract is refused outright, because a mirror that failed to parse and a system with
 *     no dependencies are otherwise indistinguishable — and the empty reading would certify silence
 *     as health.
 */
export function orderingProblems(contract: ContractRow[], schedules: Schedules): string[] {
  const problems: string[] = [];

  if (!Array.isArray(contract) || contract.length === 0) {
    problems.push('the ordering contract is empty or did not parse as an array — an unread contract '
      + 'must never read as "no dependencies to check"');
    return problems;
  }

  for (const c of contract) {
    const up = schedules[c.upstream_job];
    const dn = schedules[c.downstream_job];

    if (up === undefined || dn === undefined) {
      problems.push(`${c.upstream_job} -> ${c.downstream_job}: `
        + `${up === undefined ? c.upstream_job : c.downstream_job} has no declared schedule`);
      continue;
    }

    const upMin = hourlyMinute(up);
    const dnMin = hourlyMinute(dn);
    if (upMin === null || dnMin === null) {
      problems.push(`${c.upstream_job} (${up}) -> ${c.downstream_job} (${dn}): `
        + 'not a plain hourly schedule, ordering is unevaluable');
      continue;
    }

    const gap = dnMin - upMin;
    if (gap < c.min_gap_minutes) {
      problems.push(`${c.upstream_job} at :${String(upMin).padStart(2, '0')} -> `
        + `${c.downstream_job} at :${String(dnMin).padStart(2, '0')}: `
        + `gap ${gap} min is below the required ${c.min_gap_minutes} min`);
    }
  }

  return problems;
}

/**
 * Is the committed mirror current with the newest migration that touches the contract table?
 *
 * This is AGENTS.md's apply-and-mirror rule made checkable from the DIFF ALONE — no secret, no
 * network, no SQL parsing. A live read was the obvious alternative and was refused twice over: the
 * required suite must be hermetic (ops_incident #126), and `ops_cron_ordering_contract` has RLS on
 * with zero policies, so only a privileged read works — which means depending on a repo secret,
 * the exact class `verify-live-checks-self-sufficient.ts` exists to forbid ("a scheduled barrier
 * that cannot run protects nothing").
 *
 * @param claimed  the mirror's `_mirrored_through_migration`
 * @param touching every migration VERSION whose SQL mentions the contract table, ascending
 */
export function mirrorCurrencyProblem(claimed: unknown, touching: string[]): string | null {
  if (touching.length === 0) {
    // Not a pass: either the table was created by a migration that was never committed (the drift
    // AGENTS.md's "Migration drift guard" is about) or the scan is broken.
    return 'no committed migration mentions the contract table at all — either it was never '
      + 'committed (schema drift) or this scan is broken; neither is a clean bill of health';
  }
  const newest = touching[touching.length - 1];
  if (typeof claimed !== 'string' || claimed.length === 0) {
    return `the mirror does not declare _mirrored_through_migration (newest is ${newest}) — without `
      + 'it, a contract change can land with no mirror update and nothing would notice';
  }
  if (claimed !== newest) {
    return `the mirror claims to be current through ${claimed}, but ${newest} also touches the `
      + 'contract table — apply-and-mirror is ONE change';
  }
  return null;
}

/**
 * Ways the COMMITTED mirror disagrees with what production's contract table actually holds.
 *
 * The mirror is the per-PR input, so a mirror that has drifted from production would let this class
 * be certified against a contract nobody is enforcing. Compared by the (upstream, downstream) pair
 * and the gap — the three fields the ordering decision reads. `why` is prose and is not compared.
 */
export function mirrorDriftProblems(mirror: ContractRow[], live: unknown): string[] {
  const problems: string[] = [];

  if (!Array.isArray(live)) {
    problems.push('ops_cron_ordering_contract did not read back as an array — a failed PostgREST '
      + `read arrives as a JSON object, not a throw, so this is UNANSWERED: ${JSON.stringify(live).slice(0, 200)}`);
    return problems;
  }
  if (live.length === 0) {
    problems.push('ops_cron_ordering_contract read back EMPTY — an empty result and a filtered or '
      + 'unauthorised read are indistinguishable, so this cannot mean "the contract has no rows"');
    return problems;
  }

  const key = (c: ContractRow) => `${c.upstream_job} -> ${c.downstream_job}`;
  const mirrorBy = new Map(mirror.map((c) => [key(c), c]));
  const liveBy = new Map((live as ContractRow[]).map((c) => [key(c), c]));

  for (const [k, l] of liveBy) {
    const m = mirrorBy.get(k);
    if (!m) {
      problems.push(`production declares "${k}" (gap ${l.min_gap_minutes} min) but the committed `
        + 'mirror does not — apply-and-mirror is ONE change (AGENTS.md)');
      continue;
    }
    if (m.min_gap_minutes !== l.min_gap_minutes) {
      problems.push(`"${k}": mirror says ${m.min_gap_minutes} min, production says `
        + `${l.min_gap_minutes} min`);
    }
  }
  for (const k of mirrorBy.keys()) {
    if (!liveBy.has(k)) {
      problems.push(`the committed mirror declares "${k}" but production's contract does not — the `
        + 'per-PR check would be enforcing a dependency nobody is watching');
    }
  }

  return problems;
}
