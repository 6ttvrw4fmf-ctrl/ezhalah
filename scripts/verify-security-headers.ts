// SECURITY (owner-approved plan, Phase 1.5, 2026-10-21): every page carries the basic browser security headers.
//
// THE HOLE. vercel.json set only Cache-Control, so the live site (measured 2026-10-20) had no X-Frame-Options /
// frame-ancestors (any site could frame Ezhalah and trick a click — clickjacking), no X-Content-Type-Options, no
// Referrer-Policy and no Permissions-Policy. Only HSTS came from Vercel itself.
//
// THE FIX. One site-wide rule: frame-ancestors 'self' + X-Frame-Options SAMEORIGIN (no third-party framing), nosniff,
// strict-origin-when-cross-origin (the browser default, now explicit — the Maps key's referrer check still gets the
// origin), and a Permissions-Policy that keeps the MICROPHONE for voice search (src/lib/voiceInput.ts) while turning
// off camera and location, which nothing uses. The /_img rule (Phase 1.2) stays stricter and comes later, so its
// sandbox CSP wins on photo answers. This barrier reads vercel.json; dropping a header, or blocking the microphone,
// turns it red.
//   node --experimental-strip-types scripts/verify-security-headers.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Rule = { source: string; headers?: { key: string; value: string }[] };
const root = join(import.meta.dirname, '..');
const cfg = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as { headers?: Rule[] };
const usesMic = /getUserMedia/.test(readFileSync(join(root, 'src/lib/voiceInput.ts'), 'utf8'));

function problems(c: { headers?: Rule[] }): string[] {
  const fail: string[] = [];
  const rules = c.headers ?? [];
  const site = rules.find((r) => r.source === '/(.*)');
  if (!site) return ['no site-wide header rule'];
  const get = (k: string) => site.headers?.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value ?? '';
  if (get('X-Frame-Options') !== 'SAMEORIGIN' && get('X-Frame-Options') !== 'DENY') fail.push('X-Frame-Options missing');
  if (!/frame-ancestors 'self'|frame-ancestors 'none'/.test(get('Content-Security-Policy'))) fail.push('CSP frame-ancestors missing');
  if (get('X-Content-Type-Options') !== 'nosniff') fail.push('nosniff missing');
  if (!/strict-origin-when-cross-origin|strict-origin|no-referrer/.test(get('Referrer-Policy'))) fail.push('Referrer-Policy missing');
  const pp = get('Permissions-Policy');
  if (!pp) fail.push('Permissions-Policy missing');
  if (usesMic && !/microphone=\(self\)/.test(pp)) fail.push('Permissions-Policy blocks the microphone that voice search needs');
  // The stricter photo-proxy rule must come AFTER the site rule so its sandbox CSP is the one that applies.
  const iSite = rules.indexOf(site);
  const iImg = rules.findIndex((r) => r.source === '/_img/(.*)');
  if (iImg >= 0 && iImg < iSite) fail.push('the /_img sandbox rule comes before the site rule (its CSP would be overridden)');
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };
const clone = () => JSON.parse(JSON.stringify(cfg)) as typeof cfg;
const site = (c: typeof cfg) => c.headers!.find((r) => r.source === '/(.*)')!;

const p = problems(cfg);
check('every page has anti-framing, nosniff, referrer and permissions headers; the microphone stays allowed', p.length === 0, p.join('; '));
mustCatch('anti-framing removed', (() => { const c = clone(); site(c).headers = site(c).headers!.filter((h) => h.key !== 'X-Frame-Options'); return problems(c).length > 0; })());
mustCatch('the microphone blocked (voice search would break)', (() => { const c = clone(); const h = site(c).headers!.find((x) => x.key === 'Permissions-Policy')!; h.value = 'camera=(), geolocation=(), microphone=()'; return problems(c).length > 0; })());
mustCatch('the photo sandbox rule overridden by order', (() => { const c = clone(); const img = c.headers!.find((r) => r.source === '/_img/(.*)')!; c.headers = [img, ...c.headers!.filter((r) => r !== img)]; return problems(c).length > 0; })());

if (failed) { console.error(`\n❌ verify-security-headers: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-security-headers: every page carries the basic security headers.');
