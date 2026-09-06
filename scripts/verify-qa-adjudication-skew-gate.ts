// A DIFFERENTIAL VERDICT MUST NOT BE PRONOUNCED ACROSS A MOVED INDEX — and the gate that says so
// must never become a way to make mismatches disappear (Search & Matching QA Engineer, 2026-09-03).
//
// BACKGROUND. `ops_qa_search_run` stores the count+hash the harness captured from
// `location_search_candidates_ar` at time T. `ops_qa_adjudicate` compares that stored snapshot
// against `ops_qa_diff` evaluated at time T+N. `search_listings_ar` is LIVE — sync-search-listings-ar
// runs at :14 every hour and liveness deactivations remove rows continuously — so elapsed time alone
// manufactures COUNT_MISMATCH / SET_MISMATCH verdicts out of nothing.
//
// Measured on 2026-09-03: 318 COUNT_MISMATCH + 11 SET_MISMATCH out of 3,994 ledger rows, every one
// investigated an artifact. All 11 SET_MISMATCH rows had rpc_total = sql_total (equal cardinality,
// churned membership); re-measured same-instant through ops_nf_cert_cell, 7 of those cohorts came
// back missing = 0 and extra = 0. The clincher was one search adjudicated twice — sid r200004 read
// RPC 12680 / oracle 12636, then r300004 read RPC 12636 / oracle 12559. The later RPC equals the
// earlier oracle to the row: the two implementations agree, they were read at different instants.
//
// WHY IT IS A DEFECT AND NOT COSMETIC. SEARCH_MATCH_QA_ENGINEER.md §40.7 forbids reporting a harness
// failure as a product failure, and these verdicts sit in the permanent certification evidence
// ledger where a later reader sees `COUNT_MISMATCH: 318` and concludes the Normal Filter is losing
// rows. The worse direction: a REAL matching defect of small magnitude (the measured artifact deltas
// averaged 5.14 rows) becomes indistinguishable from the noise floor. A barrier that can no longer
// discriminate is how nine dark detectors once read as a clean bill of health (AGENTS.md).
//
// WHAT THIS PINS, and it is deliberately BOTH directions — the second half matters more than the
// first, because a staleness gate is exactly the shape of change that can quietly become an amnesty:
//   1. the watermark is CAPTURED     — ops_qa_load_run stamps both watermark columns;
//   2. the watermark is CONSULTED    — ops_qa_adjudicate calls ops_qa_verdict_skew_aware, not the
//                                      raw ops_qa_verdict (reverting that one call silently restores
//                                      the whole defect while every other line still looks right);
//   3. ARM 2, no watermark           — skew UNPROVEN ⇒ the strict verdict STANDS;
//   4. ARM 3, index provably unmoved — both sides saw the same rows ⇒ the mismatch is REAL and
//                                      survives. This is the arm that keeps the barrier a barrier;
//   5. the gate can only ever emit INDEX_MOVED as a NEW verdict — it can never hand back a passing
//      literal of its own, so it is structurally incapable of turning a mismatch into a PASS;
//   6. the decision table itself, mutation-proven: an "always forgive a mismatch" mutant and a
//      "forgive whenever the watermark is missing" mutant must both FAIL these cases.
//
//   node --experimental-strip-types scripts/verify-qa-adjudication-skew-gate.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const migDir = join(root, 'supabase', 'migrations');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── the migration that introduced the gate ────────────────────────────────────────────────────────
const MIG = '20260903083546_qa_adjudication_must_not_compare_across_a_moved_index.sql';
const files = readdirSync(migDir);
check('§0 the skew-gate migration is committed', files.includes(MIG),
  `expected supabase/migrations/${MIG} — applied to production 2026-09-03, so its absence is drift`);

const sql = files.includes(MIG) ? readFileSync(join(migDir, MIG), 'utf8') : '';

// ── §1 the watermark is captured ──────────────────────────────────────────────────────────────────
check('§1a ops_qa_search_run gains both watermark columns',
  /add column if not exists\s+index_rows_at_load\s+bigint/i.test(sql) &&
  /add column if not exists\s+index_max_updated_at_load\s+timestamptz/i.test(sql));

check('§1b the watermark pairs a row COUNT with max(last_updated)',
  /count\(\*\)::bigint,\s*max\(last_updated\)\s*from\s+public\.search_listings_ar/i.test(sql),
  'a count alone cannot see a BALANCED add+delete — the exact shape of the 11 SET_MISMATCH rows, ' +
  'where cardinality was equal and only membership had churned');

check('§1c ops_qa_load_run stamps the watermark onto every row it writes',
  /create or replace function public\.ops_qa_load_run/i.test(sql) &&
  /ops_qa_index_watermark\(\)/i.test(sql) &&
  /index_rows_at_load\s*=\s*excluded\.index_rows_at_load/i.test(sql),
  'without a stamp at load time there is nothing to compare against, and every row falls to ARM 2');

// ── §2 the watermark is consulted (the single line whose reversion restores the whole defect) ─────
const adjudicate = sql.slice(sql.search(/create or replace function public\.ops_qa_adjudicate/i));
check('§2a ops_qa_adjudicate calls the skew-aware verdict',
  /ops_qa_verdict_skew_aware\s*\(/i.test(adjudicate));
check('§2b ops_qa_adjudicate does NOT call the raw ops_qa_verdict directly',
  !/public\.ops_qa_verdict\s*\(/i.test(adjudicate),
  'a direct raw-verdict call in the adjudicator reinstates the defect while everything else still ' +
  'reads correctly — this is the highest-value assertion in the file');
check('§2c the adjudicator reads "now" ONCE per batch, not per row',
  /select\s+w\.rows_now,\s*w\.max_updated_now\s+into\s+v_rows,\s*v_upd/i.test(adjudicate),
  'a per-row watermark read would let the index move WITHIN one batch and judge rows inconsistently');

// ── §3 the four arms, each pinned separately so deleting any one fails ────────────────────────────
const gate = sql.slice(sql.search(/create or replace function public\.ops_qa_verdict_skew_aware/i),
                       sql.search(/create or replace function public\.ops_qa_load_run/i));

check('§3a ARM 1 — a non-mismatch verdict is returned untouched',
  /not in \(\s*'COUNT_MISMATCH',\s*'SET_MISMATCH'\s*\)/i.test(gate),
  'the gate must be incapable of downgrading a passing verdict or inventing one');

check('§3b ARM 2 — no watermark ⇒ the strict verdict STANDS',
  /when p_rows_at_load is null/i.test(gate),
  'without this arm the gate becomes a blanket amnesty for every row loaded before it existed');

check('§3c ARM 3 — index provably UNMOVED ⇒ the mismatch is REAL and survives',
  /p_rows_at_load\s*=\s*p_rows_now/i.test(gate) &&
  /p_max_upd_at_load is not distinct from p_max_upd_now/i.test(gate),
  'this is the arm that keeps the barrier a barrier: same inventory on both sides means a ' +
  'disagreement is a genuine predicate defect and must not be explained away');

check('§3d ARM 4 — index moved ⇒ INDEX_MOVED, an uncomparable third state',
  /else\s*'INDEX_MOVED'/i.test(gate),
  'refusal rather than a guess, the same discipline as the live sweep’s dbSkipped (§41.15)');

// ── §4 the gate cannot mint a PASS ────────────────────────────────────────────────────────────────
// Every arm either delegates to ops_qa_verdict or returns INDEX_MOVED. If any arm ever returns a
// passing literal of its own, the gate stops being a classifier and becomes a silencer.
const returnedLiterals = [...gate.matchAll(/(?:then|else)\s*'([A-Z_]+)'/g)].map((m) => m[1]);
check('§4 the only literal verdict the gate can emit is INDEX_MOVED',
  returnedLiterals.length > 0 && returnedLiterals.every((v) => v === 'INDEX_MOVED'),
  `found ${JSON.stringify(returnedLiterals)} — a passing literal here would let the gate convert a ` +
  'mismatch straight into a PASS, which is precisely what it must never be able to do');

// ── §5 the decision table, mutation-proven ────────────────────────────────────────────────────────
// A faithful TS mirror of the SQL CASE. The point is not to re-derive the SQL but to state the
// contract independently and then show that plausible WRONG implementations fail it.
type Base = 'COUNT_MISMATCH' | 'SET_MISMATCH' | 'EXACT_SET_MATCH' | 'COUNT_MATCH_PAGE_CAPPED';
type Row = {
  base: Base; rowsAtLoad: number | null; updAtLoad: string | null;
  rowsNow: number; updNow: string; want: string; why: string;
};

const gateFn = (r: Row): string => {
  if (r.base !== 'COUNT_MISMATCH' && r.base !== 'SET_MISMATCH') return r.base;   // ARM 1
  if (r.rowsAtLoad === null) return r.base;                                       // ARM 2
  if (r.rowsAtLoad === r.rowsNow && r.updAtLoad === r.updNow) return r.base;      // ARM 3
  return 'INDEX_MOVED';                                                           // ARM 4
};

const T0 = '2026-09-03T08:00:00Z', T1 = '2026-09-03T09:00:00Z';
const CASES: Row[] = [
  { base: 'EXACT_SET_MATCH', rowsAtLoad: 500, updAtLoad: T0, rowsNow: 499, updNow: T1,
    want: 'EXACT_SET_MATCH', why: 'a pass stays a pass even though the index moved' },
  { base: 'COUNT_MATCH_PAGE_CAPPED', rowsAtLoad: 500, updAtLoad: T0, rowsNow: 499, updNow: T1,
    want: 'COUNT_MATCH_PAGE_CAPPED', why: 'page-capped pass is untouched' },
  { base: 'COUNT_MISMATCH', rowsAtLoad: null, updAtLoad: null, rowsNow: 499, updNow: T1,
    want: 'COUNT_MISMATCH', why: 'ARM 2 — skew unproven, mismatch stands' },
  { base: 'COUNT_MISMATCH', rowsAtLoad: 500, updAtLoad: T0, rowsNow: 500, updNow: T0,
    want: 'COUNT_MISMATCH', why: 'ARM 3 — same inventory both sides, so the defect is REAL' },
  { base: 'SET_MISMATCH', rowsAtLoad: 500, updAtLoad: T0, rowsNow: 500, updNow: T0,
    want: 'SET_MISMATCH', why: 'ARM 3 — a real set defect survives the gate' },
  { base: 'COUNT_MISMATCH', rowsAtLoad: 500, updAtLoad: T0, rowsNow: 499, updNow: T0,
    want: 'INDEX_MOVED', why: 'ARM 4 — rows removed between load and adjudication' },
  { base: 'SET_MISMATCH', rowsAtLoad: 500, updAtLoad: T0, rowsNow: 500, updNow: T1,
    want: 'INDEX_MOVED', why: 'ARM 4 — balanced add+delete: count equal, max(last_updated) moved' },
];

for (const c of CASES) {
  const got = gateFn(c);
  check(`§5 ${c.base} ${c.rowsAtLoad === null ? 'no-watermark' : `${c.rowsAtLoad}->${c.rowsNow}`} ⇒ ${c.want}`,
    got === c.want, `${c.why} — got ${got}`);
}

// The mutation proof. Each mutant is a mistake a future edit could plausibly make; every one must be
// REJECTED by the cases above, or those cases are decoration.
const MUTANTS: { name: string; fn: (r: Row) => string }[] = [
  { name: 'M1 forgive every mismatch (the amnesty mutant)',
    fn: (r) => (r.base === 'COUNT_MISMATCH' || r.base === 'SET_MISMATCH') ? 'INDEX_MOVED' : r.base },
  { name: 'M2 drop ARM 2 — treat a missing watermark as proof of skew',
    fn: (r) => {
      if (r.base !== 'COUNT_MISMATCH' && r.base !== 'SET_MISMATCH') return r.base;
      if (r.rowsAtLoad === null) return 'INDEX_MOVED';
      return (r.rowsAtLoad === r.rowsNow && r.updAtLoad === r.updNow) ? r.base : 'INDEX_MOVED';
    } },
  { name: 'M3 drop the max(last_updated) half — count-only watermark',
    fn: (r) => {
      if (r.base !== 'COUNT_MISMATCH' && r.base !== 'SET_MISMATCH') return r.base;
      if (r.rowsAtLoad === null) return r.base;
      return r.rowsAtLoad === r.rowsNow ? r.base : 'INDEX_MOVED';
    } },
  { name: 'M4 gate applies to passing verdicts too',
    fn: (r) => (r.rowsAtLoad !== null && r.rowsAtLoad !== r.rowsNow) ? 'INDEX_MOVED' : gateFn(r) },
];

for (const m of MUTANTS) {
  const survives = CASES.every((c) => m.fn(c) === c.want);
  check(`§5-mutation ${m.name} is REJECTED`, !survives,
    'this mutant passes every case above, so the cases do not actually constrain the gate');
}

if (failures > 0) {
  console.error(`\nverify-qa-adjudication-skew-gate: ${failures} FAILED`);
  process.exit(1);
}
console.log('\nverify-qa-adjudication-skew-gate: all checks passed');
