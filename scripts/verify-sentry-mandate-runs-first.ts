// EVERY ROUTINE MUST READ SENTRY BEFORE ITS BIG SWEEP — not after (owner rule 2026-08-29)
//
// WHY THIS EXISTS. `verify-sentry-routing-wired.ts` proves the §S SENTRY mandate is PRESENT in
// every routine's canonical spec. It does not prove the mandate is REACHED at runtime. On
// 2026-08-29 the Systems Seam routine took 35 minutes of its run before it got to §S — because
// §S sat at line 380 out of 393 (97% of the way through the spec). If PART 3 had run 60+ minutes,
// §S would have been skipped entirely. A mandate that lives at the end of the spec is a mandate
// that only runs when everything else was cheap.
//
// This barrier turns that shape into a test. §S must sit in the FIRST 20% of every canonical
// routine spec — after §0 (mandate / operating contract) is fine, before PART 1 / section 1 is
// required. Any future edit that demotes §S back to the end fails `npm test`.
//
// This is a source-shape barrier (pure disk read, no network). It cannot itself prove the routine
// USED §S at runtime — that half is observed by reading each routine's own FINAL REPORT (its
// `SENTRY ISSUES CLAIMED THIS RUN: N` and `RESOLVED THIS RUN: N` lines, which
// `verify-sentry-routing-wired.ts` already pins). Both barriers together make skipping
// impossible in either dimension.

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};

console.log('\nSentry mandate must run early in every routine spec (owner 2026-08-29)\n');

// The six canonical routine specs (the same set `verify-sentry-routing-wired.ts` pins for
// presence). ENGINEER_ROUTINES.md carries routines #1 and #2; the others are one-per-file.
const ROUTINE_FILES = [
  'docs/ops/ENGINEER_ROUTINES.md',
  'docs/ops/DATA_INTEGRITY_ENGINEER.md',
  'docs/ops/SEARCH_MATCH_QA_ENGINEER.md',
  'docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md',
  'docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md',
  'docs/ops/SYSTEMS_SEAM_ENGINEER.md',
];

// §S must appear within this fraction of the file's total line count. 25% is the ceiling — the
// mandate should almost always land in the top 10-15% (right after §0 opening mandate, before
// PART 1). ENGINEER_ROUTINES.md is a multi-routine directory with ~40 lines of schedule/routing
// prose up top, which pushes §S to ~23%; the 25% bar accepts that while still refusing anything
// buried past the first quarter of a spec.
const EARLY_FRACTION = 0.25;

for (const rel of ROUTINE_FILES) {
  const p = new URL(`../${rel}`, import.meta.url).pathname;
  const raw = readFileSync(p, 'utf8');
  const lines = raw.split('\n');
  const total = lines.length;

  // Find the §S header line (1-indexed).
  const headerRe = /^## §S — SENTRY \(mandatory every run, owner rule 2026-08-28\)/;
  const ssIdx = lines.findIndex((l) => headerRe.test(l));
  check(`${rel}: §S header present`, ssIdx >= 0);
  if (ssIdx < 0) continue;

  const ssLine = ssIdx + 1;
  const pct = (ssLine / total) * 100;
  const ceiling = Math.floor(total * EARLY_FRACTION);
  check(
    `${rel}: §S sits in the first ${Math.round(EARLY_FRACTION * 100)}% (line ${ssLine}/${total} = ${pct.toFixed(0)}%)`,
    ssLine <= ceiling,
    ssLine > ceiling ? `must be ≤ line ${ceiling} (found at ${ssLine})` : '',
  );

  // Second, semantic check: §S must appear BEFORE the first "PART 1" / "## 1." / "## §1"
  // section header. That's the "before the big sweep" invariant in prose form. Some specs use
  // "## PART 1", some use "## 1.", some use "## §1" — accept any.
  const bigSweepRe = /^## (?:PART 1|1\.|§1|## §1)/i;
  const sweepIdx = lines.findIndex((l) => bigSweepRe.test(l));
  if (sweepIdx >= 0) {
    check(
      `${rel}: §S appears BEFORE the first big sweep section`,
      ssIdx < sweepIdx,
      ssIdx >= sweepIdx ? `§S at ${ssLine}, first sweep at ${sweepIdx + 1}` : '',
    );
  }
}

console.log(
  failed
    ? `\n✗ ${failed} check(s) FAILED — §S is buried too deep in one or more specs; a routine that runs long will skip Sentry`
    : '\n✓ §S sits early in every routine spec — Sentry is checked before the big sweep, not after it',
);
process.exit(failed ? 1 : 0);
