// THE SEARCH LOADER NEVER SHOWS EMPTY LOGO FRAMES ON A SLOW PHONE (owner, 2026-10-25).
//
// Owner's iPhone screenshot: «نبحث في 148 منصة عقارية…» — every tile a name and an empty frame. Measured
// that day: the logo PNGs were served (200, image/png) but with `Cache-Control: public, max-age=0,
// must-revalidate`, so every search re-fetched ~145 of them (≈3 MB) while the loader was up for a few
// seconds, and nothing fetched them earlier. A local build on a fast link drew them all — the defect is
// delivery, not drawing.
//
// Two guards, both EXECUTED or read structurally, never grepped as prose:
//   1. vercel.json: /assets/* (every name carries a content hash — Expo's export) is `immutable`, and
//      the catch-all `max-age=0` rule no longer matches /assets/.
//   2. src/lib/prefetchLoaderLogos.ts runs against fake logos/navigator/timer: it fetches every web logo
//      URL once, after its delay, skips native ids and Save-Data; the ROOT LAYOUT wires it on web.
//   3. The post-deploy live gate (verify-live-loader-logos.ts, run by deploy-frontend.yml) — its shared
//      verdict is mutation-proved here, and its home is asserted by execution.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { logoUris, scheduleLogoPrefetch, LOGO_PREFETCH_DELAY_MS } from '../src/lib/prefetchLoaderLogos.ts';
import { logoDeliveryProblems, MIN_PREFETCHED_LOGOS } from './lib/loaderLogoDelivery.mjs';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';

const root = join(import.meta.dirname, '..');
let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  fail++;
  console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

type Rule = { source: string; headers: { key: string; value: string }[] };
const cacheFor = (rules: Rule[], path: string): string | undefined => {
  // Vercel applies every matching rule; a later rule's same key overrides an earlier one.
  let v: string | undefined;
  for (const r of rules) {
    const re = new RegExp('^' + r.source.replace(/\(\.\*\)/g, '(.*)') + '$');
    if (re.test(path)) for (const h of r.headers) if (h.key.toLowerCase() === 'cache-control') v = h.value;
  }
  return v;
};
const LOGO = '/assets/assets/images/platform-logos/sa-aqar-fm.c6d4cf4bb4fdea1af1272b421b2e7845.png';
const assetsImmutable = (rules: Rule[]) => /immutable/.test(cacheFor(rules, LOGO) ?? '') && /max-age=31536000/.test(cacheFor(rules, LOGO) ?? '');

console.log('\nThe loader\'s logos are cached and fetched before the loader appears\n');
const rules: Rule[] = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).headers;
check('a hashed /assets/ logo is served immutable for a year (phones keep it)', assetsImmutable(rules), String(cacheFor(rules, LOGO)));
check('pages still revalidate (/, /agent) — only hashed assets became immutable',
  /must-revalidate/.test(cacheFor(rules, '/') ?? '') && /must-revalidate/.test(cacheFor(rules, '/agent') ?? ''));
check('the /_expo/ bundle rule is untouched', /immutable/.test(cacheFor(rules, '/_expo/static/js/web/entry-x.js') ?? ''));

const LOGOS = [{ uri: '/assets/a.1.png', width: 1, height: 1 }, { uri: '/assets/b.2.png' }, { uri: '/assets/a.1.png' }, 17, null, { uri: '' }];
check('logoUris keeps every web logo URL once, skips native ids and blanks', JSON.stringify(logoUris(LOGOS)) === JSON.stringify(['/assets/a.1.png', '/assets/b.2.png']), JSON.stringify(logoUris(LOGOS)));
{
  const got: string[][] = []; let waited = -1; let fire: (() => void) | null = null;
  const ok = scheduleLogoPrefetch(LOGOS, (u) => got.push(u), {}, (fn, ms) => { fire = fn; waited = ms; });
  check('it schedules one fetch after the delay and nothing before', ok && got.length === 0 && waited === LOGO_PREFETCH_DELAY_MS);
  (fire as (() => void) | null)?.();
  check('when the delay passes, every logo URL is fetched in one call', got.length === 1 && got[0].length === 2);
}
check('Save-Data on → nothing fetched', scheduleLogoPrefetch(LOGOS, () => { throw new Error('fetched'); }, { connection: { saveData: true } }, () => {}) === false);
check('no web logos (native) → nothing scheduled', scheduleLogoPrefetch([1, 2, 3], () => {}, {}, () => { throw new Error('scheduled'); }) === false);
{
  let fire: (() => void) | null = null;
  scheduleLogoPrefetch(LOGOS, () => { throw new Error('network'); }, {}, (fn) => { fire = fn; });
  let threw = false; try { (fire as (() => void) | null)?.(); } catch { threw = true; }
  check('a failing prefetch never throws into the app', !threw);
}
// WHERE it is wired matters: a route's module only runs once that route opens, so in SearchLoader the
// prefetch never ran on Home (measured 2026-10-25: 11 logos before a search). The root layout runs on
// every page.
const layout = readFileSync(join(root, 'src/app/_layout.tsx'), 'utf8');
const LAYOUT_WIRE = /useEffect\(\(\) => \{\s*if \(Platform\.OS === 'web'\) scheduleLogoPrefetch\(PLATFORM_META\.map\(\(p\) => p\.logo\), \(uris\) => ExpoImage\.prefetch\(uris\)\);\s*\}, \[\]\);/;
check('the ROOT LAYOUT schedules the prefetch on web with every catalog logo (runs on every page)', LAYOUT_WIRE.test(layout));
const loader = readFileSync(join(root, 'src/components/SearchLoader.tsx'), 'utf8');
check('it is not (only) in a route-level module, where it never ran on Home', !/scheduleLogoPrefetch/.test(loader));

// The live post-deploy gate's verdict — the SAME predicate verify-live-loader-logos.ts uses.
const IMM = 'public, max-age=31536000, immutable';
const logo = (i: number, cc = IMM, status = 200) => ({ url: `https://x/assets/assets/images/platform-logos/p${i}.abc.png`, status, cacheControl: cc });
const healthy = Array.from({ length: 140 }, (_, i) => logo(i));
const kept = healthy.map((r) => ({ url: r.url, status: 200, fromCache: true }));
check('live verdict: 140 prefetched, immutable, kept on a second visit → clean', logoDeliveryProblems(healthy, kept).length === 0, logoDeliveryProblems(healthy, kept).join('; '));
// Any context.route() — the robot pass adds two — switches Playwright's HTTP cache OFF, so the second-visit
// half could only ever read «re-downloaded». Deploy run 1019 (2026-10-26) failed a correct build that way.
const liveSrc = readFileSync(join(root, 'scripts/verify-live-loader-logos.ts'), 'utf8');
const dropsRoutesFirst = (src: string) => {
  const u = src.indexOf('await context.unrouteAll('); const p = src.indexOf('await context.newPage()');
  return u > -1 && p > -1 && u < p;
};
check('the live gate drops the robot-pass routes before opening its page (a routed context has no HTTP cache)', dropsRoutesFirst(liveSrc));
const homing = liveHalfProblems('verify-live-loader-logos.ts', loadRegistry(root),
  (n) => existsSync(join(root, 'scripts', n)), (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return null; } });
check('the live gate is homed in the deploy workflow and really invoked there', homing.length === 0, homing.join('; '));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const noAssetsRule = rules.filter((r) => r.source !== '/assets/(.*)');
mustCatch('the /assets/ immutable rule removed', !assetsImmutable(noAssetsRule));
const catchAllBack = rules.map((r) => r.source === '/((?!_expo/|assets/).*)' ? { ...r, source: '/((?!_expo/).*)' } : r);
mustCatch('the catch-all max-age=0 rule matching /assets/ again (and overriding it)', !assetsImmutable([...catchAllBack.filter((r) => r.source !== '/assets/(.*)'), ...catchAllBack.filter((r) => r.source === '/assets/(.*)')].reverse()));

mustCatch('the wiring moved back into a route module (layout no longer has it)', !LAYOUT_WIRE.test(layout.replace(LAYOUT_WIRE, '')));
mustCatch('live: today\'s production — no prefetch (11 logos before a search)', logoDeliveryProblems(healthy.slice(0, 11), []).some((p) => /prefetch did not run/.test(p)));
mustCatch('live: logos served max-age=0, must-revalidate', logoDeliveryProblems(healthy.map((r, i) => i === 5 ? { ...r, cacheControl: 'public, max-age=0, must-revalidate' } : r), kept).some((p) => /not cached long-term/.test(p)));
mustCatch('live: a short max-age that only claims immutable', logoDeliveryProblems(healthy.map((r) => ({ ...r, cacheControl: 'max-age=60, immutable' })), kept).length > 0);
mustCatch('live: a logo that 404s', logoDeliveryProblems([...healthy, logo(999, IMM, 404)], kept).some((p) => /did not load/.test(p)));
mustCatch('live: a second visit re-downloads a logo', logoDeliveryProblems(healthy, [...kept, { url: healthy[0].url, status: 304, fromCache: false }]).some((p) => /second visit/.test(p)));
mustCatch(`live: one logo short of the ${MIN_PREFETCHED_LOGOS} floor`, logoDeliveryProblems(healthy.slice(0, MIN_PREFETCHED_LOGOS - 1), kept).length > 0);
mustCatch('the live gate keeping the robot-pass routes (cache off → a correct build fails)', !dropsRoutesFirst(liveSrc.replace(/await context\.unrouteAll\([^)]*\);/, '')));
mustCatch('the live gate unhomed from the deploy workflow', liveHalfProblems('verify-live-loader-logos.ts', { excluded: [] }, () => true, () => '').length > 0);

if (fail || mutFail) { console.error(`\n❌ loader-logos-prefetched: ${fail} check(s), ${mutFail} mutation(s) failed`); process.exit(1); }
console.log('\n✅ loader-logos-prefetched: logos cached for a year and fetched before the loader appears.');
