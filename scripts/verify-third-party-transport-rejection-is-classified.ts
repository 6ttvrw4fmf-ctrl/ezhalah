import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

// 🔧 2026-10-19 — Sentry REACT-NATIVE-D/E: a bare «NetworkError» (DOMException code 19) rejected into the
// global unhandledrejection handler on a page carrying Google's GSI script is One Tap's own status call,
// refused by the engine's privacy rules (seen verbatim on the webkit sweep 39236332307). The app must
// report it as a WARNING with its own fingerprint — never as an Ezhalah error, and never silently.
// This barrier EXECUTES the classifier lifted from the real module, pins both directions (a NetworkError
// on a page WITHOUT the GSI script, and a real exception on a page WITH it, keep the error level), and
// pins that the handler and reportError actually carry the verdict to Sentry.

const ROOT = join(import.meta.dirname, '..');
const OBS = join(ROOT, 'src/lib/observability.ts');
const LAYOUT = join(ROOT, 'src/app/_layout.tsx');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nA third-party transport failure is classified, not swallowed and not filed as an Ezhalah error\n');

const lifted = await liftSymbols(OBS, [
  { header: 'export function classifyRejection(', endsWith: /^\}$/ },
], ['classifyRejection']);
type Cls = { thirdPartyTransport: boolean; level: string; fingerprint?: string[]; tags?: Record<string, string> };
const classify = lifted.classifyRejection as (reason: unknown, gsi: boolean) => Cls;

const netErr = { name: 'NetworkError', code: 19, message: 'A network error occurred.' };
const typeErr = Object.assign(new TypeError("undefined is not an object (evaluating 'x.y')"), {});

const gsi = classify(netErr, true);
check('NetworkError code 19 + GSI script on the page → third-party transport', gsi.thirdPartyTransport === true);
check('  …reported as a WARNING (still reported)', gsi.level === 'warning');
check('  …under its own fingerprint naming gsi', Array.isArray(gsi.fingerprint) && gsi.fingerprint.includes('gsi'));
check('  …tagged third_party_transport=gsi', gsi.tags?.third_party_transport === 'gsi');
check('NetworkError code 19 WITHOUT the GSI script → origin unknown → stays an ERROR', (() => { const c = classify(netErr, false); return c.thirdPartyTransport === false && c.level === 'error'; })());
check('a NetworkError with another code is not the shape', classify({ name: 'NetworkError', code: 18 }, true).thirdPartyTransport === false);
check('a real TypeError on a page WITH the GSI script stays an ERROR', (() => { const c = classify(typeErr, true); return c.thirdPartyTransport === false && c.level === 'error'; })());
check('a string / null / undefined reason is never third-party transport',
  [classify('NetworkError', true), classify(null, true), classify(undefined, true)].every((c) => c.thirdPartyTransport === false && c.level === 'error'));
check('a DOMException whose code arrives as the string "19" still matches (engines differ)', classify({ name: 'NetworkError', code: '19' }, true).thirdPartyTransport === true);

// Mutations, executed: the three ways the classifier could decay.
const alwaysTransport = (r: any) => ({ thirdPartyTransport: !!r, level: 'warning' });   // ignores the GSI evidence
const ignoresName = (r: any, g: boolean) => ({ thirdPartyTransport: !!r && g, level: g ? 'warning' : 'error' }); // any rejection with GSI
const swallows = () => ({ thirdPartyTransport: true, level: 'warning', fingerprint: [] });
mustCatch('a classifier that ignores the GSI evidence', alwaysTransport(netErr).thirdPartyTransport !== classify(netErr, false).thirdPartyTransport);
mustCatch('a classifier that ignores the reason name', ignoresName(typeErr, true).thirdPartyTransport !== classify(typeErr, true).thirdPartyTransport);
mustCatch('a classifier with an empty fingerprint', (swallows().fingerprint as string[]).length === 0 && (classify(netErr, true).fingerprint ?? []).length > 0);

// The verdict must reach Sentry: the handler asks the classifier and hands level/fingerprint/tags on.
const layout = readFileSync(LAYOUT, 'utf8');
check('_layout.tsx asks classifyRejection with the GSI-script evidence', /classifyRejection\(r, gsiScriptPresent\)/.test(layout));
check('_layout.tsx detects the GSI script by its real host', /script\[src\*="accounts\.google\.com\/gsi"\]/.test(layout));
check('_layout.tsx hands the verdict (level, fingerprint, tags) to reportError', /cls\.thirdPartyTransport \? \{ level: cls\.level, fingerprint: cls\.fingerprint, tags: cls\.tags \} : undefined/.test(layout));
check('_layout.tsx still forwards the rejection itself (observability contract unchanged)', /reportError\(ev\?\.reason \?\? new Error\('unhandledrejection'\)/.test(layout));
const obs = readFileSync(OBS, 'utf8');
check('reportError forwards level, fingerprint and tags to captureException',
  /if \(opts\?\.level\) ctx\.level = opts\.level;/.test(obs) && /if \(opts\?\.fingerprint\) ctx\.fingerprint = opts\.fingerprint;/.test(obs) && /if \(opts\?\.tags\) ctx\.tags = opts\.tags;/.test(obs));
check('reportError still scrubs the extra context (PDPL)', /ctx\.extra = scrubValue\(context\)/.test(obs));

console.log(failed ? `\n❌ verify-third-party-transport-rejection-is-classified: ${failed} check(s) failed` : '\n✓ a third-party transport rejection is a tagged warning, an unknown one stays an error, nothing is swallowed');
process.exit(failed ? 1 : 0);
