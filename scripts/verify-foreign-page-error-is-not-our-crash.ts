// The «built app runs» smoke must not fail Ezhalah for ANOTHER website's crash — and must still fail on ours.
// Root cause of the 6% flake (2026-10-29): React #419 thrown inside sanadak.sa's own Next.js page. EXECUTES the predicate
// the smoke uses (scripts/lib/foreignError.mjs) against the real stack from that failure and against our own crashes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isForeignOnlyError } from './lib/foreignError.mjs';

const root = join(import.meta.dirname, '..');
let fail = 0, mutFail = 0;
const check = (l: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}`); if (!ok) fail++; };
const mustCatch = (l: string, caught: boolean) => { console.log(`  ${caught ? 'PASS' : 'FAIL'}  ${caught ? 'catches' : 'BLIND to'}: ${l}`); if (!caught) mutFail++; };

const APP = 'http://127.0.0.1:41753/agent';
// The exact frames from run 40954051569 (2026-10-29 21:13).
const SANADAK = 'Error: Minified React error #419\n    at https://sanadak.sa/_next/static/chunks/fd9d1056-ac5764341ce93b26.js:1:64806\n    at lZ (https://sanadak.sa/_next/static/chunks/fd9d1056-ac5764341ce93b26.js:1:65677)\n    at iZ (https://sanadak.sa/_next/static/chunks/fd9d1056-ac5764341ce93b26.js:1:121472)';
const OURS = 'TypeError: x is undefined\n    at render (http://127.0.0.1:41753/_expo/static/js/web/entry-abc.js:2:100)';
const MIXED = SANADAK + '\n    at onClick (http://127.0.0.1:41753/_expo/static/js/web/entry-abc.js:9:9)';

console.log('\nA third-party page crash is not an Ezhalah crash; ours still fail the smoke\n');
check('sanadak.sa\'s own React #419 (the 6% flake) is foreign', isForeignOnlyError(SANADAK, APP));
check('a crash in OUR bundle is never foreign', !isForeignOnlyError(OURS, APP));
check('a stack with even one of our frames is never foreign', !isForeignOnlyError(MIXED, APP));
check('no stack at all stays an Ezhalah crash (fail closed)', !isForeignOnlyError('', APP) && !isForeignOnlyError(undefined as unknown as string, APP));
check('an unreadable app URL stays an Ezhalah crash (fail closed)', !isForeignOnlyError(SANADAK, 'not a url'));
const smoke = readFileSync(join(root, 'scripts/verify-web-runtime-smoke.mjs'), 'utf8');
check('the smoke really uses this predicate before counting a crash',
  /if \(isForeignOnlyError\(e\?\.stack, page\.url\(\)\)\) \{[\s\S]{0,300}?return;\s*\}[\s\S]{0,400}?crashes\.push\(/.test(smoke));

console.log('\n  mutation proof\n');
const everyForeign = (st: string) => true;                                   // excuses everything
mustCatch('a predicate that excuses every error (our crash would pass)', everyForeign(OURS) !== isForeignOnlyError(OURS, APP));
const anyForeign = (st: string, app: string) => /https?:\/\/(?!127\.0\.0\.1)/.test(st); // «any foreign frame»
mustCatch('«any foreign frame» instead of «every frame foreign» (a mixed stack would pass)', anyForeign(MIXED, APP) !== isForeignOnlyError(MIXED, APP));
const noStackForeign = (st: string, app: string) => !st || isForeignOnlyError(st, app);
mustCatch('a missing stack read as foreign (fail open)', noStackForeign('', APP) !== isForeignOnlyError('', APP));
mustCatch('the smoke no longer calling the predicate', !/isForeignOnlyError\(e\?\.stack/.test(smoke.replace(/if \(isForeignOnlyError\(e\?\.stack, page\.url\(\)\)\)/, 'if (false)')));

if (fail || mutFail) { console.error(`\n❌ foreign-page-error: ${fail} check(s), ${mutFail} mutation(s) failed`); process.exit(1); }
console.log('\n✅ foreign-page-error: another site\'s crash is noted, never counted; Ezhalah\'s crashes still fail.');
