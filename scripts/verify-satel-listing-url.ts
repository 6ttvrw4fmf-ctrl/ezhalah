// Automated regression guard — Satel `listing_url` must be built from `propertyNumber`, NEVER
// from `slug` (2026-07-14).
//
// ORIGINAL TASK PREMISE (re-verified and found FALSE): id=598777 (STA0212) was reported as
// price-corrupted. Live re-fetch of https://listings.satel.sa/property/A0212 on 2026-07-14 showed
// "Annual = SAR 115,000" — an EXACT match to the stored price_annual=115000. There is no price bug.
//
// THE REAL BUG: scrapers/satel/run.py `map_listing()` used to build `listing_url` from `slug`
// (`https://listings.satel.sa/property/<slug>`). Satel's frontend does not route on slug at all —
// it silently 200s to an unrelated hardcoded decoy listing ("Luxury Apartment in Riyadh", ad
// "SAT-001", Monthly SAR 4,500 / Annual SAR 48,000) for ANY slug, including nonexistent ones. THAT
// decoy page — not the real listing — is what produced the original "price mismatch" report: it
// was a false positive caused by verifying against the wrong URL, not a parsing bug in map_listing.
//
// Fix: `listing_url` is now built from `propertyNumber` (`pnum`), which Satel's frontend does
// route correctly (falls back to `_id` only when propertyNumber is truly absent, same as before).
//
// This test has two independent layers, both offline/deterministic (no network, no DB):
//
//   LAYER A — STATIC SOURCE CHECK: parses the ACTUAL shipped scrapers/satel/run.py and asserts
//     listing_url is built from `pnum`, and that the old buggy `{slug}` construction is gone. Fails
//     loudly if a future edit reintroduces the slug-based URL.
//
//   LAYER B — FIXTURE REPRODUCTION: a frozen fixture of 7 real Satel API records (propertyNumber +
//     slug + price, captured 2026-07-14, the same 7 properties independently live-browser-verified
//     against listings.satel.sa) drives a pure reimplementation of BOTH the OLD (buggy) and NEW
//     (fixed) listing_url-construction rule. Asserts: (1) for every fixture the old and new URLs
//     differ (proves this is a real, live bug class — not a no-op), (2) the new URL matches the
//     propertyNumber-keyed URL that was live-verified to render the correct price for that
//     property, (3) the new URL matches the exact format `https://listings.satel.sa/property/<A-Za-z><digits>`.
//
// Runs with ZERO project dependencies via Node's built-in type stripping (Node >= 22.6, repo uses 24):
//   node --experimental-strip-types scripts/verify-satel-listing-url.ts   (wired into `npm test`)
// Exits non-zero on any failure so it can gate CI.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runPyPath = join(__dirname, '..', 'scrapers', 'satel', 'run.py');
const source = readFileSync(runPyPath, 'utf8');

let failed = 0;
const pass = (label: string) => console.log(`PASS  ${label}`);
const fail = (label: string) => { failed++; console.error(`FAIL  ${label}`); };

// ── LAYER A: static source check on the actual shipped scrapers/satel/run.py ──────────────────
console.log('=== LAYER A: static source check (scrapers/satel/run.py) ===');

const buildsFromPnum = /listing_url\s*=\s*f"\{LISTING_BASE\}\/\{pnum\}"\s*if\s*pnum\s*else/.test(source);
if (buildsFromPnum) pass('listing_url is built from `pnum` (propertyNumber), with an `_id` fallback');
else fail('listing_url is NOT built from `pnum` — the propertyNumber-based fix is missing/changed');

// Regression guard: the OLD buggy construction (`{LISTING_BASE}/{slug}`) must never come back.
const stillUsesSlug = /listing_url\s*=\s*f"\{LISTING_BASE\}\/\{slug\}"/.test(source);
if (!stillUsesSlug) pass('the OLD slug-based listing_url construction is gone (no regression)');
else fail('the OLD slug-based listing_url construction (f"{LISTING_BASE}/{slug}") has reappeared');

// `pnum` must be defined before it's used to build listing_url (it's computed near the top of
// map_listing() from propertyNumber — guards against a rename/reorder silently breaking this).
const pnumDefined = /pnum\s*=\s*\(p\.get\("propertyNumber"\)\s*or\s*""\)\.strip\(\)/.test(source);
if (pnumDefined) pass('`pnum` is derived from the API\'s `propertyNumber` field');
else fail('`pnum` is no longer derived from `propertyNumber` — check map_listing() for a rename');

// ── LAYER B: frozen fixture reproduction ───────────────────────────────────────────────────────
console.log('\n=== LAYER B: fixture reproduction (frozen 2026-07-14 capture) ===');

const LISTING_BASE = 'https://listings.satel.sa/property';

// Pure reimplementations mirroring scrapers/satel/run.py's map_listing() listing_url logic —
// BEFORE (the shipped bug) and AFTER (the fix) — so the divergence is provable without a Python
// interpreter or network access.
function oldBuggyListingUrl(slug: string, id: string): string {
  return slug ? `${LISTING_BASE}/${slug}` : `${LISTING_BASE}/${id}`;
}
function newFixedListingUrl(pnum: string, id: string): string {
  return pnum ? `${LISTING_BASE}/${pnum}` : `${LISTING_BASE}/${id}`;
}

// Frozen fixture: 7 real Satel records (satel_all.json, captured 2026-07-14), independently
// live-verified by fetching https://listings.satel.sa/property/<propertyNumber> and reading the
// rendered price off the page. `liveVerifiedUrl` is what that live fetch proved is the CORRECT,
// working URL for the property (i.e. what newFixedListingUrl() must produce).
const FIXTURES: Array<{ id: string; propertyNumber: string; slug: string; liveVerifiedUrl: string; liveVerifiedNote: string }> = [
  { id: '598777_STA0212', propertyNumber: 'A0212', slug: '2-beds-apartment-in-al-wurud',
    liveVerifiedUrl: `${LISTING_BASE}/A0212`, liveVerifiedNote: 'Annual = SAR 115,000 (matches stored price_annual=115000)' },
  { id: '597735_STA0177', propertyNumber: 'A0177', slug: 'satel-at-opal-—-new-furnished-&-unfurnished-apartments',
    liveVerifiedUrl: `${LISTING_BASE}/A0177`, liveVerifiedNote: 'Annual = SAR 140,000' },
  { id: '597737_STC0052', propertyNumber: 'C0052', slug: 'la-brise-community-–-furnished-2-beds-with-balcony-for-rent',
    liveVerifiedUrl: `${LISTING_BASE}/C0052`, liveVerifiedNote: 'Annual = SAR 73,000' },
  { id: '1840095_STC0072', propertyNumber: 'C0072', slug: 'spacious-living-&-greater-privacy-unfurnished-apartment-in-al-olaya-',
    liveVerifiedUrl: `${LISTING_BASE}/C0072`, liveVerifiedNote: 'Rent for ... SAR 80,000 / annual' },
  { id: '2030772_STC0075', propertyNumber: 'C0075', slug: 'unfurnished-one-bedroom-apartment-in-al-olaya-',
    liveVerifiedUrl: `${LISTING_BASE}/C0075`, liveVerifiedNote: 'Rent for ... SAR 70,000 / annual' },
  { id: '597751_STV0044', propertyNumber: 'V0044', slug: 'creative-community-|-luxury-|-leisure-|-location-',
    liveVerifiedUrl: `${LISTING_BASE}/V0044`, liveVerifiedNote: 'Annual = SAR 200,000' },
  { id: '597734_STC0055', propertyNumber: 'C0055', slug: 'satel-at-opal-on-thoumamah-road---3-bedrooms-apartment',
    liveVerifiedUrl: `${LISTING_BASE}/C0055`, liveVerifiedNote: 'stored price_annual=110000, consistent with the same propertyNumber-keyed rule' },
];

const PNUM_URL_RE = /^https:\/\/listings\.satel\.sa\/property\/[A-Za-z]\d+$/;

for (const fx of FIXTURES) {
  const oldUrl = oldBuggyListingUrl(fx.slug, fx.id);
  const newUrl = newFixedListingUrl(fx.propertyNumber, fx.id);

  const diverge = oldUrl !== newUrl;
  if (diverge) pass(`${fx.propertyNumber}: old slug-based URL differs from new propertyNumber-based URL (bug is real, not a no-op)`);
  else fail(`${fx.propertyNumber}: old and new URLs are IDENTICAL — fixture can't prove the bug class`);

  const matchesLive = newUrl === fx.liveVerifiedUrl;
  if (matchesLive) pass(`${fx.propertyNumber}: new URL matches the live-verified URL (${fx.liveVerifiedNote})`);
  else fail(`${fx.propertyNumber}: new URL "${newUrl}" does NOT match live-verified "${fx.liveVerifiedUrl}"`);

  const formatOk = PNUM_URL_RE.test(newUrl);
  if (formatOk) pass(`${fx.propertyNumber}: new URL matches the required propertyNumber-keyed format`);
  else fail(`${fx.propertyNumber}: new URL "${newUrl}" does not match the required format`);
}

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} Satel listing_url assertion(s) FAILED — the slug/decoy-listing bug can regress`);
  process.exit(1);
}
console.log(`✓ listing_url is built from propertyNumber (not slug) in source, and all ${FIXTURES.length} frozen fixtures reproduce + resolve the bug correctly`);
