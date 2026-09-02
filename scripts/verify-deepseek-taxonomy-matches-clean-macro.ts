// DEEPSEEK EDGE TAXONOMY vs CLEAN_MACRO — deterministic, EXECUTED cross-check (owner bug-class fix,
// 2026-09-01, item 8c).
//
// THE BUG THIS GUARDS: the deployed edge function (supabase/functions/agent/index.ts) hand-maintains
// its own RESIDENTIAL_TYPES/COMMERCIAL_TYPES arrays for the LLM prompt — a SECOND copy of the
// macro-per-type fact that src/data/propertyTypes.ts's CLEAN_MACRO (derived from HIERARCHY, the
// single source of truth) already holds. Found already desynced twice over: RESIDENTIAL_TYPES
// omitted Studio and Duplex entirely (both real Residential clean types) while SYNONYMS told the
// model to fold both into Apartment; COMMERCIAL_TYPES listed Farm and Agriculture Plot, both of
// which CLEAN_MACRO has always classified Residential (they sit in the Residential 'Vacation & Rural'
// group). A model told the wrong macro for a type can misfile a search's category end to end.
//
// WHY REAL EXECUTION, NOT A REGEX (this repo's standing "never test a copy of production code" +
// "a comment is not a code path" rules): a text-pattern check can be satisfied by a stale comment or
// a coincidentally-matching substring and proves nothing about what the arrays actually CONTAIN. This
// extracts the two array literals from the ACTUAL edge function source with `new Function(...)` —
// executing the real declaration, not a hand-copied duplicate of it — then checks every entry against
// the real, imported CLEAN_MACRO. A type present in BOTH constants would be a contradiction (asking
// the model for one canonical type per request, from a self-contradictory vocabulary) — checked too.
//
//   node --experimental-strip-types scripts/verify-deepseek-taxonomy-matches-clean-macro.ts   (npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLEAN_MACRO } from '../src/data/propertyTypes.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

const root = join(import.meta.dirname, '..');
const edgeSrc = readFileSync(join(root, 'supabase/functions/agent/index.ts'), 'utf8');

// Extract the REAL array literal text for a given const name and EXECUTE it — not a copy, the actual
// declaration as it stands in the deployed source.
function extractArray(src: string, name: string): string[] {
  const m = new RegExp(`const ${name}\\s*=\\s*(\\[[\\s\\S]*?\\]);`).exec(src);
  if (!m) throw new Error(`could not find "const ${name} = [...]" in supabase/functions/agent/index.ts`);
  // eslint-disable-next-line no-new-func -- executing the real literal, not a copy; see header.
  const arr = new Function(`return ${m[1]};`)();
  if (!Array.isArray(arr) || !arr.every((x) => typeof x === 'string')) {
    throw new Error(`${name} did not evaluate to a string array`);
  }
  return arr;
}

const RESIDENTIAL_TYPES = extractArray(edgeSrc, 'RESIDENTIAL_TYPES');
const COMMERCIAL_TYPES = extractArray(edgeSrc, 'COMMERCIAL_TYPES');

check('RESIDENTIAL_TYPES and COMMERCIAL_TYPES were both extracted and are non-empty',
  RESIDENTIAL_TYPES.length > 5 && COMMERCIAL_TYPES.length > 5);

// ── every REAL clean type named in either array must sit on the SAME macro side CLEAN_MACRO puts it
// on. Entries that are agent-vocabulary synonyms rather than clean types (e.g. "House" folds into
// Villa, "Building" is the legacy label for "Residential Building") are not in CLEAN_MACRO at all and
// are skipped here — this checks REAL clean types only, executed against the real registry. ──────────
console.log('\n── every real clean type in RESIDENTIAL_TYPES is CLEAN_MACRO-Residential ──');
for (const type of RESIDENTIAL_TYPES) {
  if (!(type in CLEAN_MACRO)) continue; // agent-vocabulary synonym, not a clean type — see above
  check(`"${type}" is CLEAN_MACRO-Residential`, CLEAN_MACRO[type] === 'Residential',
    `CLEAN_MACRO['${type}'] = ${CLEAN_MACRO[type]}`);
}
console.log('\n── every real clean type in COMMERCIAL_TYPES is CLEAN_MACRO-Commercial ──');
for (const type of COMMERCIAL_TYPES) {
  if (!(type in CLEAN_MACRO)) continue;
  check(`"${type}" is CLEAN_MACRO-Commercial`, CLEAN_MACRO[type] === 'Commercial',
    `CLEAN_MACRO['${type}'] = ${CLEAN_MACRO[type]}`);
}

// ── no type may appear in BOTH lists — the model is asked for exactly one canonical type, and a
// vocabulary that offers the same word under two macros is self-contradictory by construction ──────
console.log('\n── no type is listed under both macros ──');
const overlap = RESIDENTIAL_TYPES.filter((t) => COMMERCIAL_TYPES.includes(t));
check('RESIDENTIAL_TYPES and COMMERCIAL_TYPES do not overlap', overlap.length === 0,
  `overlap: ${JSON.stringify(overlap)}`);

// ── the two types this bug named by name: must now be present, Residential, and never folded into
// Apartment by SYNONYMS ──────────────────────────────────────────────────────────────────────────
console.log('\n── Studio and Duplex: present, Residential, never folded into Apartment ──');
check("'Studio' is in RESIDENTIAL_TYPES", RESIDENTIAL_TYPES.includes('Studio'));
check("'Duplex' is in RESIDENTIAL_TYPES", RESIDENTIAL_TYPES.includes('Duplex'));
check("CLEAN_MACRO agrees: Studio is Residential", CLEAN_MACRO['Studio'] === 'Residential');
check("CLEAN_MACRO agrees: Duplex is Residential", CLEAN_MACRO['Duplex'] === 'Residential');
check("SYNONYMS maps a studio synonym to Studio, not Apartment",
  /studio[^\n]{0,40}→\s*Studio\b/i.test(edgeSrc));
check("SYNONYMS maps a duplex synonym to Duplex, not Apartment/Villa",
  /duplex[^\n]{0,60}→\s*Duplex\b/i.test(edgeSrc));
check("no SYNONYMS clause folds 'studio' into Apartment",
  !/studio[^\n]{0,60}→\s*Apartment\b/i.test(edgeSrc));
check("no SYNONYMS clause folds 'duplex' into Apartment",
  !/duplex[^\n]{0,60}→\s*Apartment\b/i.test(edgeSrc));

// ── Farm and Agriculture Plot: this bug's second half — must now be Residential, never Commercial ──
console.log('\n── Farm and Agriculture Plot: present, Residential (not Commercial) ──');
check("'Farm' is in RESIDENTIAL_TYPES, not COMMERCIAL_TYPES",
  RESIDENTIAL_TYPES.includes('Farm') && !COMMERCIAL_TYPES.includes('Farm'));
check("'Agriculture Plot' is in RESIDENTIAL_TYPES, not COMMERCIAL_TYPES",
  RESIDENTIAL_TYPES.includes('Agriculture Plot') && !COMMERCIAL_TYPES.includes('Agriculture Plot'));
check("CLEAN_MACRO agrees: Farm is Residential", CLEAN_MACRO['Farm'] === 'Residential');
check("CLEAN_MACRO agrees: Agriculture Plot is Residential", CLEAN_MACRO['Agriculture Plot'] === 'Residential');

console.log(failed === 0
  ? '\n✓ DeepSeek edge taxonomy matches CLEAN_MACRO on every real clean type'
  : `\n✗ ${failed} check(s) FAILED — the edge function's taxonomy has drifted from CLEAN_MACRO`);
process.exit(failed === 0 ? 0 : 1);
