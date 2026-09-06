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
import { photoDisplayUrl } from '../src/lib/photoUrl.ts';

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

// THREE-VALUED, not two (2026-09-06, routine #10). `renderable: null` is UNKNOWN — we did not get
// the HOST's answer, so we have no verdict about the host.
//
// WHY: on this run, five platforms (satel, erapulse, alhoshan, alta, shmoualshmal) came back
// «HTTP 403» and were reported as «a card can show a photo-less blank box», with advice to route
// them through the same-origin proxy. Every one of those 403s was produced by the RUNNER's own
// egress policy — `x-deny-reason: host_not_allowed`, a header no image host sends — and the photos
// are fine. That is AGENTS.md's «A FAILED FETCH IS NOT AN EMPTY ANSWER» committed in the
// verification layer: a request that never reached the origin, rendered as a confident negative
// about the origin. The old `catch` had the same shape, scoring a transport failure as
// `renderable: false`.
//
// This does NOT soften the check. A 403 the HOST sends (hotlink protection) carries no deny-reason
// and still FAILS, which is the negative control proven below. Only «we never got an answer» became
// UNKNOWN, and UNKNOWN is not allowed to read as health either: if nothing could be judged, the
// check fails.
type Judgement = boolean | null;
type Verdict = { platform: string; url: string; status: number; ctype: string; corp: string; renderable: Judgement; why: string };

/** A response the local egress layer produced instead of the origin — never the host's verdict. */
export const isEgressDenial = (h: { get(name: string): string | null }): boolean =>
  Boolean(h.get('x-deny-reason'));

// THE PRODUCTION ORIGIN, because a same-origin display url (the Sadin proxy path `/_img/sadin/*`)
// only resolves against the deployed app — that Vercel rewrite is what makes it renderable at all.
const ORIGIN = 'https://ezhalah-app.vercel.app';

const judge = async (platform: string, storedUrl: string): Promise<Verdict> => {
  // Judge what the BROWSER actually loads. Every photo entering the client passes through
  // photoDisplayUrl (remote.ts finalize), so checking the raw stored url would test a string no
  // <img> ever receives — and would have reported Sadin broken after the proxy fixed it.
  const display = photoDisplayUrl(storedUrl);
  const imgUrl = display.startsWith('/') ? ORIGIN + display : display;
  try {
    // GET, not HEAD: some hosts answer HEAD differently from the GET a browser actually issues.
    const r = await fetch(imgUrl, { method: 'GET', redirect: 'follow' });
    if (isEgressDenial(r.headers)) {
      return { platform, url: imgUrl, status: r.status, ctype: '', corp: '', renderable: null,
        why: `UNKNOWN: this run's own network refused the request (HTTP ${r.status}, `
          + `x-deny-reason: ${r.headers.get('x-deny-reason')}) — the host never answered, so there is no verdict about it` };
    }
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    const corp = (r.headers.get('cross-origin-resource-policy') || '').toLowerCase();
    const okStatus = r.status === 200;
    const okType = ctype.startsWith('image/');
    // CORP IS A CROSS-ORIGIN-ONLY CHECK. `same-origin` blocks an <img> on ANOTHER origin and
    // PERMITS one served from our own — which is the entire mechanism the Sadin proxy relies on.
    // Judging it without asking "same origin as the app?" would condemn the very fix that works:
    // measured live, the proxied url decoded at 900x1600 in the production browser while still
    // carrying `cross-origin-resource-policy: same-origin` from Sadin's upstream response.
    const sameOrigin = display.startsWith('/');
    const okCorp = sameOrigin || corp === '' || corp === 'cross-origin';
    const why = !okStatus ? `HTTP ${r.status}`
      : !okType ? `content-type ${ctype || '(none)'}`
      : !okCorp ? `cross-origin-resource-policy: ${corp} on a CROSS-origin url — the browser will REFUSE to display it (route the host through the same-origin proxy, as photoDisplayUrl does for Sadin)`
      : '';
    return { platform, url: imgUrl, status: r.status, ctype, corp, renderable: okStatus && okType && okCorp, why };
  } catch (e) {
    // No response at all — DNS, TLS, a dropped connection. That is not the host saying "no";
    // silent → UNKNOWN, never unknown → NO.
    return { platform, url: imgUrl, status: 0, ctype: '', corp: '', renderable: null,
      why: `UNKNOWN: no response — ${String(e).slice(0, 70)}` };
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
  const blocked = verdicts.filter((v) => v.renderable === false);
  const unknown = verdicts.filter((v) => v.renderable === null);
  const judged = verdicts.filter((v) => v.renderable === true);

  for (const v of verdicts) {
    const mark = v.renderable === true ? '✓' : v.renderable === false ? '✗' : '?';
    console.log(`   ${mark} ${v.platform.padEnd(14)} ${v.renderable === true ? 'renderable' : v.why}`);
  }

  // UNKNOWN must not read as health either. If nothing could be judged, this check has proven
  // nothing and says so — the same fail-closed rule the sampling floor above already applies.
  check('at least one platform\'s photo was actually JUDGED (an all-UNKNOWN sweep proves nothing)',
    judged.length + blocked.length > 0,
    `all ${verdicts.length} sample(s) came back UNKNOWN — no host answered, so this run cannot speak `
    + 'to renderability at all. Check this runner\'s egress policy before reading anything into it.');
  if (unknown.length) {
    console.log(`\n   ${unknown.length} platform(s) UNKNOWN (no host answer) — reported, not counted as broken:\n`
      + unknown.map((u) => `     ${u.platform}: ${u.why}`).join('\n'));
  }

  // NO ALLOWLIST. There was one for Sadin while its CORP block had no answer; the same-origin
  // proxy (PR #1918, src/lib/photoUrl.ts + the vercel.json rewrite) removed the reason for it, so
  // the exception is gone rather than left behind to rot. Every platform is now simply required to
  // render — which is the assertion we actually want.
  check('every sampled platform\'s photo is BROWSER-RENDERABLE at its DISPLAY url',
    blocked.length === 0,
    blocked.length
      ? blocked.map((b) => `${b.platform}: ${b.why}`).join('; ')
        + '\n      If the host sends a blocking cross-origin-resource-policy, no URL rewrite fixes it: '
        + 'either route that host through the same-origin proxy the way photoDisplayUrl() does for '
        + 'Sadin, or accept the placeholder. Re-hosting another company\'s images is an OWNER '
        + 'decision, never an engineering default.'
      : '');

  // The proxy is load-bearing: prove it is actually still rewriting, not quietly a no-op.
  const sadinRow = rows.find((r) => r.platform === 'sadin');
  if (sadinRow) {
    check('sadin photos are routed through the same-origin proxy (the raw host still blocks)',
      photoDisplayUrl(sadinRow.url).startsWith('/_img/sadin'),
      `photoDisplayUrl left ${sadinRow.url.slice(0, 60)} untouched — sadin.com.sa sends CORP `
      + 'same-origin, so an un-proxied url renders as a blank card.');
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
const renderable = (status: number, ctype: string, corp: string, sameOrigin = false) =>
  status === 200 && ctype.toLowerCase().startsWith('image/')
  && (sameOrigin || corp === '' || corp.toLowerCase() === 'cross-origin');

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
// THE PROXY'S WHOLE POINT, and the bug this predicate had on its first draft: the SAME response
// Sadin blocks cross-origin is renderable once it is served from our own origin. Measured live —
// the proxied url decoded at 900x1600 while still carrying CORP same-origin upstream.
mustCatch('CORP same-origin is ALLOWED when the url is served same-origin (the proxy path)',
  renderable(200, 'image/png', 'same-origin', true) === true);
mustCatch('...but the identical response is still refused cross-origin',
  renderable(200, 'image/png', 'same-origin', false) === false);

// ── THE UNKNOWN DISCRIMINATOR — proven in BOTH directions, because turning a red into an UNKNOWN is
// only legitimate if the red it removes was never the host's answer. The host's own refusal must
// still fail, and it does.
const hdrs = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
mustCatch('THE 2026-09-06 FALSE RED: the runner\'s own egress denial is UNKNOWN, not «the host blocks it»',
  isEgressDenial(hdrs({ 'x-deny-reason': 'host_not_allowed' })) === true);
mustCatch('a HOST-sent 403 (hotlink protection) is NOT excused as an egress denial — it still fails',
  isEgressDenial(hdrs({ 'content-type': 'text/html', server: 'nginx' })) === false
  && renderable(403, 'text/html', '') === false);
mustCatch('a perfectly healthy image response is not mistaken for an egress denial (not vacuously UNKNOWN)',
  isEgressDenial(hdrs({ 'content-type': 'image/jpeg' })) === false
  && renderable(200, 'image/jpeg', '') === true);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ stored photos are browser-renderable, and a blocked one still reaches the placeholder.\n'
    : `\n❌ ${failed} check(s) failed — a card can show a photo-less blank box, or a stored photo cannot display.\n`,
);
process.exit(failed === 0 ? 0 : 1);
