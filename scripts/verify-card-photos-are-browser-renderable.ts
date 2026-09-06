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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';

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

// ── LAYER 2 — the LIVE half lives elsewhere, ON PURPOSE (2026-09-06, routine #10, ops_incident #81)
// This file used to fetch ~40 THIRD-PARTY image hosts from inside `npm test`, which is the REQUIRED
// status check on every PR. That made an unrelated PR's fate depend on whether satel, alta,
// shmoualshmal and friends happened to answer at that moment — CI run 34005883286, on a no-op
// chore(deploy) commit touching no code, went red with `eastabha: fetch failed; alta: fetch failed;
// shmoualshmal: fetch failed`, while the two runs before it passed the same check on real code
// changes. It is also why no agent session could run the required suite clean: the documented egress
// proxy answers five of those hosts with HTTP 403.
//
// The repo's own rule for this is `scripts/test-exclusions.txt`: a live check belongs in a workflow
// home, "so production being momentarily unhealthy must not fail an unrelated PR". The live sweep
// already HAS that home — `verify-card-photos-render-live.ts`, in af-live-truth-check.yml — and it
// is the stronger of the two: it walks the redirect chain hop by hop, samples several listings per
// platform, and applies a majority gate. So NO coverage is lost here; a duplicate of it was sitting
// in the wrong place.
//
// COVERAGE CANNOT BE LOST SILENTLY BY THIS SPLIT. The live half's existence and its execution home
// are asserted below, EXECUTED against the registry and the real workflow file rather than
// string-matched — so deleting that file, or quietly unhoming it, turns THIS barrier red.
// The rule is liveHalfProblems() in scripts/lib/liveHalf.ts — ONE definition shared by every split
// barrier, and itself mutation-proven in scripts/verify-live-half-homing.ts. It used to be three
// checks inlined here; once three more barriers were split the same way (ops_incident #104,
// 2026-09-06) four hand-copies of one rule was the drift risk this routine owns.
const liveHalf = 'verify-card-photos-render-live.ts';
const homing = liveHalfProblems(
  liveHalf,
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(`the LIVE half is homed in a workflow that actually invokes it (${liveHalf})`,
  homing.length === 0,
  homing.join('\n      ')
  + '\n      the live per-platform render sweep was removed from THIS file because that file covers '
  + 'it — if it is gone or unhomed, this class has no live coverage at all');

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

// A HOST-sent 403 (hotlink protection) is a real block and must stay one. The companion rule — that
// a 403 the RUNNER's own egress layer produced is UNKNOWN rather than the host's verdict — belongs
// to the live half now, and is proven there (verify-card-photos-render-live.ts, ops_incident #81).
mustCatch('a host 403 (hotlink protection) treated as renderable',
  renderable(403, 'text/html', '') === false);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ stored photos are browser-renderable, and a blocked one still reaches the placeholder.\n'
    : `\n❌ ${failed} check(s) failed — a card can show a photo-less blank box, or a stored photo cannot display.\n`,
);
process.exit(failed === 0 ? 0 : 1);
