// The live AF card-state check knows every DERIVED amenity token the app can render (🔬 2026-11-06).
//
// af-card-state (scripts/verify-af-option-card-truth-live.ts) failed every run since the 11-01/11-02 derived chips
// shipped: «separate_meters: option key is one this file knows the column and predicate for» (run 42216168119,
// alert 11763) — production was right, the checker's key set was built from AMENITY_TOKEN_COL only, and the 14
// derived tokens (one p_amenities slug over OTHER columns, each with its own cnt_<token>) were unknown. A token
// with no Arabic label is worse: the whole run exits FATAL and checks nothing.
//
// This hermetic check (no network) pins both halves on the live checker's CODE:
//   1. its AMENITY_KEYS set is built from AMENITY_TOKEN_DERIVED too;
//   2. every derived token has a label — from CHIP_DEFS + i18n (chipArabicLabel) or the file's EXPECTED_LABEL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AMENITY_TOKEN_DERIVED } from './lib/afOracleFilter.ts';
import { chipArabicLabel } from './lib/afChipLabels.ts';

const FILE = 'scripts/verify-af-option-card-truth-live.ts';
const code = readFileSync(FILE, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const keysIncludeDerived = (c: string) =>
  /const AMENITY_KEYS = new Set\(\[[^\]]*\.\.\.Object\.keys\(AMENITY_TOKEN_DERIVED\)/.test(c);
const expectedLabelKeys = (c: string): Set<string> => {
  const m = c.match(/const EXPECTED_LABEL: Record<string, string\[\]> = \{([\s\S]*?)\n\};/);
  assert.ok(m, `${FILE}: EXPECTED_LABEL is not readable`);
  // a key counts only with a NON-EMPTY label list: «apts8: []» would still exit the live run FATAL
  return new Set([...m![1].matchAll(/(?:^|[\s,{])'?([A-Za-z_][\w]*|[^\s',:]+)'?\s*:\s*\[\s*'[^']+'/g)].map((x) => x[1]));
};
const unlabelled = (c: string) => {
  const hand = expectedLabelKeys(c);
  return Object.keys(AMENITY_TOKEN_DERIVED).filter((k) => !hand.has(k) && !chipArabicLabel(k));
};

let fails = 0;
const mustCatch = (label: string, caught: boolean) => { if (!caught) { console.error(`✗ mutation not caught: ${label}`); fails++; } };

mustCatch('AMENITY_KEYS built from AMENITY_TOKEN_COL only (the 11-06 shape)',
  !keysIncludeDerived(code.replace(', ...Object.keys(AMENITY_TOKEN_DERIVED)]', ']')));
mustCatch('a derived token’s hand label emptied (apts8: [] → FATAL)',
  unlabelled(code.replace("apts8: ['٨ شقق فأكثر']", 'apts8: []')).includes('apts8'));
mustCatch('a derived token’s hand label removed (apts4 → FATAL)',
  unlabelled(code.replace("apts4: ['٤ شقق فأكثر'], ", '')).includes('apts4'));

assert.ok(keysIncludeDerived(code), `${FILE}: AMENITY_KEYS no longer includes AMENITY_TOKEN_DERIVED — derived chips fail as «unknown key»`);
const miss = unlabelled(code);
assert.deepEqual(miss, [], `${FILE}: derived token(s) with no Arabic label (the run would exit FATAL): ${miss.join(', ')}`);
assert.equal(fails, 0, 'a mutation was not caught');
console.log(`✓ af-card-state knows all ${Object.keys(AMENITY_TOKEN_DERIVED).length} derived amenity tokens, each with a label (3 mutations caught)`);
