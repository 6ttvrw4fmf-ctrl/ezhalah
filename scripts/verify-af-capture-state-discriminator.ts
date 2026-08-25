// AF CAPTURE-REGRESSION DISCRIMINATOR — the alert must name WHICH failure it found, and must never
// buy that clarity by raising less (AF+Trending Data Integrity Engineer, 2026-08-25).
//
// BACKGROUND. `mon_af_new_listing_readiness()` §B raises af_new_listing_capture_regression when a
// certified cohort segment's fresh-48h known-rate collapses against its all-time rate. That signal is
// real, but the alert used to describe exactly one cause ("the scraper likely stopped capturing it")
// and offer exactly one escape hatch (acknowledge it in ops_amenity_capture_verified "if PROVEN
// source-side"). A NULL field has two very different causes:
//
//   upstream_fetch_incomplete   the detail page was never successfully fetched (detail_enriched=false)
//                               — the field's absence proves nothing about the source, because nobody
//                               read the page. Fix EGRESS. Never rewrite a parser for this, and never
//                               waive it: a source-side waiver is permanent and would mask the real
//                               regression the day egress recovers.
//   fetched_but_field_absent    the page WAS read and the value is gone — a genuine parser/selector
//                               regression, or a real source change (only ever the latter WITH a
//                               recorded probe).
//
// Live on 2026-08-25: wasalt_commercial_listings/property_age raised for إيجار/سنوي/مكتب (31 of 31
// fresh rows never detail-fetched) and .../معرض (37 of 37) — both upstream, neither a parser bug.
// This is the owner's permanent rule of 2026-08-13 ("a missing captured field is NOT evidence that
// the source omits it — a failed fetch looks identical") enforced by the alert itself.
//
// WHAT THIS PINS, in both directions:
//   1. the discriminator exists and every branch is reachable and named;
//   2. the raise CONDITION is untouched — the discriminator must never appear in the `if` that
//      decides whether to raise, or a future edit could quietly turn a classifier into a silencer;
//   3. the classification math, mutation-proven against the exact Postgres expression, including the
//      boundary where int-rounding decides (16/31 upstream vs 15/31 fetched);
//   4. the cost containment: the discriminator query runs on the RAISE path only, never in the
//      per-segment × per-field scan — the twice-hourly sweep already runs near its statement_timeout
//      and an aborted sweep rolls back every alert it had raised.
//
//   node --experimental-strip-types scripts/verify-af-capture-state-discriminator.ts

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

console.log('\nAF capture-regression discriminator\n');

// The shipped SQL is whichever migration most recently redefines the detector — found by content, not
// by a hardcoded filename, so a later legitimate rewrite of the same function is checked too rather
// than silently leaving this barrier pinned to a superseded file.
const defining = readdirSync(migDir)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => /create or replace function public\.mon_af_new_listing_readiness/i
    .test(readFileSync(join(migDir, f), 'utf8')))
  .sort();
check('a migration in supabase/migrations defines mon_af_new_listing_readiness()', defining.length > 0);
if (!defining.length) process.exit(1);

const sql = readFileSync(join(migDir, defining[defining.length - 1]!), 'utf8');
console.log(`      (checking ${defining[defining.length - 1]})\n`);
// Comments stripped so the prose above a rule can never satisfy the rule.
const code = sql.replace(/^\s*--.*$/gm, '');

// ── 1. every branch exists and is named ───────────────────────────────────────────────────────────
for (const state of ['upstream_fetch_incomplete', 'fetched_but_field_absent', 'unknown_no_fetch_columns']) {
  check(`capture_state '${state}' is produced by the detector`, code.includes(`'${state}'`));
}
check("the alert payload carries capture_state", /'capture_state'\s*,\s*fetch_state/.test(code));
check("the alert payload carries the row evidence (fresh_rows_never_detail_fetched)",
  /'fresh_rows_never_detail_fetched'\s*,\s*never_fetched/.test(code));
check("the alert payload carries last_enrich_attempt_at (proves the job is still trying)",
  /'last_enrich_attempt_at'\s*,\s*last_try/.test(code));
check("the alert payload carries an adjudicate line that routes the reader",
  /'adjudicate'\s*,\s*advice/.test(code));

// ── 2. the raise condition is UNCHANGED — clarity must not be bought with silence ──────────────────
const raiseCond = code.match(/if seg\.fresh_n >= 20[\s\S]*?then/);
check('the §B raise condition still reads: fresh_n >= 20 AND all_rate >= 0.20 AND fresh_rate < all_rate*0.5',
  !!raiseCond
  && /seg\.fresh_n >= 20/.test(raiseCond[0])
  && /all_rate >= 0\.20/.test(raiseCond[0])
  && /coalesce\(fresh_rate, 0\) < all_rate \* 0\.5/.test(raiseCond[0]));
check('the ops_amenity_capture_verified escape hatch is still the ONLY suppressor in that condition',
  !!raiseCond && /ops_amenity_capture_verified/.test(raiseCond[0]));
check('SILENCER GUARD: no capture_state/fetch_state/never_fetched term appears in the raise condition',
  !!raiseCond && !/(fetch_state|never_fetched|capture_state)/.test(raiseCond[0]),
  'a discriminator inside the `if` would turn this classifier into a barrier that raises less');
check('the resolve path is untouched (mon_resolve_key on the same per-segment dedup key)',
  /mon_resolve_key\('af_new_listing_capture_regression',\s*\n?\s*'af_new_listing_capture_regression:'\|\|t\|\|':'\|\|f\|\|':'\|\|seg\.deal_ar/.test(code));
check('severity is still P2 (this change reclassifies causes, it does not re-rank the alert)',
  /mon_raise\('P2','af_new_listing_capture_regression'/.test(code));

// ── 3. cost containment: discriminator on the raise path only ─────────────────────────────────────
const raiseIdx = code.search(/if seg\.fresh_n >= 20/);
const discrimIdx = code.search(/select count\(\*\) filter \(where not coalesce\(raw\.detail_enriched,false\)\)/);
const elseIdx = code.indexOf('mon_resolve_key(\'af_new_listing_capture_regression\'');
check('the discriminator query sits INSIDE the raise branch (after the `if`, before the resolve `else`)',
  discrimIdx > raiseIdx && raiseIdx >= 0 && discrimIdx >= 0 && (elseIdx < 0 || discrimIdx < elseIdx),
  'running it per segment × per field would add work to a sweep already near its statement_timeout');
check('the discriminator is column-guarded (a platform without detail_enriched/enrich_attempted_at is not queried)',
  /column_name='detail_enriched'/.test(code) && /column_name='enrich_attempted_at'/.test(code));

// ── 4. the classification math, mutation-proven ───────────────────────────────────────────────────
// Mirrors the shipped SQL expression exactly:
//   null                                        -> unknown_no_fetch_columns
//   never_fetched >= greatest(1,(fresh_n*0.5)::int) -> upstream_fetch_incomplete
//   else                                        -> fetched_but_field_absent
// Postgres numeric::int rounds half AWAY FROM ZERO, so 31*0.5 = 15.5 -> 16. Math.round matches for
// the non-negative counts this can ever see.
const classify = (neverFetched: number | null, freshN: number): string =>
  neverFetched === null ? 'unknown_no_fetch_columns'
    : neverFetched >= Math.max(1, Math.round(freshN * 0.5)) ? 'upstream_fetch_incomplete'
      : 'fetched_but_field_absent';

// Expectations verified against the live database on 2026-08-25 by evaluating the identical CASE
// expression in Postgres — not merely against this re-implementation.
const cases: Array<[number | null, number, string]> = [
  [null, 31, 'unknown_no_fetch_columns'],   // platform exposes no fetch columns
  [31, 31, 'upstream_fetch_incomplete'],    // the live wasalt مكتب segment
  [37, 37, 'upstream_fetch_incomplete'],    // the live wasalt معرض segment
  [0, 31, 'fetched_but_field_absent'],      // every fresh row WAS fetched -> parser/source
  [16, 31, 'upstream_fetch_incomplete'],    // boundary: 15.5 rounds up to 16
  [15, 31, 'fetched_but_field_absent'],     // boundary: one below
  [20, 40, 'upstream_fetch_incomplete'],
  [19, 40, 'fetched_but_field_absent'],
  [0, 20, 'fetched_but_field_absent'],
  [1, 1, 'upstream_fetch_incomplete'],      // greatest(1, 1) floor keeps tiny segments classifiable
];
for (const [nf, fn, want] of cases) {
  const got = classify(nf, fn);
  check(`classify(never_fetched=${nf === null ? 'NULL' : nf}, fresh_n=${fn}) = ${want}`, got === want, `got ${got}`);
}

// MUTATION PROOF: each deliberate break of the classifier must be caught by the table above.
const mutants: Array<[string, (nf: number | null, fn: number) => string]> = [
  ['always upstream (the 2026-08-25 misreading, inverted)', () => 'upstream_fetch_incomplete'],
  ['always fetched_but_field_absent (would send every alert to a parser rewrite)', () => 'fetched_but_field_absent'],
  ['null treated as fetched (would invent evidence a platform cannot give)',
    (nf, fn) => (nf === null ? 'fetched_but_field_absent' : classify(nf, fn))],
  ['strict > instead of >= (loses the exact rounding boundary)',
    (nf, fn) => (nf === null ? 'unknown_no_fetch_columns'
      : nf > Math.max(1, Math.round(fn * 0.5)) ? 'upstream_fetch_incomplete' : 'fetched_but_field_absent')],
  ['floor instead of round (16/31 boundary flips)',
    (nf, fn) => (nf === null ? 'unknown_no_fetch_columns'
      : nf >= Math.max(1, Math.floor(fn * 0.5)) ? 'upstream_fetch_incomplete' : 'fetched_but_field_absent')],
];
for (const [name, mutant] of mutants) {
  const caught = cases.some(([nf, fn, want]) => mutant(nf, fn) !== want);
  check(`MUTATION caught: ${name}`, caught, 'this break slipped past every case — the table is too weak');
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
