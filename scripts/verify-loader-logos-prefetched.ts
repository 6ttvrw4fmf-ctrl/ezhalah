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
//      URL once, after its delay, skips native ids and Save-Data; SearchLoader wires it on web.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logoUris, scheduleLogoPrefetch, LOGO_PREFETCH_DELAY_MS } from '../src/lib/prefetchLoaderLogos.ts';

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
const loader = readFileSync(join(root, 'src/components/SearchLoader.tsx'), 'utf8');
check('SearchLoader schedules the prefetch on web with every catalog logo',
  /if \(IS_WEB && typeof window !== 'undefined'\) scheduleLogoPrefetch\(PLATFORM_META\.map\(\(p\) => p\.logo\), \(uris\) => ExpoImage\.prefetch\(uris\)\);/.test(loader));

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
mustCatch('the wiring removed from SearchLoader', !/scheduleLogoPrefetch\(PLATFORM_META/.test(loader.replace(/scheduleLogoPrefetch\(PLATFORM_META[^\n]*\n/, '\n')));

if (fail || mutFail) { console.error(`\n❌ loader-logos-prefetched: ${fail} check(s), ${mutFail} mutation(s) failed`); process.exit(1); }
console.log('\n✅ loader-logos-prefetched: logos cached for a year and fetched before the loader appears.');
