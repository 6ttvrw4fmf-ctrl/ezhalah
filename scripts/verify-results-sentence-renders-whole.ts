// HERMETIC half of the #347 barrier — the mutation proof, and the homing proof for the live half.
//
// ops_incident #347 (P1): after the second «عرض المزيد» press the Results-Found sentence froze one
// tick short of its end and STAYED there for 90s+, rendering a LONE HIGH SURROGATE — half an emoji,
// a ▯ box. It is also the root cause of #331 (the «عرض المزيد» headline reading 21,384 → null).
//
// THIS FILE EXECUTES THE REAL PREDICATE against the exact strings production was measured rendering
// on 2026-09-19 — it does not grep source. That distinction is the entire lesson of AGENTS.md's
// "A FAILED FETCH IS NOT AN EMPTY ANSWER" section: all five defects of 2026-09-04 had a barrier over
// the exact line, and every one of those barriers was a source-TEXT tripwire that passed for the
// whole time the defect was live — two of them literally pinned the defective line as correct.
//
// The live half (which drives a real browser at the real 500-card mount) imports the SAME
// `sentenceProblems`, so what is proven here is a statement about the code that actually decides
// production's verdict, not about a copy of it.

import { readFileSync, existsSync } from 'node:fs';
import { sentenceProblems, loneSurrogates } from './lib/resultsSentenceHealth.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import { loadRegistry } from './lib/testRegistry.ts';

const LIVE = 'verify-results-sentence-renders-whole-live.ts';
const ROOT = new URL('..', import.meta.url).pathname;

let failures = 0;
const check = (label: string, cond: boolean, extra = '') => {
  if (cond) { console.log(`  \u2713 ${label}`); } else { failures++; console.log(`  \u274c ${label}${extra ? ` \u2014 ${extra}` : ''}`); }
};

/**
 * AN EXECUTABLE MUTATION PROOF, in this repo's idiom: run the REAL predicate against a deliberately
 * broken input and require it to REJECT. `mustCatch` fails when the predicate stays silent, so a
 * predicate that was weakened into vacuity cannot keep this file green.
 */
const mustCatch = (label: string, problems: string[]) =>
  check(`MUTATION \u2014 ${label}`, problems.length > 0,
    'the predicate did NOT reject this broken input');

/** The mirror: a proof is only meaningful if the same predicate ACCEPTS healthy input. */
const mustPass = (label: string, problems: string[]) =>
  check(label, problems.length === 0, JSON.stringify(problems));

// The two renderings ops_incident #347 actually recorded off production, verbatim. `\ud83c` and
// `\ud83d` are the HIGH halves of 🎉/🔍-class emoji: the reveal committed the first code unit of the
// pair and never the second.
const BROKEN_347_A = 'لقينا لك 72,470 نتيجة تطابق بحثك \ud83c';
const BROKEN_347_B = 'لقينا 72,470 نتيجة تطابق اللي بحثت عنه \ud83d';
// What production renders today, measured 2026-09-20 across five runs at the 500-card mount.
const HEALTHY = [
  'لقينا 21,505 نتيجة تطابق اللي بحثت عنه 🔍',
  'لقينا لك 21,505 نتيجة تطابق بحثك 🎉',
  'بحثك رجّع لنا 21,505 نتيجة 🥳',
  'عندنا 21,505 نتيجة تطابق بحثك ⚡',
];

const reading = (over: Partial<Parameters<typeof sentenceProblems>[0]> = {}) => ({
  sentence: HEALTHY[0],
  earlier: HEALTHY[0],
  quoted: 21505,
  rpcTotal: 21505,
  numbersInSentence: [21505],
  evidence: '(not needed — a sentence matched)',
  ...over,
});

console.log('\n── loneSurrogates: a whole pair passes, a half pair is caught ──');
// The predicate must not "pass" by flagging everything — prove it ACCEPTS every healthy rendering
// production was actually measured serving, or the mutations below prove nothing.
for (const s of HEALTHY) {
  mustPass(`a well-formed emoji is NOT flagged: ${JSON.stringify(s.slice(-4))}`, loneSurrogates(s));
}
mustPass('a sentence with no emoji at all is clean', loneSurrogates('لقينا 21,505 نتيجة'));

mustCatch('1 — #347 rendering A, verbatim off production: "…تطابق بحثك \\ud83c"',
  loneSurrogates(BROKEN_347_A));
mustCatch('2 — #347 rendering B, verbatim off production: "…بحثت عنه \\ud83d"',
  loneSurrogates(BROKEN_347_B));
mustCatch('3 — an orphaned LOW surrogate (the other side of the same cut)',
  loneSurrogates('نتيجة \udf89'));

console.log('\n── sentenceProblems: the healthy reading is clean ──');
for (const s of HEALTHY) {
  mustPass(`clean verdict for ${JSON.stringify(s)}`, sentenceProblems(reading({ sentence: s, earlier: s })));
}
// The 500-cap terminal legitimately quotes 500 ALONGSIDE the true total — it must NOT fail.
mustPass('the 500-cap terminal wording is accepted (the true total is present)',
  sentenceProblems(reading({
    sentence: 'عرضت لك أول 500 من أصل 21,505 إعلان مطابق',
    earlier: 'عرضت لك أول 500 من أصل 21,505 إعلان مطابق',
    quoted: 500, numbersInSentence: [500, 21505],
  })));
// An honest zero has no RPC total to agree with; it must not be manufactured into a failure.
mustPass('a reading with no observed RPC total is not turned into a false failure',
  sentenceProblems(reading({ quoted: 0, rpcTotal: null, numbersInSentence: [0] })));

console.log('\n── sentenceProblems: every #347/#331 shape is caught ──');
// 4 — the literal #347 defect, end to end through the real verdict function.
const m4 = sentenceProblems(reading({ sentence: BROKEN_347_A, earlier: BROKEN_347_A }));
mustCatch('4 — a truncated-mid-emoji sentence fails the verdict', m4);
check('   …and the message names the ▯ box so a reader can act on it',
  m4.some((m) => m.includes('unpaired UTF-16 surrogate')), JSON.stringify(m4));

// 5 — #331's own shape: nothing on the page matches a shipped template.
const m5 = sentenceProblems(reading({ sentence: null, evidence: '"لقينا لك 72,470 نتيجة تطابق بحثك "' }));
mustCatch('5 — no whole template matched is a FAILURE, never a skip', m5);
check('   …and the failure quotes the nearest results-shaped text as evidence',
  m5.some((m) => m.includes('72,470')), JSON.stringify(m5));

// 6 — the freeze: two settled reads that disagree mean the reveal never committed.
const m6 = sentenceProblems(reading({ earlier: 'لقينا لك 21,505 نتيجة تطابق بحث', sentence: HEALTHY[1] }));
mustCatch('6 — a sentence still changing after the wire went quiet fails', m6);
check('   …and it is reported as the reveal never committing',
  m6.some((m) => m.includes('never')), JSON.stringify(m6));

// 7 — the count parser reads nothing (exactly what #331 observed).
mustCatch('7 — an unreadable count fails', sentenceProblems(reading({ quoted: null })));

// 8 — the sentence is whole but quotes a DIFFERENT number than the RPC served.
const m8 = sentenceProblems(reading({ quoted: 21384, numbersInSentence: [21384] }));
mustCatch('8 — a sentence that does not carry the true total fails', m8);
check('   …and names both numbers', m8.some((m) => m.includes('21384') && m.includes('21505')),
  JSON.stringify(m8));

console.log('\n── the LIVE half still runs somewhere (it is not in npm test by design) ──');
{
  const registry = loadRegistry(ROOT);
  const problems = liveHalfProblems(
    LIVE,
    registry,
    (bare) => existsSync(`${ROOT}scripts/${bare}`),
    (rel) => { try { return readFileSync(`${ROOT}${rel}`, 'utf8'); } catch { return null; } },
  );
  check('the live half exists, is declared in test-exclusions.txt, and its workflow INVOKES it',
    problems.length === 0, problems.join(' | '));
}

console.log(failures
  ? `\n❌ results-sentence-renders-whole: ${failures} failure(s)`
  : '\n✓ results-sentence-renders-whole: #347 and #331 are both caught by the shared predicate');
process.exit(failures ? 1 : 0);
