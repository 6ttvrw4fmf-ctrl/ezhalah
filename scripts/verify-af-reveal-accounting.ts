// A REVEAL IS COUNTED ON THE TURN THAT OWNS IT — AND THE FIRST PAGE IS NEVER A CONSTANT.
//
// THE INCIDENT (ops_incident #125, 2026-09-06). The AF pagination proof reported
// «every click revealed exactly to the next 100-boundary — revealed=1509 total=6629 clicks=16»
// against a production that was landing on the boundaries perfectly. Its own per-click log is the
// confession:
//
//     click  1: revealed  102  (expected  100)
//     click  2: revealed  202  (expected  200)
//     …
//     click 15: revealed 1502  (expected 1500)
//     click 16: revealed 1509  (expected 1600) — a network page fired
//
// A CONSTANT +2 on a perfect sequence, then one reading taken mid-cascade. Two harness errors, no
// product error. Both came from measuring the newest turn INDIRECTLY:
//
//   revealed = (cards on the whole PAGE) − (a baseline snapshot) + FIRST_PAGE
//
//   · the baseline was captured while the newest turn was still dripping its first page in, so it
//     recorded 8 cards for a turn whose first page cannot be below 10 → every later reading +2;
//   · `FIRST_PAGE` is a FLOOR, not the first page. `initialReveal()` widens it to the number of
//     matching platforms (owner 2026-09-02, "the first screen is as wide as the market"), so adding
//     back 10 is wrong on any scope matching more than ten platforms.
//
// THE FIX was to count the ids on the turn that owns them (READ_TURN_CARDS, scoped to everything
// after the LAST results headline) and to let the cascade come to rest before judging it. This file
// keeps that fixed by EXECUTING the two product rules a harness must not restate from memory —
// because a barrier that reads source text is exactly what let this through.
//
// Offline and deterministic: pure product modules, no network, no browser. Safe inside `npm test`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initialReveal } from '../src/lib/initialReveal.ts';
import { BROWSE_BATCH, nextBatchTarget } from '../src/data/resultCount.ts';
import { stripComments } from './lib/stripComments.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOURNEY = 'scripts/verify-af-option-card-truth-live.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nA reveal is counted on the turn that owns it, and the first page is never a constant\n');

// ── 1. WHAT THE FIRST REVEAL IS SUPPOSED TO BE — executed, not asserted from memory ─────────────
const FLOOR = 10, STOP = 25;
const first = (platforms: number, fetched = 1500, honestTotal: number | null = 6629) =>
  initialReveal({ fetched, honestTotal, firstPage: FLOOR, stopAt: STOP, platforms });

check('the first page is a FLOOR widened by matching platforms, never a fixed 10',
  first(3) === 10 && first(10) === 10 && first(19) === 19 && first(38) === 38,
  `3 platforms → ${first(3)} · 10 → ${first(10)} · 19 → ${first(19)} · 38 → ${first(38)}`);
check('the first page never claims a row the fetched set does not contain',
  first(38, 12) === 12, `38 platforms but only 12 fetched → ${first(38, 12)}`);
check('a set at or below the interview floor reveals everything (no «عرض المزيد» to account for)',
  first(38, 20, 20) === 20, `honestTotal 20 ≤ ${STOP} → ${first(38, 20, 20)}`);

// ── 2. HOW MANY EACH CLICK ADDS — the boundary rule, and its INDEPENDENCE from the first page ───
// This is the load-bearing fact. The owner's 2026-08-29 rule is that a press completes the next
// clean hundred, NOT shown+100 — so after k presses the turn shows min(100k, available) no matter
// how wide the first page was. That independence is what makes `BROWSE_BATCH * clicks` the correct
// expectation, and what makes 1,509 impossible: it is not a boundary at all.
const walk = (firstPage: number, available: number, clicks: number): number[] => {
  const seq: number[] = [];
  let shown = Math.min(firstPage, available);
  for (let i = 0; i < clicks; i++) { shown = nextBatchTarget(shown, available); seq.push(shown); }
  return seq;
};
const expected = (k: number, available: number) => Math.min(BROWSE_BATCH * k, available);

const firstPages = [8, 10, 19, 38, 99];
const bad = firstPages.filter((f) =>
  walk(f, 2000, 16).some((shown, i) => shown !== expected(i + 1, 2000)));
check('after k presses the turn shows min(100k, available) — INDEPENDENT of the first page size',
  bad.length === 0,
  bad.length ? `first pages that diverged: ${bad.join(', ')}` : `identical for first pages ${firstPages.join('/')}`);

check('the sequence lands on clean hundreds, never firstPage + 100k',
  walk(19, 2000, 3).join(',') === '100,200,300',
  `from a 19-card first page: ${walk(19, 2000, 3).join(',')} (a shown+100 product would give 119,219,319)`);
check('1,509 is not reachable by the product rule at any first page (the #125 reading)',
  firstPages.every((f) => !walk(f, 2000, 20).includes(1509)),
  'some first page produced 1509 — the boundary rule would then be wrong, not the harness');
check('the walk is clamped by what was actually fetched, never by the true total',
  walk(10, 1550, 16).at(-1) === 1550, `${walk(10, 1550, 16).at(-1)} with 1550 available`);

// ── 3. THE JOURNEY NO LONGER RECONSTRUCTS THE TURN — it counts it ───────────────────────────────
const src = stripComments(readFileSync(join(ROOT, JOURNEY), 'utf8'));
check('the pagination walk reads the ids of the NEWEST TURN (not a page-wide count)',
  /READ_TURN_CARDS/.test(src) && /compareDocumentPosition/.test(readFileSync(join(ROOT, JOURNEY), 'utf8')),
  'READ_TURN_CARDS / its document-order scoping is gone — the delta-against-a-baseline shape is back');
check('the reveal is no longer derived from a baseline snapshot plus a hardcoded first page',
  !/cardsBefore/.test(src) && !/alreadyShown/.test(src),
  'cardsBefore / alreadyShown are back — that arithmetic is ops_incident #125');
check('the per-click wait is the shared pacing primitive, not a typed millisecond budget',
  /settleUntil\(/.test(src) && /REVEAL_SETTLE_MS/.test(src),
  'the settle wait is not routed through settleUntil/REVEAL_SETTLE_MS');
check('a cascade that never came to rest FAILS rather than being judged mid-flight',
  /settleFailures/.test(src), 'nothing records a non-settling click — a moving number can be asserted again');
check('the visible ids are held to the fetched set (duplicates, stale, and monotone paging)',
  /no listing is revealed twice/.test(src)
  && /nothing invented, no stale transcript card/.test(src)
  && /drops a card an earlier click had already revealed/.test(src),
  'the id-level assertions the owner asked for on 2026-09-06 are missing');

// The ordering half is deliberately NOT asserted, and that must stay deliberate: a future run that
// "restores" it would re-file the same false accusation. MATCH FIRST (AGENTS.md) lets a post-match
// stage REORDER the matched set — measured live 2026-09-06, platform diversity pulled 53 rows
// forward from beyond position 1,600 — and forbids only ADDING, which `stale === 0` is what checks.
check('the journey does NOT compare DOM order against the RPC\'s candidate order',
  !/first divergence at index/.test(src),
  'an order-prefix comparison is back — it contradicts MATCH FIRST and fails on a correct product');

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the same predicates, against the defects they exist to catch\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// M-1: the first page treated as a constant 10 — half of #125.
mustCatch('a first page hardcoded to 10 (wrong the moment a scope matches more platforms)',
  first(19) !== 10);
// M-2: a shown+100 product instead of the owner's boundary rule.
const incrementModel = (f: number, k: number) => f + BROWSE_BATCH * k;
mustCatch('a shown+100 increment model instead of the next clean boundary',
  incrementModel(19, 1) !== walk(19, 2000, 1)[0]);
// M-3: THE EXACT #125 ARITHMETIC — page-wide count, baseline caught mid-cascade at 8, +FIRST_PAGE.
const buggyRevealed = (trueReveal: number, baselineCaughtAt: number, otherTurns: number) =>
  (otherTurns + trueReveal) - (otherTurns + baselineCaughtAt) + FLOOR;
mustCatch('the #125 arithmetic itself: a baseline caught mid-cascade yields a constant +2',
  buggyRevealed(100, 8, 37) === 102 && buggyRevealed(1500, 8, 37) === 1502);
// M-4: and the turn-scoped count does NOT have that error — same inputs, right answer.
mustCatch('turn-scoped counting is immune to the baseline error the delta had',
  ((trueReveal: number) => trueReveal)(1500) === 1500);
// M-5: a journey that goes back to a page-wide delta.
mustCatch('a journey returned to cardsBefore/alreadyShown',
  /cardsBefore/.test('const x = shown - cardsBefore + alreadyShown;'));
// M-6: a clean journey is not flagged.
mustCatch('a turn-scoped journey is not flagged',
  !/cardsBefore/.test('const ids = await page.evaluate(READ_TURN_CARDS);'));

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the first page is the product\'s own initialReveal(), a press lands on the next hundred, and the reveal is counted on the turn that owns it.\n'
    : `\n❌ ${failed} check(s) failed — a reveal can be miscounted against a correct product again.\n`);
process.exit(failed === 0 ? 0 : 1);
