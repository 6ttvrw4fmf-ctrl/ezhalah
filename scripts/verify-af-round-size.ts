// ADVANCED FILTER ROUND SIZE (owner 2026-08-24, "progressive rounds") ────────────────────────────
// The Advanced Filter no longer narrows in one long questionnaire. It narrows in SMALL
// CONVERSATIONAL ROUNDS: a round asks min(availableUsefulQuestions, AF_ROUND_MAX_QUESTIONS) ADVANCED
// questions, minimum 1, then stops; continuing is always a manual tap on «تحديد أكثر» (owner
// 2026-08-19 — AF must never auto-open), and the next round is computed from the already-narrowed
// cohort. This barrier pins that COUNT and nothing else.
//
// WHAT BREAKING IT COSTS THE USER — the three regressions this file exists to catch:
//   • Cap deleted / raised: the user is back to the 8-10 question interrogation the owner replaced.
//     They answer, and answer, and answer, with no results in between — the exact fatigue that made
//     the owner choose rounds over a single interview.
//   • Cap counts SCOPE steps (property_group / property_type): a hierarchy that costs 2 tiers to
//     resolve leaves only 2 real questions in the round. Scope steps are the prerequisite that EARNS
//     the right to ask — they must never spend the budget, exactly as the scope→advanced transition
//     gate already counts advanced questions only.
//   • Cap turned into a QUALITY filter (a "strength" threshold on which questions may be asked): that
//     silently reverts the owner's narrowing rule (2026-08-22, AMENDED 2026-08-25), which replaced
//     the old 8%-90% band and says every truthful question whose options can really narrow may be
//     asked. The 2-4 is a COUNT cap. scoreQuestion() alone decides WHICH questions. Never merge them.
//   • Cap fused with MIN_USEFUL_QUESTIONS_TO_SHOW: that constant is the OPEN gate (owner PR #1045,
//     barrier-pinned at 1 by verify-af-min-useful-questions-gate.ts). Reusing it as the round size
//     would make every round exactly one question long — or, if raised to 4 to serve as the cap,
//     would stop AF from opening for any cohort with fewer than 4 useful questions. Two knobs.
//
// The "min(available, cap)" LOWER half needs no code of its own: a round with fewer useful questions
// than the cap ends through presentGuided's existing empty-plan terminator. That terminator's
// two-part relationship with this cap is pinned in verify-af-min-useful-questions-gate.ts (amended
// the same day for exactly that reason); here we pin the UPPER half and its placement.
//
// EXECUTION: the constant itself lives in src/lib/afRanking.ts, the pure module extracted so barriers
// can EXECUTE the AF rules instead of grepping them (afCohorts.ts precedent) — so its value is a real
// import, not a regex. The WIRING lives in src/app/agent.tsx, which no plain Node runner can import
// (Expo/React Native chain), so those assertions are precise source-text checks on the shipped code,
// comments stripped, matching every other AF barrier in this repo.
//
//   node --experimental-strip-types scripts/verify-af-round-size.ts   (wire into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AF_ROUND_MAX_QUESTIONS } from '../src/lib/afRanking.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAdvanced Filter round size — min(available, AF_ROUND_MAX_QUESTIONS), advanced questions only\n');

const ag = codeOnly(read('src/app/agent.tsx'));
const adv = codeOnly(read('src/data/advancedFilters.ts'));
const rank = codeOnly(read('src/lib/afRanking.ts'));

// ── 1. THE CONSTANT — executed, not grepped ──────────────────────────────────────────────────────
check('AF_ROUND_MAX_QUESTIONS is exported from src/lib/afRanking.ts and is exactly 4 (owner 2026-08-24: adaptive 2-4, cap 4)',
  AF_ROUND_MAX_QUESTIONS === 4,
  `imported value is ${String(AF_ROUND_MAX_QUESTIONS)} — a lower cap shortens every round; a higher one restores the interrogation the rounds replaced`);

// ── 2. IT IS A SECOND KNOB, NOT MIN_USEFUL_QUESTIONS_TO_SHOW ─────────────────────────────────────
// MIN_USEFUL_QUESTIONS_TO_SHOW governs whether AF OPENS AT ALL (=1, owner PR #1045). The round size
// governs how many questions one round asks. Same units, opposite jobs; collapsing them breaks one
// of the two rules whichever value survives.
const minUseful = Number(adv.match(/export const MIN_USEFUL_QUESTIONS_TO_SHOW = (\d+);/)?.[1] ?? NaN);
check('MIN_USEFUL_QUESTIONS_TO_SHOW is still declared in src/data/advancedFilters.ts and still exactly 1 (owner PR #1045 — the OPEN gate, untouched by rounds)',
  minUseful === 1,
  `parsed ${String(minUseful)} — raising it to serve as the round size would stop AF opening for any cohort with fewer than that many useful questions`);
check('the round size is a DIFFERENT constant with a DIFFERENT value — MIN_USEFUL_QUESTIONS_TO_SHOW was not reused as the round cap',
  Number.isFinite(minUseful) && AF_ROUND_MAX_QUESTIONS > minUseful,
  `AF_ROUND_MAX_QUESTIONS=${String(AF_ROUND_MAX_QUESTIONS)} vs MIN_USEFUL_QUESTIONS_TO_SHOW=${String(minUseful)}`);

// ── 3. A COUNT CAP, NEVER A QUALITY FILTER (owner's ASK rule: 2026-08-22, amended 2026-08-25) ────
// scoreQuestion() is the sole judge of WHICH questions may be asked. If the round cap ever leaks into
// it — or into rankQuestions — a truthful question starts being suppressed for being "weak", which is
// precisely what the owner banned. NOTE (2026-08-25): the ASK rule itself moved that day — an option
// must now also NARROW meaningfully (optionNarrowsMeaningfully, see verify-af-narrowing-gate.ts).
// That is a change to the rule scoreQuestion applies, NOT permission for the round cap to enter it:
// the two assertions below are unchanged and still say the cap must never reach either body.
const scoreBody = rank.match(/export function scoreQuestion\([\s\S]*?\n\}/)?.[0] ?? '';
check('scoreQuestion body located (extraction must fail loudly, never silently pass)', scoreBody.length > 0);
check('scoreQuestion never sees the round cap — WHICH questions is the narrowing gate\'s call alone',
  !!scoreBody && !/AF_ROUND_MAX_QUESTIONS/.test(scoreBody),
  'a round is capped by COUNT; which questions it asks is scoreQuestion\'s decision alone');
const rankBody = adv.match(/export async function rankQuestions\([\s\S]*?\n\}/)?.[0] ?? '';
check('rankQuestions body located (extraction must fail loudly, never silently pass)', rankBody.length > 0);
check('rankQuestions never truncates the pool to the round cap — the plan stays the FULL useful pool, so the next round resumes from a real ranking',
  !!rankBody && !/AF_ROUND_MAX_QUESTIONS/.test(rankBody),
  'slicing the ranked pool here would also break the progress bar and the offer probe, which both read plan length');

// ── 4. WIRING — advancedFilters.ts re-exports it, agent.tsx imports it from there ────────────────
check('src/data/advancedFilters.ts re-exports AF_ROUND_MAX_QUESTIONS verbatim (agent.tsx\'s single AF import line must resolve it)',
  /export \{[\s\S]*?\bAF_ROUND_MAX_QUESTIONS\b[\s\S]*?\};/.test(adv));
check('agent.tsx imports AF_ROUND_MAX_QUESTIONS from @/data/advancedFilters',
  /import\s*\{[^}]*\bAF_ROUND_MAX_QUESTIONS\b[^}]*\}\s*from\s*'@\/data\/advancedFilters'/.test(ag));

// ── 5. THE CAP ITSELF, INSIDE presentGuided ─────────────────────────────────────────────────────
const presentGuidedBody = ag.match(/const presentGuided = async[\s\S]*?\n  \};/)?.[0] ?? '';
check('presentGuided body located (extraction must fail loudly, never silently pass)', presentGuidedBody.length > 0);

const capCount = presentGuidedBody.match(/const askedThisRound = steps\.filter\(([\s\S]*?)\)\.length;/);
check('the round counts ADVANCED steps out of the step RECORD (`const askedThisRound = steps.filter(...).length`)',
  !!capCount,
  'src/app/agent.tsx / presentGuided: the cap must count the round\'s own recorded steps, nothing else');
check('SCOPE steps (property_group / property_type) do NOT count toward the round size',
  !!capCount && /!isScopeQuestionId\(st\.question\.id\)/.test(capCount[1]),
  'a 2-tier hierarchy would eat half the round; scope steps EARN the right to ask, they do not spend it');
check('only ANSWERED steps count — `st.keys != null` excludes the step currently on screen (keys: null), so a 4-question round asks 4, not 3',
  !!capCount && /st\.keys != null/.test(capCount[1]),
  'dropping this makes the pending card count itself and the round ends one question early');

const capGuard = presentGuidedBody.match(/if \(askedThisRound >= AF_ROUND_MAX_QUESTIONS\) \{([^}]*)\}/);
check('the cap fires at `askedThisRound >= AF_ROUND_MAX_QUESTIONS` — the NAMED constant, `>=` not `>`',
  !!capGuard,
  '`>` asks one question too many; a numeric literal forks the threshold away from its single source of truth in src/lib/afRanking.ts');
check('no magic number: agent.tsx never compares askedThisRound to a literal',
  !/askedThisRound\s*[<>]=?\s*\d/.test(ag),
  'the round size lives in src/lib/afRanking.ts so a barrier can execute it — a literal here is invisible to that');
// UPDATED 2026-08-25 (review). The property that matters is ONE EXIT — the cap may not fork into a
// second terminator. Counting every mention of the constant was a proxy for that, and it was too
// strict: the progress bar must ALSO bound its denominator by the round's remaining budget, or a
// round of 4 drawn against a pool of 7 fills the bar to 4/7 and ends at ~57%, reading as "the
// interview quit early". So: exactly one GUARD (the terminator), and any other mention must be a
// Math.min bound inside the progress denominator — never a second `if`.
check('the round cap has exactly ONE guard in presentGuided (one source of truth, one exit)',
  (presentGuidedBody.match(/if \([^)]*AF_ROUND_MAX_QUESTIONS/g) ?? []).length === 1,
  `found ${(presentGuidedBody.match(/if \([^)]*AF_ROUND_MAX_QUESTIONS/g) ?? []).length} guards`);
check('any non-guard use of the cap is the progress denominator, bounded by what THIS round may ask',
  (presentGuidedBody.match(/AF_ROUND_MAX_QUESTIONS/g) ?? []).length === 1
  || /progressTotal: stepIndex \+ Math\.min\(plan\.length, AF_ROUND_MAX_QUESTIONS - askedThisRound\)/.test(presentGuidedBody),
  'a mention of the cap outside the guard and outside the progress bound is a second threshold');

// ── 6. HOW THE ROUND ENDS: the SAME terminator as every other exit ───────────────────────────────
// finishGuided runs the narrowed search and hands the user results. Ending any other way would either
// strand the round, bounce the user into the legacy startRefine chips (which ask Normal-tier
// district/budget/bedrooms — banned by the Normal-vs-Advanced boundary), or auto-open the next round
// (banned outright, owner 2026-08-19: the next round is ALWAYS a manual tap).
check('a capped round ends through finishGuided(token) and returns — never startRefine, never a fresh setAgeFlow',
  !!capGuard && /finishGuided\(token\); return;/.test(capGuard[1]) && !/startRefine|setAgeFlow/.test(capGuard[1]),
  'the legacy chips would ask Normal-tier questions the interview must never ask; re-opening would violate the no-auto-popup rule');

// ── 7. PLACEMENT — three orderings, each protecting a different behaviour ────────────────────────
const capIdx = presentGuidedBody.search(/if \(askedThisRound >= AF_ROUND_MAX_QUESTIONS\)/);
const replayIdx = presentGuidedBody.indexOf('if (stepIndex < steps.length) {');
const scopeIdx = presentGuidedBody.indexOf('if (tier && scopeQ) {');
const rerankIdx = presentGuidedBody.indexOf('const ranked = await rankQuestions(');
const askIdx = presentGuidedBody.indexOf('const { question, options, unknownCount, total } = plan[0];');

check('the cap sits AFTER the replay branch — «رجوع» into a full round re-shows the recorded step instead of terminating the round',
  capIdx > 0 && replayIdx > 0 && replayIdx < capIdx,
  'placed first, the cap would fire on the way back and the user could never revisit their 4th answer');
check('the cap sits AFTER the scope-hierarchy branch — a scope question is never blocked by a spent advanced budget',
  capIdx > 0 && scopeIdx > 0 && scopeIdx < capIdx,
  'the scope branch returns on its own; the cap must be unreachable while a tier is still unresolved');
check('the cap sits BEFORE the contextual re-rank — a capped round spends no RPC re-ranking a pool it will not ask from',
  capIdx > 0 && rerankIdx > 0 && capIdx < rerankIdx);
check('the cap sits BEFORE the question is presented — a capped round never renders a 5th card',
  capIdx > 0 && askIdx > 0 && capIdx < askIdx);

console.log(failures === 0
  ? `\n✓ AF round size intact: ≤${AF_ROUND_MAX_QUESTIONS} ADVANCED questions per round, scope steps free, count-cap not quality-filter, one placement, clean finish\n`
  : `\n✗ ${failures} check(s) FAILED — the AF round size rule is broken\n`);
process.exit(failures === 0 ? 0 : 1);
