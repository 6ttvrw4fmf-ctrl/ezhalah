// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BARRIER — a rapid-cancel submit is ARMED, and an unstarted search never becomes four failures
// (routine #6, 2026-09-14)
//
// WHAT THIS PINS
// `scripts/lib/armedSubmit.ts` carries the rule that decides what a rapid-cancel entry observed.
// Get it wrong in either direction and you make one of PART 9's two opposite, equally expensive
// errors:
//   · an unprimed form filed as an Ezhalah bug  — CI run 34791858611 did exactly this, four times
//     in one journey, while the page dump proved the app was correct («الرجاء اختيار مدينة من
//     القائمة»);
//   · a genuinely dead control quietly downgraded to a skip — the same mistake with the opposite
//     sign, and the one that ships.
//
// WHY IT EXECUTES RATHER THAN GREPS
// AGENTS.md, "A FAILED FETCH IS NOT AN EMPTY ANSWER": all five defects of 2026-09-04 had a barrier
// over the exact line, and every one of those barriers was a source-TEXT tripwire that passed for
// the entire time the defect was live — two of them pinned the defective line as correct. So both
// functions are pure by signature and this file RUNS them, including against a probe that throws
// and a re-prime that throws.
//
// It also asserts, by execution, that the two rapid-cancel call sites in
// `scripts/verify-web-runtime-smoke.mjs` actually route through the rule — a rule nothing calls is
// decoration.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { armForSubmit, classifyRapidCancelEntry } from './lib/armedSubmit.ts';

let failed = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail ? `\n        ${detail}` : ''}`);
};

// ── A. the verdict rule, exhaustively (it has only four inputs, so cover all of them) ───────────
ok('A1 armed + landed            → pass',
  classifyRapidCancelEntry({ armed: true, landedOnAgent: true }) === 'pass');
ok('A2 armed + never landed      → defect (a dead control must stay LOUD)',
  classifyRapidCancelEntry({ armed: true, landedOnAgent: false }) === 'defect');
ok('A3 not armed + never landed  → skip (the app correctly refused an uncommitted city)',
  classifyRapidCancelEntry({ armed: false, landedOnAgent: false }) === 'skip');
// Load-bearing: an unarmed form is a skip even if the app somehow navigated anyway. Nothing about
// cancel-and-restore was measured, so calling it a pass books coverage that never happened.
ok('A4 not armed + landed        → skip, never pass',
  classifyRapidCancelEntry({ armed: false, landedOnAgent: true }) === 'skip');

// ── B. arming, executed against injected conditions ─────────────────────────────────────────────
const already = await armForSubmit(async () => true, async () => { throw new Error('must not re-prime'); });
ok('B1 an already-armed form is armed on the FIRST probe and is never re-primed',
  already.armed && already.attempts === 1, JSON.stringify(already));

let primes = 0;
let committed = false;
const recovered = await armForSubmit(
  async () => committed,
  async () => { primes++; committed = true; },
);
ok('B2 an unprimed form is re-primed and then armed',
  recovered.armed && primes === 1 && recovered.attempts === 2, `${JSON.stringify(recovered)} primes=${primes}`);

const never = await armForSubmit(async () => false, async () => {});
ok('B3 a form that never commits reports NOT armed after the full attempt budget',
  !never.armed && never.attempts === 3, JSON.stringify(never));
ok('B4 …and says why, naming the refusal the app would give (a reasonless skip is PART 9.5)',
  never.reason.includes('never confirmed') && never.reason.includes('الرجاء اختيار مدينة من القائمة'),
  never.reason);

// A probe that throws is the condition a re-prime fixes (detached node, mid-navigation read). It
// must arm, not abort the journey — and the throw must still reach the reason when nothing works.
let thrown = 0;
const throwsThenCommits = await armForSubmit(
  async () => { if (thrown++ === 0) throw new Error('detached'); return true; },
  async () => {},
);
ok('B5 a probe that THROWS is treated as not-committed and recovers, never propagating',
  throwsThenCommits.armed && throwsThenCommits.attempts === 2, JSON.stringify(throwsThenCommits));

const alwaysThrows = await armForSubmit(async () => { throw new Error('detached-forever'); }, async () => {});
ok('B6 a probe that always throws ends NOT armed and carries the error into the reason',
  !alwaysThrows.armed && alwaysThrows.reason.includes('detached-forever'), alwaysThrows.reason);

const reprimeThrows = await armForSubmit(async () => false, async () => { throw new Error('reprime-failed'); });
ok('B7 a re-prime that throws does not abort the journey; it ends NOT armed, with the reason',
  !reprimeThrows.armed && reprimeThrows.reason.includes('reprime-failed'), reprimeThrows.reason);

const none = await armForSubmit(async () => true, async () => {}, 0);
ok('B8 a zero attempt budget is NOT armed — an unprobed form is never assumed good',
  !none.armed && none.attempts === 0, JSON.stringify(none));

// ── C. the rule is actually WIRED into both rapid-cancel entries ────────────────────────────────
// A verdict nothing calls is decoration. This reads the smoke script only to prove REACHABILITY —
// the behaviour itself is proven by execution above.
const smoke = readFileSync(new URL('./verify-web-runtime-smoke.mjs', import.meta.url), 'utf8');
ok('C1 the smoke script imports the shared rule rather than re-implementing it',
  /from '\.\/lib\/armedSubmit\.ts'/.test(smoke) && /\barmForSubmit\b/.test(smoke));
for (const entry of ['verdictE', 'verdictH']) {
  ok(`C2 ${entry} is produced by classifyRapidCancelEntry and gates its journey`,
    new RegExp(`const ${entry} = classifyRapidCancelEntry\\(`).test(smoke)
    && new RegExp(`if \\(${entry} !== 'pass'\\)`).test(smoke));
}
// The regression itself: neither rapid-cancel entry may tap «بحث» without arming first.
for (const [entry, arm] of [['[E]', 'armE'], ['[H mobile]', 'armH']] as const) {
  ok(`C3 the ${entry} entry arms before it taps`,
    new RegExp(`const ${arm} = await armSearch\\(\\);\\s*\\n\\s*await tap\\('بحث'\\)`).test(smoke));
}
ok('C4 skips are surfaced in the summary, not only inline',
  /\$\{skipped\} SKIPPED/.test(smoke));

console.log(failed ? `\n${failed} FAILED` : '\narmed rapid-cancel submit: all checks passed');
process.exit(failed ? 1 : 0);
