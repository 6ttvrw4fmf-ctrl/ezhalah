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


// ── PRICE = SOURCE, layers 2-4 (owner invariant 2026-08-04) ─────────────────────────────────────
// Three further classes, each found LIVE on 2026-08-04 and each repaired the same day. They are
// enforced here, fleet-wide, so no future scraper (or a well-meaning edit to an old one) can
// reintroduce them silently.

// LAYER 2 — a price may NEVER be read from prose. The description carries rents, mortgages,
// deposits and per-metre asides; 47 live aqar rows stored a rental income as the sale price
// («الدخل السنوي 67,500» on an ad whose page price was 3,700,000).
const PROSE_SRC = /(description|desc_raw|desc_html|excerpt|og:?description|body_text|content)/i;
const PRICE_ASSIGN = /^\s*(?:row\[["'])?[A-Za-z_]*price[A-Za-z_]*(?:["']\])?\s*=(?!=)/i;
const proseOffenders: string[] = [];
for (const f of pyFiles) {
  if (f.includes('/tests/')) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.split('#')[0];
    if (/=\s*None\s*$/.test(code)) return;
    if (!PRICE_ASSIGN.test(code)) return;
    if (!PROSE_SRC.test(code)) return;
    proseOffenders.push(`${f.replace(root, 'scrapers')}:${i + 1}: ${code.trim().slice(0, 90)}`);
  });
}
// DECLARED EXCEPTION, pending an owner decision (raised 2026-08-04). sadin publishes «السعر عند
// الطلب» in its price field and prints the real figure only in the description, so 63 of its 73
// live listings would lose their price under a strict ban. Its parser is NOT the "grab any number"
// shape the rule targets: it requires an explicit total label (السعر الإجمالي / المطلوب / الكلي)
// and rejects per-metre figures (_is_per_meter, hardened 2026-08-04 after id 598978 stored the
// «المطلوب للمتر 5555» rate as a total). Listed here so the ban is ENFORCED everywhere else and a
// NEW prose-price path in any other scraper still fails this check. Remove this entry the moment
// the owner rules on it — the decision is "blank 63 sadin prices" vs "keep labeled-total parsing".
// NOTE: anchored by LINE NUMBER, so any edit above this call site moves it. It shifted 433 -> 441
// on 2026-08-04 when _pages()'s docstring grew (pagination fix, PR#313) — the exception itself is
// unchanged. If this fails, confirm the line still holds the SAME `price = _extract_price(desc_raw)`
// call before re-pinning; do not re-pin a different call site to make the check pass.
const PROSE_ALLOWLIST = new Set(['scrapers/sadin/run.py:441']);
const proseUnapproved = proseOffenders.filter(o => !PROSE_ALLOWLIST.has(o.split(': ')[0]));
check('no scraper assigns a listing price from prose (outside the declared, dated exception)',
  proseUnapproved.length === 0);
for (const o of proseUnapproved) console.error('  PROSE-PRICE  ' + o);
check('the sadin exception is still the ONLY one, and still present (so it cannot be forgotten)',
  proseOffenders.length === 1 && PROSE_ALLOWLIST.has(proseOffenders[0]?.split(': ')[0]));

// LAYER 3 — a per-square-metre rate may never be stored AS the total. Found live in wasalt (7
// land rows held averageSalePricePerSqm in price_total) and aqar (20 rows held «سعر المتر»).
const PPM_AS_TOTAL = /^\s*(?:row\[["'])?(price_total|price_annual)(?:["']\])?\s*=(?!=)[^\n#]*(price_per_meter|per_?sqm|per_?meter|سعر\s*المتر|averageSalePricePerSqm)/i;
const ppmOffenders: string[] = [];
for (const f of pyFiles) {
  if (f.includes('/tests/')) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.split('#')[0];
    if (/=\s*None\s*$/.test(code)) return;   // `a = b = c = None` resets, not a derivation
    if (PPM_AS_TOTAL.test(code)) ppmOffenders.push(`${f.replace(root, 'scrapers')}:${i + 1}: ${code.trim().slice(0, 90)}`);
  });
}
check('no scraper stores a per-m² rate as the total/annual price', ppmOffenders.length === 0);
for (const o of ppmOffenders) console.error('  PPM-AS-TOTAL  ' + o);

// LAYER 4 — the shared evidence helper must stay wired, and must keep refusing prose origins.
// (If db._fold_price_evidence or normalize.price_evidence is deleted, the corroboration monitor
// silently loses its input — this is the tripwire for that.)
const dbPy = readFileSync(join(root, 'common/db.py'), 'utf8');
const normPy = readFileSync(join(root, 'common/normalize.py'), 'utf8');
check('db._fold_price_evidence exists and is called from the shared capture path',
  /def _fold_price_evidence/.test(dbPy) && /_fold_price_evidence\(r\)/.test(dbPy));
check('normalize.price_evidence exists and BANS origin="description"',
  /def price_evidence/.test(normPy) && /origin == "description"/.test(normPy) && /raise ValueError/.test(normPy));
check('evidence is folded into source_capture (never written as a column)',
  /cap\.setdefault\("price_evidence"/.test(dbPy) && /r\.pop\("price_evidence"/.test(dbPy));

if (failed) { console.error(`\n✗ ${failed} price-fidelity assertion(s) FAILED`); process.exit(1); }
console.log('\n✓ all PRICE = SOURCE assertions passed (no derived, no prose, no ppm-as-total, evidence wired)');
