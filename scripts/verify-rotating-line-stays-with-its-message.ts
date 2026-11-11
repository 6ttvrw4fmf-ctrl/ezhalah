// A message keeps ONE rotating line on every device and every reopen (owner 2026-11-09: a reopened /
// shared chat showed a 🎉 line the first time had not; «it shows later when user clicks new chat …
// this applies to everything»). See src/lib/stablePick.ts.
//
// EXECUTED, not grepped: each picker module is loaded twice as two independent instances (two
// devices / a refresh / the person a chat was shared with — nothing remembered between them) and must
// give the same line for the same message id. A mutant that picks at random again must be caught.
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) failures++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) caught: ${name}`, caught);

type Pick = (a: { lang: 'ar' | 'en'; name: string | null; count?: string; stableKey?: string }) => string;
const PICKERS = [
  { file: 'resultsFoundRotation.ts', fn: 'pickResultsFoundSentence' },
  { file: 'noResultsRotation.ts', fn: 'pickNoResultsSentence' },
];

// Copy src/data/<file> + src/lib/stablePick.ts into a fresh folder (optionally mutated) and import it.
async function load(file: string, fn: string, tag: string, mutate?: (s: string) => string): Promise<Pick> {
  const dir = mkdtempSync(join(tmpdir(), `stablepick-${tag}-`));
  mkdirSync(join(dir, 'data')); mkdirSync(join(dir, 'lib'));
  copyFileSync(join(root, 'src/lib/stablePick.ts'), join(dir, 'lib/stablePick.ts'));
  let src = readFileSync(join(root, 'src/data', file), 'utf8');
  if (mutate) src = mutate(src);
  writeFileSync(join(dir, 'data', file), src);
  const mod = await import(pathToFileURL(join(dir, 'data', file)).href);
  return mod[fn] as Pick;
}

const ids = Array.from({ length: 60 }, (_, i) => `m${1730000000000 + i * 7919}${(i * 2654435761 >>> 0).toString(36)}`);

async function stable(file: string, fn: string, tag: string, mutate?: (s: string) => string): Promise<{ same: boolean; variety: number }> {
  const a = await load(file, fn, tag + 'a', mutate);
  const b = await load(file, fn, tag + 'b', mutate);
  let same = true;
  const seen = new Set<string>();
  for (const lang of ['ar', 'en'] as const) for (const name of [null, 'يوسف']) for (const id of ids) {
    const args = { lang, name, count: "1,234", stableKey: `${lang}|${name ?? ""}|${id}` };
    const x = a(args), y = b(args);
    if (x !== y) same = false;
    seen.add(x);
  }
  return { same, variety: seen.size };
}

for (const { file, fn } of PICKERS) {
  const r = await stable(file, fn, fn);
  check(`${fn}: the same message shows the same line on a second device / after a refresh / for a shared copy`, r.same);
  check(`${fn}: different messages still rotate (${r.variety} distinct lines over ${ids.length * 4} picks)`, r.variety >= 30);
  const m = await stable(file, fn, fn + '-mut', (s) => s.replace('stableIndex(args.stableKey, pool.length)', 'Math.floor(Math.random() * pool.length)'));
  mustCatch(`${fn}: a random pick per device again`, !m.same);
}

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\nPASS — a message keeps its line everywhere; a new chat brings a new one.');
