// THE ADVANCED FILTER BUTTON MUST NOT LIE (owner rule, 2026-09-01).
//
//   «If Advanced Filter says "Gym — 3 listings", then selecting Gym must return exactly those 3, and
//    every one of them must really have a gym according to the certified data.»
//
// That contract spans two halves and NEITHER can prove it alone:
//
//   RUNTIME half — do the three deployed RPCs actually agree? The chip count
//   (apartment_guided_counts_ar), the eligible count (af_eligible_count) and the result set
//   (location_search_candidates_ar) are generated from one shared clause into three functions, and
//   only the database can compare what they DO. That is ops_af_option_truth_sweep() +
//   mon_detect_af_option_count_truth(), applied 2026-09-02. A source test cannot see it: the
//   direction defect (chip said 0, tapping returned +320) lived entirely in deployed SQL.
//
//   SOURCE half — THIS FILE. The runtime sweep can only check an option it knows how to apply. If a
//   chip exists in the UI with no entry in the sweep's option table, the sweep silently proves
//   nothing about it and still reports zero defects. So the two option vocabularies must stay in
//   lockstep, and that is a source fact, checkable offline on every PR.
//
// It also pins the two client-side preconditions the runtime sweep ASSUMES:
//   - every AF chip key maps to a real predicate token in the deployed clause;
//   - the client never sends an empty array for p_directions, which fails CLOSED (documented at
//     docs/AF_COHORT_LEDGER.md:138) and would hand the user an honest-looking but wrong empty page.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};

// The migration that carries the sweep's option table. Read the LATEST one that defines it, so a
// later edit to the option list is what this checks against.
const SWEEP_MIGRATION = 'supabase/migrations/20260902003701_af_option_truth_sweep_slicing.sql';
const sweep = read(SWEEP_MIGRATION);
const clause = read('sql/mirrors/af_eligibility_clause.sql');
const advanced = stripComments(read('src/data/advancedFilters.ts'));
const remote = stripComments(read('src/data/remote.ts'));

// ── 1. THE SWEEP IS REAL AND STILL SHAPED THE WAY ITS PROOF DEPENDS ON ────────────────────────
{
  check(/create or replace function ops_af_option_truth_sweep\(/.test(sweep),
    'the runtime sweep function is in the repo (mirrored, not only in production)');
  // chip vs applied is the whole point. If either side stops being read, the sweep passes vacuously.
  // Match the CALL, not the name: `af_eligible_count_DISABLED` still contains `af_eligible_count`,
  // and a substring assertion happily passes on a renamed-out comparison.
  check(/apartment_guided_counts_ar\(/.test(sweep) && /af_eligible_count\(%s, %s\)/.test(sweep),
    'it compares the CHIP count against the APPLIED filter');
  check(/location_search_candidates_ar\(%s, %s,/.test(sweep),
    'and against the RESULT SET the user actually receives');
  check(/count\(\*\) filter \(where not \(%s\)\)/.test(sweep),
    'and re-reads the predicate off each returned row (row_pred) — a count and a set can agree and both be wrong');
  check(/COHORT UNMEASURABLE/.test(read('supabase/migrations/20260902025807_af_option_truth_sweep_fail_loud_and_roster.sql')),
    'a cohort it cannot measure is REPORTED, never skipped in silence');
}

// ── 2. EVERY UI CHIP IS AN OPTION THE SWEEP KNOWS HOW TO APPLY ────────────────────────────────
// This is the assertion that stops the sweep from becoming a vacuous pass. A new chip added to the
// AF with no row in the sweep's option table is a chip nothing proves.
{
  const sweptTokens = new Set(
    [...sweep.matchAll(/p_amenities:=array\[''([a-z_]+)''\]/g)].map((m) => m[1]),
  );
  check(sweptTokens.size >= 10, `the sweep applies a plausible number of amenity tokens (${sweptTokens.size})`);

  // Chip keys offered by the AF amenities question, read from its own defs/push list.
  const amenBlock = advanced.slice(
    advanced.indexOf('const AMENITIES_QUESTION'),
    advanced.indexOf('const BATHROOMS_QUESTION'),
  );
  const chipKeys = [...amenBlock.matchAll(/key:\s*'([a-z_]+)'/g)].map((m) => m[1]);
  check(chipKeys.length >= 7, `found the AF amenity chip keys (${chipKeys.length})`, chipKeys.join(','));

  for (const k of chipKeys) {
    if (k === 'furnished') {
      // furnished is its own tri-state param, not an amenity token — the sweep applies p_furnished.
      check(/p_furnished:=true/.test(sweep) && /p_furnished:=false/.test(sweep),
        'furnished is swept through p_furnished (both states), not as an amenity token');
      continue;
    }
    check(sweptTokens.has(k), `AF chip "${k}" is covered by the runtime sweep`,
      'a chip with no sweep entry is a chip nothing proves — add it to the option table in ' + SWEEP_MIGRATION);
  }

  // …and every token the sweep applies must be a REAL token in the deployed clause, or the sweep is
  // proving something about a filter that matches nothing.
  const vocab = clause.match(/where tok not in \(([^)]*)\)/);
  check(!!vocab, 'the clause mirror still carries the amenity vocabulary guard');
  const clauseTokens = new Set(vocab ? [...vocab[1].matchAll(/''([a-z_]+)''/g)].map((m) => m[1]) : []);
  for (const t of sweptTokens) {
    check(clauseTokens.has(t), `swept token "${t}" exists in the deployed clause vocabulary`);
  }
}

// ── 3. EVERY NON-AMENITY QUESTION FAMILY IS SWEPT TOO ─────────────────────────────────────────
// Derived from the question ids the AF actually defines, so a new question cannot ship unswept.
{
  const ids = [...advanced.matchAll(/^\s*id:\s*'([a-z_]+)',$/gm)].map((m) => m[1]);
  const declared = new Set(ids);
  const SWEEP_PARAM: Record<string, RegExp> = {
    property_age: /p_age_min|p_is_new_construction/,
    street_width: /p_street_width_min:=/,
    direction: /p_directions:=array/,
    bathrooms: /p_bath_min:=/,
    rating: /p_rating_min:=/,
    rnpl: /p_amenities:=array\[''rnpl''\]/,
    unit_subtype: /p_unit_subtypes:=array/,
    furnished: /p_furnished:=/,
    amenities: /p_amenities:=array/,
  };
  for (const id of Object.keys(SWEEP_PARAM)) {
    if (!declared.has(id)) continue;                    // question retired — nothing to sweep
    if (id === 'property_age') {
      // Age counts come from a DIFFERENT rpc (property_age_option_counts_ar), so the sweep needs a
      // second pass for them. It was genuinely uncovered when this file was first written — the
      // check below declared it a known gap, which is what forced it to be closed rather than
      // assumed. Now assert the opposite: the age pass must exist, and must read the right rpc.
      const ageMig = read('supabase/migrations/20260902030143_af_option_truth_sweep_covers_property_age.sql');
      check(/property_age_option_counts_ar/.test(ageMig),
        'property_age is swept through its own rpc (property_age_option_counts_ar), not silently skipped');
      for (const bucket of ['property_age:new', 'property_age:1_2', 'property_age:3_5', 'property_age:6_9', 'property_age:10p']) {
        check(ageMig.includes(bucket), `age bucket "${bucket}" is covered`);
      }
      check(/p_is_new_construction:=true/.test(ageMig),
        "'new' is applied as p_is_new_construction (property_age = 0 server-side), not as an age range");
      continue;
    }
    check(SWEEP_PARAM[id].test(sweep), `question "${id}" is exercised by the runtime sweep`);
  }
}

// ── 4. THE CLIENT NEVER SENDS AN EMPTY p_directions ───────────────────────────────────────────
// p_directions has NO cardinality-0 escape in the clause (asymmetric with p_unit_subtypes, and
// documented at docs/AF_COHORT_LEDGER.md:138). An empty array therefore fails CLOSED — zero rows.
// That is the safe direction, but only because the client cannot send one: deselecting the last
// direction chip must omit the param, never pass []. Both call sites are guarded on `.length`.
{
  const sends = [...remote.matchAll(/\.\.\.\((.{0,60}?)\?\s*\{\s*p_directions:/g)].map((m) => m[1]);
  check(sends.length >= 2, `every p_directions call site is a guarded spread (${sends.length} found)`);
  for (const g of sends) {
    check(/directions\?\.length/.test(g),
      'the p_directions spread is gated on .length, so [] is never sent', g.trim());
  }
  check(/asymmetric with other array params|fails closed/i.test(read('docs/AF_COHORT_LEDGER.md')),
    'the fail-closed asymmetry stays documented for the next reader');
}

console.log(failed === 0
  ? '\n✅ verify-af-option-count-equals-listings: all checks passed.'
  : `\n❌ verify-af-option-count-equals-listings: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
