// Automated tests — no English city name (or the generic Arabic placeholder in place of a real
// city) may leak into the Arabic UI via the "did you mean" / search-history / summary paths.
//
// Owner report (2026-07-13): a gibberish location search showed «...هل تقصد Dhahran؟» — the
// suggested city rendered in English inside an otherwise-Arabic sentence. Root cause:
// src/data/search.ts's noResultsSuggestion(), placeText() (search-history labels), and
// querySummaryLine() called tPlace() directly — a generic translator whose flat i18n.tsx AR{}
// dictionary silently falls back to raw English on a miss. Fixed by switching noResultsSuggestion()
// to the richer cityDisplay() and wrapping all three in arabicOrUnresolved().
//
// 2026-07-13 follow-up (this file): that first fix caused a real REGRESSION — cityDisplay()'s three
// lookup tables (CITY_AR_DISPLAY / the sa-locations.json catalog / CITY_TOKENS) didn't cover
// 'qassim' / 'eastern province' / 'al jawf' (previously translated correctly via the OLD flat
// dictionary, as region names) or 'al basr' / 'al bateen' / 'al dulaimiyah' (real Qassim villages,
// never added anywhere) — all 6 fell through to the generic LOCATION_UNRESOLVED_AR placeholder
// instead of a real city name. Fixed by adding all 6 to CITY_AR_DISPLAY (src/lib/cityDisplay.ts).
//
// Unlike the original version of this file, the CITY_AR_DISPLAY/CITY_TOKENS half of the fix now
// lives in src/lib/cityDisplay.ts — a zero-dependency module (mirrors src/lib/arabicText.ts's
// design) — so this test genuinely IMPORTS AND EXECUTES the real lookup function and asserts real
// string equality, not just that the right function names appear as source text. The search.ts
// half (noResultsSuggestion/placeText/querySummaryLine calling the right function) still can't be
// live-imported — search.ts transitively imports src/data/locations.ts, which imports a JSON asset
// and @/lib/supabase, and this repo has no bundler/loader wired up for a plain Node script to
// resolve those (confirmed: a raw import fails with "needs an import attribute of type: json") — so
// that part stays a source-text check, but a whitespace-tolerant one (2026-07-13 test-gap audit
// found the original regexes false-fail on harmless reformatting), and a stricter one for the
// known semantic blind spot (arabicOrUnresolved(tPlace(x)) must not read as safe just because
// arabicOrUnresolved appears somewhere on the line).
//
//   node --experimental-strip-types scripts/verify-no-english-city-leak.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { cityDisplayPure, CITY_AR_DISPLAY } from '../src/lib/cityDisplay.ts';
import { arabicOrPlaceholder } from '../src/lib/arabicText.ts';

const SEARCH_TS = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');

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

const PLACEHOLDER = 'موقع تجريبي غير محدد'; // distinct from the real LOCATION_UNRESOLVED_AR so a
// pass can't be accidentally explained by the production placeholder leaking through instead.

// ── REAL, EXECUTED assertions on cityDisplayPure() — the exact reported bug + the regression ──────
eq("cityDisplayPure('dhahran') resolves the exact originally-reported case", cityDisplayPure('dhahran'), 'الظهران');
eq('cityDisplayPure is case-insensitive (Dhahran, mixed case)', cityDisplayPure('Dhahran'), 'الظهران');
eq("cityDisplayPure('qassim') — regression case #1 (was silently downgraded to the placeholder)", cityDisplayPure('qassim'), 'منطقة القصيم');
eq("cityDisplayPure('eastern province') — regression case #2", cityDisplayPure('eastern province'), 'المنطقة الشرقية');
eq("cityDisplayPure('al jawf') — regression case #3", cityDisplayPure('al jawf'), 'منطقة الجوف');
eq("cityDisplayPure('al basr') — real Qassim village, previously unmapped anywhere", cityDisplayPure('al basr'), 'البصر');
eq("cityDisplayPure('al bateen') — real Qassim village, previously unmapped anywhere", cityDisplayPure('al bateen'), 'البطين');
eq("cityDisplayPure('al dulaimiyah') — real Qassim village, previously unmapped anywhere", cityDisplayPure('al dulaimiyah'), 'الدليمية');
// The gap-detection mechanism itself must be real, not vacuously true — an unmapped city truly
// returns null (letting the caller fall through to the sa-locations.json catalog, then finally the
// arabicOrPlaceholder safety net), it must never silently invent a translation.
eq('cityDisplayPure returns null (a real gap) for a city genuinely absent from every tier', cityDisplayPure('totally-unmapped-city-xyz-123'), null);

// ── REAL, EXECUTED assertions on the composed behavior (cityDisplayPure + arabicOrPlaceholder) ────
// This is exactly what src/data/search.ts's noResultsSuggestion() does:
//   arabicOrUnresolved(cityDisplay(alt.cityEn, getLocale()))
// cityDisplay() itself now also self-guards (src/data/locations.ts) for any city missed by ALL
// three tiers, so composing arabicOrPlaceholder over a tier-1/3 hit or a genuine miss must behave
// identically either way — a resolved Arabic name passes through, a genuine miss becomes the
// placeholder, never raw English.
eq('composed: a resolved city name passes through arabicOrPlaceholder unchanged', arabicOrPlaceholder(cityDisplayPure('dhahran') ?? 'dhahran', 'ar', PLACEHOLDER), 'الظهران');
eq('composed: a genuine gap becomes the placeholder, not raw English', arabicOrPlaceholder(cityDisplayPure('totally-unmapped-city-xyz-123') ?? 'totally-unmapped-city-xyz-123', 'ar', PLACEHOLDER), PLACEHOLDER);
eq('composed: English locale is untouched (not a leak there)', arabicOrPlaceholder(cityDisplayPure('totally-unmapped-city-xyz-123') ?? 'totally-unmapped-city-xyz-123', 'en', PLACEHOLDER), 'totally-unmapped-city-xyz-123');

// Every CITY_AR_DISPLAY value must actually contain Arabic script — a future typo'd English value
// pasted into this map would silently defeat the whole guard (arabicOrPlaceholder only intervenes
// when the result has ZERO Arabic characters, so a real Arabic key mapped to an English value would
// slip through unnoticed by that layer alone).
const nonArabicValues = Object.entries(CITY_AR_DISPLAY).filter(([, v]) => !/[ء-ي]/.test(v));
check(
  `every CITY_AR_DISPLAY value contains Arabic script (found ${nonArabicValues.length} that don't: ${nonArabicValues.map(([k]) => k).join(', ') || 'none'})`,
  nonArabicValues.length === 0,
);

// ── Source-text checks for the half that genuinely can't be live-imported (search.ts) ──────────────
// Whitespace-tolerant: strip ALL whitespace (not just collapse runs) before matching, so a Prettier
// reformat / line-wrap / extra space anywhere — including right after "(" or before ")" — never
// false-fails a functionally-unchanged call site (2026-07-13 test-gap audit: the previous \s*-in-
// specific-gaps regex still broke on `cityDisplay( alt.cityEn,   getLocale() )`-style padding).
const stripWs = (s: string) => s.replace(/\s+/g, '');
const SEARCH_NOWS = stripWs(SEARCH_TS);

check(
  'noResultsSuggestion() "did you mean" city is arabicOrUnresolved(cityDisplay(...)), not bare tPlace()',
  SEARCH_NOWS.includes('alt:arabicOrUnresolved(cityDisplay(alt.cityEn,getLocale()))'),
);
check(
  'placeText() (search-history label) wraps tPlace() in arabicOrUnresolved()',
  SEARCH_NOWS.includes("constplaceText=(q:SearchQuery)=>(q.location.trim()?arabicOrUnresolved(tPlace(q.location.trim()))"),
);
check(
  'querySummaryLine() wraps tPlace() in arabicOrUnresolved()',
  SEARCH_NOWS.includes('parts.push(arabicOrUnresolved(tPlace(q.location.trim())))'),
);

// Negative check, tightened to close the 2026-07-13 test-gap-audit blind spot: a FUTURE call site
// that wraps `tPlace(x)` in `arabicOrUnresolved(...)` where `cityDisplay(...)` is semantically
// required (x looks like a canonical city-key variable, e.g. `alt.cityEn`/`lm.city`/`fc.city`) must
// still be flagged — the old check treated ANY arabicOrUnresolved(...) on the same line as proof of
// safety, so arabicOrUnresolved(tPlace(alt.cityEn)) would have slipped through undetected. This
// negative check now also flags a bare tPlace(...cityEn) / tPlace(...lm.city) / tPlace(...fc.city)
// pattern regardless of what wraps it.
const cityKeyPattern = /tPlace\([^)]*\.(?:cityEn|city)\b/;
const bareTPlaceLines = SEARCH_TS
  .split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => /\btPlace\(/.test(line))
  .filter(({ line }) => !/^\s*(\/\/|const placeText|function tPlace)/.test(line.trim()))
  .filter(({ line }) => !/export function tPlace/.test(line))
  .filter(({ line }) => {
    const wrappedInArabicOrUnresolved = /arabicOrUnresolved\(/.test(line);
    const wrapsACanonicalCityKey = cityKeyPattern.test(line);
    if (wrapsACanonicalCityKey) return true; // ALWAYS wrong — cityDisplay() is required for a city key, tPlace() never is
    return !wrappedInArabicOrUnresolved; // generic free-text location: unwrapped tPlace() is the only remaining leak shape
  });
check(
  `no new tPlace() misuse in src/data/search.ts (found: ${bareTPlaceLines.map((l) => l.n).join(', ') || 'none'})`,
  bareTPlaceLines.length === 0,
);

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} no-english-city-leak assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ all no-english-city-leak assertions passed');
