// ADVANCED FILTER "2+ USEFUL QUESTIONS TO OPEN" GATE (owner brief, 2026-08-22) — Advanced Filter must
// never open for a cohort with 0 or 1 "useful" question (one that passes scoreQuestion() — real
// narrowing power over the CURRENT eligible set — not merely structurally eligible via cohortAllows/
// isAgeFilterScope). Opening on exactly one useful question means the user answers or skips it and the
// interview still closes on whatever the >25 result-count gate alone left large — a tax on the user's
// attention, not a niche shortlist. This is a SECOND, independent condition that composes with the
// existing INTERVIEW_STOP_AT/MIN_TOTAL_TO_SHOW result-count gate — both must hold, neither replaces
// the other. It governs the OPENING decision only: once open, the interview still keeps asking down to
// the very last useful question (unchanged continuation loop, proved absent from this gate below).
//
// EXECUTION NOTE: advancedFilters.ts (scoreQuestion's home) is not standalone-importable by a plain
// Node runner — like every other AF barrier in this repo that touches it (verify-advanced-filter-
// contract.ts, verify-advanced-filter-count-honesty.ts, verify-ui-controls-have-predicates.ts), it
// pulls in `./search` → `./remote` → the Supabase/Expo runtime chain, unlike the ONE module (afCohorts.ts)
// that was deliberately extracted pure specifically so cohortAllows() could be executed directly. Adding
// a second such extraction is out of scope for this rule change, so — matching this repo's own
// convention for this exact file — the assertions below are precise source-text checks on the shipped
// code (comments stripped so prose can never satisfy them), each proving the presence/absence of one
// exact shape a mutation would change, plus a live production/RPC proof (see PROGRESS.md for the
// browser + RPC verification log) that the real scoring math this gate counts on is exercised for real.
//
//   node --experimental-strip-types scripts/verify-af-min-useful-questions-gate.ts   (wired into `npm test`)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAdvanced Filter "2+ useful questions to open" gate\n');

const adv = codeOnly(read('src/data/advancedFilters.ts'));

// ── The threshold itself is exactly 2 (owner-specified, not 0/1/3) ─────────────────────────────────
check('MIN_USEFUL_QUESTIONS_TO_SHOW is declared, exported, and exactly 2 (owner: 0/1 hide AF, 2+ may show it)',
  /export const MIN_USEFUL_QUESTIONS_TO_SHOW = 2;/.test(adv));

// ── "Useful" is defined ONCE, by scoreQuestion, and this gate counts exactly ITS output ────────────
// rankQuestions() (unchanged by this fix) already filters the pool to questions where scoreQuestion
// returns non-null — that IS "useful" (real narrowing power: N>=MIN_TOTAL_TO_SHOW, an option in
// [max(15,8%N), 90%N], at least one option narrowing to <=75%N — see scoreQuestion's own body,
// unmodified by this change). agent.tsx's plan is built directly from rankQuestions' return value with
// no re-filtering that could silently redefine "useful" a second, disagreeing way.
check('scoreQuestion remains the sole "useful" gate — rankQuestions pushes a question onto `ranked` only when scoreQuestion(...) is non-null',
  /const scored = scoreQuestion\(question, probes\[i\]\);\s*if \(scored\) ranked\.push/.test(adv));
// scoreQuestion's OWN body (the N < MIN_TOTAL_TO_SHOW check) lives in src/data/advancedFilters.ts
// directly, OR — after PR #914's pure-module extraction (src/lib/afRanking.ts, 2026-08-22) — in
// afRanking.ts, with advancedFilters.ts keeping a thin same-signature wrapper. Either shape is
// correct; what must never happen is the check disappearing from BOTH.
const afRankingPath = join(root, 'src/lib/afRanking.ts');
const afRankingSrc = existsSync(afRankingPath) ? codeOnly(readFileSync(afRankingPath, 'utf8')) : '';
check('scoreQuestion itself is unmodified by this change: N < MIN_TOTAL_TO_SHOW still returns null (the existing, separate result-count gate)',
  /if \(N < MIN_TOTAL_TO_SHOW\) return null;/.test(adv) || /if \(N < MIN_TOTAL_TO_SHOW\) return null;/.test(afRankingSrc));

// ── agent.tsx WIRING — source-text (agent.tsx cannot be imported by a plain Node runner) ───────────
const ag = codeOnly(read('src/app/agent.tsx'));

check('agent.tsx imports MIN_USEFUL_QUESTIONS_TO_SHOW from @/data/advancedFilters',
  /import\s*\{[^}]*\bMIN_USEFUL_QUESTIONS_TO_SHOW\b[^}]*\}\s*from\s*'@\/data\/advancedFilters'/.test(ag));

check("startAgeFlow's opening guard reads `ageFlowPlanRef.current.length < MIN_USEFUL_QUESTIONS_TO_SHOW` (not just an empty-plan check)",
  /if\s*\(ageFlowPlanRef\.current\.length\s*<\s*MIN_USEFUL_QUESTIONS_TO_SHOW\)\s*\{\s*setAgeFlow\(null\);\s*if\s*\(fallbackToRefine\)\s*startRefine\(q\);\s*return;\s*\}/.test(ag),
  'this exact shape is the fix: 0 OR 1 useful question must take the same silent-close/fallback-to-refine path an empty plan already used');

check('the OLD 0-only guard (`if (!ageFlowPlanRef.current.length)`) is gone — regression to the pre-fix 1-question-opens-AF bug',
  !/if\s*\(!ageFlowPlanRef\.current\.length\)/.test(ag));

check('the new gate sits BEFORE presentGuided(0, token) is ever called — a <2 plan never reaches the asking phase',
  (() => {
    const gateIdx = ag.search(/if\s*\(ageFlowPlanRef\.current\.length\s*<\s*MIN_USEFUL_QUESTIONS_TO_SHOW\)/);
    const presentIdx = ag.indexOf('void presentGuided(0, token);');
    return gateIdx !== -1 && presentIdx !== -1 && gateIdx < presentIdx;
  })());

// ── The continuation loop is UNTOUCHED — presentGuided must keep asking down to the LAST useful
// question (owner §2/§6), never re-apply the >=2 threshold after the interview has already opened.
const presentGuidedBody = ag.match(/const presentGuided = async[\s\S]*?\n  \};/)?.[0] ?? '';
check('presentGuided (the re-rank-after-every-answer continuation loop) contains no reference to MIN_USEFUL_QUESTIONS_TO_SHOW',
  presentGuidedBody.length > 0 && !presentGuidedBody.includes('MIN_USEFUL_QUESTIONS_TO_SHOW'),
  'the >=2 gate must apply ONLY at the opening decision in startAgeFlow — presentGuided already stops correctly at plan.length===0 (finishGuided), and must keep asking at exactly 1 remaining useful question');
check('presentGuided still finishes (finishGuided) only when its own re-ranked plan is truly empty, not on any count threshold',
  /if\s*\(plan\.length\)\s*\{[\s\S]{0,400}?return;\s*\}\s*finishGuided\(token\);/.test(presentGuidedBody));

// ── SKIP vs CONFIRM-WITH-EMPTY parity (brief's named suspicion — traced, found NOT diverging;
// locked here so a future edit can't quietly split them). Both must, and only, (1) mark the question
// asked and (2) advance to the next planIndex — CONFIRM must gate every OTHER effect (apply/
// ageFlowChangedRef/facets) behind `keys.length`, so an empty confirm has zero side effects beyond
// those two, identical to Skip.
const onAgeConfirmBody = ag.match(/const onAgeConfirm = \(keys: string\[\]\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
const onAgeSkipLine = ag.match(/const onAgeSkip = \(\) => \{[^\n]*\};/)?.[0] ?? '';

check('onAgeConfirm gates apply()/ageFlowChangedRef/facets behind `if (keys.length)` — an empty confirm applies NO predicate',
  /if\s*\(keys\.length\)\s*\{\s*ageFlowQueryRef\.current = question\.apply\(q, keys\);\s*ageFlowChangedRef\.current = true;/.test(onAgeConfirmBody));
check('onAgeConfirm marks the question asked and advances UNCONDITIONALLY (outside the keys.length guard) — same as Skip',
  (() => {
    const guardEnd = onAgeConfirmBody.indexOf('ageFlowAskedRef.current.add(question.id);');
    const guardBlockEnd = onAgeConfirmBody.lastIndexOf('}', guardEnd); // the closing brace of `if (keys.length) {...}`
    return guardEnd !== -1 && guardBlockEnd !== -1 && guardEnd > guardBlockEnd; // add() runs AFTER the guard closes, so unconditionally
  })());
check('onAgeSkip does exactly the two unconditional steps (mark asked, advance) and nothing else — no apply/changed/facets call',
  /ageFlowAskedRef\.current\.add\(ageFlow\.question\.id\);\s*void presentGuided\(ageFlow\.planIndex \+ 1, ageFlowTokenRef\.current\);/.test(onAgeSkipLine)
  && !/question\.apply|ageFlowChangedRef\.current = true|ageFlowFacetsRef/.test(onAgeSkipLine));

console.log(failures === 0
  ? '\n✓ AF 2+ useful-questions gate intact: correct threshold, correct wiring, continuation loop untouched, Skip = confirm-empty\n'
  : `\n✗ ${failures} check(s) FAILED — the AF 2+ useful-questions gate is broken\n`);
process.exit(failures === 0 ? 0 : 1);
