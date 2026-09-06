// AN ADVERTISED-VS-LANDED COMPARISON MAY ONLY ACCUSE PRODUCTION ON ONE STATE OF THE INDEX.
//
// THE DEFECT (ops_incident #47, 2026-09-05, routine-4 live browser sweep).
// The Trending city chip for «الرياض» advertised 35,900; clicking it landed on a search whose
// headline read 35,907. The sweep called that a `UI→RENDERED` DEFECT and filed it — twice, at
// 08:18 UTC. Neither number was wrong. The chip's count is what `top_cities_by_deal_ar` answered,
// the landed count is what `location_search_candidates_ar` answered, and BOTH read
// `search_listings_ar` — a table re-synced by pg_cron jobid 28 at :14 past every hour with the
// location MV refresh (jobid 17) at :20, against a journey whose chip→landed window is 20-50 s
// (the AF journey's is over a minute). The comparison straddled a rebuild, so it compared two
// different databases.
//
// Adjudicated at the RPC level 8/8 (incident root_cause) and re-checked independently inside ONE
// transaction snapshot while this barrier was written: chip == click EXACTLY — الرياض/بيع 36,369
// and جدة/إيجار 13,212 over 202,729 production-ready rows. There is no Trending defect. What was
// broken is the HARNESS's right to accuse.
//
// THE CONTRACT THIS PINS — and it must hold in BOTH directions, because a barrier that only
// suppresses is a barrier that has stopped working:
//
//   A. `UI→RENDERED` is unreachable except through judgeAdvertisedVsLanded(). A journey that
//      hand-rolls the comparison CRASHES the sweep instead of quietly filing an index rebuild as a
//      product defect. (The 2026-09-04 lesson: a source-TEXT tripwire over the defective line stays
//      green for as long as the defect is live, so this is EXECUTED, not grepped.)
//   B. A mismatch on a PROVEN-STABLE index is still a DEFECT. Full stop. Bracketing is not a
//      tolerance and not retry-until-green.
//   C. A mismatch whose bracket moved, could not be read, or was never taken is UNDECIDED —
//      counted, named, printed, and never folded into a pass.
//   D. «PRODUCTION VERIFIED: YES» requires zero defects AND zero undecided comparisons. A run that
//      could not make a comparison did not verify the surface (the same reading
//      verify-af-full-surface-differential.ts already gives an unsettled differential).
//
// Wiring note (AGENTS.md, "How `npm test` finds its checks"): this file runs because it exists.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';
import {
  defect, findings, undecideds, judgeAdvertisedVsLanded, onOneIndex, productionVerified,
  UNREADABLE_STAMP,
} from '../e2e/live-sweep/sweep.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── A. the layer pair is reserved, and the guard is EXECUTED ─────────────────────────────────────
{
  const before = findings.length;
  let threw = '';
  try { defect('barrier', 'UI→RENDERED', 'hand-rolled advertised-vs-landed comparison'); }
  catch (e) { threw = String((e as Error).message); }
  check('a hand-rolled UI→RENDERED accusation THROWS instead of being filed',
    threw.includes('reserved for judgeAdvertisedVsLanded'), threw || 'nothing was thrown');
  check('and it files nothing on the way out', findings.length === before, `findings grew to ${findings.length}`);

  const n = findings.length;
  defect('barrier', 'R14.4.2', 'an unrelated layer pair still records normally');
  check('the guard does not block the other layer pairs', findings.length === n + 1);
  findings.length = n; // leave the module's state as we found it
}

// ── B/C. the judge, against a bracket the test controls ──────────────────────────────────────────
const stable = { stable: true, stamp: '100@t1@t1 → 100@t1@t1' };
const moved = { stable: false, stamp: '100@t1@t1 → 101@t2@t1' };
const blind = { stable: false, stamp: `${UNREADABLE_STAMP} → ${UNREADABLE_STAMP}` };
const counts = () => [findings.length, undecideds.length] as const;

{
  const [f0, u0] = counts();
  check('equal counts: nothing to report, on any bracket',
    judgeAdvertisedVsLanded('j', 'city', 35900, 35900, moved) === 'agree'
    && findings.length === f0 && undecideds.length === u0);

  check('an unknown side is never an accusation',
    judgeAdvertisedVsLanded('j', 'city', null, 35907, stable) === 'unknown'
    && judgeAdvertisedVsLanded('j', 'city', 35900, null, stable) === 'unknown'
    && findings.length === f0 && undecideds.length === u0);

  // B — THE DIRECTION THAT MUST NEVER WEAKEN.
  const verdict = judgeAdvertisedVsLanded('j', 'trending city «الرياض»', 35900, 35907, stable);
  check('MUTATION — a mismatch on a PROVEN-STABLE index is still a DEFECT',
    verdict === 'defect' && findings.length === f0 + 1
    && findings[findings.length - 1].layerPair === 'UI→RENDERED'
    && findings[findings.length - 1].detail.includes('35900'),
    `verdict=${verdict} findings=${findings.length}`);
  check('and it is filed as a real finding, not a note', undecideds.length === u0);
  findings.length = f0;
}
{
  const [f0, u0] = counts();
  check('C — a mismatch across a rebuilt index is UNDECIDED, never a defect',
    judgeAdvertisedVsLanded('j', 'city', 35900, 35907, moved) === 'undecided'
    && findings.length === f0 && undecideds.length === u0 + 1);
  check('FAIL-CLOSED — a bracket we could not READ is undecided too (never mistaken for stable)',
    judgeAdvertisedVsLanded('j', 'city', 35900, 35907, blind) === 'undecided' && findings.length === f0);
  check('FAIL-CLOSED — NO bracket at all is undecided, not a free pass to accuse',
    judgeAdvertisedVsLanded('j', 'city', 35900, 35907, undefined) === 'undecided' && findings.length === f0);
  check('an undecided says so out loud, naming both numbers',
    undecideds[undecideds.length - 1].detail.includes('35900')
    && undecideds[undecideds.length - 1].detail.includes('35907'));
  undecideds.length = u0;
}

// ── the bracket itself, against a scripted stamp source ──────────────────────────────────────────
{
  const stamps = (...seq: string[]) => { let i = 0; return async () => seq[Math.min(i++, seq.length - 1)]; };
  const order: string[] = [];
  const held = await onOneIndex(async () => { order.push('take'); return 'result'; },
    async () => { order.push('stamp'); return '100@t1@t1'; });
  check('a comparison taken while the index held still is STABLE, and its result is passed through',
    held.stable && held.result === 'result');
  check('the bracket really brackets: stamp → take → stamp, in that order',
    order.join(',') === 'stamp,take,stamp', order.join(','));

  const rowsMoved = await onOneIndex(async () => 'r', stamps('100@t1@t1', '101@t1@t1'));
  check('MUTATION — a rebuild that moves only the ROW COUNT is caught', !rowsMoved.stable);
  const arrivedMoved = await onOneIndex(async () => 'r', stamps('100@t1@t1', '100@t2@t1'));
  check('MUTATION — a rebuild that moves only the NEWEST ARRIVAL is caught', !arrivedMoved.stable);
  const writtenMoved = await onOneIndex(async () => 'r', stamps('100@t1@t1', '100@t1@t2'));
  check('MUTATION — a rebuild that moves only the NEWEST WRITE is caught', !writtenMoved.stable);
  const unreadable = await onOneIndex(async () => 'r', stamps(UNREADABLE_STAMP, UNREADABLE_STAMP));
  check('FAIL-CLOSED — two equal UNREADABLE stamps are not a stable index', !unreadable.stable);

  const stillRuns = await onOneIndex(async () => 'the other five layers', stamps('1@a@a', '2@b@b'));
  check('a moved index still hands back the result (the journey\'s other layers must still assert)',
    stillRuns.result === 'the other five layers');
}

// ── D. «PRODUCTION VERIFIED» is a claim about what was PROVED ────────────────────────────────────
{
  const d = [{ journey: 'j', layerPair: 'UI→RENDERED', detail: 'x' }];
  const u = [{ journey: 'j', detail: 'x' }];
  check('clean run verifies', productionVerified([], []));
  check('a defect un-verifies', !productionVerified(d, []));
  check('MUTATION — an UNDECIDED comparison un-verifies too (missing coverage is not a pass)',
    !productionVerified([], u));
  check('and both together', !productionVerified(d, u));
}

// ── the wiring: the journeys route through the judge, the runner surfaces the undecideds ─────────
// Three predicates, defined ONCE and used twice: to check the shipped source, and then to check
// themselves against source that is deliberately broken. A wiring check that cannot fail is the
// failure mode this whole repo has been burned by (five defects in one day, every one with a green
// source-text tripwire over the defective line).
const journeysSrc = stripComments(read('e2e/live-sweep/journeys.mjs'));
const showmoreSrc = stripComments(read('e2e/live-sweep/showmore.mjs'));
const runSrc = stripComments(read('e2e/live-sweep/run.mjs'));

// Three advertised-vs-landed surfaces: trending city, trending district, AF chip. A fourth added
// later cannot reach `defect` any other way, and this count keeps a SILENT deletion of one visible.
const routed = (s: string) => !s.includes('UI→RENDERED')
  && (s.match(/judgeAdvertisedVsLanded\(/g) ?? []).length >= 3
  && (s.match(/onOneIndex\(/g) ?? []).length >= 3;
const gated = (s: string) => /PRODUCTION VERIFIED',\s*productionVerified\(findings, undecideds\)/.test(s);
const printed = (s: string) => /undecideds\.forEach/.test(s);

{
  check('no journey names the reserved layer pair in code (the runtime guard would crash it mid-sweep)',
    !journeysSrc.includes('UI→RENDERED') && !showmoreSrc.includes('UI→RENDERED'));
  check('all three advertised-vs-landed comparisons go through the judge, each one bracketed',
    routed(journeysSrc),
    `judged=${(journeysSrc.match(/judgeAdvertisedVsLanded\(/g) ?? []).length} `
    + `bracketed=${(journeysSrc.match(/onOneIndex\(/g) ?? []).length}`);
  check('the runner prints the undecided comparisons', printed(runSrc));
  check('and gates PRODUCTION VERIFIED on the shared decision, not on findings alone', gated(runSrc));
  check('this barrier runs in npm test', npmTestRuns(ROOT, 'verify-live-sweep-index-bracket'));
}

// ── the wiring checks, proven to FAIL on deliberately broken source ──────────────────────────────
const mustCatch = (label: string, caught: boolean, detail = '') =>
  check(`mutation caught — ${label}`, caught, detail || 'this check passes on broken source, so it protects nothing');
{
  mustCatch('a journey hand-rolls the comparison again (the exact incident #47 shape)',
    !routed(journeysSrc.replace(/judgeAdvertisedVsLanded\(name, `trending city[^;]*;/,
      "defect(name, 'UI\u2192RENDERED', `trending city mismatch`);")));
  mustCatch('one of the three judged comparisons is quietly deleted',
    !routed(journeysSrc.replace('judgeAdvertisedVsLanded(', 'noop(')));
  mustCatch('a comparison is left unbracketed, so it could only ever be UNDECIDED',
    !routed(journeysSrc.replace('onOneIndex(', 'await (async (f) => ({ result: await f() }))(')));
  mustCatch('the runner goes back to gating PRODUCTION VERIFIED on findings alone',
    !gated(runSrc.replace('productionVerified(findings, undecideds)', 'findings.length === 0')));
  mustCatch('the runner stops printing the undecided comparisons',
    !printed(runSrc.replace('undecideds.forEach', '[].forEach')));
  // …and the predicates are not vacuous: the source that actually ships satisfies all three.
  mustCatch('a HEALTHY tree is not reported broken (the predicates are not vacuous)',
    routed(journeysSrc) && gated(runSrc) && printed(runSrc));
}

console.log(failures
  ? `\n✗ ${failures} check(s) FAILED\n`
  : '\n✓ an advertised-vs-landed mismatch accuses production only on one proven state of the index — and still always does\n');
process.exit(failures ? 1 : 0);
