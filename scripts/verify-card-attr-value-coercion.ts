// Regression guard (Search & Matching QA run, 2026-08-18).
//
// THE BUG THIS EXISTS TO PREVENT — a BLANK WHITE PAGE in production.
//
// `additional_info` is a source-scraped JSON column. Its LEGACY array shape (Wasalt, Aqar Gate) is
// stored exactly as the platform published it, and Wasalt publishes NUMBERS for three keys:
//     {"key":"noOfParkings","label":"Number of Parkings","value":1}
//     {"key":"noOfFloors",  "label":"Total Floors",      "value":2}
//     {"key":"floorNumber", "label":"Property Floor",    "value":1}
// 2,977 production_ready rows carried one on the day this guard was written (80 of them with the
// numeric row inside the FIRST FOUR entries, i.e. rendered without any extra click).
//
// buildAdditionalInfo() passed that array through untouched, so the number reached ResultCard's
// arAttrValue(), whose first statement was `(value ?? '').trim()`. `(2).trim is not a function`
// threw an UNCAUGHT TypeError, React unmounted the whole tree, and the user got a blank page.
//
// Live-reproduced on https://ezhalah-app.vercel.app before the fix:
//   تجاري → المباني والمرافق → «مبنى تجاري» → الرياض → «بحث»
//   → the RPC returned 40 matches, all 40 raw cards were fetched (HTTP 200), and the page then had
//     ONE div and zero characters of text. Console: "(t ?? \"\").trim is not a function".
//
// The class this guards is NOT "numbers": it is "a source value reaches a string-only renderer".
// Both halves are asserted — the boundary coercion (root cause) and the render-site String()
// (defence in depth) — because either one alone lets the class back in through a new call site.
import { readFileSync } from 'node:fs';

const REMOTE = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');
const CARD = readFileSync(new URL('../src/components/ResultCard.tsx', import.meta.url), 'utf8');

let failed = 0;
function check(name: string, ok: boolean, hint?: string) {
  if (ok) { console.log(`  ✓ ${name}`); return; }
  failed++;
  console.error(`  ✗ ${name}${hint ? `\n      ${hint}` : ''}`);
}

console.log('card-attr-value-coercion: a source-published non-string must never blank the app');

// ── 1. Root cause: buildAdditionalInfo's LEGACY ARRAY branch must normalise the row types ────────
const legacyBranch = /if \(Array\.isArray\(raw\)\) \{[\s\S]{0,2400}?\n  \}/.exec(REMOTE)?.[0] ?? '';
check('buildAdditionalInfo has an Array.isArray(raw) branch', legacyBranch.length > 0,
  'the legacy Wasalt/Aqar-Gate array shape is handled there — if it moved, re-point this guard');
check('the legacy array branch coerces value to a string',
  /value:\s*String\(\s*r\.value\s*\)/.test(legacyBranch),
  'a numeric value must become String(r.value) BEFORE it reaches the card renderer');
check('the legacy array branch coerces label to a string',
  /label:\s*String\(\s*r\.label\s*\)/.test(legacyBranch),
  'the label is fed to t() and to .trim().toLowerCase() — it must be a string too');
check('the legacy array branch no longer returns the raw source rows verbatim',
  !/const rows = raw\.filter\(\(r: any\) => r && r\.label && r\.value\);\s*\n\s*return rows\.length/.test(REMOTE),
  'the pre-fix shape — `.filter(...)` straight into `return rows` — is exactly what blanked the page');

// ── 2. Behaviour of the coercion contract, exercised on the real source values ────────────────────
// Replicates ONLY the mapping the guarded branch performs, over the three real Wasalt payloads, and
// proves the result is renderable (has .trim) while preserving the published value verbatim.
const SOURCE_ROWS: any[] = [
  { key: 'noOfParkings', label: 'Number of Parkings', value: 1 },
  { key: 'noOfFloors', label: 'Total Floors', value: 2 },
  { key: 'floorNumber', label: 'Property Floor', value: 1 },
  { key: 'propertyUsage', label: 'Property Usage', value: 'سكني' },
];
const mapped = SOURCE_ROWS
  .filter((r: any) => r && r.label && r.value)
  .map((r: any) => ({ key: String(r.key ?? r.label), label: String(r.label), value: String(r.value) }));
check('every mapped value is a string with a working .trim()',
  mapped.length === 4 && mapped.every((r) => typeof r.value === 'string' && typeof r.value.trim === 'function'));
check('the published value is preserved exactly (never re-formatted or dropped)',
  mapped[0].value === '1' && mapped[1].value === '2' && mapped[3].value === 'سكني');
check('a pre-fix renderer would have thrown on these same rows',
  (() => { try { (SOURCE_ROWS[1].value as any).trim(); return false; } catch { return true; } })(),
  'if this passes, the fixture no longer reproduces the original defect');

// ── 3. Defence in depth: the render site itself must not assume a string ─────────────────────────
const arAttr = /function arAttrValue\([\s\S]{0,400}?\n  const lv/.exec(CARD)?.[0] ?? '';
check('ResultCard.arAttrValue exists', arAttr.length > 0);
check('arAttrValue coerces its value argument before .trim()',
  /const v = String\(value \?\? ''\)\.trim\(\)/.test(arAttr),
  "`(value ?? '').trim()` is the exact line that threw in production");
check('arAttrValue coerces its label argument before .trim()',
  /const ll = String\(label \?\? ''\)\.trim\(\)\.toLowerCase\(\)/.test(arAttr));

// ── 4. No other card-attribute call site may re-introduce the unguarded pattern ──────────────────
// (?<!String) so the guarded `String(value ?? '').trim()` lines don't match themselves.
const unguarded = [...CARD.matchAll(/(?<!String)\((?:value|label|r\.value|r\.label) \?\? ''\)\.trim\(\)/g)];
check('no unguarded (value|label ?? \'\').trim() remains in ResultCard', unguarded.length === 0,
  `found ${unguarded.length}: every listing-sourced value must go through String() first`);

if (failed > 0) {
  console.error(`\n❌ card-attr-value-coercion: ${failed} check(s) failed.`);
  console.error('   A source-published non-string reaching a string-only renderer is the blank-page class.');
  process.exit(1);
}
console.log('✅ card-attr-value-coercion: source values are string-normalised at the boundary and at the renderer.');
