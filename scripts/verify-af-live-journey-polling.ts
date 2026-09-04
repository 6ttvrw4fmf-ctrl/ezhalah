// A LIVE AF JOURNEY MAY NEVER READ AN AGENT-RENDERED STATE ONCE, AFTER A FIXED SLEEP.
//
// ── the bug class ────────────────────────────────────────────────────────────────────────────────
//
// Every Advanced Filter card in the live journeys is rendered behind a PAID LLM TURN whose latency
// is variable — measured near 40 s on a slow afternoon, and growing with the base scope. A journey
// that sleeps a fixed number of milliseconds and then reads the card ONCE is not testing production;
// it is sampling a race, and it loses that race against a production that is completely healthy.
//
// This class has now cost four separate false accusations against a correct Advanced Filter:
//
//   2026-08-24  the city-suggestion row rendered after a fixed wait      → "control not found"
//   2026-09-03  three journeys against a ~40 s agent turn                → "never rendered"
//   2026-09-04  verify-af-card-evidence-live.ts read af-option-* once,
//               2,500 ms after the card mounted, saw an empty list on a
//               healthy card and broke its round loop at step 0         → "no AF predicate was
//                                                                          committed — §12A could
//                                                                          not be exercised"
//   2026-09-04  verify-af-live-truth.ts clicked «رجوع» 1,200 ms after
//               «متابعة», without proving the round had advanced. Back
//               on question ONE is R8.2.2 — cancel the round, no card —
//               a different rule from the R8.2.1 the journey asserts    → "Back restores the
//                                                                          previous question:
//                                                                          got=null", while a
//                                                                          hand-driven browser on
//                                                                          the same bundle restored
//                                                                          the question, its 2,415
//                                                                          count and all 12 options
//                                                                          in 2.5 s
//
// Each was fixed by widening a number. Widening a number fixes the example; the class survives, and
// it always comes back on the next slow turn or the next larger scope — which is precisely the
// "fix the example, not the class" failure AGENTS.md forbids.
//
// ── what this pins, and why it is structural rather than behavioural ─────────────────────────────
//
// A race cannot be mutation-proven by running it: on a fast afternoon the broken version passes.
// So the invariant is enforced where it is deterministic — in the source. A journey must POLL for
// the state it is about to act on, and must PROVE the precondition of the rule it asserts. Both are
// checkable statically, and both are mutation-proven below against in-memory copies of the real
// files, so a future edit that reverts to sleep-then-read fails CI instead of failing at 09:00 UTC
// against a production that is fine.
//
// This barrier makes no network call and drives no browser — it reads the two journey files.
//
//   node --experimental-strip-types scripts/verify-af-live-journey-polling.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => stripComments(readFileSync(join(ROOT, 'scripts', f), 'utf8'));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\nLive AF journeys must poll for agent-rendered state, never sleep-then-read\n');

// ── the two rules, expressed over source text ────────────────────────────────────────────────────

/** The card-evidence journey must read af-option-* through ONE bounded polling helper, and nowhere else. */
function cardEvidenceProblems(src: string): string[] {
  const p: string[] = [];
  const reads = src.match(/querySelectorAll\('\[data-testid\^="af-option-"\]'\)/g) ?? [];
  if (reads.length !== 1) {
    p.push(`af-option-* is read ${reads.length} time(s); it must be read in exactly ONE place — the polling helper`);
  }
  const helper = src.match(/const optionsWhenRendered[\s\S]*?\n {2}\};/)?.[0] ?? '';
  if (!helper) p.push('no optionsWhenRendered polling helper found');
  else {
    if (!/for \(;;\)|while \(/.test(helper)) p.push('optionsWhenRendered does not loop — it is a single read wearing a helper name');
    if (!/querySelectorAll\('\[data-testid\^="af-option-"\]'\)/.test(helper)) p.push('optionsWhenRendered does not read af-option-* — the read escaped the helper');
    if (!/af-card/.test(helper)) p.push('optionsWhenRendered never checks whether the card is GONE — it would burn the whole budget on a round that legitimately ended');
    if (!/Date\.now\(\) >= until|Date\.now\(\) < until/.test(helper)) p.push('optionsWhenRendered has no finite budget — a hung card would hang the job instead of failing it');
  }
  // The round loop must call the helper, not re-read the DOM itself.
  if (!/const opts = await optionsWhenRendered\(\)/.test(src)) p.push('the round loop does not read its options through optionsWhenRendered()');
  return p;
}

/** The Back journey must PROVE the round advanced to a second question before clicking «رجوع». */
function liveTruthProblems(src: string): string[] {
  const p: string[] = [];
  const branch = src.match(/if \(backAndChange\) \{[\s\S]*?\n {4}\}/)?.[0] ?? '';
  if (!branch) return ['no backAndChange branch found'];
  const backClick = branch.indexOf(`page.click('[data-testid="af-back"]')`);
  if (backClick < 0) return ['the backAndChange branch never clicks af-back'];
  const before = branch.slice(0, backClick);
  // R8.2.1 vs R8.2.2 are told apart ONLY by the step the card is on, so the advance must be proven.
  if (!/readCardUntil\(/.test(before)) {
    p.push('«رجوع» is clicked without polling first — the branch cannot know whether it is exercising R8.2.1 (step back) or R8.2.2 (cancel the round)');
  } else if (!/s\.q !== st\.q/.test(before)) {
    p.push('the poll before «رجوع» does not require the question to have CHANGED, so it can be satisfied while the round is still on question 1');
  }
  if (!/unexercised\(/.test(branch)) {
    p.push('a round that never reaches a second question is not reported as NOT EXERCISED — absence of a test must never read as a pass');
  }
  return p;
}

/**
 * THE THIRD JOURNEY, AND THE HALF OF THE CLASS THE FIRST TWO RULES DO NOT COVER (2026-09-04).
 *
 * Polling is only half the fix. verify-af-option-card-truth-live.ts DID poll — and still reported
 * 47 product failures in CI against a correct production, because its poll helper returned the last
 * state it happened to see when the budget expired, and the callers asserted on it. One missed
 * Q1→Q2 transition became 45 option-level failures comparing Q1's pills to a Q2 oracle.
 *
 * So a journey must also FAIL CLOSED: the read must report whether the awaited state EVER arrived,
 * and a non-arrival must be classified against production's own load signal — a real red when
 * production was healthy, NOT EXERCISED when it was outside its own envelope. NOT EXERCISED still
 * fails that journey (its ledger counts skips against the exit code), so this can never be a route
 * to green; it only changes a wrong reason into the measured one.
 */
function optionCardProblems(src: string): string[] {
  const p: string[] = [];
  const helper = src.match(/const readCardSettled = [\s\S]*?;\n/)?.[0] ?? '';
  if (!helper) p.push('no readCardSettled read — the journey cannot know whether the state it acted on ever arrived');
  else if (!/settleUntil/.test(helper)) p.push('readCardSettled does not go through the shared settleUntil primitive');
  // Only the CARD reads await an agent turn; waitForHeadline is a render wait and keeps its own budget.
  for (const fn of ['readCardSettled', 'readCardUntil']) {
    const decl = src.match(new RegExp(`const ${fn} = [^\\n]*`))?.[0] ?? '';
    if (!decl) p.push(`${fn} is gone`);
    else if (!/timeoutMs = AGENT_TURN_MS/.test(decl)) {
      p.push(`${fn} does not default to a full agent turn — its budget is sized for a render, not for the LLM round trip it actually awaits (${decl.trim().slice(0, 90)})`);
    }
  }

  // Every site whose non-arrival used to fabricate a failure must now be settled-checked.
  for (const [needle, why] of [
    ['if (!cr.settled)', 'the first card read no longer abandons on a card that never rendered — the chip assertion would fire against chip=null again'],
    ['if (!nx.settled)', 'the Q1→Q2 advance no longer abandons on a card that never advanced — the 45-failure shape is back'],
    ['roundCardNeverArrived', 'the round walk no longer distinguishes "the card never rendered" from "the round refused to walk"'],
  ] as const) {
    if (!src.includes(needle)) p.push(why);
  }

  // A non-arrival must be CLASSIFIED, not just swallowed, and the classifier must consult production.
  const unobs = src.match(/const unobserved = async[\s\S]*?\n\};/)?.[0] ?? '';
  if (!unobs) p.push('no unobserved() classifier — a non-arrival has no defined verdict');
  else {
    if (!/verdictForNonArrival/.test(unobs)) p.push('unobserved() does not consult production load — it decides red-vs-inconclusive on its own opinion');
    if (!/check\(label, false/.test(unobs)) p.push('unobserved() never reports a real FAILURE — a healthy production that hangs would read as inconclusive forever');
    if (!/skip\(/.test(unobs)) p.push('unobserved() never reports NOT EXERCISED — it cannot tell a slow product from a busy one');
  }
  return p;
}

/**
 * The remove-last-pill journey carried the IDENTICAL fail-open read (a 12s budget and `return last`)
 * and failed in CI on 2026-09-04 in the same run, from the same cause: its first-card read and its
 * re-open read both assert the card's own chip against N0, so a card that never finished rendering
 * printed `chip=null` as a product failure.
 *
 * Its ledger differs in one way that matters: `skip()` there does NOT count against the exit code,
 * so a NOT EXERCISED routed through `skip` would have been a route to GREEN. It therefore counts
 * `undecided` separately, and that counter MUST reach the exit code.
 */
function removeLastPillProblems(src: string): string[] {
  const p: string[] = [];
  if (!/const readCardSettled = /.test(src)) p.push('no readCardSettled read — the journey cannot know whether the card it asserted on ever arrived');
  if (!/settleUntil/.test(src)) p.push('the settled read does not go through the shared settleUntil primitive');
  for (const fn of ['readCardSettled', 'readCardUntil']) {
    const decl = src.match(new RegExp(`const ${fn} = [^\\n]*`))?.[0] ?? '';
    if (!decl) p.push(`${fn} is gone`);
    else if (!/timeoutMs = AGENT_TURN_MS/.test(decl)) p.push(`${fn} does not default to a full agent turn — its budget is sized for a render`);
  }
  if (!/if \(!fr\.settled\)/.test(src)) p.push('the first-card read no longer abandons on a card that never rendered — chip=null would be reported against N0 again');
  if (!/if \(!ag\.settled\)/.test(src)) p.push('the re-open read no longer abandons on a card that never rendered');
  // THE ONE THAT WOULD SILENTLY GO GREEN: undecided must reach the exit code.
  if (!/process\.exit\(failures \+ undecided \? 1 : 0\)/.test(src)) {
    p.push('NOT EXERCISED does not reach the exit code — a journey that observed nothing would report success');
  }
  const unobs = src.match(/const unobserved = async[\s\S]*?\n\};/)?.[0] ?? '';
  if (!unobs) p.push('no unobserved() classifier');
  else {
    if (!/verdictForNonArrival/.test(unobs)) p.push('unobserved() does not consult production load — it decides red-vs-inconclusive on its own opinion');
    if (!/check\(label, false/.test(unobs)) p.push('unobserved() never reports a real FAILURE');
    if (!/undecided\+\+/.test(unobs)) p.push('unobserved() does not COUNT the non-arrival, so it cannot reach the exit code');
  }
  return p;
}

// ── the real files must be clean ─────────────────────────────────────────────────────────────────
const CE = read('verify-af-card-evidence-live.ts');
const LT = read('verify-af-live-truth.ts');
const OC = read('verify-af-option-card-truth-live.ts');
const RL = read('verify-af-remove-last-pill-live.ts');

{
  const p = cardEvidenceProblems(CE);
  check('verify-af-card-evidence-live.ts polls for its options through one bounded helper', p.length === 0, p.join(' | '));
}
{
  const p = liveTruthProblems(LT);
  check('verify-af-live-truth.ts proves the round advanced before clicking «رجوع»', p.length === 0, p.join(' | '));
}
{
  const p = optionCardProblems(OC);
  check('verify-af-option-card-truth-live.ts fails CLOSED on a state that never arrived', p.length === 0, p.join(' | '));
}
{
  const p = removeLastPillProblems(RL);
  check('verify-af-remove-last-pill-live.ts fails CLOSED, and NOT EXERCISED reaches its exit code', p.length === 0, p.join(' | '));
}

// ── mutation proofs — each reversion to the bug class must turn this barrier RED ──────────────────
const mustReject = (label: string, problems: string[], needle: string) =>
  check(`MUTATION — ${label}`, problems.some((x) => x.includes(needle)),
    problems.length ? `problems: ${problems.join(' | ')}` : 'the barrier reported no problem at all');

mustReject('the round loop reads af-option-* directly again (the 2026-09-04 shape)',
  cardEvidenceProblems(CE.replace(
    'const opts = await optionsWhenRendered();',
    `const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="af-option-"]')].map((e) => e.getAttribute('data-testid') || ''));`)),
  'read 2 time(s)');

mustReject('the polling helper stops looping (a single read wearing a helper name)',
  cardEvidenceProblems(CE.replace('for (;;) {', 'if (true) {')), 'does not loop');

mustReject('the polling helper loses its card-gone early return',
  cardEvidenceProblems(CE.replace(`if (!(await page.$('[data-testid="af-card"]'))) return [];`, '')), 'card is GONE');

mustReject('the polling helper loses its finite budget',
  cardEvidenceProblems(CE.replace('if (Date.now() >= until) return [];', '')), 'no finite budget');

mustReject('«رجوع» is clicked straight after a fixed sleep again',
  liveTruthProblems(LT.replace(/const advanced = await readCardUntil\([\s\S]*?\n {6}\}\n/, '')),
  'without polling first');

mustReject('the advance poll stops requiring the question to have CHANGED',
  liveTruthProblems(LT.replace('s.hasCard && s.q != null && s.q !== st.q, AGENT_TURN_MS', 's.hasCard && s.q != null, AGENT_TURN_MS')),
  'does not require the question to have CHANGED');

mustReject('a round that never advances is silently skipped instead of reported NOT EXERCISED',
  liveTruthProblems(LT.replace(/unexercised\(/g, 'ignore(')), 'NOT EXERCISED');

// ── and the fail-closed half, on the journey that proved it was needed ────────────────────────────
mustReject('the settled read goes back to returning the last state it happened to see',
  optionCardProblems(OC.replace(/const readCardSettled = [\s\S]*?;\n/, '')), 'ever arrived');

mustReject('the agent-turn budget is replaced by the old render-sized 25s',
  optionCardProblems(OC.replace(/AGENT_TURN_MS/g, '25_000')), 'sized for a render');

mustReject('the Q1→Q2 advance stops abandoning on a card that never advanced (the 45-failure shape)',
  optionCardProblems(OC.replace('if (!nx.settled) {', 'if (false) {')), '45-failure shape is back');

mustReject('the first card read stops abandoning on a card that never rendered',
  optionCardProblems(OC.replace('if (!cr.settled) {', 'if (false) {')), 'chip=null');

mustReject('the round walk stops telling "never rendered" apart from "refused to walk"',
  optionCardProblems(OC.replace(/roundCardNeverArrived/g, 'roundClosed')), 'refused to walk');

mustReject('the non-arrival classifier stops consulting production and decides on its own',
  optionCardProblems(OC.replace('verdictForNonArrival(l) === \'red\'', 'false')), 'its own opinion');

mustReject('the classifier can no longer report a REAL failure (everything becomes inconclusive)',
  optionCardProblems(OC.replace(/check\(label, false[\s\S]*?\n {4}return;/, '    return;')), 'read as inconclusive forever');

// ── remove-last-pill: the same class, plus the exit-code trap its ledger made possible ────────────
mustReject('the remove-last-pill settled read is reverted to the 12s fail-open one',
  removeLastPillProblems(RL.replace(/const readCardSettled = [\s\S]*?;\n/, '')), 'ever arrived');

mustReject('NOT EXERCISED stops reaching the exit code (a journey that observed nothing reads GREEN)',
  removeLastPillProblems(RL.replace('process.exit(failures + undecided ? 1 : 0)', 'process.exit(failures ? 1 : 0)')),
  'would report success');

mustReject('the first-card read stops abandoning on a card that never rendered',
  removeLastPillProblems(RL.replace('if (!fr.settled) {', 'if (false) {')), 'chip=null');

mustReject('the re-open read stops abandoning on a card that never rendered',
  removeLastPillProblems(RL.replace('if (!ag.settled) {', 'if (false) {')), 're-open read no longer abandons');

mustReject('the remove-last-pill classifier stops counting the non-arrival',
  removeLastPillProblems(RL.replace('undecided++;', '')), 'cannot reach the exit code');

console.log(failures
  ? `\n✗ verify-af-live-journey-polling: ${failures} failure(s)\n`
  : '\n✓ live AF journeys poll for agent-rendered state, and prove the precondition of the rule they assert\n');
process.exit(failures ? 1 : 0);
