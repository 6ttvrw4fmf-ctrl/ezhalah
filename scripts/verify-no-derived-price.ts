// Fleet-wide fidelity guard (audit item 4, owner rule 2026-07-27): NO scraper may DERIVE a price
// signal — not price_per_meter from price_total/area, not price_total from area×ppm, in either
// direction. Only verbatim source-published values are stored; everything else stays NULL.
// This is the guard the mustqr straggler proved was missing: the aqar-specific checks
// (verify-aqar-trigger-preserves-source-ppm) never scanned the other 30 scrapers.
//   node --experimental-strip-types scripts/verify-no-derived-price.ts   (wired into `npm test`)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// Recursively collect every python file under scrapers/.
const root = new URL('../scrapers', import.meta.url).pathname;
const pyFiles: string[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith('.py')) pyFiles.push(p);
  }
})(root);
check(`scanned a real fleet (${pyFiles.length} python files)`, pyFiles.length >= 20);

// A DERIVATION is an assignment to a price field whose right side does arithmetic (/ or *).
// Reading a source field verbatim (row["price_per_meter"] = spec_value / p.get("ppm")) has no
// arithmetic operator, so faithful captures pass. Comment lines are ignored.
const offenders: string[] = [];
const DERIVE = [
  /price_per_meter[^=\n]*=(?![=])[^\n#]*[/*]/,          // ppm = …/… or …*…
  /price_total[^=\n]*=(?![=])[^\n#]*price_per_meter/,    // total from ppm
  /price_total[^=\n]*=(?![=])[^\n#]*area[^\n#]*\*/,      // total from area×…
  /price_annual[^=\n]*=(?![=])[^\n#]*price_per_meter/,   // annual from ppm
];
// The ONE sanctioned arithmetic: annualizing a stated rent via the shared, golden-tested
// normalize.annualize_rent (monthly→×12 semantics, not a fabricated signal).
const SANCTIONED = /annualize_rent|\*\s*12\b/;
for (const f of pyFiles) {
  if (f.includes('/tests/')) continue; // the fleet's own guard tests contain sample violation strings
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.split('#')[0];
    if (!code.trim()) return;
    if (/=\s*None\s*$/.test(code)) return; // chained `a = b = c = None` resets, not derivations
    for (const rx of DERIVE) {
      if (rx.test(code) && !SANCTIONED.test(code)) { offenders.push(`${f.replace(root, 'scrapers')}:${i + 1}: ${code.trim().slice(0, 90)}`); break; }
    }
  });
}
check('no scraper derives a price signal (ppm↔total↔area, any direction)', offenders.length === 0);
for (const o of offenders) console.error('  OFFENDER  ' + o);

// The specific regression that motivated this guard can never return silently:
const mustqr = readFileSync(join(root, 'mustqr/run.py'), 'utf8');
check('mustqr no longer computes price_per_meter', !/price_per_meter[^=\n]*=(?![=])[^\n#]*\//.test(mustqr.split('\n').map(l=>l.split('#')[0]).join('\n')));

if (failed) { console.error(`\n✗ ${failed} derived-price assertion(s) FAILED`); process.exit(1); }
console.log('\n✓ all derived-price fidelity assertions passed (fleet-wide, both directions)');
