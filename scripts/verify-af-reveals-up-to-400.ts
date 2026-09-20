// AFTER AN ADVANCED FILTER ROUND, THE USER DOES NOT TAP TO SEE WHAT THEY JUST ASKED FOR.
//
// Owner rule 2026-09-20: "if user does Advanced Filter still there is a lot of listing just show him
// all up to 400". A round that lands on 40 listings used to show the first-screen width (max(10,
// matching platforms)) and a «عرض المزيد» — asking the user to press a button to see the consequence
// of answers they had just given. It is the same complaint the 2026-08-30 small-set rule fixed at
// ≤ INTERVIEW_STOP_AT, one size up, and it now has its own allowance: AF_REVEAL_MAX.
//
// THE THREE PROPERTIES THIS PINS, because each one was an explicit owner decision and each is easy to
// break without noticing:
//   1. AN ALLOWANCE, NOT A CEILING. Above 400 the turn still pages — «عرض المزيد» keeps working and
//      nothing is hidden. Only the TAPPING is removed for the first 400.
//   2. IT DOES NOT FINISH THE CHAT. Completion is still the ≤ INTERVIEW_STOP_AT rule alone (R11.1).
//      Revealing 400 cards says "here is what you asked for", never "this conversation is over" —
//      the owner was asked this directly and chose to keep the chat open.
//   3. IT IS AF-ONLY. A plain Filter search is untouched: it keeps the first-screen width that the
//      2026-09-02 "as wide as the market" rule sizes from the matching-platform count.
//
// Executes the real pure function (never a copy), and proves each rule by feeding it the shape that
// would break it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialReveal, AF_REVEAL_MAX } from '../src/lib/initialReveal.ts';
import { INTERVIEW_STOP_AT } from '../src/lib/afRanking.ts';
import { stripComments } from './lib/stripComments.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const root = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

console.log(`\nAdvanced Filter reveals up to ${AF_REVEAL_MAX} without a tap (owner 2026-09-20)\n`);

const FP = 10;
// A realistic broad scope: plenty of platforms, so the non-AF first screen is genuinely wide and the
// two branches cannot be confused by a coincidentally-equal number.
const PLATFORMS = 59;
const af = (fetched: number, honestTotal: number | null) =>
  initialReveal({ fetched, honestTotal, firstPage: FP, stopAt: INTERVIEW_STOP_AT, platforms: PLATFORMS, afCompleted: true });
const plain = (fetched: number, honestTotal: number | null) =>
  initialReveal({ fetched, honestTotal, firstPage: FP, stopAt: INTERVIEW_STOP_AT, platforms: PLATFORMS, afCompleted: false });

// ── 1. The owner's own worked numbers ────────────────────────────────────────────────────────────
check(`AF_REVEAL_MAX is ${AF_REVEAL_MAX}`, AF_REVEAL_MAX === 400);
check('AF round landing on 40 → all 40 revealed, no tap', af(40, 40) === 40);
check('AF round landing on 300 → all 300 revealed, no tap', af(300, 300) === 300);
check(`AF round landing on 1000 → exactly ${AF_REVEAL_MAX}, the rest still paged`,
  af(1000, 1000) === AF_REVEAL_MAX);
check('the boundary itself: 400 → all 400', af(400, 400) === 400);
check('one past it: 401 → 400 (and «عرض المزيد» owns the 401st)', af(401, 401) === AF_REVEAL_MAX);

// ── 2. AF-ONLY — a plain search keeps the first screen the market sizes ─────────────────────────
check('a PLAIN search of 300 still reveals the first-screen width, not 300',
  plain(300, 300) === PLATFORMS,
  `got ${plain(300, 300)} — the 2026-09-02 "as wide as the market" rule must be untouched`);
check('a PLAIN search is unchanged at every size above the stop line — the first screen is the '
    + 'matching-platform width, itself bounded by what was fetched',
  plain(1000, 1000) === PLATFORMS && plain(40, 40) === 40,
  `1000 → ${plain(1000, 1000)} (want ${PLATFORMS}); 40 → ${plain(40, 40)} (want 40: only 40 exist, `
  + 'so the 59-wide first screen is clamped to the set — it can never claim a row that is not there)');

// ── 3. The small-set rule still wins first (it reveals ALL, which 400 must never shrink) ────────
check(`≤ ${INTERVIEW_STOP_AT} reveals everything on BOTH paths (the older rule is not weakened)`,
  af(18, 18) === 18 && plain(18, 18) === 18);

// ── 4. Never claim rows the set does not contain ────────────────────────────────────────────────
check('bounded by what was actually fetched (total 900, only 120 fetched → 120)',
  af(120, 900) === 120);
check('an UNKNOWN honest total falls back rather than claiming a full reveal',
  af(1000, null) === AF_REVEAL_MAX && plain(1000, null) === PLATFORMS,
  'AF still gets its allowance; the plain path still refuses to imply "this is everything"');

// ── 5. Wired into the app on the SAME flag the message carries ─────────────────────────────────
const agent = stripComments(read('src/app/agent.tsx'));
check('the results message carries afCompleted (provenance on the message, not racy state)',
  /role: 'results'[\s\S]{0,400}?afCompleted\?: boolean/.test(agent));
check('only a round that COMMITTED through runRefine sets it (opts.guided is the one writer)',
  /playListings\(run, statusId, buildScrapeIntro\(result\.query \?\? refined\), result, label, !!opts\?\.guided\)/.test(agent));
check('the reveal helper forwards the flag to the pure function',
  /initialRevealPure\(\{[^}]*afCompleted \}\)/.test(agent));
check('every render/load-more site reads the SAME flag (no site left on the old baseline)',
  (agent.match(/initialReveal\(m\.result, m\.afCompleted\)/g) ?? []).length >= 4,
  'a site still calling initialReveal(m.result) would disagree with what the cascade revealed');
check('completion is still decided by the stop line ALONE — 400 never finishes a chat',
  /searchIsFinishedAtThreshold\(total, INTERVIEW_STOP_AT\)/.test(agent)
  && !/searchIsFinishedAtThreshold\([^)]*AF_REVEAL_MAX/.test(agent));

// ── 6. MUTATION PROOFS — each rule, fed the defect it exists to catch ───────────────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// The allowance turned into a hard stop: 1000 would reveal everything and the pager would vanish.
mustCatch('the cap dropped, revealing the whole fetched set (a 1000-card render)',
  initialReveal({ fetched: 1000, honestTotal: 1000, firstPage: FP, stopAt: 1e9, platforms: PLATFORMS, afCompleted: true }) !== AF_REVEAL_MAX);
// The flag ignored: AF turns would silently fall back to the 10/platform first screen — the exact
// "why am I tapping after answering questions" complaint this rule exists for.
mustCatch('the AF flag being ignored (AF falling back to the first-screen width)',
  af(300, 300) !== plain(300, 300));
// Leaking to plain searches would quietly change every ordinary search in the app.
mustCatch('the allowance leaking to plain searches',
  plain(300, 300) !== 300);

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — Advanced Filter results are not revealed the way the owner asked\n`
  : `\n✓ an AF round reveals up to ${AF_REVEAL_MAX} with no tap, pages beyond it, never finishes the chat, and never touches a plain search\n`);
process.exit(failed ? 1 : 0);
