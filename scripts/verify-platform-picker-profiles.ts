// Execute the picker catalog against the real platform roster and watch missing-copy/logo mutants fail.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../src/data/platformPickerProfiles.ts');
const coverage = JSON.parse(read('../src/data/platformPickerCoverage.json'));
const helper = read('../src/lib/platformCoverageSentence.ts');
function load(text: string, symbol: string, helperText = helper) {
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', js)((path: string) => {
    if (path.endsWith('platformPickerCoverage.json')) return coverage;
    if (path.endsWith('platformCoverageSentence')) return { platformCoverageSentence: load(helperText, 'platformCoverageSentence') };
    return path;
  }, exports);
  return exports[symbol];
}
const roster = load(read('../src/data/loaderPlatforms.ts'), 'PLATFORM_META').filter((p: any) => !p.logoOnly);
const names = [...new Set(roster.map((p: any) => p.name))].sort();
function verify(text: string, helperText = helper) {
  const profiles = load(text, 'PLATFORM_PICKER_PROFILES', helperText);
  assert.deepEqual(Object.keys(profiles).sort(), names, 'every searchable picker entry has a profile');
  const files = new Set<string>();
  for (const [name, profile] of Object.entries(profiles) as [string, any][]) {
    assert.match(profile.ar, /[\u0600-\u06ff]/, `${name}: Arabic sentence required`);
    assert.match(profile.en, /[a-z]/i, `${name}: English sentence required`);
    assert.ok(profile.ar.length > 10 && profile.en.length > 10, `${name}: meaningful description`);
    const bytes = readFileSync(new URL(`../src/data/${profile.logo}`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG', `${name}: PNG asset loads`);
    if (profile.logo.includes('/platform-logos/')) files.add(profile.logo);
  }
  // Immutable collected artwork: guard the complete used pack with one aggregate fingerprint.
  const fingerprint = createHash('sha256');
  for (const file of [...files].sort()) {
    fingerprint.update(file);
    fingerprint.update(readFileSync(new URL(`../src/data/${file}`, import.meta.url)));
  }
  assert.equal(files.size, 142, 'all matching ZIP logos used');
  assert.equal(fingerprint.digest('hex'), '90fc1c9e8fe521ad60ca551081142bdd7d63f693001ea77ed02afd1e7cf10c79');
}
verify(source);
function mustCatch(mutant: string) {
  assert.notEqual(mutant, source, 'mutation target exists');
  assert.throws(() => verify(mutant), assert.AssertionError);
}
const emptyCopy = helper.replace("return ar ? 'عقارات في مختلف مناطق المملكة.'", "return ar ? ''");
assert.notEqual(emptyCopy, helper);
assert.throws(() => verify(source, emptyCopy), assert.AssertionError);
mustCatch(source.replace('wasalt-sa.png', 'sa-aqar-fm.png'));
// Execute the actual JSX map: the displayed image and sentence must come from the profile.
const agent = read('../src/app/agent.tsx');
function verifyRendering(text: string) {
  const ast = ts.createSourceFile('agent.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let map = '';
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && n.expression.getText(ast) === 'pickerPlatforms.map') map = n.getText(ast);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  assert.ok(map, 'picker render map exists');
  const js = ts.transpileModule(`const cards = ${map};`, { compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'h' } }).outputText;
  const profiles = load(source, 'PLATFORM_PICKER_PROFILES');
  const h = (type: string, props: any, ...children: any[]) => ({ type, props, children });
  const render = new Function('pickerPlatforms', 'PLATFORM_PICKER_PROFILES', 'locale', 'selectedSource', 'choosePlatform', 't', 's', 'pickerTwoColumns', 'colors', 'h', 'Pressable', 'View', 'Text', 'Image', 'Ionicons', js + '\nreturn cards;');
  for (const locale of ['ar', 'en']) {
    for (const twoColumns of [true, false]) {
      const cards = render(roster, profiles, locale, null, () => {}, (key: string) => key, {}, twoColumns, {}, h, 'Pressable', 'View', 'Text', 'Image', 'Ionicons');
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i]; const profile = profiles[roster[i].name];
        const nodes: any[] = [];
        function flatten(n: any) { if (n && typeof n === 'object') { nodes.push(n); n.children?.forEach(flatten); } }
        flatten(card);
        assert.equal(nodes.find(n => n.type === 'Image').props.source, profile.logo);
        assert.ok(nodes.some(n => n.type === 'Text' && n.children.includes(profile[locale])), 'description visible');
        assert.ok(card.props.accessibilityLabel.includes(profile[locale]), 'description accessible');
        if (!twoColumns) assert.ok(card.props.style({ pressed: false }).some((v: any) => v?.width === '100%'), 'phone cards use readable full width');
      }
    }
  }
}
verifyRendering(agent);
function mustCatchRender(mutant: string) {
  assert.notEqual(mutant, agent);
  assert.throws(() => verifyRendering(mutant), assert.AssertionError);
}
mustCatchRender(agent.replace('source={profile.logo}', 'source={platform.logo}'));
mustCatchRender(agent.replace('{description}\n', '{""}\n'));
console.log(`PASS: ${names.length} bilingual descriptions; 142 original ZIP logos; missing copy and wrong artwork mutations rejected.`);

const sentence = load(helper, 'platformCoverageSentence');
const region = (id: number, name: string, count: number) => ({ id, name, en: `Region ${id}`, count });
const fixture = (regions: any[], total = 100, cities: any[] = []) => ({ state: 'known', total, regions, topCity: cities[0] ?? null });
assert.equal(sentence(fixture([region(1, 'منطقة الرياض', 100)], 100, [{name:'الرياض',en:'Riyadh',count:100}]), 'ar'), 'عقارات في الرياض.');
assert.equal(sentence(fixture([region(1, 'منطقة الرياض', 100)]), 'ar'), 'عقارات في منطقة الرياض.');
assert.equal(sentence(fixture([region(1, 'منطقة الرياض', 80), region(2, 'منطقة مكة المكرمة', 20)]), 'ar'), 'أغلب العقارات في منطقة الرياض.');
const nationwide = fixture(Array.from({length: 6}, (_, i) => region(i+1, `منطقة ${i}`, i === 0 ? 50 : 10)));
assert.equal(sentence(nationwide, 'ar'), 'عقارات في مختلف مناطق المملكة.');
assert.equal(sentence({state:'unknown'}, 'ar'), 'بيانات نطاق العقارات غير متاحة حالياً.');
assert.equal(sentence(fixture([], 0), 'ar'), 'بيانات نطاق العقارات غير متاحة حالياً.');
assert.equal(sentence(undefined, 'ar'), 'بيانات نطاق العقارات غير متاحة حالياً.');
assert.equal(sentence(coverage.platforms.Aqar, 'ar'), 'عقارات في مختلف مناطق المملكة.');
assert.equal(sentence(coverage.platforms.Wasalt, 'ar'), 'عقارات في مختلف مناطق المملكة.');
assert.equal(sentence(coverage.platforms.Satel, 'ar'), 'عقارات في الرياض.');
// Watch a fabricated nationwide fallback and a services biography fail the measured coverage contract.
function mustCatchCoverage(mutant: string) {
  assert.notEqual(mutant, helper);
  const broken = load(mutant, 'platformCoverageSentence');
  assert.throws(() => assert.equal(broken(fixture([region(1, 'منطقة الرياض', 80), region(2, 'منطقة مكة المكرمة', 20)]), 'ar'), 'أغلب العقارات في منطقة الرياض.'), assert.AssertionError);
}
mustCatchCoverage(helper.replace("if (first.count / total >= 0.7)", 'if (false)')
  .replace("if (first.count > total / 2)", 'if (false)'));
mustCatchCoverage(helper.replace('أغلب العقارات في ${place}.', 'وساطة وتسويق وإدارة أملاك.'));
console.log('PASS: location-only sentences reflect cities, regions, nationwide coverage and unknown data; fabricated/service-copy mutations rejected.');
