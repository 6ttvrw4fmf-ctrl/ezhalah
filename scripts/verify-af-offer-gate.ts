// THE ADVANCED-FILTER **OFFER** GATE, AND ITS SEPARATION FROM THE **ASK** GATE (owner 2026-08-24).
//
// Two gates, one turn apart, and conflating them costs the user in opposite directions:
//
//   ASK  gate — scoreQuestion() in src/lib/afRanking.ts, `o.count < N`. Decides which questions a
//               round that is ALREADY RUNNING may ask. The owner's permanent rule of 2026-08-22
//               EXPLICITLY replaced the old "8%-90% option band" with this: a truthful, source-backed
//               choice is never suppressed for being a small slice or a lopsided majority (the Villa /
//               5,154-match repro that ended in "we ran out of questions" while several certified
//               questions had never been asked). Reintroducing ANY percentage filter inside
//               scoreQuestion reverts that decision. See scripts/verify-af-narrowing-gate.ts.
//   OFFER gate — offersMeaningfulNarrowing() in the same module. Decides, one turn EARLIER, whether
//               «تحديد أكثر» is shown under a results turn at all. A round costs the user taps, so it
//               is offered only when it can pay for itself: more than INTERVIEW_STOP_AT results AND
//               some remaining question whose best option removes ≥ AF_OFFER_MIN_REMOVED_FRACTION of
//               the current set, OR finishes the job by landing at or under the target. Nothing
//               qualifying ⇒ the button is HIDDEN, never a pointless question to force the count down.
//
// What breaks if this drifts: the 10% leaking DOWN into scoreQuestion silently re-bans the small-slice
// questions the owner fought to get back (the user is told there is nothing left to ask while there
// is); the 10% weakening or disappearing from the offer gate hands the user a button that opens a
// round which moves 8,000 listings to 7,940 — specificity theatre. The ≤25 target and the manual-tap
// rule ride along: INTERVIEW_STOP_AT stays 25 (the owner chose 25 over 30), and the offer probe
// renders a button and nothing else — it must never open the overlay (owner 2026-08-19).
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
  offersMeaningfulNarrowing, scoreQuestion,
  AF_OFFER_MIN_REMOVED_FRACTION, INTERVIEW_STOP_AT, type AdvancedOption,
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

console.log('\nAF offer gate — «تحديد أكثر» is offered only when a round can pay for itself\n');

// ── 1. The owner's own numbers, EXECUTED ─────────────────────────────────────────────────────────
check(`AF_OFFER_MIN_REMOVED_FRACTION is the owner's 10% (got ${AF_OFFER_MIN_REMOVED_FRACTION})`,
  AF_OFFER_MIN_REMOVED_FRACTION === 0.1,
  'src/lib/afRanking.ts — the owner set this threshold on 2026-08-24; changing it needs their decision');

check(`INTERVIEW_STOP_AT is still 25 (got ${INTERVIEW_STOP_AT}) — the owner chose 25 over 30`,
  INTERVIEW_STOP_AT === 25,
  'src/lib/afRanking.ts — the round target and this gate\'s "finishes the job" clause both hang off it');

// "Example at N=50: an option yielding <=45 qualifies; one yielding 47 does not." Exactly 10% must
// qualify — the boundary is `>=`, so 50→45 is the last qualifying answer, not the first rejected one.
check('N=50, best option yields 45 (exactly 10% removed) ⇒ OFFERED',
  offersMeaningfulNarrowing(50, opts(45, 49)) === true,
  'the 10% boundary is inclusive; a `>` here would silently drop the owner\'s own worked example');
check('N=50, best option yields 47 (6% removed) ⇒ HIDDEN — a round that moves 50→47 is not worth a tap',
  offersMeaningfulNarrowing(50, opts(47, 49)) === false);

// "Example at N=27: an option yielding 24 qualifies" — it both clears 10% and finishes the job.
check('N=27, best option yields 24 ⇒ OFFERED',
  offersMeaningfulNarrowing(27, opts(24)) === true);

// THE SECOND CLAUSE ALONE. 26→25 removes 3.8% — well under the fraction — but it lands AT the target,
// which is the entire point of the round. Only 26/27-sized sets can isolate this clause, which is
// exactly why it is easy to delete by accident.
check('N=26, best option yields 25 (only 3.8% removed, but it lands AT the ≤25 target) ⇒ OFFERED',
  offersMeaningfulNarrowing(26, opts(25)) === true,
  'the `|| o.count <= INTERVIEW_STOP_AT` clause: finishing the job always qualifies, however small the step');

// ── 2. The gate's own floor and its no-op guard ──────────────────────────────────────────────────
check('at exactly INTERVIEW_STOP_AT results nothing is ever offered, however good the option',
  offersMeaningfulNarrowing(25, opts(1)) === false,
  'the ≤25 hide is `total <= INTERVIEW_STOP_AT`; a `<` would offer a round on an already-finished set');
check('below the target either — the button is gone, only «عرض المزيد» remains',
  offersMeaningfulNarrowing(10, opts(1)) === false);
check('a no-op option (count === total, 100% of the set already has it) never earns an offer',
  offersMeaningfulNarrowing(500, opts(500, 500)) === false,
  'picking it would remove nothing — offering a round on it is a promise the round cannot keep');
check('no options at all ⇒ HIDDEN (a failed/empty probe must never leave a live button behind)',
  offersMeaningfulNarrowing(500, opts()) === false);

// ── 3. THE SEPARATION — the 10% lives ONLY in the offer gate ─────────────────────────────────────
// One fixture proves both halves: N=1,000 with options at 950 and 970. Best removal is 50 = 5%, so
// the OFFER gate declines — but the ASK gate must still ask it, because it is a real, source-backed
// choice and a round already running is governed by the 2026-08-22 rule, not by this fraction.
{
  const N = 1000;
  const sub10 = opts(950, 970);
  check('a sub-10% question does NOT earn an offer…',
    offersMeaningfulNarrowing(N, sub10) === false);
  check('…but scoreQuestion still ASKS it — the 10% has NOT leaked into the ask gate',
    scoreQuestion('street_width', 'single', { options: sub10, unknownCount: 0, total: N }) !== null,
    'src/lib/afRanking.ts scoreQuestion() — a percentage filter here reverts the owner\'s permanent 2026-08-22 rule');
}
// The owner's original 2026-08-22 repro, re-run through this barrier so a leak is caught here too and
// not only in verify-af-narrowing-gate.ts: street_width «30m+» at 60 of 1,874 is 3.2% — under any
// re-introduced band, and exactly the question that used to vanish.
check('the 2026-08-22 repro still holds: a 3.2%-share option is still ASKED (N=1,874, option=60)',
  scoreQuestion('street_width', 'single',
    { options: opts(60, 210), unknownCount: 0, total: 1874 }) !== null);

// DIRECTION of the separation: the offer gate is strictly STRONGER, never orthogonal. Every option it
// accepts on must also be one the ask gate keeps (`o.count < N`), so the offer can never promise a
// round built on an option the round itself would drop. Swept over the whole interesting range rather
// than asserted on one fixture, since the two predicates are edited independently.
{
  let contradictions = 0;
  for (let total = 26; total <= 400; total += 1) {
    for (const count of [0, 1, 5, 24, 25, 26, Math.floor(total * 0.5), total - 1, total]) {
      if (count > total) continue;
      const o = opts(count);
      if (offersMeaningfulNarrowing(total, o) && !(count < total)) contradictions++;
    }
  }
  check('every option the OFFER gate accepts also survives the ASK gate\'s own `count < N` predicate',
    contradictions === 0,
    `${contradictions} case(s) where the offer promised a round built on an option the round would drop`);
}

// ── 4. Structural: the fraction is not written anywhere inside scoreQuestion ──────────────────────
// SOURCE READ (not executed): fixtures prove today's behaviour, but a band can be reintroduced in a
// shape the fixtures happen to miss (a floor keyed off unknownCount, a second filter after the sort).
// Pin the ask gate's body to the one predicate it is allowed to have.
{
  const ranking = codeOnly(read('src/lib/afRanking.ts'));
  const from = ranking.indexOf('export function scoreQuestion');
  const rest = ranking.slice(from + 1);
  const to = rest.indexOf('\nexport ');
  const body = to < 0 ? rest : rest.slice(0, to);
  check('scoreQuestion() still gates inclusion on exactly `o.count < N` and nothing else',
    body.includes('result.options.filter((o) => o.count < N)'),
    'src/lib/afRanking.ts — this one predicate IS the owner\'s 2026-08-22 rule');
  check('scoreQuestion() references neither the offer fraction nor the offer gate',
    !/AF_OFFER_MIN_REMOVED_FRACTION|offersMeaningfulNarrowing/.test(body),
    'the OFFER gate decides whether to open a round; it must never decide what a running round may ask');
  check('no percentage-of-N band has been reintroduced inside scoreQuestion (the 2026-08-11 8%-90% shape)',
    !/N\s*\*\s*0\.\d/.test(body) && !/0\.\d+\s*\*\s*N/.test(body),
    'the `1 - |2k/N - 1|` split is an ORDERING signal only — a fraction-of-N COMPARISON is the banned shape');
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
  check('the offer probe exists and only records a verdict (setAfCanNarrow)',
    probeFrom >= 0 && probe.includes('setAfCanNarrow'),
    'src/app/agent.tsx — the probe must be findable for the ban below to mean anything');
  check('the offer probe NEVER opens the interview — no startAgeFlow/setAgeFlow inside it',
    probeFrom >= 0 && !/startAgeFlow\(|setAgeFlow\(/.test(probe),
    'owner 2026-08-19: the Advanced Filter must never auto-open after a search — it renders a button, the user taps it');

  // ── AN OFFER MUST BE DELIVERABLE (review 2026-08-25) ──────────────────────────────────────────
  // Two ways the button could render and then do nothing, both found by review, both fixed here.
  //
  // 1. SCOPE. The probe short-circuits to "yes" when the CATEGORY→GROUP→TYPE walk still has a step —
  //    but the walk itself asks `nextScopeTier(q, asked)`, and a tier the user SKIPPED in an earlier
  //    round stays UNRESOLVED forever while never being re-asked. `unresolvedScopeTiers(q).length`
  //    therefore said yes to a walk that falls straight through: tap, open, close.
  check('the probe asks the SAME scope question the walk asks (nextScopeTier, not a raw unresolved count)',
    /if \(nextScopeTier\(q, new Set\(asked\)\)\) \{ setAfCanNarrow/.test(probe),
    'src/app/agent.tsx offer probe — `unresolvedScopeTiers(q).length` offers a round on a tier that '
    + 'is unresolved but already asked (a skip), whose walk ends immediately with nothing to ask');

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
  ? '\n✓ offer gate holds: 10% offers a round, never bans a question; ≤25 stays 25; the next round is a tap\n'
  : `\n✗ ${failures} check(s) FAILED — the AF offer/ask separation is broken\n`);
process.exit(failures === 0 ? 0 : 1);
