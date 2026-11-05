// The ad-viewer speed robot's «does production still ship the instant-show tab?» must read the WHOLE split build.
// It read only the first <script> — after the 2026-10-27 split that is the 3.8 KB metro runtime — and failed on every
// run (41567582462) while production shipped the tab in the agent route chunk. EXECUTED against a fake site.
// Run: node --experimental-strip-types scripts/verify-shipped-bundle-reader.ts
import { shippedInstantShowTab, shippedScriptsText } from '../e2e/lib/shippedBundle.mjs';

let failed = 0;
const check = (m: string, c: boolean) => { if (c) console.log(`  ok  ${m}`); else { console.error(`  FAIL  ${m}`); failed++; } };
const H = (n: string) => `${n}-${'a'.repeat(32)}.js`;
const site = (files: Record<string, string>) => async (u: string) => {
  const path = u.replace('https://x', '').replace(/\?cb=\d+$/, '');
  return files[path] ?? '';
};
const html = `<script src="/_expo/static/js/web/${H('__expo-metro-runtime')}"></script><script src="/_expo/static/js/web/${H('entry')}"></script>`;

// the measured shape: runtime first, tab in a route chunk referenced by the entry
let r = await shippedInstantShowTab('https://x', site({
  '/': html,
  [`/_expo/static/js/web/${H('__expo-metro-runtime')}`]: 'runtime',
  [`/_expo/static/js/web/${H('entry')}`]: `routes: "${H('agent')}" "${H('index')}"`,
  [`/_expo/static/js/web/${H('index')}`]: 'home',
  [`/_expo/static/js/web/${H('agent')}`]: 'testID:"ad-load-bar" testID:"ad-slow-hint"',
}));
check('finds the tab in a route chunk behind the runtime script', r.shipped === H('agent'));

// the tab really gone everywhere → not shipped (and files were read)
r = await shippedInstantShowTab('https://x', site({
  '/': html,
  [`/_expo/static/js/web/${H('__expo-metro-runtime')}`]: 'runtime',
  [`/_expo/static/js/web/${H('entry')}`]: `"${H('agent')}"`,
  [`/_expo/static/js/web/${H('agent')}`]: 'testID:"ad-load-bar" only',
}));
check('a build missing ad-slow-hint is NOT shipped', r.shipped === null && r.files >= 3);

// nothing readable → files 0 (the caller fails it, never a pass)
r = await shippedInstantShowTab('https://x', async () => '');
check('an unreadable site reads 0 files (a failure, not a pass)', r.files === 0 && r.shipped === null);

// MUTATION PROOF — mutate the REAL reader, load it, and show the measured-shape check above would fail.
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const REAL = readFileSync(join(import.meta.dirname, '..', 'e2e/lib/shippedBundle.mjs'), 'utf8');
const MEASURED = site({
  '/': html,
  [`/_expo/static/js/web/${H('__expo-metro-runtime')}`]: 'runtime',
  [`/_expo/static/js/web/${H('entry')}`]: `routes: "${H('agent')}"`,
  [`/_expo/static/js/web/${H('agent')}`]: 'testID:"ad-load-bar" testID:"ad-slow-hint"',
});
async function mutation(label: string, mutate: (s: string) => string): Promise<void> {
  const mutated = mutate(REAL);
  if (mutated === REAL) { check(`MUTATION anchor found: ${label}`, false); return; }
  const dir = mkdtempSync(join(tmpdir(), 'bundle-mut-'));
  const file = join(dir, 'shippedBundle.mjs');
  writeFileSync(file, mutated);
  const m = await import(pathToFileURL(file).href);
  const res = await m.shippedInstantShowTab('https://x', MEASURED);
  check(`(mutation) catches: ${label}`, res.shipped !== H('agent'));
}
await mutation('reading only the first <script> (THE ORIGINAL DEFECT)', (s) => s.replace('const queue = [...first];', 'const queue = first.slice(0, 1);'));
await mutation('never following the route chunks a script references', (s) => s.replace('if (!seen.has(p)) { seen.add(p); queue.push(p); }', 'void p;'));
await mutation('accepting a script with only one of the two testIDs', (s) => s.replace("js.includes('ad-load-bar') && js.includes('ad-slow-hint')", "js.includes('nothing-ships-this')"));


// shippedScriptsText — the WHOLE served build as text (frontend-bundle parity, 2026-11-05)
const T = await shippedScriptsText('https://x', MEASURED);
check('shippedScriptsText reads every script and the chunk the entry names', T.files === 3 && T.missing === 0 && T.text.includes('ad-slow-hint'));
const T0 = await shippedScriptsText('https://x', async () => '');
check('shippedScriptsText on an unreadable site reads 0 files (the caller fails it)', T0.files === 0 && T0.text === '');
const T1 = await shippedScriptsText('https://x', site({ '/': html, [`/_expo/static/js/web/${H('entry')}`]: 'entry' }));
check('shippedScriptsText counts an unreadable script as missing (never silently skipped)', T1.missing === 1);
async function mutationText(label: string, mutate: (s: string) => string): Promise<void> {
  const mutated = mutate(REAL);
  if (mutated === REAL) { check(`MUTATION anchor found: ${label}`, false); return; }
  const dir = mkdtempSync(join(tmpdir(), 'bundle-mut-'));
  const file = join(dir, 'shippedBundle.mjs');
  writeFileSync(file, mutated);
  const m = await import(pathToFileURL(file).href);
  const res = await m.shippedScriptsText('https://x', MEASURED);
  check(`(mutation) catches: ${label}`, !res.text.includes('ad-slow-hint') || res.missing !== 0 || res.files !== 3);
}
await mutationText('shippedScriptsText reading only the first script', (s) => s.replace('const pending = [...first];', 'const pending = first.slice(0, 1);'));
await mutationText('shippedScriptsText never following route chunks', (s) => s.replace('if (!seen.has(p)) { seen.add(p); pending.push(p); }', 'void p;'));

if (failed) { console.error(`\n❌ verify-shipped-bundle-reader: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ verify-shipped-bundle-reader: the speed robot reads the whole split build.');
