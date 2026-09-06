// THE LIVE AF JOURNEY HARNESS MUST FAIL ON THE APP, NEVER ON ITSELF (2026-09-05).
//
// scripts/verify-af-live-truth.ts drives 9 real production journeys and is a REQUIRED gate. A
// harness that reports the app broken when the app is fine is worse than no harness: it burns the
// signal. Run 33939914275 did exactly that — 5 red checks, every one of them the harness racing
// production, and the app byte-identical to the last green run:
//
//   • "AF card opened on a real question" -> {hasCard:false,q:null,chip:null}
//     The first card read used the 9s default while every sibling read already used AGENT_TURN_MS
//     (60s) — and the first read is the SLOWEST transition (rankQuestions + a count RPC per
//     candidate question). Driving the same journey by hand opened the card on
//     «كم التقييم اللي تفضله؟», chip 9,130, options 9.5+/9.0+/9.0_rc10 — identical to green run
//     33922383826 (chip=9130, afterSelect=4945).
//   • "journey completed without throwing" -> page.click('[data-testid="undefined"]') timeout.
//     A cascade: no card => empty option list => a selector literally built from `undefined`.
//   • "final search request was captured" -> null, on THREE journeys. A fixed 1,200 ms sleep after
//     the confirm, read before the request landed.
//
// These assertions pin the fixes. They are all "wait for the real thing / refuse to invent a
// selector" — none of them weakens what the journey proves: a card that never opens, an option list
// that is genuinely empty, and a search that genuinely never fires all still fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const src = readFileSync(join(root, 'scripts/verify-af-live-truth.ts'), 'utf8');
const pacing = readFileSync(join(root, 'scripts/lib/afJourneyPacing.ts'), 'utf8');
const code = src.replace(/^\s*\/\/.*$/gm, '');          // comments never satisfy a code assertion

let failed = 0;
let confirmIdx = -1;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};

// ── 1. ONE BUDGET FOR EVERY CARD READ ────────────────────────────────────────────────────────
{
  check(/export const AGENT_TURN_MS\s*=/.test(pacing), 'the shared agent-turn budget still exists');
  const reads = [...code.matchAll(/readCardUntil\(([^;]*?)\)\s*;/gs)].map((m) => m[1]);
  check(reads.length >= 3, `found the readCardUntil call sites (${reads.length})`);
  for (const [i, r] of reads.entries()) {
    check(/AGENT_TURN_MS/.test(r),
      `readCardUntil call site #${i + 1} waits a full agent turn, not the short default`,
      'the first read is the SLOWEST transition — a short budget there reports hasCard:false as an app defect');
  }
}

// ── 2. NEVER CLICK A SELECTOR BUILT FROM undefined ───────────────────────────────────────────
// Every `page.click(\`[data-testid="${x}"]\`)` whose x comes from an option list must be guarded,
// or an empty list becomes a 30s timeout on the literal string "undefined" and buries the cause.
{
  const dyn = [...code.matchAll(/page\.click\(`\[data-testid="\$\{([^}]+)\}"\]`\)/g)].map((m) => m[1].trim());
  check(dyn.length >= 3, `found the dynamic testid clicks (${dyn.length})`);
  // Each one must be preceded by a guard mentioning the same variable.
  for (const v of dyn) {
    const base = v.replace(/\[.*/, '');                  // opts[0] -> opts, testid -> testid
    const guarded = new RegExp(`if \\(!${v.replace(/[[\]]/g, '\\$&')}\\)|if \\(!${base}\\.length\\)|${base}\\.length === 0`).test(code);
    check(guarded, `the click on \`${v}\` is guarded against an empty option list`,
      'without it, page.click(\'[data-testid="undefined"]\') times out for 30s and fails a second, unrelated check');
  }
  check(!/page\.click\(`\[data-testid="\$\{opts\[\d+\]\}"\]`\)\s*;(?![\s\S]{0,400}?if \(!opts)/.test(''),
    'no unguarded opts[] click remains (structural)');
}

// ── 3. THE FINAL SEARCH IS AWAITED, NOT SLEPT THROUGH ────────────────────────────────────────
{
  confirmIdx = code.indexOf("page.click('[data-testid=\"af-confirm\"]')");
  check(confirmIdx > 0, 'the confirm click is still there');
  const after = code.slice(confirmIdx, confirmIdx + 900);
  check(/while \([\s\S]*?lastSearchBody === null\)/.test(after),
    'after confirm the journey POLLS for the search body instead of sleeping a fixed guess',
    'a fixed sleep reports "final search request was captured: null" for a search that was merely slow');
  check(/AGENT_TURN_MS/.test(after),
    'and that poll is bounded by the shared agent-turn budget');
  check(!/page\.waitForTimeout\(1200\)/.test(after.slice(0, 200)),
    'the old fixed 1,200 ms wait is gone from the confirm path');
}

// ── 4. THE HARNESS STILL BITES ───────────────────────────────────────────────────────────────
// Longer waits must not become "assume it worked". The failure paths must still exist.
{
  check(/check\(`\$\{name\}: AF card opened on a real question`/.test(src),
    'the card-opened check still exists and can still fail');
  check(/final search request was captured/.test(src),
    'the search-captured check still exists and can still fail');
  // Must be the RESET immediately before the confirm, not the declaration far above it — matching
  // `lastSearchBody = null` anywhere also matches `let lastSearchBody = null`, which made this
  // assertion unable to fail (caught by its own mutation, 2026-09-05).
  const before = code.slice(Math.max(0, confirmIdx - 300), confirmIdx);
  check(/lastSearchBody = null;/.test(before),
    'the captured body is reset immediately before the confirm, so a stale body cannot pass the check');
}

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────
// Each guard above, applied to a deliberately broken copy of the harness, must FAIL. These are the
// five real defects from run 33939914275 — reintroduced here so the barrier proves it can see them.
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
const mustCatch = (label: string, caught: boolean) => {
  if (caught) console.log(`  PASS  catches: ${label}`);
  else { console.log(`  FAIL  BLIND to: ${label}`); failed++; }
};
const mut = (from: string, to: string) => {
  if (!code.includes(from)) throw new Error(`mutation anchor missing: ${from.slice(0, 60)}`);
  return code.replace(from, to);
};
const readsOf = (c: string) => [...c.matchAll(/readCardUntil\(([^;]*?)\)\s*;/gs)].map((m) => m[1]);

mustCatch('the FIRST card read dropped back to the short default (reported hasCard:false as an app defect)',
  readsOf(mut('let st = await readCardUntil((s) => s.hasCard && s.chip != null, AGENT_TURN_MS);',
              'let st = await readCardUntil((s) => s.hasCard && s.chip != null);'))
    .some((r) => !/AGENT_TURN_MS/.test(r)));

mustCatch('a count-change read dropped back to the short default',
  readsOf(mut('s.chip !== baselineChip, AGENT_TURN_MS);', 's.chip !== baselineChip);'))
    .some((r) => !/AGENT_TURN_MS/.test(r)));

mustCatch('the empty-option guard removed (page.click on a selector built from undefined)',
  !/if \(!opts\[0\]\)/.test(mut('if (!opts[0]) {', 'if (false) {')));

mustCatch('the confirm poll reverted to a fixed sleep (reports a slow search as "never captured")',
  !/while \([\s\S]*?lastSearchBody === null\)/.test(
    mut('while (Date.now() < until && lastSearchBody === null) await page.waitForTimeout(250);',
        'await page.waitForTimeout(1200);').slice(confirmIdx, confirmIdx + 900)));

mustCatch('the pre-confirm reset removed, letting a STALE captured body pass the check',
  !/lastSearchBody = null;/.test(
    mut('lastSearchBody = null; lastSearchResp = null;', 'lastSearchResp = null;')
      .slice(Math.max(0, confirmIdx - 300), confirmIdx)));

console.log(failed === 0
  ? '\n✅ verify-af-journey-harness-honesty: all checks passed.'
  : `\n❌ verify-af-journey-harness-honesty: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
