// Regression guard (2026-08-15, senior audit run #21) for wasalt rent-period fidelity.
//
// THREE THINGS THIS PINS, and why each one is a real failure mode
// ---------------------------------------------------------------
// 1. run.py must PRESERVE the raw `rentFreq` block it reads.
//    Until this run, run.py read propertyInfo.rentFreq, derived price_annual from it, and threw the
//    block away. The only other copy was `ar_data`, written once by enrich_ar and never refreshed —
//    measured 42.1 days stale on average (max 50.7; 10,533 of 10,688 rows older than 7 days). So
//    "does the LIST endpoint publish its own yearly amount?" was UNANSWERABLE from the database and
//    the standing P1 was formally blocked on it. Evidence has to be captured at read time or the
//    question comes back forever.
//
// 2. run.py must NOT quietly start storing rf_yearly["amount"] in the monthly-default branch.
//    This looks like the obvious fidelity fix — the stored annual really is monthly*12, and wasalt
//    really does publish a different yearly (13 of 14 contemporaneous rows). But the card renders
//    price_annual/12 as the monthly headline, so storing a yearly that is not exactly 12x would
//    misstate the monthly price the source advertises. ONE column cannot carry both published
//    figures; choosing which the card shows is an owner product decision (AGENTS.md RED: product
//    meaning). This guard exists so a future session cannot "helpfully" change 318 served prices
//    without that decision. When the owner decides, update THIS guard in the same change.
//
// 3. The staleness gate must stay on the corroboration view + detector.
//    Without it the barrier compares an 8-hourly value against a ~6-week-old snapshot and reports
//    ordinary rent changes as source contradictions — a permanently unresolvable P1. Proven both
//    directions when the gate went in: contemporaneous 46 compared / 0 mismatched; stale 10,648
//    compared / 11 mismatched. Every standing mismatch was stale-only.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-wasalt-rent-period-evidence: raw rentFreq preserved, x12 decision pinned,');
console.log('  and the barrier gated on snapshot age.');

// ── 1. run.py preserves the raw block ──────────────────────────────────────────────────────────
const run = readFileSync('scrapers/wasalt/run.py', 'utf8');
check(
  'run.py captures the rentFreq block into a variable',
  /rent_freq_evidence\s*=\s*rent_freq\s+or\s+None/.test(run),
);
check(
  'run.py writes it to source_capture (so the annualisation question stays answerable)',
  /"source_capture"\s*:\s*\{[^}]*"rent_freq"\s*:\s*rent_freq_evidence/.test(run),
);
check(
  'the capture is conditional, so a listing whose source sent no rentFreq stores nothing',
  /if rent_freq_evidence else \{\}/.test(run),
);

// ── 2. the monthly-default branch still uses *12, deliberately ─────────────────────────────────
// Isolate the branch body so we test THAT branch, not the legitimate `elif` that reads rf_yearly.
const branch = run.match(
  /if rf_monthly\.get\("default_freq"\)[\s\S]*?rent_price = int\(rf_monthly\["amount"\]\) \* 12/,
);
check('the monthly-default branch is present and parseable', !!branch);
if (branch) {
  check(
    'it does NOT assign rent_price from rf_yearly (owner decision pending — see header)',
    !/rent_price\s*=\s*rf_yearly/.test(branch[0]),
    'swapping to the published yearly would misstate the card\'s monthly headline',
  );
  check(
    'the deliberate choice is documented in place, not silent',
    /owner|RED|product decision/i.test(branch[0]),
  );
}
// The yearly-default branch must keep storing the PUBLISHED figure, never a derivation.
check(
  'the yearly-default branch stores the source figure verbatim',
  /elif rf_yearly\.get\("amount"\):\s*\n\s*rent_price = rf_yearly\["amount"\]/.test(run),
);

// ── 3. the staleness gate is committed ─────────────────────────────────────────────────────────
const migDir = 'supabase/migrations';
const gate = readdirSync(migDir).filter((f) => f.includes('rent_period_staleness_gate'));
check('the staleness-gate migration is committed', gate.length > 0, gate.join(', '));
if (gate.length) {
  const sql = readFileSync(join(migDir, gate[0]), 'utf8');
  check('the corroboration view exposes the snapshot age', /ar_age_hours/.test(sql));
  check('the view exposes a contemporaneous flag', /as contemporaneous/.test(sql));
  check(
    'P1 fires only on a CONTEMPORANEOUS disagreement',
    /filter \(where stored_period is distinct from source_period and contemporaneous\)/.test(sql),
  );
  check(
    'a stale-only population is still reported (the barrier distinguishes, never silences)',
    /rent_period_stale_snapshot_only/.test(sql),
  );
  check(
    'the annualisation exposure has its own detector',
    /mon_detect_wasalt_annualisation_fabricated/.test(sql),
  );
}
const roster = readdirSync(migDir).filter((f) => f.includes('roster_wire_wasalt_annualisation'));
check('the new detector is wired into the roster (else it is decoration)', roster.length > 0);

console.log('');
if (failures > 0) {
  console.error(`❌ verify-wasalt-rent-period-evidence: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ verify-wasalt-rent-period-evidence: all checks passed.');

// ═══ MUTATION PROOFS ════════════════════════════════════════════════════════════════════════════
// Every check() above reads a regex over source TEXT — necessary here, since the guarded logic is
// Python and this repo has no Python-lifting equivalent of scripts/lib/liftSymbols.ts. A text
// predicate can still be PROVEN: extract it as a pure function of the source string, feed it the
// real defect (reconstructed by mutating the ACTUAL current run.py content, not a synthetic
// snippet), and show it fails — then show the unmutated original still passes. That is R1's
// technique applied to a text reader instead of an executable symbol.
console.log('\n── mutation proofs — each guard must FAIL on its own defect ──────────────────────');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// Pure predicates, mirroring the checks above exactly, so a proof and the guard it proves can never
// silently diverge.
const capturesRawBlock = (src: string) => /rent_freq_evidence\s*=\s*rent_freq\s+or\s+None/.test(src);
const writesToSourceCapture = (src: string) =>
  /"source_capture"\s*:\s*\{[^}]*"rent_freq"\s*:\s*rent_freq_evidence/.test(src);
const captureIsConditional = (src: string) => /if rent_freq_evidence else \{\}/.test(src);
const monthlyBranchOf = (src: string) => src.match(
  /if rf_monthly\.get\("default_freq"\)[\s\S]*?rent_price = int\(rf_monthly\["amount"\]\) \* 12/,
)?.[0];
const monthlyBranchAvoidsYearly = (branch: string) => !/rent_price\s*=\s*rf_yearly/.test(branch);
const yearlyBranchStoresVerbatim = (src: string) =>
  /elif rf_yearly\.get\("amount"\):\s*\n\s*rent_price = rf_yearly\["amount"\]/.test(src);

// ── 1. the capture (defect #1 in the header — 42.1-day-stale ar_data, formally unanswerable) ──────
mustCatch('the raw rentFreq capture deleted — the ORIGINAL P1 defect, verbatim',
  !capturesRawBlock(run.replace('rent_freq_evidence = rent_freq or None', 'rent_freq_evidence = None')));
mustCatch('the capture renamed so it silently stops feeding source_capture',
  !capturesRawBlock(run.replace(/rent_freq_evidence = rent_freq or None/, 'rfe = rent_freq or None')));
mustCatch('source_capture stops writing the rent_freq field',
  !writesToSourceCapture(run.replace(
    '"rent_freq": rent_freq_evidence', '"rent_freq_dropped": rent_freq_evidence',
  )));
mustCatch('the conditional dropped so source_capture is written unconditionally, even when rent_freq_evidence is None',
  !captureIsConditional(run.replace('if rent_freq_evidence else {}', 'if True else {}')));

// ── 2. the monthly-default branch (defect #2 — the "helpful" x12→rf_yearly swap) ──────────────────
const healthyBranch = monthlyBranchOf(run);
mustCatch('the monthly-default branch present at all — a refactor that renames default_freq',
  monthlyBranchOf(run.replace(
    'elif rf_monthly.get("default_freq")', 'elif rf_monthly.get("is_default")',
  )) === undefined);
if (healthyBranch) {
  mustCatch('the EXACT historical near-miss: swapping to rf_yearly["amount"] in the monthly-default branch',
    !monthlyBranchAvoidsYearly(
      healthyBranch.replace(
        'rent_price = int(rf_monthly["amount"]) * 12',
        'rent_price = int(rf_monthly["amount"]) * 12\n            rent_price = rf_yearly["amount"]',
      ),
    ));
  mustCatch('…while the genuine, unmutated branch is NOT flagged (negative control)',
    monthlyBranchAvoidsYearly(healthyBranch));
}
mustCatch('the yearly-default branch changed to derive instead of store verbatim (a fabricated figure)',
  !yearlyBranchStoresVerbatim(run.replace(
    // The naive mutant `rent_price = rf_yearly["amount"] // 12 * 12` still contains the exact
    // matched substring as a PREFIX, so the un-anchored regex keeps matching it — caught on this
    // proof's first run. Wrapping in int(...) breaks the literal text the regex requires.
    '        elif rf_yearly.get("amount"):\n            rent_price = rf_yearly["amount"]',
    '        elif rf_yearly.get("amount"):\n            rent_price = int(rf_yearly["amount"]) // 12 * 12',
  )));
mustCatch('…while the genuine branch IS recognised as storing verbatim (negative control)',
  yearlyBranchStoresVerbatim(run));

// ── 3. the staleness gate (defect #3 — comparing an 8-hourly value against a ~6-week snapshot) ────
if (gate.length) {
  const sql = readFileSync(join(migDir, gate[0]), 'utf8');
  const p1FiresOnlyContemporaneous = (s: string) =>
    /filter \(where stored_period is distinct from source_period and contemporaneous\)/.test(s);
  mustCatch('the contemporaneous gate dropped from the P1 filter — the ORIGINAL staleness defect',
    !p1FiresOnlyContemporaneous(sql.replace(
      'filter (where stored_period is distinct from source_period and contemporaneous)',
      'filter (where stored_period is distinct from source_period)',
    )));
  mustCatch('…while the genuine, gated SQL is NOT flagged (negative control)',
    p1FiresOnlyContemporaneous(sql));
  const staleReportedExists = (s: string) => /rent_period_stale_snapshot_only/.test(s);
  mustCatch('the stale-only population silently dropped (the barrier would then be silencing, not distinguishing)',
    !staleReportedExists(sql.replace(/rent_period_stale_snapshot_only/g, 'x')));
}

console.log('');
if (mutFail) {
  console.error(`✗ ${mutFail} guard(s) are BLIND to their own defect\n`);
  process.exit(1);
}
console.log('✓ every guard in this file was watched to fail against its own defect\n');
