// THE RESULTS-FOUND SENTENCE, READ FROM THE POOL THE APP ACTUALLY SHIPS.
//
// Why this module exists (measured 2026-09-19, routine #4). PR #3186 replaced the fixed
// «لقينا {n} إعلان يطابق طلبك.» with a ROTATION over four pools (src/data/resultsFoundRotation.ts).
// Every harness that pinned the retired wording went blind the same morning, and — this is the part
// that matters — most of them went blind SILENTLY:
//
//   · e2e/live-sweep/visibleState.mjs parsed /لقينا\s+([\d,٬]+)\s+إعلان/. All ten AR guest
//     templates say «نتيجة», none say «إعلان», so `headline` became null on EVERY journey.
//   · That null did not just dark one watch. sweep.mjs gates BOTH the `true-total-never-page-cap`
//     watch AND the whole RPC→RENDERED comparison on `rendered != null`, so the sweep reported
//     «RPC→RENDERED MISMATCHES: 0» having made zero comparisons on 7 of 8 journeys. The one thing
//     only a browser can see — what number the user is actually shown — stopped being checked, and
//     the report still said 10/10.
//   · SETTLED_RE (/لقينا|ما لقيت|ما فيه/) is the harness's CLOCK. Only 4 of the 10 AR guest
//     templates contain «لقينا», so it failed to see a settled search ~60% of the time. Measured on
//     production the same morning: الرياض/بيع rendered «بحثك رجّع لنا 41,330 نتيجة 🥳» and
//     SETTLED_RE tested false.
//
// The product was never wrong: that 41,330 is exactly what location_search_candidates_ar returned.
// The harness was.
//
// So the matcher is DERIVED from the shipped pool instead of restated beside it. Adding an
// owner-authored template tomorrow extends this matcher automatically; it cannot drift, because
// there is no second copy of the wording to fall out of step.
// scripts/verify-results-sentence-parsers-track-the-pool.ts executes this against the real module's
// own BAKED array and fails if the two ever disagree.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POOL_SRC = join(ROOT, 'src', 'data', 'resultsFoundRotation.ts');

/** Arabic-Indic digits → ASCII, so one numeric shape covers both renderings. */
const ar = (s) => String(s).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/**
 * The template literals the app ships, read from its single source of truth.
 * Deliberately a SOURCE read rather than an import: the harness is plain .mjs run by bare `node`,
 * while the pool is .ts. The barrier closes the gap by importing the real module and asserting this
 * extraction returns exactly the same set — so "read the file" can never quietly mean "read a
 * different file than the app uses".
 */
export function shippedTemplates(src = readFileSync(POOL_SRC, 'utf8')) {
  const start = src.indexOf('const BAKED');
  if (start < 0) throw new Error('resultsFoundRotation.ts: no BAKED pool found — the matcher cannot be derived');
  const end = src.indexOf('\n];', start);
  if (end < 0) throw new Error('resultsFoundRotation.ts: BAKED pool is not terminated — refusing to guess');
  const block = src.slice(start, end);
  const out = [];
  for (const m of block.matchAll(/\{\s*lang:\s*'(ar|en)',\s*hasName:\s*(true|false),?\s*template:\s*'((?:[^'\\]|\\.)*)'\s*\}/g)) {
    out.push({ lang: m[1], hasName: m[2] === 'true', template: m[3].replace(/\\'/g, "'").replace(/\\\\/g, '\\') });
  }
  if (!out.length) throw new Error('resultsFoundRotation.ts: BAKED pool parsed to zero templates — refusing to run blind');
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One template → a regex that captures its {count}.
 * {count} renders through toLocaleString, so it is a digit run with thousands separators.
 * {name} is a user-supplied display name: matched permissively but NOT greedily across the count.
 * Whitespace is collapsed because the rendered text wraps.
 */
export function templateToRegex(template) {
  // esc() turns `{count}` into `\{count\}`, so both placeholders are matched in their ESCAPED form
  // here — matching the raw form instead is how the first cut of this silently dropped all 20
  // logged-in templates while every guest template passed.
  const parts = esc(template).split(/\\\{count\\\}/);
  const body = parts
    .map((p) => p.replace(/\\\{name\\\}/g, '[^\\n]{1,64}?').replace(/\s+/g, '\\s+'))
    // Arabic-Indic digits are admitted here as well as ASCII: resultsFoundCount() normalises before
    // matching, but settledSource() is evaluated on RAW page text inside the browser, where it cannot.
    .join('([\\d٠-٩][\\d٠-٩,٬،]*)');
  return new RegExp(body);
}

let CACHE = null;
function matchers() {
  if (!CACHE) CACHE = shippedTemplates().map((t) => ({ ...t, re: templateToRegex(t.template) }));
  return CACHE;
}

/** Test seam: run the matcher against an explicit pool instead of the one on disk. */
export function matchersFor(templates) {
  return templates.map((t) => ({ ...t, re: templateToRegex(t.template) }));
}

/**
 * The count the Results-Found sentence quotes, or null when no shipped template matched.
 *
 * NULL MEANS "NO SHIPPED SENTENCE IS ON THIS SCREEN" — it must never be conflated with "the screen
 * says zero". That is the distinction the caller has to keep: a search that rendered results and
 * whose count could not be read is a BLIND journey, not a journey with no total. (AGENTS.md, «A
 * FAILED FETCH IS NOT AN EMPTY ANSWER» — the same rule one layer up, in the parser.)
 */
export function resultsFoundCount(text, pool = matchers()) {
  const t = ar(text);
  let best = null;
  for (const { re } of pool) {
    const g = new RegExp(re.source, 'g');
    for (const m of t.matchAll(g)) {
      const n = Number(String(m[1]).replace(/[,٬،]/g, ''));
      const at = m.index ?? 0;
      // LAST BY DOCUMENT POSITION, never by pool order. A chat transcript accumulates: an Advanced
      // Filter journey renders a broad Results-Found sentence, then a narrowed one after the answer
      // commits, and the two are usually DIFFERENT templates. Comparing only within each template
      // and overwriting across them returns whichever template happens to sit later in the pool —
      // measured on production 2026-09-19, that read the pre-narrowing 12,118 off a screen whose
      // current answer was 6,155, and reported the product for the harness's own mistake (§40.7).
      // The single-phrasing parser this replaced got it right for free, via one .pop().
      if (Number.isFinite(n) && (best === null || at > best.at)) best = { n, at };
    }
  }
  return best ? best.n : null;
}

/** True when a shipped Results-Found sentence is on screen (any pool, any rotation). */
export function hasResultsFoundSentence(text, pool = matchers()) {
  return resultsFoundCount(text, pool) !== null;
}

/** The zero-result statements. Unchanged by the rotation, but kept here so callers have one import. */
export const ZERO_RE = /ما لقينا|ما لقيت|ما فيه نتائج|ما فيه إعلانات/;

/**
 * "The search has settled" — a shipped sentence quoted a count, or the product said there are none.
 * Replaces the hand-written /لقينا|ما لقيت|ما فيه/ clock, which 6 of 10 AR guest templates defeat.
 */
export function searchSettled(text) {
  return hasResultsFoundSentence(text) || ZERO_RE.test(ar(text));
}

/**
 * The same predicate as a REGEX SOURCE STRING, for `page.waitForFunction`, which runs inside the
 * browser and so cannot call back into this module. Derived from the same pool, so the in-page clock
 * and the node-side one can never disagree — which is the whole reason this is generated rather than
 * written out twice.
 *
 * Arabic-Indic digits are included in the numeric class instead of being normalised first: the page
 * text is tested raw in the browser, where ar() is not available.
 */
export function settledSource(pool = matchers()) {
  const alts = pool.map(({ re }) => `(?:${re.source})`);
  return `(?:${alts.join('|')}|${ZERO_RE.source})`;
}

/**
 * "This node IS a Results-Found sentence" as a REGEX SOURCE STRING — the pool alone, WITHOUT
 * ZERO_RE.
 *
 * Why separate from settledSource(). The AF journeys do not ask "has the search settled?"; they
 * enumerate the results HEADLINES in the transcript, one per turn, and read each one's count. A
 * zero-result screen settles the search but quotes no count, so admitting ZERO_RE here would hand
 * the caller a "headline" it can never turn into a number — which is how a harness ends up
 * comparing null to an RPC total and reporting the product.
 *
 * Source string rather than a function because these predicates run inside `page.evaluate` /
 * `page.waitForFunction`, where this module cannot be reached. Derived from the same pool as
 * resultsFoundCount(), so the in-page reader and the node-side one cannot drift.
 *
 * Arabic-Indic digits are in the numeric class (templateToRegex admits them) because page text is
 * tested RAW in the browser, where ar() is not available.
 */
export function resultsSentenceSource(pool = matchers()) {
  return `(?:${pool.map(({ re }) => `(?:${re.source})`).join('|')})`;
}

/**
 * The same alternation, ANCHORED to the start of the text being tested — for per-NODE readers.
 *
 * THE ANCHOR IS LOAD-BEARING, and that is easy to miss when replacing a hand-written parser
 * (measured 2026-09-19, routine #5, in the first cut of this very migration). The journeys that
 * enumerate results headlines walk `document.querySelectorAll('div,span,p')` and ask "is this node a
 * headline?". The retired regexes were written `/^لقينا\s+[\d,٬]+\s+إعلان/` — and their `^` was not
 * decoration, it was the LEAF SELECTOR: a wrapper `<div>` whose innerText is the entire transcript
 * contains the sentence somewhere in the middle, so an UNANCHORED test matches the wrapper and the
 * reader returns the whole page as one "headline". Downstream that is not a blind parse but a wrong
 * one: `nothingAboveRewritten` then compares two multi-kilobyte blobs that differ by every card
 * added since, and reports the product for rewriting a transcript it never touched.
 *
 * So a per-node reader wants this; a whole-body reader (`document.body.innerText`) wants the
 * unanchored `resultsSentenceSource()`.
 */
export function resultsSentenceAtStartSource(pool = matchers()) {
  return `^\\s*${resultsSentenceSource(pool)}`;
}
