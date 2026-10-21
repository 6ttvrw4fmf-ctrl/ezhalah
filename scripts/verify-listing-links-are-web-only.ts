// SECURITY (owner-approved plan, Phase 1.6, 2026-10-21): a listing link opens only as a real web page.
//
// THE HOLE. A listing's address is scraped from a source site and was opened as-is: window.open() in a new tab,
// the in-app viewer's <iframe src>, the native in-app browser. A stored `javascript:…` or `data:text/html,…`
// address would run its script ON OUR ORIGIN, next to the signed-in user's session.
//
// THE FIX. src/lib/safeUrl.ts safeHttpUrl() keeps http/https and drops everything else, and every place that opens
// a listing address goes through it: listingOpenUrl() (the one resolver the cards, the viewer tabs and native use),
// the old /browser screen, the viewer's iframe + «new window», and the preview's open().
//
// This barrier EXECUTES safeHttpUrl against real attack strings, then checks each opener still routes through it.
//   node --experimental-strip-types scripts/verify-listing-links-are-web-only.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeHttpUrl } from '../src/lib/safeUrl.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

// 1. The helper, executed.
const keep = ['https://sa.aqar.fm/ad/123', 'http://example.com/x?y=1', 'https://gathern.co/ar/view/1/unit/2'];
const drop = ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>1</script>',
  'vbscript:x', 'file:///etc/passwd', '//evil.com/x', '/relative', '', null, undefined];
check('real web addresses still open', keep.every((u) => safeHttpUrl(u) === u), keep.filter((u) => safeHttpUrl(u) !== u).join(', '));
check('script / data / file / relative addresses never open', drop.every((u) => safeHttpUrl(u as string) === undefined),
  drop.filter((u) => safeHttpUrl(u as string) !== undefined).map(String).join(', '));

// 2. Every opener routes through it (each pattern is the guarded line; losing it means a raw address is opened again).
const WIRING: [string, RegExp, string][] = [
  ['src/lib/openListing.ts', /return safeHttpUrl\(localizeAdUrl\(url, getLocale\(\)\)\);/, 'listingOpenUrl() returns a checked address'],
  ['src/app/browser.tsx', /const realUrl = safeHttpUrl\(/, '/browser «open» uses a checked address'],
  ['src/components/AdViewer.tsx', /const activeUrl = safeHttpUrl\(/, 'viewer «new window» uses a checked address'],
  ['src/components/AdViewer.tsx', /const url = safeHttpUrl\(tab\.url\)/, 'viewer iframe src is a checked address'],
  ['src/components/ListingPreview.tsx', /const safe = safeHttpUrl\(href\);[\s\S]{0,120}window\.open\(safe, '_blank'\)/, 'preview open() uses a checked address'],
];
const wiringProblems = (src: (p: string) => string) => WIRING.filter(([f, re]) => !re.test(src(f))).map(([, , l]) => l);
const wp = wiringProblems(read);
check('every listing opener goes through safeHttpUrl', wp.length === 0, 'missing: ' + wp.join('; '));

// 3. Mutations.
mustCatch('the helper letting javascript: through', (() => { const bad = (u: string) => u; return bad('javascript:alert(1)') !== undefined; })());
mustCatch('listingOpenUrl returning the raw address', wiringProblems((p) => p === 'src/lib/openListing.ts'
  ? read(p).replace('return safeHttpUrl(localizeAdUrl(url, getLocale()));', 'return localizeAdUrl(url, getLocale());') : read(p)).length > 0);
mustCatch('the viewer iframe taking tab.url raw', wiringProblems((p) => p === 'src/components/AdViewer.tsx'
  ? read(p).replace(/const url = safeHttpUrl\(tab\.url\) \?\? 'about:blank';/, 'const url = tab.url;') : read(p)).length > 0);

if (failed) { console.error(`\n❌ verify-listing-links-are-web-only: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-listing-links-are-web-only: listing links open only as http/https pages.');
