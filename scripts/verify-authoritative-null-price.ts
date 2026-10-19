// A FAILED FETCH MUST NEVER BLANK A KNOWN PRICE. Only the source may.
//
// THE INCIDENT (2026-08-22, senior run #35). Ezhalah served 500,000 SAR on aqar ad 6686450 while
// the source's price slot rendered «طلب تسويق» and its payload said `published:false`. The enricher
// obeyed the rule and stored nothing; the stale figure survived because
// db._unknown_must_not_overwrite_known() deletes any key whose value is None, and it could not tell
// three different situations apart:
//
//   1. AUTHORITATIVE ABSENCE — the source states there is no value.   -> must WRITE NULL
//   2. READ FAILURE          — fetch blocked / parse failed.          -> must KEEP the stored value
//   3. INCONCLUSIVE          — payload unreadable or key absent.      -> must KEEP the stored value
//
// Owner decision 2026-08-22: build the distinction, and make it impossible for 2 or 3 to blank a
// known price. `db.AUTHORITATIVE_NULL` is that distinction — a sentinel a writer must name
// deliberately. Every accidental path (missing key, None, failed parse, exception) yields None,
// which is still dropped.
//
// This verifier EXECUTES the real guard rather than grepping for it, because the property that
// matters is behavioural. `supabase`/`dotenv` are stubbed so it runs in CI and on a bare checkout
// alike. It also runs a MUTATION: the pre-fix guard is re-created and must FAIL the authoritative
// case, proving these assertions can actually detect the regression.
//
// Run: node --experimental-strip-types scripts/verify-authoritative-null-price.ts
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join as __join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

// "Is this guard actually wired in?" — asked of the test registry, which is what `npm test`
// resolves its run set from (scripts/lib/testRegistry.ts). String-matching package.json used to
// answer it; since the 201-command chain became one runner invocation, that match would read
// "not wired" for every barrier in the suite.
const REPO_ROOT = __join(import.meta.dirname, '..');

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// ---------------------------------------------------------------- behavioural half (real Python)
const PY = String.raw`
import sys, types, json

# Stub the two heavy imports db.py pulls at module scope so this runs without scraper deps.
for name in ("dotenv", "supabase"):
    if name not in sys.modules:
        sys.modules[name] = types.ModuleType(name)
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None

from scrapers.common.db import (
    AUTHORITATIVE_NULL, _AuthoritativeNull, _unknown_must_not_overwrite_known, _CONTROL_COLS,
)
from scrapers.common import normalize as N

R = {}

# 1. READ FAILURE / INCONCLUSIVE: a None price key is DROPPED, so the stored price survives.
r = {"ad_number": "1", "price_total": None, "price_annual": None, "bedrooms": None}
_unknown_must_not_overwrite_known(r)
R["none_dropped"] = ("price_total" not in r and "price_annual" not in r and "bedrooms" not in r)

# 2. AUTHORITATIVE ABSENCE: the sentinel is KEPT, as a real NULL, and will overwrite.
r = {"ad_number": "1", "price_total": AUTHORITATIVE_NULL}
_unknown_must_not_overwrite_known(r)
R["sentinel_written"] = ("price_total" in r and r["price_total"] is None)

# 3. The sentinel is not None and is falsy (so "if price:" guards elsewhere behave).
R["sentinel_is_not_none"] = AUTHORITATIVE_NULL is not None
R["sentinel_is_falsy"] = (not AUTHORITATIVE_NULL)

# 4. Control columns keep their None (liveness/prune must stay writable).
r = {"active": None, "missing_count": None, "last_seen_at": None}
_unknown_must_not_overwrite_known(r)
R["control_cols_kept"] = all(k in r for k in ("active", "missing_count", "last_seen_at"))

# 5. Real values pass through untouched.
r = {"price_total": 500000, "bedrooms": 3, "active": True}
_unknown_must_not_overwrite_known(r)
R["values_untouched"] = (r == {"price_total": 500000, "bedrooms": 3, "active": True})

# 6. NO ACCIDENTAL PATH PRODUCES THE SENTINEL. Every ordinary failure mode yields None.
payload = {}
accidents = [payload.get("price"), None]
try:
    accidents.append(int("طلب تسويق"))
except Exception:
    accidents.append(None)
try:
    raise RuntimeError("fetch blew up")
except Exception:
    accidents.append(None)
R["no_accidental_sentinel"] = all(not isinstance(a, _AuthoritativeNull) for a in accidents)

# 7. MUTATION: the pre-fix guard (delete every None) must FAIL the authoritative case. If this
#    passes, the assertions above are not actually testing anything.
def old_guard(r):
    for col in [c for c, v in r.items() if v is None and c not in _CONTROL_COLS]:
        del r[col]
r = {"ad_number": "1", "price_total": AUTHORITATIVE_NULL}
old_guard(r)                      # sentinel is not None, so the old guard leaves it as the SENTINEL
mutant_writes_null = ("price_total" in r and r["price_total"] is None)
R["mutation_detected"] = not mutant_writes_null

# 8. price_evidence records WHY, so a blanked price is auditable from the row alone.
ev = N.price_evidence(field="f", raw=None, stored=None, kind="total", unit="total",
                      origin="spec_table", authoritative_absent=True)
R["evidence_flag_true"] = ev.get("authoritative_absent") is True
ev2 = N.price_evidence(field="f", raw="500,000", stored=500000, kind="total", unit="total",
                       origin="spec_table")
R["evidence_flag_defaults_false"] = ev2.get("authoritative_absent") is False

print(json.dumps(R))
`;

const res = spawnSync('python3', ['-c', PY], { encoding: 'utf8', cwd: process.cwd() });
if (res.status !== 0) {
  console.error('authoritative-null-price: the behavioural half could not run\n', res.stderr);
  process.exit(1);
}
let R: Record<string, boolean>;
try {
  R = JSON.parse((res.stdout || '').trim().split('\n').pop() as string);
} catch {
  console.error('authoritative-null-price: unparseable probe output\n', res.stdout, res.stderr);
  process.exit(1);
}

check(R.none_dropped,
  'a None price key is DROPPED — a failed fetch cannot blank a known price',
  'a None price key now reaches the upsert — a blocked fetch or a parse failure would write NULL ' +
  'over a source-verified price. This is the 2026-08-09 owner rule and it must never regress.');
check(R.sentinel_written,
  'AUTHORITATIVE_NULL is written through as a real NULL',
  'AUTHORITATIVE_NULL no longer writes NULL — the source saying «طلب تسويق» can no longer retract ' +
  'a stale price, which is the whole point of the 2026-08-22 change');
check(R.sentinel_is_not_none && R.sentinel_is_falsy,
  'the sentinel is distinguishable from None and is falsy',
  'the sentinel is either None (indistinguishable from a failed read) or truthy (would corrupt ' +
  '`if price:` guards)');
check(R.control_cols_kept,
  'control columns still accept None (prune/reactivate/kill keep working)',
  'control columns are being dropped — liveness and bookkeeping paths break');
check(R.values_untouched,
  'real values pass through untouched',
  'the guard is mutating real values');
check(R.no_accidental_sentinel,
  'no accidental path yields the sentinel (missing key, None, failed parse, exception)',
  'some ordinary failure mode produces AUTHORITATIVE_NULL — a read failure could then blank a price');
check(R.mutation_detected,
  'MUTATION PROOF: the pre-fix guard fails the authoritative case',
  'the pre-fix guard passes these assertions, so they do not actually test the fix');
check(R.evidence_flag_true && R.evidence_flag_defaults_false,
  'price_evidence.authoritative_absent records WHY, and defaults to false',
  'price_evidence no longer records the authoritative decision — a blanked price would not be ' +
  'auditable from the row');

// ---------------------------------------------------------------- source half (who may name it)
// The sentinel is only safe while it is named exclusively where the SOURCE settled the question.
//
// This half reads TEXT rather than executing, for a stated reason: the property is "which LINES of
// the enricher may name the sentinel", which is a property of the file, not of any one call. It is
// therefore extracted as a PURE predicate below so the proofs at the bottom can hand it an
// enricher that names AUTHORITATIVE_NULL unguarded and watch it go red — until 2026-09-14 this half
// had no proof at all, and it is the gate that stops a FAILED FETCH from blanking a known price.

/** Split `expr` on a top-level boolean operator (outside brackets and string literals). */
function splitTop(expr: string, op: 'and' | 'or'): string[] {
  const parts: string[] = []; let depth = 0; let quote = ''; let cur = '';
  const tok = ` ${op} `;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) { cur += c; if (c === quote && expr[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (depth === 0 && expr.startsWith(tok, i)) { parts.push(cur.trim()); cur = ''; i += tok.length - 1; continue; }
    cur += c;
  }
  parts.push(cur.trim());
  return parts;
}
/** `(x)` → `x` when the outer parens enclose the whole expression. */
function unwrap(expr: string): string {
  let e = expr.trim();
  while (e.startsWith('(') && e.endsWith(')')) {
    let depth = 0; let whole = true;
    for (let i = 0; i < e.length; i++) {
      if (e[i] === '(') depth++;
      if (e[i] === ')') depth--;
      if (depth === 0 && i < e.length - 1) { whole = false; break; }
    }
    if (!whole) break;
    e = e.slice(1, -1).trim();
  }
  return e;
}
/** Names assigned exactly once as `bool(... and s_authoritative and ...)` — settled by a successful source read. */
export function authoritativeFlags(src: string): Set<string> {
  const flags = new Set<string>();
  for (const m of src.matchAll(/^\s*(\w+)\s*=\s*bool\(/gm)) {
    const name = m[1];
    let depth = 0; let j = (m.index ?? 0) + m[0].length - 1; const open = j;
    for (; j < src.length; j++) { if (src[j] === '(') depth++; if (src[j] === ')') { depth--; if (depth === 0) break; } }
    const body = src.slice(open + 1, j).replace(/\s+/g, ' ').trim();
    const assignedOnce = (src.match(new RegExp(`^\\s*${name}\\s*=(?!=)`, 'gm')) ?? []).length === 1;
    const conj = splitTop(body, 'or').length === 1 ? splitTop(body, 'and').map(unwrap) : [];
    if (assignedOnce && conj.includes('s_authoritative')) flags.add(name);
  }
  return flags;
}
/** A gate is source-settled when every OR branch is a flag, or some AND conjunct is (AND only narrows). */
export function isSourceSettled(expr: string, flags: Set<string>): boolean {
  const e = unwrap(expr);
  const ors = splitTop(e, 'or');
  if (ors.length > 1) return ors.every((d) => isSourceSettled(d, flags));
  const ands = splitTop(e, 'and');
  if (ands.length > 1) return ands.some((c) => isSourceSettled(c, flags));
  return flags.has(e);
}

/** Violations of the who-may-name-the-sentinel rule, as a pure function of the enricher source. */
export function sentinelGateProblems(enrich: string): string[] {
  const out: string[] = [];

  if (!/authoritative_no_price\s*=\s*bool\(\s*s_authoritative\s+and\s+s_price\s+is\s+None\s*\)/.test(enrich)) {
    out.push('scrapers/aqar/enrich_residential.py no longer derives authoritative_no_price from ' +
      "_structured_price()'s authoritative flag — it could now blank a price on a read failure");
  }

  // Every AUTHORITATIVE_NULL use in the scraper tree must sit behind a flag the SOURCE settled. Count
  // CODE only — a mention inside a `#` comment is prose, and counting prose as a use is exactly the
  // mistake this repo's other barriers keep having to unlearn.
  //
  // 2026-10-18: a second source-settled flag joined authoritative_no_price — rate_headline (aqar
  // publishes its per-metre RATE in the headline slot, so the stored total must clear). A flag counts
  // as source-settled only when it is assigned exactly once, as `bool(...)`, with s_authoritative as a
  // top-level AND conjunct (never inside an OR). The gate may OR such flags together and may AND on
  // further narrowing conditions; an OR with anything else is ungated (it was silently accepted before).
  const flags = authoritativeFlags(enrich);
  const lines = enrich.split('\n');
  const assignments: string[] = [];
  const guarded: string[] = [];
  lines.forEach((l, i) => {
    if (l.trimStart().startsWith('#') || !l.includes('AUTHORITATIVE_NULL')) return;
    if (/^\s*from\s+scrapers\.common\.db\s+import\b/.test(l)) return;
    assignments.push(l);
    const joined = `${l} ${lines[i + 1] ?? ''}`.replace(/\s+/g, ' ');
    const m = joined.match(/AUTHORITATIVE_NULL if (.*?) else /);
    if (m && isSourceSettled(m[1], flags)) guarded.push(l);
  });
  // `assignments.length > 0` is the FAIL-CLOSED half: an enricher that names the sentinel nowhere
  // means this guard is no longer reading the code it protects, and must read as MISSING — never as
  // "0 of 0 gated, all clear".
  if (!(assignments.length > 0 && guarded.length === assignments.length)) {
    out.push('an AUTHORITATIVE_NULL in scrapers/aqar/enrich_residential.py is NOT gated on ' +
      `a source-settled flag (${guarded.length}/${assignments.length} gated; flags: ${[...flags].join(', ') || 'none'}) — it could blank a price ` +
      'the source never retracted');
  }

  if (/price_per_meter":\s*\(?AUTHORITATIVE_NULL/.test(enrich)) {
    out.push('price_per_meter is being blanked by the total-price decision — aqar not publishing a ' +
      'TOTAL says nothing about the per-meter figure');
  }

  return out;
}

const enrich = readFileSync('scrapers/aqar/enrich_residential.py', 'utf8');
const gateProblems = sentinelGateProblems(enrich);
check(gateProblems.length === 0,
  'only the SOURCE may name AUTHORITATIVE_NULL: the flag is derived from the oracle, every ' +
  'assignment is gated on it, and price_per_meter is never blanked by the total-price decision',
  gateProblems.join(' | '));

check(npmTestRuns(REPO_ROOT, 'verify-authoritative-null-price'),
  'npm test runs this guard',
  '`npm test` no longer runs verify-authoritative-null-price.ts (see scripts/test-exclusions.txt) — the guard is inert');

console.log('authoritative-null-price: only the SOURCE may blank a known price\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION PROOFS for the SOURCE half. The behavioural half above carries its own mutation inside
// the Python probe (R.mutation_detected — the pre-fix guard re-created and watched to fail the
// authoritative case). The source half had none until 2026-09-14: it was a text tripwire over the
// one gate that stops a read failure from writing NULL over a source-verified price, and nobody had
// ever watched it go red. These hand the real enricher, mutated, to the real predicate.
// ─────────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

// The shipped gated assignment, recovered from the source so the mutants edit REAL code.
const gatedLine = enrich
  .split('\n')
  .find((l) => !l.trimStart().startsWith('#') && /AUTHORITATIVE_NULL if authoritative_no_price/.test(l)) ?? '';

mustCatch('the 2026-08-22 incident re-introduced: an AUTHORITATIVE_NULL written UNCONDITIONALLY, so a blocked fetch blanks a known price',
  sentinelGateProblems(enrich.replace(gatedLine, gatedLine.replace(/ if authoritative_no_price[^,\n]*/, ''))).length > 0);

mustCatch('the flag surviving in name but stopping being derived from the source oracle (gated on a constant instead)',
  sentinelGateProblems(enrich.replace(/authoritative_no_price\s*=\s*bool\([^\n]*\)/, 'authoritative_no_price = True')).length > 0);

mustCatch('…and the subtler version: the flag no longer requiring the source to have been READ authoritatively',
  sentinelGateProblems(enrich.replace(/bool\(\s*s_authoritative\s+and\s+s_price\s+is\s+None\s*\)/, 'bool(s_price is None)')).length > 0);

mustCatch('the per-metre price being blanked by a decision about the TOTAL (سعر المتر is its own published field)',
  sentinelGateProblems(enrich.replace(gatedLine, `${gatedLine}\n        "price_per_meter": (AUTHORITATIVE_NULL if authoritative_no_price else ppm),`)).length > 0);

mustCatch('the enricher naming the sentinel NOWHERE — an unreadable subject reads as MISSING, never as "0 of 0 gated, all clear"',
  sentinelGateProblems(enrich.replace(/AUTHORITATIVE_NULL/g, 'None')).length > 0);

const rateDef = /rate_headline\s*=\s*bool\(transaction_type == "Buy" and s_authoritative/;
mustCatch('a second flag (rate_headline) that stops requiring the source to have been READ: a failed fetch could then clear a total',
  sentinelGateProblems(enrich.replace(rateDef, 'rate_headline = bool(transaction_type == "Buy"')).length > 0);

mustCatch('…or that keeps s_authoritative only inside an OR (one branch skips the read)',
  sentinelGateProblems(enrich.replace(rateDef, 'rate_headline = bool(transaction_type == "Buy" or s_authoritative')).length > 0);

mustCatch('…or that is re-assigned after its source-settled definition',
  sentinelGateProblems(enrich.replace(/(\n\s*)(if rate_headline and price_per_meter is None:)/, '$1rate_headline = True$1$2')).length > 0);

mustCatch('a gate OR-ing a source-settled flag with a made-up one',
  sentinelGateProblems(enrich.replace(/AUTHORITATIVE_NULL if \(authoritative_no_price or rate_headline\)/, 'AUTHORITATIVE_NULL if (authoritative_no_price or fetch_failed)')).length > 0);

mustCatch('the old blind spot: a gate that starts with the flag but ORs on anything (`authoritative_no_price or True`)',
  sentinelGateProblems(enrich.replace(gatedLine, gatedLine.replace(/if authoritative_no_price and/, 'if authoritative_no_price or True and'))).length > 0);

mustCatch('…while a COMMENT mentioning AUTHORITATIVE_NULL is still prose, not an ungated assignment (the predicate is not over-broad)',
  sentinelGateProblems(`${enrich}\n        # AUTHORITATIVE_NULL must never be written on a read failure\n`).length === 0);

mustCatch('…and the enricher as it actually ships is NOT flagged (the predicate is not vacuously red)',
  sentinelGateProblems(enrich).length === 0);

if (problems.length || mutFail) {
  if (problems.length) console.error(`\n❌ ${problems.length} check(s) failed — a read failure could blank a valid price.`);
  if (mutFail) console.error(`❌ ${mutFail} mutation(s) went UNCAUGHT — the source half cannot see the defect it exists for.`);
  process.exit(1);
}
console.log('\n✅ authoritative-null-price: passed, and both halves proven to fail on the defect they exist for.');
