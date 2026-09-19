// THE RESULTS-FOUND SENTENCE ROTATES — EVERY PARSER OF IT MUST BE DERIVED, NOT RESTATED.
//
// Earned 2026-09-19 (routine #4, alert 3993). PR #3186 replaced the fixed
// «لقينا {n} إعلان يطابق طلبك.» with a rotation over four pools. The live sweep's parser pinned the
// retired wording, so on the very next run:
//
//   · `headline` was null on ALL 8 journeys — including الرياض with 41,330 matches;
//   · that null silently disabled the RPC→RENDERED comparison, the one layer only a browser can
//     see, and the run still printed «RPC→RENDERED MISMATCHES: 0»;
//   · the `true-total-never-page-cap` watch could only be ticked by an honest-ZERO screen, which can
//     never display the 1,500 page cap it guards.
//
// The product was right the whole time: production rendered «بحثك رجّع لنا 41,330 نتيجة 🥳» against
// an RPC total_count of exactly 41330. Only the harness was wrong, and it was wrong QUIETLY.
//
// This barrier EXECUTES the shipped matcher against the shipped pool. It does not grep for a regex,
// because a source-text tripwire over these exact lines is the shape AGENTS.md records five
// 2026-09-04 defects wearing — and two of those tripwires pinned the defective line as correct.
//
// Runs offline and hermetically: it reads the repo and executes its own code. No network, no DB.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import {
  shippedTemplates, templateToRegex, resultsFoundCount, matchersFor, searchSettled, settledSource,
  resultsSentenceSource, resultsSentenceAtStartSource,
} from '../e2e/lib/resultsSentence.mjs';
import { __testing } from '../src/data/resultsFoundRotation.ts';
import { stripComments } from './lib/stripComments.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failed++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nResults-Found sentence — every parser tracks the shipped pool\n');

// ── 1. The harness's source read sees EXACTLY the module the app ships. ──────────────────────────
// The harness is plain .mjs run by bare `node` and cannot import the .ts pool, so it reads the file.
// This is the join that makes "read the file" and "what the app uses" the same set, by execution.
const fromSource = shippedTemplates();
const fromModule = __testing.BAKED;
check('the source read recovers every shipped template',
  fromSource.length === fromModule.length,
  `source read ${fromSource.length}, module exports ${fromModule.length}`);

const key = (t: { lang: string; hasName: boolean; template: string }) => `${t.lang}|${t.hasName}|${t.template}`;
const srcKeys = new Set(fromSource.map(key));
const modKeys = new Set(fromModule.map(key));
const onlyModule = [...modKeys].filter((k) => !srcKeys.has(k));
const onlySource = [...srcKeys].filter((k) => !modKeys.has(k));
check('the two readings agree template-for-template, byte-for-byte',
  onlyModule.length === 0 && onlySource.length === 0,
  `only in module: ${onlyModule.slice(0, 3).join(' / ') || '—'}\n      only in source read: ${onlySource.slice(0, 3).join(' / ') || '—'}`);

// ── 2. EVERY shipped template round-trips its count through the matcher. ─────────────────────────
// This is the assertion the old hand-written regex could not make. Note the counts chosen: one below
// the page cap, one AT it, one above, and one with no separator.
const pool = matchersFor(fromSource);
const COUNTS: Array<[string, number]> = [['7', 7], ['1,500', 1500], ['41,330', 41330], ['٤١٬٣٣٠', 41330]];
const misses: string[] = [];
for (const t of fromSource) {
  for (const [rendered, expect] of COUNTS) {
    const text = `نتائج البحث\n${t.template.replace('{count}', rendered).replace(/\{name\}/g, 'فهد')}\nالضغط على هذا الإعلان`;
    const got = resultsFoundCount(text, pool);
    if (got !== expect) misses.push(`${t.lang}/${t.hasName ? 'named' : 'guest'} «${t.template}» @${rendered} → ${got}`);
  }
}
check(`all ${fromSource.length} templates round-trip a count (${COUNTS.length} renderings each)`,
  misses.length === 0, misses.slice(0, 4).join('\n      '));

// ── 2b. A TRANSCRIPT ACCUMULATES — the LATEST sentence wins, by document position. ──────────────
// The Advanced Filter path renders a broad Results-Found sentence, then a narrowed one after the
// answer commits, and the two are usually different templates. Picking by pool order instead of
// document order reads the stale count and reports the PRODUCT for the harness's own mistake —
// measured live on 2026-09-19 as «rendered 12,118 vs RPC 6,155» on a healthy search.
{
  const guests = fromSource.filter((t) => t.lang === 'ar' && !t.hasName);
  let wrongOrder = 0;
  // Every ordered PAIR of distinct templates, so no pool ordering can pass by luck.
  for (const a of guests) {
    for (const b of guests) {
      if (a.template === b.template) continue;
      const transcript = [
        a.template.replace('{count}', '12,118'),   // the earlier, broader turn
        'ملخص البحث',
        b.template.replace('{count}', '6,155'),    // the later, narrowed turn — this must win
      ].join('\n');
      if (resultsFoundCount(transcript, pool) !== 6155) wrongOrder++;
    }
  }
  check(`the LAST sentence by document position wins across all ${guests.length * (guests.length - 1)} template pairs`,
    wrongOrder === 0, `${wrongOrder} pair(s) returned the earlier count`);
}

// ── 3. The in-browser clock and the node-side clock are the SAME predicate. ──────────────────────
// settledSource() is evaluated inside page.waitForFunction, where searchSettled() cannot reach. If
// the two ever disagree the harness waits on one rule and judges by another.
const inBrowser = new RegExp(settledSource());
const clockSplits: string[] = [];
for (const t of fromSource) {
  const text = t.template.replace('{count}', '41,330').replace(/\{name\}/g, 'فهد');
  if (inBrowser.test(text) !== searchSettled(text)) clockSplits.push(t.template);
}
for (const z of ['ما لقينا نتائج', 'ما لقيت نتائج في الحي المحدد', 'ما فيه نتائج']) {
  if (inBrowser.test(z) !== searchSettled(z)) clockSplits.push(z);
}
check('the in-browser settle source and searchSettled() agree on every template and zero-state',
  clockSplits.length === 0, clockSplits.slice(0, 3).join(' / '));
check('an unsettled screen is not mistaken for a settled one',
  !searchSettled('جاري البحث') && !inBrowser.test('جاري البحث'));

// ── 3b. THE POOL-ONLY IN-PAGE SOURCES COVER EVERY TEMPLATE TOO. ─────────────────────────────────
//
// FOUND BY A MUTANT SURVIVAL SWEEP (routine #10, 2026-09-19): `resultsSentenceSource()` could be
// cut to its FIRST template — 1 of 40 — and the entire 479-check suite stayed GREEN. Section 3
// above exercises `settledSource()` per template, and that read as coverage for all three sources.
// It is not the same function: settledSource() admits ZERO_RE, so a screen that merely says «ما
// لقينا نتائج» satisfies it, and the pool half can rot underneath.
//
// These two are what the per-NODE readers compile inside the browser — e2e/ui-parity.spec.ts's
// FOUND, scripts/lib/afOfferLive.ts's HAS_TURN_SRC, and the AF live journeys' headline walkers. A
// source that covers one template makes all of them blind on the other nine, silently, which is the
// precise failure this whole file exists to prevent — arriving through the DERIVED path rather than
// a hand-pinned one.
{
  const unanchored = new RegExp(resultsSentenceSource(pool));
  const atStart = new RegExp(resultsSentenceAtStartSource(pool));
  const missUnanchored: string[] = [];
  const missAtStart: string[] = [];
  for (const t of fromSource) {
    const rendered = t.template.replace('{count}', '41,330').replace(/\{name\}/g, 'فهد');
    // Unanchored: the whole-body reader. Anchored: the leaf-node reader, so the sentence IS the node.
    if (!unanchored.test(`نتائج البحث\n${rendered}\nالضغط على هذا الإعلان`)) missUnanchored.push(t.template);
    if (!atStart.test(rendered)) missAtStart.push(t.template);
  }
  check(`resultsSentenceSource() matches all ${fromSource.length} shipped templates (the in-page whole-body reader)`,
    missUnanchored.length === 0, missUnanchored.slice(0, 4).join('\n      '));
  check(`resultsSentenceAtStartSource() matches all ${fromSource.length} shipped templates (the in-page leaf reader)`,
    missAtStart.length === 0, missAtStart.slice(0, 4).join('\n      '));
  // Both directions: the pool-only sources must NOT admit a zero-state or an unsettled screen —
  // that is settledSource()'s job, and conflating them hands a caller a "headline" with no count.
  check('the pool-only sources do NOT admit an honest-zero screen (that is settledSource\'s job)',
    !unanchored.test('ما لقينا نتائج') && !atStart.test('ما لقينا نتائج'));
  check('…nor an unsettled one', !unanchored.test('جاري البحث') && !atStart.test('جاري البحث'));
  // The ANCHOR is load-bearing: a wrapper node holding the whole transcript must not read as a
  // headline, or a leaf reader returns the entire page as one "headline".
  check('the anchored source refuses a wrapper node that merely CONTAINS the sentence',
    !atStart.test(`ملخص البحث\n${fromSource[0].template.replace('{count}', '41,330')}`));
}

// ── 4. A count that is absent stays ABSENT — never a zero. ───────────────────────────────────────
// AGENTS.md: silent → NULL, never unknown → NO. A screen with no sentence must not read as "0 found".
check('no sentence on screen → null, never 0',
  resultsFoundCount('جاري البحث') === null && resultsFoundCount('') === null);
check('an honest-zero screen states zero without quoting a count',
  resultsFoundCount('ما لقينا نتائج') === null && searchSettled('ما لقينا نتائج'));

// ── 5. The retired wording is no longer what anything depends on. ────────────────────────────────
check('the retired «لقينا N إعلان» is not required by the matcher',
  resultsFoundCount('لقينا 1,500 إعلان يطابق طلبك.') === null);

// ── 6. EVERY BROWSER-DRIVING PARSER OF THIS SENTENCE IS DISCOVERED, NOT LISTED. ──────────────────
//
// THIS SECTION WAS A THREE-FILE LIST, AND THE LIST READ AS COVERAGE (routine #5, 2026-09-19).
// It named e2e/live-sweep/{visibleState,sweep,journeys}.mjs — the files routine #4 had just fixed —
// so it was green all day on 2026-09-19 while FOUR Advanced-Filter live journeys, none of them on
// the list, still pinned the retired «لقينا N إعلان» and were red against a correct production:
//
//   verify-af-pill-removal-live.ts · verify-af-remove-last-pill-live.ts
//   verify-af-scope-change-live.ts · verify-af-option-card-truth-live.ts
//
// Measured that afternoon on الرياض/شقة: the RPC returned 13,489, the page quoted 13,489, and the
// retired regex matched NOWHERE — so READ_HEADLINES returned [] and the assertions that read it
// failed while the count layer beside them passed. Worse, verify-af-option-card-truth-live.ts's
// READ_TURN_CARDS does not go blind when it misses; it falls back to counting EVERY card on the
// page, silently inflating the newest turn's reveal. That is a wrong answer, not a missing one.
//
// A list cannot cover a class. This discovers the population by SHAPE — every file that drives a
// real browser — and fails on any member that hand-pins this sentence instead of importing the
// derived matcher. A fifth journey written tomorrow is covered without anyone editing this file,
// which is the same rule AGENTS.md pins for the MATCH-FIRST stage registry.
const rel = (p: string) => p.slice(ROOT.length + 1);
// THE IN-FILE STRIPPER ONLY REMOVED WHOLE-LINE `//` COMMENTS, and a retired regex quoted inside a
// JSDoc block therefore read as live code — e2e/lib/resultsSentence.mjs, the DERIVED module itself,
// was flagged by its own documentation. scripts/lib/stripComments.ts is the shared, block-aware one
// this repo already requires every source-shape assertion to run first; use it, do not re-roll it.

/**
 * "This file reaches a real browser itself", as a PURE predicate so the mutation block can execute
 * it against synthetic sources rather than trust that the walk "would have" found something.
 *
 * THE MARKERS ARE SPELLED WITH A ONE-CHARACTER CLASS ON PURPOSE — do not "tidy" them.
 * A sibling barrier (verify-live-nav-retries-transport-only.ts) discovers the live-browser
 * population by looking for the playwright import marker in a file's source. This file only ever
 * MENTIONS that marker; it drives no browser and is hermetic. Writing the marker whole here enlists
 * this offline barrier into that file's production-browser population, and it fails demanding this
 * file serve its own build. `playwrigh[t]` matches the real import while not BEING one.
 *
 * `@?playwrigh[t](?:/test)?` is the widening that mattered: every miss listed on browserDrivingFiles()
 * was a `@playwright/test` import, and most of them were `await import(...)` rather than `from`.
 */
export const DRIVES_A_BROWSER =
  /from '@?playwrigh[t](?:\/test)?'|import\('@?playwrigh[t](?:\/test)?'\)|from '\.[^']*liveNav|gotoLiv[e]\(/;

/**
 * Every file under scripts/ and e2e/ that drives a real browser.
 *
 * THE SHAPE SELECTOR WAS ITSELF A NARROW LIST, AND IT READ AS A POPULATION (routine #10,
 * 2026-09-19). The section above replaced a three-file list with discovery-by-shape, and was green
 * within the day — while FIVE measured-blind parsers sat outside the shape it discovered, because
 * the marker was the bare `playwrigh[t]` import spelling and this repo imports `@playwrigh[t]/test`,
 * usually lazily (the one-character class is load-bearing here too — see DRIVES_A_BROWSER):
 *
 *   e2e/guardian/harness.mjs      `await import('@playwright/test')` — SETTLED_RE saw a settled
 *                                 search on 4 of 10 AR templates, countChip on 0 of 10.
 *   e2e/ui-parity.spec.ts         `from '@playwright/test'` — FOUND matched 0 of 10, so runSearch()
 *                                 waited out its full 60s and failed a correct production.
 *   scripts/prove-rent-basis-live.mjs  lazy import — `shown` read null, so check (a) accused the
 *                                 served page of quoting the wrong headline.
 *   e2e/redteam/run.mjs           drives no browser ITSELF; it imports chain.mjs, which does. L5,
 *                                 the DISPLAYED count, quietly stopped being a layer.
 *   e2e/live-sweep/showmore.mjs   same transitive shape, carrying a retired alternative.
 *
 * So the population is now: files that import playwright UNDER ANY SPELLING, statically or
 * dynamically, PLUS the transitive closure over local imports — a harness that reaches a browser
 * through a helper is driving one. Measured: 18 files under the old selector, 48 under this one.
 */
const browserDrivingFiles = (): string[] => {
  const all: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== 'node_modules') walk(p); continue; }
      if (/\.(ts|mjs)$/.test(ent.name)) all.push(p);
    }
  };
  walk(join(ROOT, 'scripts'));
  walk(join(ROOT, 'e2e'));
  const src = new Map(all.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));
  const driving = new Set(all.filter((f) => DRIVES_A_BROWSER.test(src.get(f)!)));
  // A file that imports a browser-driving module is driving a browser through it. Iterate to a
  // fixed point rather than one hop: run.mjs → chain.mjs is one hop today, two tomorrow.
  // BOTH import forms. `scripts/prove-rent-basis-live.mjs` reaches a browser through
  // `await import('../e2e/live-sweep/sweep.mjs')` and carries no `from` for it — a static-only
  // closure left it outside the population, which the measured-blind ratchet below caught.
  const localImports = (f: string) => [
    ...src.get(f)!.matchAll(/from '(\.[^']*)'/g),
    ...src.get(f)!.matchAll(/\bimport\('(\.[^']*)'\)/g),
  ].map((m) => resolve(dirname(f), m[1])).filter((p) => src.has(p));
  // A DOM-READING HELPER OF A BROWSER DRIVER IS DRIVING THE BROWSER, and the closure has to travel
  // the other way to reach it. scripts/lib/afOfferLive.ts is imported BY four AF live journeys and
  // imports none of them, so an importer-only closure left it outside — while its `HAS_TURN_SRC`
  // pinned the retired «لقينا N إعلان», returned false on every real results turn, and made all four
  // journeys stand down as `reason: 'no-turn'` without testing anything. The edge is bounded by
  // "reads the DOM": a helper that never touches `document`/`page` is not a parser of the page.
  const READS_THE_DOM = /document\.|page\.evaluate|innerText|textContent/;
  for (let changed = true; changed;) {
    changed = false;
    for (const f of all) {
      if (driving.has(f)) continue;
      const reachesADriver = localImports(f).some((p) => driving.has(p));
      const isAHelperOfADriver = READS_THE_DOM.test(src.get(f)!)
        && all.some((d) => driving.has(d) && localImports(d).includes(f));
      if (reachesADriver || isAHelperOfADriver) { driving.add(f); changed = true; }
    }
  }
  return [...driving].sort();
};

const IMPORTS_DERIVED = /from '[^']*resultsSentence\.mjs'/;

/** Every regex LITERAL in a source file, as its pattern text. */
const regexLiterals = (code: string): string[] =>
  [...code.matchAll(/\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/[gimsuy]*/g)].map((m) => m[1]);

/**
 * THE RETIRED RESULTS-FOUND SIGNATURE, judged one regex LITERAL at a time.
 *
 * It used to be two whole-file regexes, and the narrower of them missed a real parser: e2e/redteam/
 * run.mjs read the displayed count with `/لقينا\s+([\d,،]+)/` — «لقينا» bound to a capture with NO
 * noun after it — and the old RETIRED_PARSER required «إعلان», so L5 (the DISPLAYED count, the one
 * layer only a browser can see) was blind AND unflagged at the same time. A predicate that asks
 * "does this FILE contain the retired shape" also cannot separate a retired parser from a
 * legitimate neighbour two lines above it; a predicate over literals can.
 *
 * A literal is a retired Results-Found parser when it invokes «لقينا» AND
 *   (a) names the retired noun «إعلان», or
 *   (b) carries a numeric class or capture — it is reading a COUNT off that sentence, or
 *   (c) is the retired CLOCK, i.e. a bare «لقينا» alternative such as /لقينا|ما لقيت|ما فيه/,
 *       which 6 of the 10 AR guest templates defeat.
 *
 * Two legitimate neighbours are excluded by construction, and both have their own mutation proof
 * below, because a rule that flagged them would be switched off within a week:
 *   · the mining phase's owner-authored found-beat «لقينا N عقار أقرب لطلبك» (MiningTransition) —
 *     it names «عقار», and it is not the results sentence;
 *   · the honest-zero statements «ما لقينا …», which are hand-written on purpose and covered by
 *     ZERO_RE rather than by the pool. Every «لقينا» in them is preceded by «ما ».
 */
const isRetiredResultsParser = (lit: string): boolean => {
  if (!lit.includes('لقينا')) return false;
  if (lit.includes('عقار')) return false;                       // the mining found-beat
  const bareLoqina = /(?<!ما\s)لقينا/.test(lit);                // not a «ما لقينا» zero statement
  if (!bareLoqina) return false;
  const namesRetiredNoun = lit.includes('إعلان');
  const readsACount = /\\d|٠-٩|\[\d/.test(lit);
  const isTheClock = /(?<!ما\s)لقينا(\||$)/.test(lit);
  return namesRetiredNoun || readsACount || isTheClock;
};

/**
 * THE PREDICATE, as a pure function — so the mutation block below can execute it against synthetic
 * files instead of trusting that the loop "would have" caught something. A discovery rule nobody has
 * watched fail is the same dark barrier this whole file exists to prevent.
 */
const pinsRetiredWording = (code: string): boolean =>
  regexLiterals(code).some(isRetiredResultsParser) && !IMPORTS_DERIVED.test(code);

const offenders: string[] = [];
let scanned = 0;
for (const file of browserDrivingFiles()) {
  const name = rel(file);
  if (name === rel(join(ROOT, 'scripts', 'verify-results-sentence-parsers-track-the-pool.ts'))) continue;
  const code = stripComments(readFileSync(file, 'utf8'));
  scanned++;
  if (pinsRetiredWording(code)) offenders.push(name);
}
check(`every browser-driving parser of the Results-Found sentence is derived (${scanned} file(s) scanned)`,
  offenders.length === 0,
  offenders.length
    ? `these hand-pin the retired wording and do NOT import e2e/lib/resultsSentence.mjs:\n      `
      + `${offenders.join('\n      ')}\n      `
      + 'Import { resultsFoundCount, resultsSentenceSource } and delete the private regex. A parser '
      + 'restated beside the pool goes blind the next time the owner edits a template.'
    : '');
// THE FLOOR USED TO BE `scanned >= 10`, AND IT PASSED WHILE THE POPULATION WAS MISSING 30 OF 48.
// A magic minimum cannot tell a complete population from a fifth of one — it only says the walk is
// not literally empty. Two assertions replace it, both shrink-only:
//
//  (1) a measured SIZE floor, so a selector that narrows again is loud rather than plausible;
//  (2) the five files whose blindness was MEASURED on production (ops_incident #330) are IN the
//      population, by name. That is a ratchet over discovery, not a return to the three-file list:
//      membership is still decided by shape, and these names only pin that the shape did not
//      shrink back past the evidence that widened it.
const POPULATION_FLOOR = 40; // measured 48 on 2026-09-19; shrink-only, raise it, never lower it.
check(`the discovery really found the browser-driving population (${scanned} files)`,
  scanned >= POPULATION_FLOOR,
  `only ${scanned} file(s) matched the browser-driving shape (floor ${POPULATION_FLOOR}) — the `
  + 'selector has narrowed. It was 18 the morning five measured-blind parsers hid outside it.');

const population = new Set(browserDrivingFiles().map(rel));
const MEASURED_BLIND = [
  'e2e/guardian/harness.mjs', 'e2e/ui-parity.spec.ts', 'scripts/prove-rent-basis-live.mjs',
  'e2e/redteam/run.mjs', 'e2e/live-sweep/showmore.mjs', 'scripts/lib/afOfferLive.ts',
];
const escaped = MEASURED_BLIND.filter((f) => !population.has(f));
check('every parser whose blindness was measured on production is inside the population',
  escaped.length === 0,
  `outside the browser-driving population: ${escaped.join(', ')} — the discovery shape has narrowed `
  + 'past the evidence that widened it (ops_incident #330).');

// The sweep's own three files additionally owe the POSITIVE half: they must call the derived module.
for (const relPath of ['e2e/live-sweep/visibleState.mjs', 'e2e/live-sweep/sweep.mjs', 'e2e/live-sweep/journeys.mjs']) {
  const code = stripComments(readFileSync(join(ROOT, relPath), 'utf8'));
  check(`${relPath} imports the derived matcher`, /from '\.\.?\/(?:\.\.\/)?lib\/resultsSentence\.mjs'/.test(code));
}

// ── 7. THE CLASS GUARD: a blind parse must be a DEFECT, not a silent skip. ──────────────────────
// The sweep gates its RPC→RENDERED comparison on a readable total. If that gate ever goes back to
// failing open, the layer disappears again exactly as it did on 2026-09-19.
const sweepSrc = readFileSync(join(ROOT, 'e2e/live-sweep/sweep.mjs'), 'utf8');
check('a journey with rows but no readable total raises a defect',
  /rendered == null && j\.rpc > 0 && !ui\.zero/.test(sweepSrc),
  'sweep.mjs no longer treats an unreadable total as a defect — the RPC→RENDERED layer can go dark silently again');
check('the page-cap watch is not ticked by a zero screen',
  /rendered != null && rendered > 0 && j\.rpc != null\) observeWatch\('true-total-never-page-cap'\)/.test(sweepSrc),
  'a zero-result screen cannot display 1,500 — ticking the watch there is theatre');

// ── 8. MUTATION PROOFS — watch the barrier go red on the real defect. ───────────────────────────
// Each mutant is the defect as it actually shipped. A proof that cannot fail is not a proof, so the
// verdict is computed, never a literal.
console.log('\n  mutation proofs (the defect as it shipped, replayed):');
let mutantsRun = 0; let mutantsKilled = 0;
const mustCatch = (label: string, caught: boolean) => {
  mutantsRun++;
  if (caught) { mutantsKilled++; console.log(`    ✓ killed: ${label}`); return; }
  failed++; console.log(`    ✗ SURVIVED: ${label}`);
};

// M1 — the retired parser, against the sentence production actually rendered that morning.
const REAL = 'نتائج البحث\nبحثك رجّع لنا 41,330 نتيجة 🥳\nالضغط على هذا الإعلان سيأخذك إلى rakez.sa';
const retiredParser = (text: string) => {
  const m = [...String(text).matchAll(/لقينا\s+([\d,٬]+)\s+إعلان/g)].pop();
  return m ? Number(m[1].replace(/[,٬]/g, '')) : null;
};
mustCatch('the retired «لقينا N إعلان» parser cannot read the live sentence',
  retiredParser(REAL) === null && resultsFoundCount(REAL) === 41330);

// M2 — the retired CLOCK, against the same sentence.
mustCatch('the retired /لقينا|ما لقيت|ما فيه/ clock cannot see a settled search',
  /لقينا|ما لقيت|ما فيه/.test(REAL) === false && searchSettled(REAL) === true);

// M3 — a pool that grows must extend the matcher with no edit here.
const grown = [...fromSource, { lang: 'ar' as const, hasName: false, template: 'طلع لك {count} خيار جديد 🆕' }];
const grownPool = matchersFor(grown);
mustCatch('a newly-authored template is covered automatically, without touching this barrier',
  resultsFoundCount('طلع لك 88 خيار جديد 🆕', pool) === null
  && resultsFoundCount('طلع لك 88 خيار جديد 🆕', grownPool) === 88);

// M4 — a template whose count is NOT followed by «نتيجة» (the shape a hand-rolled
// /([\d,]+)\s*نتيجة/ heuristic misses). «لقينا نتائج يا {name} وعددها {count} 🏡» is exactly that.
const tailCount = fromModule.find((t) => /وعددها \{count\}/.test(t.template));
const tailText = tailCount ? tailCount.template.replace('{count}', '512').replace(/\{name\}/g, 'نورة') : '';
mustCatch('a template whose {count} is not followed by «نتيجة» is still read',
  !!tailCount && /([\d,٬،]+)\s*نتيجة/.test(tailText) === false && resultsFoundCount(tailText, pool) === 512);

// M5 — the escaping bug this module was first written with: matching the RAW `{name}` placeholder
// instead of its escaped form silently drops all 20 logged-in templates.
const naiveRegex = (template: string) => {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = esc(template).split(/\\\{count\\\}/);
  return new RegExp(parts.map((p) => p.replace(/\{name\}/g, '[^\\n]{1,64}?').replace(/\s+/g, '\\s+')).join('([\\d][\\d,٬،]*)'));
};
const named = fromModule.find((t) => t.hasName && t.lang === 'ar')!;
const namedText = named.template.replace('{count}', '41,330').replace(/\{name\}/g, 'فهد');
mustCatch('the raw-placeholder escaping bug (drops every logged-in template) is caught',
  naiveRegex(named.template).test(namedText) === false && templateToRegex(named.template).test(namedText) === true);

// M6 — the pool-order bug this module shipped with for one sweep run: keep the last match seen
// while iterating templates, rather than the last by document position.
{
  const poolOrder = (text: string) => {
    let best: number | null = null;
    for (const { re } of pool) {
      for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
        const n = Number(String(m[1]).replace(/[,٬،]/g, ''));
        if (Number.isFinite(n)) best = n;          // overwrite unconditionally — the defect
      }
    }
    return best;
  };
  const guests = fromSource.filter((t) => t.lang === 'ar' && !t.hasName);
  // Find a pair the defect actually gets wrong, then prove the shipped code gets it right.
  let caught = false;
  for (const a of guests) {
    for (const b of guests) {
      if (a.template === b.template) continue;
      const transcript = `${a.template.replace('{count}', '12,118')}\n${b.template.replace('{count}', '6,155')}`;
      if (poolOrder(transcript) !== 6155 && resultsFoundCount(transcript, pool) === 6155) caught = true;
    }
  }
  mustCatch('picking by pool order instead of document position (the 12,118-vs-6,155 misread)', caught);
}

// M7-M10 — THE DISCOVERY RULE ITSELF, executed against synthetic files. Added 2026-09-19 (routine
// #5) when this section stopped being a three-file list. Both directions matter: it must flag a real
// offender, and it must NOT flag the legitimate neighbours, or the next engineer silences it.
mustCatch('a NEW browser journey that hand-pins the retired «لقينا N إعلان» is flagged',
  pinsRetiredWording('const re = /^لقينا\\s+[\\d,٬]+\\s+إعلان/;'));
mustCatch('the retired /لقينا|ما لقيت|ما فيه/ CLOCK is flagged too, not just the count parser',
  pinsRetiredWording('await page.waitForFunction(() => /لقينا|ما لقيت|ما فيه/.test(t));'));
mustCatch('a journey that pins nothing and imports the derived matcher is NOT flagged',
  !pinsRetiredWording(`import { resultsFoundCount } from '../e2e/lib/resultsSentence.mjs';\nconst n = resultsFoundCount(t);`));
// The mining phase has its own owner-authored found-beat and the zero-states are legitimately
// hand-written. A rule that flagged those would be turned off within a week.
mustCatch('the mining found-beat «لقينا N عقار أقرب لطلبك» is NOT mistaken for the results sentence',
  !pinsRetiredWording('const mining = /لقينا\\s[\\d,٠-٩]+\\sعقار أقرب لطلبك/.test(body);'));
mustCatch('the honest-zero statement «ما لقينا نتائج» is NOT mistaken for a retired parser',
  !pinsRetiredWording('const zero = /ما لقينا نتائج/.test(body);'));

// M11-M16 — THE DISCOVERY SHAPE ITSELF (routine #10, 2026-09-19). M7-M10 above prove the predicate
// judges a file correctly; these prove the right files are HANDED to it. That is the half that was
// wrong: every mutant below is the exact import spelling that let a measured-blind parser escape.
//
// The old selector is executed beside the new one, so each proof states a DIFFERENCE rather than
// asserting the new one in isolation — a check that only says "the current rule matches" cannot
// tell you the rule ever changed.
const OLD_SELECTOR = /from 'playwrigh[t]'|from '\.[^']*liveNav|gotoLiv[e]\(/;
const widened = (code: string) => DRIVES_A_BROWSER.test(code) && !OLD_SELECTOR.test(code);

mustCatch("a STATIC `from '@playwright/test'` import was invisible to the old selector (ui-parity.spec.ts)",
  widened("import { test, expect } from '@playwrigh" + "t/test';"));
mustCatch("a LAZY `await import('@playwright/test')` was invisible too (guardian/harness.mjs, prove-rent-basis-live.mjs)",
  widened("const { chromium } = await import('@playwrigh" + "t/test');"));
mustCatch('the bare `playwright` spelling the old selector did find is still found',
  DRIVES_A_BROWSER.test("import { chromium } from 'playwrigh" + "t';"));
mustCatch('a file that drives no browser and imports nothing local is NOT enlisted (the negative control)',
  !DRIVES_A_BROWSER.test("import { readFileSync } from 'node:fs';\nconst n = resultsFoundCount(t);"));

// The transitive half, executed end to end against the real tree: run.mjs reaches a browser only
// through chain.mjs, and no marker of any spelling appears in run.mjs itself.
{
  const runSrc = stripComments(readFileSync(join(ROOT, 'e2e/redteam/run.mjs'), 'utf8'));
  mustCatch('e2e/redteam/run.mjs carries NO browser marker of its own — only the closure reaches it',
    !DRIVES_A_BROWSER.test(runSrc) && population.has('e2e/redteam/run.mjs'));
  // The closure's OTHER direction. afOfferLive.ts imports no driver and carries no marker; four AF
  // live journeys import IT. An importer-only closure left it outside the population while its
  // reader was blind, which is how a helper hides.
  const helperSrc = stripComments(readFileSync(join(ROOT, 'scripts/lib/afOfferLive.ts'), 'utf8'));
  mustCatch('scripts/lib/afOfferLive.ts is reached only as a DOM-reading helper of a driver',
    !DRIVES_A_BROWSER.test(helperSrc)
    && !/from '\.[^']*'/.test(helperSrc.replace(/from '[^']*resultsSentence\.mjs'/, ''))
    && population.has('scripts/lib/afOfferLive.ts'));
}

// THE READER'S OWN BLIND SPOT. A retired regex quoted in a JSDoc block is documentation, not a code
// path — the in-file stripper this barrier shipped with removed only whole-LINE `//` comments, so
// e2e/lib/resultsSentence.mjs, the derived module itself, was flagged by its own explanation.
mustCatch('a retired regex quoted inside a /** … */ block is NOT read as a parser',
  !pinsRetiredWording(stripComments(
    '/**\n * The retired regexes were written `/^لقينا\\s+[\\d,٬]+\\s+إعلان/` — and their `^` mattered.\n */\nconst x = 1;')));
// A user-facing MESSAGE that quotes the retired sentence is stale prose, not a blind parser. The
// whole-file predicate this replaced could not tell the two apart and flagged e2e/guardian/
// journeys.mjs for a template literal in an assertion message.
mustCatch('a MESSAGE quoting «لقينا N إعلان» is not mistaken for a parser',
  !pinsRetiredWording('bad.push(`an impossible budget still claimed «لقينا ${n} إعلان»`);'));

// THE REAL DEFECT, REPLAYED. Each string below is the parser as it actually shipped this morning,
// copied from the file it shipped in, and each is executed against the sentence production really
// rendered. A synthetic offender proves the predicate; these prove it against the evidence.
{
  const LIVE = 'بحثك رجّع لنا 41,330 نتيجة 🥳';
  const shipped: Array<[string, string]> = [
    ['e2e/guardian/harness.mjs countChip', String.raw`(text.match(/لقينا\s+([\d,٬]+)\s+إعلان/) || [])[1] ?? null,`],
    ['e2e/guardian/harness.mjs SETTLED_RE', String.raw`export const SETTLED_RE = /لقينا|ما لقيت|ما فيه/;`],
    ['e2e/redteam/run.mjs L5', String.raw`const m = vis.raw.match(/لقينا\s+([\d,،]+)/);`],
    ['e2e/ui-parity.spec.ts FOUND', String.raw`const FOUND = /لقينا[\s\S]*?إعلان/;`],
    ['scripts/prove-rent-basis-live.mjs shown', String.raw`const m = text.match(/لقينا\s*([\d,٠-٩]+)/);`],
    ['scripts/lib/afOfferLive.ts HAS_TURN_SRC', String.raw`.some((e) => /لقينا\s[\d,٠-٩،]+\sإعلان/.test(e.textContent));`],
  ];
  for (const [where, code] of shipped) {
    // Two halves, both required: the parser really is blind against the live sentence, AND the
    // predicate really does flag it. Either alone is a claim; together they are the defect.
    const re = /\/(لقينا[^/]*)\//.exec(code);
    const blind = re ? !new RegExp(re[1]).test(LIVE) : false;
    mustCatch(`${where}: blind against «${LIVE}» AND flagged by the rule`,
      blind && pinsRetiredWording(code));
  }
}

console.log(failed === 0
  // Counted, never typed: a hardcoded tally is the same drift this whole barrier exists to stop.
  ? `\n✅ Results-Found parsers track the shipped pool — ${fromSource.length} templates, ${mutantsKilled}/${mutantsRun} mutants killed.\n`
  : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
