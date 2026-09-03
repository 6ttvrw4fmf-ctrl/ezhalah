// Regression test — Sanadak published a building age for 1,236 rows and we threw all of it away.
//
// THE DEFECT (alert af_mapping_unplumbed #1285, adjudicated 2026-09-03). Sanadak's RSC payload has
// always carried `buildingAge`, and scrapers/sanadak/run.py has always captured it into
// `source_capture` — but the stored row never mapped it onto `property_age`. Result: property_age
// was NULL on 100% of 1,707 stored Sanadak rows while 1,236 of them (1,030 residential + 206
// commercial) had a published age sitting in the capture blob.
//
// WHY THAT IS WORSE THAN A MISSING NICE-TO-HAVE. The AF `property_age` predicate is strict and
// NULL-excluding by design (ADVANCED_FILTER_SOURCE_TRUTH.md §2.5), so the instant a user answered
// «كم عمر العقار تقريباً؟» every Sanadak listing vanished from their results — not because the
// platform was silent about the age, but because we were. That is §1's TRAPPING failure mode, and
// it is invisible to every count-based barrier: a uniformly-NULL column looks exactly like "the
// source never published it". Only a mapping-vs-capture cross-check can see it. Since 2026-09-03
// it is also a §12A/R13.12 problem — the card now shows the user's AF answers back, and a field we
// silently dropped is a field the card can never evidence.
//
// WHAT WAS ADJUDICATED, AND HOW. Not from the number's shape — from the source itself, twice:
//   buildingAge 11 → sanadak.sa renders «عمر البناء: 11 سنين»
//   buildingAge  0 → sanadak.sa renders «عمر البناء: أقل من سنة»
// So it is a literal year count, and 0 is a PUBLISHED value, not a blank. Both probes are pinned as
// fixtures below, because "the source publishes it in years" is the assumption the whole mapping
// rests on and a future reader must be able to see the evidence without re-fetching the site.
//
// One listing's broker-written description says «العمر: 15 سنة تقريباً» while its structured
// buildingAge is 11 — a disagreement INSIDE the source. The structured field is what the platform
// publishes as the age, so it is what we carry; we do not adjudicate prose against a platform's own
// field, and we do not "correct" either side.
//
// WHAT THIS PINS. It drives the REAL Python (never a JS reimplementation of it):
//   1. 0 SURVIVES. This is the whole reason `_age_years` exists instead of the existing `_int`,
//      which maps 0 → None because it treats 0 as empty. That is right for an area and wrong for
//      an age: it would have erased «أقل من سنة» on 285 rows, converting a published fact into
//      UNKNOWN — precisely what P2 forbids. The mutation proof below runs the OLD `_int` on the
//      same input and asserts it returns None, so this check cannot pass on the pre-fix code.
//   2. A missing/blank key stays None. UNKNOWN must stay UNKNOWN; nothing is invented.
//   3. Junk is refused, never coerced: a bool (an int subclass in Python — `int(True)` is 1, i.e.
//      "1 year"), a non-numeric string, a negative, an absurd value.
//   4. The row builder actually WIRES it. A helper that works while the row never carries it is
//      the exact bug this file exists for, so the assertion is on `property_age` in the built row,
//      not just on the helper.
//
//   node --experimental-strip-types scripts/verify-sanadak-building-age-mapped.ts   (in `npm test`)

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_PY = join(REPO_ROOT, 'scrapers/sanadak/run.py');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    JSON.stringify(actual) === JSON.stringify(expected) ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// The two live source probes this mapping rests on (sanadak.sa, 2026-09-03). Pinned as evidence,
// and used below as the values the helper must reproduce.
const SOURCE_PROBES = [
  { buildingAge: 0, rendered: 'أقل من سنة', expectYears: 0 },
  { buildingAge: 11, rendered: '11 سنين', expectYears: 11 },
];

/** Run the REAL `_age_years` (and, for the mutation proof, the REAL `_int`) out of run.py. */
function runHelpers(values: unknown[]): { age: (number | null)[]; int_: (number | null)[] } {
  const py = `
import json, sys, importlib.util, pathlib
spec = importlib.util.spec_from_file_location("sanadak_run", ${JSON.stringify(RUN_PY)})
m = importlib.util.module_from_spec(spec)
sys.modules["sanadak_run"] = m
spec.loader.exec_module(m)
vals = json.load(sys.stdin)
def safe(fn, v):
    try: return fn(v)
    except Exception as e: return "RAISED:" + type(e).__name__
print(json.dumps({"age": [safe(m._age_years, v) for v in vals],
                  "int_": [safe(m._int, v) for v in vals]}))
`;
  const out = execFileSync('python3', ['-c', py], { input: JSON.stringify(values), encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop()!);
}

console.log('verify-sanadak-building-age-mapped: a published building age must reach property_age,');
console.log('  0 must survive as «أقل من سنة», and a silent source must stay UNKNOWN.\n');

// ── 1. the two source-adjudicated values ────────────────────────────────────────────────────────
{
  const r = runHelpers(SOURCE_PROBES.map((p) => p.buildingAge));
  for (let i = 0; i < SOURCE_PROBES.length; i++) {
    const p = SOURCE_PROBES[i];
    eq(`source probe: buildingAge ${p.buildingAge} («${p.rendered}») → property_age ${p.expectYears}`,
      r.age[i], p.expectYears);
  }
  // THE MUTATION PROOF. On the pre-fix code the only available converter was `_int`, and `_int(0)`
  // is None — so had the fix reused it, «أقل من سنة» would have become UNKNOWN on 285 rows. This
  // asserts the old helper still behaves that way, which is what makes check 1 above non-vacuous:
  // it fails if someone "simplifies" _age_years back into _int.
  eq('MUTATION: the pre-existing _int(0) still returns None — so reusing it would erase «أقل من سنة»',
    r.int_[0], null);
  check('…and _age_years does NOT agree with _int on 0 (the two are genuinely different functions)',
    r.age[0] !== r.int_[0], `_age_years(0)=${JSON.stringify(r.age[0])} vs _int(0)=${JSON.stringify(r.int_[0])}`);
}

// ── 2. UNKNOWN stays UNKNOWN; junk is refused rather than coerced ───────────────────────────────
{
  const junk = [null, '', 'جديد', -1, 5000, true, false, {}, []];
  const r = runHelpers(junk);
  eq('a missing key, a blank, prose, a negative, an absurd age, a bool or a container → None (UNKNOWN)',
    r.age, junk.map(() => null));
}

// ── 3. ordinary years round-trip exactly (no bucketing, no re-scaling) ──────────────────────────
{
  const years = [1, 2, 3, 5, 10, 12, 13, 40];
  const r = runHelpers(years);
  eq('every ordinary year value passes through unchanged', r.age, years);
  eq('a numeric string and a whole float are the same age', runHelpers(['7', 7.0]).age, [7, 7]);
}

// ── 4. the ROW actually carries it — a helper nothing calls is the bug, not the fix ─────────────
{
  const src = readFileSync(RUN_PY, 'utf8');
  const wired = /"property_age":\s*_age_years\(o\.get\("buildingAge"\)\)/.test(src);
  check('the built row maps property_age from buildingAge via _age_years', wired,
    wired ? '' : 'run.py builds a row with no property_age wired to _age_years — the capture would be dropped again');
  check('and it does NOT go through _int, which would silently drop every «أقل من سنة»',
    !/"property_age":\s*_int\(/.test(src));
}

console.log('');
if (failed) { console.error(`✗ verify-sanadak-building-age-mapped: ${failed} check(s) FAILED`); process.exit(1); }
console.log('✓ Sanadak\'s published building age reaches property_age in literal years, 0 included, and silence stays silence');
