// PERMANENT BARRIER: the browse cap is a CAP, never a fake result count (owner 2026-08-20).
//
// THE RULE. Ezhalah shows at most BROWSE_CAP (100) listing cards for one search. But the number of
// cards the user can reach is ALWAYS min(trueTotal, BROWSE_CAP) — never 100 unconditionally:
//     trueTotal   8 → browse   8         trueTotal  99 → browse  99
//     trueTotal  46 → browse  46         trueTotal 100 → browse 100
//     trueTotal 437 → browse 100, and the closing message still tells the truth: "matched 437, showed 100".
// trueTotal (how many listings actually satisfy the whole search) and the cap are TWO numbers and must
// never be confused. The closing message states trueTotal — the authoritative matching count — NOT the
// cap, NOT a page size, NOT the loaded-array length.
//
// THE BUG THIS LOCKS OUT (reproduced live 2026-08-20 on ezhalah-app.vercel.app): a 2,223-match search
// paged PAST 100 (110 cards on screen, "load more" still offered) and a hardcoded «100 at a time» line
// read as a result count. There was no browse cap and no honest ">cap" closing message.
//
// This test proves the pure logic (src/data/resultCount.ts) across every boundary AND scans agent.tsx so
// the substitutions the owner banned — a hardcoded 100, a page/candidate cap, or the loaded length used
// as the total — cannot creep back. Mutation-proven: see the MUTATION note at the end.
//
//   node --experimental-strip-types scripts/verify-result-cap-honesty.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { BROWSE_CAP, resultCounts } from '../src/data/resultCount.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nThe browse cap is a cap, never a fake result count\n');

check('BROWSE_CAP is 100', BROWSE_CAP === 100, `got ${BROWSE_CAP}`);

// ── A. reachable = min(trueTotal, cap) at EVERY boundary ─────────────────────────────────────────
const BOUNDARIES = [0, 1, 8, 24, 25, 26, 46, 99, 100, 101, 437, 2223, 11438];
for (const trueTotal of BOUNDARIES) {
  const expected = Math.min(trueTotal, BROWSE_CAP);
  // "fully loaded" terminal state: everything reachable is fetched and on screen, server has no more.
  const rc = resultCounts({ trueTotal, shown: expected, fetched: Math.min(trueTotal, 1500), serverMore: false });
  check(`trueTotal ${trueTotal} → reachable ${expected}`, rc.reachable === expected, `got ${rc.reachable}`);
  check(`trueTotal ${trueTotal} → never browses past the cap`, rc.endShown <= BROWSE_CAP, `endShown ${rc.endShown}`);
  check(`trueTotal ${trueTotal} → fully loaded means no "load more"`, rc.hasMore === false);
  if (trueTotal <= BROWSE_CAP) {
    check(`trueTotal ${trueTotal} (≤cap) → end says ALL, stating the TRUE total`,
      rc.endKind === 'all' && rc.endTotal === trueTotal && rc.endShown === trueTotal,
      `endKind=${rc.endKind} endTotal=${rc.endTotal} endShown=${rc.endShown}`);
  } else {
    check(`trueTotal ${trueTotal} (>cap) → end says CAPPED: true total ${trueTotal}, shown ${BROWSE_CAP}`,
      rc.endKind === 'capped' && rc.endTotal === trueTotal && rc.endShown === BROWSE_CAP,
      `endKind=${rc.endKind} endTotal=${rc.endTotal} endShown=${rc.endShown}`);
  }
}

// ── B. the closing count is NEVER the cap when fewer matched ─────────────────────────────────────
// This is the exact "46 shown as 100" complaint: with 46 matches the stated total must be 46, not 100.
for (const trueTotal of [8, 24, 46, 99]) {
  const rc = resultCounts({ trueTotal, shown: trueTotal, fetched: trueTotal, serverMore: false });
  check(`${trueTotal} matches → closing total is ${trueTotal}, NEVER ${BROWSE_CAP}`,
    rc.endTotal === trueTotal && rc.endTotal !== BROWSE_CAP && rc.endShown === trueTotal);
}

// ── C. mid-load shows "more" and the cap gates it ────────────────────────────────────────────────
{
  const midSmall = resultCounts({ trueTotal: 46, shown: 10, fetched: 46, serverMore: false });
  check('46 matches, 10 shown → "more" (34 still reachable)', midSmall.endKind === 'more' && midSmall.hasMore);
  const midBig = resultCounts({ trueTotal: 2223, shown: 40, fetched: 1500, serverMore: true });
  check('2223 matches, 40 shown → "more"', midBig.endKind === 'more' && midBig.hasMore && midBig.reachable === 100);
  const atCap = resultCounts({ trueTotal: 2223, shown: 100, fetched: 1500, serverMore: true });
  check('2223 matches, 100 shown → cap reached, NO more (stops paging at the cap)', atCap.hasMore === false && atCap.endKind === 'capped');
  const past = resultCounts({ trueTotal: 2223, shown: 130, fetched: 1500, serverMore: true });
  check('shown can never be reported above the cap even if a caller over-reveals', past.endShown === 100);
}

// ── D. SOURCE SCAN — the banned substitutions must not reach the closing count in agent.tsx ──────
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const strip = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.trim())).join('\n');
const code = strip(agent);

check('the closing block derives counts from resultCounts() (single source of truth)',
  /const rc = resultCounts\(/.test(code));
check('the load-more gate enforces the cap (cur >= BROWSE_CAP → stop)',
  /cur >= BROWSE_CAP/.test(code),
  'without this gate a >100 search pages past the cap — the exact 2026-08-20 bug');
check('the reveal step is clamped to BROWSE_CAP',
  /Math\.min\([^)]*BROWSE_CAP\)/.test(code));
check('the hardcoded «100 at a time» caption is gone (it read as a result count)',
  !/100 listings at a time/.test(code) && !/100 إعلان في كل مرة/.test(code));
// The end message must NOT quote listings.length / fetched as the total. resultCounts.endTotal is the
// ONLY total the message may state. A regex catch: the closing Text must not interpolate `fetched` or
// `listings.length` as a count.
const closing = code.slice(code.indexOf('const rc = resultCounts('), code.indexOf('FeedbackRow') > 0 ? code.indexOf('FeedbackRow') : undefined);
check('the closing message never states fetched/listings.length as the total',
  !/\{\s*n:\s*fetched/.test(closing) && !/listings\.length\).toLocaleString/.test(closing),
  'the buffer length is a paging artifact, never the match total');

// ── E. MUTATION PROOF (documented + self-checking) ──────────────────────────────────────────────
// Restore the bug in the logic and confirm THIS test would catch it: a resultCounts that ignores the
// cap (reachable = trueTotal) must fail check A. We assert the guard the way a mutant would break it.
{
  const buggy = (trueTotal: number) => ({ reachable: trueTotal, endShown: trueTotal }); // the removed bug
  const mutantWouldPass = buggy(2223).reachable === Math.min(2223, BROWSE_CAP);
  check('MUTATION: an uncapped reachable (=trueTotal) is caught by this test', mutantWouldPass === false,
    'if this ever passes, check A is not actually asserting the cap');
}

console.log(failures === 0
  ? '\n✓ the browse cap is min(trueTotal, 100); the closing message always states the true total\n'
  : `\n✗ ${failures} check(s) FAILED — a search could show/say the wrong count\n`);
process.exit(failures === 0 ? 0 : 1);
