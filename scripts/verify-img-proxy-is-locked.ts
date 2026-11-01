// SECURITY (owner-approved plan, Phase 1.2, 2026-10-20): the /_img same-origin photo proxy serves photos only.
//
// THE HOLE. vercel.json rewrote /_img/sadin/:path* → https://sadin.com.sa/:path* and /_img/eydah/:path* → eydah.com —
// EVERY path, not just photos. Measured live: GET /_img/eydah/ar returned eydah's whole HTML page, scripts and all,
// on OUR origin. Any script those sites ever serve (compromised, or user content) would run same-origin with Ezhalah
// and could read the signed-in user's Supabase session from localStorage.
//
// THE FIX. Each rewrite is pinned to the one photo folder the data actually uses (measured 2026-10-20: all 1,083 live
// photos sit under sadin.com.sa/media/properties, sadin.com.sa/media/property-assets, eydah.com/assets/listings), and
// every /_img response carries `Content-Security-Policy: sandbox …` + `nosniff`, so even an HTML answer cannot run
// script on our origin. Images in <img> are unaffected. This barrier reads vercel.json; loosening either half fails.
//   node --experimental-strip-types scripts/verify-img-proxy-is-locked.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Rule = { source: string; destination?: string; headers?: { key: string; value: string }[] };
const cfg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'vercel.json'), 'utf8')) as { rewrites?: Rule[]; headers?: Rule[] };

const ALLOWED: Record<string, string> = {
  '/_img/sadin/media/properties/:path*': 'https://sadin.com.sa/media/properties/:path*',
  '/_img/sadin/media/property-assets/:path*': 'https://sadin.com.sa/media/property-assets/:path*',
  '/_img/eydah/assets/listings/:path*': 'https://eydah.com/assets/listings/:path*',
};

function problems(c: { rewrites?: Rule[]; headers?: Rule[] }): string[] {
  const fail: string[] = [];
  const img = (c.rewrites ?? []).filter((r) => r.source.startsWith('/_img/'));
  for (const r of img) {
    if (ALLOWED[r.source] !== r.destination) fail.push(`${r.source} → ${r.destination} is not one of the pinned photo folders`);
    // A destination that reaches a site's root (host followed directly by :path*) proxies whole pages.
    if (/^https:\/\/[^/]+\/:path\*$/.test(r.destination ?? '')) fail.push(`${r.source} proxies a whole site (${r.destination})`);
  }
  for (const s of Object.keys(ALLOWED)) if (!img.some((r) => r.source === s)) fail.push(`photo rewrite ${s} is missing (photos would break)`);
  const h = (c.headers ?? []).find((r) => r.source === '/_img/(.*)');
  const get = (k: string) => h?.headers?.find((x) => x.key.toLowerCase() === k.toLowerCase())?.value ?? '';
  if (!/^sandbox\b/.test(get('Content-Security-Policy')) || !/default-src 'none'/.test(get('Content-Security-Policy'))) fail.push('/_img responses are not sandboxed by CSP');
  if (get('X-Content-Type-Options') !== 'nosniff') fail.push('/_img responses lack nosniff');
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };
const clone = () => JSON.parse(JSON.stringify(cfg)) as typeof cfg;

const p = problems(cfg);
check('the /_img proxy reaches only the three photo folders and every answer is sandboxed', p.length === 0, p.join('; '));
mustCatch('the old whole-site rewrite coming back', (() => { const c = clone(); c.rewrites!.push({ source: '/_img/eydah/:path*', destination: 'https://eydah.com/:path*' }); return problems(c).length > 0; })());
mustCatch('the sandbox header removed', (() => { const c = clone(); c.headers = c.headers!.filter((r) => r.source !== '/_img/(.*)'); return problems(c).length > 0; })());
mustCatch('a photo folder dropped (photos would break)', (() => { const c = clone(); c.rewrites = c.rewrites!.filter((r) => r.source !== '/_img/eydah/assets/listings/:path*'); return problems(c).length > 0; })());

if (failed) { console.error(`\n❌ verify-img-proxy-is-locked: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-img-proxy-is-locked: the photo proxy serves photo folders only, sandboxed.');
