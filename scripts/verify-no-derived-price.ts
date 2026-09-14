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
//
// MUTATION-PROVEN 2026-09-14 (routine #10 / R1). This guard covers the owner-locked PRICE = SOURCE
// rule across the whole scraper fleet and nobody had ever watched it go red. The three scanners are
// extracted as PURE predicates over a line of code precisely so the proofs at the bottom can feed
// them REAL lines from REAL scrapers, mutated into the four derivation shapes, the prose shape and
// the ppm-as-total shape — and feed them the shipped lines as a negative control.
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

/** True iff this ONE line of python derives a price signal. Pure, so a proof can feed it a mutant. */
export function derivesAPrice(line: string): boolean {
  const code = line.split('#')[0];
  if (!code.trim()) return false;
  if (/=\s*None\s*$/.test(code)) return false; // chained `a = b = c = None` resets, not derivations
  return DERIVE.some((rx) => rx.test(code)) && !SANCTIONED.test(code);
}

for (const f of pyFiles) {
  if (f.includes('/tests/')) continue; // the fleet's own guard tests contain sample violation strings
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (derivesAPrice(line)) offenders.push(`${f.replace(root, 'scrapers')}:${i + 1}: ${line.split('#')[0].trim().slice(0, 90)}`);
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

/** True iff this ONE line assigns a listing price out of prose. Pure, for the proofs below. */
export function assignsPriceFromProse(line: string): boolean {
  const code = line.split('#')[0];
  if (/=\s*None\s*$/.test(code)) return false;
  return PRICE_ASSIGN.test(code) && PROSE_SRC.test(code);
}

for (const f of pyFiles) {
  if (f.includes('/tests/')) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (assignsPriceFromProse(line)) proseOffenders.push(`${f.replace(root, 'scrapers')}:${i + 1}: ${line.split('#')[0].trim().slice(0, 90)}`);
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
// on 2026-08-04 when _pages()'s docstring grew (pagination fix, PR#313), 441 -> 446 on
// 2026-08-09 when the sub-1000 magnitude gate directly above it was removed and replaced by the
// comment explaining why (source-fidelity pass), 446 -> 484 on 2026-09-01 when _pages() grew its
// list-fetch failure-reason capture (daily engineer run, same status-blind-fetch fix already
// applied to sanadak/erapulse/abeea), and 484 -> 494 later the same day when the /ar/ locale-prefix
// href fix added the shared _PROPERTY_HREF_RE constant + docstring note above LIST_ALL, and
// 494 -> 511 on 2026-09-03 when _description() gained the redesign's dt/dd selector (the sadin
// detail-page capture outage: the same prose this exception is about had stopped being captured at
// all, so 73/74 residential and 10/10 commercial rows were served price-less for ~3 weeks), and
// 511 -> 560 later the same day when _report_description_miss() was added so that a dead
// description selector reports the live markup from the crawler instead of being guessed at, and
// 560 -> 599 when that diagnostic was sharpened to ask whether the price is on the page AT ALL
// (the label turned out to be absent and the page carries a `property-details-locked` block). The
// exception itself is unchanged across all eight shifts — still the one
// `price = _extract_price(desc_raw)` call in the file, re-verified against the commit before
// re-pinning. If this fails, confirm the line still holds the SAME call before re-pinning; do not
// re-pin a different call site to make the check pass. 599 -> 629 on 2026-09-05 when the
// image-capture fix added the pid-anchored gallery pass to _photos() (33 lines above the call),
// and 629 -> 660 on 2026-09-12 when the daily engineer added _fetch_page() (retries a transient
// list-fetch 5xx/503 instead of failing on the first one — the same fix already applied to
// ramzalqasim/eastabha) 31 lines above the call; re-verified: still the file's ONLY
// _extract_price(desc_raw) call, ninth shift, same exception.
const PROSE_ALLOWLIST = new Set(['scrapers/sadin/run.py:660']);
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

/** True iff this ONE line stores a per-m² rate as the total/annual price. Pure, for the proofs. */
export function storesPpmAsTotal(line: string): boolean {
  const code = line.split('#')[0];
  if (/=\s*None\s*$/.test(code)) return false;   // `a = b = c = None` resets, not a derivation
  return PPM_AS_TOTAL.test(code);
}

for (const f of pyFiles) {
  if (f.includes('/tests/')) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (storesPpmAsTotal(line)) ppmOffenders.push(`${f.replace(root, 'scrapers')}:${i + 1}: ${line.split('#')[0].trim().slice(0, 90)}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION PROOFS. Each takes a REAL line out of a REAL scraper and mutates it into the exact
// defect the layer above exists to stop — a proof that supplies its own invented input proves
// nothing (BARRIER_ENGINEER PART 3, R1: "feed a predicate what PRODUCTION actually stores").
// The controls at the end assert the shipped lines are NOT flagged.
// ─────────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

// A real, faithful capture from the fleet: eastabha stores the source-published rate verbatim.
const realPpmLine = readFileSync(join(root, 'eastabha/run.py'), 'utf8')
  .split('\n').find((l) => /out\["price_per_meter"\] = /.test(l)) ?? '';
mustCatch('a real capture line mutated into ppm = total / area (the mustqr straggler shape)',
  derivesAPrice(realPpmLine.replace(/= .*$/, '= out["price"] / area')));
mustCatch('…and the mirror direction: total = area * ppm',
  derivesAPrice('    row["price_total"] = area * row["price_per_meter"]'));
mustCatch('…and annual fabricated from a per-metre rate',
  derivesAPrice('    row["price_annual"] = row["price_per_meter"] * area_m2'));
mustCatch('…and a per-metre rate fabricated by division anywhere on the line',
  derivesAPrice('        price_per_meter = total_price / float(area)'));

mustCatch('a price assigned out of the DESCRIPTION (the 47 aqar rows that stored a rental income as the sale price)',
  assignsPriceFromProse('    row["price_total"] = _extract_price(description)'));
mustCatch('…and the same shape through a differently-named prose field',
  assignsPriceFromProse('    price = _first_number(og_description)'));

mustCatch('a per-m² rate stored AS the total (wasalt averageSalePricePerSqm, aqar «سعر المتر»)',
  storesPpmAsTotal('    row["price_total"] = d.get("averageSalePricePerSqm")'));
mustCatch('…and the annual variant of the same confusion',
  storesPpmAsTotal('    row["price_annual"] = specs.get("سعر المتر")'));

// NEGATIVE CONTROLS. A predicate red for everything protects nothing, and this is the line that
// catches an over-broad repair — the fleet's faithful captures must still pass.
mustCatch('…while the REAL eastabha capture line (a verbatim source rate) is NOT flagged',
  !derivesAPrice(realPpmLine) && !storesPpmAsTotal(realPpmLine));
mustCatch('…and the ONE sanctioned arithmetic (annualize_rent / monthly ×12) is still allowed',
  !derivesAPrice('    row["price_annual"] = annualize_rent(monthly, "شهري")')
  && !derivesAPrice('    row["price_annual"] = monthly * 12'));
mustCatch('…and a reset (`a = b = c = None`) is not mistaken for a derivation',
  !derivesAPrice('    row["price_per_meter"] = row["price_total"] = None'));
mustCatch('…and a COMMENT describing the banned shape is prose, not an offence',
  !derivesAPrice('    x = 1  # never: price_per_meter = price_total / area')
  && !assignsPriceFromProse('    x = 1  # never read price from the description'));

if (failed || mutFail) {
  if (failed) console.error(`\n✗ ${failed} price-fidelity assertion(s) FAILED`);
  if (mutFail) console.error(`✗ ${mutFail} mutation(s) went UNCAUGHT — this guard cannot see the defects it exists for.`);
  process.exit(1);
}
console.log('\n✓ all PRICE = SOURCE assertions passed (no derived, no prose, no ppm-as-total, evidence wired), and proven to fail on each');
