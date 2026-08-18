// Static invariant checks for the City/District selector's OPEN RELIABILITY (findings 2026-08-13,
// P1–P7). Mirrors verify-district-field.ts: greps the shipped source so the load-bearing fixes
// can't silently regress. The contract: ONE tap on a selector field always opens SOMETHING — the
// list, or a single muted Arabic status row (loading / tap-to-retry / no-match) — and the district
// multi-select list genuinely stays open across picks.
//
//   node --experimental-strip-types scripts/verify-selector-reliability.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
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
check('city onFocus cancels a pending close FIRST', /clearBlurTimer\(cityBlurTimer\); \/\/ P3/.test(indexSrc));
check('district onFocus cancels a pending close', /clearBlurTimer\(districtBlurTimer\); \/\/ P3/.test(indexSrc));
check('city suggestion-row press cancels the timer (cityOnPress)', /const cityOnPress = \(opt: CityOption\) => \{\s*clearBlurTimer\(cityBlurTimer\);/.test(indexSrc));
check('timers cleared on unmount', /useEffect\(\(\) => \(\) => \{ clearBlurTimer\(cityBlurTimer\); clearBlurTimer\(districtBlurTimer\); \}, \[\]\)/.test(indexSrc));
check('the 150ms delay itself is unchanged (no new delays, no removed debounce)', (indexSrc.match(/setTimeout\(\(\) => set(?:City|District)Focus\(false\), 150\)/g) || []).length === 2);

// ── P4: the district multi-select list must GENUINELY stay open across picks — the code comment
//    always claimed it; the row press blurs the input on web, so the pick handler has to cancel
//    the armed close timer and put focus straight back. ──
check('districtOnPress cancels the close timer and REFOCUSES the input', /const districtOnPress = \(opt: DistrictOption\) => \{\s*clearBlurTimer\(districtBlurTimer\);\s*districtRef\.current\?\.focus\(\);/.test(indexSrc));

// ── P2: focusing a field that already holds text populates its matches from the cache — a tap on a
//    prefilled field (returning from /agent, or mid-typing refocus) must never open an empty box. ──
check('city onFocus with existing text runs the match immediately (cohort-typed)', /onFocus=\{\(\) => \{[\s\S]{0,2400}?\} else \{[\s\S]{0,700}?if \(!isLatinOnlyInput\(query\.location\)\) \{\s*setCitySuggestions\(matchCitiesByText\(query\.deal, rentPeriodTok, effCategory, query\.location, cohortTypes\)\);/.test(indexSrc));
check('district onFocus with existing text runs the match immediately (cohort-typed)', /\} else if \(!isLatinOnlyInput\(districtTextRef\.current\)\) \{[\s\S]{0,300}?setDistrictSuggestions\(matchDistrictsByCityId\(citySelected\.cityId, query\.deal, effCategory, rentPeriodTok, districtTextRef\.current, cohortTypes\)\);/.test(indexSrc));

// ── P1 + zero-states A/C/D/E/F/H: the dropdown gates open on loading/error/empty too — an empty
//    suggestion list is never an invisible box again. ──
check('city dropdown gate includes the zero-state branch', /<DropdownReveal visible=\{cityFocus && \(citySuggestions\.length > 0 \|\| cityZeroRow != null\)\}>/.test(indexSrc));
check('district dropdown gate includes the zero-state branch', /<DropdownReveal visible=\{citySelected != null && districtFocus && \(districtSuggestions\.length > 0 \|\| districtZeroRow != null\)\}>/.test(indexSrc));
check('zero-row derives loading/error from the pool status, empty only when settled', /cityStatus !== 'ready' \? cityStatus/.test(indexSrc) && /districtStatus !== 'ready' \? districtStatus/.test(indexSrc));
check('English typing keeps its OWN message path (zero-row excluded on latin input)', /citySuggestions\.length > 0 \|\| cityLatin \? null/.test(indexSrc) && /districtSuggestions\.length > 0 \|\| districtLatin \? null/.test(indexSrc));
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
check('a reopen cancels the pending unmount (generation guard)', /closeGen\.current\+\+; \/\/ cancel any in-flight close hand-off/.test(uiSrc));
check('open/close durations untouched (180/150)', /DROPDOWN_OPEN = \{ duration: 180/.test(uiSrc) && /DROPDOWN_CLOSE = \{ duration: 150/.test(uiSrc));

// ── P7: tapping the disabled district field lands the user in the CITY field (the unlocking step);
//    the opacity + placeholder signals stay. ──
check('disabled district tap focuses the city field', /if \(citySelected\) districtRef\.current\?\.focus\(\); else cityRef\.current\?\.focus\(\);/.test(indexSrc));
check('disabled visuals stay (0.5 opacity + «اختر المدينة أولاً» placeholder)', /!citySelected && \{ opacity: 0\.5 \}/.test(indexSrc) && /placeholder=\{citySelected \? '' : t\('Select a city first'\)\}/.test(indexSrc));

// E2E hooks the barrier drives (RNW maps testID → data-testid).
check('stable testIDs exist for the E2E barrier', ['testID="city-input"', 'testID="district-input"', 'testID="selected-city-visual"', 'testID="district-chip"'].every((s) => indexSrc.includes(s)) && readFileSync(join(root, 'src/components/TrendingList.tsx'), 'utf8').includes('testID="trending-row"'));

console.log(failed === 0 ? '\n✓ all selector-reliability assertions passed' : `\n✗ ${failed} selector-reliability assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
