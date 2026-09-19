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
const stripComments = (src: string) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

/** Every file under scripts/ and e2e/ that drives a real browser. */
const browserDrivingFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== 'node_modules') walk(p); continue; }
      if (!/\.(ts|mjs)$/.test(ent.name)) continue;
      const src = readFileSync(p, 'utf8');
      // THE MARKERS ARE SPELLED WITH A ONE-CHARACTER CLASS ON PURPOSE — do not "tidy" them.
      // A sibling barrier (verify-live-nav-retries-transport-only.ts) discovers the live-browser
      // population by looking for the playwright import marker in a file's source. This file only
      // ever MENTIONS that marker; it drives no browser and is hermetic. Writing the marker whole
      // here enlists this offline barrier into that file's production-browser population, and it
      // fails demanding this file serve its own build. `playwrigh[t]` matches the real import while
      // not BEING one.
      if (/from 'playwrigh[t]'|from '\.[^']*liveNav|gotoLiv[e]\(/.test(stripComments(src))) out.push(p);
    }
  };
  walk(join(ROOT, 'scripts'));
  walk(join(ROOT, 'e2e'));
  return out.sort();
};

// THE RETIRED RESULTS-FOUND SIGNATURE, in executable code: «لقينا» bound to a digit class and the
// retired noun «إعلان». Deliberately NOT a bare /لقينا/ — the mining phase has its own owner-authored
// found-beat («لقينا N عقار أقرب لطلبك», MiningTransition) and the zero-states («ما لقينا …») are
// legitimately hand-written and are covered by ZERO_RE, not by the pool.
const RETIRED_PARSER = /لقينا[^/\n]{0,40}(?:\[\\d|\[\\\\d|\{|\\s)[^/\n]{0,40}إعلان|لقينا\\s\*\(\[/;
// The retired CLOCK — /لقينا|ما لقيت|ما فيه/ — which 6 of 10 AR guest templates defeat.
const RETIRED_CLOCK = /\/لقينا\|ما لقي[تن]ا?\|ما فيه\//;
const IMPORTS_DERIVED = /from '[^']*resultsSentence\.mjs'/;

/**
 * THE PREDICATE, as a pure function — so the mutation block below can execute it against synthetic
 * files instead of trusting that the loop "would have" caught something. A discovery rule nobody has
 * watched fail is the same dark barrier this whole file exists to prevent.
 */
const pinsRetiredWording = (code: string): boolean =>
  (RETIRED_PARSER.test(code) || RETIRED_CLOCK.test(code)) && !IMPORTS_DERIVED.test(code);

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
// The discovery must actually FIND the population — an empty scan would make the check above
// vacuous, which is the exact failure mode this section replaced.
check('the discovery really found the browser-driving population',
  scanned >= 10, `only ${scanned} file(s) matched the browser-driving shape — the selector has drifted`);

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

console.log(failed === 0
  // Counted, never typed: a hardcoded tally is the same drift this whole barrier exists to stop.
  ? `\n✅ Results-Found parsers track the shipped pool — ${fromSource.length} templates, ${mutantsKilled}/${mutantsRun} mutants killed.\n`
  : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
