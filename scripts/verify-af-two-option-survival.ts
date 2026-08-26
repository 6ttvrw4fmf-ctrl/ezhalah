// AF TWO-OPTION QUESTION SURVIVAL — the one way the 2026-08-25 ask gate can cost a GOOD question.
//
// WHY THIS FILE EXISTS (owner follow-up, 2026-08-25). The narrowing gate
// (`optionNarrowsMeaningfully`, src/lib/afRanking.ts) is deliberately ONE-SIDED at the OPTION level:
// it rejects only near-no-op options, never small slices. But a question can still die at the
// QUESTION level, and that is a NEW way to lose a valuable question that no existing barrier pins:
//
//     a SINGLE-SELECT question with EXACTLY TWO options, in a heavily-skewed cohort
//       → the lopsided option is filtered out by optionNarrowsMeaningfully
//       → ONE survivor remains
//       → that fails MIN_OPTIONS_SINGLE = 2
//       → the WHOLE question disappears, survivor and all.
//
// The real shape is `furnished` (تفضلها مفروشة؟ — «مفروشة» / «غير مفروشة», the only two-option
// single-select in ADVANCED_QUESTIONS) in a heavily-unfurnished cohort. A sweep of 62 real cohorts on
// 2026-08-25 found ZERO live occurrences: this is PREVENTION, not a live bug report.
//
// ── WHICH READING OF THE CONTRACT THIS BARRIER PINS, AND WHY ────────────────────────────────────
// Two readings are defensible and a future reader must not have to guess which one shipped:
//   (a) the question SHOULD die — a single-select with one choice is not a question, it is a forced
//       answer, and MIN_OPTIONS_SINGLE = 2 exists to say exactly that;
//   (b) the question SHOULD survive — the survivor is real narrowing value (94% of the set) being
//       denied to the user, and «pick it or skip» is a legitimate yes/no.
//
// THIS BARRIER PINS (a) — the CURRENT, SHIPPED behaviour — for three reasons: it is what
// src/lib/afRanking.ts §(e) already states in writing as the owner's specified design ("filter the
// options, then let minOptionsFor decide"); MIN_OPTIONS_SINGLE = 2 is an owner-frozen constant; and
// the owner's 2026-08-25 follow-up asked for a BARRIER, not a behaviour change. Reading (b) is
// recorded here as an OWNER DECISION, not implemented. Nobody may flip to (b) by editing a constant
// and watching the suite stay green — §1 below turns red the moment the question starts surviving.
//
// FAILS LOUDLY IN **BOTH** DIRECTIONS, which is the whole point:
//   • question starts SURVIVING (someone quietly adopts reading (b), e.g. MIN_OPTIONS_SINGLE → 1)
//     ⇒ §1 red. That is a product decision and needs the owner, not a green suite.
//   • question keeps dying but for the WRONG REASON — the small slice ALSO gets filtered, i.e. the
//     two-sided 2026-08-11 band creeps back ⇒ §2 red. Same null, opposite meaning; a barrier that
//     only asserted `=== null` would pass through that regression without a sound.
//
//   node --experimental-strip-types scripts/verify-af-two-option-survival.ts   (wired into `npm test`)

import {
  scoreQuestion, optionNarrowsMeaningfully, minOptionsFor,
  MIN_OPTIONS_SINGLE, MIN_OPTIONS_MULTI, MIN_REAL_OPTION_COUNT, INTERVIEW_STOP_AT,
  type AdvancedOption,
} from '../src/lib/afRanking.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

const opt = (key: string, count: number): AdvancedOption => ({ key, label: key, count });

// THE EXACT FAILURE SHAPE, as `furnished` would really arrive from guidedOptions(): a heavily-skewed
// cohort of N = 1,000 known matches — 940 confirmed unfurnished, 60 confirmed furnished, 12 unknown
// (unknown ≠ no, never counted).
//
// THE SCALE IS DELIBERATE AND LOAD-BEARING. An earlier draft of this file used 92/6 of 100 and was
// WORTHLESS for §2: a survivor of 6 is ≤ INTERVIEW_STOP_AT, so `optionNarrowsMeaningfully`'s escape
// clause carried it and the 10% FRACTION was never exercised — a mutation that re-added a small-slice
// floor (the 2026-08-11 two-sided band) left every assertion green. At this scale the survivor (60)
// is well ABOVE INTERVIEW_STOP_AT, so it lives or dies on the fraction alone, which is the arithmetic
// this barrier has to be able to see break. §0 below pins that property so the fixture cannot be
// shrunk back into uselessness.
//
// Both options already clear the ABSOLUTE per-option floor (MIN_REAL_OPTION_COUNT = 5) that
// meaningful() applies upstream, so nothing but the narrowing gate is in play here.
const N = 1000;
const LOPSIDED = 940;  // 6% cut  — fails the 10% fraction, is NOT ≤25 ⇒ filtered out
const SLICE = 60;      // 94% cut — the genuinely good narrowing choice that survives the gate
const twoOption = { options: [opt('no', LOPSIDED), opt('yes', SLICE)], unknownCount: 12, total: N };

console.log(`\nAF two-option survival — single-select ${LOPSIDED}/${SLICE} of ${N} (the furnished shape)\n`);

// ── 0. THE FIXTURE ITSELF IS PINNED ─────────────────────────────────────────────────────────────
check(`fixture is honest: both options clear MIN_REAL_OPTION_COUNT (${MIN_REAL_OPTION_COUNT}), so only the narrowing gate is in play`,
  LOPSIDED >= MIN_REAL_OPTION_COUNT && SLICE >= MIN_REAL_OPTION_COUNT);
check(`fixture is DECISIVE: the survivor (${SLICE}) is above INTERVIEW_STOP_AT (${INTERVIEW_STOP_AT}), so §2 tests the 10% FRACTION, not the escape clause`,
  SLICE > INTERVIEW_STOP_AT,
  'shrink this fixture below the stop line and a returning small-slice floor would pass unnoticed');

// ── 1. THE PINNED CONTRACT — reading (a): the question DIES ──────────────────────────────────────
// Executed, not reasoned about. If this ever passes non-null, someone adopted reading (b).
check('a two-option SINGLE-SELECT whose lopsided option is filtered out DIES ENTIRELY (reading (a), current shipped behaviour)',
  scoreQuestion('furnished', 'single', twoOption) === null,
  `expected null; a non-null result means reading (b) was adopted (MIN_OPTIONS_SINGLE is ${MIN_OPTIONS_SINGLE}) — that is an OWNER DECISION, not a refactor`);

// ── 2. IT DIES FOR THE RIGHT REASON — arity, NOT because the small slice was rejected ────────────
// This is the half that makes §1 meaningful. `=== null` alone is satisfied by the 2026-08-11
// two-sided band coming back (which would ALSO drop the 60-count slice and leave ZERO survivors).
// Assert the survivor set explicitly: exactly ONE survivor, and it is the SMALL SLICE.
{
  const survivors = twoOption.options.filter((o) => optionNarrowsMeaningfully(o.count, N));
  check(`the lopsided option (${LOPSIDED}/${N}, a 6% cut) is the one the gate rejects`,
    optionNarrowsMeaningfully(LOPSIDED, N) === false);
  check(`the small slice (${SLICE}/${N}, a 94% cut) SURVIVES the gate — one-sidedness is permanent`,
    optionNarrowsMeaningfully(SLICE, N) === true,
    'if this is false the two-sided 2026-08-11 band is back and §1 is passing for the wrong reason');
  check(`exactly ONE option survives, and it is the ${SLICE} — so the question dies on arity (${survivors.length} < MIN_OPTIONS_SINGLE ${MIN_OPTIONS_SINGLE}), nothing else`,
    survivors.length === 1 && survivors[0].count === SLICE,
    `survivors: [${survivors.map((s) => s.count).join(', ')}]`);
}

// ── 3. THE SAME SHAPE AS MULTI-SELECT SURVIVES — the death is arity-specific ─────────────────────
// MIN_OPTIONS_MULTI = 1: a lone meaningful chip IS a valid yes/no. Same counts, same gate, same
// survivor — only the arity differs. This proves the gate did not blacklist the question or the
// survivor, and it is the direct measure of what reading (a) costs.
{
  const asMulti = scoreQuestion('amenities', 'multi', twoOption);
  check(`the IDENTICAL option set as MULTI-select is asked (MIN_OPTIONS_MULTI = ${MIN_OPTIONS_MULTI}) — so §1's death is arity, not the gate`,
    asMulti !== null && asMulti.options.length === 1 && asMulti.options[0].count === SLICE,
    `got ${asMulti ? `[${asMulti.options.map((o) => o.count).join(', ')}]` : 'null'}`);
}

// ── 4. A THIRD REAL OPTION RESCUES IT — the question itself is never blacklisted ─────────────────
// Same question id, same lopsided chip, plus one more genuinely narrowing rung: two survivors clear
// MIN_OPTIONS_SINGLE and the question is asked, carrying ONLY the survivors.
{
  const rescued = scoreQuestion('furnished', 'single',
    { options: [opt('no', LOPSIDED), opt('yes', SLICE), opt('semi', 400)], unknownCount: 12, total: N });
  check('add ONE more genuinely narrowing option and the same question is asked again — nothing is blacklisted',
    rescued !== null && rescued.options.map((o) => o.count).join(',') === `${SLICE},400`,
    `got ${rescued ? rescued.options.map((o) => o.count).join(',') : 'null'}`);
}

// ── 5. TWO SURVIVORS ⇒ ALWAYS ASKED — no hidden second gate on two-option questions ──────────────
// The boundary case matters most: at N=1,000 a count of 900 removes EXACTLY 10% and qualifies, so
// 900/100 is a two-option single-select that must survive. Both counts are above INTERVIEW_STOP_AT,
// so this is the fraction's own boundary, not the escape clause. If this ever fails, something
// started treating "two options" itself as suspicious.
check('a two-option single-select where BOTH options narrow (900 = exactly the 10% line, and 100) is ASKED',
  scoreQuestion('furnished', 'single',
    { options: [opt('no', 900), opt('yes', 100)], unknownCount: 0, total: N }) !== null);

// ── 6. THE PROPERTY, SWEPT — a two-option single-select survives IFF both options narrow ─────────
// One fixture pins one cohort; this pins the RULE across every scope size and every skew the app can
// reach, so a future edit cannot introduce a size-dependent exception that every fixture above misses.
{
  let mismatches = 0; let first = '';
  let lostGoodQuestions = 0; let firstLost = '';
  for (let n = INTERVIEW_STOP_AT + 1; n <= 600; n += 1) {
    for (let a = MIN_REAL_OPTION_COUNT; a <= n - MIN_REAL_OPTION_COUNT; a += 7) {
      const b = n - a;
      const options = [opt('a', a), opt('b', b)];
      const survivors = options.filter((o) => optionNarrowsMeaningfully(o.count, n)).length;
      const asked = scoreQuestion('furnished', 'single', { options, unknownCount: 0, total: n }) !== null;
      const expected = survivors >= minOptionsFor('single');
      if (asked !== expected) { mismatches++; if (!first) first = `N=${n} ${a}/${b} asked=${asked} survivors=${survivors}`; }
      // MEASURE the cost of reading (a): a two-option question that dies while its lone survivor
      // would have cut ≥50% of the scope. Counted, never asserted away — the number below is the
      // concrete size of the OWNER DECISION.
      if (!asked && survivors === 1) {
        const s = options.find((o) => optionNarrowsMeaningfully(o.count, n))!;
        if (s.count * 2 <= n) { lostGoodQuestions++; if (!firstLost) firstLost = `N=${n}, survivor ${s.count} (${Math.round((1 - s.count / n) * 100)}% cut) lost with its partner ${n - s.count}`; }
      }
    }
  }
  check('two-option single-select is asked IFF both options clear the narrowing gate — no size-dependent exception anywhere',
    mismatches === 0, `${mismatches} mismatch(es), first ${first}`);
  console.log(`\n      OWNER DECISION, measured: ${lostGoodQuestions} swept cohort shape(s) lose a ≥50%-cut question`);
  console.log(`      to reading (a). First: ${firstLost}`);
  console.log('      Not a defect until the owner says so — reading (a) is what ships, and §1 pins it.\n');
}

console.log(failed === 0
  ? '✓ two-option survival holds — reading (a) pinned, and pinned for the RIGHT reason'
  : `✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
