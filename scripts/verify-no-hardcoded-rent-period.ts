// RENT PERIOD = SOURCE: no scraper may manufacture a period constant off the deal word.
//
// 2026-08-11 AUDIT: 11 platforms carried `"rent_period": "annual" if is_rent else None` — a
// hardcoded constant gated ONLY on "is this a rental", applied to ~187 rent rows whose source
// states NO period anywhere (raghdan 127, alkhaas 24, sadin 8, mizlaj 7, hajer 5, ramzalqasim 3,
// aldarim 3, abeea 2, jurash 1, alhoshan 1 — plus souq24's «نصف سنوي» substring-matched as annual).
// The owner's standing rule: a scraper must NEVER write a rental period the source does not
// establish — missing → None (unknown), never a default.
//
// WHAT THIS FAILS ON: the one-line default shapes, in any scrapers/*/run.py —
//   "rent_period": "annual" if is_rent …          (dict-literal default)
//   rent_period = "annual" if is_rent …           (assignment default)
// `if is_rent` is the load-bearing anchor: a constant gated only on the deal word is a
// manufactured period.
//
// WHAT STAYS ALLOWED: token/field-conditional assignments — a period constant chosen by a SOURCE
// signal (a سنوي/شهري token, a structured field, alhoshan's priced-rentLong purpose). Those are
// tracked BY NAME in the companion pytest (test_source_is_truth_fleet_invariants.py §3,
// PERIOD_FROM_SOURCE_SIGNAL), which also proves the signal read still happens. NOTE: wasalt's and
// sanadak's `(… else "annual") if is_rent` ternaries fall outside this guard's two shapes — their
// monthly branch reads a source field, but the annual FALLBACK is soft debt the pytest roster
// carries, not a licence to add more.
//
// GRANDFATHERED: the 6 platforms below still carry the default as DECLARED, DATED debt — they
// mirror the pytest PERIOD_DEFAULT_ALLOWLIST exactly (retired or unaudited platforms the
// 2026-08-11 sweep did not repair). This list is a record of past misses, not a template. It must
// NEVER grow: a new entry here is the very thing this guard exists to prevent. It must also stay
// honest — an entry whose default is fixed must be removed, and the audit's 11 repaired platforms
// may never be re-added.
//
// Deliberately OFFLINE (tracked repo files only), like the other verifiers in `npm test`.
//
// Run: node --experimental-strip-types scripts/verify-no-hardcoded-rent-period.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SCRAPERS = join(import.meta.dirname, '..', 'scrapers');

const GRANDFATHERED = new Set(['alnokhba', 'awal', 'deal', 'jazwtn', 'nowaisiry', 'toor']);

const DEFAULT_SHAPES: [string, RegExp][] = [
  ['dict-literal default', /"rent_period"\s*:\s*\(?\s*"(?:annual|monthly)"\s+if\s+is_rent\b/],
  ['assignment default', /\brent_period\s*=\s*\(?\s*"(?:annual|monthly)"\s+if\s+is_rent\b/],
];

const problems: string[] = [];
const grandfatheredStillDirty = new Set<string>();
let scanned = 0;

for (const dir of readdirSync(SCRAPERS)) {
  const runPy = join(SCRAPERS, dir, 'run.py');
  try { statSync(runPy); } catch { continue; }
  scanned++;
  // strip comment lines so a historical note quoting the retired pattern cannot false-positive
  const code = readFileSync(runPy, 'utf8').split('\n')
    .filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const [label, re] of DEFAULT_SHAPES) {
    const m = re.exec(code);
    if (!m) continue;
    if (GRANDFATHERED.has(dir)) { grandfatheredStillDirty.add(dir); continue; }
    problems.push(`scrapers/${dir}/run.py: ${label} — ${m[0].trim()}`);
  }
}

console.log(`no-hardcoded-rent-period: scanned ${scanned} scrapers/*/run.py`);
if (scanned < 20) {
  console.error(`❌ only ${scanned} scraper run.py files found — the scan is not seeing the tree.`);
  process.exit(1);
}
// The grandfather list may only name platforms that still carry the default — once one is fixed,
// keeping it listed would quietly re-licence the default's return.
const stale = [...GRANDFATHERED].filter((d) => !grandfatheredStillDirty.has(d));
if (stale.length) {
  problems.push(`grandfather list is stale — no default found in: ${stale.join(', ')} ` +
    '(fixed or removed platform; delete the entry so the debt record stays honest)');
}
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n❌ ${problems.length} problem(s): a scraper manufactures a rent period off the deal ` +
    'word. The period comes only from the source: read its token/field, or store None (unknown).');
  process.exit(1);
}
console.log(`✅ no-hardcoded-rent-period: no scraper defaults the rental period ` +
  `(${grandfatheredStillDirty.size} grandfathered debts tracked).`);
