// THE ADVANCED FILTER SURFACE JUDGE — pure, so it can be mutation-proven offline.
//
// The owner's definition of a correct Advanced Filter (2026-09-02) is one sentence:
//
//   «Whatever number and option Advanced Filter shows the user must equal the real database truth,
//    and clicking that option must return exactly the correct listings. Gym — 3 means truly 3
//    eligible listings with a gym; clicking Gym returns those 3, not 2, not 4, and no listing
//    without a gym.»
//
// That sentence is a set of comparisons over evidence gathered from production. The evidence is
// gathered by scripts/verify-af-full-surface-differential.ts (live, network, slow); the COMPARISONS
// live here, with no I/O, so that scripts/verify-af-surface-judge.ts can corrupt each input and
// prove the verdict turns red — in `npm test`, on every PR. A live sweep whose judgement has never
// been seen to fail is the vacuous-pass shape this repo keeps finding in its own barriers.
//
// Five sources of truth meet in judgeOption(), and every pair must agree:
//   chip       the number ON THE CARD — the cnt_* column of the count RPC the app calls
//   applied    af_eligible_count() with the option applied — the shared clause counting itself
//   rpcTotal   location_search_candidates_ar's total_count with the option applied — what «بحث» lands
//   rpcIds     the paged ID set that call returns — the cards the user can actually scroll to
//   oracleIds  PostgREST filters on search_listings_ar for the same intent — INDEPENDENT of our SQL
// plus the rows the oracle fetched, each re-evaluated in JavaScript against the predicate on its
// own column values, so "every returned listing satisfies every active filter" is checked by a
// THIRD evaluator (PostgREST's filter engine and this file), never by the RPC that produced them.

export type Row = Record<string, unknown>;

/** A predicate over one index row, mirroring the Advanced Filter answer the user committed. */
export type Pred =
  | { kind: 'true'; col: string }
  | { kind: 'false'; col: string }
  | { kind: 'gte'; col: string; n: number }
  | { kind: 'between'; col: string; lo: number; hi: number }
  | { kind: 'eq'; col: string; v: unknown }
  | { kind: 'in'; col: string; vs: unknown[] }
  | { kind: 'and'; preds: Pred[] };

/**
 * STRICT evaluation: a NULL (or missing) column value makes every leaf FALSE. This is R2.5.2 /
 * R13.3 — «unknown never becomes yes or no» — expressed as code. A row whose bathrooms is NULL does
 * not satisfy «≥ 1»; a row whose furnished is NULL satisfies neither «furnished» nor «unfurnished».
 */
export function rowSatisfies(row: Row, p: Pred): boolean {
  if (p.kind === 'and') return p.preds.every((x) => rowSatisfies(row, x));
  const v = row[p.col];
  if (v === null || v === undefined) return false;
  switch (p.kind) {
    case 'true': return v === true;
    case 'false': return v === false;
    case 'gte': return typeof v === 'number' && v >= p.n;
    case 'between': return typeof v === 'number' && v >= p.lo && v <= p.hi;
    case 'eq': return v === p.v;
    case 'in': return p.vs.includes(v);
  }
}

/** Every column a predicate reads — the columns whose NULLs must never appear in a returned set. */
export function strictCols(p: Pred): string[] {
  if (p.kind === 'and') return [...new Set(p.preds.flatMap(strictCols))];
  return [p.col];
}

export type OptionEvidence = {
  label: string;
  chip: number | null;          // null = this option has no count surface (predicate-only case)
  applied: number | null;       // null = af_eligible_count was not consulted
  rpcTotal: number;
  rpcIds: string[];
  oracleIds: string[];
  oracleRows?: Row[];           // the oracle's rows, with the predicate's columns selected
  pred?: Pred;
};

export type Verdict = {
  ok: boolean;
  missing: string[];            // eligible per the oracle, absent from the RPC set
  extra: string[];              // returned by the RPC, ineligible per the oracle
  dupes: number;
  counts: { chip: number | null; applied: number | null; rpcTotal: number; rpcIds: number; oracle: number };
  rowViolations: number;        // oracle rows that FAIL the predicate under JS evaluation
  nullLeaks: number;            // oracle rows carrying NULL in a strict column
  reasons: string[];
};

export function judgeOption(e: OptionEvidence): Verdict {
  const reasons: string[] = [];
  const rs = new Set(e.rpcIds);
  const os = new Set(e.oracleIds);
  const missing = e.oracleIds.filter((i) => !rs.has(i));
  const extra = e.rpcIds.filter((i) => !os.has(i));
  const dupes = e.rpcIds.length - rs.size;
  const oracle = os.size;

  if (e.chip != null && e.chip !== oracle) reasons.push(`chip ${e.chip} ≠ DB truth ${oracle}`);
  if (e.applied != null && e.applied !== oracle) reasons.push(`af_eligible_count ${e.applied} ≠ DB truth ${oracle}`);
  if (e.rpcTotal !== oracle) reasons.push(`search total_count ${e.rpcTotal} ≠ DB truth ${oracle}`);
  if (e.chip != null && e.chip !== e.rpcTotal) reasons.push(`chip ${e.chip} ≠ search total_count ${e.rpcTotal}`);
  if (rs.size !== e.rpcTotal) reasons.push(`paged RPC set has ${rs.size} ids but total_count says ${e.rpcTotal}`);
  if (missing.length) reasons.push(`MISSING ${missing.length} eligible listing(s)`);
  if (extra.length) reasons.push(`EXTRA ${extra.length} ineligible listing(s)`);
  if (dupes) reasons.push(`DUPLICATES ${dupes}`);

  let rowViolations = 0;
  let nullLeaks = 0;
  if (e.pred && e.oracleRows) {
    const cols = strictCols(e.pred);
    for (const r of e.oracleRows) {
      if (cols.some((c) => r[c] === null || r[c] === undefined)) nullLeaks++;
      if (!rowSatisfies(r, e.pred)) rowViolations++;
    }
    if (nullLeaks) reasons.push(`${nullLeaks} row(s) with NULL in a strict column reached the set (UNKNOWN treated as a value)`);
    if (rowViolations) reasons.push(`${rowViolations} row(s) fail the predicate on their own column values`);
    // The rows fetched must BE the set judged, or the row check is about something else.
    if (e.oracleRows.length !== oracle) reasons.push(`row check covered ${e.oracleRows.length} of ${oracle} rows`);
  }

  return {
    ok: reasons.length === 0,
    missing, extra, dupes,
    counts: { chip: e.chip, applied: e.applied, rpcTotal: e.rpcTotal, rpcIds: rs.size, oracle },
    rowViolations, nullLeaks, reasons,
  };
}

export type SetVerdict = { ok: boolean; expected: number; got: number; missing: string[]; extra: string[] };

/** Several values of ONE field UNION (R7.2.2): the combined set must be exactly A ∪ B. */
export function judgeUnion(a: string[], b: string[], both: string[]): SetVerdict {
  const exp = new Set([...a, ...b]);
  return diffSets(exp, new Set(both));
}

/** Several DIFFERENT fields INTERSECT (R7.2.2): the combined set must be exactly A ∩ B. */
export function judgeIntersection(a: string[], b: string[], both: string[]): SetVerdict {
  const bs = new Set(b);
  const exp = new Set(a.filter((x) => bs.has(x)));
  return diffSets(exp, new Set(both));
}

function diffSets(exp: Set<string>, got: Set<string>): SetVerdict {
  const missing = [...exp].filter((x) => !got.has(x));
  const extra = [...got].filter((x) => !exp.has(x));
  return { ok: missing.length === 0 && extra.length === 0, expected: exp.size, got: got.size, missing, extra };
}

/** A zero-count option must be zero EVERYWHERE — never «0» on the chip and rows on the click. */
export function judgeZero(chip: number | null, rpcTotal: number, oracle: number, rpcIds: string[]): boolean {
  return (chip == null || chip === 0) && rpcTotal === 0 && oracle === 0 && rpcIds.length === 0;
}

/**
 * The unknown caption (R7.1.3) is either the exact count of rows whose source did not state the
 * fact, or absent — never a fabricated number. `caption === null` is a legitimate "no caption".
 */
export function judgeUnknownCaption(caption: number | null, oracleNulls: number): boolean {
  return caption === null || caption === oracleNulls;
}

/**
 * Boundary report for a threshold/range predicate: `exercised` says whether the returned rows
 * actually include a value ON the boundary (≥ N includes N; between lo..hi includes lo or hi). A
 * boundary that no row touches is not a failure — it is a case the data cannot prove — so callers
 * report it, never count it as a pass.
 */
export function boundaryReport(rows: Row[], p: Pred): { exercised: boolean; violations: number } {
  const violations = rows.filter((r) => !rowSatisfies(r, p)).length;
  let exercised = true;
  if (p.kind === 'gte') exercised = rows.some((r) => r[p.col] === p.n);
  else if (p.kind === 'between') exercised = rows.some((r) => r[p.col] === p.lo || r[p.col] === p.hi);
  return { exercised, violations };
}

/**
 * The usefulness rule (R5.1.1) that decides whether an option may be RENDERED at all:
 * choosing it must remove ≥ 10% of the current results, OR leave ≤ 25. Restated here rather than
 * imported so a mutation of src/lib/afRanking.ts is judged, not echoed. MIN_REAL_OPTION_COUNT = 5.
 */
export const MIN_REAL_OPTION_COUNT = 5;
export const INTERVIEW_STOP_AT = 25;
export const MEANINGFUL_NARROWING_FRACTION = 0.1;
export function optionWouldRender(count: number, total: number): boolean {
  if (count < MIN_REAL_OPTION_COUNT) return false;
  return total - count >= total * MEANINGFUL_NARROWING_FRACTION || count <= INTERVIEW_STOP_AT;
}
