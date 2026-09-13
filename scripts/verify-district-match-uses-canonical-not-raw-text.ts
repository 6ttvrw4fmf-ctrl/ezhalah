// PERMANENT BARRIER — the strict district filter must match against the resolved CANONICAL
// district (Listing.districtCanonical), never the raw-preferring display field (Listing.district).
//
// THE BUG THIS PINS (found live 2026-09-12). remote.ts's `l.district` prefers a source's own raw
// scraped neighborhood text whenever it's Arabic script — correct for CITY (owner 2026-07-06,
// source-accurate display) but wrong as the input to the STRICT district match in search.ts's
// listingInDistricts(), because a source's free-text label can textually diverge from what the
// location index actually resolved it to (e.g. resolved via geocoding, not text similarity).
// Reproduced live: 19 real amlakalahsa listings correctly indexed under canonical district
// "حي هجر الخامس" carried the raw label "الضاحية الخامس" — a different-looking name for the same
// place. The old code compared "الضاحية الخامس" against the picked "حي هجر الخامس" and found no
// overlap, silently dropping all 19 and answering "no results in this district" over real inventory.
//
// EXECUTED, NOT GREPPED, two ways: (1) the SOURCE TEXT of both call sites is asserted to actually
// prefer districtCanonical — search.ts's extension-less internal imports (./proximity etc.) block a
// direct `import` of runSearch under plain Node, the same constraint verify-pool-keeps-fetched-
// order.ts documents; (2) the real, unmodified listingInDistricts is LIFTED (liftSymbols) and
// exercised with the real fixture data and the exact priority the call sites now use — so the
// matching logic itself is never reimplemented, only invoked.
//
//   node --experimental-strip-types scripts/verify-district-match-uses-canonical-not-raw-text.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { liftSymbols } from './lib/liftSymbols.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

// ── 1. Source-shape: both call sites actually read districtCanonical first ────────────────────────
const searchSrc = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');
// Exclude the function's own definition line ("function listingInDistricts(stored: string, ...")
// — only actual call sites (".filter((l) => listingInDistricts(...", i.e. inside a CALL, never a
// declaration) are checked below.
const callSites = searchSrc.split('\n')
  .filter((line) => line.includes('listingInDistricts(') && !line.trimStart().startsWith('function '))
  .map((line) => /listingInDistricts\(([^,]+),/.exec(line)?.[1]?.trim())
  .filter((s): s is string => !!s);
check('1. found exactly 2 listingInDistricts call sites', callSites.length === 2, `found ${callSites.length}: ${callSites.join(' | ')}`);
check('1. both call sites prefer l.districtCanonical over l.district',
  callSites.every((expr) => /districtCanonical/.test(expr)),
  callSites.join(' | '));
check('1. neither call site dropped the raw-text fallback (still safe when unresolved)',
  callSites.every((expr) => /\|\|.*\.district\b/.test(expr)),
  callSites.join(' | '));

// ── 2. Behavior: the REAL listingInDistricts, given the REAL priority order, on REAL row shapes ───
const lifted = await liftSymbols(
  new URL('../src/data/search.ts', import.meta.url).pathname,
  [{ header: 'function listingInDistricts(' }],
  ['listingInDistricts'],
  [
    // normalizeArabic is the load-bearing dependency (the fold this bug is actually about) — real
    // import, self-contained, no further module-resolution chain. translitPlace only feeds an
    // additional cross-script (Arabic-vs-Latin) OR-branch this test's pure-Arabic fixtures never
    // need; it pulls in a '@/data/...' alias plain Node can't resolve outside the app's own
    // bundler, so it's stubbed to a no-op here — matching this repo's own precedent of stubbing a
    // dependency that "carries no logic for these fixtures" (verify-pool-keeps-fetched-order.ts's
    // effectiveGroups stub).
    `import { normalizeArabic } from ${JSON.stringify(new URL('../src/lib/chatSearch.ts', import.meta.url).pathname)};`,
    `const translitPlace = (_s: string) => '';`,
  ].join('\n'),
);
const listingInDistricts = lifted.listingInDistricts as (stored: string, wanted: string[]) => boolean;

// The exact fallback priority both call sites now use, applied to a real Listing-shaped object.
const matches = (l: { district: string; districtCanonical?: string }, wanted: string[]) =>
  listingInDistricts(l.districtCanonical || l.district || '', wanted);

// Real amlakalahsa row (id 11606283): raw office text vs. what the index actually resolved it to.
const raw = 'الضاحية الخامس';
const canonical = 'حي هجر الخامس';
const picked = ['حي هجر الخامس'];

check('2. canonical set: the real listing matches the district the user picked',
  matches({ district: raw, districtCanonical: canonical }, picked) === true);
check('2. (mutation) canonical ABSENT reproduces the live bug — raw text alone does not match',
  matches({ district: raw }, picked) === false);
check('2. (mutation) canonical EMPTY STRING also falls back to raw (still reproduces the bug)',
  matches({ district: raw, districtCanonical: '' }, picked) === false);
check('2. sanity: a genuinely different canonical district is still correctly excluded',
  matches({ district: raw, districtCanonical: 'حي النرجس' }, picked) === false);
check('2. sanity: an exact-spelling raw district (no drift) still matches either way',
  matches({ district: 'حي هجر الخامس' }, picked) === true);

console.log(failed === 0
  ? '\n✅ the district filter matches the resolved canonical district, not raw display text.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
