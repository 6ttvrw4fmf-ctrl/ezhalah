// AF TWO-OPTION QUESTION SURVIVAL — a lone surviving meaningful option IS a question.
//
// ── OWNER REVERSAL, 2026-08-26 — THIS FILE WAS INVERTED ON PURPOSE ──────────────────────────────
// Written 2026-08-25, this file pinned reading (a): a single-select left with ONE survivor after
// `optionNarrowsMeaningfully` filtering DIES on `MIN_OPTIONS_SINGLE = 2`. It recorded reading (b)
// — the question should survive — as an unimplemented OWNER DECISION and promised to go red the
// moment anyone flipped the constant. It did exactly that, and the owner then made the decision:
//
//   «Yes, fix the two-option issue. If filtering removes the useless/lopsided option but leaves one
//    genuinely useful option, do not throw away the whole question just because one option remains.
//    Treat that remaining option as a valid yes/no narrowing question when it meaningfully reduces
//    the results under our existing rule. Example: if 1,000 listings become 60 by selecting
//    «مفروشة», that is clearly useful and Advanced Filter should be allowed to ask it.»
//
// So `MIN_OPTIONS_SINGLE` moved 2 → 1 and reading (b) is what ships. This file is NOT deleted and
// NOT unwired — it is inverted in place and keeps every other protection it had, because the
// direction it must now fail in is the mirror image of the one it used to guard:
//   • question starts DYING again (someone "restores" MIN_OPTIONS_SINGLE = 2, or adds a fresh
//     arity gate somewhere else) ⇒ §1 red.
//   • question survives for the WRONG REASON — the lopsided partner ALSO survived, i.e. the gate
//     stopped filtering ⇒ §2 red. Same non-null, opposite meaning.
//   • ZERO survivors starts being asked (the gate erodes into "ask anything") ⇒ §3 red. This is the
//     new load-bearing half: with the arity floor at 1, `optionNarrowsMeaningfully` is now the ONLY
//     thing standing between the user and a pointless question.
//   • the small-slice protection of 2026-08-22 regresses ⇒ §2 and §6 red, unchanged and permanent.
//
// WHY ONE OPTION IS NOT A FORCED ANSWER (verified in source before the reversal shipped): «تخطي»
// is rendered UNCONDITIONALLY by the shared card (AdvancedQuestionCard.tsx, testID `af-skip`, never
// branched on arity or option count) and applies ZERO predicate (agent.tsx `onAgeSkip` →
// `commitGuidedStep([])` — no facet, no false written, unknowns stay eligible). The user genuinely
// chooses between «مفروشة» → 60 and skip → keep 1,000.
//
// PRODUCTION MEASUREMENT that preceded the change: docs/ops/af-single-option-yes-no-2026-08-26.md.
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

// THE EXACT SHAPE, as `furnished` would really arrive from guidedOptions(): a heavily-skewed cohort
// of N = 1,000 known matches — 940 confirmed unfurnished, 60 confirmed furnished, 12 unknown
// (unknown ≠ no, never counted). This is the owner's own worked example, verbatim.
//
// THE SCALE IS DELIBERATE AND LOAD-BEARING — DO NOT SHRINK IT (kept from the 2026-08-25 original,
// whose lesson survives the reversal unchanged). An earlier draft used 92/6 of 100 and was WORTHLESS
// for §2: a survivor of 6 is ≤ INTERVIEW_STOP_AT, so `optionNarrowsMeaningfully`'s escape clause
// carried it and the 10% FRACTION was never exercised — a mutation that re-added a small-slice floor
// (the 2026-08-11 two-sided band) left every assertion green. At this scale the survivor (60) is well
// ABOVE INTERVIEW_STOP_AT, so it lives or dies on the fraction alone, which is the arithmetic this
// barrier has to be able to see break. §0 pins that property so the fixture cannot be shrunk back
// into uselessness.
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
// The arity floor moved on 2026-08-26; MIN_REAL_OPTION_COUNT did NOT, and it is now the ONLY
// absolute floor between a lone survivor and the user. Found unpinned by the mutation run that
// shipped this reversal (a 5 → 1 mutation left every AF barrier green), so it is pinned here.
check(`MIN_REAL_OPTION_COUNT is still ${MIN_REAL_OPTION_COUNT} — the owner-frozen absolute per-option floor`,
  MIN_REAL_OPTION_COUNT === 5,
  'with the arity floor at 1 this is the last line of defence against a 1-listing "choice"');
check(`fixture is DECISIVE: the survivor (${SLICE}) is above INTERVIEW_STOP_AT (${INTERVIEW_STOP_AT}), so §2 tests the 10% FRACTION, not the escape clause`,
  SLICE > INTERVIEW_STOP_AT,
  'shrink this fixture below the stop line and a returning small-slice floor would pass unnoticed');

// ── 1. THE PINNED CONTRACT — reading (b): the question IS ASKED, carrying ONLY the survivor ──────
// Executed, not reasoned about. Asserts the OPTION SET too, not merely non-null: a result that
// carried the lopsided chip back in would be a different (and wrong) behaviour wearing the same
// truthiness.
{
  const asked = scoreQuestion('furnished', 'single', twoOption);
  check('a two-option SINGLE-SELECT whose lopsided option is filtered out IS ASKED, carrying only the survivor (owner 2026-08-26)',
    asked !== null && asked.options.length === 1 && asked.options[0].count === SLICE,
    `expected exactly [${SLICE}]; got ${asked ? `[${asked.options.map((o) => o.count).join(', ')}]` : 'null'} — null means MIN_OPTIONS_SINGLE (${MIN_OPTIONS_SINGLE}) or another arity gate is back above 1, which is an OWNER DECISION, not a refactor`);
}

// ── 2. IT SURVIVES FOR THE RIGHT REASON — the gate still filtered, both ways ─────────────────────
// This is the half that makes §1 meaningful. Non-null alone is satisfied by the gate collapsing
// entirely (which would keep BOTH chips and hand the user a 6%-cut option that moves nothing), and
// it is also satisfiable while the small-slice half regresses. Assert the survivor set explicitly.
{
  const survivors = twoOption.options.filter((o) => optionNarrowsMeaningfully(o.count, N));
  check(`the lopsided option (${LOPSIDED}/${N}, a 6% cut) is STILL the one the gate rejects`,
    optionNarrowsMeaningfully(LOPSIDED, N) === false,
    'if this is true the 2026-08-25 gym rule is gone and §1 is passing for the wrong reason');
  check(`the small slice (${SLICE}/${N}, a 94% cut) SURVIVES the gate — one-sidedness is permanent`,
    optionNarrowsMeaningfully(SLICE, N) === true,
    'if this is false the two-sided 2026-08-11 band is back');
  check(`exactly ONE option survives, and it is the ${SLICE} — so §1 is the arity floor at ${minOptionsFor('single')}, nothing else`,
    survivors.length === 1 && survivors[0].count === SLICE,
    `survivors: [${survivors.map((s) => s.count).join(', ')}]`);
  // THE SMALL-SLICE PROTECTION, at the owner's own 2026-08-22 example scale and named explicitly so
  // it cannot be lost in a fixture edit: 8 of 100 removes 92% and is an EXCELLENT question. The
  // 2026-08-11 two-sided band banned exactly this; that ban stays reversed forever. Note 8 ≤
  // INTERVIEW_STOP_AT, so this one rides the escape clause — which is why it is asserted IN ADDITION
  // TO the 60-of-1,000 fraction case above, never instead of it.
  check('small-slice protection is permanent: 8 of 100 (a 92% cut) qualifies, and alone makes the question ASKABLE',
    optionNarrowsMeaningfully(8, 100) === true
    && scoreQuestion('bathrooms', 'single', { options: [opt('4', 8)], unknownCount: 0, total: 100 }) !== null);
}

// ── 3. ZERO SURVIVORS IS STILL NOT A QUESTION — the new load-bearing half ────────────────────────
// With the arity floor at 1, `optionNarrowsMeaningfully` is the ONLY remaining gate. A single-select
// whose every option is lopsided must still die: that is the owner's gym rule, untouched by the
// reversal. Two shapes, both at a scale where the ≤ INTERVIEW_STOP_AT escape cannot rescue anything.
check('a single-select where the ONLY option is lopsided (940 of 1,000, a 6% cut) is still NOT asked',
  scoreQuestion('furnished', 'single', { options: [opt('no', LOPSIDED)], unknownCount: 12, total: N }) === null,
  'the arity floor moved to 1; the NARROWING gate is what must still refuse this');
check('a single-select where EVERY option is lopsided (940 and 980 of 1,000) is still NOT asked',
  scoreQuestion('bathrooms', 'single', { options: [opt('2', 980), opt('3', LOPSIDED)], unknownCount: 0, total: N }) === null);
check('the owner\'s gym: a no-op option (1,000 of 1,000, a 0% cut) is still NOT asked, at either arity',
  scoreQuestion('furnished', 'single', { options: [opt('yes', N)], unknownCount: 0, total: N }) === null
  && scoreQuestion('amenities', 'multi', { options: [opt('gym', N)], unknownCount: 0, total: N }) === null);

// ── 4. MULTI IS UNCHANGED — the reversal made the arities UNIFORM, it did not move multi ─────────
// Same counts, same gate, same survivor: multi asked this before 2026-08-26 and asks it now. If this
// ever changes, the "fix" went sideways into the arity it was not supposed to touch.
{
  const asMulti = scoreQuestion('amenities', 'multi', twoOption);
  check(`the IDENTICAL option set as MULTI-select is asked, exactly as before (MIN_OPTIONS_MULTI = ${MIN_OPTIONS_MULTI})`,
    asMulti !== null && asMulti.options.length === 1 && asMulti.options[0].count === SLICE,
    `got ${asMulti ? `[${asMulti.options.map((o) => o.count).join(', ')}]` : 'null'}`);
  check('single and multi now agree on this shape — minOptionsFor() is uniform (the point of the reversal)',
    minOptionsFor('single') === minOptionsFor('multi'),
    `single=${minOptionsFor('single')} multi=${minOptionsFor('multi')}`);
}

// ── 5. MORE OPTIONS STILL WORK — the question is never blacklisted, and no cap appeared ──────────
// Same question id, same lopsided chip, plus one more genuinely narrowing rung: BOTH survivors are
// carried, and the lopsided one is still dropped. Also pins the fraction's own boundary: at N=1,000
// a count of 900 removes EXACTLY 10% and qualifies, so 900/100 keeps both.
{
  const rescued = scoreQuestion('furnished', 'single',
    { options: [opt('no', LOPSIDED), opt('yes', SLICE), opt('semi', 400)], unknownCount: 12, total: N });
  check('a third genuinely narrowing option is carried alongside the survivor — nothing is blacklisted, nothing is capped',
    rescued !== null && rescued.options.map((o) => o.count).join(',') === `${SLICE},400`,
    `got ${rescued ? rescued.options.map((o) => o.count).join(',') : 'null'}`);
}
check('a two-option single-select where BOTH options narrow (900 = exactly the 10% line, and 100) is ASKED with BOTH',
  (() => {
    const r = scoreQuestion('furnished', 'single', { options: [opt('no', 900), opt('yes', 100)], unknownCount: 0, total: N });
    return r !== null && r.options.map((o) => o.count).join(',') === '900,100';
  })());

// ── 6. THE PROPERTY, SWEPT — a single-select is asked IFF at least ONE option narrows ────────────
// One fixture pins one cohort; this pins the RULE across every scope size and every skew the app can
// reach, so a future edit cannot introduce a size-dependent exception that every fixture above
// misses. Also counts what the reversal actually BUYS, from the same sweep, so the number stays
// recoverable from the barrier itself.
{
  let mismatches = 0; let first = '';
  let gained = 0; let firstGained = ''; let smallest = Infinity; let smallestDesc = '';
  for (let n = INTERVIEW_STOP_AT + 1; n <= 600; n += 1) {
    for (let a = MIN_REAL_OPTION_COUNT; a <= n - MIN_REAL_OPTION_COUNT; a += 7) {
      const b = n - a;
      const options = [opt('a', a), opt('b', b)];
      const survivors = options.filter((o) => optionNarrowsMeaningfully(o.count, n));
      const asked = scoreQuestion('furnished', 'single', { options, unknownCount: 0, total: n }) !== null;
      const expected = survivors.length >= minOptionsFor('single');
      if (asked !== expected) { mismatches++; if (!first) first = `N=${n} ${a}/${b} asked=${asked} survivors=${survivors.length}`; }
      // The gain: shapes that USED to die on the old arity floor of 2 and are asked now. Counted
      // against the literal 2, not against minOptionsFor(), so this stays a measurement of the
      // reversal rather than a tautology that would read 0 whatever the constant says.
      if (survivors.length === 1) {
        gained++;
        const s = survivors[0];
        if (!firstGained) firstGained = `N=${n}, survivor ${s.count} (${Math.round((1 - s.count / n) * 100)}% cut), partner ${n - s.count} filtered out`;
        if (n < smallest) { smallest = n; smallestDesc = `N=${n}, survivor ${s.count}`; }
      }
    }
  }
  check('a single-select is asked IFF at least ONE option clears the narrowing gate — no size-dependent exception anywhere',
    mismatches === 0, `${mismatches} mismatch(es), first ${first}`);
  check('the swept space actually CONTAINS the newly-askable class (this check can bite)',
    gained > 0, 'no one-survivor shape in the sweep means §6 proves nothing about the reversal');
  console.log(`\n      OWNER REVERSAL, measured on the same sweep: ${gained} two-option shape(s) that died on the`);
  console.log(`      old arity floor of 2 are asked now. First: ${firstGained}`);
  console.log(`      Smallest: ${smallestDesc}. Every one of them had a survivor that cleared optionNarrowsMeaningfully.\n`);
}

console.log(failed === 0
  ? '✓ two-option survival holds — reading (b) pinned, and pinned for the RIGHT reason'
  : `✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
