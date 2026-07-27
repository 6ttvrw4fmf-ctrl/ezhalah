// Automated regression guard — DealApp listing_url must always be the CANONICAL, server-rendered
// route `https://dealapp.sa/ar/ad-details/<numeric-id>`, and the RETIRED
// `https://dealapp.sa/ar/marketplace/ad/<mongo-id>` route must never come back (2026-07-27).
//
// BACKGROUND (all re-verified live 2026-07-27, evidence frozen into LAYER B below):
//
//   • `/ar/marketplace/ad/<mongo-id>` is RETIRED. The whole `/ar/marketplace/*` family now serves
//     the app's own 404 page (loads assets/imgs/404_shape.png, 404_body.png, 404bg.webp) and makes
//     NO api.dealapp.sa call at all. There is no 301/302 to the canonical route — nothing to
//     follow. A stored URL in that shape is permanently dead for users AND useless for liveness
//     checks: it cannot distinguish a delisted ad from a retired route.
//
//   • `/ar/ad-details/<numeric-id>` is Angular Universal SSR — the ad's own <title> is in the HTML
//     of the first response, so it is the ONLY route on which an offline/no-JS liveness check is
//     sound. A live id returns its own title; an unknown id falls back to the site-wide title.
//
//   • These are the only two shapes ever observed. The 36 rows in the retired `deal` table (the
//     reverted June JSON-API experiment) hold the obsolete shape; all 4,990 dealapp_residential +
//     263 dealapp_commercial rows hold the canonical shape, because scrapers/dealapp/run.py builds
//     it from the numeric ad id. This guard exists so that stays true.
//
//   • `api.dealapp.sa` answers `401 error.authTokenNotSupplied` on EVERY path, real or bogus, so
//     the API can never be used as a liveness oracle. Asserted in LAYER B so nobody re-derives it.
//
// Three offline/deterministic layers (no network, no DB):
//
//   LAYER A — STATIC SOURCE CHECK: parses the ACTUAL shipped scrapers/dealapp/run.py + recover.py
//     and asserts listing_url is built from the numeric ad id on the /ar/ad-details/ route, that
//     the retired /marketplace/ad/ shape appears in no URL construction anywhere under scrapers/,
//     and that the signup-wall sentinel is still wired into the fetch path.
//
//   LAYER B — FROZEN LIVE EVIDENCE: the 2026-07-27 route probe (real titles + body sizes) drives a
//     pure reimplementation of the liveness rule, proving canonical-route liveness is decidable,
//     retired-route liveness is NOT, and a signup wall is neither alive nor dead.
//
//   LAYER C — URL SHAPE VALIDATOR: canonical URLs accepted, every obsolete/degenerate shape
//     rejected, and DEAL<n> -> DA<n> id equivalence (the join key that makes migration mechanical).
//
// Run: node --experimental-strip-types scripts/verify-dealapp-route-shape.ts   (wired into `npm test`)
// Exits non-zero on any failure so it can gate CI.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const runPy = readFileSync(join(repoRoot, 'scrapers', 'dealapp', 'run.py'), 'utf8');
const recoverPy = readFileSync(join(repoRoot, 'scrapers', 'dealapp', 'recover.py'), 'utf8');

let failed = 0;
const pass = (label: string) => console.log(`PASS  ${label}`);
const fail = (label: string) => { failed++; console.error(`FAIL  ${label}`); };

// ── LAYER A: static source check ───────────────────────────────────────────────────────────────
console.log('=== LAYER A: static source check (scrapers/dealapp/*.py) ===');

const CANONICAL_BUILD = /listing_url\s*=\s*f"\{BASE\}\/ar\/ad-details\/\{adid\}"/;
if (CANONICAL_BUILD.test(runPy)) pass('listing_url is built as {BASE}/ar/ad-details/{adid} (canonical route)');
else fail('listing_url is NOT built on the canonical /ar/ad-details/{adid} route — check map_listing()');

const FETCH_CANONICAL = /url\s*=\s*f"\{BASE\}\/ar\/ad-details\/\{adid\}"/;
if (FETCH_CANONICAL.test(runPy)) pass('fetch_one() fetches the canonical /ar/ad-details/ route (the SSR one)');
else fail('fetch_one() no longer fetches /ar/ad-details/ — liveness checks would lose their SSR oracle');

// The retired route must not appear in any URL construction in an ACTIVE scraper.
//
// scrapers/deal/ is EXEMPT by design: `deal` is a formally retired slug (scrapers/RETIRED_PLATFORMS.txt)
// whose directory is deliberately kept for history, and it is the reverted JSON-API experiment that
// created these URLs in the first place. It cannot run — test_retired_platforms_guard.py already
// fails CI if a retired slug re-enters any workflow matrix. So the invariant here is narrower and
// composes with that guard: no LIVE scraper may construct the retired route. A new offender in an
// active scraper fails; the historical one does not, and un-retiring `deal` would surface it again.
const retiredSlugs = new Set(
  readFileSync(join(repoRoot, 'scrapers', 'RETIRED_PLATFORMS.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')),
);
if (retiredSlugs.has('deal')) pass('`deal` is a formally retired slug (its historical URL construction is exempt)');
else fail('`deal` is no longer listed in RETIRED_PLATFORMS.txt — its /marketplace/ad/ URLs are now live code');

const scrapersDir = join(repoRoot, 'scrapers');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== '__pycache__') walk(p, out); }
    else if (e.endsWith('.py')) out.push(p);
  }
  return out;
};
const OBSOLETE_ROUTE = /marketplace\/ad\//;
const slugOf = (file: string) => {
  const rel = file.slice(scrapersDir.length + 1);
  return rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '';
};
const offenders = walk(scrapersDir).filter((f) => {
  if (retiredSlugs.has(slugOf(f))) return false;  // retired dirs are history, and cannot run
  // The sentinel/doc comments may NAME the retired route; only flag it inside an f-string or a
  // quoted URL literal, i.e. an actual construction.
  const src = readFileSync(f, 'utf8');
  return src.split('\n').some((line) => {
    if (!OBSOLETE_ROUTE.test(line)) return false;
    const isComment = /^\s*#/.test(line) || /^\s*(\*|""")/.test(line);
    return !isComment && /(f"|f'|"|')[^"']*marketplace\/ad\//.test(line);
  });
});
if (offenders.length === 0) pass('the RETIRED /marketplace/ad/ route appears in no URL construction under scrapers/');
else fail(`the RETIRED /marketplace/ad/ route is being constructed in: ${offenders.join(', ')}`);

// The signup-wall sentinel must stay wired into the fetch path (see test_dealapp_signup_wall.py).
if (/if is_signup_wall\(r\.text\):/.test(runPy)) pass('fetch_one() still screens responses through is_signup_wall()');
else fail('fetch_one() no longer screens for the signup wall — walled responses could be ingested');
if (/if is_signup_wall\(html\):/.test(recoverPy)) pass('recover._classify() still refuses to verdict a walled response');
else fail('recover._classify() no longer guards the signup wall — a wall could read as live/sold');

// ── LAYER B: frozen live evidence (2026-07-27 route probe) ─────────────────────────────────────
console.log('\n=== LAYER B: frozen live evidence (route probe 2026-07-27) ===');

const SITE_WIDE_TITLE = 'ديل | شقق وفلل وأراضي للبيع والإيجار في السعودية - تطبيق ديل العقاري';
const WALL_TITLE = 'صفحة التسجيل';

// Pure reimplementation of the liveness rule the probe used. Deliberately returns 'unknown' for a
// wall — the invariant is that a throttling response can never become a live/dead verdict.
type Verdict = 'live' | 'dead' | 'unknown';
function livenessFromTitle(title: string): Verdict {
  if (title === WALL_TITLE) return 'unknown';
  if (title === SITE_WIDE_TITLE) return 'dead';
  return 'live';
}

// Frozen probe results on the CANONICAL route. `title` is what the first (SSR) response carried.
const CANONICAL_PROBE: Array<{ id: string; title: string; bytes: number; expect: Verdict; note: string }> = [
  { id: '402463', title: 'عمارة للبيع', bytes: 158137, expect: 'live',
    note: 'matches our stored DA402463: Building / Buy / Mecca / 4,000,000' },
  { id: '471067', title: 'شقة للبيع', bytes: 165937, expect: 'live', note: 'live, absent from our dataset' },
  { id: '483913', title: 'ارض سكنية للبيع', bytes: 153034, expect: 'live', note: 'live, absent from our dataset' },
  { id: '501376', title: 'ارض سكنية للإيجار', bytes: 158061, expect: 'live', note: 'live rental, absent from our dataset' },
  { id: '286432', title: SITE_WIDE_TITLE, bytes: 129735, expect: 'dead', note: 'genuinely delisted' },
  { id: '509005', title: SITE_WIDE_TITLE, bytes: 129735, expect: 'dead', note: 'genuinely delisted' },
  { id: '999999999', title: SITE_WIDE_TITLE, bytes: 129747, expect: 'dead',
    note: 'bogus-id control: proves the fallback title is the dead signal' },
];

for (const p of CANONICAL_PROBE) {
  const got = livenessFromTitle(p.title);
  if (got === p.expect) pass(`ad-details/${p.id}: ${got} (${p.note})`);
  else fail(`ad-details/${p.id}: expected ${p.expect}, rule produced ${got}`);
}

// The dead/live signal must be genuinely distinguishable — if every probe collapsed to one verdict
// the fixture would prove nothing.
const verdicts = new Set(CANONICAL_PROBE.map((p) => livenessFromTitle(p.title)));
if (verdicts.has('live') && verdicts.has('dead')) pass('canonical route yields BOTH live and dead verdicts (oracle is real, not a no-op)');
else fail('canonical route probe collapsed to a single verdict — it cannot prove liveness is decidable');

// The signup wall: 200, ~86KB, no listing schema. Neither alive nor dead.
if (livenessFromTitle(WALL_TITLE) === 'unknown') pass('signup wall (200, 86,329 bytes) verdicts "unknown" — never live, never dead');
else fail('signup wall produced a live/dead verdict — the false-alive trap is open');

// The RETIRED route carries no per-ad signal at all: same app-404 page for a known-live id as for
// a bogus one, so no rule over it can decide liveness.
const RETIRED_PROBE = {
  knownLiveId: '6a3463d09bdd1abf78b98e86', // the mongo id stored for DEAL532204
  bogusId: '000000000000000000000000',
  title: SITE_WIDE_TITLE,
  bytes: 27243,
  is404Page: true,
};
if (RETIRED_PROBE.title === SITE_WIDE_TITLE && RETIRED_PROBE.is404Page)
  pass('retired /marketplace/ad/ route serves the app 404 page for a KNOWN-LIVE id — carries no liveness signal');
else fail('retired-route fixture no longer reflects the observed app-404 behaviour');

// No redirect exists, so "just follow the redirect" is not a migration path.
const RETIRED_ROUTE_REDIRECTS_TO_CANONICAL = false; // observed: client-side 404, no 3xx
if (!RETIRED_ROUTE_REDIRECTS_TO_CANONICAL)
  pass('retired route does NOT redirect to canonical — stored obsolete URLs cannot self-heal');
else fail('fixture claims a redirect exists; re-verify before relying on it');

// api.dealapp.sa is not an oracle: identical 401 for real and bogus paths.
const API_PROBE = { realPath: 401, bogusPath: 401, code: 'error.authTokenNotSupplied' };
if (API_PROBE.realPath === API_PROBE.bogusPath && API_PROBE.realPath === 401)
  pass(`api.dealapp.sa returns ${API_PROBE.code} for real AND bogus paths — unusable as a liveness oracle`);
else fail('api.dealapp.sa fixture changed — re-verify before using the API for liveness');

// ── LAYER C: URL shape validator + id equivalence ──────────────────────────────────────────────
console.log('\n=== LAYER C: URL shape validator + DEAL<n>/DA<n> id equivalence ===');

const CANONICAL_URL_RE = /^https:\/\/dealapp\.sa\/ar\/ad-details\/\d+$/;

const ACCEPT = [
  'https://dealapp.sa/ar/ad-details/402463',
  'https://dealapp.sa/ar/ad-details/92975',
  'https://dealapp.sa/ar/ad-details/536496',
];
const REJECT = [
  'https://dealapp.sa/ar/marketplace/ad/6a3463d09bdd1abf78b98e86', // retired route
  'https://dealapp.sa/ar/marketplace/ad/402463',                   // retired route, numeric id
  'https://dealapp.sa/ar/ad-details/',                             // no id
  'https://dealapp.sa/ar/ad-details/6a3463d09bdd1abf78b98e86',     // mongo id on canonical route
  'https://dealapp.sa/en/ad-details/402463',                       // EN locale (we store AR)
  'http://dealapp.sa/ar/ad-details/402463',                        // not https
];

for (const u of ACCEPT) {
  if (CANONICAL_URL_RE.test(u)) pass(`accepted canonical URL: ${u}`);
  else fail(`canonical URL rejected by the validator: ${u}`);
}
for (const u of REJECT) {
  if (!CANONICAL_URL_RE.test(u)) pass(`rejected non-canonical URL: ${u}`);
  else fail(`non-canonical URL accepted by the validator: ${u}`);
}

// DEAL<n> (retired experiment) and DA<n> (production) share the same site ad number. This is the
// join key that makes the retired rows migratable, and the reason a naive full-string ad_number
// comparison reports a FALSE "zero overlap" between the two tables.
const ID_PAIRS: Array<{ deal: string; dealapp: string }> = [
  { deal: 'DEAL402463', dealapp: 'DA402463' },
  { deal: 'DEAL516093', dealapp: 'DA516093' },
  { deal: 'DEAL522791', dealapp: 'DA522791' },
  { deal: 'DEAL528807', dealapp: 'DA528807' },
];
const siteAdNumber = (adNumber: string) => adNumber.replace(/^(DEAL|DA)/, '');
const canonicalUrlFor = (adNumber: string) => `https://dealapp.sa/ar/ad-details/${siteAdNumber(adNumber)}`;

for (const p of ID_PAIRS) {
  if (siteAdNumber(p.deal) === siteAdNumber(p.dealapp))
    pass(`${p.deal} and ${p.dealapp} resolve to the same site ad number ${siteAdNumber(p.deal)}`);
  else fail(`${p.deal} and ${p.dealapp} do NOT resolve to the same site ad number`);

  if (p.deal !== p.dealapp)
    pass(`${p.deal} != ${p.dealapp} as raw strings (why a naive ad_number join reports zero overlap)`);
  else fail(`${p.deal} and ${p.dealapp} are string-identical — fixture cannot show the join-key trap`);

  if (CANONICAL_URL_RE.test(canonicalUrlFor(p.deal)))
    pass(`${p.deal} migrates to a valid canonical URL (${canonicalUrlFor(p.deal)})`);
  else fail(`${p.deal} does not migrate to a valid canonical URL`);
}

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} DealApp route-shape assertion(s) FAILED — a retired-route or wall regression can ship`);
  process.exit(1);
}
console.log('✓ listing_url is canonical /ar/ad-details/<numeric-id> in source, the retired '
  + '/marketplace/ad/ route is constructed nowhere, the wall sentinel is wired in both jobs, and '
  + 'all frozen route/id fixtures reproduce correctly');
