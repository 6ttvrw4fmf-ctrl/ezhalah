// Regression guard for the citySelected rehydration fix (2026-08-04).
//
// The bug (live-proven on production, browser E2E): search → results → reopen the filter →
// press Search with NOTHING touched → «الرجاء اختيار مدينة من القائمة», even though the field
// still shows the previously list-picked city. Root cause: query.location/query.locationMatch
// persist in the app context across the navigation, but citySelected — the ONLY thing that makes
// a search valid (owner spec 2026-07-17) — is local component state and comes back null on
// remount. Every returning user had to clear + re-pick the same city to search again.
//
// The fix pins THREE properties this guard checks:
//   1. The mount/deal-change ensureCityFieldIndex effect rehydrates citySelected from the pool,
//      gated on the persisted text being EXACTLY the label of a persisted kind:'city' exact
//      locationMatch (a pick that came from this list and already drove a search — not free text).
//   2. The candidate must ROUND-TRIP through resolveCitySelection() to the same city AND region as
//      the persisted resolution (disambiguates real same-name twins, e.g. الهفوف), and 0/2+
//      candidates rehydrate nothing (never guess).
//   3. setCitySelected uses a functional (prev ?? …) update so a live user pick is never clobbered.
//
//   node --experimental-strip-types scripts/verify-city-rehydration.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const home = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');

// ── WHY THIS FILE READS CONDITIONS, NOT SUBSTRINGS (repaired 2026-09-04 by routine #10) ──────────
//
// Every check here was `home.includes('<a fragment of a condition>')`. A substring survives its own
// negation: the never-guess rule lives in `if (match.length === 1)`, and widening that line to
// `if (match.length === 1 || match.length > 1)` DELETES the rule — the app would then rehydrate a
// guessed city from an ambiguous pool, which is the defect this guard exists for — while
// `home.includes('match.length === 1')` stays true, because the original text is still in there.
// Watched: that exact mutant was applied to the real src/app/index.tsx and all four greps stayed
// green. `.includes()` cannot distinguish "the rule is intact" from "the rule is intact AND
// something was bolted onto it", and every boolean defect in this class is an OR bolted on.
//
// So the vulnerable ones now read the WHOLE condition and compare it, instead of hunting for a
// fragment inside it. This is still a source check — the rehydration logic lives inside a React
// effect in a 200KB screen component and cannot be lifted — but an exact condition is falsifiable in
// a way a substring is not.

/** The full parenthesised condition of the `if` whose text contains `needle`, or null. */
export function conditionOf(src: string, needle: string): string | null {
  const at = src.indexOf(needle);
  if (at < 0) return null;
  const open = src.lastIndexOf('if (', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open + 3; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 4, i).trim();
  }
  return null;
}

/** True when `expr` is EXACTLY the guard, with nothing disjoined onto it. */
export const isExactly = (expr: string | null, want: string) =>
  expr !== null && expr.replace(/\s+/g, ' ').trim() === want;

// ── 1. rehydration exists, in the right effect, correctly gated ──
check('ensureCityFieldIndex .then receives the pool (rehydration source)',
  home.includes('ensureCityFieldIndex(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams).then((pool)'));
check('surviving-resolution path gated on persisted kind:city exact match',
  home.includes("lm.kind === 'city' && lm.exact === true"));
check('rehydration gated on field text === verified label (edited/cleared text never rehydrates)',
  home.includes('query.location === lm.label'));

// ── 2. round-trip equality + never-guess ──
check('with a surviving resolution, candidate must round-trip resolveCitySelection to the SAME city and region',
  home.includes('r.city === lm!.city && r.region === lm!.region'));
check('without it (URL round-trip drops locationMatch), only an EXACT unique catalog-label match restores',
  home.includes('pool.filter((o) => o.cityAr === query.location)') && home.includes('(!lm && !!query.location)'));
// THE NEVER-GUESS RULE. Read as a whole condition: `|| match.length > 1` bolted on would keep a
// substring check green while inverting the rule.
const guard = conditionOf(home, 'match.length === 1');
check('ambiguous (0 or 2+) candidates rehydrate nothing — and the guard is EXACTLY that, ' +
  `with nothing disjoined onto it (found: ${JSON.stringify(guard)})`,
  isExactly(guard, 'match.length === 1'));

// ── 3. a live pick is never clobbered ──
check('setCitySelected uses functional prev ?? candidate update',
  home.includes('setCitySelected((prev) => prev ?? match[0])'));

// ── invariants that must NOT regress while fixing this ──
// The validation gate, read the same way: `if (!citySelected || __DEV__)` would keep the substring.
const gate = conditionOf(home, '!citySelected) {');
check('onSearch still blocks when citySelected is null, on that condition ALONE ' +
  `(found: ${JSON.stringify(gate)})`,
  isExactly(gate, '!citySelected') && home.includes('setLocMsg(CITY_REQUIRED_MSG)'));
check('onChangeText still clears citySelected on every keystroke (stale pick never reused)',
  /onChangeText=\{\(v\) => \{[\s\S]{0,400}?setCitySelected\(null\)/.test(home));

// ── mutation proofs: the mutants are applied to the REAL src/app/index.tsx, then re-read ─────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

// THE MUTANT THAT PROVED THIS GUARD BLIND. Every `home.includes(...)` in this file survived it.
const guessing = home.replace('match.length === 1', 'match.length === 1 || match.length > 1');
mustCatch('the never-guess rule widened to rehydrate an AMBIGUOUS pool (2+ candidates) — the exact ' +
  'mutant all four original substring checks stayed green on',
  guessing !== home
  && home.includes('match.length === 1') && guessing.includes('match.length === 1') // the substring survives…
  && !isExactly(conditionOf(guessing, 'match.length === 1'), 'match.length === 1')); // …the condition does not

const laxGate = home.replace('if (!citySelected) {', 'if (!citySelected && false) {');
mustCatch('the city-required validation neutralised by an extra conjunct',
  laxGate !== home && !isExactly(conditionOf(laxGate, '!citySelected) {'), '!citySelected'));

mustCatch('the never-guess guard being deleted outright',
  conditionOf(home.replace('if (match.length === 1) {', 'if (true) {'), 'match.length === 1') === null);

mustCatch('the shipped code as it actually stands is NOT flagged (neither check is vacuously red)',
  isExactly(conditionOf(home, 'match.length === 1'), 'match.length === 1')
  && isExactly(conditionOf(home, '!citySelected) {'), '!citySelected'));

mustCatch('a condition the reader cannot locate reads as MISSING, never as healthy',
  conditionOf(home, 'a needle that is not in this file at all') === null
  && !isExactly(null, 'anything'));

if (mutFail) {
  console.error(`\n${mutFail} guard(s) are BLIND to their own defect`);
  process.exit(1);
}
if (failed) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll city-rehydration checks passed.');
