// R14.4.2 FOR THE DISTRICT PANEL — the journey must OBSERVE the panel, not gamble on a sleep.
//
// THE DEFECT THIS PINS. `trendingDistrict()` in e2e/live-sweep/journeys.mjs used to do:
//
//     await page.locator('[data-testid="district-input"]').click(); await sleep(4200);
//     const rows = await page.evaluate(...);
//     if (!rows.length) { note(`${name}: no numbered district rows — skipped`); return null; }
//
// Two compounding faults, and the second is the one that kept it invisible:
//
//   1. A FIXED SLEEP, then a single scrape. district_options_ar answers in ~0.6-1.5 s warm
//      (measured on production 2026-09-04: 622/676/709/745/959/1248 ms for the reported failing
//      state, Riyadh · Buy ≤900k · area ≥120, 237 rows), so 4.2 s usually won. When it did not —
//      a cold plan, or a browser job starved by the concurrent RPC sweeps that #1692 fixed — the
//      scrape read a panel that had not rendered. That is a race, not a budget.
//   2. THE EMPTY RESULT WAS AN UNCONDITIONAL SKIP. Both "this city genuinely has no districts" and
//      "the panel never rendered" returned null with a note(). A render failure was therefore GREEN
//      and unfalsifiable — which is exactly why it could "fail once, pass on re-run" and never once
//      be recorded as a defect. R14.4.2 forbids precisely this: "A narrowed state that makes the
//      call time out is a P1 defect: the field goes empty and the user loses the surface entirely."
//
// THE FIX THIS BARRIER PROTECTS. Poll for readiness (breaking as soon as the panel is ready, so the
// passing path is FASTER than the 4.2 s it replaces), and decide an empty panel against the panel's
// OWN RPC response rather than a guess:
//   RPC never answered  -> defect (the R14.4.2 timeout shape)
//   RPC answered N > 0  -> defect (data arrived, surface did not show it)
//   RPC answered 0      -> a legitimate skip, and only then
//
// NOTHING HERE IS A LOOSENED ASSERTION. The ceiling is 15 s because src/data/locations.ts aborts the
// call at 15 s: a harness stricter than the product reports its own impatience as a product defect
// (§40.7). The change converts a silent skip into a hard failure, so it can only ever surface MORE.
//
// COMMENTS ARE STRIPPED BEFORE EVERY ASSERTION. This file's own subject matter means the words
// `sleep(4200)` and `note(` appear in prose in the very file under test; a barrier that greps raw
// source would be satisfied by that prose and pass on a full revert. That is the exact mutation
// class stripComments() exists for, and mutation M1 below proves this barrier survives it.
//
//   node --experimental-strip-types scripts/verify-district-panel-render-is-observed.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const JOURNEYS = 'e2e/live-sweep/journeys.mjs';
const raw = readFileSync(join(ROOT, JOURNEYS), 'utf8');
const src = stripComments(raw);

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

/** The `trendingDistrict` function body, comments stripped — the only region these rules govern. */
function districtJourney(s: string): string {
  const i = s.indexOf('export async function trendingDistrict');
  if (i < 0) return '';
  const j = s.indexOf('\nexport ', i + 10);
  return s.slice(i, j < 0 ? s.length : j);
}

/** The empty-panel branch, delimited by ITS OWN braces rather than a fixed character window.
 *  A fixed window is not merely imprecise here — it reads past the branch into the rest of the
 *  journey, which legitimately calls defect() for other reasons, so "an empty panel can fail"
 *  would pass on a branch that had been reverted to a bare skip. Mutation M2 proves that. */
function emptyPanelBranch(b: string): string {
  const i = b.indexOf('if (!rows.length)');
  if (i < 0) return '';
  const open = b.indexOf('{', i);
  if (open < 0) return '';
  let depth = 0;
  for (let k = open; k < b.length; k++) {
    if (b[k] === '{') depth++;
    else if (b[k] === '}' && --depth === 0) return b.slice(i, k + 1);
  }
  return b.slice(i);
}

/** Apply a transform to the trendingDistrict region ONLY, on the raw (uncommented) source. */
function inDistrictRegion(s: string, fn: (region: string) => string): string {
  const i = s.indexOf('export async function trendingDistrict');
  if (i < 0) return s;
  const j = s.indexOf('\nexport ', i + 10);
  const end = j < 0 ? s.length : j;
  return s.slice(0, i) + fn(s.slice(i, end)) + s.slice(end);
}

// ── §1 the race is gone ─────────────────────────────────────────────────────────────────────────
const body = districtJourney(src);
check('trendingDistrict() is present in the sweep journeys', body.length > 0,
  `not found in ${JOURNEYS}`);

// The specific shape that broke: opening the district field and then sleeping a fixed amount before
// reading it. Any `sleep(<literal>)` between the district-input click and the scrape re-introduces it.
const clickIdx = body.indexOf('district-input');
const scrapeIdx = body.indexOf('scrapeDistrictRows');
check('the district field is opened before the panel is read', clickIdx >= 0 && scrapeIdx > clickIdx,
  `click at ${clickIdx}, scrape at ${scrapeIdx}`);
const betweenClickAndRead = clickIdx >= 0 && scrapeIdx > clickIdx ? body.slice(clickIdx, scrapeIdx) : '';
check('no fixed sleep sits between opening the district field and reading the panel',
  !/\bsleep\(\s*\d+\s*\)/.test(betweenClickAndRead),
  `found ${(betweenClickAndRead.match(/\bsleep\(\s*\d+\s*\)/g) ?? []).join(', ')}`);

check('the panel is POLLED for readiness rather than read once',
  /while\s*\([\s\S]{0,120}?DISTRICT_PANEL_BUDGET_MS[\s\S]{0,400}?scrapeDistrictRows/.test(body),
  'no readiness loop bounded by DISTRICT_PANEL_BUDGET_MS around the scrape');

check('the poll re-runs the SAME scrape the assertion uses (one reading, not two)',
  (src.match(/scrapeDistrictRows/g) ?? []).length >= 2 && /const scrapeDistrictRows\s*=/.test(src),
  'scrapeDistrictRows is not a single shared definition');

// ── §2 an empty panel is adjudicated, never silently skipped ────────────────────────────────────
const emptyBranch = emptyPanelBranch(body);
check('the empty-panel branch exists', emptyBranch.length > 0, 'no `if (!rows.length)` branch');
check('an empty panel can FAIL the run (it is not an unconditional skip)',
  /defect\(/.test(emptyBranch),
  'the empty-panel branch never calls defect() — a render failure would still be green');
check('the R14.4.2 timeout shape is a defect: the RPC never answered',
  /!\s*rpc\.returned[\s\S]{0,300}?defect\(/.test(emptyBranch),
  'no defect() on the branch where district_options_ar did not answer');
check('data-arrived-but-not-rendered is a defect: the RPC answered rows and the panel showed none',
  /rpc\.rows\s*>\s*0[\s\S]{0,300}?defect\(/.test(emptyBranch),
  'no defect() on the branch where the RPC returned options but the panel was empty');
check('a genuinely empty scope is still allowed to skip (no false positives)',
  /note\(/.test(emptyBranch),
  'the legitimately-empty case must remain a note()/skip, not a defect');

// ── §3 the observer that makes the adjudication possible ────────────────────────────────────────
check('the panel RPC is observed, and attached BEFORE the field is opened',
  /page\.on\(\s*['"]response['"][\s\S]{0,400}?district_options_ar/.test(body)
    && body.indexOf("page.on('response'") < clickIdx,
  'no district_options_ar response observer, or it is attached after the click (it would miss it)');

// ── §4 the ceiling is the PRODUCT's, not the harness's invention ────────────────────────────────
const budget = Number(/const DISTRICT_PANEL_BUDGET_MS\s*=\s*(\d+)/.exec(src)?.[1] ?? 0);
const locations = stripComments(readFileSync(join(ROOT, 'src/data/locations.ts'), 'utf8'));
const clientAbort = Number(
  /setTimeout\(\s*\(\)\s*=>\s*_ac\.abort\(\)\s*,\s*(\d+)\s*\)/.exec(locations)?.[1] ?? 0);
check('the client abort budget is readable from src/data/locations.ts', clientAbort > 0,
  'could not read the district_options_ar abort timeout');
check(`the harness ceiling equals the product's own abort budget (${clientAbort} ms)`,
  budget === clientAbort, `harness ${budget} ms vs product ${clientAbort} ms`);

// ── §5 this barrier actually runs ───────────────────────────────────────────────────────────────
check('npm test discovers and runs this check',
  npmTestRuns(ROOT, 'verify-district-panel-render-is-observed'),
  'not in the resolved run set');

// ── §6 MUTATION PROOFS — every rule above must go red on the defect it exists to catch ──────────
// Each mutant is the real regression, applied to the real source, asserted to break the real rule.
type Mut = { name: string; apply: (s: string) => string; rule: (b: string, whole: string) => boolean };
const muts: Mut[] = [
  { name: 'M1 revert to the fixed sleep, keeping the explanation as a COMMENT (the decoy)',
    apply: (s) => s.replace(
      "await page.locator('[data-testid=\"district-input\"]').click();",
      "await page.locator('[data-testid=\"district-input\"]').click(); await sleep(4200);"),
    rule: (b) => {
      const c = b.indexOf('district-input'); const sc = b.indexOf('scrapeDistrictRows');
      return c >= 0 && sc > c && !/\bsleep\(\s*\d+\s*\)/.test(b.slice(c, sc));
    } },
  // Scoped to the trendingDistrict region on purpose: trendingCity carries its OWN
  // `if (!rows.length) { note(...); return null; }` one-liner earlier in the file, and an unscoped
  // replace rewrote THAT one — leaving the district branch intact and the mutant looking survivable.
  // A mutation that edits the wrong function proves nothing about the rule under test.
  { name: 'M2 restore the unconditional skip on an empty panel',
    apply: (s) => inDistrictRegion(s, (r) => r.replace(/if \(!rows\.length\) \{[\s\S]*?\n    \}/,
      "if (!rows.length) { note(`${name}: no numbered district rows — skipped`); return null; }")),
    rule: (b) => /defect\(/.test(emptyPanelBranch(b)) },
  { name: 'M3 drop the never-answered branch (the R14.4.2 timeout shape stops being a defect)',
    apply: (s) => s.replace(/if \(!rpc\.returned\) \{[\s\S]*?\} else if/, 'if ('),
    rule: (b) => /!\s*rpc\.returned[\s\S]{0,300}?defect\(/.test(emptyPanelBranch(b)) },
  { name: 'M4 stop observing the RPC (the adjudication loses its evidence)',
    apply: (s) => s.replace(/page\.on\(\s*'response'[\s\S]*?\}\);\n/, ''),
    rule: (b) => /page\.on\(\s*['"]response['"][\s\S]{0,400}?district_options_ar/.test(b) },
  { name: 'M5 attach the observer AFTER the click, so it can miss the response',
    apply: (s) => {
      const m = /(    const rpc = \{[\s\S]*?\n    \}\);\n)/.exec(s);
      if (!m) return s;
      return s.replace(m[1], '').replace(
        "await page.locator('[data-testid=\"district-input\"]').click();",
        "await page.locator('[data-testid=\"district-input\"]').click();\n" + m[1]);
    },
    rule: (b) => b.indexOf("page.on('response'") < b.indexOf('district-input') && b.includes("page.on('response'") },
  { name: 'M6 make the harness stricter than the product again (a 4 s ceiling)',
    apply: (s) => s.replace(/const DISTRICT_PANEL_BUDGET_MS = \d+/, 'const DISTRICT_PANEL_BUDGET_MS = 4000'),
    rule: (_b, whole) => Number(/const DISTRICT_PANEL_BUDGET_MS\s*=\s*(\d+)/.exec(whole)?.[1] ?? 0) === clientAbort },
  { name: 'M7 poll a second, divergent copy of the scrape instead of the shared one',
    apply: (s) => s.replace('rows = await page.evaluate(scrapeDistrictRows);',
      'rows = await page.evaluate(() => []);'),
    rule: (b) => /while\s*\([\s\S]{0,120}?DISTRICT_PANEL_BUDGET_MS[\s\S]{0,400}?scrapeDistrictRows/.test(b) },
];

console.log('\n  mutation proofs (each must turn its rule RED):');
for (const m of muts) {
  const mutated = m.apply(raw);
  const changed = mutated !== raw;
  const stripped = stripComments(mutated);
  const stillGreen = m.rule(districtJourney(stripped), stripped);
  check(`${m.name} — applied and caught`, changed && !stillGreen,
    !changed ? 'mutation did not apply (pattern drifted — fix the mutant, not the rule)'
             : 'MUTANT SURVIVED: the rule passes on the regression it exists to catch');
}

console.log(failures === 0
  ? '\nverify-district-panel-render-is-observed: all checks passed'
  : `\nverify-district-panel-render-is-observed: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
