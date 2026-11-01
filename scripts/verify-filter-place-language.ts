import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { windowBetween } from './lib/sourceWindow.ts';
// Inject the existing converter to test placeText's locale decision without loading search data.
const translitPlace = (name: string) => ({ 'جدة': 'Jeddah', 'الرياض': 'Riyadh', 'حي الروضة': 'Al Rawdah' }[name] ?? name);

const source = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');
const block = windowBetween(source, 'const placeText =', 'const verbText =', 'src/data/search.ts');
function verify(code: string) {
  const make = (locale: string) => new Function('getLocale', 'translitPlace', 'tPlace', 'arabicOrUnresolved', 't',
    stripTypeScriptTypes(code) + '\nreturn placeText;')(
    () => locale, translitPlace, (s: string) => s, (s: string) => s,
    (key: string, vars: Record<string, string> = {}) => key.replace(/\{(\w+)\}/g, (_, k) => vars[k]),
  );
  assert.equal(make('en')({ location: 'جدة' }), 'Jeddah');
  assert.equal(make('en')({ location: 'الرياض' }), 'Riyadh');
  assert.equal(make('en')({ location: 'جدة', districtLabel: 'حي الروضة' }), 'Al Rawdah, Jeddah');
  assert.equal(make('ar')({ location: 'جدة', districtLabel: 'حي الروضة' }), 'حي الروضة, جدة');
}
verify(block);
const mutant = block.replace('translitPlace(name)', 'name');
assert.notEqual(mutant, block);
function mustCatch(broken: string) {
  assert.throws(() => verify(broken), assert.AssertionError);
}
mustCatch(mutant);
console.log('PASS: Filter place display uses English names, retains Arabic, and rejects raw-Arabic mutation.');
