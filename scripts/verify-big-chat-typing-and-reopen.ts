// TYPING IN A BIG SAVED CHAT STAYS LIGHT, AND A REOPENED CHAT KNOWS ITS HEIGHT (owner 2026-10-25: «logged in, in a saved
// chat, when I type it sometimes takes time and shows a glitch»).
//
// MEASURED (production build, Chromium 1440×900, a saved 500-card chat, best of 4): page CPU while typing 49 keys 2.9 s
// against 0.37 s in an empty chat (8×), the page's own code 1,313 ms against 130 ms (10×) — far worse whenever the laptop was
// busy, which is «sometimes». Causes, from the profile: the composer's text lives in the chat screen, so a key press
// re-renders the whole screen — (1) ~1,500 wrapper components rebuilt for the cards (a cell, a CardIn, a DeadCardShade per
// card), (2) the 500-card read-aloud script rebuilt for the feedback row, (3) the feedback row walking all of it again.
// And a reopened chat drew its not-yet-seen cards as 140 px placeholders while the laptop's photo cards are ~400 px, so the
// page believed a 500-card chat was 30,000 px tall when it is 72,000 and jumped as you scrolled (59 % off).
//
// This hermetic barrier pins each cause where it was fixed, EXECUTES the two pieces that are pure (the remembered
// read-aloud script and the placeholder heights), and proves each pin catches its own defect.
// scripts/verify-web-chat-typing-smooth.mjs measures the real thing, signed in, in a browser, on every PR.
//
//   node --experimental-strip-types scripts/verify-big-chat-typing-and-reopen.ts   (in npm test)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

type Src = { agent: string; row: string; grid: string; feedback: string; scrollCalm: string; readAloud: string };
const real: Src = {
  agent: read('src/app/agent.tsx'), row: read('src/components/ResultCardRow.tsx'), grid: read('src/components/ResultCardGrid.tsx'),
  feedback: read('src/components/FeedbackRow.tsx'), scrollCalm: read('src/lib/scrollCalm.ts'), readAloud: read('src/lib/readAloudScript.ts'),
};

/** Every way the wiring can bring the per-key re-render back, as sentences. */
function problems(f: Src): string[] {
  const out: string[] = [];
  const agent = stripComments(f.agent), row = stripComments(f.row), grid = stripComments(f.grid), fb = stripComments(f.feedback);
  // 1. the cards are drawn through the memoized row — never wrapped inline per render
  if (!/<ResultCardRow\b/.test(agent)) out.push('agent.tsx does not draw the cards through ResultCardRow — every key press would rebuild ~3 wrapper components per card');
  if (/<MemoResultCard\b/.test(agent) || /<CardIn\b[^>]*key=/.test(agent)) out.push('agent.tsx wraps cards inline (CardIn / MemoResultCard in the render) — a new element tree for every card on every key press');
  if (/Children\.map\(/.test(grid)) out.push('ResultCardGrid wraps every child in a fresh cell on each render — the rows are already cells');
  // 2. the row skips unless something the card DRAWS changed
  const cmp = /memo\(function ResultCardRow\([\s\S]*?\n\}, \(prev, next\) =>([\s\S]*?)\);/.exec(row)?.[1] ?? '';
  if (!cmp) out.push('ResultCardRow is not a memo with a custom comparator — its props (a motion object, an onOpen closure) are new on every render, so a plain memo never skips');
  for (const prop of ['listing', 'rank', 'row', 'activeAf', 'dead']) {
    if (cmp && !new RegExp(`prev\\.${prop} === next\\.${prop}`).test(cmp)) out.push(`ResultCardRow's comparator ignores «${prop}» — the card would show stale ${prop === 'dead' ? 'ended-ad shading' : prop}`);
  }
  if (/prev\.(onOpen|motion)\b/.test(cmp)) out.push('ResultCardRow compares onOpen/motion — both are new on every render, so the row would never skip (motion is read once at mount; onOpen behaves the same for the same listing)');
  // 3. the read-aloud script is remembered; the feedback row does not walk it again
  if (!/buildResultsReadAloudSegmentsCached\(introText, m\.result\.listings, shown,/.test(agent)) out.push('the results block does not use the remembered read-aloud script — 500 spoken cards are rebuilt on every key press');
  if (/buildResultsReadAloudSegments\(introText, m\.result\.listings\.slice\(/.test(agent)) out.push('the results block calls the un-remembered read-aloud builder on a fresh slice (a new array every render, so nothing downstream can skip)');
  if (!/const speakable = useMemo\(\(\) => hasSpeakableContent\(readAloudSegments\), \[readAloudSegments\]\)/.test(fb) || /\{hasSpeakableContent\(readAloudSegments\) \?/.test(fb)) out.push('FeedbackRow walks every spoken card on every render instead of once per script');
  // 4. no per-cell visibility observer coming back (498 runs while typing, measured)
  if (/IntersectionObserver/.test(stripComments(f.scrollCalm))) out.push('scrollCalm.ts uses an IntersectionObserver over the grid cells again — it cost ~3 ms of every frame on a 500-card list; read the rectangles once, when scrolling comes to rest');
  return out;
}
const found = problems(real);
check('typing in a big chat does not rebuild its cards (wiring)', found.length === 0, found.join('\n      '));

const mutate = (key: keyof Src, from: string | RegExp, to: string): Src => {
  const before = real[key]; const after = before.replace(from, to);
  if (after === before) throw new Error(`mutation anchor missing in ${key}: ${from}`);
  return { ...real, [key]: after };
};
mustCatch('cards drawn inline again (the old CardIn + MemoResultCard in the render) are caught', problems(mutate('agent', '<ResultCardRow', '<MemoResultCard')).length > 0);
mustCatch('the grid wrapping every child again is caught', problems({ ...real, grid: real.grid.replace('{children}', '{Children.map(children, (c) => c)}') }).length > 0);
mustCatch('a row with no custom comparator is caught', problems(mutate('row', /\}, \(prev, next\) =>/, '}, undefined as any, (prev, next) =>')).length > 0);
mustCatch('a comparator that forgets the ended-ad shading is caught', problems(mutate('row', ' && prev.dead === next.dead', '')).length > 0);
mustCatch('a comparator that compares onOpen (never equal) is caught', problems(mutate('row', /\}, \(prev, next\) =>\n  prev\.listing === next\.listing/, '}, (prev, next) =>\n  prev.onOpen === next.onOpen && prev.listing === next.listing')).length > 0);
mustCatch('the un-remembered read-aloud builder is caught', problems(mutate('agent', 'buildResultsReadAloudSegmentsCached(introText, m.result.listings, shown,', 'buildResultsReadAloudSegments(introText, m.result.listings.slice(0, shown),')).length > 0);
mustCatch('the feedback row recomputing on every render is caught', problems(mutate('feedback', '{speakable ? (', '{hasSpeakableContent(readAloudSegments) ? (')).length > 0);
mustCatch('an IntersectionObserver over the grid cells coming back is caught', problems({ ...real, scrollCalm: real.scrollCalm + '\nconst io = new IntersectionObserver(() => {});' }).length > 0);
mustCatch('a comment mentioning ResultCardRow does not satisfy the wiring check', problems(mutate('agent', '<ResultCardRow', '/* <ResultCardRow */ <MemoResultCard')).length > 0);

// ── the remembered read-aloud script, EXECUTED ──────────────────────────────────────────────────
type Seg = { text: string; pauseAfterMs: number };
const prelude = [
  'type Listing = { id: number };', 'type ReadAloudSegment = { text: string; pauseAfterMs: number };',
  'const __calls: number[] = []; (globalThis as any).__calls = __calls;',
  'function buildResultsReadAloudSegments(_s: string, l: Listing[], _n?: string, _loc: string = "ar"): ReadAloudSegment[] { __calls.push(l.length); return l.map((x) => ({ text: String(x.id), pauseAfterMs: 0 })); }',
].join('\n');
const lifted = (file: string) => liftSymbols(file, [
  { header: 'const spokenCache = new WeakMap', endsWith: /^const spokenCache = .*;$/ },
  { header: 'export function buildResultsReadAloudSegmentsCached(', endsWith: /^\}$/ },
], ['buildResultsReadAloudSegmentsCached'], prelude);
type CachedFn = (summary: string, all: { id: number }[], shown: number, note?: string, locale?: 'ar' | 'en') => Seg[];
const behaves = async (file: string): Promise<string[]> => {
  const bad: string[] = [];
  const fn = (await lifted(file)).buildResultsReadAloudSegmentsCached as CachedFn;
  const calls = (globalThis as unknown as { __calls: number[] }).__calls; calls.length = 0;
  const list = Array.from({ length: 500 }, (_, i) => ({ id: i }));
  const a = fn('hi', list, 500, 'note', 'ar'); const b = fn('hi', list, 500, 'note', 'ar');
  if (a !== b) bad.push('the same inputs did not give the SAME array (the feedback row could never skip)');
  if (calls.length !== 1) bad.push(`the builder ran ${calls.length}× for two identical asks (every key press would pay for 500 cards)`);
  if (a.length !== 500) bad.push(`the script holds ${a.length} cards, not the 500 shown`);
  const c = fn('hi', list, 100, 'note', 'ar');
  if (c === a || c.length !== 100) bad.push('a smaller reveal («shown») reused the longer script');
  if (fn('hi', list, 100, 'other note', 'ar') === c) bad.push('a changed closing note reused the old script');
  if (fn('hi', list, 100, 'other note', 'en') === fn('hi', list, 100, 'other note', 'ar')) bad.push('a changed language reused the old script');
  if (fn('new summary', list, 100, 'other note', 'ar').length !== 100 || calls.length < 5) bad.push('a changed summary was not rebuilt');
  const other = Array.from({ length: 500 }, (_, i) => ({ id: i }));
  const before = calls.length; fn('hi', other, 500, 'note', 'ar');
  if (calls.length === before) bad.push('a NEW fetched list (after «عرض المزيد») reused the old list\'s script');
  return bad;
};
const behaviour = await behaves(join(root, 'src/lib/readAloudScript.ts'));
check('the read-aloud script is remembered per list, and rebuilt when the list, count, note, summary or language changes', behaviour.length === 0, behaviour.join('\n      '));
{
  // MUTATION: a version that never reuses (the cache check removed) must be caught by the same behaviour test
  const { writeFileSync, mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-readaloud-mut-')); const f = join(dir, 'readAloudScript.ts');
  const src = real.readAloud.replace('if (hit && hit.key === key) return hit.segments;', '');
  if (src === real.readAloud) throw new Error('mutation anchor missing in readAloudScript.ts');
  writeFileSync(f, src);
  mustCatch('a read-aloud builder that never reuses its answer is caught', (await behaves(f)).length > 0);
}

// ── the placeholder heights, EXECUTED against what was measured ─────────────────────────────────
type Cols = 2 | 3 | undefined; type Row = 'roomy' | 'tight' | undefined;
const heightFn = async (file: string) => (await liftSymbols(file, [{ header: 'const STILL_CARD_HEIGHT = ', endsWith: /^  cols === 3 \? .*;$/ }], ['STILL_CARD_HEIGHT'])).STILL_CARD_HEIGHT as (c: Cols, r: Row) => number;
// MEASURED medians of the real card height, production build, 2026-10-25 (a not-yet-drawn card must be assumed this tall,
// or a reopened chat's page is the wrong height until every card has been drawn once).
const MEASURED: [string, Cols, Row, number][] = [
  ['phone', undefined, undefined, 367], ['laptop, three across', 3, 'roomy', 396], ['laptop, two across (1280 px)', 2, 'roomy', 463],
  ['laptop, two across (1100 px)', 2, 'roomy', 414], ['laptop, ad pane open', undefined, 'tight', 148],
];
const heightProblems = (fn: (c: Cols, r: Row) => number) =>
  MEASURED.filter(([, c, r, med]) => Math.abs(fn(c, r) - med) / med > 0.15).map(([n, c, r, med]) => `${n}: placeholder ${fn(c, r)} px vs a real ~${med} px`);
const hp = heightProblems(await heightFn(join(root, 'src/app/agent.tsx')));
check('every layout\'s placeholder is within 15 % of the card\'s measured height (a reopened page keeps its true height)', hp.length === 0, hp.join('\n      '));
mustCatch('the old 140 px placeholder on a three-across laptop is caught', heightProblems((c, r) => (r ? 140 : 340) + (c ? 0 : 0)).length > 0);

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\n✓ typing in a big saved chat re-renders no cards, and a reopened chat knows its height');
