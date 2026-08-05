// Regression guard for the citySelected rehydration fix (2026-08-04).
//
// The bug (live-proven on production, browser E2E): search → results → reopen the filter →
// press Search with NOTHING touched → «الرجاء اختيار مدينة من القائمة», even though the field
// still shows the previously list-picked city. Root cause: query.location/query.locationMatch
// persist in the app context across the navigation, but citySelected — the ONLY thing that makes
// a search valid (owner spec 2026-07-17) — is local component state and comes back null on
// remount. Every returning user had to clear + re-pick the same city to search again.
//
// The fix pins THREE properties this guard checks:
//   1. The mount/deal-change ensureCityFieldIndex effect rehydrates citySelected from the pool,
//      gated on the persisted text being EXACTLY the label of a persisted kind:'city' exact
//      locationMatch (a pick that came from this list and already drove a search — not free text).
//   2. The candidate must ROUND-TRIP through resolveCitySelection() to the same city AND region as
//      the persisted resolution (disambiguates real same-name twins, e.g. الهفوف), and 0/2+
//      candidates rehydrate nothing (never guess).
//   3. setCitySelected uses a functional (prev ?? …) update so a live user pick is never clobbered.
//
//   node --experimental-strip-types scripts/verify-city-rehydration.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const home = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');

// ── 1. rehydration exists, in the right effect, correctly gated ──
check('ensureCityFieldIndex .then receives the pool (rehydration source)',
  home.includes('ensureCityFieldIndex(query.deal, paymentMonthly).then((pool)'));
check('surviving-resolution path gated on persisted kind:city exact match',
  home.includes("lm.kind === 'city' && lm.exact === true"));
check('rehydration gated on field text === verified label (edited/cleared text never rehydrates)',
  home.includes('query.location === lm.label'));

// ── 2. round-trip equality + never-guess ──
check('with a surviving resolution, candidate must round-trip resolveCitySelection to the SAME city and region',
  home.includes('r.city === lm!.city && r.region === lm!.region'));
check('without it (URL round-trip drops locationMatch), only an EXACT unique catalog-label match restores',
  home.includes('pool.filter((o) => o.cityAr === query.location)') && home.includes('(!lm && !!query.location)'));
check('ambiguous (0 or 2+) candidates rehydrate nothing',
  home.includes('match.length === 1'));

// ── 3. a live pick is never clobbered ──
check('setCitySelected uses functional prev ?? candidate update',
  home.includes('setCitySelected((prev) => prev ?? match[0])'));

// ── invariants that must NOT regress while fixing this ──
check('onSearch still blocks when citySelected is null (validation itself unchanged)',
  home.includes('if (!citySelected) {') && home.includes('setLocMsg(CITY_REQUIRED_MSG)'));
check('onChangeText still clears citySelected on every keystroke (stale pick never reused)',
  /onChangeText=\{\(v\) => \{[\s\S]{0,400}?setCitySelected\(null\)/.test(home));

if (failed) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll city-rehydration checks passed.');
