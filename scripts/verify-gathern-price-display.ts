// Automated test — a Gathern listing's click-through URL must never carry a fake date querystring
// that the source page silently ignores. That's exactly the bug that made GTH212141's stored price
// look "unreconcilable" during a 2026-07-14 price-fidelity audit.
//
// Root cause (NOT a scraper parsing bug — scrapers/gathern/run.py's map_listing() correctly reads
// the discounted 30-night total from the msapi search-units endpoint in monthly mode; verified
// against the live API for GTH212141 + 6 more sampled rows, see
// scripts/ops/repair_gathern_prices_2026-07-14.sql header for the live evidence). The bug was in
// src/lib/openListing.ts: it appended `?check_in=<today>&check_out=<today+30d>` to every Gathern
// listing_url before opening it, believing that would land the user on the priced monthly view.
//
// Live-verified 2026-07-14 that Gathern's page ignores this querystring completely:
//   • https://gathern.co/view/151391/unit/212141                                          (bare)
//   • https://gathern.co/view/151391/unit/212141?check_in=2026-07-14&check_out=2026-08-13  (dated)
//   both return an identical single-night spot-price view (`"nights": 1`, an arbitrary
//   `selected_check_in`/`selected_check_out`, e.g. "price": 145 / "price": 160) — nothing like the
//   stored ~5,213 SAR monthly figure. The page's own `__NEXT_DATA__.props.pageProps.query` contains
//   only `{"chalet_id":"151391","unit_id":"212141"}` — the date params are never read server- or
//   client-side. Reproduced identically on GTH141609 (Medina), GTH210566 (Mecca), GTH199973 (Hail).
//
// Fix: src/lib/gathernUrl.ts's gathernClickThroughUrl() now returns the URL UNCHANGED — no more
// fake date params dressing up a page that can't use them. This test locks that in and would have
// caught the original bug (it asserts on the exact production URL for GTH212141/id=725485 that a
// previous version of this function would have corrupted with a `?check_in=...` suffix).
//
//   node --experimental-strip-types scripts/verify-gathern-price-display.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { gathernClickThroughUrl } from '../src/lib/gathernUrl.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

// ── REAL, EXECUTED assertions on gathernClickThroughUrl() ──────────────────────────────────────

// The exact originally-reported row: gathern_residential_listings.id=725485, ad_number=GTH212141.
const GTH212141_URL = 'https://gathern.co/view/151391/unit/212141';
eq(
  'gathernClickThroughUrl(GTH212141) returns the stored URL byte-for-byte unchanged',
  gathernClickThroughUrl(GTH212141_URL),
  GTH212141_URL,
);

// The 3 other live-sampled rows from the same investigation (stored listing_url values, confirmed
// via a live read of gathern_residential_listings on 2026-07-14 — not invented).
for (const [ad, url] of [
  ['GTH141609', 'https://gathern.co/view/99199/unit/141609'],
  ['GTH210566', 'https://gathern.co/view/150246/unit/210566'],
  ['GTH199973', 'https://gathern.co/view/119882/unit/199973'],
] as const) {
  eq(`gathernClickThroughUrl(${ad}) returns the stored URL unchanged`, gathernClickThroughUrl(url), url);
}

// Never appends a querystring of any kind — this is the actual bug shape (dates Gathern ignores).
const withoutQuery = gathernClickThroughUrl(GTH212141_URL);
check('gathernClickThroughUrl never appends a "?" querystring', !withoutQuery.includes('?'));
check('gathernClickThroughUrl output never contains "check_in="', !withoutQuery.includes('check_in='));
check('gathernClickThroughUrl output never contains "check_out="', !withoutQuery.includes('check_out='));

// A URL that already has a querystring (defensive — shouldn't happen from the scraper, which always
// stores the bare /view/.../unit/... form, but the function must still be a true no-op/identity).
const alreadyQueried = 'https://gathern.co/view/1/unit/2?foo=bar';
eq('gathernClickThroughUrl is a pure identity function (pre-existing query preserved, nothing added)',
  gathernClickThroughUrl(alreadyQueried), alreadyQueried);

// ── Source-text regression guard on openListing.ts ──────────────────────────────────────────────
// openListing.ts can't be live-imported here (it transitively pulls in react-native / expo-web-browser,
// which need the Expo runtime — same constraint noted in verify-no-english-city-leak.ts for
// src/data/search.ts). Guard the call site by source text instead: it must route Gathern URLs through
// gathernClickThroughUrl(), and must never reintroduce inline date-querystring construction.
const OPEN_LISTING_TS = readFileSync(new URL('../src/lib/openListing.ts', import.meta.url), 'utf8');
const stripWs = (s: string) => s.replace(/\s+/g, '');
const OPEN_LISTING_NOWS = stripWs(OPEN_LISTING_TS);

check(
  "openListing.ts routes gathern.co URLs through gathernClickThroughUrl(), not an inline date-appender",
  OPEN_LISTING_NOWS.includes("raw?.includes('gathern.co')?gathernClickThroughUrl(raw)"),
);
check(
  'openListing.ts imports gathernClickThroughUrl from @/lib/gathernUrl',
  OPEN_LISTING_NOWS.includes("import{gathernClickThroughUrl}from'@/lib/gathernUrl'"),
);
// The regression this guards against: any future `check_in=` / `check_out=` string built inline in
// this file (the exact shape of the original bug) rather than delegated to the tested pure helper.
const hasInlineDateParams = /check_in=\$\{|check_out=\$\{/.test(OPEN_LISTING_TS);
check('openListing.ts builds no inline check_in=/check_out= querystring (must live only in a tested helper, if ever)', !hasInlineDateParams);

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} gathern-price-display assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ all gathern-price-display assertions passed');
