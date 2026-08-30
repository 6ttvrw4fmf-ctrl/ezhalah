// SALIENCE DECIDES ASK **ORDER**, NEVER INCLUSION — Product Contract R5.6.1.
//
// THE RULE. `scoreQuestion()` in src/lib/afRanking.ts returns `bestSplit * SALIENCE[id]`. That
// product is a RANKING signal: it decides which of several still-useful questions AF asks FIRST.
// It must never decide WHETHER a question is asked at all, and it must never decide which of a
// question's options survive. The source comment on SALIENCE says exactly that ("this is an
// ORDERING signal only (asks the most informative question first), never an inclusion gate"), and
// §(d) of the narrowing-gate comment repeats it — but until this file, NOTHING asserted it.
//
// WHY IT MATTERS ENOUGH TO BARRIER. A weight that leaked into an inclusion gate would be close to
// invisible in production. AF would simply stop offering some questions — and the symptom a user
// sees ("we still have 3,000 listings, but Ezhalah ran out of things to ask") is byte-identical to
// the legitimate, contract-mandated stop under P1 ("if no genuinely useful question remains, AF
// STOPS"). Every count on the card would still be truthful; every parity barrier would stay green;
// the only thing wrong would be the questions that were never asked. That is precisely the class
// this repo has been burned by before — a silent narrowing of what the product offers, wearing the
// costume of correct behaviour.
//
// It is also a live temptation, not a hypothetical: `rankQuestions` sorts on `score`, and the
// obvious "small tidy-up" is to drop questions below some score floor. A score floor IS a salience
// floor, because score and salience are proportional — which §3 below measures directly.
//
// WHAT THIS ASSERTS, per question id in SALIENCE (plus an unregistered id, which falls to the 0.5
// default) and per fixture:
//   §1  the ASKED/NOT-ASKED verdict (null vs non-null) is invariant across the whole salience range,
//       0 included. Salience 0 is the sharpest case: score becomes 0, and a naive `if (!score)`
//       anywhere would silently delete the question.
//   §2  the SURVIVING OPTION SET is invariant across that same range — byte-identical keys, counts
//       and order. Option filtering is `optionNarrowsMeaningfully` alone; salience has no say.
//   §3  score is exactly PROPORTIONAL to salience (score === bestSplit × salience), so score and
//       salience cannot be decoupled — this is what makes a future "score floor" provably a
//       salience floor, and keeps §1/§2 from being satisfiable by a stubbed-out score.
//   §4  salience really does MOVE THE ORDER (the test can bite): two questions on the same fixture
//       rank strictly by salience, and swapping their weights swaps the winner.
//   §5  the fixtures span both sides of the ask/skip boundary — at least one asked and at least one
//       refused — so §1 is proving invariance over a genuine mix, not over an all-null sweep.
//
//   node --experimental-strip-types scripts/verify-af-salience-orders-only.ts   (in `npm test`)

import {
  scoreQuestion, SALIENCE, MIN_TOTAL_TO_SHOW, INTERVIEW_STOP_AT,
  type AdvancedOption, type AdvancedQuestionResult,
} from '../src/lib/afRanking.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

const opt = (key: string, count: number): AdvancedOption => ({ key, label: key, count });

// The salience values swept for every question. 0 and the huge value are the load-bearing ends: a
// weight is only provably an ORDERING signal if the extremes of its range change nothing but order.
const SWEEP = [0, 0.01, 0.1, 0.5, 0.7, 1, 2, 1000];

// Fixtures chosen to sit on BOTH sides of every gate scoreQuestion applies, so §1's invariance is
// measured over a real mix (see §5). Counts are the shapes the contract's own worked examples use.
const FIXTURES: { name: string; selection: 'single' | 'multi'; result: AdvancedQuestionResult }[] = [
  { name: 'balanced 2-option (asked)', selection: 'single',
    result: { options: [opt('a', 520), opt('b', 480)], unknownCount: 7, total: 1000 } },
  { name: 'bathrooms ladder 100/98/60/20 (asked, 2 survive)', selection: 'single',
    result: { options: [opt('1+', 100), opt('2+', 98), opt('3+', 60), opt('4+', 20)], unknownCount: 0, total: 100 } },
  { name: 'lone good survivor 940/60 (asked as yes/no)', selection: 'single',
    result: { options: [opt('no', 940), opt('yes', 60)], unknownCount: 12, total: 1000 } },
  { name: 'gym 100/100 — no option can move the set (NOT asked)', selection: 'single',
    result: { options: [opt('gym', 100)], unknownCount: 0, total: 100 } },
  { name: 'scope already at the stop line (NOT asked)', selection: 'multi',
    result: { options: [opt('a', 10), opt('b', 8)], unknownCount: 1, total: INTERVIEW_STOP_AT } },
  { name: 'multi-amenity, three real slices (asked)', selection: 'multi',
    result: { options: [opt('pool', 300), opt('gym', 250), opt('garden', 120)], unknownCount: 40, total: 1200 } },
];

// Every registered question id, plus one that is NOT in the table (so it takes the `?? 0.5` default
// path — which must obey the same rule, or an unregistered question would be gated by a fallback).
const IDS = [...Object.keys(SALIENCE), 'a_question_with_no_registered_salience'];

const shape = (r: ReturnType<typeof scoreQuestion>) =>
  r === null ? 'NULL' : JSON.stringify(r.options);

// ── §1 + §2 — verdict and surviving options are invariant across the whole salience range ───────
{
  const original = { ...SALIENCE };
  let verdictBreaks = 0, optionBreaks = 0, firstBreak = '';
  const asked: string[] = [], refused: string[] = [];

  for (const id of IDS) {
    for (const f of FIXTURES) {
      const baseline = scoreQuestion(id, f.selection, f.result);
      const baseVerdict = baseline === null;
      const baseOptions = shape(baseline);
      (baseVerdict ? refused : asked).push(`${id}/${f.name}`);

      for (const s of SWEEP) {
        SALIENCE[id] = s;
        const got = scoreQuestion(id, f.selection, f.result);
        if ((got === null) !== baseVerdict) {
          verdictBreaks++;
          firstBreak ||= `${id} @ salience ${s} on «${f.name}»: ${baseVerdict ? 'refused' : 'asked'} → ${got === null ? 'refused' : 'asked'}`;
        } else if (shape(got) !== baseOptions) {
          optionBreaks++;
          firstBreak ||= `${id} @ salience ${s} on «${f.name}»: options ${baseOptions} → ${shape(got)}`;
        }
      }
      // restore between fixtures so one id's sweep can never leak into the next measurement
      if (id in original) SALIENCE[id] = original[id]; else delete SALIENCE[id];
    }
  }

  check('§1 the ASKED/NOT-ASKED verdict never moves with salience (0 and 1000 included)',
    verdictBreaks === 0, `${verdictBreaks} break(s); first: ${firstBreak}`);
  check('§2 the SURVIVING OPTION SET never moves with salience',
    optionBreaks === 0, `${optionBreaks} break(s); first: ${firstBreak}`);
  check('§5 the sweep contains BOTH asked and refused shapes (this check can bite)',
    asked.length > 0 && refused.length > 0,
    `asked=${asked.length} refused=${refused.length} — an all-one-sided sweep proves nothing`);

  // paranoia: the sweep must have left the real table exactly as it found it
  check('the salience table is restored after the sweep (no test pollution)',
    JSON.stringify(SALIENCE) === JSON.stringify(original),
    `${JSON.stringify(SALIENCE)} !== ${JSON.stringify(original)}`);
}

// ── §3 — score is exactly proportional to salience, so a score floor IS a salience floor ────────
{
  const original = { ...SALIENCE };
  const id = 'furnished';
  const f = FIXTURES[0];
  let breaks = 0, first = '';

  SALIENCE[id] = 1;
  const unit = scoreQuestion(id, f.selection, f.result);
  if (unit === null) { check('§3 fixture is asked at salience 1 (precondition)', false, 'fixture returned null'); }

  for (const s of SWEEP) {
    SALIENCE[id] = s;
    const got = scoreQuestion(id, f.selection, f.result);
    if (got === null) { breaks++; first ||= `null at salience ${s}`; continue; }
    const expected = (unit?.score ?? 0) * s;
    if (Math.abs(got.score - expected) > 1e-12) {
      breaks++;
      first ||= `salience ${s}: score ${got.score} !== bestSplit×salience ${expected}`;
    }
  }
  SALIENCE[id] = original[id];

  check('§3 score === bestSplit × salience for every weight (score cannot be decoupled)',
    breaks === 0, `${breaks} break(s); first: ${first}`);
  check('§3 salience 0 yields score 0 and STILL asks (the sharpest inclusion trap)',
    (() => { SALIENCE[id] = 0; const r = scoreQuestion(id, f.selection, f.result); SALIENCE[id] = original[id];
             return r !== null && r.score === 0; })(),
    'a falsy score must not be read as "no question"');
}

// ── §4 — salience DOES decide order (proves the weight is live, not vestigial) ──────────────────
{
  const original = { ...SALIENCE };
  const f = FIXTURES[0];
  const rank = (a: string, b: string) => {
    const sa = scoreQuestion(a, f.selection, f.result);
    const sb = scoreQuestion(b, f.selection, f.result);
    if (!sa || !sb) return 'ERROR';
    return sa.score === sb.score ? 'TIE' : (sa.score > sb.score ? a : b);
  };

  SALIENCE.furnished = 1.0; SALIENCE.direction = 0.7;
  const highWins = rank('furnished', 'direction');
  SALIENCE.furnished = 0.7; SALIENCE.direction = 1.0;
  const swapped = rank('furnished', 'direction');
  Object.assign(SALIENCE, original);

  check('§4 on an identical fixture the higher salience ranks first',
    highWins === 'furnished', `expected furnished, got ${highWins}`);
  check('§4 swapping the weights swaps the winner (order really is salience-driven)',
    swapped === 'direction', `expected direction, got ${swapped}`);
}

// ── the scope-size floor is the ONLY total-based gate, and it is salience-blind ─────────────────
{
  const original = { ...SALIENCE };
  const below: AdvancedQuestionResult = { options: [opt('a', 8), opt('b', 6)], unknownCount: 0, total: MIN_TOTAL_TO_SHOW - 1 };
  let breaks = 0;
  for (const s of SWEEP) { SALIENCE.furnished = s; if (scoreQuestion('furnished', 'single', below) !== null) breaks++; }
  SALIENCE.furnished = original.furnished;
  check('a scope under MIN_TOTAL_TO_SHOW is refused at EVERY salience (floor is not weight-tunable)',
    breaks === 0, `${breaks} salience value(s) let an under-floor scope through`);
}

console.log(failed === 0
  ? '\n✓ salience orders questions and nothing else — inclusion and option survival are salience-blind'
  : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
