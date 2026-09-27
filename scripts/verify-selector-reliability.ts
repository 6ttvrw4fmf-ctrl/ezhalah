// Static invariant checks for the City/District selector's OPEN RELIABILITY (findings 2026-08-13,
// P1–P7). Mirrors verify-district-field.ts: greps the shipped source so the load-bearing fixes
// can't silently regress. The contract: ONE tap on a selector field always opens SOMETHING — the
// list, or a single muted Arabic status row (loading / tap-to-retry / no-match) — and the district
// multi-select list genuinely stays open across picks.
//
//   node --experimental-strip-types scripts/verify-selector-reliability.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { windowBetween } from './lib/sourceWindow.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexSrc = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
const uiSrc = readFileSync(join(root, 'src/components/ui.tsx'), 'utf8');
const i18nSrc = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
const locSrc = readFileSync(join(root, 'src/data/locations.ts'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── P3: the 150ms close-on-blur timers are STORED and cancelled — never fire-and-forget. An
//    uncancelled timer from a blur-then-quick-refocus closed the dropdown while the input stayed
//    focused, after which NO tap could reopen it (no focus event fires on a focused input). ──
check('city + district blur timers live in refs', /const cityBlurTimer = useRef<ReturnType<typeof setTimeout> \| null>\(null\)/.test(indexSrc) && /const districtBlurTimer = useRef<ReturnType<typeof setTimeout> \| null>\(null\)/.test(indexSrc));
check('onBlur STORES the timer id (city)', /onBlur=\{\(\) => \{ cityBlurTimer\.current = setTimeout\(\(\) => setCityFocus\(false\), 150\); \}\}/.test(indexSrc));
check('onBlur STORES the timer id (district)', /onBlur=\{\(\) => \{ districtBlurTimer\.current = setTimeout\(\(\) => setDistrictFocus\(false\), 150\); \}\}/.test(indexSrc));
// STRUCTURALLY LOCATED, not located by prose (routine #10, 2026-09-27, ops_incident #727).
// These two read `/clearBlurTimer\(cityBlurTimer\); \/\/ P3/` — the `// P3` TAG was the only thing
// telling the onFocus call from the other three `clearBlurTimer(cityBlurTimer)` calls in this file
// (the unmount cleanup at :198, cityOnPress at :811, the row press at :1515). A tag is prose: drop
// «P3» while renumbering the audit, and the check goes RED over code that never moved. Worse, it can
// only ever be green because one exact line survives — ops_incident #727's shape exactly.
//
// The property is «a refocus cancels the pending close BEFORE the focus state is set», and what makes
// it true is POSITION inside the handler. So window the handler and read its prologue. Strictly
// stronger than the tag pin: it additionally catches the call being moved AFTER setCityFocus(true)
// (where the 150ms timer would already have won the race) and any statement being slipped in between —
// neither of which the old text pin could see. windowBetween() THROWS on a marker that moved, so a
// rename is a loud red naming the marker, never a silently widened window (AGENTS.md R4).
const statements = (w: string): string[] => w.split('\n')
  .map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean);
/** Everything the handler runs before it commits the focus state. */
const focusPrologue = (field: 'city' | 'district'): string[] => {
  const setter = field === 'city' ? 'setCityFocus(true);' : 'setDistrictFocus(true);';
  const w = windowBetween(indexSrc, `testID="${field}-input"`, setter, `src/app/index.tsx ${field} onFocus`);
  const at = w.indexOf('onFocus={() => {');
  if (at < 0) throw new Error(`${field} onFocus handler moved out of the field's own props`);
  return statements(w.slice(at + 'onFocus={() => {'.length));
};
check('city onFocus cancels a pending close FIRST — nothing runs before it, and it is not after setCityFocus',
  JSON.stringify(focusPrologue('city')) === JSON.stringify(['clearBlurTimer(cityBlurTimer);']));
check('district onFocus cancels a pending close, after its own citySelected guard and before setDistrictFocus',
  JSON.stringify(focusPrologue('district'))
    === JSON.stringify(['if (!citySelected) return;', 'clearBlurTimer(districtBlurTimer);']));
check('city suggestion-row press cancels the timer (cityOnPress)', /const cityOnPress = \(opt: CityOption\) => \{\s*clearBlurTimer\(cityBlurTimer\);/.test(indexSrc));
check('timers cleared on unmount', /useEffect\(\(\) => \(\) => \{ clearBlurTimer\(cityBlurTimer\); clearBlurTimer\(districtBlurTimer\); \}, \[\]\)/.test(indexSrc));
check('the 150ms delay itself is unchanged (no new delays, no removed debounce)', (indexSrc.match(/setTimeout\(\(\) => set(?:City|District)Focus\(false\), 150\)/g) || []).length === 2);

// ── P4: the district multi-select list must GENUINELY stay open across picks — the code comment
//    always claimed it; the row press blurs the input on web, so the pick handler has to cancel
//    the armed close timer and put focus straight back. ──
check('districtOnPress cancels the close timer and REFOCUSES the input', /const districtOnPress = \(opt: DistrictOption\) => \{\s*clearBlurTimer\(districtBlurTimer\);\s*districtRef\.current\?\.focus\(\);/.test(indexSrc));

// ── P2: focusing a field that already holds text populates its matches from the cache — a tap on a
//    prefilled field (returning from /agent, or mid-typing refocus) must never open an empty box. ──
// Distance ceiling raised 2400→3600 2026-09-13 for the same reason as verify-city-field.ts's own
// bump: the legitimate iOS scrollIntoView block added at the top of this onFocus handler took the
// distance to the `} else {` branch past the arbitrary window. Assertion unchanged.
check('city onFocus with existing text runs the match immediately (cohort-typed)', /onFocus=\{\(\) => \{[\s\S]{0,3600}?\} else \{[\s\S]{0,700}?if \(!isLatinOnlyInput\(query\.location\)\) \{\s*setCitySuggestions\(matchCitiesByText\(effDeal, rentPeriodTok, effCategory, query\.location, cohortTypes, cityAfParams\)\);/.test(indexSrc));
check('district onFocus with existing text runs the match immediately (cohort-typed)', /\} else if \(!isLatinOnlyInput\(districtTextRef\.current\)\) \{[\s\S]{0,300}?setDistrictSuggestions\(matchDistrictsByCityId\(citySelected\.cityId, effDeal, effCategory, rentPeriodTok, districtTextRef\.current, cohortTypes, cityTableScope\)\);/.test(indexSrc));

// ── P1 + zero-states A/C/D/E/F/H: the dropdown gates open on loading/error/empty too — an empty
//    suggestion list is never an invisible box again. ──
check('city dropdown gate includes the zero-state branch', /<DropdownReveal visible=\{cityFocus && \(citySuggestions\.length > 0 \|\| cityZeroRow != null\)\}>/.test(indexSrc));
check('district dropdown gate includes the zero-state branch', /<DropdownReveal visible=\{citySelected != null && districtFocus && \(districtSuggestions\.length > 0 \|\| districtZeroRow != null\)\}>/.test(indexSrc));
// RE-POINTED 2026-09-23 (routine #8, ops_incident #648). Both dropdowns now derive their zero-row
// through ONE shared `zeroRowFor`, so the two orderings cannot drift apart — and the STATUS test now
// runs BEFORE the length test, because a non-empty list is not evidence that THIS cohort has loaded:
// nothing clears the list when the pool key changes, so rows already on screen belong to the cohort
// the user left. Observed on production that day, فيلا selected with its pool still loading: six
// city rows with the previous cohort's counts, no loading row, no error row. Both assertions below
// are unchanged in substance and now also pin that both call sites really go through the one rule.
// (verify-suggestion-writes-carry-their-cohort.ts §D EXECUTES the predicate and mutation-proves it.)
check('zero-row derives loading/error from the pool status, empty only when settled',
  /:\s*status !== 'ready' \? status/.test(indexSrc)
  && /const cityZeroRow = zeroRowFor\(cityLatin, cityStatus, citySuggestions\.length,/.test(indexSrc)
  && /zeroRowFor\(districtLatin, districtStatus, districtSuggestions\.length,/.test(indexSrc));
check('English typing keeps its OWN message path (zero-row excluded on latin input)',
  /\n    latin \? null\n/.test(indexSrc)
  && /zeroRowFor\(cityLatin,/.test(indexSrc) && /zeroRowFor\(districtLatin,/.test(indexSrc));
check('the error row taps into a real retry (re-ensure, box kept open via refocus)', /const retryCityPool = \(\) => \{\s*clearBlurTimer\(cityBlurTimer\);\s*cityRef\.current\?\.focus\(\);/.test(indexSrc) && /const retryDistrictPool = \(\) => \{/.test(indexSrc) && /onPress=\{retryCityPool\}/.test(indexSrc) && /onPress=\{retryDistrictPool\}/.test(indexSrc));

// locations.ts must EXPORT the pool status (keep the silent-[] catch, but record what happened).
check('locations.ts exports cityPoolStatus/districtPoolStatus', /export function cityPoolStatus/.test(locSrc) && /export function districtPoolStatus/.test(locSrc));
check('a settled failure records error AND evicts the promise (retry actually refetches)', (locSrc.match(/_cityPoolStatus\.set\(key, 'error'\);\s*\n\s*_cityFieldPromises\.delete\(key\)/g) || []).length >= 2 && (locSrc.match(/_districtPoolStatus\.set\(key, 'error'\)/g) || []).length >= 3);

// The 4 zero-state strings exist in the AR dict and are Arabic (no Latin leak).
for (const key of ['Loading…', 'Could not load the list — tap to retry', 'No matching city — pick from the list', 'No districts available in this city right now']) {
  const m = i18nSrc.match(new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}': '([^']+)'`));
  check(`AR dict has «${key}» with an Arabic, Latin-free value`, !!m && /[؀-ۿ]/.test(m![1]) && !/[A-Za-z]/.test(m![1]));
}

// ── P6: DropdownReveal's unmount is DRIVEN by runAfterAnimation (PR#341/#346 pattern) — the
//    animation is decoration, the unmount is the function; a frozen rAF can no longer strand a
//    ghost box in hidden tabs. Durations unchanged. ──
check('ui.tsx imports runAfterAnimation', /import \{ runAfterAnimation \} from '@\/lib\/afterAnimation'/.test(uiSrc));
check('DropdownReveal close hand-off rides runAfterAnimation with a timer fallback', /runAfterAnimation\(\s*\(onFinished\) => \{[\s\S]{0,400}?DROPDOWN_CLOSE[\s\S]{0,200}?runOnJS\(onFinished\)\(\);[\s\S]{0,300}?\(\) => \{ if \(gen === closeGen\.current\) setMounted\(false\); \},\s*200,/.test(uiSrc));
// Same conversion: this pinned `/closeGen\.current\+\+; \/\/ cancel any in-flight close hand-off/`,
// where the comment was the locator. The property is that the VISIBLE branch bumps the generation
// BEFORE it mounts — a bump after setMounted(true) would not invalidate the in-flight hand-off in time.
check('a reopen cancels the pending unmount (generation guard) — bumped in the visible branch, before setMounted',
  statements(windowBetween(uiSrc, 'useEffect(() => {\n    if (visible) {', 'setMounted(true);',
    'src/components/ui.tsx DropdownReveal visible branch')).includes('closeGen.current++;'));
check('open/close durations untouched (180/150)', /DROPDOWN_OPEN = \{ duration: 180/.test(uiSrc) && /DROPDOWN_CLOSE = \{ duration: 150/.test(uiSrc));

// ── P7: tapping the disabled district field lands the user in the CITY field (the unlocking step);
//    the opacity + placeholder signals stay. ──
check('disabled district tap focuses the city field', /if \(citySelected\) districtRef\.current\?\.focus\(\); else cityRef\.current\?\.focus\(\);/.test(indexSrc));
check('disabled visuals stay (0.5 opacity + «اختر المدينة أولاً» placeholder)', /!citySelected && \{ opacity: 0\.5 \}/.test(indexSrc) && /placeholder=\{citySelected \? '' : t\('Select a city first'\)\}/.test(indexSrc));

// E2E hooks the barrier drives (RNW maps testID → data-testid).
check('stable testIDs exist for the E2E barrier', ['testID="city-input"', 'testID="district-input"', 'testID="selected-city-visual"', 'testID="district-chip"'].every((s) => indexSrc.includes(s)) && readFileSync(join(root, 'src/components/TrendingList.tsx'), 'utf8').includes('testID="trending-row"'));

// ── MUTATION PROOF (routine #10, 2026-09-27) ─────────────────────────────────────────────────────
//
// This file was on scripts/mutation-proof-grandfathered.txt — a barrier nobody had ever watched fail.
// The three converted assertions above are proven here in BOTH directions, over a broken copy of the
// REAL shipped file (never a fixture this check invented: docs/ops/BARRIER_ENGINEER.md R1 step 5,
// "a proof that supplies its own input proves nothing").
console.log('\n  mutation proof — each converted guard must FAIL on its own defect, and NOT on health\n');

let mutFail = 0;
const mustCatch = (defect: string, caught: boolean) => {
  if (caught) { console.log(`  ✓ catches: ${defect}`); return; }
  mutFail++;
  console.error(`  ✗ BLIND to: ${defect}`);
};
/** The prologue verdict against a mutated copy of index.tsx — the same function, different input. */
const prologueOf = (src: string, field: 'city' | 'district'): string[] => {
  const setter = field === 'city' ? 'setCityFocus(true);' : 'setDistrictFocus(true);';
  const w = windowBetween(src, `testID="${field}-input"`, setter, 'mutant');
  const at = w.indexOf('onFocus={() => {');
  if (at < 0) throw new Error('handler moved');
  return statements(w.slice(at + 'onFocus={() => {'.length));
};
const cityOk = (src: string) => {
  try { return JSON.stringify(prologueOf(src, 'city')) === JSON.stringify(['clearBlurTimer(cityBlurTimer);']); }
  catch { return false; }   // a marker that moved is a RED, not a pass — fail closed
};

// The healthy control first: a predicate red for everything proves nothing.
mustCatch('…while the REAL shipped tree is NOT flagged (the prologue verdict is not vacuously red)',
  cityOk(indexSrc) === true);

// Find the shipped line by POSITION, never by its `// P3` tag — a proof that depends on prose is no
// better than the assertion it replaced.
const cityLine = (() => {
  const at = indexSrc.indexOf('clearBlurTimer(cityBlurTimer);',
    indexSrc.indexOf('testID="city-input"'));
  return indexSrc.slice(indexSrc.lastIndexOf('\n', at) + 1, indexSrc.indexOf('\n', at));
})();

mustCatch('the city refocus losing its clearBlurTimer entirely (the P3 dropdown-cannot-reopen bug)',
  !cityOk(indexSrc.replace(`${cityLine}\n`, '')));
mustCatch('the cancel moved AFTER setCityFocus(true), where the 150ms close timer has already won',
  !cityOk(indexSrc.replace(`${cityLine}\n`, '')
    .replace('                    setCityFocus(true);', `                    setCityFocus(true);\n${cityLine}`)));
mustCatch('a statement slipped in BEFORE the cancel, so the close is no longer cancelled FIRST',
  !cityOk(indexSrc.replace(cityLine, `                    logFocus('city');\n${cityLine}`)));
mustCatch('the district guard being dropped, so a locked field opens its dropdown',
  (() => { try {
    const m = indexSrc.replace('                    if (!citySelected) return;\n', '');
    return JSON.stringify(prologueOf(m, 'district'))
      !== JSON.stringify(['if (!citySelected) return;', 'clearBlurTimer(districtBlurTimer);']);
  } catch { return true; } })());
mustCatch('the city field being renamed out from under the window — a moved marker is a loud red, never a silent pass',
  !cityOk(indexSrc.replace('testID="city-input"', 'testID="location-input"')));
mustCatch('the generation bump moved BELOW setMounted(true), where it cannot invalidate the in-flight hand-off',
  (() => { try {
    const m = uiSrc.replace('      closeGen.current++; // cancel any in-flight close hand-off\n', '')
      .replace('      setMounted(true);', '      setMounted(true);\n      closeGen.current++;');
    return !statements(windowBetween(m, 'useEffect(() => {\n    if (visible) {', 'setMounted(true);', 'mutant'))
      .includes('closeGen.current++;');
  } catch { return true; } })());
// …and the control this conversion exists for: a COMMENT-ONLY edit no longer moves any verdict. The
// old predicates required the literal tags `// P3` and `// cancel any in-flight close hand-off`.
mustCatch('…while renumbering the `// P3` audit tag out of the product is NOT flagged (the false RED is gone)',
  cityOk(indexSrc.replace('// P3: a pending close from a just-blurred state must not outlive the refocus',
                          '// a pending close from a just-blurred state must not outlive the refocus'))
  && statements(windowBetween(
      uiSrc.replace('// cancel any in-flight close hand-off', '// drop any close still in flight'),
      'useEffect(() => {\n    if (visible) {', 'setMounted(true);', 'control')).includes('closeGen.current++;'));

if (mutFail > 0) { console.error(`\n✗ ${mutFail} mutation(s) went UNCAUGHT\n`); process.exit(1); }
console.log(failed === 0 ? '\n✓ all selector-reliability assertions passed' : `\n✗ ${failed} selector-reliability assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
