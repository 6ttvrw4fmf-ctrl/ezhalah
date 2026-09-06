// THE ADVANCED-FILTER **OFFER** GATE AND **ASK** GATE — ONE SHARED PREDICATE (owner 2026-08-25).
//
// WHY THIS FILE CHANGED, DATED. Shipped 2026-08-24, this barrier asserted the OPPOSITE of what it
// asserts now: that the 10% fraction lived ONLY in the offer gate and must never appear inside
// scoreQuestion. That separation encoded the owner's 2026-08-22 rule, under which a running round
// could ask about ANY option that changed the set at all (`o.count < N`). On 2026-08-25 the owner
// deliberately removed the separation:
//
//   "You have 100 properties. If the next AF question is 'Do you want a gym?' but 100/100 properties
//    have a gym, then asking that is pointless. The answer cannot narrow anything. So do not show
//    that question. Same if 98/100 have it… Certified question = allowed to ask. Useful backend split
//    = worth asking now. We need BOTH."
//
// So the SAME rule now governs both gates, and this barrier's job flipped from "prove they are
// separate" to "prove they are ONE": neither may re-implement the arithmetic. That is not tidiness.
// While the ask gate was looser, an offer could promise a round built on options the round itself
// would then drop — tap, open, immediately close. PR #1094 had to ship a fix for that exact bug shape
// arriving by a different route (a skipped scope tier); sharing the predicate makes it unrepresentable.
//
//   PREDICATE — optionNarrowsMeaningfully(count, total) in src/lib/afRanking.ts:
//               removes ≥ MEANINGFUL_NARROWING_FRACTION of the current set, OR lands at/under
//               INTERVIEW_STOP_AT. The second clause exists so the LAST step to the target is never
//               blocked by a percentage (26 → 25 removes 3.8% and still qualifies).
//   ASK   gate — scoreQuestion(): filters the OPTIONS by that predicate; minOptionsFor() then decides
//               whether what survives is still a real choice (single ≥2, multi ≥1).
//   OFFER gate — offersMeaningfulNarrowing(): more than INTERVIEW_STOP_AT results AND some remaining
//               option that satisfies the predicate. Nothing qualifying ⇒ «تحديد أكثر» is HIDDEN and
//               only «عرض المزيد» remains. Never a pointless question to force the count down.
//
// ONE-SIDED, AND THAT HALF IS PERMANENT. The rule rejects only NEAR-NO-OP options. It must never
// reject an option for being a SMALL slice — 8 of 100 removes 92% and is an excellent question. That
// is what the 2026-08-22 decision was protecting ("we still have thousands of listings" must never end
// in "we ran out of questions"), and it is asserted here and swept in verify-af-narrowing-gate.ts §6.
//
// What breaks if this drifts: the fraction re-hand-rolled in either gate lets the two disagree again
// (a dead button, or a chip that does nothing); the fraction weakening lets a round move 8,000
// listings to 7,940 — specificity theatre; a two-sided band silently re-bans the small-slice questions
// the owner fought to get back. The ≤25 target and the manual-tap rule ride along: INTERVIEW_STOP_AT
// stays 25 (the owner chose 25 over 30), and the offer probe renders a button and nothing else — it
// must never open the overlay (owner 2026-08-19).
//
// EXECUTED, not grepped, for the numeric half: src/lib/afRanking.ts is pure (imports only types), so
// the real predicate runs against real fixtures — the afCohorts.ts / verify-af-narrowing-gate.ts
// precedent. The wiring half (agent.tsx: where the verdict is used, and that it opens nothing) is a
// source read, because agent.tsx is a React screen no barrier can execute — those checks say so.
//
//   node --experimental-strip-types scripts/verify-af-offer-gate.ts   (wire into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  offersMeaningfulNarrowing, scoreQuestion, optionNarrowsMeaningfully,
  MEANINGFUL_NARROWING_FRACTION, INTERVIEW_STOP_AT, type AdvancedOption,
} from '../src/lib/afRanking.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// Counts are the only thing either gate reads; labels/keys are noise here.
const opts = (...counts: number[]): AdvancedOption[] =>
  counts.map((count, i) => ({ key: `o${i}`, label: `o${i}`, count }));

console.log('\nAF offer/ask gates — one shared predicate; a round is offered only when it can pay for itself\n');

// ── 1. The owner's own numbers, EXECUTED ─────────────────────────────────────────────────────────
check(`MEANINGFUL_NARROWING_FRACTION is the owner's 10% (got ${MEANINGFUL_NARROWING_FRACTION})`,
  MEANINGFUL_NARROWING_FRACTION === 0.1,
  'src/lib/afRanking.ts — the owner set this threshold on 2026-08-24 and extended it to the ask gate '
  + 'on 2026-08-25; changing it needs their decision');

check(`INTERVIEW_STOP_AT is 50 (got ${INTERVIEW_STOP_AT}) — owner product rule 2026-09-04 (was 25)`,
  INTERVIEW_STOP_AT === 50,
  'src/lib/afRanking.ts — the round target and this gate\'s "finishes the job" clause both hang off it; '
  + 'above 50 rounds continue while truthful questions remain, at ≤50 the interview finishes and reveals all');

// "Example at N=50: an option yielding <=45 qualifies; one yielding 47 does not." Exactly 10% must
// qualify — the boundary is `>=`, so 50→45 is the last qualifying answer, not the first rejected one.
// (Owner's original worked example was at N=50 with a 25 target; re-expressed at N=100 for the 50
// target — same inclusive 10% boundary: 100→90 is the last qualifying answer, 100→94 is not.)
check('N=100, best option yields 90 (exactly 10% removed) ⇒ OFFERED',
  offersMeaningfulNarrowing(100, opts(90, 99)) === true,
  'the 10% boundary is inclusive; a `>` here would silently drop the owner\'s own worked example');
check('N=100, best option yields 94 (6% removed) ⇒ HIDDEN — a round that moves 100→94 is not worth a tap',
  offersMeaningfulNarrowing(100, opts(94, 99)) === false);

// "Example at N=27: an option yielding 24 qualifies" — it both clears 10% and finishes the job.
check('N=52, best option yields 49 ⇒ OFFERED',
  offersMeaningfulNarrowing(52, opts(49)) === true);

// THE SECOND CLAUSE ALONE. 26→25 removes 3.8% — well under the fraction — but it lands AT the target,
// which is the entire point of the round. Only 26/27-sized sets can isolate this clause, which is
// exactly why it is easy to delete by accident.
check('N=51, best option yields 50 (only 2% removed, but it lands AT the ≤50 target) ⇒ OFFERED',
  offersMeaningfulNarrowing(51, opts(50)) === true,
  'the `|| o.count <= INTERVIEW_STOP_AT` clause: finishing the job always qualifies, however small the step');

// ── 2. The gate's own floor and its no-op guard ──────────────────────────────────────────────────
check('at exactly INTERVIEW_STOP_AT results nothing is ever offered, however good the option',
  offersMeaningfulNarrowing(50, opts(1)) === false,
  'the ≤50 hide is `total <= INTERVIEW_STOP_AT`; a `<` would offer a round on an already-finished set');
check('below the target either — the button is gone, only «عرض المزيد» remains',
  offersMeaningfulNarrowing(10, opts(1)) === false);
check('a no-op option (count === total, 100% of the set already has it) never earns an offer',
  offersMeaningfulNarrowing(500, opts(500, 500)) === false,
  'picking it would remove nothing — offering a round on it is a promise the round cannot keep');
check('no options at all ⇒ HIDDEN (a failed/empty probe must never leave a live button behind)',
  offersMeaningfulNarrowing(500, opts()) === false);

// ── 3. ONE RULE, TWO GATES — they can no longer disagree (owner 2026-08-25) ─────────────────────
// THIS SECTION IS THE INVERSION. It used to prove that a sub-10% question was REFUSED an offer but
// still ASKED by scoreQuestion ("the 10% has NOT leaked into the ask gate"). The owner removed that
// separation on 2026-08-25 — the leak is now the rule — so the same fixture proves the opposite, and
// the check below sweeps for AGREEMENT rather than for a one-way implication.
{
  const N = 1000;
  const sub10 = opts(950, 970);  // best removal 50 = 5% — the gym shape at scale
  check('a sub-10% question does NOT earn an offer…',
    offersMeaningfulNarrowing(N, sub10) === false);
  check('…and scoreQuestion no longer asks it either — both gates read the SAME predicate',
    scoreQuestion('street_width', 'single', { options: sub10, unknownCount: 0, total: N }) === null,
    "owner 2026-08-25: asking about a 5% cut wastes the user's tap; before this date it was asked");
}
// THE SMALL-SLICE HALF IS UNTOUCHED — the permanent part of the 2026-08-22 rule. street_width «30m+»
// at 60 of 1,874 is a 3.2% SHARE but a 96.8% CUT: exactly the question that used to vanish, and the
// gate is one-sided precisely so it never vanishes again.
check('the 2026-08-22 repro still holds: a 3.2%-share option is still ASKED (N=1,874, option=60)',
  scoreQuestion('street_width', 'single',
    { options: opts(60, 210), unknownCount: 0, total: 1874 }) !== null);
check('…and it earns an OFFER too — offer and ask agree on it',
  offersMeaningfulNarrowing(1874, opts(60, 210)) === true);

// AGREEMENT, SWEPT. Above the target the two gates must return the same verdict for the same option;
// below/at it the offer gate additionally hides (the interview is finished). Swept over the whole
// interesting range rather than asserted on one fixture, since the predicates are called from two
// modules and could be edited apart again.
{
  let disagreements = 0; let first = '';
  for (let total = 1; total <= 400; total += 1) {
    for (const count of [0, 1, 5, 24, 25, 26, Math.floor(total * 0.5), Math.floor(total * 0.9),
      Math.ceil(total * 0.9), Math.ceil(total * 0.95), total - 1, total]) {
      if (count < 0 || count > total) continue;
      const offered = offersMeaningfulNarrowing(total, opts(count));
      const asked = optionNarrowsMeaningfully(count, total);
      const expected = total > INTERVIEW_STOP_AT && asked;
      if (offered !== expected) { disagreements++; if (!first) first = `N=${total} k=${count}`; }
    }
  }
  check('above the target the OFFER gate and the ASK predicate agree on EVERY option',
    disagreements === 0,
    `${disagreements} disagreement(s), first ${first} — a promised round the round itself would drop`);
}

// ── 4. Structural: NEITHER gate re-implements the arithmetic — one predicate, one fraction ───────
// SOURCE READ (not executed): fixtures prove today's behaviour, but a copy of the rule can be pasted
// back in a shape the fixtures happen to miss (a floor keyed off unknownCount, a second filter after
// the sort, a hand-rolled 0.9 in the offer gate). INVERTED 2026-08-25: this block used to assert the
// fraction was ABSENT from scoreQuestion; it now asserts the shared CALL is present in both gates and
// the fraction itself is written exactly once in the module.
{
  const ranking = codeOnly(read('src/lib/afRanking.ts'));
  const bodyOf = (name: string) => {
    const from = ranking.indexOf(`export function ${name}`);
    const rest = ranking.slice(from + 1);
    const to = rest.indexOf('\nexport ');
    return from < 0 ? '' : (to < 0 ? rest : rest.slice(0, to));
  };
  const ask = bodyOf('scoreQuestion');
  const offer = bodyOf('offersMeaningfulNarrowing');

  check('scoreQuestion() gates inclusion on the SHARED predicate and nothing else (an UNKNOWN count is skipped, never scored)',
    ask.includes('result.options.filter((o) => o.count != null && optionNarrowsMeaningfully(o.count, N))'),
    'src/lib/afRanking.ts — this call IS the owner\'s 2026-08-25 rule');
  check('offersMeaningfulNarrowing() calls that same predicate rather than its own copy',
    /optionNarrowsMeaningfully\(o\.count, total\)/.test(offer),
    'src/lib/afRanking.ts — two copies of one rule drift, and the drift is a button that opens an empty round');
  check('neither gate body re-implements the fraction (no MEANINGFUL_NARROWING_FRACTION, no 0.x·N)',
    ![ask, offer].some((b) => /MEANINGFUL_NARROWING_FRACTION/.test(b)
      || /N\s*\*\s*0\.\d/.test(b) || /0\.\d+\s*\*\s*N/.test(b)
      || /total\s*\*\s*0\.\d/.test(b) || /0\.\d+\s*\*\s*total/.test(b)),
    'the `1 - |2k/N - 1|` split is an ORDERING signal only — a hand-rolled fraction COMPARISON in '
    + 'either gate is the banned shape, whichever direction it points');
  check('the fraction is multiplied in exactly ONE place in the module — the predicate itself',
    (ranking.match(/\*\s*MEANINGFUL_NARROWING_FRACTION/g) ?? []).length === 1,
    'src/lib/afRanking.ts optionNarrowsMeaningfully() — one place, so a barrier can assert on it');
  check('the predicate keeps its ≤INTERVIEW_STOP_AT escape clause (the last step to the target)',
    /count <= INTERVIEW_STOP_AT/.test(bodyOf('optionNarrowsMeaningfully')),
    'without it a 26→25 option is banned by a percentage and the interview can never finish');
}

// ── 5. Structural: where the verdict is used, and that it opens nothing ──────────────────────────
// SOURCE READ (not executed): agent.tsx is a React screen; no barrier here can render it.
{
  const agent = codeOnly(read('src/app/agent.tsx'));
  const noImports = agent.replace(/^import .*$/gm, '');

  check('offersMeaningfulNarrowing is called in exactly ONE place outside the imports (the offer probe)',
    (noImports.match(/offersMeaningfulNarrowing/g) ?? []).length === 1,
    'a second call site means the fraction has escaped into the round itself (presentGuided/commitGuidedStep)');
  check('the probe feeds it rankQuestions\' OWN surviving options, so offer and round cannot disagree',
    /ranked\.some\(\(r\) => offersMeaningfulNarrowing\(r\.total, r\.options\)\)/.test(agent),
    'src/app/agent.tsx — probing with anything other than the ask gate\'s output re-splits the two gates');

  // Name-agnostic, matching verify-narrow-cta-count-gate.ts: what matters is that the SAME
  // matchTotal-first total gates the button, now ANDed with the probe's verdict.
  const rawTotalName = agent.match(/const\s+(\w+)\s*=\s*m\.result\.matchTotal\s*\?\?\s*fetched/)?.[1];
  check('the «تحديد أكثر» button requires BOTH >INTERVIEW_STOP_AT and the probe verdict `=== true`',
    !!rawTotalName && new RegExp(
      `const canNarrowFurther = ${rawTotalName} > INTERVIEW_STOP_AT[^;]*afCanNarrow\\[m\\.id\\] === true`,
    ).test(agent),
    'src/app/agent.tsx — `=== true` (not truthiness) is what makes an unresolved/failed probe HIDE the button rather than show one that cannot deliver');

  // AUTO-OPEN BAN (owner 2026-08-19). The probe runs on every new results turn; if it ever opened the
  // overlay it would be the auto-popup under a new name. The next round is ALWAYS a manual tap.
  const probeFrom = agent.indexOf('const afProbedRef');
  const probe = probeFrom < 0 ? '' : agent.slice(probeFrom, agent.indexOf('}, [lastResultsMsg', probeFrom));
  // The tier WALK + the ranked assessment moved into ONE shared function, `assessNarrowing` (owner
  // 2026-09-04), so the offer button and the automatic round continuation can never disagree. The
  // structural pins below read THAT body; the effect itself must route through it.
  const assessFrom = agent.indexOf('const assessNarrowing = async');
  const assess = assessFrom < 0 ? '' : agent.slice(assessFrom, agent.indexOf('const afProbedRef', assessFrom));
  check('the offer effect routes through the ONE shared assessment (assessNarrowing), not a private walk',
    assessFrom >= 0 && /void assessNarrowing\(q, asked\)/.test(probe),
    'src/app/agent.tsx — two walks drift; the button must promise exactly the round that finishGuided would continue');
  check('the offer probe exists and only records a verdict (setAfCanNarrow)',
    probeFrom >= 0 && probe.includes('setAfCanNarrow'),
    'src/app/agent.tsx — the probe must be findable for the ban below to mean anything');
  check('the offer probe NEVER opens the interview — no startAgeFlow/setAgeFlow inside it',
    probeFrom >= 0 && !/startAgeFlow\(|setAgeFlow\(/.test(probe),
    'owner 2026-08-19: the Advanced Filter must never auto-open after a search — it renders a button, the user taps it');

  // ── AN OFFER MUST BE DELIVERABLE (review 2026-08-25) ──────────────────────────────────────────
  // Two ways the button could render and then do nothing, both found by review, both fixed here.
  //
  // 1. SCOPE. The probe short-circuits to "yes" when the CATEGORY→GROUP→TYPE walk still has a step.
  //    First fix (2026-08-25 review): ask `nextScopeTier(q, asked)` rather than
  //    `unresolvedScopeTiers(q).length`, because a tier the user SKIPPED stays UNRESOLVED forever
  //    while never being re-asked. That was necessary and not sufficient — REPRODUCED LIVE the same
  //    day on الطائف / إيجار / شهري / «الاستراحات والريف» (43 matches): a tier EXISTING still proves
  //    nothing, because presentGuided AUTO-COMMITS a tier that resolves to ≤1 option and walks on.
  //    Of that group's five member types only شاليه is populated there, so the type tier committed
  //    itself, Chalet certifies no monthly cohort, and the round asked ZERO questions — the user
  //    tapped, was never asked anything, and got a duplicate 43-result turn plus a receipt reading
  //    «اختياراتك: شاليه», a choice they never made.
  //
  //    So the probe must WALK the tiers the way the round does. The checks below pin that walk; a
  //    behavioural fixture is impossible here (agent.tsx cannot be rendered by a barrier), so each
  //    one is a precise read of the shipped shape and each was mutation-proven against this file.
  check('the probe no longer SHORT-CIRCUITS on a tier merely existing — that shape is banned',
    !/if \(nextScopeTier\(.*\)\) \{ setAfCanNarrow/.test(probe) && !/if \(nextScopeTier\(.*\)\) return 'yes'/.test(assess),
    'src/app/agent.tsx offer probe — a tier that resolves to ≤1 option is AUTO-COMMITTED and walked '
    + 'past, so its existence never proves a round follows (الطائف/شهري/الاستراحات والريف, 43 matches)');
  check('…it RESOLVES each tier instead, against a scope it carries forward itself',
    /nextScopeTier\(scoped, seen\)/.test(assess)
    && /scopeQuestionFor\(tier\)\.resolveOptions\(scoped\)/.test(assess),
    'src/app/agent.tsx offer probe — resolving is the only way to know whether a tier is a real '
    + 'question or a scope the user already has');
  check('a tier with a REAL choice (more than one option) is what earns the offer',
    /if \(res\.options\.length > 1\) return 'yes';/.test(assess),
    'src/app/agent.tsx offer probe — `>= 1` would re-admit the auto-commit case this fix removed');
  check('a ≤1-option tier is AUTO-COMMITTED onto the local scope and the walk continues, exactly as presentGuided does',
    /seen\.add\(tier\)/.test(assess)
    && /scopeQuestionFor\(tier\)\.apply\(scoped, \[res\.options\[0\]\.key\]\)/.test(assess),
    'src/app/agent.tsx offer probe — without the commit the probe ranks the advanced pool against an '
    + 'unresolved scope, which is empty BY CONSTRUCTION, and hides a button that would have worked');
  check('UNKNOWN still never hardens into NO: an UNMEASURABLE tier is `unknown`, only a MEASURED one may say no',
    /if \(!res \|\| res\.probeFailed\) return 'unknown';/.test(assess)
    && /if \(ranked && !ranked\.probeFailed\) return 'no';/.test(assess)
    && /verdict === 'yes'/.test(probe),
    'src/app/agent.tsx offer probe — a turn showing >INTERVIEW_STOP_AT matches cannot truthfully have '
    + 'an empty scope, so total===0 is a failed count RPC, not a fact (permanent fleet rule)');
  check('the advanced-pool rank runs against the RESOLVED scope and the walked asked-set',
    /rankQuestions\(scoped, seen\)/.test(assess)
    && /eligibleQuestions\(scoped\)\.some\(\(qq\) => !seen\.has\(qq\.id\)\)/.test(assess),
    'src/app/agent.tsx offer probe — ranking the RAW query would score every question against a scope '
    + 'the user has not picked yet and come back empty by construction');
  // COST: the walk costs real count RPCs, so it must stay ONE probe per turn and must never poll.
  check('still ONE probe per turn — the (msgId, asked) key guard is intact and nothing polls',
    /afProbedRef\.current\[probeKey\]/.test(probe) && !/setInterval/.test(probe),
    'src/app/agent.tsx offer probe — the walk is at most two tier resolutions and one rank; a probe '
    + 'per transcript turn, or any polling, is the regression this guards');

  // 2. PLAN. startAgeFlow's unresolved-scope bypass hands off to presentGuided WITHOUT ranking. When
  //    the walk then ends at cursor 0 (case 1's scope, now legitimately reached), nothing has ranked
  //    the advanced pool, so the round would finish on an empty plan. The re-rank must therefore also
  //    run when the plan is empty, not only when the cursor has moved.
  check('presentGuided re-ranks when the carried plan is EMPTY, not only when stepIndex > 0',
    /if \(stepIndex > 0 \|\| !ageFlowPlanRef\.current\.length\) \{/.test(agent),
    'src/app/agent.tsx presentGuided — the scope bypass hands off unranked; without this a round '
    + 'opened after a skipped tier opens on an empty plan and closes again (a dead button)');
}

console.log(failures === 0
  ? '\n✓ one predicate, two gates: 10% (or landing at ≤25) both offers a round and admits a question;'
    + ' small slices always ask; ≤50 finishes; a further round continues only through the SAME assessment\n'
  : `\n✗ ${failures} check(s) FAILED — the AF offer/ask gates have drifted apart\n`);
process.exit(failures === 0 ? 0 : 1);
