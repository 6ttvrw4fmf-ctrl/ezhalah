// THE LIVE SWEEP MUST DRIVE CONTROLS THAT ACTUALLY EXIST.
//
// THE DEFECT THIS PINS (2026-08-29). On 2026-08-28 the owner removed the in-question
// «عرض النتائج» early-exit from the entire Advanced Filter flow (PR #1216, contract R8.3.1): the
// footer is متابعة / تخطي / رجوع, and a round ends by WALKING its questions. That PR updated
// `scripts/verify-af-live-truth.ts` — and missed `e2e/live-sweep/journeys.mjs`, which went on
// clicking a control that no longer existed and then fell back to a SINGLE «متابعة».
//
// Against a four-question round (AF_ROUND_MAX_QUESTIONS = 4, R6.1.1) one متابعة advances to
// question 2 and stops. No round end, no results turn, no candidates request — and the headline
// still showing the PRE-AF total. The next sweep reported four confident P1-shaped defects:
//
//   «AF chip «٢٠ م فأكثر» promised 6,524, landed 12,097»      ← 12,097 was the pre-AF total
//   «AF chip «9.5+» promised 5,010, landed 9,019»             ← 9,019 was the pre-AF total
//   «the search sent no candidates request at all» ×2         ← the round never ended
//
// Production was correct on every layer. Measured the same day by walking the round properly:
// 6,524 = footer = landed = RPC = independent PostgREST oracle, and 5,000 likewise. §40.7 —
// a harness failure reported as a product failure is its own defect, and this is the barrier for
// the class: **every AF control the sweep drives must be one the product still renders.**
//
// The check is possible because the card exposes stable testIDs (`af-card`, `af-question-title`,
// `af-option-*`, `af-confirm`, `af-skip`, `af-back`), added 2026-08-22 so a production browser test
// can address it. Driving the card by those hooks makes harness/product drift a BUILD failure
// instead of a silent false alarm in production.
//
//   node --experimental-strip-types scripts/verify-live-sweep-af-controls.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nLive sweep — the AF controls it drives must be controls the product renders\n');

const CARD = 'src/components/AdvancedQuestionCard.tsx';
const JOURNEYS = 'e2e/live-sweep/journeys.mjs';
const cardSrc = read(CARD);
const journeysSrc = read(JOURNEYS);
const journeys = codeOnly(journeysSrc);

// Isolate the AF journey so an unrelated journey's selectors cannot satisfy these checks.
const afStart = journeys.indexOf('export async function advancedFilter');
const afEnd = journeys.indexOf('export async function', afStart + 10);
const af = afStart >= 0 ? journeys.slice(afStart, afEnd > afStart ? afEnd : undefined) : '';
check('the AF journey exists in the live sweep', af.length > 0);

// ── 1. every testID the AF journey drives is one the card actually renders ───────────────────────
// The product side is the SOURCE of the list; the harness is checked against it, never the reverse.
const rendered = new Set<string>();
for (const m of cardSrc.matchAll(/testID=\{?["'`]([a-z0-9-]+)/gi)) rendered.add(m[1]);
for (const m of cardSrc.matchAll(/testID=\{`([a-z0-9-]+)-\$\{/gi)) rendered.add(`${m[1]}-*`);
check('the AF card renders the testIDs this check depends on',
  ['af-card', 'af-question-title', 'af-confirm', 'af-skip'].every((t) => rendered.has(t)),
  `card renders: ${[...rendered].sort().join(', ')}`);

const driven = new Set<string>();
for (const m of af.matchAll(/data-testid="([a-z0-9-]+)"/gi)) driven.add(m[1]);
for (const m of af.matchAll(/data-testid="([a-z0-9-]+)-\$\{/gi)) driven.add(`${m[1]}-*`);
for (const m of af.matchAll(/data-testid\^="([a-z0-9-]+)-"/gi)) driven.add(`${m[1]}-*`);

check('the AF journey addresses the card by testID at all', driven.size > 0,
  'scraping body text instead reads the RESULT CARDS behind the overlay — a text reader on this '
  + 'screen returned «رقم رخصة الإعلان / 7100249846» as if it were one of the question\'s options');

const unknown = [...driven].filter((d) => !rendered.has(d));
check('every testID the AF journey drives is rendered by the AF card', unknown.length === 0,
  `driven but not rendered: ${unknown.join(', ')} — the product moved and the harness did not, `
  + 'which is exactly how a healthy production reads as broken');

// ── 2. the removed «عرض النتائج» early-exit is never DRIVEN (R8.3.1) ─────────────────────────────
// Asserting its ABSENCE is fine and wanted; clicking it is the drift this file exists for.
const drivesShowResults = /(?:getByText|click|fire|locator)\s*\(\s*['"`][^'"`]*عرض النتائج/.test(af);
check('the AF journey never drives «عرض النتائج» (removed from the flow by the owner, 2026-08-28)',
  !drivesShowResults,
  'the footer is متابعة / تخطي / رجوع; clicking a control the product removed advances nothing, '
  + 'so the round never ends and the pre-AF headline is misread as the landed count');

check('…and the card itself still has no «عرض النتائج» action',
  !/testID=["'`]af-skip-all/.test(cardSrc) && !/onSkipAll/.test(codeOnly(cardSrc)),
  'the in-question early-exit came back — that is a product change, not a harness one');

// ── 3. the journey WALKS the round to its end ────────────────────────────────────────────────────
// One confirm is not a round. A round ends when its questions are exhausted.
check('the AF journey commits its answer with af-confirm',
  /data-testid="af-confirm"/.test(af));
check('…and then skips the REMAINING questions in a bounded loop until the round ends',
  /for\s*\([^)]*hop[^)]*\)/.test(af) && /data-testid="af-skip"/.test(af),
  'AF_ROUND_MAX_QUESTIONS is 4 (R6.1.1) — a single advance leaves a 4-question round unfinished, '
  + 'with no results turn and no candidates request');
check('…and stops when the card is gone or has no تخطي (intro/mining state)',
  /af-card"\]\)\s*\)?;?[\s\S]{0,120}?if\s*\(!open\)\s*break/.test(af)
  || /if\s*\(!open\)\s*break/.test(af),
  'an unbounded or unguarded loop hangs the sweep instead of failing it');

// ── 4. the invariant it is all for: promised count == landed count ───────────────────────────────
check('the journey still asserts the chip\'s promised count against the count the user lands on',
  /promised\s*!==\s*landed/.test(af) || /promised\s*!==\s*landed/.test(af.replace(/\s+/g, ' ')),
  'this is the AF contract invariant (R7.1.1/R7.1.2) the journey exists to check');
check('…and asserts the «متابعة» footer moves to the tentative selection (R7.1.2)',
  /footAfter\s*!==\s*promised/.test(af));

// ── 5. MUTATION PROOFS — each check must FAIL on the exact source that shipped the false alarms ──
type Mutation = { name: string; apply: (s: string) => string; predicate: (afSrc: string, card: string) => boolean };
const mutations: Mutation[] = [
  {
    name: 'the pre-fix journey: clicks the removed «عرض النتائج»',
    apply: (s) => s.replace(/const first = await readCard\(\);/,
      "await page.getByText('عرض النتائج', { exact: false }).first().click();\n    const first = await readCard();"),
    predicate: (a) => !/(?:getByText|click|fire|locator)\s*\(\s*['"`][^'"`]*عرض النتائج/.test(a),
  },
  {
    name: 'the pre-fix journey: one advance, no skip-out loop',
    apply: (s) => s.replace(/for \(let hop = 0; hop < 8; hop\+\+\) \{[\s\S]*?\n    \}/, '/* single advance only */'),
    predicate: (a) => /for\s*\([^)]*hop[^)]*\)/.test(a) && /data-testid="af-skip"/.test(a),
  },
  {
    name: 'the journey drives a testID the card does not render',
    apply: (s) => s.replace('data-testid="af-confirm"', 'data-testid="af-show-results"'),
    predicate: (a) => {
      const d = new Set<string>();
      for (const m of a.matchAll(/data-testid="([a-z0-9-]+)"/gi)) d.add(m[1]);
      for (const m of a.matchAll(/data-testid\^="([a-z0-9-]+)-"/gi)) d.add(`${m[1]}-*`);
      return [...d].every((x) => rendered.has(x));
    },
  },
  {
    name: 'the promised-vs-landed assertion is dropped',
    apply: (s) => s.replace(/promised !== landed/, 'false'),
    predicate: (a) => /promised\s*!==\s*landed/.test(a),
  },
  {
    name: 'the footer/tentative-selection assertion is dropped',
    apply: (s) => s.replace(/footAfter !== promised/, 'false'),
    predicate: (a) => /footAfter\s*!==\s*promised/.test(a),
  },
];

for (const m of mutations) {
  const mutated = codeOnly(m.apply(journeysSrc));
  const s = mutated.indexOf('export async function advancedFilter');
  const e = mutated.indexOf('export async function', s + 10);
  const mutatedAf = s >= 0 ? mutated.slice(s, e > s ? e : undefined) : '';
  check(`mutation caught — ${m.name}`, !m.predicate(mutatedAf, cardSrc),
    'this check passes on deliberately broken source, so it protects nothing');
}

// ── 6. wiring ────────────────────────────────────────────────────────────────────────────────────
check('this barrier runs in `npm test`', npmTestRuns(root, 'verify-live-sweep-af-controls'));

if (failures > 0) {
  console.error(`\nverify-live-sweep-af-controls: ${failures} FAILED`);
  process.exit(1);
}
console.log('\nverify-live-sweep-af-controls: all checks passed');
