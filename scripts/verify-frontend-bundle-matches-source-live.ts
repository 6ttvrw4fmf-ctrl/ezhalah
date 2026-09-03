// LIVE FRONTEND BUNDLE ⟷ SOURCE PARITY (item 8a, owner bug-class fix 2026-09-01).
//
// THE INCIDENT THIS GUARDS: commit 618875e certified 8 new amenity tokens (gym, pool, garden,
// balcony, laundry_room, optical_fibers, separate_electricity_meter, separate_water_meter) in
// src/lib/afCohorts.ts and merged to main — but `deploy-frontend.yml` is workflow_dispatch-only (a
// DELIBERATE choice, see that file's header: "must never become auto-deploy-on-push"), so a merge to
// main does NOT ship anything on its own. The certification sat live in git, invisible to every real
// user, until someone remembered to run the deploy. No existing check caught this: `npm test` proves
// the SOURCE is correct; `deploy-frontend.yml`'s own post-deploy checks (alias assertion, hydration
// gate) only run DURING a deploy and by construction pass once one happens — neither one notices that
// NO deploy happened for days despite main moving.
//
// WHAT THIS CHECKS, and why it must run on a SCHEDULE, not just post-deploy: this compares the LIVE
// production bundle (whatever users are being served right now, deployed or not) against a FRESH
// checkout of current main, independent of whether a deploy is in flight. It executes the real
// certifiedAmenityKeys() gate (src/lib/afCohorts.ts) — not a hand-copied duplicate of the token list —
// and asserts the exact ordered token sequence it currently returns is a literal, compiled substring
// of the bundle Metro just shipped. If main is ever certified further ahead of what is actually
// live, this goes red on its own schedule instead of waiting for someone to notice.
//
// SCOPE (deliberately): this covers the amenity base list — the exact shape that actually drifted.
// Doing the equivalent for the much larger COHORT_QUESTIONS nested object against a *minified*
// bundle would mean pattern-matching a big object literal through an unspecified minifier layout —
// fragile by construction, and worse than not having the check (a false sense of coverage). The
// robust way to cover COHORT_QUESTIONS the same way — e.g. baking a build-time content hash of it
// into the bundle that this script recomputes from source and compares — is flagged as a follow-up,
// not implemented here.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/verify-frontend-bundle-matches-source-live.ts

import { certifiedAmenityKeys } from '../src/lib/afCohorts.ts';
import type { SearchQuery } from '../src/data/search.ts';

const PROD = 'https://ezhalah-app.vercel.app';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

async function fetchText(url: string, label: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'ezhalah-live-parity-check' } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} fetching ${url}`);
  return res.text();
}

// A minifier keeps string literals verbatim (quote char aside) and never reorders array elements —
// so the exact SOURCE-DERIVED order, joined as it would appear in a compiled array literal, is a
// reliable literal substring to search for regardless of surrounding minification. Both quote styles
// are checked since the specific bundler in use today happens to keep single quotes.
function containsOrderedArray(bundle: string, tokens: string[]): boolean {
  const bySingle = tokens.map((t) => `'${t}'`).join(',');
  const byDouble = tokens.map((t) => `"${t}"`).join(',');
  return bundle.includes(bySingle) || bundle.includes(byDouble);
}

const Q = (over: Record<string, unknown>) =>
  ({ deal: 'Rent', location: '', category: 'Residential', type: null, detail: null,
     priceInput: '', priceBand: null, rentPeriod: 'annual', ...over }) as unknown as SearchQuery;

const html = await fetchText(`${PROD}/`, 'production HTML');
const entryMatch = /\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/.exec(html);
check('production HTML references an Expo web entry bundle', !!entryMatch, 'the app may have moved off Expo web — update this script\'s bundle discovery');
if (!entryMatch) {
  console.error(`\n✗ ${++failed} check(s) FAILED — cannot locate the live bundle to check`);
  process.exit(1);
}
console.log(`Live entry bundle: ${entryMatch[0]}`);
const bundle = await fetchText(`${PROD}${entryMatch[0]}`, 'live entry bundle');
check('fetched a non-trivial bundle (sanity floor, catches an empty/error response passing as 200)',
  bundle.length > 500_000, `got ${bundle.length} bytes`);

// ── THE EXACT SHAPE THAT DRIFTED: certifiedAmenityKeys() for Apartment/RentAnnual, executed from
// TODAY's checkout of main — not a copy of the 15-token list pinned into this file. ──────────────────
const apartmentAnnual = certifiedAmenityKeys(Q({ type: 'Apartment' }));
check(`current main's certifiedAmenityKeys(Apartment, RentAnnual) returns ${apartmentAnnual.length} tokens (sanity floor)`,
  apartmentAnnual.length >= 15, `got ${JSON.stringify(apartmentAnnual)} — afCohorts.ts may have shrunk`);
check('the LIVE bundle contains the exact, currently-certified amenity token sequence for Apartment/RentAnnual',
  containsOrderedArray(bundle, apartmentAnnual),
  `main currently certifies ${JSON.stringify(apartmentAnnual)} but the deployed bundle does not contain this exact ` +
  'sequence — main has moved ahead of what users are actually served. Run deploy-frontend.yml.');

const villaAnnual = certifiedAmenityKeys(Q({ type: 'Villa' }));
const villaOnly = villaAnnual.filter((t) => !apartmentAnnual.includes(t));
check(`current main's certifiedAmenityKeys(Villa, RentAnnual) adds ${villaOnly.length} villa-only token(s) (sanity floor)`,
  villaOnly.length >= 2, `got ${JSON.stringify(villaOnly)}`);
check('the LIVE bundle contains the villa-only amenity tokens too',
  villaOnly.every((t) => bundle.includes(`'${t}'`) || bundle.includes(`"${t}"`)),
  `main certifies villa-only ${JSON.stringify(villaOnly)} but not all are present in the deployed bundle`);

console.log(failed === 0
  ? '\n✓ the live bundle\'s compiled amenity certification matches current main — no undeployed drift'
  : `\n✗ ${failed} check(s) FAILED — the live frontend has drifted behind main. See docs/ops/ (deploy-frontend.yml) to ship the fix.`);
process.exit(failed === 0 ? 0 : 1);
