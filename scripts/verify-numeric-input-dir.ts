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

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} numeric-input dir="ltr" assertion(s) FAILED — the iOS Safari bug can regress`);
  process.exit(1);
}
console.log(`✓ all ${FIELDS.length} numeric inputs (area min/max, price min/max, size) force dir="ltr" via mergeLtrRef`);
