// ADVANCED FILTER — A ROUND THE CUSTOMER SKIPPED ENTIRELY IS STILL REMEMBERED (2026-10-06).
//
// Contract R6.2.2 / R8.1.3 / R13.7: a skipped question is never asked again. verify-af-cross-round-
// carry.ts proves that for a round that COMMITTED something (its skips ride the turn's guided record).
// It could not see the other shape: a round where every question was skipped commits nothing, so
// finishGuided returns early — no search, no new turn, no guided record — and the SAME turn keeps
// «خلّنا نحدد الطلب أكثر». Its carry was built from that turn's guided record alone, i.e. asked = [],
// so every new tap re-asked the same four questions.
//
// Found live by the AF customer journey (ksaaqar_residential_listings:12225740, Riyadh annual-rent
// apartment): rounds 1, 2 and 3 all asked rnpl / furnished / age / bathrooms; the amenities question
// (AC, elevator, kitchen, parking) was never reachable, because the 4-question round cap
// (AF_ROUND_MAX_QUESTIONS) was always filled by the same four.
//
// The wiring lives in src/app/agent.tsx (a React component this script cannot import), so the three
// links are pinned on CODE (comments stripped) and every pin is mutation-proven below:
//   1. the early-return branch of finishGuided records the round's asked set on the turn it came from;
//   2. the results-narrow tap unions that record into the carry's `asked`;
//   3. a New Chat forgets it (it belongs to the conversation being left).
//
//   node --experimental-strip-types scripts/verify-af-skip-only-round-is-remembered.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const SKIP_REF = 'afSkippedByMsgRef';

/** The problems with one source text; [] = the skip-only round is remembered. */
export function problems(rawSrc: string): string[] {
  const src = codeOnly(rawSrc);
  const out: string[] = [];

  // 1. finishGuided's "nothing changed" branch must record before it returns.
  const fg = src.indexOf('const finishGuided = (');
  const early = fg < 0 ? -1 : src.indexOf('if (!(q && ageFlowChangedRef.current))', fg);
  const branchEnd = early < 0 ? -1 : src.indexOf('return;', early);
  const branch = early < 0 || branchEnd < 0 ? '' : src.slice(early, branchEnd);
  if (!branch) out.push('finishGuided early-return branch (nothing committed) not found');
  else if (!new RegExp(`${SKIP_REF}\\.current\\[[^\\]]+\\]\\s*=\\s*\\[\\.\\.\\.ageFlowAskedRef\\.current\\]`).test(branch)) {
    out.push('finishGuided returns on a skip-only round without recording its asked set on the turn');
  }

  // 2. the results-narrow tap must union the record into the carry it seeds.
  const tap = src.indexOf('testID="results-narrow"');
  const press = tap < 0 ? '' : src.slice(tap, src.indexOf('startAgeFlow(', tap));
  if (!press) out.push('results-narrow onPress not found');
  else if (!new RegExp(`asked:[^\\n]*${SKIP_REF}\\.current\\[m\\.id\\]`).test(press)) {
    out.push("results-narrow seeds the carry's asked without the turn's skip-only rounds");
  }

  // 3. New Chat forgets it.
  const reset = src.indexOf('const resetConversationState = (');
  const resetBody = reset < 0 ? '' : src.slice(reset, reset + 1500);
  if (!new RegExp(`${SKIP_REF}\\.current\\s*=\\s*\\{\\}`).test(resetBody)) {
    out.push('resetConversationState does not clear the skip-only-round record');
  }
  return out;
}

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const real = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
const found = problems(real);
check('shipped agent.tsx remembers a skip-only round', found.length === 0, found.join(' | '));

// Mutation proofs: each broken wiring MUST be caught.
const mustCatch = (label: string, mutate: (s: string) => string) => {
  const m = mutate(real);
  if (m === real) { check(`mutant applies: ${label}`, false, 'mutation did not change the source'); return; }
  check(`catches: ${label}`, problems(m).length > 0);
};
mustCatch('the record line deleted from finishGuided', (s) =>
  s.replace(/if \(from\) afSkippedByMsgRef\.current\[from\] = \[\.\.\.ageFlowAskedRef\.current\];/, ''));
mustCatch('the tap seeds asked from the guided record only (the old code)', (s) =>
  s.replace(/asked: \[\.\.\.new Set\(\[\.\.\.\(carried\?\.asked \?\? \[\]\), \.\.\.\(afSkippedByMsgRef\.current\[m\.id\] \?\? \[\]\)\]\)\]/,
    'asked: carried?.asked ?? []'));
mustCatch('New Chat keeps the old conversation\'s skips', (s) =>
  s.replace(/afSkippedByMsgRef\.current = \{\};/, ''));
mustCatch('the record moved into a comment', (s) =>
  s.replace(/if \(from\) afSkippedByMsgRef/, '// if (from) afSkippedByMsgRef'));

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nverify-af-skip-only-round-is-remembered: OK');
