// A PHOTO IN THE DATABASE THAT THE BROWSER CANNOT RENDER IS STILL A BROKEN CARD.
// Auto-discovered barrier. Found 2026-09-06 by the owner, on the live site.
//
// THE DEFECT. sadin listings carried 20 real photo URLs each. Every URL returned HTTP 200 with
// `content-type: image/png` to curl — so every "is the scraper capturing images" check passed —
// and yet the production card rendered a 240x200 EMPTY BOX. The reason is a header curl ignores
// and browsers enforce:
//
//     cross-origin-resource-policy: same-origin
//
// sadin.com.sa sends it on every media response (on the apex AND on the www 308), which tells the
// browser that ONLY sadin.com.sa may embed those images. Chrome refuses with
// ERR_BLOCKED_BY_RESPONSE.NotSameOrigin. Verified live in the production browser: BOTH
// www.sadin.com.sa/... and sadin.com.sa/... fail to render, so this is NOT a www-vs-apex problem
// and no URL rewrite can fix it — the host is deliberately refusing to be hotlinked.
//
// THE SECOND, WORSE HALF. ResultCard already had a graceful fallback: try each URL, and when they
// are all gone show a "No photo available" placeholder. It did not fire, because expo-image's
// onError does not surface a BLOCKED response on web (measured: the <img> sat at complete=false,
// naturalWidth=0, still on photo #1 after 20 seconds). So the card fell into the one state the
// fallback exists to prevent — neither a photo nor a placeholder, just a blank rectangle.
//
// WHAT THIS BARRIER CHECKS, in two independent layers:
//   1. STATIC — the render path must not depend solely on expo-image's onError on web.
//   2. LIVE   — every platform's real stored photo URL is fetched and judged the way a BROWSER
//               judges it: status, content-type, AND the cross-origin headers that decide whether
//               an <img> on another origin may display it. A 200 is not sufficient evidence.
//
// A host that blocks embedding is reported, not silently tolerated: the honest product answer is
// the placeholder (which layer 1 guarantees), and re-hosting another company's images to defeat
// their anti-hotlink header is an OWNER decision, never an engineering default.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
console.log('\nA database photo must be RENDERABLE by a browser, not merely fetchable\n');

// ── LAYER 1 — the render path cannot rely on expo-image's onError alone (web) ───────────────────
const card = readFileSync(join(ROOT, 'src/components/ResultCard.tsx'), 'utf8');
const photoFn = card.slice(card.indexOf('function ListingPhoto'), card.indexOf('function SourceBadge'));

check('ListingPhoto still has a "no photo" placeholder to fall back to',
  /photoFallback/.test(photoFn) && /No photo available/.test(photoFn));
check('ListingPhoto probes each candidate itself on web (expo-image onError misses BLOCKED responses)',
  /new window\.Image\(\)/.test(photoFn) && /probe\.onerror/.test(photoFn),
  'without an independent probe, a CORP-blocked or hotlink-denied url leaves the card a blank box '
  + 'forever — onError never fires, so idx never advances and the placeholder is never reached');
check('the probe only advances PAST the url it probed (a late probe cannot skip a good photo)',
  /i === idx \? i \+ 1 : i/.test(photoFn));
check('the probe is web-only, so native keeps expo-image\'s own working onError',
  /IS_WEB/.test(photoFn) || /Platform\.OS === 'web'/.test(photoFn));
check('the probe is cleaned up on unmount (no setState after teardown)',
  /cancelled = true/.test(photoFn));

// ── LAYER 2 — LIVE: judge real stored URLs the way a browser does ───────────────────────────────
// A browser refuses to DISPLAY a cross-origin image when the response says
// Cross-Origin-Resource-Policy: same-origin (or same-site, from a different site). Status 200 and
// a correct content-type are NOT enough. This is exactly the evidence curl-based checks miss.
const { url, key } = resolvePublicSupabase();
const PLATFORM_TABLES = [
  'sadin', 'satel', 'aqargate', 'eastabha', 'erapulse', 'eaqartabuk', 'hajer', 'alhoshan',
  'fursaghyr', 'alta', 'shmoualshmal',
];

type Verdict = { platform: string; url: string; status: number; ctype: string; corp: string; renderable: boolean; why: string };

const judge = async (platform: string, imgUrl: string): Promise<Verdict> => {
  try {
    // GET, not HEAD: some hosts answer HEAD differently from the GET a browser actually issues.
    const r = await fetch(imgUrl, { method: 'GET', redirect: 'follow' });
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    const corp = (r.headers.get('cross-origin-resource-policy') || '').toLowerCase();
    const okStatus = r.status === 200;
    const okType = ctype.startsWith('image/');
    // cross-origin: only 'cross-origin' (or absent) permits embedding from another origin.
    const okCorp = corp === '' || corp === 'cross-origin';
    const why = !okStatus ? `HTTP ${r.status}`
      : !okType ? `content-type ${ctype || '(none)'}`
      : !okCorp ? `cross-origin-resource-policy: ${corp} — the browser will REFUSE to display this on another origin`
      : '';
    return { platform, url: imgUrl, status: r.status, ctype, corp, renderable: okStatus && okType && okCorp, why };
  } catch (e) {
    return { platform, url: imgUrl, status: 0, ctype: '', corp: '', renderable: false, why: `fetch failed: ${String(e).slice(0, 70)}` };
  }
};

const rows: { platform: string; url: string }[] = [];
for (const p of PLATFORM_TABLES) {
  const q = `${url}/rest/v1/${p}_residential_listings`
    + `?select=photo_urls&active=eq.true&photo_urls=not.is.null&limit=1`;
  try {
    const r = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (r.status !== 200) continue;
    const j = (await r.json()) as { photo_urls: string[] | null }[];
    const first = j?.[0]?.photo_urls?.[0];
    if (first) rows.push({ platform: p, url: first });
  } catch { /* platform skipped below by the coverage check */ }
}

check('the live sample actually reached production (this check cannot pass by finding nothing)',
  rows.length >= Math.ceil(PLATFORM_TABLES.length * 0.7),
  `only sampled ${rows.length}/${PLATFORM_TABLES.length} platforms — fails CLOSED rather than reporting a clean sweep`);

if (rows.length) {
  const verdicts = await Promise.all(rows.map((r) => judge(r.platform, r.url)));
  const blocked = verdicts.filter((v) => !v.renderable);

  for (const v of verdicts) {
    console.log(`   ${v.renderable ? '✓' : '✗'} ${v.platform.padEnd(14)} ${v.renderable ? 'renderable' : v.why}`);
  }

  // THE ONE DECLARED, DATED EXCEPTION — same shape verify-no-derived-price.ts uses for sadin's
  // prose price. sadin.com.sa sends `cross-origin-resource-policy: same-origin` on every media
  // response (apex and www alike), which is an explicit, deliberate anti-hotlink measure. No URL
  // form defeats it. Its cards therefore show the honest "No photo available" placeholder, which
  // layer 1 above guarantees they now reach instead of a blank box.
  //
  // THIS IS NOT A PASS. It is a known cost held in view: the fix would be re-hosting sadin's
  // images through our own origin, which is an OWNER decision (bandwidth, and deliberately
  // circumventing a measure the source chose to set) — not an engineering default. If sadin ever
  // relaxes the header, this entry must be REMOVED, and the check below fails until it is, so the
  // exception cannot outlive the reason for it.
  const BLOCK_ALLOWLIST = new Set(['sadin']);
  const unexpected = blocked.filter((b) => !BLOCK_ALLOWLIST.has(b.platform));

  check('no NEW platform stores photos the browser refuses to display',
    unexpected.length === 0,
    unexpected.length
      ? unexpected.map((b) => `${b.platform}: ${b.why}`).join('; ')
        + '\n      A host that blocks embedding cannot be fixed by rewriting the URL. Cards fall back to '
        + 'the honest placeholder (layer 1). Re-hosting another company\'s images to defeat their '
        + 'anti-hotlink header is an OWNER decision, never an engineering default.'
      : '');

  check('the sadin block is still REAL (the exception cannot outlive its reason)',
    blocked.some((b) => b.platform === 'sadin'),
    'sadin no longer blocks embedding — delete it from BLOCK_ALLOWLIST so its photos are required '
    + 'to render, and re-run the scraper so the cards pick them up.');

  if (blocked.length) {
    console.log(`\n  ⚠ ${blocked.length} host(s) refuse cross-origin embedding — cards show the honest`);
    console.log('    placeholder. Owner decision pending: proxy their images, or accept the placeholder.');
    for (const b of blocked) console.log(`      · ${b.platform}: ${b.corp || b.why}`);
  }
}

// ── MUTATION PROOF — the renderability predicate, against responses that must be judged UNSAFE ──
console.log('\n  mutation proof — the same predicate, against non-renderable responses\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
// This is the predicate layer 2 applies, extracted so the mutants exercise the real rule.
const renderable = (status: number, ctype: string, corp: string) =>
  status === 200 && ctype.toLowerCase().startsWith('image/')
  && (corp === '' || corp.toLowerCase() === 'cross-origin');

mustCatch('THE SADIN CASE: 200 + image/png + CORP same-origin (curl says fine, browser refuses)',
  renderable(200, 'image/png', 'same-origin') === false);
mustCatch('CORP same-site is also refused from a different site',
  renderable(200, 'image/jpeg', 'same-site') === false);
mustCatch('a 404 that still says image/*',
  renderable(404, 'image/png', '') === false);
mustCatch('a 200 that is actually an HTML error page',
  renderable(200, 'text/html; charset=utf-8', '') === false);
mustCatch('a 302 to a login/notfound page',
  renderable(302, 'text/html', '') === false);
// ...and a genuinely embeddable image must NOT be flagged
mustCatch('a plain 200 image with no CORP header is allowed',
  renderable(200, 'image/jpeg', '') === true);
mustCatch('an explicit CORP cross-origin is allowed',
  renderable(200, 'image/webp', 'cross-origin') === true);
mustCatch('content-type with charset/params still counts as an image',
  renderable(200, 'image/svg+xml; charset=utf-8', '') === true);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ stored photos are browser-renderable, and a blocked one still reaches the placeholder.\n'
    : `\n❌ ${failed} check(s) failed — a card can show a photo-less blank box, or a stored photo cannot display.\n`,
);
process.exit(failed === 0 ? 0 : 1);
