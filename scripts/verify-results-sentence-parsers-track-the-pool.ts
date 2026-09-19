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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  shippedTemplates, templateToRegex, resultsFoundCount, matchersFor, searchSettled, settledSource,
} from '../e2e/lib/resultsSentence.mjs';
import { __testing } from '../src/data/resultsFoundRotation.ts';

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

// ── 4. A count that is absent stays ABSENT — never a zero. ───────────────────────────────────────
// AGENTS.md: silent → NULL, never unknown → NO. A screen with no sentence must not read as "0 found".
check('no sentence on screen → null, never 0',
  resultsFoundCount('جاري البحث') === null && resultsFoundCount('') === null);
check('an honest-zero screen states zero without quoting a count',
  resultsFoundCount('ما لقينا نتائج') === null && searchSettled('ما لقينا نتائج'));

// ── 5. The retired wording is no longer what anything depends on. ────────────────────────────────
check('the retired «لقينا N إعلان» is not required by the matcher',
  resultsFoundCount('لقينا 1,500 إعلان يطابق طلبك.') === null);

// ── 6. THE LIVE SWEEP REALLY USES THIS, and no longer pins a phrasing of its own. ────────────────
// Reading these files is legitimate here: the claim is about WHICH module they call, which is a fact
// about the import graph, not about the wording of a regex.
const RETIRED = /لقينا\\s\+\(\[\\d,٬\]\+\)\\s\+إعلان|لقينا\s+\(\[/;
for (const rel of ['e2e/live-sweep/visibleState.mjs', 'e2e/live-sweep/sweep.mjs', 'e2e/live-sweep/journeys.mjs']) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check(`${rel} imports the derived matcher`, /from '\.\.?\/(?:\.\.\/)?lib\/resultsSentence\.mjs'/.test(code));
  check(`${rel} no longer parses a retired phrasing in live code`,
    !/matchAll\(\/لقينا/.test(code) && !/match\(\/لقينا/.test(code),
    'a hand-pinned «لقينا …» parser is back in executable code');
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
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`    ✓ killed: ${label}`); return; }
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

console.log(failed === 0
  ? `\n✅ Results-Found parsers track the shipped pool — ${fromSource.length} templates, 5 mutants killed.\n`
  : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
