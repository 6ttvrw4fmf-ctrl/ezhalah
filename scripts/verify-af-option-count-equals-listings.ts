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

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';
import { loadLifted, buildMatrix, recorder } from './lib/afMatrix.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};

// EVERY migration that touches the sweep, oldest → newest, concatenated. The first version of
// this file hard-coded ONE migration under the comment "read the LATEST one that defines it" —
// and two later migrations (025807, 030143) had already rewritten the function through replace()
// needle-edits, so an option row added there would never have been seen. A needle-edit does not
// carry the whole option table, so the union over every definer is what the deployed body holds.
const SWEEP_MIGRATIONS = readdirSync(join(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql') && read(`supabase/migrations/${f}`).includes('ops_af_option_truth_sweep'))
  .sort();
const SWEEP_MIGRATION = `supabase/migrations/${SWEEP_MIGRATIONS[SWEEP_MIGRATIONS.length - 1]}`;
const sweep = SWEEP_MIGRATIONS.map((f) => read(`supabase/migrations/${f}`)).join('\n');
check(SWEEP_MIGRATIONS.length >= 4, `the sweep's migrations were found (${SWEEP_MIGRATIONS.length}: ${SWEEP_MIGRATIONS.join(', ')})`);
const clause = read('sql/mirrors/af_eligibility_clause.sql');
const advanced = stripComments(read('src/data/advancedFilters.ts'));   // question ids only (§3)
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

  // Chip keys the amenities card can OFFER, on ANY certified cohort — by EXECUTING the real
  // AMENITIES_QUESTION.resolveOptions() over the whole matrix (scripts/lib/afMatrix.ts), never by a
  // regex over `key: '…'` text: a chip pushed from a COHORT_CHIPS list or a helper would have been
  // invisible to the literal scan, and a decoy string would have satisfied it.
  const L = await loadLifted(root);
  const rec = recorder();
  const cells = await buildMatrix(L, { guided: rec.row, age: rec.row });
  const chipKeys = [...new Set(cells.flatMap((c) =>
    c.fields.filter((f) => f.question.id === 'amenities').flatMap((f) => f.options.map((o) => o.key))))].sort();
  // …and the COLUMN each chip reads (recorded by executing the card on a recorder row) must be the
  // column the sweep compares for that token — a chip reading cnt_pool under key gym would pass the
  // key check and prove the wrong number. Pairs come from the sweep's own option rows.
  const sweptCol = new Map([...sweep.matchAll(/\('amenity:([a-z_]+)','(cnt_[a-z_0-9]+)'/g)].map((m) => [m[1], m[2]]));
  const chipCol = new Map(cells.flatMap((c) =>
    c.fields.filter((f) => f.question.id === 'amenities').flatMap((f) => f.options.map((o) => [o.key, String(o.count)] as const))));
  for (const [k, col] of chipCol) {
    if (k === 'furnished') continue;
    check(sweptCol.get(k) === col, `AF chip "${k}" reads ${col}, and the sweep proves that same column (${sweptCol.get(k) ?? 'no row'})`);
  }
  check(chipKeys.length >= 12, `found the AF amenity chip keys by executing the card over every cohort (${chipKeys.length})`, chipKeys.join(','));

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
  // ONE call site since 2026-09-02: rpcAdvancedFilterParams() is the only place that writes
  // p_directions — the results path's hand-typed second copy was folded into the builder. A second
  // literal appearing again would be a hand copy coming back, which is its own finding.
  const literals = (remote.match(/\bp_directions\s*:/g) ?? []).length;
  check(sends.length === 1 && literals === 1,
    `p_directions is written in exactly ONE guarded spread — the shared builder (${sends.length} guarded, ${literals} literal)`);
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
