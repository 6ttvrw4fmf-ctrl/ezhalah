// AN AUTOMATIC SUPERSESSION IS A KILL, AND A KILL MUST LEAVE EVIDENCE.
//
// THE DEFECT THIS EXISTS TO CONTAIN (ops_incident #275, measured 2026-09-18, routine #11)
// ---------------------------------------------------------------------------------------
// `db.retire_superseded_siblings()` deactivates a listing whenever THIS run positively classified
// its ad_number into the sibling table — the res/com URL-collision repair that migration
// 20260830140110 exists for. It wrote `{active: false, deactivated_at}` and nothing else. So an
// automatic retirement was, in SQL, indistinguishable from a crawl that timed out.
//
// `mon_detect_unknown_treated_as_dead` (P1) asks exactly the right question — *was this row set
// active=false with no verdict recorded against its ad_number at the time?* — and answered "no
// evidence" for a kill carrying POSITIVE evidence: the source page was parsed this run and said
// the ad belongs to the other table. Measured across the seven wired platforms: 16 retirements in
// 30 days, every one evidence-free, every one confirmed a genuine supersession by an ACTIVE sibling
// row holding the same ad_number (sadin_commercial 5, amaall_residential 6, dealapp_residential 4,
// arkaan_residential 1).
//
// The exclusion the detector already had (migration 20260913144532) reads
// `ops_res_com_collision_adjudication`, whose only writer is a human/agent session — so the
// suppression for an AUTOMATIC path was written by hand (arkaan AK907) or not at all (AK920).
// docs/ops/LISTING_LIFECYCLE_ENGINEER.md §8.3 calls that detector the highest-value one in §4 and
// "the one that can least afford to cry wolf"; a detector readers learn to dismiss is a detector
// that is dark on the day it is right. This is scrapers/common/sold_pin.py's lesson (§4.1b) applied
// to the other automatic kill path: the actor that performs the kill writes the evidence for it.
//
// WHAT THIS BARRIER DOES, in halves that answer different questions:
//
//   1. BEHAVIOUR, by EXECUTION. `plan_supersession_evidence()` is lifted out of the real module and
//      RUN, here and against deliberately mutated copies of its own source. AGENTS.md's hardest-won
//      rule is that a barrier reading source as TEXT can pass for the entire time the defect is
//      live — and this defect's own neighbour (test_sold_pin_coverage.py) did exactly that.
//
//   2. THE CROSS-FILE CONTRACT, by executing one half and reading the other. The verdict string the
//      Python writes is obtained by RUNNING the module, not by grepping for a literal, and is then
//      required to appear both in the committed CHECK constraint (or the insert is rejected at
//      runtime and every kill silently loses its evidence again) and in the committed detector's
//      exclusion predicate (or the evidence is written and still ignored). Renaming the constant on
//      one side of that contract is RED.
//
//   3. SINGLE WRITER, by discovery. The supersession update payload may appear nowhere under
//      scrapers/ except the shared law, so a second private retirement path written tomorrow is RED
//      without anyone registering it — the failure direction this repo has been burned by is the
//      opposite one (a guard that silently never covers the new case).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';

const ROOT = join(import.meta.dirname, '..');
const SCRAPERS = join(ROOT, 'scrapers');
const LAW = join(SCRAPERS, 'common', 'db.py');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const problems: string[] = [];
const lawSrc = readFileSync(LAW, 'utf8');

// ── Half 1: behaviour, by EXECUTING the real law ────────────────────────────────────────────────
type Row = Record<string, unknown>;

const run = (calls: unknown[][], mutated?: string): Row[][] =>
  pyCall(ROOT, 'scrapers.common.db', 'plan_supersession_evidence', calls, mutated) as Row[][];

const RETIRED = ['AK920', 'AK931', 'AK944'];
const TABLE = 'arkaan_residential_listings';
const SIBLING = 'arkaan_commercial_listings';
const ROWS = [
  { id: 11, ad_number: 'AK920', listing_url: 'https://arkaan.example/p/920' },
  { id: 12, ad_number: 'AK931', listing_url: 'https://arkaan.example/p/931' },
  { id: 13, ad_number: 'AK944', listing_url: 'https://arkaan.example/p/944' },
];

/**
 * The invariant, stated so it does not pin today's implementation (§4.2): every ad this plan
 * retires gets exactly one ledger row, keyed to the row that was killed, carrying a verdict that is
 * NOT a claim about the source and a non-empty oracle saying which table superseded it.
 */
const evidenceIsSound = (ads: string[], ev: Row[]): boolean =>
  ev.length === ads.length
  && ev.every((e, i) =>
    e.ad_number === ads[i]
    && e.source_table === TABLE
    // Not GONE: the listing_url is still served, by the sibling. Filing a supersession as GONE puts
    // a false source verdict in the ledger mon_detect_prune_kill_without_source_verdict,
    // mon_detect_deletion_clock_without_evidence and ops_lifecycle_false_resurrection all read.
    && e.verdict !== 'GONE' && e.verdict !== 'LIVE'
    && typeof e.verdict === 'string' && e.verdict.trim().length > 0
    && typeof e.oracle === 'string' && e.oracle.trim().length > 0
    && typeof e.note === 'string' && (e.note as string).includes(SIBLING));

let real: Row[][];
try {
  real = run([
    [RETIRED, TABLE, SIBLING, ROWS],
    [['AK920', 'AK920', 'AK931'], TABLE, SIBLING, ROWS],
    [[], TABLE, SIBLING, ROWS],
    [RETIRED, TABLE, SIBLING, null],
  ]);
} catch (e) {
  console.error(`RED  verify-supersession-kill-leaves-evidence: could not EXECUTE plan_supersession_evidence — ${e}`);
  process.exit(1);
}

const [plain, duped, empty, noRows] = real;
if (!evidenceIsSound(RETIRED, plain)) {
  problems.push(
    'EXECUTED plan_supersession_evidence(): a retired batch did not produce one sound ledger row ' +
    'per retired ad — this is the exact state the seven wired platforms shipped in (16 ' +
    'evidence-free retirements in 30 days)');
}
if (plain.some(e => e.listing_id === null || e.listing_id === undefined)) {
  problems.push(
    'EXECUTED plan_supersession_evidence(): a ledger row carries no listing_id although the killed ' +
    'row was supplied — identity must be pinned to the row that was actually retired, not inferred ' +
    'from an ad_number later (the sanadak lesson: a stored URL is not automatically THIS listing\'s)');
}
if (duped.length !== 2 || !evidenceIsSound(['AK920', 'AK931'], duped)) {
  problems.push(
    'EXECUTED plan_supersession_evidence(): a duplicated ad_number produced two ledger rows ' +
    'claiming two separate retirements of one row');
}
if (empty.length !== 0) {
  problems.push('EXECUTED plan_supersession_evidence(): a retirement of nothing still filed evidence');
}
if (noRows.length !== RETIRED.length || noRows.some(e => e.ad_number === undefined)) {
  problems.push(
    'EXECUTED plan_supersession_evidence(): with no row detail available the evidence was dropped ' +
    'entirely — a thinner row is still evidence, and silence here is the whole defect');
}

// ── Half 2: the cross-file contract, verdict obtained by EXECUTION ───────────────────────────────
let verdict = '';
try {
  // Read the constant by RUNNING the module — a grep for the literal would pass against a barrier
  // that has drifted from the code it claims to protect.
  verdict = String((run([[['X'], TABLE, SIBLING, null]])[0][0] as Row).verdict ?? '');
} catch { /* the execution failure above has already been reported */ }

if (!verdict) {
  problems.push('could not read the supersession verdict by executing the law');
} else {
  const migs = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
  const constraintMig = migs.find(f => {
    const s = readFileSync(join(MIGRATIONS, f), 'utf8');
    return s.includes('ops_stale_inactivation_probe_verdict_check') && s.includes(`'${verdict}'`);
  });
  if (!constraintMig) {
    problems.push(
      `no committed migration admits verdict '${verdict}' into ` +
      'ops_stale_inactivation_probe_verdict_check — every supersession insert would be REJECTED by ' +
      'the CHECK at runtime, the write is best-effort, and so every kill silently loses its ' +
      'evidence again exactly as before');
  }
  const detectorMig = migs.find(f => {
    const s = readFileSync(join(MIGRATIONS, f), 'utf8');
    return s.includes('mon_detect_unknown_treated_as_dead') && s.includes(`p.verdict = '${verdict}'`);
  });
  if (!detectorMig) {
    problems.push(
      `no committed migration teaches mon_detect_unknown_treated_as_dead to read verdict ` +
      `'${verdict}' — the evidence would be written and still ignored, and the P1 would go on ` +
      'counting every automatic supersession as a kill on unknown evidence');
  } else {
    const s = readFileSync(join(MIGRATIONS, detectorMig), 'utf8');
    const clause = s.slice(s.indexOf(`p.verdict = '${verdict}'`));
    // Time-bounded on BOTH sides, exactly like the hand-adjudication exclusion beside it: an old
    // supersession must never be able to excuse a FRESH kill on the same id.
    if (!/between d\.deactivated_at - interval '1 hour'\s*\n?\s*and d\.deactivated_at \+ interval '1 hour'/.test(clause.slice(0, 400))) {
      problems.push(
        `the '${verdict}' exclusion in mon_detect_unknown_treated_as_dead is not bounded on both ` +
        'sides of the deactivation — an old ledger row could excuse a fresh kill on the same id, ' +
        'which is the blind spot ops_incident #275 explicitly said not to open');
    }
    if (!s.includes('auto_supersession_excluded')) {
      problems.push(
        'the supersession exclusion is subtracted from the P1 counts without being REPORTED in the ' +
        'alert payload — migration 20260913144532 established that an exclusion a reader cannot ' +
        'see is how a detector quietly stops covering a class');
    }
  }
}

// ── Half 3: single writer, discovered by shape ──────────────────────────────────────────────────
const PAYLOAD = '{"active": False, "deactivated_at": now}';
if (!lawSrc.includes(PAYLOAD)) {
  problems.push(
    'scrapers/common/db.py no longer spells the supersession update payload — this barrier\'s ' +
    'single-writer half is measuring nothing and must be re-pointed at the real one');
}
if (!lawSrc.includes('plan_supersession_evidence(stale, table, other, rows)')) {
  problems.push(
    'retire_superseded_siblings() no longer calls plan_supersession_evidence() — the planner can be ' +
    'perfect and still write nothing if the retirement stops asking it');
}
if (!lawSrc.includes('ops_stale_inactivation_probe')) {
  problems.push('scrapers/common/db.py no longer writes ops_stale_inactivation_probe at all');
}

const platforms = readdirSync(SCRAPERS, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(SCRAPERS, d.name, 'run.py')))
  .map(d => d.name).sort();
const callers: string[] = [];
for (const p of platforms) {
  const src = readFileSync(join(SCRAPERS, p, 'run.py'), 'utf8');
  if (src.includes('retire_superseded_siblings(')) callers.push(p);
  if (src.includes(PAYLOAD)) {
    problems.push(
      `scrapers/${p}/run.py spells out the supersession update payload locally — that is a private ` +
      'copy of the retirement, and the clause a copy loses is the per-row evidence row (the ' +
      'eleven-sold-pin shape, §4.1b)');
  }
}
if (callers.length === 0) {
  problems.push(
    'discovered ZERO scrapers calling retire_superseded_siblings() — the discovery predicate is ' +
    'broken, and a barrier that covers nothing reads exactly like a barrier with nothing to report');
}

// ── The mutations: re-introduce the defect and watch the predicates above go red ─────────────────
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) problems.push(`MUTATION NOT CAUGHT: ${label}`);
};
const mutate = (from: string, to: string): string => {
  if (!lawSrc.includes(from)) {
    problems.push(`mutation target vanished from db.py: ${from.slice(0, 60)}…`);
    return lawSrc;
  }
  return lawSrc.replace(from, to);
};

// 1. THE SHIPPED DEFECT: retire the rows, record nothing.
mustCatch('the ledger rows stop being produced at all (the shipped defect)',
  !evidenceIsSound(RETIRED, run([[RETIRED, TABLE, SIBLING, ROWS]],
    mutate('    seen, evidence = set(), []', '    seen, evidence = set(), []\n    return []'))[0]));

// 2. A DIFFERENT WRONG WAY (§4.2 — re-mutate, or the barrier is narrower than it reads): the rows
//    ARE written, as GONE. The P1 goes quiet and the ledger now asserts a source verdict nobody
//    obtained, to four other detectors that read exactly that column.
mustCatch('a supersession filed as a GONE verdict about the source',
  !evidenceIsSound(RETIRED, run([[RETIRED, TABLE, SIBLING, ROWS]],
    mutate('SUPERSESSION_VERDICT = "SUPERSEDED"', 'SUPERSESSION_VERDICT = "GONE"'))[0]));

// 3. A THIRD WAY: rows written with no oracle, so the kill is in the ledger and still unfalsifiable.
mustCatch('ledger rows written WITHOUT the oracle naming why the row was retired',
  !evidenceIsSound(RETIRED, run([[RETIRED, TABLE, SIBLING, ROWS]],
    mutate('SUPERSESSION_ORACLE = "res_com.sibling_classified_this_run"',
           'SUPERSESSION_ORACLE = ""'))[0]));

// 4. The blank-sibling refusal removed — evidence could then be filed naming no superseding table.
{
  console.log('     (the Python traceback below is EXPECTED — mutation 4 asserts the law refuses a blank superseding_table)');
  let threw = false;
  try { run([[RETIRED, TABLE, '', ROWS]]); } catch { threw = true; }
  mustCatch('a blank superseding_table being accepted instead of refused', threw);
}

// 5. Identity dropped: rows filed without the listing_id of the row actually killed.
mustCatch('ledger rows filed without the identity of the row that was retired',
  run([[RETIRED, TABLE, SIBLING, ROWS]],
    mutate('            "listing_id": row.get("id"),', '            "listing_id": None,'))[0]
    .some(e => e.listing_id === null));

if (problems.length) {
  console.error('RED  verify-supersession-kill-leaves-evidence\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(
  `PASS verify-supersession-kill-leaves-evidence — ${callers.length} platforms (${callers.join(', ')}) ` +
  `route through the one shared retirement; plan_supersession_evidence() executed, verdict ` +
  `'${verdict}' honoured by both the committed CHECK and the committed detector, 5 mutations caught`);
