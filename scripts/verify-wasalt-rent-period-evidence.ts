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
