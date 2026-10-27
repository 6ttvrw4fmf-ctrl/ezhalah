// A GUARDIAN DOOR MUST ASSERT COPY THE APP STILL RENDERS (auto-fixer, 2026-10-27).
//
// e2e/guardian/journeys.mjs «the-doors-open» proves /about and /support are open by finding their
// own copy on screen. The owner's About redesign dropped the «الثقة والشفافية» and «إخلاء المسؤولية»
// headings, but the door kept asserting them, so the journey FAILED on every build: on the stable
// build and the canary alike (deploy run 40590898653). The canary gate only acts on a regression
// AGAINST stable, so a journey failing on both is blind: a real /about break could ship unseen.
// The translations stayed behind in src/i18n.tsx, which is why "the string exists in src/" is NOT
// enough and this check asks the sharper question: does some component actually render it?
//
// A door string counts as rendered when it is written literally in a src/ component, or it is (part
// of) the Arabic value of an i18n key that some src/ file other than i18n.tsx passes to t().
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function srcFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) srcFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

export function doorStrings(journeys: string): string[] {
  const block = journeys.match(/const DOORS = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error('DOORS not found in e2e/guardian/journeys.mjs');
  const out: string[] = [];
  for (const m of block[1].matchAll(/must:\s*\[([^\]]*)\]/g)) {
    for (const s of m[1].matchAll(/'([^']+)'/g)) out.push(s[1]);
  }
  return out;
}

export function unrendered(strings: string[], i18n: string, components: string[]): string[] {
  const entries = [...i18n.matchAll(/'((?:[^'\\]|\\.)+)':\s*'((?:[^'\\]|\\.)+)'/g)].map((m) => [m[1], m[2]]);
  const body = components.join('\n');
  return strings.filter((s) => {
    if (body.includes(s)) return false;
    const keys = entries.filter(([, v]) => v.includes(s)).map(([k]) => k);
    return !keys.some((k) => body.includes(`t('${k}')`) || body.includes(`t("${k}")`));
  });
}

const journeys = readFileSync(join(ROOT, 'e2e/guardian/journeys.mjs'), 'utf8');
const i18nPath = join(ROOT, 'src/i18n.tsx');
const i18n = readFileSync(i18nPath, 'utf8');
const components = srcFiles(join(ROOT, 'src')).filter((p) => p !== i18nPath).map((p) => readFileSync(p, 'utf8'));

// Mutation proof: the heading the redesign removed must read as unrendered, and a door string that a
// component does render must not, so the check can neither stay silent nor cry wolf. («إخلاء المسؤولية»
// is not used here: the legal reader still prints it, so this whole-app check cannot tell it is gone
// from /about. The check is app-wide, not per-door; the live journey is the per-door proof.)
const ghost = unrendered(['الثقة والشفافية'], i18n, components);
if (ghost.length !== 1) {
  console.error(`✗ guardian door copy: mutation proof failed, the removed About headings read as rendered (${JSON.stringify(ghost)})`);
  process.exit(1);
}
if (unrendered(['من نحن'], i18n, components).length) {
  console.error('✗ guardian door copy: mutation proof failed, «من نحن» (rendered by InfoModal) reads as unrendered');
  process.exit(1);
}

const strings = doorStrings(journeys);
if (strings.length < 4) {
  console.error(`✗ guardian door copy: found only ${strings.length} door strings, the DOORS parser is broken`);
  process.exit(1);
}
const missing = unrendered(strings, i18n, components);
if (missing.length) {
  console.error(`✗ guardian door copy: «the-doors-open» asserts copy no component renders: ${JSON.stringify(missing)}`);
  console.error('  The journey will fail on stable AND canary, which blinds the canary gate. Assert the copy the screen shows now.');
  process.exit(1);
}
console.log(`✓ guardian door copy: all ${strings.length} door strings are rendered by a component (mutation proof: removed About heading caught)`);
