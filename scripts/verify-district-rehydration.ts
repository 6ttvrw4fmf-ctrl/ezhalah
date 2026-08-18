// Regression guard for the districtsSelected rehydration fix (Search & Matching QA, 2026-08-14).
//
// The bug (live-proven on production, browser E2E against https://ezhalah-app.vercel.app):
//   «إيجار · سنوي · الرياض · حي النرجس · شقة · 3 غرف · 20,000–90,000 ر.س · 100–300 م²» → 266 نتيجة
//   → reopen «تصفية» → press «بحث» with NOTHING touched → 1,255 نتيجة.
// Every other selection survived the round-trip; only the حي was dropped. Root cause:
// districtsSelected is LOCAL component state and comes back EMPTY on remount, while query.districts
// persists in the app context — and onSearch builds `districtMatchUnion` from the LOCAL array only,
// so the rebuilt query carried districts:undefined. The user's search was silently widened from
// their chosen حي to the whole city (+989 listings they never asked for), with the removable حي chip
// also gone, so nothing on screen said a filter had been dropped.
// This is the districtsSelected twin of the citySelected bug guarded by verify-city-rehydration.ts
// (2026-08-04) — same class, same field, same remount, different piece of local state.
//
// Search & Matching QA spec: §13 (never silently widen the user's request) · §29 (selections survive
// results → «تصفية» → «بحث») · §26 (a fix without recurrence protection is incomplete).
//
// The fix pins FOUR properties this guard checks:
//   1. A rehydration effect exists and sources its candidates from the SAME canonical catalog the
//      field itself picks from (ensureDistrictOptions), never from free text.
//   2. It restores ONLY on an exact set round-trip against query.districts — a drifted catalog
//      restores nothing rather than running a different search than the one on screen.
//   3. It runs at most once per mount (so a later city change / clearDistrict is permanent) and
//      cancels its in-flight catalog promise, so a stale pick can never land in a new city.
//   4. setDistrictsSelected uses a functional (prev.length ? prev : …) update, so a district the
//      user picks while the catalog is loading is never clobbered.
//
//   node --experimental-strip-types scripts/verify-district-rehydration.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const home = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');

// Isolate the rehydration effect so these assertions cannot be satisfied by unrelated code
// elsewhere in a 1,600-line screen.
const start = home.indexOf('const districtsRehydrated = useRef(false);');
check('district rehydration effect exists (districtsRehydrated guard ref)', start !== -1);
const effect = start === -1 ? '' : home.slice(start, start + 1800);

// ── 1. candidates come from the canonical catalog, keyed on the persisted matchValues ──
check('rehydration reads the same canonical catalog the field picks from (ensureDistrictOptions)',
  /ensureDistrictOptions\(\s*citySelected\.cityId,\s*query\.deal,\s*effCategory,\s*rentPeriodTok,\s*cohortTypes\s*\)/.test(effect));
check('candidates matched on matchValues against the persisted query.districts (no fuzzy matching)',
  effect.includes('query.districts') && /matchValues\.some\(\(v\) => wanted\.has\(v\)\)/.test(effect));

// ── 2. exact set round-trip, both directions — a drifted catalog restores NOTHING ──
check('restored union must have the SAME SIZE as query.districts',
  /union\.size !== wanted\.size/.test(effect) && /return;/.test(effect));
check('every persisted matchValue must be present in the restored union (no partial restore)',
  /for \(const v of wanted\) if \(!union\.has\(v\)\) return;/.test(effect));

// ── 3. once per mount + cancellation, so a city change is permanent ──
check('guarded to run at most once per mount (districtsRehydrated.current short-circuit)',
  /if \(districtsRehydrated\.current \|\| !citySelected\) return;/.test(effect)
  && /districtsRehydrated\.current = true;/.test(effect));
check('in-flight catalog promise is cancelled on city change (stale pick cannot land in a new city)',
  /let cancelled = false;/.test(effect) && /if \(cancelled\) return;/.test(effect)
  && /return \(\) => \{ cancelled = true; \};/.test(effect));
check('effect re-runs on city/deal/category/period change',
  /\}, \[citySelected, query\.deal, effCategory, rentPeriodTok, cohortTypesSig\]\);/.test(effect));

// ── 4. a live user pick is never clobbered ──
check('setDistrictsSelected uses a functional prev-wins update',
  /setDistrictsSelected\(\(prev\) => \(prev\.length \? prev : restored\)\)/.test(effect));
check('a district already picked in this mount short-circuits before any fetch',
  /if \(districtsSelected\.length\) return;/.test(effect));

// ── 5. the thing the bug actually broke: onSearch still sends the picked districts ──
check('onSearch still builds p_districts from districtsSelected matchValues',
  /const districtMatchUnion = districtsSelected\.length/.test(home)
  && home.includes('districts: districtMatchUnion'));

// ── 6. the REHYDRATION SOURCE must actually be populated ──────────────────────────────────────
// First deploy of this fix was a no-op in production and the live retest still showed
// p_districts:null / 266 → 1,255. The effect was in the served bundle and correct; its SOURCE was
// empty. Every other control writes itself into `query` as the user edits it, which is why the
// reopened form comes back with المدينة/السعر/المساحة filled — but the districts lived ONLY in the
// local districtsSelected array and were merged into the query object at search time, then handed
// to navigateWithQuery(), which serialises to the /agent?filter=… URL and never touches the app
// context. So query.districts was always [] on the filter screen and the effect returned at its
// `if (!want.length) return` guard, every time. Persisting them on search is what makes the
// rehydration above observable at all — without this, §1-§4 can all pass while production is
// unchanged, which is exactly what happened.
check('onSearch persists the picked districts into the app context (the rehydration source)',
  /setQuery\(\(prev\) => \(\{[\s\S]{0,200}districts: q\.districts,[\s\S]{0,160}districtLabel: q\.districtLabel,[\s\S]{0,200}\}\)\);\s*\n\s*navigateWithQuery\(q\);/.test(home));
check('the districts are persisted BEFORE navigating (same object that reaches the URL)',
  home.indexOf('districts: q.districts') !== -1
  && home.indexOf('districts: q.districts') < home.lastIndexOf('navigateWithQuery(q);'));

console.log(failed ? `\n${failed} check(s) FAILED` : '\n✓ district rehydration is pinned — reopening «تصفية» can no longer silently widen a حي search');
process.exit(failed ? 1 : 0);
