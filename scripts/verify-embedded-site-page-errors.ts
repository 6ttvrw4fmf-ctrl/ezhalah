// AN EMBEDDED SOURCE SITE'S GOOGLE MAPS ERROR IS NOT AN EZHALAH EXCEPTION — AND NOTHING ELSE IS EXCUSED (2026-11-03)
//
// guardian failed `back-preserves-results [mobile]` (run 41590614252) on «InvalidValueError: initMap is not a
// function»: Google Maps' loader throwing inside a SOURCE site's page shown in our ad viewer. e2e/lib/pageErrors.mjs
// now files that one class as a note. This barrier proves the excuse is narrow AND still valid:
//   1. the measured strings are excused; every look-alike app error is NOT;
//   2. both harnesses route through the shared classifier (no private copy);
//   3. Ezhalah's own code never loads Google Maps nor names InvalidValueError — if it ever does, an error with
//      that name could be OURS, and this barrier goes RED so the excuse is revisited, not silently inherited.
//
// Run: node --experimental-strip-types scripts/verify-embedded-site-page-errors.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isEmbeddedSitePageError, isHydrationNoticePageError } from '../e2e/lib/pageErrors.mjs';
import { appPageErrors } from '../e2e/journeys/harness.mjs';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, cond: boolean) => {
  if (cond) console.log(`  ok  ${m}`);
  else { console.error(`  FAIL  ${m}`); failed++; }
};

// 1. excused — the measured shapes
for (const e of [
  'Uncaught (in promise) InvalidValueError: initMap is not a function',
  'InvalidValueError: initMap is not a function',
  'Uncaught InvalidValueError: setCenter: not a LatLng or LatLngLiteral',
]) check(`excused (embedded Google Maps): ${e}`, isEmbeddedSitePageError(e));
const errObj = Object.assign(new Error('initMap is not a function'), { name: 'InvalidValueError' });
check('excused when given the Error object (name InvalidValueError)', isEmbeddedSitePageError(errObj));

// 1b. NOT excused — app errors that look similar
for (const e of [
  "TypeError: initMap is not a function",
  "ReferenceError: initMap is not defined",
  "Error: InvalidValueError: thrown by our code would still need a real name",
  "TypeError: Cannot read properties of undefined (reading 'InvalidValueError')",
  "Minified React error #310",
  "RangeError: Invalid time value",
]) check(`NOT excused: ${e}`, !isEmbeddedSitePageError(e));
check('hydration ruling is unchanged by this class', !isHydrationNoticePageError('InvalidValueError: initMap is not a function'));

// 2. the journeys harness really routes it (EXECUTED, not grepped) — and keeps app errors as app errors
const notes: string[] = [];
const origLog = console.log;
console.log = (...a: unknown[]) => { notes.push(a.join(' ')); };
let app: string[] = [];
try {
  app = appPageErrors({ pageErrors: ['Uncaught (in promise) InvalidValueError: initMap is not a function', 'TypeError: x is undefined'] }, 'probe');
} finally { console.log = origLog; }
check('journeys harness: the embedded error is NOT an app error', !app.some((e) => e.includes('InvalidValueError')));
check('journeys harness: a real TypeError stays an app error', app.includes('TypeError: x is undefined'));
check('journeys harness: the excused error is REPORTED as a note, never dropped', notes.some((n) => n.includes('EMBEDDED-SITE')));
const guardian = readFileSync(join(ROOT, 'e2e/guardian/harness.mjs'), 'utf8');
check('guardian harness imports the shared classifier', /isEmbeddedSitePageError[^]*from '\.\.\/lib\/pageErrors\.mjs'/.test(guardian));
check('guardian harness prints the excused errors as a note', /embeddedSiteNote\('guardian'/.test(guardian));

// 3. the excuse is valid only while Ezhalah itself never uses Google Maps
const offenders: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?|mjs|html)$/.test(name) && /maps\.googleapis\.com|google\.maps\.|InvalidValueError/.test(readFileSync(p, 'utf8'))) offenders.push(p.slice(ROOT.length + 1));
  }
};
for (const d of ['src', 'api', 'public']) { try { walk(join(ROOT, d)); } catch { /* absent dir */ } }
check(`Ezhalah's own code never loads Google Maps nor names InvalidValueError (${offenders.join(', ') || 'none'})`, offenders.length === 0);

// 4. MUTATION PROOF — mutate the REAL classifier source, load the mutant, and show the checks above would fail.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const REAL = readFileSync(join(ROOT, 'e2e/lib/pageErrors.mjs'), 'utf8');
const NOT_EXCUSED = ['Error: InvalidValueError: thrown by our code would still need a real name', 'TypeError: initMap is not a function'];
async function mutation(label: string, mutate: (s: string) => string): Promise<void> {
  const mutated = mutate(REAL);
  if (mutated === REAL) { check(`MUTATION anchor found: ${label}`, false); return; }
  const dir = mkdtempSync(join(tmpdir(), 'embedded-mut-'));
  const file = join(dir, 'pageErrors.mjs');
  writeFileSync(file, mutated);
  const m = await import(pathToFileURL(file).href);
  const caught = NOT_EXCUSED.some((e) => m.isEmbeddedSitePageError(e))
    || !m.isEmbeddedSitePageError('Uncaught (in promise) InvalidValueError: initMap is not a function');
  check(`(mutation) catches: ${label}`, caught);
}
await mutation('the start anchor dropped, so «Error: InvalidValueError …» from our own code is excused', (s) =>
  s.replace('/^(?:Uncaught (?:\\(in promise\\) )?)?InvalidValueError: /', '/InvalidValueError: /'));
await mutation('the class name loosened to any error', (s) =>
  s.replace("if (err && typeof err === 'object' && err.name === 'InvalidValueError') return true;", 'return true;'));
await mutation('the classifier switched off (measured error counted again)', (s) =>
  s.replace("if (err && typeof err === 'object' && err.name === 'InvalidValueError') return true;", 'return false;'));

if (failed) { console.error(`\n❌ verify-embedded-site-page-errors: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ verify-embedded-site-page-errors: only an embedded site\'s Google Maps error is excused, and it is reported.');
