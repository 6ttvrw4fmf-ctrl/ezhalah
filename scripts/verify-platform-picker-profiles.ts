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
    if (path.endsWith('platformPickerLogoLayout.json')) return JSON.parse(read('../src/data/platformPickerLogoLayout.json'));
    if (path.endsWith('platformCoverageSentence')) return { platformCoverageSentence: load(helperText, 'platformCoverageSentence'), platformCoverageGroup: load(helperText, 'platformCoverageGroup') };
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
    // No separate «عدة مناطق» list: a multi-region site sits under «في مختلف مناطق المملكة» (owner 2026-10-10).
    if (coverage.platforms[name]?.regions?.length >= 2 && !(coverage.platforms[name].regions.some((r: any) => r.count > coverage.platforms[name].total / 2))) {
      assert.equal(profile.group.ar.label, 'في مختلف مناطق المملكة', `${name}: multi-region site belongs in the nationwide list`);
    }
  }
  // The regions map reads each site's reach from the same snapshot (owner 2026-10-10).
  const regionIds = load(text, 'platformRegionIds', helperText);
  assert.ok(regionIds('Aqar').length >= 6, 'Aqar reaches many regions');
  assert.deepEqual(regionIds('Al Humaidan'), [4], 'a site with no listings carries the region it names (Qassim)');
  assert.deepEqual(regionIds('No such site'), []);
  const share = load(text, 'platformRegionShare', helperText);
  assert.equal(share('Al Humaidan', 4), 1, 'a no-listings site is wholly in its named region');
  assert.ok(share('Aqar', 6) > 0 && share('Aqar', 6) < 0.5, 'a nationwide portal has a small share in Asir');
  assert.ok(share('Eastabha', 6) > share('Aqar', 6), 'an Asir office outranks a nationwide portal in Asir');
  assert.equal(share('No such site', 1), 0);
  // Preserve the collected ZIP pack, including variants replaced by an owner-approved original asset.
  for (const match of text.matchAll(/require\("([^"]*\/platform-logos\/[^"]+)"\)/g)) files.add(match[1]);
  assert.equal(profiles['Deal App'].logo, roster.find((p: any) => p.name === 'Deal App').logo, 'Deal uses its original yellow listing-card asset');
  // Immutable collected artwork: guard the complete used pack with one aggregate fingerprint.
  const fingerprint = createHash('sha256');
  for (const file of [...files].sort()) {
    fingerprint.update(file);
    fingerprint.update(readFileSync(new URL(`../src/data/${file}`, import.meta.url)));
  }
  assert.equal(files.size, 143, 'all matching ZIP logos plus the official Haraj header are used');
  // Re-pinned 2026-10-27 (owner: «make it feel faster»): the same artwork resized to ≤320 px and saved as palette
  // PNGs with real alpha (13.1 MB → 1.7 MB, PR "Speed: platform logos"). Checked side by side: no visible change.
  // Any OTHER change to these bytes still fails here.
  assert.equal(fingerprint.digest('hex'), 'f6e08146739cb8fe9f11396be84548b27025923b0e459d563fcfd553072e26df');
}
verify(source);
function mustCatch(mutant: string) {
  assert.notEqual(mutant, source, 'mutation target exists');
  assert.throws(() => verify(mutant), assert.AssertionError);
}
const emptyCopy = helper.replace("export function platformCoverageSentence(coverage: PickerCoverage | undefined, locale: 'ar' | 'en'): string {", "export function platformCoverageSentence(coverage: PickerCoverage | undefined, locale: 'ar' | 'en'): string { return '';");
assert.notEqual(emptyCopy, helper);
assert.throws(() => verify(source, emptyCopy), assert.AssertionError);
const severalList = helper.replace("  return nationwide;\n}", "  if (coverage?.regions.length) return { key: 'multiple-regions', order: 100, label: ar ? 'عدة مناطق' : 'Several regions' };\n  return nationwide;\n}");
assert.notEqual(severalList, helper, 'several-regions mutation target exists');
assert.throws(() => verify(source, severalList), assert.AssertionError);
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
  let itemStyle = '';
  function styleVisit(n: ts.Node) {
    if (ts.isPropertyAssignment(n) && n.name.getText(ast) === 'platformPickerItem') itemStyle = n.initializer.getText(ast);
    ts.forEachChild(n, styleVisit);
  }
  styleVisit(ast);
  const actualItemStyle = new Function('colors', `return (${itemStyle});`)({});
  assert.equal(actualItemStyle.width, '100%', 'every desktop/phone row uses the full list width');
  const h = (type: string, props: any, ...children: any[]) => ({ type, props, children });
  // pickerRegion / regionLabel: the regions map's heading (2026-10-10) — rendered here with no region tapped.
  const render = new Function('pickerPlatforms', 'PLATFORM_PICKER_PROFILES', 'locale', 'selectedSources', 'choosePlatform', 't', 's', 'pickerTwoColumns', 'colors', 'h', 'Pressable', 'View', 'Text', 'Image', 'Ionicons', 'pickerRegion', 'regionLabel', 'platformRegionListings', 'MAX_PICKER_SOURCES', js + '\nreturn cards;');
  for (const locale of ['ar', 'en']) {
    for (const twoColumns of [true, false]) {
      const cards = render(roster, profiles, locale, [], () => {}, (key: string) => key, { platformPickerItem: actualItemStyle }, twoColumns, {ink:'#253831'}, h, 'Pressable', 'View', 'Text', 'Image', 'Ionicons', null, () => '', () => 0, load(source, 'MAX_PICKER_SOURCES'));
      for (let i = 0; i < cards.length; i++) {
        const root = cards[i]; const profile = profiles[roster[i].name];
        const nodes: any[] = [];
        function flatten(n: any) { if (n && typeof n === 'object') { nodes.push(n); n.children?.forEach(flatten); } }
        flatten(root);
        const card = nodes.find(n => n.type === 'Pressable');
        assert.equal(nodes.find(n => n.type === 'Image').props.source, profile.logo);
        assert.equal(nodes.find(n => n.type === 'Image').props.tintColor, profile.layout.monochrome ? '#253831' : undefined, 'only reviewed white-only marks adapt their ink');
        assert.ok(!nodes.some(n => n.type === 'View' && Array.isArray(n.props?.style) && n.props.style.some((v: any) => v?.backgroundColor === '#263D32')), 'logos have no backing tiles');
        assert.ok(nodes.some(n => n.type === 'Text' && n.children.includes(profile[locale])), 'description visible');
        assert.ok(card.props.accessibilityLabel.includes(profile[locale]), 'description accessible');
        assert.equal(card.props['aria-pressed'], false, 'unselected toggle communicates its state');
        if (!twoColumns) assert.ok(card.props.style({ pressed: false }).some((v: any) => v?.width === '100%'), 'phone cards use readable full width');
      }
      // At the cap (5 lit), every site not already lit renders inert and dimmed; a lit one stays tappable.
      const lit = roster.slice(0, 5).map((p: any) => p.name);
      const full = render(roster, profiles, locale, lit, () => {}, (key: string) => key, { platformPickerItem: actualItemStyle }, twoColumns, {ink:'#253831'}, h, 'Pressable', 'View', 'Text', 'Image', 'Ionicons', null, () => '', () => 0, load(source, 'MAX_PICKER_SOURCES'));
      const press = (root: any): any => { if (root?.type === 'Pressable') return root; for (const c of root?.children ?? []) { const f = press(c); if (f) return f; } return null; };
      assert.equal(press(full[5]).props.disabled, true, 'at the cap a 6th site is inert');
      assert.ok(press(full[5]).props.style({ pressed: false }).some((v: any) => v?.opacity === 0.4), 'at the cap a 6th site is dimmed');
      assert.ok(!press(full[0]).props.disabled, 'a lit site stays tappable at the cap (removing frees a slot)');
    }
  }
}
verifyRendering(agent);
function mustCatchRender(mutant: string) {
  assert.notEqual(mutant, agent);
  assert.throws(() => verifyRendering(mutant), assert.AssertionError);
}
mustCatchRender(agent.replace('source={profile.logo}', 'source={"../../assets/images/platform-placeholder.png"}'));
mustCatchRender(agent.replace('                      disabled={atLimit}\n', ''));
mustCatchRender(agent.replace('tintColor={profile.layout.monochrome ? colors.ink : undefined}', 'tintColor="#000"'));
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
assert.equal(sentence({ ...coverage.platforms.Aqar, focusCounts: undefined }, 'ar'), 'عقارات في مختلف مناطق المملكة.');
assert.equal(sentence({ ...coverage.platforms.Wasalt, focusCounts: undefined }, 'ar'), 'عقارات في مختلف مناطق المملكة.');
assert.equal(sentence({ ...coverage.platforms.Satel, focusCounts: undefined }, 'ar'), 'عقارات في الرياض.');
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

const slugs = load(source, 'pickerSourceSlugs');
const toggle = load(source, 'togglePickerSource');
assert.deepEqual(slugs(['Aqar', 'Wasalt']), ['aqar', 'aqarmonthly', 'wasalt']);
assert.deepEqual(slugs([]), []);
assert.throws(() => slugs(['nonexistent']), /Unknown picker source/);
let selected = toggle([], 'Aqar');
selected = toggle(selected, 'Wasalt');
assert.deepEqual(selected, ['Aqar', 'Wasalt']);
// Deep search caps at 5 sites (owner 2026-10-10: «yes make the max 5», after lifting the cap of 3 that day):
// a 6th is refused; removing one frees a slot.
assert.equal(load(source, 'MAX_PICKER_SOURCES'), 5, 'the deep-search cap is 5 websites');
const five = ['Aqar', 'Wasalt', 'Deal App', 'Gathern', 'Sanadak'].reduce((a: string[], n) => toggle(a, n), []);
assert.deepEqual(five, ['Aqar', 'Wasalt', 'Deal App', 'Gathern', 'Sanadak'], 'five websites may be lit');
assert.deepEqual(toggle(five, 'Muktamel'), five, 'a 6th website must be refused');
assert.deepEqual(toggle(toggle(five, 'Wasalt'), 'Muktamel'), ['Aqar', 'Deal App', 'Gathern', 'Sanadak', 'Muktamel'], 'removing one frees a slot');
const uncapped = (names: string[], name: string) => names.includes(name) ? names.filter((v) => v !== name) : [...names, name];
assert.notDeepEqual(uncapped(five, 'Muktamel'), five, 'mutation: the uncapped toggle lets a 6th through, so the check above can fail');
assert.deepEqual(toggle(selected, 'Aqar'), ['Wasalt']);
assert.deepEqual(slugs(['Aqar', 'Aqar']), ['aqar', 'aqarmonthly']);
for (const name of names as string[]) {
  const profile = load(source, 'PLATFORM_PICKER_PROFILES')[name];
  assert.ok(profile.layout.width > 0 && profile.layout.height > 0);
  assert.ok(Number.isFinite(profile.layout.left) && Number.isFinite(profile.layout.top));
}
assert.equal(load(source, 'PLATFORM_PICKER_PROFILES')['ودود العقارية'].layout.monochrome, true);
console.log('PASS: multi-selection toggles, canonical source restrictions, duplicate removal, unknown-source refusal and logo visibility layouts.');

assert.equal(sentence({ ...nationwide, focusCounts: { Residential: 90, Commercial: 10 } }, 'ar'), 'عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة.');
assert.equal(sentence({ ...fixture([region(1, 'منطقة الرياض', 80), region(2, 'منطقة مكة المكرمة', 20)]), focusCounts: { Residential: 50, Commercial: 50 } }, 'ar'), 'عقارات سكنية وتجارية، أغلبها في منطقة الرياض.');
assert.equal(sentence({ ...nationwide, focusCounts: { Residential: 10, Commercial: null } }, 'ar'), 'عقارات في مختلف مناطق المملكة.');
function queryRestriction(text: string) {
  const ast = ts.createSourceFile('agent.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body = '';
  function visit(n: ts.Node) {
    if (ts.isIfStatement(n) && n.expression.getText(ast) === "turn.kind !== 'interview' && turn.query" && n.thenStatement.getText(ast).includes('applyPickerSources(')) body = n.getText(ast);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  assert.ok(body);
  return new Function('turn', 'selectedSourcesForTurn', 'sourceChoiceForTurn', 'applyPickerSources', body + '\nreturn turn;');
}
const selectedSlugs = slugs(['Aqar', 'Wasalt']);
const restrict = queryRestriction(agent);
const applySources = load(source, 'applyPickerSources');
const parsed = { kind: 'search', query: { sources: ['other'], location: 'الرياض' } };
assert.deepEqual(restrict(parsed, selectedSlugs, true, applySources).query.sources, selectedSlugs);
assert.equal(restrict(parsed, [], false, applySources).query, parsed.query);
assert.deepEqual(restrict(parsed, [], true, applySources).query.sources, []);
const badRestriction = queryRestriction(agent.replace('applyPickerSources(turn.query, selectedSourcesForTurn, sourceChoiceForTurn)', 'applyPickerSources(turn.query, selectedSourcesForTurn, false)'));
assert.throws(() => assert.deepEqual(badRestriction(parsed, selectedSlugs, true, applySources).query.sources, selectedSlugs), assert.AssertionError);
console.log('PASS: short focus/location sentences and the actual parsed query restriction; widened-source mutation caught.');

const sourceLabel = load(read('../src/lib/listingDisplay.ts'), 'sourceName');
const searchSource = read('../src/data/search.ts');
const namesExpression = searchSource.match(/const names = (.*);/m)?.[1];
assert.ok(namesExpression);
const summaryNames = new Function('q', 't', 'sourceName', `return ${namesExpression};`);
const translateName = (key: string) => key === 'AQAR' ? 'عقار' : key === 'Wasalt' ? 'وصلت' : key;
assert.equal(summaryNames({sources:selectedSlugs}, translateName, sourceLabel), 'عقار، وصلت');
console.log('PASS: selected website summary reuses card naming and deduplicates Aqar monthly without leaking raw slugs.');

const group = load(helper, 'platformCoverageGroup');
assert.equal(group(coverage.platforms.Aqar, 'ar').key, 'nationwide');
assert.equal(group(coverage.platforms.Aldarim, 'ar').label, 'منطقة الرياض');
// A site with no listings sits in the region it names itself (owner 2026-10-10: al-humaidan = بريدة، القصيم).
assert.equal(group(coverage.platforms['Al Humaidan'], 'ar').label, 'منطقة القصيم', 'Al Humaidan sits under القصيم');
const unnamed = load(helper.replace("  if (named) return", "  if (false) return"), 'platformCoverageGroup');
assert.notEqual(unnamed(coverage.platforms['Al Humaidan'], 'ar').label, 'منطقة القصيم', 'mutation: ignoring the named region is caught');
assert.equal(group(undefined, 'ar').key, 'nationwide', 'no separate «مواقع أخرى» list (owner 2026-10-10)');
const ordered = (names as string[]).slice().sort((a,b)=>group(coverage.platforms[a],'ar').order-group(coverage.platforms[b],'ar').order);
assert.equal(group(coverage.platforms[ordered[0]],'ar').key, 'nationwide');
assert.deepEqual(ordered.slice().sort(), names);
for (const name of names as string[]) {
  const layout = load(source, 'PLATFORM_PICKER_PROFILES')[name].layout;
  assert.ok(layout.visibleWidth <= 88.02 && layout.visibleHeight <= 40.02, `${name}: bounded readable logo dimensions`);
  assert.ok(Math.abs(layout.visibleHeight - 40) <= 0.02 || Math.abs(layout.visibleWidth - 88) <= 0.02, `${name}: measured icon or wordmark sizing`);
}
console.log('PASS: nationwide-first regional sections preserve every site; full-width rows and compact icons and readable wordmarks in uniform slots.');

assert.deepEqual(applySources({sources:['aqar'],location:'الرياض'},[],true), {sources:[],location:'الرياض'});
assert.deepEqual(applySources({sources:['aqar']},['wasalt'],true), {sources:['wasalt']});
assert.equal(applySources(parsed.query,[],false),parsed.query);
console.log('PASS: all-sites clears inherited restrictions, new explicit choices replace them, and untouched free-text choices remain supported.');

const retainsOldScope = source.replace('return explicit ? { ...query, sources: slugs.slice() } : query;', 'return explicit && slugs.length ? { ...query, sources: slugs.slice() } : query;');
assert.notEqual(retainsOldScope,source);
assert.throws(() => assert.deepEqual(load(retainsOldScope,'applyPickerSources')({sources:['aqar']},[],true).sources, []), assert.AssertionError);

const homepageCatalog = load(source, 'PLATFORM_PICKER_PROFILES');
// 150 = 149 + Haraj (official header artwork added 2026-10-17).
assert.equal(Object.keys(homepageCatalog).length, 150);
assert.ok(Object.keys(homepageCatalog).includes('Deal App'));
console.log('PASS: the complete website catalog includes all 150 logo profiles, including Dealapp.');

const chooseMatch = agent.match(/const choosePlatform = \(source: string \| null\) => \{([\s\S]*?)\n  \};/);
assert.ok(chooseMatch);
const chooseJS = ts.transpile(chooseMatch[1], { target: ts.ScriptTarget.ES2022 });
let chosen: string[] = []; let closed = 0; let explicit = false;
const choose = new Function('source', 'setPickerSourceExplicit', 'setSelectedSources', 'togglePickerSource', 'closePlatformPicker', 'setPickerRegion', chooseJS);
let tappedRegion: number | null = 6;
const run = (src: string | null) => choose(src, (v: boolean) => explicit = v, (fn: any) => chosen = fn(chosen), load(source, 'togglePickerSource'), () => closed++, (v: number | null) => tappedRegion = v);
run('Aqar');
assert.equal(explicit, true); assert.deepEqual(chosen, ['Aqar']); assert.equal(closed, 0, 'lighting a site saves at once and KEEPS the sheet open (owner 2026-10-10)');
run('Wasalt'); assert.deepEqual(chosen, ['Aqar', 'Wasalt']); assert.equal(closed, 0);
run(null); assert.deepEqual(chosen, []); assert.equal(closed, 1, '«كل المواقع» clears and closes'); assert.equal(tappedRegion, null, '«كل المواقع» clears the tapped region');
// The ways out: the ✕ and a tap on the backdrop (owner 2026-10-10: no Done button — «till he clicks x»).
assert.equal((agent.match(/accessibilityLabel=\{t\('Close'\)\}\s*onPress=\{closePlatformPicker\}/g) ?? []).length, 2, 'the backdrop and the ✕ both close the sheet');
assert.ok(!/platform-picker-done/.test(agent), 'no Done button');
console.log('PASS: original brand colors, readable monochrome marks without backplates, selection keeps the sheet open, ✕/backdrop/all-websites close it.');
