// Execute the picker catalog against the real platform roster and watch missing-copy/logo mutants fail.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../src/data/platformPickerProfiles.ts');
function load(text: string, symbol: string) {
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', js)((path: string) => path, exports);
  return exports[symbol];
}
const roster = load(read('../src/data/loaderPlatforms.ts'), 'PLATFORM_META').filter((p: any) => !p.logoOnly);
const names = [...new Set(roster.map((p: any) => p.name))].sort();
function verify(text: string) {
  const profiles = load(text, 'PLATFORM_PICKER_PROFILES');
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
mustCatch(source.replace('منصة للبحث عن عقارات للبيع والإيجار في السعودية.', ''));
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
