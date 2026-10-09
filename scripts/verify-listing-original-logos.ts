// Execute the real card resolver and image renderer for every registered source and its DB slugs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const h = (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } });
function execute(source: string, dependencies: Record<string, any> = {}) {
  const exports: any = {};
  const js = ts.transpileModule(source, { fileName: 'component.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: 'h' } }).outputText;
  new Function('require', 'exports', 'h', js)((path: string) => {
    if (path in dependencies) return dependencies[path];
    if (path.endsWith('.png')) return path;
    throw new Error(`Unmocked dependency: ${path}`);
  }, exports, h);
  return exports;
}
const coverage = JSON.parse(read('src/data/platformPickerCoverage.json'));
const profiles = execute(read('src/data/platformPickerProfiles.ts'), {
  './platformPickerLogoLayout.json': JSON.parse(read('src/data/platformPickerLogoLayout.json')),
  './platformPickerCoverage.json': coverage,
  '../lib/platformCoverageSentence': execute(read('src/lib/platformCoverageSentence.ts')),
}).PLATFORM_PICKER_PROFILES;
const roster = execute(read('src/data/loaderPlatforms.ts')).PLATFORM_META.filter((p: any) => !p.logoOnly);
const card = read('src/components/ResultCard.tsx');
const renderer = read('src/components/platform-logo.tsx');
function badge(source: string) {
  const start = source.indexOf('export function SourceBadge(');
  const end = source.indexOf('\n}\n', start) + 3;
  assert.ok(start > 0 && end > start, 'real SourceBadge located');
  const constants = [...source.matchAll(/^const \w+_LOGO = require\([^\n]+/gm)].map(m => m[0]).join('\n');
  return execute(`const PlatformLogo = 'PlatformLogo';\n${constants}\n${source.slice(start, end)}`).SourceBadge;
}
function verify(cardSource = card, imageSource = renderer, theme = 'light') {
  const SourceBadge = badge(cardSource);
  const PlatformLogo = execute(imageSource, {
    'expo-image': { Image: 'Image' }, 'react-native': { View: 'View' },
    '@/lib/appearance': { useResolvedTheme: () => theme },
    './platform-logo-bounds': execute(read('src/components/platform-logo-bounds.ts')),
    '@/data/platformPickerProfiles': { PLATFORM_PICKER_PROFILES: profiles },
  }).PlatformLogo;
  const mismatches: string[] = [];
  for (const platform of roster) {
    const profile = profiles[platform.name];
    assert.equal(platform.logo, profile.logo, `${platform.name}: loader uses the supplied original asset`);
    const aliases = coverage.platforms[platform.name]?.slugs;
    assert.ok(aliases?.length, `${platform.name}: DB aliases are known`);
    for (const source of aliases) {
      const badgeNode = SourceBadge({ source });
      assert.equal(badgeNode.type, 'PlatformLogo', `${source}: has a logo`);
      if (badgeNode.props.source !== profile.logo) { mismatches.push(`${source}: expected ${platform.name}`); continue; }
      const node = PlatformLogo(badgeNode.props);
      assert.equal(node.type, 'View');
      assert.equal(node.props.style.width, 96);
      assert.equal(node.props.style.height, 48);
      assert.equal(node.props.style.backgroundColor, profile.layout.dark ? '#263D32' : theme === 'dark' ? '#FFFFFF' : 'transparent');
      const image = node.props.children[0];
      assert.equal(image.props.source, profile.logo, `${source}: original colors reach the rendered image`);
      assert.equal(image.props.style.width, profile.layout.width);
      assert.equal(image.props.style.height, profile.layout.height);
      assert.equal(image.props.style.left, profile.layout.left);
      assert.equal(image.props.style.top, profile.layout.top);
      assert.equal(image.props.style.tintColor, undefined);
    }
  }
  assert.deepEqual(mismatches, [], 'card source aliases use their own supplied logos');
  assert.equal(profiles['Deal App'].logo, '../../assets/images/dealapp.png', 'Deal is the original yellow asset');
}
verify();
verify(card, renderer, 'dark');
assert.equal(profiles['نفوذ'].layout.dark, true, 'Nufouth white lettering needs contrast even beside a colored symbol');
// Watch the actual previous failures fail: missing brand, old favicon, and black Deal variant.
for (const [name, mutatedCard, mutatedRenderer] of [
  ['generic placeholder', card.replace(/const WADOD_LOGO = require\('[^']+'\)/, "const WADOD_LOGO = require('../../assets/images/platform-placeholder.png')"), renderer],
  ['old Nufouth favicon', card.replace(/const NUFOUTH_LOGO = require\('[^']+'\)/, "const NUFOUTH_LOGO = require('../../assets/images/nufouth.png')"), renderer],
  ['Deal recoloring', card, renderer.replace('source={source}', "source={source === require('../../assets/images/dealapp.png') ? require('../../assets/images/platform-contrast/dealapp-light.png') : source}")],
] as const) {
  assert.ok(mutatedCard !== card || mutatedRenderer !== renderer, `${name}: mutation target exists`);
  assert.throws(() => verify(mutatedCard, mutatedRenderer), assert.AssertionError, `${name}: mutant must fail`);
}
console.log(`PASS: ${roster.length} listing brands and their DB aliases render original assets in equal 96×48 frames; all three regression mutants caught.`);
