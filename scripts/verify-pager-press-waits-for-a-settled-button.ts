/**
 * The «عرض المزيد» press must be aimed at a button that has STOPPED MOVING.
 *
 * WHY THIS EXISTS (2026-09-22, routine-4-search-qa). The daily live sweep filed
 * `[show-more:الرياض/شقة] PAGER-CLICK — batch 2: locator.click: Timeout 20000ms exceeded` against a
 * completely healthy production pager. The locator was right — it resolved to
 * `data-testid="results-load-more"`, so §41.3 was not the explanation — but the harness pressed
 * after a flat `sleep(400)` while ~100 freshly-revealed card images were still loading. The button
 * slid down the document under the press, Playwright's actionability check (visible · enabled ·
 * STABLE) never saw it hold still, and during the reflow a card's `data-expoimage` div occupied the
 * centre point Playwright had computed a moment earlier.
 *
 * Re-driven on production the same day with the page allowed to settle, on the exact cohort that
 * failed (الرياض/شقة): the pager was covered in **0 of 8** hit-tests at rest, held **one** Y
 * position at rest, and an ordinary trusted click paginated in 71ms then 169ms, 24 → 100 → 500
 * cards — SECOND_PAGE_CAP reached exactly. The product was right; the harness was asking a
 * reflowing page a question only a settled page can answer.
 *
 * That is a false RED, and a false red is not free: this very file's 2026-09-10..12 note records the
 * sweep filing a PAGINATION/PAGER-MISSING pair against healthy production, and AGENTS.md §40.7
 * forbids reporting a harness failure as a product failure. A sweep that cries wolf on the one
 * daily requirement the static barriers cannot stand in for (§10 — the pager must be really clicked
 * in production every day) is worse than no sweep, because the next real PAGER-CLICK reads as noise.
 *
 * WHAT IS PINNED, BY EXECUTION — never by reading the source around the call. `pagerSettleVerdict`
 * is lifted out of the sweep and RUN against geometry series built here, because every defect of
 * 2026-09-04 had a source-TEXT tripwire over the exact line and every one of those tripwires stayed
 * green for as long as the defect was live.
 *
 * WHAT THIS DOES NOT DO: it does not weaken the pager assertion, and asserts that it doesn't. A
 * settle is a WAIT, not a bypass — the sweep still issues an ordinary trusted click with the same
 * timeout and still files PAGER-CLICK when it fails, so a genuinely covered or genuinely dead pager
 * is caught exactly as before. `{ force: true }` would have "fixed" the symptom by skipping
 * actionability altogether, which would mask precisely the overlay defect this journey exists to
 * find; §5 below fails if that ever appears.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pagerSettleVerdict } from '../e2e/live-sweep/showmore.mjs';

const ROOT = join(import.meta.dirname, '..');
const SRC = readFileSync(join(ROOT, 'e2e/live-sweep/showmore.mjs'), 'utf8');

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// The source-level rules, as PREDICATES over a source string rather than inline regexes, so the
// mutants below can be fed to the very same code that judges the shipped file. A mutation proof
// that re-implements the rule proves nothing about the rule.
const callsSettleBeforeClick = (src: string) => {
  // The obvious spelling is `indexOf(call) < indexOf(click)` — and it CANNOT FAIL. Deleting the
  // call site makes indexOf return -1, and -1 is less than every index, so the removal the check
  // exists to catch reads as "correctly ordered". Watched happen while writing this file: restoring
  // the old sleep(400) press left the whole barrier GREEN. Hence the explicit >= 0 on both.
  const call = src.indexOf('await awaitPagerSettled(btn)');
  const click = src.indexOf("defect(name, 'PAGER-CLICK'");
  return call >= 0 && click >= 0 && call < click;
};
const pressIsAnOrdinaryTrustedClick = (src: string) =>
  !/results-load-more[\s\S]{0,400}?force\s*:\s*true/.test(src) && !/btn\.click\(\s*\{[^}]*force/.test(src);
const failedPressStillFilesADefect = (src: string) =>
  /btn\.click\([^)]*\)\s*\.catch\(\([^)]*\)\s*=>\s*defect\(name,\s*'PAGER-CLICK'/.test(src);
const noFixedSleepBeforeThePress = (src: string) =>
  !/await sleep\(\d+\);\s*\n\s*const calm = \{/.test(src)
  && !/await sleep\(400\);[\s\S]{0,200}?btn\.click\(/.test(src);

const at = (x: number, y: number, h = 38) => ({ x, y, h });

// ── §1 a button that has held still is settled ──────────────────────────────────────────────────
check('three identical readings settle the pager',
  pagerSettleVerdict([at(100, 900), at(100, 900), at(100, 900)]).settled === true);

check('a long calm tail settles even after an earlier reflow',
  pagerSettleVerdict([at(100, 300), at(100, 700), at(100, 900), at(100, 900), at(100, 900)]).settled === true,
  'only the TAIL matters — the button moved while images loaded, then stopped');

// ── §2 a button still sliding under the press is NOT settled ────────────────────────────────────
// This is the الرياض/شقة failure, as geometry: each revealed image pushes the pager further down.
check('a pager still sliding down the document is not settled',
  pagerSettleVerdict([at(100, 900), at(100, 1400), at(100, 2100)]).settled === false);
check('…and says why', pagerSettleVerdict([at(100, 900), at(100, 1400), at(100, 2100)]).reason === 'still-moving');

check('one late nudge un-settles a previously calm button',
  pagerSettleVerdict([at(100, 900), at(100, 900), at(100, 912)]).settled === false,
  'the last image landed and moved it 12px — pressing here is the original bug');

check('horizontal drift counts as movement too',
  pagerSettleVerdict([at(100, 900), at(140, 900), at(180, 900)]).settled === false);

check('a height change counts as movement too',
  pagerSettleVerdict([at(100, 900, 38), at(100, 900, 60), at(100, 900, 38)]).settled === false);

// ── §3 an unmeasurable pager is never "calm" ────────────────────────────────────────────────────
check('a pager that cannot be measured is not settled',
  pagerSettleVerdict([at(100, 900), null as never, at(100, 900)]).settled === false);
check('…and is named as unmeasurable, not as stable',
  pagerSettleVerdict([at(100, 900), null as never, at(100, 900)]).reason === 'pager-unmeasurable');
check('too few readings is not settled',
  pagerSettleVerdict([at(100, 900)]).settled === false);
check('a non-array is not settled', pagerSettleVerdict(undefined as never).settled === false);

// ── §4 MUTATION: the policy this replaced must FAIL the case it was replaced for ─────────────────
// The old harness pressed after a fixed sleep, i.e. "settled" was unconditionally true. Watch that
// policy pass the exact series the real defect produced — the proof that this barrier bites.
// MUTANT 1 — the policy this replaced: press after a flat pause, i.e. "settled" unconditionally.
// This is the exact code that filed the false PAGER-CLICK, restored verbatim.
const MUTANT_FIXED_SLEEP = SRC.replace(
  'const calm = await awaitPagerSettled(btn);',
  "await sleep(400);\n      const calm = { settled: true, reason: 'waited-400ms', waitedMs: 400, samples: 0 };");
mustCatch('the old fixed-sleep press, with the settle call deleted',
  !callsSettleBeforeClick(MUTANT_FIXED_SLEEP) || !noFixedSleepBeforeThePress(MUTANT_FIXED_SLEEP));

// MUTANT 2 — the tempting weakening: accept two equal readings instead of three. It is wrong for
// the real signal, because an image decode pause makes two consecutive readings agree MID-reflow.
// Fed as an explicit `stable` so the shipped default is what the assertion above actually uses.
const DECODE_PAUSE_TAIL = [at(100, 900), at(100, 1400), at(100, 1400)];
check('the SHIPPED default rejects a mid-reflow decode pause',
  pagerSettleVerdict(DECODE_PAUSE_TAIL).settled === false,
  'PAGER_STABLE_SAMPLES has been lowered — two equal readings mid-reflow now read as calm');
mustCatch('PAGER_STABLE_SAMPLES lowered from 3 to 2',
  pagerSettleVerdict(DECODE_PAUSE_TAIL, 2).settled === true);

// MUTANT 3 — "fixing" the timeout by skipping actionability altogether. This would make the journey
// green against the very overlay it exists to detect.
const MUTANT_FORCE = SRC.replace('await btn.click({ timeout: 20000 })',
                                 'await btn.click({ timeout: 20000, force: true })');
mustCatch('a force:true press that bypasses the overlay check',
  !pressIsAnOrdinaryTrustedClick(MUTANT_FORCE));

// MUTANT 4 — swallowing the verdict: press, but stop filing PAGER-CLICK when it fails.
const MUTANT_SILENT = SRC.replace(/\.catch\(\(e\) => defect\(name, 'PAGER-CLICK'[^;]*;/, '.catch(() => {});');
mustCatch('a failed press that no longer files a defect',
  !failedPressStillFilesADefect(MUTANT_SILENT));

// ── §5 the settle must not have become a BYPASS ─────────────────────────────────────────────────
check('the pager press is still an ordinary trusted click, never force:true',
  pressIsAnOrdinaryTrustedClick(SRC),
  'force:true skips actionability and would mask the very overlay this journey hunts');

check('a failed pager press still files a PAGER-CLICK defect',
  failedPressStillFilesADefect(SRC),
  'the settle is a wait, not an excuse — the verdict must survive it');

check('the press waits on the settle helper BEFORE the click it protects',
  callsSettleBeforeClick(SRC),
  'no `await awaitPagerSettled(btn)` ahead of the press — the press is unguarded again');

check('the press does not fall back to a fixed sleep before clicking',
  noFixedSleepBeforeThePress(SRC),
  'a hardcoded pause is the exact policy that filed the false PAGER-CLICK');

check('the settle window cannot outlast the click timeout it protects',
  /PAGER_SETTLE_MAX_MS\s*=\s*20_000/.test(SRC) && /btn\.click\(\{\s*timeout:\s*20000/.test(SRC),
  'a settle longer than the click timeout turns one hang into two');

console.log(failures === 0
  ? '\n✓ the «عرض المزيد» press waits for a button that has stopped moving, and still fails on one that is genuinely blocked'
  : `\n✗ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
