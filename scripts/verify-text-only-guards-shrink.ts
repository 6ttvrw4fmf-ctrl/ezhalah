// THE SECOND RATCHET: a barrier that only READS TEXT and has never been WATCHED TO FAIL.
//
// Why this exists, and why the existing grandfather count could not do its job (ops_incident #136,
// owner routine #10, 2026-09-18).
//
// `verify-new-barriers-are-mutation-proven.ts` counts barriers with no mutation proof. That number
// (304 today) MIXES TWO VERY DIFFERENT POPULATIONS:
//
//   * a barrier that LIFTS AND RUNS a real symbol but was written before the proof rule — green
//     there still means "the real function was executed and behaved";
//   * a barrier that only greps a product file — green there means "a regex matched some text".
//
// The two are not the same evidence, and averaging them hides the sharp number. Measured by routine
// #9 on 2026-09-14 and filed as #136: of 408 barriers that read source text, 134 ALSO execute
// product code, so their text-reading is supplementary. The population where green carries the
// LEAST evidence is the intersection — text-only AND never once watched to fail. That is the set
// this file counts, and it is shrink-only.
//
// THE MEASURED GROUND. This is not a stylistic preference. On 2026-09-04 an audit found FIVE
// barriers that ASSERTED THE BUG rather than catching it, and every one of them was a source-TEXT
// tripwire over a code path that was broken the whole time the barrier was green — two of them
// literally pinned the defective line as correct (docs/ops/BARRIER_ENGINEER.md §0.1).
//
// TWO WAYS TO LEAVE THIS SET, BOTH REAL REPAIRS, NEITHER A WEAKENING:
//   1. Convert the barrier to EXECUTE the symbol (scripts/lib/liftSymbols.ts exists for exactly the
//      files that cannot be imported), or
//   2. Give it a mutation proof, so its failure mode has at least been demonstrated once.
// There is no third way out, and in particular EDITING THIS CEILING UPWARDS IS NOT ONE — the
// ceiling is a ratchet, and PART 6 Prohibition 1 refuses loosening a guard to make a sweep read
// clean.
//
// NOT ALL MEMBERS ARE DEFECTS, AND THIS FILE DOES NOT CLAIM THEY ARE. Some read text for a reason
// that cannot be executed at all — a committed SQL mirror, a workflow YAML, a JSON registry, or an
// effect inside a 200KB screen component that cannot be lifted (verify-city-rehydration.ts states
// exactly that at its line 44). The set is a PRIORITY ORDER for the R1/R3 ratchets, worked by blast
// radius — price, count honesty, auth, source fidelity, deletion first — not a list of bugs.
//
// Run: node --experimental-strip-types scripts/verify-text-only-guards-shrink.ts

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const LIST = join(root, 'scripts/mutation-proof-grandfathered.txt');

// The ceiling is the MEASURED size on the day this ratchet landed (2026-09-18), and it may only
// fall. It is set ON the number, not above it: a ceiling with slack is a ratchet that lets the set
// grow silently up to the slack before anyone hears about it. The first draft of this file guessed
// 169 against a real 107, which is 62 free additions.
//
// This is NOT the 180 that ops_incident #136 measured on 2026-09-14, and does not claim to be.
// That count was taken over 496 barriers with a looser notion of "reads source text"; this one is
// defined by the two exported predicates below, over 531 barriers, and counts only barriers that
// read a PRODUCT path and execute nothing. Quote the printed line, never a number from prose —
// including this paragraph.
const TEXT_ONLY_UNPROVEN_CEILING = 107;

// A path literal that points at PRODUCT code — the thing a barrier is supposed to be a statement
// about. `scripts/` is deliberately absent: a barrier reading another barrier is apparatus reading
// apparatus, which is this routine's own lane and not the class being counted.
const PRODUCT_PATH = /['"`](?:\.\.\/)*(?:src|scrapers|supabase|sql|e2e)\//;

/**
 * Does this barrier EXECUTE product code? Any of three real mechanisms this repo actually uses:
 * lifting a symbol, importing a product module statically, or importing one dynamically.
 * Pure over the source text so both directions can be proven below.
 */
export function executesProductCode(src: string): boolean {
  if (/\bliftSymbols\s*\(/.test(src)) return true;
  if (/\bimport\s+[^;]*\bfrom\s+['"`](?:\.\.\/)*(?:src|scrapers|supabase|e2e)\//.test(src)) return true;
  if (/\bimport\s*\(\s*[A-Za-z_$][\w$]*\s*\)/.test(src)) return true;      // import(SEARCH) — a path const
  if (/\bimport\s*\(\s*['"`](?:\.\.\/)*(?:src|scrapers|supabase|e2e)\//.test(src)) return true;
  return false;
}

/** Does this barrier read a PRODUCT file as text? A path literal plus a read call. */
export function readsProductText(src: string): boolean {
  return PRODUCT_PATH.test(src) && /\b(?:readFileSync|readdirSync)\s*\(/.test(src);
}

/**
 * The counted class: reads product text, executes nothing, and has never been watched to fail.
 * A barrier that reads NO product file at all is not in this class — it is not a text tripwire,
 * it is something else (a pure-logic or registry check), and miscounting it would inflate the
 * ratchet with names that have no conversion available.
 */
export function isTextOnlyAndUnproven(src: string, name: string, grandfathered: ReadonlySet<string>): boolean {
  if (!grandfathered.has(name)) return false;
  if (!readsProductText(src)) return false;
  return !executesProductCode(src);
}

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nText-only guards that have never been watched to fail — the set where green means least\n');

check('the grandfather list is committed', existsSync(LIST),
  'scripts/mutation-proof-grandfathered.txt is missing — the intersection cannot be computed, and an ' +
  'uncomputable ratchet must fail rather than report zero (a failed read is not an empty answer)');

const grandfathered = new Set(
  existsSync(LIST)
    ? readFileSync(LIST, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : [],
);

const barriers = readdirSync(join(root, 'scripts'))
  .filter((f) => /^verify-.*\.(ts|mjs)$/.test(f))
  .sort();

// An empty scan is a broken scan, never a clean bill of health — the failure direction this repo
// has been burned by before (nine dark detectors reading as healthy, AGENTS.md "Read this first").
check('the barrier scan found files at all', barriers.length > 0,
  'no verify-* files were discovered — this ratchet would otherwise report a perfect zero');

const members: string[] = [];
for (const f of barriers) {
  // COMMENTS ARE STRIPPED, STRING BODIES ARE NOT — and the difference is not cosmetic.
  // This file's first draft used stripCommentsAndStrings (the sibling ratchet's reader), which
  // blanks `'src/data/search.ts'` to `''`. Every path literal this classifier looks for lives
  // INSIDE a string, so the whole population silently measured ZERO and the ratchet would have
  // shipped as a guard over an empty set — PART 1.5, a check whose own read failed reporting "no
  // violations found", committed by the barrier written to count that class. It was caught by the
  // non-vacuity mutation below ("the real population is non-empty"), which is exactly the control
  // BARRIER_ENGINEER.md PART 3 R1 step 4 requires and the reason it is not optional.
  // Comments still go, because this file's own header names the anti-patterns it hunts.
  const src = stripComments(readFileSync(join(root, 'scripts', f), 'utf8'));
  if (isTextOnlyAndUnproven(src, f, grandfathered)) members.push(f);
}

// Pure, so the proof below can feed it a synthetic over-ceiling count — and so that the ratchet
// cannot repeat the bug its sibling had, where asserting `n + 1 > CEILING` made the check FAIL the
// moment the list SHRANK, which is the direction it exists to encourage.
const exceedsCeiling = (n: number) => n > TEXT_ONLY_UNPROVEN_CEILING;

check(`text-only unproven guards have not grown (${members.length} <= ${TEXT_ONLY_UNPROVEN_CEILING})`,
  !exceedsCeiling(members.length),
  `${members.length} barriers read a product file as text, execute nothing, and have never been watched ` +
  `to fail. A new one was added instead of being converted or proven.\n      ` +
  `Fix it by EXECUTING the symbol (scripts/lib/liftSymbols.ts) or by adding a mustCatch(...) proof — ` +
  `NOT by raising TEXT_ONLY_UNPROVEN_CEILING, which is Prohibition 1 wearing a ratchet's syntax.`);

console.log(`\n  barriers: ${barriers.length} · grandfathered: ${grandfathered.size} · ` +
  `text-only AND never watched to fail: ${members.length} (ceiling ${TEXT_ONLY_UNPROVEN_CEILING})`);

// ── mutation proofs ─────────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

const G = new Set(['verify-thing.ts']);
const TEXT_ONLY = `const F = join(root, 'src/data/search.ts'); const s = readFileSync(F, 'utf8'); if (!/needle/.test(s)) fail();`;

mustCatch('the ratchet growing past its ceiling',
  exceedsCeiling(TEXT_ONLY_UNPROVEN_CEILING + 1));
mustCatch('…while the ratchet SHRINKING is NOT flagged (the direction it exists to encourage — the ' +
  'exact bug its sibling ratchet shipped once)',
  !exceedsCeiling(TEXT_ONLY_UNPROVEN_CEILING - 1));
mustCatch('a grandfathered barrier that only greps a product file',
  isTextOnlyAndUnproven(TEXT_ONLY, 'verify-thing.ts', G));
mustCatch('…while the SAME barrier is no longer counted once it lifts and RUNS the real symbol ' +
  '(conversion is a genuine way out)',
  !isTextOnlyAndUnproven(`${TEXT_ONLY} const f = await liftSymbols(F, [], [], '');`, 'verify-thing.ts', G));
mustCatch('…and no longer counted once it carries a mutation proof (leaving the grandfather list ' +
  'is the other genuine way out)',
  !isTextOnlyAndUnproven(TEXT_ONLY, 'verify-thing.ts', new Set<string>()));
mustCatch('a barrier importing a product module STATICALLY is not miscounted as text-only',
  !isTextOnlyAndUnproven(`import { pick } from '../src/lib/afPlan.ts';\n${TEXT_ONLY}`, 'verify-thing.ts', G));
mustCatch('a barrier importing a product module DYNAMICALLY through a path const is not miscounted ' +
  '(the shape verify-match-first-stages-are-order-only.ts uses)',
  !isTextOnlyAndUnproven(`${TEXT_ONLY} const m = await import(DIVERSITY);`, 'verify-thing.ts', G));
mustCatch('a barrier that reads NO product file is not swept in (it is not a text tripwire, and ' +
  'counting it would inflate the ratchet with names that have no conversion available)',
  !isTextOnlyAndUnproven(`const n = 1 + 1; if (n !== 2) fail();`, 'verify-thing.ts', G));
mustCatch('a barrier reading a product file with NO read call is not counted on the path literal alone',
  !readsProductText(`const F = join(root, 'src/data/search.ts');`));
mustCatch('…and the real population is non-empty, so the ceiling is a measurement rather than a ' +
  'number nothing reaches',
  members.length > 0);
mustCatch('an uncomputable grandfather list fails rather than reporting a perfect zero',
  !existsSync(join(root, 'scripts/a-file-that-does-not-exist.txt')));

check('npm test runs this ratchet', npmTestRuns(root, 'verify-text-only-guards-shrink'),
  '`npm test` no longer runs verify-text-only-guards-shrink.ts — the ratchet is inert');

if (failures || mutFail) {
  console.error(`\n❌ ${failures} check(s) and ${mutFail} mutation(s) failed.`);
  process.exit(1);
}
console.log(`\n✅ verify-text-only-guards-shrink: passed (${members.length} in the set, ceiling ${TEXT_ONLY_UNPROVEN_CEILING}).`);
