// A JOB THAT READS WHAT ANOTHER JOB WRITES MUST BE SCHEDULED BEHIND IT — CHECKED AT REVIEW TIME.
//
// THE GAP THIS CLOSES (ops_incident #185, routine #10, 2026-09-12).
// -----------------------------------------------------------------
// `public.ops_cron_ordering_contract` declares producer→consumer cron dependencies as DATA, and
// `mon_detect_cron_ordering_contract()` enforces them in production twice an hour. That detector is
// well built and fails closed. But it is the ONLY enforcement, and it can only speak after the fact:
//
//   • a migration that reschedules a contracted job passes every PR check;
//   • the contract was violated exactly that way at ~14:00Z on 2026-09-11, by a migration applied
//     to production;
//   • a grep over scripts/ found `ops_cron_ordering_contract` in ONE file — a migration-content
//     baseline. No scripts/verify-*.ts covered it at all.
//
// That is docs/ops/BARRIER_ENGINEER.md PART 1.1 exactly: production behaviour covered by no check.
// The sibling shape it names is worth restating, because this is one instance of it: **a declared
// invariant that lives as DATA in an ops table, enforced only by a mon_detect_* function.**
//
// WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
// --------------------------------------------------------
// It applies the ordering decision (scripts/lib/cronOrdering.ts — the same semantics as the SQL
// detector, including its plain-subtraction gap) to the COMMITTED mirror,
// sql/mirrors/cron_ordering_contract.json. So a diff that reschedules a contracted job and updates
// the mirror, as AGENTS.md's apply-and-mirror rule requires, has its gap arithmetic checked BEFORE
// the migration is applied — which is the half that did not exist.
//
// It does NOT reconstruct each job's live schedule by parsing migrations, and that is a measured
// decision rather than laziness. Schedules are changed with `cron.alter_job(<numeric jobid>, …)`
// across 60 migrations in mixed shapes — positional, `job_id =>`, and via plpgsql variables — and
// jobid 109 has no literal match anywhere. A parser over that would either cry wolf or, far worse,
// silently miss the shape it could not read. A fragile parser inside a barrier is how a guard starts
// reading as protection while protecting nothing.
//
// THE RESIDUAL, STATED RATHER THAN PAPERED OVER: this file trusts the mirror's `schedules` block.
// A reschedule applied with `cron.alter_job` alone touches no migration text, so nothing here can
// see it, and this check still passes — that case remains caught by the live detector within 30
// minutes, exactly as it is today. So this barrier strictly ADDS review-time coverage and removes
// none; it does not make the mirror self-verifying.
//
// What it DOES close is the contract-table half: the mirror records the newest migration version
// that touches `ops_cron_ordering_contract`, recomputed here from the tree, so a migration that
// changes the CONTRACT without updating the mirror goes red on its own PR (see the
// APPLY-AND-MIRROR section below, and why a live read was refused rather than adopted).
//
//   node --experimental-strip-types scripts/verify-cron-ordering-contract.ts   (in `npm test`)

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ContractRow, hourlyMinute, mirrorCurrencyProblem, mirrorDriftProblems, orderingProblems,
} from './lib/cronOrdering.ts';

const ROOT = join(import.meta.dirname, '..');
const MIRROR = 'sql/mirrors/cron_ordering_contract.json';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught, 'the predicate did NOT report this defect');

console.log('\nA consumer cron job must trail its producer by the declared gap\n');

// ── the mirror must be READABLE. A missing or unparseable mirror is a failure, never a skip. ─────
if (!existsSync(join(ROOT, MIRROR))) {
  console.error(`FAIL  ${MIRROR} is missing — deleting the mirror must not disarm this check`);
  process.exit(1);
}
let mirror: { contract?: unknown; schedules?: unknown; _mirrored_through_migration?: unknown };
try {
  mirror = JSON.parse(readFileSync(join(ROOT, MIRROR), 'utf8'));
} catch (e) {
  console.error(`FAIL  ${MIRROR} did not parse as JSON: ${String(e)}`);
  process.exit(1);
}

const contract = mirror.contract as ContractRow[];
const schedules = (mirror.schedules ?? {}) as Record<string, string>;

check('the mirror declares a non-empty contract', Array.isArray(contract) && contract.length > 0,
  'an empty contract and a mirror that failed to parse are indistinguishable, and the empty '
  + 'reading would certify silence as health');

check('every contract row names both jobs and a numeric gap',
  Array.isArray(contract) && contract.every((c) => typeof c?.upstream_job === 'string'
    && typeof c?.downstream_job === 'string' && Number.isFinite(c?.min_gap_minutes)),
  'a row missing a field would be skipped by the ordering rule rather than refused');

// Every job named by a contract row must have a declared schedule. orderingProblems() refuses a
// missing one, but asserting it separately makes the failure readable.
const named = new Set(Array.isArray(contract)
  ? contract.flatMap((c) => [c.upstream_job, c.downstream_job]) : []);
for (const job of named) {
  check(`'${job}' has a declared schedule in the mirror`, typeof schedules[job] === 'string',
    'a contracted job with no schedule cannot be checked — apply-and-mirror is ONE change');
  if (typeof schedules[job] === 'string') {
    check(`'${job}' is a plain hourly schedule (ordering is evaluable)`, hourlyMinute(schedules[job]) !== null,
      `schedule '${schedules[job]}' is not ^\\d+ \\* \\* \\* \\*$ — the ordering guarantee cannot be `
      + 'computed and must be re-derived by hand, same as the live detector reports');
  }
}

// ── THE RULE ITSELF ─────────────────────────────────────────────────────────────────────────────
const problems = orderingProblems(contract, schedules);
check('every declared consumer trails its producer by at least the declared gap',
  problems.length === 0, problems.join('\n      '));

// ── the live detector must still EXIST in a committed migration ─────────────────────────────────
// This barrier covers review time; production is still the detector's job. If the detector were
// dropped, this file would keep passing over a mirror nobody enforces — so assert it is committed.
// A deliberately narrow source assertion: it asks whether the function is CREATED, not what it says
// (what it says is pinned by the shared predicate above, which the detector's semantics are copied
// into and which is mutation-proven below).
const migrations = join(ROOT, 'supabase/migrations');
const createsDetector = existsSync(migrations) && readFileSync(
  join(migrations, '20260819062809_cron_ordering_contract_overlay_after_sync.sql'), 'utf8',
).includes('mon_detect_cron_ordering_contract');
check('the production detector mon_detect_cron_ordering_contract is committed',
  createsDetector,
  'the review-time check above does not replace the production one — if the detector is gone, '
  + 'a reschedule applied without a mirror update is caught by nothing at all');

// ── APPLY-AND-MIRROR, ENFORCED FROM THE DIFF ALONE ──────────────────────────────────────────────
// The rule above is only worth anything while the mirror still describes the contract production
// enforces. The obvious way to check that is to read production — and that is exactly what this
// barrier must NOT do, for two independent reasons:
//
//   1. `npm test` is the REQUIRED PR check and its verdict must depend only on the diff. That is the
//      defect ops_incident #126 was opened for.
//   2. ops_cron_ordering_contract has RLS on with ZERO policies, so the anon path reads it as [] —
//      a privileged read is the only way, which means depending on a repo secret. A first draft of
//      this barrier did exactly that and `verify-live-checks-self-sufficient.ts` caught it: "a
//      scheduled barrier that cannot run protects nothing", the class where two live barriers had
//      NEVER EXECUTED ONCE because an unset secret expands to the empty string. That barrier is
//      right, so the design changed rather than the barrier (Prohibition 1). Granting anon a read
//      policy purely to satisfy a test was also refused: a test does not get to widen production's
//      public surface.
//
// So the drift question is answered WITHOUT production, from the tree: the mirror records the newest
// migration version that touches the contract table, and this recomputes it. A migration that
// changes the contract without updating the mirror goes RED on its own PR — which is the moment a
// human is actually looking. No secret, no network, and no SQL parsing: a filename and a substring.
const CONTRACT_TABLE = 'ops_cron_ordering_contract';
const VERSION = /^(\d{14})_/;
const touching = readdirSync(join(ROOT, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql') && VERSION.test(f))
  .filter((f) => readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8').includes(CONTRACT_TABLE))
  .map((f) => f.match(VERSION)![1])
  .sort();

const currency = mirrorCurrencyProblem(mirror._mirrored_through_migration, touching);
check(`the mirror is current with the newest migration touching ${CONTRACT_TABLE}`
  + ` (${touching[touching.length - 1] ?? '<none found>'})`,
  currency === null,
  `${currency}\n      APPLY-AND-MIRROR IS ONE CHANGE (AGENTS.md): re-read production, update the `
  + `rows/schedules in ${MIRROR}, and set _mirrored_through_migration to the new version.`
  + `\n      Do NOT resolve this by lowering a gap or deleting a row.`);

// ── MUTATION PROOFS — fed the REAL historical violations, not invented ones ──────────────────────
console.log('\n  mutation proof — the ordering rule, fed the violations it exists to catch\n');

const SCHED = { producer: '36 * * * *', consumer: '50 * * * *' };
const ROW: ContractRow[] = [{ upstream_job: 'producer', downstream_job: 'consumer', min_gap_minutes: 9 }];

// THE ORIGINAL DEFECT, verbatim from contract row 1's own `why`: the overlay ran at :06 and the sync
// at :14, so the overlay read its input 8 minutes BEFORE that input existed, and every newly
// ingested listing with a resolvable English city stayed unlocated for ~52 extra minutes.
mustCatch('the 2026-08-19 defect: the consumer running BEFORE its producer (overlay :06, sync :14)',
  orderingProblems(
    [{ upstream_job: 'sync-search-listings-ar', downstream_job: 'resolve-english-city-overlay', min_gap_minutes: 5 }],
    { 'sync-search-listings-ar': '14 * * * *', 'resolve-english-city-overlay': '6 * * * *' },
  ).some((p) => p.includes('below the required')));

// ops_incident #143: the sync at :14 ahead of the matview refresh at :20, so the served index was
// built from an hour-old snapshot and a reactivated listing stayed invisible for up to a full cycle.
mustCatch('ops_incident #143: the sync at :14 built the index from a matview not refreshed until :20',
  orderingProblems(
    [{ upstream_job: 'refresh_listing_native_location_v1', downstream_job: 'sync-search-listings-ar', min_gap_minutes: 7 }],
    { refresh_listing_native_location_v1: '20 * * * *', 'sync-search-listings-ar': '14 * * * *' },
  ).length > 0);

mustCatch('a gap that is positive but SHORTER than the producer can actually run (8 < 9)',
  orderingProblems(ROW, { producer: '36 * * * *', consumer: '44 * * * *' })
    .some((p) => p.includes('gap 8 min is below the required 9 min')));

mustCatch('a consumer moved to exactly the producer\'s own minute (gap 0)',
  orderingProblems(ROW, { producer: '36 * * * *', consumer: '36 * * * *' }).length > 0);

// The wraparound case the detector deliberately refuses: :05 behind :36 is NOT "29 minutes later".
mustCatch('a consumer that wraps into the next hour being read as though it trailed (gap -31)',
  orderingProblems(ROW, { producer: '36 * * * *', consumer: '5 * * * *' }).length > 0);

mustCatch('a contracted job whose schedule is MISSING (absence must not read as compliance)',
  orderingProblems(ROW, { producer: '36 * * * *' }).some((p) => p.includes('no declared schedule')));

mustCatch('a schedule that stopped being plain-hourly, so ordering is UNEVALUABLE',
  orderingProblems(ROW, { producer: '36 * * * *', consumer: '*/5 * * * *' })
    .some((p) => p.includes('unevaluable')));

mustCatch('a daily schedule smuggled in as evaluable (the minute field alone is not enough)',
  orderingProblems(ROW, { producer: '36 * * * *', consumer: '50 3 * * *' })
    .some((p) => p.includes('unevaluable')));

mustCatch('an EMPTY contract read as "no dependencies to check"',
  orderingProblems([], SCHED).length > 0);

mustCatch('a contract that did not parse as an array at all',
  orderingProblems(null as unknown as ContractRow[], SCHED).length > 0);

// ── negative controls: a rule that is red for everything guards nothing ─────────────────────────
mustCatch('…while the healthy pair is NOT flagged (gap 14 >= 9)',
  orderingProblems(ROW, SCHED).length === 0);

mustCatch('…and a gap EXACTLY at the floor is allowed, not off-by-one refused (gap 9 >= 9)',
  orderingProblems(ROW, { producer: '36 * * * *', consumer: '45 * * * *' }).length === 0);

mustCatch('…and the REAL committed mirror passes the same rule (this is not a fixture-only proof)',
  orderingProblems(contract, schedules).length === 0);

// ── the drift predicate the live half's verdict comes from, proven HERE so it is covered per-PR ──
mustCatch('a production contract row the committed mirror does not carry',
  mirrorDriftProblems(contract, [...contract, { upstream_job: 'a', downstream_job: 'b', min_gap_minutes: 3 }])
    .some((p) => p.includes('mirror does not')));
mustCatch('a mirror row production no longer holds (the per-PR check enforcing a dead dependency)',
  mirrorDriftProblems(contract, contract.slice(1)).some((p) => p.includes('production\'s contract does not')));
mustCatch('a gap production REVISED while the mirror kept the old floor (the real 5 -> 9 move)',
  mirrorDriftProblems(contract, contract.map((r, i) => (i === 0 ? { ...r, min_gap_minutes: r.min_gap_minutes + 4 } : r)))
    .some((p) => p.includes('production says')));
mustCatch('a failed contract read standing in for the contract itself',
  mirrorDriftProblems(contract, { message: 'permission denied' }).length > 0
  && mirrorDriftProblems(contract, []).length > 0);
mustCatch('…while the mirror compared against itself is NOT flagged (not vacuously red)',
  mirrorDriftProblems(contract, contract).length === 0);

// ── the apply-and-mirror currency rule ───────────────────────────────────────────────────────────
// This is the teeth that make the mirror trustworthy without a live read, so it is proven too.
mustCatch('a NEW migration touching the contract table while the mirror still claims the old version',
  mirrorCurrencyProblem('20260911152632', ['20260819062809', '20260911152632', '20260913000000'])
    ?.includes('also touches the contract table') === true);

mustCatch('a mirror that declares no _mirrored_through_migration at all',
  mirrorCurrencyProblem(undefined, ['20260819062809']) !== null);

mustCatch('an EMPTY declaration string (an unset field is not a version)',
  mirrorCurrencyProblem('', ['20260819062809']) !== null);

mustCatch('NO committed migration mentioning the contract table (drift, or a broken scan)',
  mirrorCurrencyProblem('20260911152632', []) !== null);

mustCatch('…while a mirror current with the newest migration is NOT flagged (not vacuously red)',
  mirrorCurrencyProblem('20260911152632', ['20260819062809', '20260911152632']) === null);

mustCatch('…and the REAL mirror against the REAL migration tree is current (not a fixture-only proof)',
  mirrorCurrencyProblem(mirror._mirrored_through_migration, touching) === null);

console.log(failures === 0
  ? '\n✓ every declared consumer trails its producer, and the rule is proven on the real violations\n'
  : `\n✗ ${failures} check(s) FAILED — a job would read an input that does not exist yet\n`);
process.exit(failures === 0 ? 0 : 1);
