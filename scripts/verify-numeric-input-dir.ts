// Automated test — regression guard for the iOS Safari numeric-input bug (2026-07-10).
//
// Root cause: none of the five price/area/size TextInputs forced a text direction, so
// react-native-web emitted `<input dir="auto">`. The whole app forces
// `document.documentElement.dir = "rtl"` (Arabic is the default locale), so an EMPTY numeric field
// sat in an ambiguous bidi state — a long-documented WebKit-specific caret/rendering defect for a
// weak-directional (digit) run inserted into an RTL-anchored, dir="auto" text node. Confirmed NOT
// reproducible in Chromium (the bidi/caret implementations diverge), matching the report's
// iOS-Safari-only reproduction.
//
// Fix: pin dir="ltr" via a callback ref (`mergeLtrRef`, src/app/index.tsx), mirroring the file's own
// pre-existing `setLtr`/`makeDirRef` pattern — react-native-web does not support `direction` as a
// style property (it throws), so the DOM `dir` attribute must be set directly on the node.
//
// This can't be tested with a real render (no jsdom/React Testing Library in this repo — see
// scripts/verify-whole-number-input.ts for why: zero-dependency Node scripts are the established
// convention here). Instead this statically parses the ACTUAL shipped source so a future edit that
// drops the mergeLtrRef wiring from any of the five inputs fails loudly instead of silently regressing.
//
// Runs with ZERO project dependencies via Node's built-in type stripping (Node >= 22.6, repo uses 24):
//   node --experimental-strip-types scripts/verify-numeric-input-dir.ts   (wired into `npm test`)
// Exits non-zero on any failure so it can gate CI.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, '..', 'src', 'app', 'index.tsx');
const source = readFileSync(indexPath, 'utf8');

const FIELDS = ['areaMinRef', 'areaMaxRef', 'priceMinRef', 'priceMaxRef', 'sizeBoxRef'];

let failed = 0;

// The helper itself must exist and must set dir="ltr" on the node (not just any attribute).
const helperOk = /const mergeLtrRef = useCallback\(\(ref: \{ current: TextInput \| null \}\) => \(node: any\) => \{[\s\S]{0,200}?setAttribute\('dir', 'ltr'\)/.test(source);
console.log(`${helperOk ? 'PASS' : 'FAIL'}  mergeLtrRef helper exists and sets dir="ltr" on the DOM node`);
if (!helperOk) failed++;

for (const ref of FIELDS) {
  // Each of the 5 TextInputs must be wired as `ref={mergeLtrRef(fieldRef)}` — NOT the bare
  // `ref={fieldRef}` (which is what shipped with the bug: no direction override at all).
  const ok = source.includes(`ref={mergeLtrRef(${ref})}`);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${ref} is wired through mergeLtrRef (forces dir="ltr")`);
  // Guard against the OLD buggy wiring silently reappearing (e.g. a careless revert).
  const regressed = source.includes(`ref={${ref}}`);
  if (regressed) failed++;
  console.log(`${!regressed ? 'PASS' : 'FAIL'}  ${ref} is NOT wired bare (ref={${ref}}) — that shipped the bug`);
}

// ── iOS focus-zoom + overflow + digit-cap guards (real-iPhone findings, 2026-07-11) ──
// iOS Safari auto-zooms the page when focusing any input with font-size < 16px; combined with the
// RTL layout this panned the viewport so the field's text appeared detached from its box. WebKit's
// flex min-width:auto also let the <input> overflow its box. And with no cap, the area field
// accepted 1,008,000,000,000 م². These static checks pin all three fixes.
for (const style of ['sizeInput', 'rangeInput']) {
  const m = source.match(new RegExp(`${style}: \\{[^}]*\\}`));
  const tag = m ? m[0] : '';
  const font16 = /fontSize: 16/.test(tag);
  if (!font16) failed++;
  console.log(`${font16 ? 'PASS' : 'FAIL'}  s.${style} uses fontSize: 16 (prevents iOS focus auto-zoom)`);
  const minW = /minWidth: 0/.test(tag);
  if (!minW) failed++;
  console.log(`${minW ? 'PASS' : 'FAIL'}  s.${style} has minWidth: 0 (prevents WebKit flex overflow)`);
}
const CAPS: Array<[ref: string, maxLength: string, slice: string]> = [
  ['areaMinRef', 'maxLength={9}', ".slice(0, 7)"],
  ['areaMaxRef', 'maxLength={9}', ".slice(0, 7)"],
  ['priceMinRef', 'maxLength={13}', ".slice(0, 10)"],
  ['priceMaxRef', 'maxLength={13}', ".slice(0, 10)"],
  ['sizeBoxRef', 'maxLength={9}', ".slice(0, 7)"],
];
for (const [ref, maxLen, slice] of CAPS) {
  const refIdx = source.indexOf(`ref={mergeLtrRef(${ref})}`);
  const block = refIdx === -1 ? '' : source.slice(refIdx, source.indexOf('/>', refIdx));
  const hasMax = block.includes(maxLen);
  if (!hasMax) failed++;
  console.log(`${hasMax ? 'PASS' : 'FAIL'}  ${ref} has ${maxLen} (typing cap)`);
  const hasSlice = block.includes(slice);
  if (!hasSlice) failed++;
  console.log(`${hasSlice ? 'PASS' : 'FAIL'}  ${ref} handler hard-caps digits with ${slice} (paste cap)`);
}

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} numeric-input assertion(s) FAILED — an iOS Safari input bug can regress`);
  process.exit(1);
}
console.log(`✓ all ${FIELDS.length} numeric inputs force dir="ltr", use 16px font, minWidth:0, and digit caps`);
