// A SET COMPARISON MUST CATCH THE CANCELLING PAIR — THE ONE A COUNT NEVER CAN.
//
// WHY THIS EXISTS (ops_incident #221, self-reported by routine #9 on 2026-09-12).
//
// scripts/redteam-chain-live.mjs joins eight layers on one captured request. Its L4 layer pays to
// build an INDEPENDENT PostgREST oracle set of (source_table, listing_id) pairs — and then compared
// it to the L6 RPC response by COUNT alone, on every chain it had ever run. The id set was never
// differenced against the first response; only the paginated L8 responses were.
//
// A DROPPED ROW PLUS AN ADDED ROW CANCEL OUT EXACTLY in a count comparison. This repo already knows
// it — verify-trending-set-equals-the-click-live.ts exists because "every other Trending barrier
// compares COUNTS, and a dropped row plus an added row cancel out in every one of them." The same
// blind spot had reopened inside the instrument built to catch it, which is precisely the class
// routine #10 owns: the apparatus produces no symptom when it is wrong.
//
// The differential now lives in scripts/lib/setDifferential.ts, shared by both callers, and THIS
// file executes it against broken inputs. That placement is the point: an inline comparison inside a
// browser-driving script that needs production and a real Chromium cannot be executed by any per-PR
// check, so it could never have been proven where it was.
//
//   node --experimental-strip-types scripts/verify-set-differential-counts-both-directions.ts

import { setDifferential, differentialIsClean, describeDifferential } from './lib/setDifferential.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  mutation caught: ${label}`);
  if (!caught) failed++;
};

console.log('\nA set comparison catches what a count comparison cannot\n');

const truth = new Set(['t1:1', 't1:2', 't1:3', 't2:4']);

// ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────────────────────────
// One row dropped, one row added. The COUNT IS IDENTICAL — 4 and 4 — so every count assertion in
// the chain passes. This is the exact shape that ran undetected.
const cancelling = ['t1:1', 't1:2', 't1:3', 't9:99'];
check('the cancelling pair is invisible to a count comparison (that is the whole problem)',
  cancelling.length === truth.size);
mustCatch('a dropped row and an added row cancelling out in the count',
  !differentialIsClean(setDifferential(cancelling, truth, truth.size)));

const d = setDifferential(cancelling, truth, truth.size);
check('…and the differential names BOTH sides, not just one',
  d.extra.length === 1 && d.extra[0] === 't9:99'
  && d.missing.length === 1 && d.missing[0] === 't2:4',
  describeDifferential(d));

// ── EACH FAILURE MODE INDEPENDENTLY ─────────────────────────────────────────────────────────────
mustCatch('a row the response returned that is NOT in the independent truth set',
  setDifferential(['t1:1', 't1:2', 't1:3', 't2:4', 'ghost:7'], truth, truth.size).extra.length === 1);

mustCatch('a row the truth set holds that a COMPLETE response dropped',
  setDifferential(['t1:1', 't1:2', 't1:3'], truth, 3).missing.length === 1);

mustCatch('the same row returned twice',
  setDifferential(['t1:1', 't1:1', 't1:2', 't1:3'], truth, 4).duplicates === 1);

// A duplicate must be caught even though the response's DISTINCT set is a perfect subset — a
// Set-based comparison would report this as clean, which is why `got` is a list and never a Set.
mustCatch('a duplicate hidden behind a distinct-set comparison',
  !differentialIsClean(setDifferential(['t1:1', 't1:1'], truth, 2)));

// ── THE PARTIAL-PAGE RULE, PROVEN IN BOTH DIRECTIONS ────────────────────────────────────────────
// A first page is a page, not the whole set: reporting its unreturned rows as "missing" would make
// the check scream on every healthy paged search, and a check that cries wolf gets weakened until it
// says nothing (BARRIER_ENGINEER.md PART 6, Prohibition 1).
const page = setDifferential(['t1:1', 't1:2'], truth, 4);
check('a short page does NOT report its unreturned rows as missing',
  page.missing.length === 0 && page.missingComputed === false && differentialIsClean(page));

// ...but a partial page is still not a licence. Both remaining rules bind on a page.
mustCatch('a row outside the truth set smuggled in on a PARTIAL page',
  !differentialIsClean(setDifferential(['t1:1', 'ghost:7'], truth, 4)));
mustCatch('a duplicate smuggled in on a PARTIAL page',
  !differentialIsClean(setDifferential(['t1:1', 't1:1'], truth, 4)));

// And the partial-page exemption must not swallow a genuinely complete response.
check('a COMPLETE response does compute missing (the exemption is not a blanket)',
  setDifferential(['t1:1', 't1:2', 't1:3', 't1:3'], truth, 4).missingComputed === true);

// ── NEGATIVE CONTROLS — not vacuously red ───────────────────────────────────────────────────────
check('an exactly-correct response is clean',
  differentialIsClean(setDifferential(['t1:1', 't1:2', 't1:3', 't2:4'], truth, 4)));
check('…in any order (a set comparison is not an order comparison)',
  differentialIsClean(setDifferential(['t2:4', 't1:3', 't1:1', 't1:2'], truth, 4)));
check('an empty response against an empty truth set is clean, not a false alarm',
  differentialIsClean(setDifferential([], new Set<string>(), 0)));

console.log(failed === 0
  ? '\n✅ the differential catches the cancelling pair, and does not cry wolf on a page\n'
  : `\n❌ ${failed} failure(s)\n`);
process.exit(failed === 0 ? 0 : 1);
