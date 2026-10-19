/**
 * A PLATFORM IS NOT COVERED BECAUSE THE CODE EXISTS — and the ledger that says which chains have
 * never been observed to run must stay honest, shrink-only, and reachable.
 *
 * THE RULE (owner, 2026-09-21; `docs/ops/LISTING_LIVENESS.md` §9.1):
 *
 *   "Do not mark a platform as covered merely because code exists. Prove the full chain
 *    actually runs."
 *
 * WHY IT EXISTS, MEASURED THE DAY IT LANDED. 31 platforms pass `verify_gone=` to
 * `db.prune_unseen()`, so each has a real per-listing oracle: a row at grace is re-fetched on its
 * OWN url and only an affirmative source answer may deactivate it. Asked whether that chain had
 * ever actually produced a verdict in production, 20 of them had produced NOTHING — not one GONE,
 * LIVE or even UNKNOWN row in `ops_stale_inactivation_probe`. muktamel was the sharp case: 3,864
 * active listings, 381 of them already under strike and queueing for the oracle, and zero verdicts
 * ever. Code, wiring, registry entry, measured death signals — and a chain nobody had seen run.
 *
 * Until today none of that was visible from either side. The registry called all 29 of those
 * platforms `CRAWL_PRESENCE_ONLY` ("no per-listing revisit exists"), which was false about their
 * mechanism, and `mon_detect_liveness_coverage_ramp` filters on
 * `strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT')` and so never looked at one of them.
 *
 * TWO HALVES, SPLIT BY WHAT EACH CAN SEE — and this file is deliberately the offline one.
 *
 *   THIS FILE (hermetic, in `npm test`) judges the REPO: every platform in the ledger really does
 *   wire an oracle, and really is declared at a tier that claims one. A ledger row for a platform
 *   with no oracle at all would be a claim about a mechanism that does not exist, and that gap
 *   belongs in `scrapers/absence-only-prune.txt`, which is a different file for a different thing.
 *   Plus the ratchet: the count may fall, never rise, without a reviewed edit.
 *
 *   `mon_detect_oracle_chain_never_observed()` (production, on the detector roster) judges the
 *   half no offline check can: it recomputes the never-observed set from production every sweep.
 *   So a ledger row that has since been earned shows up as an alert auto-resolving, and a platform
 *   missing from the ledger shows up as an alert naming a platform nobody wrote down.
 *
 * That split is why this file must NOT try to read production. `npm test` is a required status
 * check on every PR, and a check whose verdict is decided by production's state fails unrelated
 * diffs (AGENTS.md, "The required suite is HERMETIC").
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const LEDGER = join(ROOT, 'scrapers', 'oracle-never-observed.txt');
const SCRAPERS = join(ROOT, 'scrapers');
const POLICIES = join(ROOT, 'scrapers', 'common', 'liveness_policies.py');

/**
 * THE RATCHET. 20 chains were unobserved when this ledger was created (2026-09-21). It may only
 * fall: a platform leaves by producing a real verdict in production. Raising it is a deliberate,
 * reviewed edit — and it means a newly-wired oracle has joined the unproven set, which is a thing
 * a reviewer should have to look at rather than something a file quietly absorbs.
 *
 * RAISED 20 → 44 on 2026-09-24: the 35-platform batch wired 35 new oracles, and the 24 of them that
 * never stamp db.mark_direct_alive (the other 11 build every row from a direct read of its own
 * record) will each have active rows, strategy CANDIDATE_PLUS_DIRECT and zero verdicts after their
 * first scrape — exactly the set mon_detect_oracle_chain_never_observed() raises on. Listing them
 * is the reviewed decision; each leaves by producing its first verdict in production.
 */
// RAISED 44 -> 45 on 2026-09-26 (routine #11, alert_event 5923): eaqartabuk was wired with its
// first DIRECT oracle that day. It had been pruning on crawl ABSENCE alone, so it moves OUT of
// scrapers/absence-only-prune.txt (that ledger's ratchet falls 24 -> 23 in the same change) and
// INTO this one. That is the honest direction of both numbers: the platform went from "no
// mechanism at all" to "a mechanism nobody has yet watched run", and this file exists precisely so
// the second state is not read as the third. The oracle was control-validated 9/9 against the live
// source with live controls interleaved, but a control run is not a production verdict.
const RATCHET = 45;

let failures = 0;
function check(ok: boolean, name: string, detail = ''): void {
  if (ok) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
}

// ── The two repo facts, both DISCOVERED by shape rather than listed ──────────────────────────────

/** Platforms whose scraper hands prune_unseen a source oracle. Discovered, so a platform wired
 *  tomorrow is judged the moment it exists — never a list someone has to remember to extend. */
export function oracleWiredPlatforms(readDir: typeof readdirSync, read: typeof readFileSync): Set<string> {
  const out = new Set<string>();
  for (const e of readDir(SCRAPERS, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const run = join(SCRAPERS, e.name, 'run.py');
    if (!existsSync(run)) continue;
    const src = String(read(run, 'utf8'));
    if (src.includes('verify_gone=') && src.includes('prune_unseen')) out.add(e.name);
  }
  return out;
}

/** The ledger's platform column — one per non-comment line. */
export function ledgerPlatforms(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .map((l) => l.split('|')[0].trim());
}

/** platform → declared strategy, read from the registry the scrapers themselves import. */
export function declaredStrategies(py: string): Map<string, string> {
  const out = new Map<string, string>();
  // Explicit rows: "<platform>": _P(\n  _pol("<platform>", g, s), <STRATEGY>,
  for (const m of py.matchAll(
    /"([a-z0-9_]+)":\s*_P\(\s*_pol\("[a-z0-9_]+",\s*\d+,\s*\d+\),\s*([A-Z_]+)/g,
  )) out.set(m[1], m[2]);
  // Comprehension rows: _P(_pol(p, g, s), <STRATEGY>, ... for p[, sig] in ( "a", ("b", …), … )
  for (const m of py.matchAll(
    /_P\(_pol\(p,\s*\d+,\s*\d+\),\s*([A-Z_]+)[\s\S]*?for p(?:, \w+)? in \(([\s\S]*?)\n\s*\)/g,
  )) {
    const strategy = m[1];
    // Each tuple/string entry begins with the platform name as the first quoted token.
    for (const t of m[2].split('\n')) {
      const hit = t.match(/^\s*\(?"([a-z0-9_]+)"/);
      if (hit) out.set(hit[1], strategy);
    }
  }
  return out;
}

const CLAIMS_AN_ORACLE = new Set(['DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT']);

/**
 * The whole judgement, pure so a mutation proof can execute THIS code against a broken world
 * rather than re-implementing the rule and testing its own copy. Empty means the ledger is honest.
 */
export function ledgerProblems(
  listed: string[],
  wired: Set<string>,
  strategies: Map<string, string>,
): string[] {
  const bad: string[] = [];

  // FAIL CLOSED. An empty ledger read is "unjudgeable", never "nothing unproven" — the dark-check
  // shape AGENTS.md names as this repo's largest defect class (a failed fetch is not an empty
  // answer, and it binds the verification layer exactly as it binds the product).
  if (listed.length === 0) {
    return ['the ledger parsed to ZERO platforms — that is unreadable, not "every chain proven"'];
  }
  const seen = new Set<string>();
  for (const p of listed) {
    if (seen.has(p)) bad.push(`${p} is listed twice — the ratchet would count it twice`);
    seen.add(p);

    if (!wired.has(p)) {
      bad.push(
        `${p} is in the never-observed ledger but scrapers/${p}/run.py does NOT pass verify_gone= ` +
          'to prune_unseen. This file records an UNPROVEN mechanism, never a missing one — a ' +
          'platform with no oracle at all belongs in scrapers/absence-only-prune.txt, which is a ' +
          'different gap with a different fix.',
      );
    }
    const s = strategies.get(p);
    if (s === undefined) {
      bad.push(`${p} is in the ledger but has no entry in scrapers/common/liveness_policies.py`);
    } else if (!CLAIMS_AN_ORACLE.has(s)) {
      bad.push(
        `${p} is in the never-observed ledger but is declared ${s}. A ledger row says "this ` +
          'platform claims a direct mechanism and has never been seen to use it"; a platform ' +
          'claiming no mechanism has nothing to be unobserved.',
      );
    }
  }
  return bad;
}

// ── Run it ───────────────────────────────────────────────────────────────────────────────────────
console.log('\nThe never-observed oracle ledger is honest and shrink-only\n');

const ledgerText = readFileSync(LEDGER, 'utf8');
const listed = ledgerPlatforms(ledgerText);
const wired = oracleWiredPlatforms(readdirSync, readFileSync);
const strategies = declaredStrategies(readFileSync(POLICIES, 'utf8'));

check(wired.size > 0, 'the wiring census found platforms at all',
  'zero platforms pass verify_gone= to prune_unseen — either every oracle was deleted, or this '
  + 'discovery broke and is now a check that cannot fail');
check(strategies.size > 0, 'the registry parsed to real strategies',
  'liveness_policies.py yielded no platform→strategy pairs — the parse is broken, so every '
  + 'tier assertion below would pass vacuously');

const problems = ledgerProblems(listed, wired, strategies);
check(problems.length === 0, 'every ledger row names a real, oracle-bearing, oracle-claiming platform',
  problems.join('\n      '));

check(listed.length <= RATCHET,
  `the unproven count is at or below its ratchet (${listed.length} ≤ ${RATCHET})`,
  `${listed.length} platforms are listed as never-observed, above the ratchet of ${RATCHET}. It `
  + 'may fall as chains are proven; raising it means a newly-wired oracle has joined the unproven '
  + 'set, which is a reviewed decision, not a file edit.');

// A ledger that lost its production half is a to-do list nobody revisits.
const detectorMigration = readdirSync(join(ROOT, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8'))
  .filter((s) => s.includes('function public.mon_detect_oracle_chain_never_observed('));
check(detectorMigration.length > 0,
  'the production half exists: a committed migration defines mon_detect_oracle_chain_never_observed()',
  'without it, nothing recomputes the never-observed set from production and this file can drift '
  + 'from reality indefinitely — which is exactly what it exists to prevent');
check(detectorMigration.some((s) => s.includes('oracle-never-observed.txt')),
  'the detector points a reader at this ledger',
  'an alert that does not name the ledger leaves the reader to rediscover it');

check(npmTestRuns(ROOT, 'verify-oracle-observation-ledger'),
  'this barrier is discovered and run by npm test');

// ── MUTATION PROOF — the guards must be the REAL result of running them against a broken world ──
console.log('\n  — mutations —');
function mustCatch(label: string, caught: boolean): void {
  check(caught, `(mutation) catches: ${label}`,
    'no guard went red against this break — the assertion above is weaker than it reads.');
}

const anyListed = listed[0];
mustCatch('a ledger row for a platform with NO oracle (the absence-only gap, misfiled here)',
  ledgerProblems([...listed, 'satel'], wired, strategies).length > 0);
mustCatch('a ledger row for a platform declared CRAWL_PRESENCE_ONLY (claims no mechanism at all)',
  ledgerProblems(listed, wired,
    new Map(strategies).set(anyListed, 'CRAWL_PRESENCE_ONLY')).length > 0);
mustCatch('a ledger row for a platform that is in no registry at all',
  ledgerProblems([...listed, 'notaplatform'], wired, strategies).length > 0);
mustCatch('the same platform listed twice, inflating the ratchet headroom',
  ledgerProblems([...listed, anyListed], wired, strategies).length > 0);
mustCatch('an EMPTY ledger read treated as "every chain is proven"',
  ledgerProblems([], wired, strategies).length > 0);
mustCatch('the negative control: the real ledger is clean (a rule red for everything guards nothing)',
  ledgerProblems(listed, wired, strategies).length === 0);

if (failures) {
  console.error(`\n❌ verify-oracle-observation-ledger: ${failures} failure(s).`);
  process.exit(1);
}
console.log('\n✅ verify-oracle-observation-ledger: every unproven chain is named, and "covered" '
  + 'still has to be earned.');
