// A DB PHOTO THE BROWSER CANNOT RENDER IS AS GOOD AS NO PHOTO — the canonical proxy must stay wired.
//
// THE DEFECT (2026-09-05, owner-found live). Sadin serves listing images with Cross-Origin-Resource-
// Policy: same-origin, so a cross-origin <img> from ezhalah-app is blocked (net::ERR_BLOCKED_BY_
// RESPONSE.NotSameOrigin) and the card shows "no photo" over a real DB photo. The fix routes Sadin
// images through a same-origin Vercel rewrite (/_img/sadin/* → sadin.com.sa) via the shared
// photoDisplayUrl() helper. This barrier pins all three legs so the fix cannot silently come undone:
//   (1) photoDisplayUrl rewrites BOTH Sadin host shapes (with/without www.) to /_img/sadin/<path>,
//       preserves the query, and leaves every other host untouched;
//   (2) vercel.json declares the /_img/sadin rewrite to sadin.com.sa (pinned — not an open proxy);
//   (3) remote.ts runs every card photo through photoDisplayUrl at the single canonical point.
// The LIVE half — does the browser actually render each platform's photo — is
// verify-card-photos-render-live.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { photoDisplayUrl } from '../src/lib/photoUrl.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
};

// ── (1) photoDisplayUrl behaviour, executed on the real function ─────────────────────────────────
const A = photoDisplayUrl('https://sadin.com.sa/media/property-assets/3MJ6E/abc/display?v=6');
check('sadin.com.sa → same-origin /_img/sadin proxy, query preserved',
  A === '/_img/sadin/media/property-assets/3MJ6E/abc/display?v=6', A);
const B = photoDisplayUrl('https://www.sadin.com.sa/media/properties/KTX02/main.png');
check('www.sadin.com.sa → /_img/sadin proxy (www stripped, avoids the 308 hop)',
  B === '/_img/sadin/media/properties/KTX02/main.png', B);
const C = photoDisplayUrl('https://images.aqar.fm/webp/300x0/props/006285346_x.jpg');
check('a non-CORP-blocked host (aqar) is returned UNCHANGED',
  C === 'https://images.aqar.fm/webp/300x0/props/006285346_x.jpg', C);
check('every rewritten Sadin URL is a same-origin path (starts with /_img/, no scheme/host)',
  A.startsWith('/_img/') && B.startsWith('/_img/') && !/^https?:/.test(A) && !/^https?:/.test(B));
check('a relative / non-URL string is left untouched (never crashes on garbage)',
  photoDisplayUrl('') === '' && photoDisplayUrl('not a url') === 'not a url');

// ── (2) vercel.json declares the pinned rewrite ──────────────────────────────────────────────────
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const rule = (vercel.rewrites ?? []).find((r: any) => (r.source ?? '').startsWith('/_img/sadin'));
check('vercel.json has the /_img/sadin rewrite', Boolean(rule),
  JSON.stringify(vercel.rewrites ?? []));
check('the rewrite destination is PINNED to sadin.com.sa (not an open proxy)',
  Boolean(rule) && /^https:\/\/sadin\.com\.sa\//.test(rule.destination), rule?.destination);
check('the rewrite forwards the path (/:path*)',
  Boolean(rule) && rule.source.includes(':path*') && rule.destination.includes(':path*'));

// ── (3) remote.ts runs card photos through the canonical helper ──────────────────────────────────
const remote = readFileSync(join(ROOT, 'src/data/remote.ts'), 'utf8');
check('remote.ts imports photoDisplayUrl', /import \{ photoDisplayUrl \} from '@\/lib\/photoUrl'/.test(remote));
check('remote.ts maps every real photo URL through photoDisplayUrl (the single canonical point)',
  /\.map\(\(u: string\) => photoDisplayUrl\(u\)\)/.test(remote)
  && /const realPhotoUrls = Array\.isArray\(r\.photo_urls\)/.test(remote));

// ── executable mutation proofs ───────────────────────────────────────────────────────────────────
const mustCatch = (label: string, invariantHeldOnBrokenInput: boolean) =>
  check(`MUTATION ${label} — caught`, invariantHeldOnBrokenInput === false,
    'the invariant held on a broken input, so the check cannot catch this bug');
// If photoDisplayUrl were a no-op (the reverted-fix regression), the Sadin URL would stay
// cross-origin. Stated DIFFERENTIALLY against the REAL helper (2026-09-06, routine #10): the first
// version asked `'https://sadin.com.sa/x'.startsWith('/_img/')` — a constant expression over a
// hand-written string that never called photoDisplayUrl at all, so it passed for every possible
// implementation of it, this file's whole subject. It was a hand-SIMULATION of what the mutant would
// return, which is the "keep a copy of production logic in the barrier" class wearing proof syntax.
// Now the no-op mutant and the shipped helper are both applied to the same input and must disagree.
const noop = (u: string) => u;
const SADIN = 'https://sadin.com.sa/x';
mustCatch('no-op helper leaves Sadin cross-origin',
  noop(SADIN).startsWith('/_img/') === photoDisplayUrl(SADIN).startsWith('/_img/'));
// If it rewrote the WRONG host, aqar would get proxied (breaking a working platform).
mustCatch('over-broad rewrite proxies aqar too', photoDisplayUrl('https://images.aqar.fm/a.jpg').startsWith('/_img/'));

console.log(failed
  ? `\n✗ verify-photo-corp-proxy: ${failed} check(s) failed.\n`
  : '\n✅ verify-photo-corp-proxy: Sadin photos are routed same-origin; other hosts untouched; proxy pinned.\n');
process.exit(failed ? 1 : 0);
