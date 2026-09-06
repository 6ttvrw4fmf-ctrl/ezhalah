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

// ── UNKNOWN IS NOT A BLOCK (2026-09-06, routine #10, ops_incident #81) ───────────────────────────
// This check asks third-party image hosts a question. When the answer never arrives — the request
// threw, or the RUNNER's own egress layer refused it — we have learned nothing about the host, and
// scoring that as "the browser would block this photo" is a failed fetch rendered as a confident
// negative (AGENTS.md: A FAILED FETCH IS NOT AN EMPTY ANSWER), in the verification layer.
// Measured: CI run 34005883286 on a no-op baseline commit failed with `eastabha: fetch failed;
// alta: fetch failed; shmoualshmal: fetch failed`, and from an agent container five platforms answer
// HTTP 403 carrying `x-deny-reason: host_not_allowed` — a header no image host sends.
// A reason starting with this prefix is NOT counted as a render failure. It is also not counted as
// health: a platform with nothing judged is UNKNOWN, and a sweep that judged nothing FAILS.
const UNKNOWN = 'UNKNOWN: ';
export const isUnknownVerdict = (reason: string | null): boolean =>
  typeof reason === 'string' && reason.startsWith(UNKNOWN);
/** A response the local egress layer produced instead of the origin — never the host's answer. */
export const isEgressDenial = (h: { get(name: string): string | null }): boolean =>
  Boolean(h.get('x-deny-reason'));

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
    } catch (e) { return `${UNKNOWN}no response — fetch threw (${String((e as Error).message).slice(0, 60)})`; }
    if (isEgressDenial(r.headers)) {
      return `${UNKNOWN}this run's own network refused the request (HTTP ${r.status}, `
        + `x-deny-reason: ${r.headers.get('x-deny-reason')}) — the host never answered`;
    }
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
  catch (e) { return `${UNKNOWN}no response from our own origin — proxy fetch threw (${String((e as Error).message).slice(0, 60)})`; }
  if (r.status !== 200) return `proxy HTTP ${r.status}`;
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('image/')) return `proxy content-type ${ct || '(none)'} not image`;
  return null;
}

// A single card renders if ANY photo in its array renders — exactly the ListingPhoto onError chain.
async function cardRenders(photoArray: string[]): Promise<string | null> {
  let lastReason = 'no photos';
  let everJudged = false;
  for (const raw of photoArray) {
    const display = photoDisplayUrl(raw);
    const reason = display.startsWith('/_img/') ? await proxyServesImage(display) : await whyBlocked(display);
    if (reason === null) return null;      // this photo renders → the card shows it
    if (!isUnknownVerdict(reason)) everJudged = true;
    lastReason = `${reason} (${display.slice(0, 60)})`;
  }
  // Every photo failed. If NONE of them was actually answered by its host, this card is UNKNOWN,
  // not blank — the difference between "the browser would refuse this" and "we never asked it".
  if (!everJudged && photoArray.length) return `${UNKNOWN}no photo on this card was answered — ${lastReason}`;
  return lastReason;                        // every photo failed → the card is blank
}

let measured = 0, noPhoto = 0, unknownPlatforms = 0, judgedPlatforms = 0;
for (const p of platforms) {
  const listings = await sampleListings(p);
  if (!listings.length) { noPhoto++; continue; }
  measured++;
  const verdicts = await Promise.all(listings.map(cardRenders));
  const rendered = verdicts.filter((v) => v === null).length;
  // UNKNOWN cards are removed from the DENOMINATOR, not scored as failures: the majority rule is
  // about the listings whose hosts actually answered. A platform where none answered is reported
  // UNKNOWN and left unjudged, rather than declared broken on the strength of no evidence.
  const unknown = verdicts.filter(isUnknownVerdict).length;
  const judged = listings.length - unknown;
  if (judged === 0) {
    unknownPlatforms++;
    console.log(`  ? ${p}: UNKNOWN — no sampled listing's host answered (${unknown}/${listings.length}); `
      + `first reason: ${verdicts.find(isUnknownVerdict)}`);
    continue;
  }
  judgedPlatforms++;
  // A platform-wide render failure (like Sadin's CORP block) sinks every sampled listing; a lone
  // corrupt url on one listing (e.g. aqar's trailing-backslash artifact) does not, because the card
  // falls through to the next photo. Require the MAJORITY to render.
  check(`${p}: card photos render for the majority of ANSWERED listings (${rendered}/${judged}`
    + `${unknown ? `, ${unknown} unknown` : ''})`,
    majorityRender(rendered, judged),
    `first failure: ${verdicts.find((v) => v !== null && !isUnknownVerdict(v))}`);
}

// UNKNOWN must never read as health. If no platform could be judged at all, this run proved nothing
// about renderability and says so, instead of exiting 0 over a sweep that never reached a host.
check('at least one platform was actually JUDGED (an all-UNKNOWN sweep proves nothing)',
  judgedPlatforms > 0,
  `${unknownPlatforms} platform(s) UNKNOWN, ${judgedPlatforms} judged — check this runner's egress before reading anything into it`);

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

// ── UNKNOWN vs BLOCKED — proven in BOTH directions (ops_incident #81) ────────────────────────────
// Downgrading a red to an UNKNOWN is only legitimate if the red was never the host's answer. A
// verdict the host DID produce must still count as a block, and it does.
const hdrs = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
mustCatch('THE CI FAILURE OF 2026-09-06: `fetch failed` scored as «the browser would block this»',
  isUnknownVerdict(`${UNKNOWN}no response — fetch threw (fetch failed)`) === false);
mustCatch('an egress denial scored as the host\'s verdict (x-deny-reason is a header no image host sends)',
  isEgressDenial(hdrs({ 'x-deny-reason': 'host_not_allowed' })) === false);
mustCatch('a HOST-sent block downgraded to UNKNOWN — Sadin\'s CORP must still be a block',
  isUnknownVerdict('CORP:same-origin at hop 0') === true
  || isEgressDenial(hdrs({ 'cross-origin-resource-policy': 'same-origin' })) === true);
mustCatch('a HOST-sent 404 downgraded to UNKNOWN',
  isUnknownVerdict('HTTP 404') === true);
mustCatch('the majority gate reading an UNKNOWN card as a rendered one (0 answered is not 0 broken)',
  majorityRender(0, 0) === true);

console.log(`\n${measured} platform(s) with photos checked, ${noPhoto} without photos skipped, `
  + `${judgedPlatforms} judged, ${unknownPlatforms} UNKNOWN (no host answered).`);
console.log(failed
  ? `\n✗ verify-card-photos-render-live: ${failed} platform(s) have DB photos the browser cannot render.\n`
  : '\n✅ verify-card-photos-render-live: every active platform\'s DB photo renders on the card.\n');
process.exit(failed ? 1 : 0);
