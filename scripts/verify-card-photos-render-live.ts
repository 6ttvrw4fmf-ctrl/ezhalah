// DB PHOTO EXISTS BUT THE BROWSER CANNOT RENDER IT — the live guard (owner-found defect, 2026-09-05).
//
// A card photo is worthless if the production browser refuses to paint it. Sadin serves images with
// Cross-Origin-Resource-Policy: same-origin, so a cross-origin <img> from ezhalah-app is blocked
// (net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin) and the card shows "no photo" over a real DB photo.
// The fix routes Sadin through a same-origin proxy (see src/lib/photoUrl.ts + vercel.json). This
// barrier is the LIVE half: for every active platform it takes a REAL DB photo, computes the EXACT
// url the card will load (photoDisplayUrl), and replicates the browser's render decision:
//   • a same-origin proxied path (/_img/…) is fetched against production and must return an image
//     (proves the rewrite is live and the proxy works — same-origin can never be CORP-blocked);
//   • an absolute url is walked hop-by-hop with cross-origin image semantics, and FAILS if any hop
//     answers with a blocking Cross-Origin-Resource-Policy (same-origin/same-site) — exactly the
//     rule the browser applies to a no-cors <img>. A new platform that ships CORP-blocked images
//     trips this before users see a blank card.
//
// LIVE — excluded from `npm test`; runs in .github/workflows/af-live-truth-check.yml.
import { photoDisplayUrl } from '../src/lib/photoUrl.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: BASE, key: KEY } = resolvePublicSupabase(process.env);
const REST = `${BASE}/rest/v1`;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const PROD_ORIGIN = process.env.EZHALAH_ORIGIN || 'https://ezhalah-app.vercel.app';
const UA = 'Mozilla/5.0 (compatible; ezhalah-photo-render-check)';

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
};

// PURE, mutation-proven below. The browser blocks a cross-origin no-cors <img> when the response's
// Cross-Origin-Resource-Policy is same-origin or same-site; an absent/other value does not block.
function corpBlocksCrossOrigin(corpHeader: string): boolean {
  const v = (corpHeader || '').toLowerCase().trim();
  return v === 'same-origin' || v === 'same-site';
}
// PURE. A platform passes when the MAJORITY of its sampled listings render (a platform-wide block
// like Sadin's sinks all of them; one corrupt url on one listing does not).
const majorityRender = (rendered: number, total: number): boolean => total > 0 && rendered * 2 >= total;

// The active, production-searchable platforms — production's own answer.
const rpc = await fetch(`${REST}/rpc/loader_active_platforms_ar`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}',
});
if (!rpc.ok) { console.log(`\n✗ cannot reach loader_active_platforms_ar (HTTP ${rpc.status}) — failing closed`); process.exit(1); }
const platforms = (await rpc.json()) as string[];
check('the active-platform list is plausible', platforms.length > 20, `${platforms.length}`);

// Up to N listings' photo arrays for a platform (the card fetches photo_urls from these raw tables).
async function sampleListings(platform: string, n = 4): Promise<string[][]> {
  const out: string[][] = [];
  for (const kind of ['residential', 'commercial']) {
    if (out.length >= n) break;
    const t = `${platform}_${kind}_listings`;
    const r = await fetch(`${REST}/${t}?select=photo_urls&photo_urls=not.is.null&limit=${n}`, { headers: H });
    if (!r.ok) continue;
    const rows = (await r.json()) as { photo_urls: string[] | null }[];
    for (const row of rows) {
      const arr = (row.photo_urls ?? []).filter((x): x is string =>
        typeof x === 'string' && x.startsWith('http') && !x.includes('villa-default.png'));
      if (arr.length) out.push(arr);
      if (out.length >= n) break;
    }
  }
  return out;
}

// The browser's cross-origin <img> (no-cors) render decision, replicated over the redirect chain.
// Returns null if it would render, or a reason string if the browser would block it.
async function whyBlocked(url: string): Promise<string | null> {
  let cur = url;
  for (let hop = 0; hop < 6; hop++) {
    let r: Response;
    try {
      r = await fetch(cur, {
        method: 'GET', redirect: 'manual',
        headers: { 'User-Agent': UA, Origin: PROD_ORIGIN, 'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Mode': 'no-cors' },
      });
    } catch (e) { return `fetch threw (${String((e as Error).message).slice(0, 60)})`; }
    // CORP is checked on EVERY response in the chain for a cross-origin request.
    const corp = (r.headers.get('cross-origin-resource-policy') || '').toLowerCase().trim();
    if (corpBlocksCrossOrigin(corp)) return `CORP:${corp} at hop ${hop}`;
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return `redirect ${r.status} with no Location`;
      cur = new URL(loc, cur).toString();
      continue;
    }
    if (r.status !== 200) return `HTTP ${r.status}`;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return `content-type ${ct || '(none)'} is not an image`;
    return null; // 200 image, no blocking CORP in the chain → the browser renders it
  }
  return 'too many redirects';
}

// A same-origin proxied path must actually serve an image from production.
async function proxyServesImage(path: string): Promise<string | null> {
  let r: Response;
  try { r = await fetch(`${PROD_ORIGIN}${path}`, { headers: { 'User-Agent': UA } }); }
  catch (e) { return `proxy fetch threw (${String((e as Error).message).slice(0, 60)})`; }
  if (r.status !== 200) return `proxy HTTP ${r.status}`;
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('image/')) return `proxy content-type ${ct || '(none)'} not image`;
  return null;
}

// A single card renders if ANY photo in its array renders — exactly the ListingPhoto onError chain.
async function cardRenders(photoArray: string[]): Promise<string | null> {
  let lastReason = 'no photos';
  for (const raw of photoArray) {
    const display = photoDisplayUrl(raw);
    const reason = display.startsWith('/_img/') ? await proxyServesImage(display) : await whyBlocked(display);
    if (reason === null) return null;      // this photo renders → the card shows it
    lastReason = `${reason} (${display.slice(0, 60)})`;
  }
  return lastReason;                        // every photo failed → the card is blank
}

let measured = 0, noPhoto = 0;
for (const p of platforms) {
  const listings = await sampleListings(p);
  if (!listings.length) { noPhoto++; continue; }
  measured++;
  const verdicts = await Promise.all(listings.map(cardRenders));
  const rendered = verdicts.filter((v) => v === null).length;
  // A platform-wide render failure (like Sadin's CORP block) sinks every sampled listing; a lone
  // corrupt url on one listing (e.g. aqar's trailing-backslash artifact) does not, because the card
  // falls through to the next photo. Require the MAJORITY to render.
  check(`${p}: card photos render for the majority of listings (${rendered}/${listings.length})`,
    majorityRender(rendered, listings.length),
    `first failure: ${verdicts.find((v) => v !== null)}`);
}

// ── EXECUTABLE MUTATION PROOFS — the render-decision predicates, on deliberately broken inputs ────
const mustCatch = (label: string, invariantHeldOnBrokenInput: boolean) =>
  check(`MUTATION ${label} — caught`, invariantHeldOnBrokenInput === false,
    'the invariant held on a broken input, so the check cannot catch this bug');
// Sadin's exact header MUST read as a block; a clean/empty header MUST NOT.
mustCatch('CORP same-origin not treated as a block', corpBlocksCrossOrigin('same-origin') === false);
mustCatch('CORP same-site not treated as a block', corpBlocksCrossOrigin('same-site') === false);
mustCatch('a clean (no-CORP) response wrongly treated as a block', corpBlocksCrossOrigin('') === true);
// A platform where every sampled listing is blank (Sadin, 0/4) MUST fail the majority gate.
mustCatch('an all-blank platform passes the majority gate', majorityRender(0, 4) === true);
// A platform where the majority render (aqar, 3/4) MUST pass.
mustCatch('a healthy platform fails the majority gate', majorityRender(3, 4) === false);

console.log(`\n${measured} platform(s) with photos checked, ${noPhoto} without photos skipped.`);
console.log(failed
  ? `\n✗ verify-card-photos-render-live: ${failed} platform(s) have DB photos the browser cannot render.\n`
  : '\n✅ verify-card-photos-render-live: every active platform\'s DB photo renders on the card.\n');
process.exit(failed ? 1 : 0);
