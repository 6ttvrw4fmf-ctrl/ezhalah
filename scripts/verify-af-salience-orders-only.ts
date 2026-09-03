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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  scoreQuestion, SALIENCE, MIN_TOTAL_TO_SHOW, INTERVIEW_STOP_AT,
  ASK_FIRST_TIER, askTier, AF_ROUND_MAX_QUESTIONS,
  type AdvancedOption, type AdvancedQuestionResult,
} from '../src/lib/afRanking.ts';

const root = join(import.meta.dirname, '..');

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

// ── §6 — ASK_FIRST_TIER REORDERS ONLY, EXACTLY LIKE SALIENCE — Product Contract R5.6.2 ──────────
//
// R5.6.2: "`ASK_FIRST_TIER['rnpl'] = 1` is a preferred opener for Annual Rent scopes, but ONLY
// reorders — a scope with no confirmed installment coverage fails `scoreQuestion` and rnpl is
// skipped like any other useless question." Until now that rule was graded P against
// verify-af-narrowing-gate, "covered indirectly by the usefulness gate" — indirectly, because
// nothing asserted the tier itself.
//
// The tier is a SHARPER hazard than salience, and the reason is structural. Salience multiplies
// INTO the score, so a salience bug at least still competes on score. The tier is applied as a
// LEXICOGRAPHIC key ahead of score (`askTier(b) - askTier(a) || b.score - a.score` in
// rankQuestions), so a tier that leaked one step earlier — into membership rather than order —
// would hoist rnpl to the front of every Annual Rent interview REGARDLESS of whether installments
// can narrow anything. The user would be asked about التقسيط first, always, on scopes where the
// answer moves nothing; and because the question is real and its counts truthful, no parity
// barrier anywhere would notice.
//
// The invariant is the same one §1-§3 establish for salience, stated for the tier: membership is
// decided by scoreQuestion ALONE, before any tier is consulted.
{
  const originalTiers = { ...ASK_FIRST_TIER };
  const TIER_SWEEP = [0, 1, 2, 99];

  // §6.1 — the tier is not an input to scoreQuestion at all: the ASKED/NOT-ASKED verdict and the
  // surviving options are byte-identical at every tier value, on every fixture.
  let verdictBreaks = 0, optionBreaks = 0, firstBreak = '';
  for (const id of IDS) {
    for (const f of FIXTURES) {
      const baseline = scoreQuestion(id, f.selection, f.result);
      const baseVerdict = baseline === null;
      const baseOptions = shape(baseline);
      for (const t of TIER_SWEEP) {
        ASK_FIRST_TIER[id] = t;
        const got = scoreQuestion(id, f.selection, f.result);
        if ((got === null) !== baseVerdict) {
          verdictBreaks++;
          firstBreak ||= `${id} @ tier ${t} on «${f.name}»: ${baseVerdict ? 'refused' : 'asked'} → ${got === null ? 'refused' : 'asked'}`;
        } else if (shape(got) !== baseOptions) {
          optionBreaks++;
          firstBreak ||= `${id} @ tier ${t} on «${f.name}»: options ${baseOptions} → ${shape(got)}`;
        }
      }
      if (id in originalTiers) ASK_FIRST_TIER[id] = originalTiers[id]; else delete ASK_FIRST_TIER[id];
    }
  }
  check('§6.1 the ASKED/NOT-ASKED verdict never moves with ask-tier (0 and 99 included)',
    verdictBreaks === 0, firstBreak);
  check('§6.1 the surviving option set never moves with ask-tier',
    optionBreaks === 0, firstBreak);

  // §6.2 — THE RULE'S OWN SENTENCE. A scope where installments cannot narrow anything must skip
  // rnpl "like any other useless question", however high its tier. The fixture is the contract's
  // own shape: every listing carries it, so no option removes ≥10% and none lands ≤25.
  const noInstallmentCoverage: AdvancedQuestionResult =
    { options: [opt('rnpl', 4000)], unknownCount: 0, total: 4000 };
  let promoted = 0;
  for (const t of TIER_SWEEP) {
    ASK_FIRST_TIER.rnpl = t;
    if (scoreQuestion('rnpl', 'single', noInstallmentCoverage) !== null) promoted++;
  }
  Object.assign(ASK_FIRST_TIER, originalTiers);
  check('§6.2 rnpl on a scope with no installment coverage is REFUSED at every tier (R5.6.2)',
    promoted === 0, `${promoted} tier value(s) admitted a question that narrows nothing`);

  // §6.3 — and the tier really does BITE on order, so §6.1/§6.2 are not passing because the tier
  // is inert. This replays rankQuestions' own comparator over two questions whose scores are
  // deliberately the WRONG way round for the tier's winner: the lower-scoring one must still open.
  const cmp = (a: { id: string; score: number }, b: { id: string; score: number }) =>
    askTier(b.id) - askTier(a.id) || b.score - a.score;
  const pair = [{ id: 'direction', score: 0.9 }, { id: 'rnpl', score: 0.1 }];
  ASK_FIRST_TIER.rnpl = 1;
  const tierWinner = [...pair].sort(cmp)[0].id;
  delete ASK_FIRST_TIER.rnpl;
  const scoreWinner = [...pair].sort(cmp)[0].id;
  Object.assign(ASK_FIRST_TIER, originalTiers);
  check('§6.3 with the tier, the lower-scoring preferred opener still goes first',
    tierWinner === 'rnpl', `expected rnpl, got ${tierWinner}`);
  check('§6.3 without the tier, score alone decides (the tier is what moved it)',
    scoreWinner === 'direction', `expected direction, got ${scoreWinner}`);
}

// ── §7 — A ROUND IS NEVER TRUNCATED TO HIT THE CAP — Product Contract R6.1.4 ────────────────────
//
// R6.1.4: "A round is NEVER truncated to hit the cap. Which questions get asked is decided only by
// `scoreQuestion()` (usefulness first), then the top-`AF_ROUND_MAX_QUESTIONS` by score." Contract
// §15.2 listed this as a structural negative with "no direct test", and the coverage map graded it
// P against verify-af-round-size.ts — which reasons over the SOURCE TEXT of rankQuestions with a
// regex. That proves the plan is not sliced; it cannot prove the ASKED SET is the top-K by score.
//
// The distinction is the whole rule. Truncation and selection produce the same COUNT — four
// questions — and differ only in WHICH four. Take the first four in pool order rather than the
// best four and the interview still looks correct: four real questions, truthful counts, a round
// that ends on time. What is lost is invisible from outside — the most informative question of the
// round, silently traded for whichever happened to be enumerated first.
//
// So this asserts the selection itself, on the real constants: the cap bounds the COUNT and the
// (tier, score) order chooses the MEMBERS, independently.
{
  const cmp = (a: { id: string; score: number }, b: { id: string; score: number }) =>
    askTier(b.id) - askTier(a.id) || b.score - a.score;
  // Deliberately enumerated worst-first, so "the first K in pool order" and "the top K by score"
  // are disjoint answers and the assertion cannot be satisfied by accident.
  const pool = [
    { id: 'q_worst', score: 0.05 }, { id: 'q_bad', score: 0.12 }, { id: 'q_meh', score: 0.30 },
    { id: 'q_ok', score: 0.55 }, { id: 'q_good', score: 0.71 }, { id: 'q_best', score: 0.93 },
  ];
  const round = (available: typeof pool) =>
    [...available].sort(cmp).slice(0, AF_ROUND_MAX_QUESTIONS).map((q) => q.id);

  const full = round(pool);
  check('§7 a 6-question pool asks exactly AF_ROUND_MAX_QUESTIONS',
    full.length === AF_ROUND_MAX_QUESTIONS, `asked ${full.length} of a cap of ${AF_ROUND_MAX_QUESTIONS}`);
  check('§7 the round is the TOP-K by score, not the first K enumerated (R6.1.4)',
    full.join(',') === 'q_best,q_good,q_ok,q_meh',
    `asked [${full.join(', ')}] — pool order would have given [q_worst, q_bad, q_meh, q_ok]`);
  check('§7 no question outscored by an asked one is left out',
    pool.filter((q) => !full.includes(q.id)).every((out) =>
      full.every((inId) => pool.find((q) => q.id === inId)!.score >= out.score)),
    'a higher-scoring question was dropped in favour of a lower-scoring one');

  // The cap is a CEILING, never a quota: a round with fewer useful questions asks fewer, and is
  // never padded with a question scoreQuestion refused.
  const two = round(pool.slice(4));
  check('§7 a 2-question pool asks 2, not the cap (the cap never pads a round)',
    two.length === 2, `asked ${two.length}`);

  // And the cap really is what bounds the count — otherwise §7's first check passes on a pool that
  // happened to be small.
  check('§7 the cap is what limits the round (raising it admits more of the same pool)',
    [...pool].sort(cmp).slice(0, AF_ROUND_MAX_QUESTIONS + 1).length === AF_ROUND_MAX_QUESTIONS + 1
      && pool.length > AF_ROUND_MAX_QUESTIONS,
    'the fixture pool is not larger than the cap, so the cap was never exercised');

  // §7.1 — AND THE MODEL MUST BE THE PRODUCTION EXPRESSION, not one this file invented.
  // src/data/advancedFilters.ts and src/app/agent.tsx are not standalone-importable by a plain Node
  // runner (documented in verify-af-min-useful-questions-gate.ts's EXECUTION NOTE), so `cmp` above
  // is executed against the REAL askTier but assembled here. That is only worth anything if it is
  // provably the same expression production sorts and caps with — otherwise §7 grades a model.
  const advSrc = readFileSync(join(root, 'src', 'data', 'advancedFilters.ts'), 'utf8');
  const agentSrc = readFileSync(join(root, 'src', 'app', 'agent.tsx'), 'utf8');
  check('§7.1 rankQuestions sorts by exactly (ask-tier desc, then score desc) — the comparator §7 models',
    /askTier\(b\.question\.id\)\s*-\s*askTier\(a\.question\.id\)\s*\|\|\s*b\.score\s*-\s*a\.score/.test(advSrc),
    'the production comparator in advancedFilters.ts is no longer the one this section reasons about');
  check('§7.1 the round ends on a COUNT comparison against AF_ROUND_MAX_QUESTIONS, never a re-selection',
    /askedThisRound\s*>=\s*AF_ROUND_MAX_QUESTIONS/.test(agentSrc),
    'agent.tsx no longer bounds the round by counting asked questions — if it now filters or re-ranks ' +
    'to hit the cap, R6.1.4 is broken and §7 is measuring the wrong thing');
}

console.log(failed === 0
  ? '\n✓ salience and ask-tier order questions and nothing else; the round cap bounds the COUNT, and\n  the (tier, score) order chooses the MEMBERS — R5.6.1, R5.6.2, R6.1.4'
  : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
