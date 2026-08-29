// A region-AND-city twin must be recognised however its name arrives — including the ENGLISH
// catalog name the deterministic parser emits.
//
// THE DEFECT THIS EXISTS TO PREVENT (found live on production 2026-08-29, routine #5, while
// root-causing why Riyadh could not complete a search through the الوكيل الذكي flow).
//
// Reproduced against https://ezhalah-app.vercel.app, deterministic 4/4 plus 5/5 on re-run:
//
//   ask     أبغى شقة للإيجار السنوي في الرياض
//   app     تقصد منطقة الرياض كاملة، أو مدينة معيّنة مثل الرياض أو الخرج؟
//   answer  مدينة الرياض                    ← the user names the CITY, one of the two offered scopes
//   app     تقصد منطقة الرياض كاملة، أو مدينة معيّنة مثل الرياض أو الخرج؟   ← IDENTICAL re-ask
//   answer  مدينة الرياض
//   app     ما قدرت أحدد الموقع بدقة، فبحثت في نطاق أوسع
//           p_cities = 20 cities of منطقة الرياض · 23,628 نتيجة   ← the OPPOSITE scope
//
// ROOT CAUSE, established by EXECUTING the real resolver (not by reading it):
//
//   resolveLocation('الرياض') → kind:'city',   label:'الرياض',       regionOrCity:TRUE
//   resolveLocation('Riyadh') → kind:'region', label:'منطقة الرياض', regionOrCity:FALSE
//
// Same place, two verdicts. parseQuery() returns location:'Riyadh' for EVERY Riyadh phrasing, and
// the old regionOrCityTwin() stripped «منطقة » from the INPUT STRING only — never from the RESOLVED
// LABEL — so on that path it reported "not a twin" and returned null. With no twin name the
// pendingScopeRef was never armed, the send() rewrite could never fire, the region branch re-asked
// forever, and the 2-ask cap widened to the whole region. The entire twin feature was dead for every
// twin reached by its English name: Riyadh, Jazan, Tabuk, Hail, Najran.
//
// WHAT IS PINNED HERE:
//   1. twinNameFor() recognises the twin from the bare Arabic name, the explicit Arabic region, AND
//      any name that RESOLVES to that region (the English catalog name).
//   2. It stays NARROW — a plain region, a plain city and a non-place must still return null, so
//      this can never invent twin-ness and widen a city into a region.
//   3. It terminates: a region label that carries no «منطقة » prefix must not re-query the resolver
//      with the same string.
//   4. agent.tsx actually routes through it.
//
// The resolver is injected, so this barrier EXECUTES the real rule instead of grepping it —
// src/data/locations.ts transitively pulls react-native and cannot be imported from plain Node.
// The stub below returns the VERBATIM verdicts measured from the real resolveLocation() on
// 2026-08-29 (bundled with esbuild and executed; the five twins and the controls are exactly the
// rows that run printed).
//
//   node --experimental-strip-types scripts/verify-agent-twin-scope.ts   (auto-discovered by npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { twinNameFor, scopeNamedForTwin, regionOrCityChoice, scopedLocation } from '../src/lib/regionOrCityAnswer.ts';

const root = join(import.meta.dirname, '..');
const agentSrc = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── The real resolver's measured verdicts, 2026-08-29 ───────────────────────────────────────────
// Anything not listed resolves to nothing, exactly as the real resolver does for a non-place.
const REAL: Record<string, { kind: string; label: string; regionOrCity: boolean }> = {
  // the five twins: Arabic name → the CITY twin; English catalog name → the REGION
  'الرياض': { kind: 'city', label: 'الرياض', regionOrCity: true },
  'Riyadh': { kind: 'region', label: 'منطقة الرياض', regionOrCity: false },
  'جازان': { kind: 'city', label: 'جازان', regionOrCity: true },
  'Jazan': { kind: 'region', label: 'منطقة جازان', regionOrCity: false },
  'تبوك': { kind: 'city', label: 'تبوك', regionOrCity: true },
  'Tabuk': { kind: 'region', label: 'منطقة تبوك', regionOrCity: false },
  'حائل': { kind: 'city', label: 'حائل', regionOrCity: true },
  'Hail': { kind: 'region', label: 'منطقة حائل', regionOrCity: false },
  'نجران': { kind: 'city', label: 'نجران', regionOrCity: true },
  'Najran': { kind: 'region', label: 'منطقة نجران', regionOrCity: false },
  // plain cities — NOT twins in either language
  'جدة': { kind: 'city', label: 'جدة', regionOrCity: false },
  'Jeddah': { kind: 'city', label: 'جدة', regionOrCity: false },
  'الدمام': { kind: 'city', label: 'الدمام', regionOrCity: false },
  'Dammam': { kind: 'city', label: 'الدمام', regionOrCity: false },
  'أبها': { kind: 'city', label: 'ابها', regionOrCity: false },
  'Abha': { kind: 'city', label: 'ابها', regionOrCity: false },
  // plain regions whose city half is NOT a twin — must stay null through the new label hop
  'Makkah': { kind: 'region', label: 'منطقة مكة المكرمة', regionOrCity: false },
  'مكة المكرمة': { kind: 'city', label: 'مكة المكرمة', regionOrCity: false },
  'Madinah': { kind: 'region', label: 'منطقة المدينة المنورة', regionOrCity: false },
  'المدينة المنورة': { kind: 'city', label: 'المدينة المنورة', regionOrCity: false },
  'Eastern Province': { kind: 'region', label: 'المنطقة الشرقية', regionOrCity: false },
  // a district — «مدينة الرياض» really does resolve to «المدينة الرياضية» in Al Hafuf
  'مدينة الرياض': { kind: 'district', label: 'المدينة الرياضية', regionOrCity: false },
  'النرجس': { kind: 'district', label: 'حي النرجس', regionOrCity: false },
  // A DISTRICT whose own label is exactly a twin's name. This is the case the `kind === 'region'`
  // guard exists for: without it the label hop would happily turn a neighbourhood into the whole
  // Riyadh twin — the widening bug this fix exists to prevent, pointed the other way. Only a REGION
  // may be normalised through its label, because only a region's label carries the «منطقة » form.
  'حي الرياض': { kind: 'district', label: 'الرياض', regionOrCity: false },
  // …and the same shape one tier up: a CITY that is not itself a twin but whose label collides.
  'Riyadh Suburb': { kind: 'city', label: 'الرياض', regionOrCity: false },
};
const resolve = (name: string) => REAL[name] ?? { kind: 'none', label: name, regionOrCity: false };

console.log('\nA region/city twin is recognised however its name arrives\n');

// ── 1. THE TWIN IS FOUND from every form the query can carry ────────────────────────────────────
for (const [input, expected] of [
  ['الرياض', 'الرياض'],            // bare Arabic twin
  ['منطقة الرياض', 'الرياض'],       // explicit Arabic region
  ['Riyadh', 'الرياض'],            // THE REGRESSION: the English catalog name parseQuery emits
  ['Jazan', 'جازان'],
  ['Tabuk', 'تبوك'],
  ['Hail', 'حائل'],
  ['Najran', 'نجران'],
  ['  Riyadh  ', 'الرياض'],        // surrounding whitespace must not matter
] as const) {
  check(`twinNameFor(${JSON.stringify(input)}) = «${expected}»`,
    twinNameFor(input, resolve) === expected,
    `got ${JSON.stringify(twinNameFor(input, resolve))}`);
}

// ── 2. IT STAYS NARROW — never invents twin-ness ────────────────────────────────────────────────
// This half is what keeps the fix from becoming the widening bug pointed the other way.
for (const input of [
  'Jeddah', 'جدة', 'Dammam', 'الدمام', 'Abha', 'أبها',   // plain cities
  'Makkah', 'Madinah', 'Eastern Province',                // plain regions, city half not a twin
  'مدينة الرياض',                                          // resolves to a DISTRICT (المدينة الرياضية)
  'النرجس',                                                // a district
  'حي الرياض',                                             // a DISTRICT whose label IS a twin's name
  'Riyadh Suburb',                                         // a non-twin CITY whose label collides
  'Riyadh Region', 'Atlantis', '', '   ', 'منطقة',        // non-places / bare noun
] as const) {
  check(`twinNameFor(${JSON.stringify(input)}) = null`, twinNameFor(input, resolve) === null,
    `got ${JSON.stringify(twinNameFor(input, resolve))}`);
}

// ── 3. IT TERMINATES — a region label with no «منطقة » prefix must not re-query the same string ──
{
  const seen: string[] = [];
  const selfSame = (n: string) => { seen.push(n); return { kind: 'region', label: n, regionOrCity: false }; };
  check('a region whose label equals its own name returns null without re-querying it',
    twinNameFor('Loopy', selfSame) === null && seen.filter((s) => s === 'Loopy').length === 1,
    `resolver calls: ${JSON.stringify(seen)}`);
}

// ── 4. THE FULL JOURNEY the defect broke, executed end to end ───────────────────────────────────
// parseQuery emits 'Riyadh'; the app asks the twin question; the user names a scope; the app must
// COMMIT that exact scope — never re-ask, never widen.
for (const [answer, expectedScope, expectedLocation] of [
  ['مدينة الرياض', 'city', 'الرياض'],          // → the CITY of Riyadh
  ['منطقة الرياض', 'region', 'منطقة الرياض'],   // → the whole REGION, because they asked for it
] as const) {
  const twin = twinNameFor('Riyadh', resolve);              // what pendingScopeRef would hold
  const named = scopeNamedForTwin(answer, twin) ?? regionOrCityChoice(answer);
  const committed = twin && named ? scopedLocation(twin, named) : null;
  check(`«${answer}» on a 'Riyadh' scope commits ${expectedScope} → «${expectedLocation}»`,
    named === expectedScope && committed === expectedLocation,
    `twin=${JSON.stringify(twin)} named=${JSON.stringify(named)} committed=${JSON.stringify(committed)}`);
}
// A Riyadh DISTRICT answer must not be read as a scope choice at all — it is a narrowing, and the
// twin question is answered by the city/region words, not by a neighbourhood.
check('a district answer names no twin scope',
  scopeNamedForTwin('حي النرجس', twinNameFor('Riyadh', resolve)) === null);
// The non-Riyadh controls keep working exactly as #1255 left them: no twin, so nothing is rewritten.
for (const city of ['Jeddah', 'Dammam', 'Abha'] as const) {
  check(`${city} has no twin, so its scope is never rewritten`, twinNameFor(city, resolve) === null);
}

// ── 5. THE WIRING ───────────────────────────────────────────────────────────────────────────────
check('agent.tsx imports twinNameFor',
  /import \{[^}]*twinNameFor[^}]*\} from '@\/lib\/regionOrCityAnswer'/.test(agentSrc));
check('regionOrCityTwin routes through twinNameFor with the real resolver',
  /twinNameFor\(loc, \(name\) => resolveLocation\(name, 'ar'\)\)/.test(agentSrc),
  'the rule must not be re-implemented inline — two copies would drift, which is how this broke');
check('the old input-only «منطقة » strip is gone from agent.tsx',
  !/const bare = \(loc \?\? ''\)\.trim\(\)\.replace\(\/\^منطقة/.test(agentSrc),
  'the resolved LABEL must be normalised too, not just the input string');

console.log(failures === 0
  ? '\n✅ verify-agent-twin-scope: all checks passed.\n'
  : `\n❌ verify-agent-twin-scope: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
