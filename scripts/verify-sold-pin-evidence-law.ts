// A SOURCE-CONFIRMED KILL MUST LEAVE EVIDENCE — and the law that says so lives in ONE place.
//
// THE CLASS THIS EXISTS TO CONTAIN (measured 2026-09-14, routine #11)
// -------------------------------------------------------------------
// Eleven scrapers read a real, named, DIRECT removal signal on the listing's own page — satel's
// `property_status` reading "Rented out", alta/amaall/eastabha's «تم البيع»/«تم التأجير», hajer and
// jurash's status badge, awal's `is-sold` class, ramzalqasim's `availability`, aqaratikom's
// `is_sold`, dealapp's `offers.availability`, abeea's property status — and correctly deactivate on
// it. Each carried a byte-identical private copy of the pin body. The per-row EVIDENCE write was
// added to exactly ONE of those copies (abeea) and no mechanism carried it to the other ten.
//
// Read over the whole `ops_stale_inactivation_probe` ledger that day: of the eleven platforms with a
// sold pin, exactly one had ever written a row. So ten platforms' BEST-evidenced deactivations were,
// in SQL, indistinguishable from a crawl that timed out — and `mon_detect_unknown_treated_as_dead`
// (P1), which asks precisely "was this row set active=false with no GONE verdict recorded against
// its ad_number at the time?", answered "no evidence" for kills that had the best evidence in the
// system. alert_event 2682 flagged three satel rows; a DIRECT fetch of each listing's own URL
// returned HTTP 200 carrying satel's own «Rented out» status on all three. Every kill was earned.
// docs/ops/LISTING_LIFECYCLE_ENGINEER.md §8.3 calls that detector the highest-value one in §4 and
// "the one that can least afford to cry wolf" — a detector readers learn to dismiss is a detector
// that is dark on the day it is right.
//
// This is the shape scrapers/common/http_liveness.py was created to end: the LAW is universal and
// only the SIGNAL is per-platform; N private copies of a law is N chances to omit a clause, and an
// omission looks exactly like a correct copy until something is destroyed.
//
// WHAT THIS BARRIER DOES, in two halves that answer different questions:
//
//   1. WIRING, by DISCOVERY, not by a list. Every scrapers/<p>/run.py that defines a
//      `_pin_sold_inactive` helper must route through `sold_pin.pin_source_confirmed_gone(` and
//      name a non-empty `oracle=`; and the canonical pin payload literal may not appear anywhere
//      under scrapers/ except in the shared law itself. So a TWELFTH copy-paste written tomorrow is
//      RED without anyone remembering to register it — the failure mode this repo has been burned
//      by is the opposite one (a barrier that silently never covers the new case).
//
//   2. BEHAVIOUR, by EXECUTION. `plan_pin()` is lifted out of the real module and RUN, here and
//      against deliberately mutated copies of its own source, because AGENTS.md's hardest-won rule
//      is that a barrier reading source as TEXT can pass for the entire time the defect is live —
//      and this defect's own predecessor barrier (test_sold_pin_coverage.py) did exactly that: it
//      asserted the pin PAYLOAD in all eleven copies, and the payload was never the missing part.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';

const ROOT = join(import.meta.dirname, '..');
const SCRAPERS = join(ROOT, 'scrapers');
const LAW = join(SCRAPERS, 'common', 'sold_pin.py');

const PIN_DEF = /^def _pin_sold_inactive\(/m;
const SHARED_CALL = /sold_pin\.pin_source_confirmed_gone\(/;
const ORACLE_KW = /oracle\s*=\s*(["'])([^"']+)\1/;
// The REVERSAL half (2026-09-23). A platform that hands over only its sold ids leaves the oracle
// one-way, and a one-way oracle makes ops_lifecycle_false_resurrection() unclearable by construction
// — see the ledger census in scrapers/common/sold_pin.py's docstring.
const SEEN_KW = /seen_ad_numbers\s*=/;
// The canonical payload, as it is actually written. Its presence outside the shared law means a
// platform re-implemented the pin — and a re-implemented pin is a re-implemented law.
const PAYLOAD = '{"active": False, "missing_count": 3}';

const problems: string[] = [];

// ── Half 1: wiring, discovered by shape ─────────────────────────────────────────────────────────
if (!existsSync(LAW)) {
  problems.push('scrapers/common/sold_pin.py is gone — the shared sold-pin law has no home');
}
const lawSrc = existsSync(LAW) ? readFileSync(LAW, 'utf8') : '';
if (!lawSrc.includes('ops_stale_inactivation_probe')) {
  problems.push(
    'scrapers/common/sold_pin.py no longer writes ops_stale_inactivation_probe — every ' +
    'source-confirmed sold/rented kill in the fleet becomes unevidenced again');
}
if (!lawSrc.includes(PAYLOAD)) {
  problems.push(
    'scrapers/common/sold_pin.py lost the canonical pin payload — without missing_count=3 a ' +
    'pinned row again matches auto_recover_false_inactive()\'s recover trigger (915 rows, 2026-07-16)');
}

const platforms = readdirSync(SCRAPERS, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(SCRAPERS, d.name, 'run.py')))
  .map(d => d.name)
  .sort();

const pinners: string[] = [];
for (const p of platforms) {
  const src = readFileSync(join(SCRAPERS, p, 'run.py'), 'utf8');
  if (!PIN_DEF.test(src)) continue;
  pinners.push(p);
  if (!SHARED_CALL.test(src)) {
    problems.push(
      `scrapers/${p}/run.py defines _pin_sold_inactive() but does NOT call ` +
      'sold_pin.pin_source_confirmed_gone() — that is a private copy of the law, and the clause ' +
      'copies lose is the per-row evidence row');
    continue;
  }
  const m = src.match(ORACLE_KW);
  if (!m || !m[2].trim()) {
    problems.push(
      `scrapers/${p}/run.py calls the shared pin without a non-empty oracle= naming the source ` +
      'field it read — an evidence row that cannot say WHICH field said gone is unfalsifiable ' +
      '(the 2026-08-26 aqarcity lesson: 254 kills nobody could adjudicate from the record)');
  } else if (!m[2].startsWith(`${p}.`)) {
    problems.push(
      `scrapers/${p}/run.py passes oracle="${m[2]}", which does not name this platform — an ` +
      'evidence row filed under another platform\'s oracle is worse than none');
  }
  if (src.includes(PAYLOAD)) {
    problems.push(
      `scrapers/${p}/run.py still spells out the canonical pin payload locally — the payload and ` +
      'the evidence write belong together in the shared law; writing it here is how a platform ' +
      'silently opts back out of the evidence half');
  }
  if (!SEEN_KW.test(src)) {
    problems.push(
      `scrapers/${p}/run.py wires the KILL half of the sold pin but never passes seen_ad_numbers= ` +
      '— so this platform records only "gone" and never the reversal the same field publishes. ' +
      'ops_lifecycle_false_resurrection() reports the LATEST verdict per ad_number, so every ' +
      'relisting here becomes a P1 that no amount of correct behaviour can ever clear ' +
      '(docs/ops/LISTING_LIFECYCLE_ENGINEER.md §2.5a, §8.3)');
  }
}
if (pinners.length === 0) {
  problems.push('discovered ZERO scrapers with a sold pin — the discovery predicate is broken, ' +
    'and a barrier that covers nothing reads exactly like a barrier with nothing to report');
}

// ── Half 2: behaviour, by EXECUTING the real law ────────────────────────────────────────────────
type Plan = [string[], string[], Array<Record<string, string>>];

const run = (calls: unknown[][], mutated?: string): Plan[] =>
  pyCall(ROOT, 'scrapers.common.sold_pin', 'plan_pin', calls, mutated) as Plan[];

const GONE = ['STC0018', 'STC0019', 'STA0231'];
const ORACLE = 'satel.sold_pin.property_status';

/** The invariant: every id this plan pins gets exactly one evidence row naming the oracle. */
const oneToOne = (p: Plan): boolean => {
  const [pinnable, , evidence] = p;
  return evidence.length === pinnable.length
    && evidence.every((e, i) => e.ad_number === pinnable[i]
      && e.verdict === 'GONE' && !!e.oracle && e.oracle.trim().length > 0);
};

let real: Plan[];
try {
  real = run([
    [GONE, ORACLE, null, null, 'satel_residential_listings'],
    [GONE, ORACLE, null, ['STC0019'], 'satel_residential_listings'],
    [['STC0018', 'STC0018', 'STC0019'], ORACLE, null, null, 'satel_residential_listings'],
  ]);
} catch (e) {
  console.error(`RED  verify-sold-pin-evidence-law: could not EXECUTE plan_pin — ${e}`);
  process.exit(1);
}

const [plain, conflicted, duped] = real;
if (!oneToOne(plain)) {
  problems.push('EXECUTED plan_pin(): a pinned batch did not produce one evidence row per pinned ' +
    'id naming its oracle — this is the exact state ten platforms shipped in');
}
if (conflicted[0].includes('STC0019') || conflicted[2].some(e => e.ad_number === 'STC0019')) {
  problems.push('EXECUTED plan_pin(): an id seen LIVE in the same crawl was still pinned — the ' +
    'contradictory-source rule (owner, 2026-08-24; ABRE300/ABRE277/ABRE104) is not being applied');
}
if (duped[0].length !== 2 || !oneToOne(duped)) {
  problems.push('EXECUTED plan_pin(): a duplicated ad_number produced two ledger rows claiming ' +
    'two separate source confirmations');
}

// ── The mutations: re-introduce the defect and watch the predicates above go red ─────────────────
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) problems.push(`MUTATION NOT CAUGHT: ${label}`);
};
const mutate = (from: string, to: string): string => {
  if (!lawSrc.includes(from)) {
    problems.push(`mutation target vanished from sold_pin.py: ${from.slice(0, 60)}…`);
    return lawSrc;
  }
  return lawSrc.replace(from, to);
};

// 1. THE DEFECT ITSELF: pin the rows, record nothing. What ten platforms actually did.
mustCatch('the evidence rows stop being produced at all (the shipped defect)',
  !oneToOne(run([[GONE, ORACLE, null, null, 't']], mutate('    evidence = [', '    evidence = [] and ['))[0]));

// 2. A DIFFERENT WRONG WAY (§4.2: re-mutate, or the barrier is narrower than it reads):
//    the rows are produced but carry no oracle, so the kill is in the ledger and still unfalsifiable.
mustCatch('evidence rows written WITHOUT the oracle that names the source field',
  !oneToOne(run([[GONE, ORACLE, null, null, 't']],
    mutate('            "oracle": oracle,', '            "oracle": "",'))[0]));

// 3. The contradictory-source hold removed — abeea's ABRE300 defect, which killed live listings.
{
  const p = run([[GONE, ORACLE, null, ['STC0019'], 't']],
    mutate('        if a in live or a in seen:', '        if a in seen:'))[0];
  mustCatch('a row seen LIVE in the same crawl being pinned anyway',
    p[0].includes('STC0019'));
}

// 4. The blank-oracle refusal removed — a caller could then file evidence naming nothing.
{
  console.log('     (the Python traceback below is EXPECTED — mutation 4 asserts plan_pin refuses a blank oracle)');
  let threw = false;
  try { run([[GONE, '', null, null, 't']]); } catch { threw = true; }
  mustCatch('a blank oracle being accepted instead of refused', threw);
}

// ── Half 3: the REVERSAL, by EXECUTING the real law ─────────────────────────────────────────────
// Measured over the whole ops_stale_inactivation_probe ledger on 2026-09-23: prune_unseen wrote
// 362 GONE / 300 LIVE / 618 UNKNOWN and wasalt 1405 / 145 / 0, while all NINE sold_pin oracles
// wrote 5853 GONE and not one LIVE. The available reading was taken from the same field, on the
// same page, in the same crawl — and thrown away. satel STC0084 is the worked case.
type Rows = Array<Record<string, string>>;
const runRev = (calls: unknown[][], mutated?: string): Rows[] =>
  pyCall(ROOT, 'scrapers.common.sold_pin', 'plan_relisting_evidence', calls, mutated) as Rows[];

const ads = (r: Rows) => r.map(x => x.ad_number);

let rev: Rows[];
try {
  rev = runRev([
    // seen, sold-this-crawl, previously-GONE, oracle, table
    [['STC0084', 'STC0090'], [], ['STC0084'], ORACLE, 'satel_residential_listings'],
    [['STC0084', 'STC0018'], ['STC0018'], ['STC0084', 'STC0018'], ORACLE, 't'],
    [['STC0084', 'STC0084'], [], ['STC0084'], ORACLE, 't'],
    [['STC0090'], [], [], ORACLE, 't'],
  ]);
} catch (e) {
  console.error(`RED  verify-sold-pin-evidence-law: could not EXECUTE plan_relisting_evidence — ${e}`);
  process.exit(1);
}
const [relisted, alsoSold, dupRev, noPrior] = rev;

if (ads(relisted).join() !== 'STC0084'
    || relisted[0]?.verdict !== 'LIVE' || !relisted[0]?.oracle?.trim()) {
  problems.push('EXECUTED plan_relisting_evidence(): a listing the source had published as gone ' +
    'and now reads available produced no LIVE row naming its oracle — the ledger stays one-way ' +
    'and its false_resurrection P1 can never clear');
}
if (ads(alsoSold).includes('STC0018')) {
  problems.push('EXECUTED plan_relisting_evidence(): an id read SOLD this very crawl was still ' +
    'certified available — that is the one direction this must never allow, because it would bury ' +
    'a REAL false resurrection instead of clearing a stale one');
}
if (dupRev.length !== 1) {
  problems.push('EXECUTED plan_relisting_evidence(): one reversal was filed as several separate ' +
    'source confirmations');
}
if (noPrior.length !== 0) {
  problems.push('EXECUTED plan_relisting_evidence(): an id with no prior GONE verdict was written ' +
    'anyway — unbounded, a daily crawl would bury the real signal under tens of thousands of ' +
    '"still available" rows in a ledger that holds ~12k in total');
}

// 5. THE SHIPPED DEFECT ITSELF: read the reversal, decide with it, record nothing.
mustCatch('the reversal rows stop being produced at all (the one-way ledger, as shipped)',
  runRev([[['STC0084'], [], ['STC0084'], ORACLE, 't']],
    mutate('    rows: list[dict[str, Any]] = []', '    rows: list[dict[str, Any]] = []\n    return rows'))[0].length === 0);

// 6. A DIFFERENT WRONG WAY, in the DANGEROUS direction (§4.2: re-mutate or the barrier is narrower
//    than it reads). Drop the sold subtraction and the law will certify as available an id this
//    crawl read as sold — which would mask a genuine false resurrection rather than clear a stale
//    verdict. This is the mutation that matters most.
mustCatch('an id read SOLD this crawl being certified available once the subtraction is removed',
  ads(runRev([[['STC0084', 'STC0018'], ['STC0018'], ['STC0084', 'STC0018'], ORACLE, 't']],
    mutate('        if a in gone or a in seen_already or a not in prior:',
           '        if a in seen_already or a not in prior:'))[0]).includes('STC0018'));

// 7. The prior-GONE intersection removed — the bound that keeps the signal legible.
mustCatch('every available listing being filed as evidence once the prior-GONE bound is removed',
  runRev([[['STC0090'], [], [], ORACLE, 't']],
    mutate('        if a in gone or a in seen_already or a not in prior:',
           '        if a in gone or a in seen_already:'))[0].length > 0);

// 8. The blank-oracle refusal on the reversal half — an unfalsifiable LIVE row is as bad as an
//    unfalsifiable GONE one, and it is the one that can WITHHOLD an alert.
{
  console.log('     (the Python traceback below is EXPECTED — mutation 8 asserts the reversal refuses a blank oracle)');
  let threw = false;
  try { runRev([[['STC0084'], [], ['STC0084'], '', 't']]); } catch { threw = true; }
  mustCatch('a blank oracle being accepted on the reversal half instead of refused', threw);
}

if (problems.length) {
  console.error('RED  verify-sold-pin-evidence-law\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(
  `PASS verify-sold-pin-evidence-law — ${pinners.length} sold-pin platforms (${pinners.join(', ')}) ` +
  'all route through the one shared law, kill AND reversal halves wired; plan_pin() and ' +
  'plan_relisting_evidence() executed, 8 mutations caught');
