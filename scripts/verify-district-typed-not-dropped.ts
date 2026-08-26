// Regression guard: a TYPED-but-never-TAPPED district must never be silently discarded (2026-08-23).
//
// The bug (live-proven against https://ezhalah-app.vercel.app, browser E2E):
//   Buy · سكني · tap «الرياض» · tap «أي حي؟» · type «النرجس» → the dropdown offers
//   «حي النرجس · 1,699 إعلان» → press «بحث» WITHOUT tapping that row (exactly what a user does who
//   assumes typing filters) → the search runs CITY-WIDE: «لقينا 36,908 إعلان», ملخص البحث has no
//   «• الحي» line, [data-testid="district-chip"] is empty, and the district field STILL READS
//   «النرجس». Not one word anywhere says the neighbourhood was dropped.
// Root cause: the district box is a SEARCH box over the catalog — only a tapped suggestion becomes a
// chip in districtsSelected, and onSearch builds p_districts from that array alone. districtText was
// read by nothing at search time, so onSearch fell straight through to navigateWithQuery() with the
// user's visible neighbourhood nowhere in the request. Confirmed client-side: the app's own captured
// RPC body for that run carries p_districts:null.
//
// This is the CITY field's rule (verify-city-field.ts / CITY_REQUIRED_MSG: hand-typed text never
// confirmed by a tap blocks the search with an explanation) missing from its optional sibling.
// Resolving the text FOR the user is not an option here — this screen never guesses a location
// (owner rule: EXACT LOCATION ONLY) — so Search must stop and name the two honest outcomes: tap the
// district, or clear the text and search the whole city.
//
// Owner rule pinned: VISIBLE UI STATE MUST EQUAL COMMITTED REQUEST STATE — never show the user a
// filter in the form while silently searching without it.
//
//   node --experimental-strip-types scripts/verify-district-typed-not-dropped.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexSrc = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
const i18nSrc = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// Isolate onSearch — from its declaration to the navigation call it ends with — so nothing else in
// this 1,900-line screen can accidentally satisfy the assertions below.
const start = indexSrc.indexOf('const onSearch = async () => {');
check('onSearch exists', start !== -1);
const navAt = indexSrc.indexOf('navigateWithQuery(q);', start);
check('onSearch ends by navigating to the results', navAt > start);
const onSearch = start === -1 || navAt === -1 ? '' : indexSrc.slice(start, navAt);

// ── 1. THE GUARD: unconfirmed typed district text stops the search ─────────────────────────────
// districtText is only ever set by the user typing (onChangeText); every confirm/clear path
// (suggestion tap, ✕, clearDistrict) wipes it — so a non-empty value here means exactly one thing:
// the field is showing a neighbourhood the request does not carry.
const guard = /if \(districtText\.trim\(\)\) \{[\s\S]{0,400}?\n\s*return;\n\s*\}/.exec(onSearch);
check('onSearch blocks on typed-but-unconfirmed district text (districtText.trim() guard)', guard !== null);
const guardBody = guard?.[0] ?? '';
check('the guard RETURNS instead of falling through to the search', /\n\s*return;\n/.test(guardBody));
check('the guard runs BEFORE the query is built and navigated',
  guard !== null && onSearch.indexOf(guardBody) < onSearch.indexOf('const base = buildFilterBaseQuery()!'));

// ── 2. IT MUST SAY SO — silence is the defect ──────────────────────────────────────────────────
check('the guard shows the user a message (setDistrictMsg)', /setDistrictMsg\(DISTRICT_UNCONFIRMED_MSG\)/.test(guardBody));
check('the guard brings the district field into view and focuses it',
  /scrollDown\(districtAnchorRef\)/.test(guardBody) && /districtRef\.current\?\.focus\(\)/.test(guardBody));
check('the message is rendered under the district field (districtMsg is on screen)',
  /\{districtMsg \?/.test(indexSrc));

// ── 3. THE MESSAGE ITSELF: Arabic, in i18n, and it names BOTH honest ways out ───────────────────
const msg = /export const DISTRICT_UNCONFIRMED_MSG = '([^']+)';/.exec(i18nSrc);
check('DISTRICT_UNCONFIRMED_MSG is defined in src/i18n.tsx', msg !== null);
const text = msg?.[1] ?? '';
check('the message is Arabic (product language)', /[؀-ۿ]/.test(text) && !/[A-Za-z]/.test(text));
check('the message tells the user to pick the district from the list', text.includes('اختيار الحي'));
check('the message tells the user the other way out — clear the text, search the whole city',
  text.includes('مسح النص') && text.includes('المدينة'));
check('src/app/index.tsx imports the message from i18n (no duplicated literal)',
  /import \{[^}]*DISTRICT_UNCONFIRMED_MSG[^}]*\} from '@\/i18n'/.test(indexSrc));

// ── 4. THE GUARD MUST STAY CLEARABLE — it can never become a dead end ──────────────────────────
// If districtMsg could not be cleared, a user who typed something unmatchable would be stuck with a
// blocked Search forever. Every path that empties districtText must also drop the message.
check('typing again clears the message (onChangeText resets districtMsg)',
  /setDistrictMsg\(latin \? ARABIC_ONLY_MSG : ''\)/.test(indexSrc));
check('the ✕ that clears the typed text also clears the message and the block',
  /districtTextRef\.current = '';\s*\n\s*setDistrictText\(''\);\s*\n\s*setDistrictMsg\(''\);/.test(indexSrc));
check('tapping a suggestion clears the typed text (so the guard cannot block a confirmed pick)',
  /toggleDistrict\(opt\);\s*\n\s*districtTextRef\.current = '';\s*\n\s*setDistrictText\(''\);\s*\n\s*setDistrictMsg\(''\);/.test(indexSrc));
check('clearDistrict wipes text + picks + message together', /const clearDistrict = \(\) => \{[\s\S]{0,320}?setDistrictMsg\(''\);/.test(indexSrc));

// ── 5. THE FIX MUST NOT HAVE BECOME A GUESS ────────────────────────────────────────────────────
// EXACT LOCATION ONLY: the typed string must never be resolved into a district by the app. Only a
// tapped catalog row (districtsSelected) may reach p_districts.
check('the search still sends ONLY tapped catalog picks (districtsSelected → matchValues union)',
  /const districtMatchUnion = districtsSelected\.length/.test(onSearch)
  && /new Set\(districtsSelected\.flatMap\(\(d\) => d\.matchValues\)\)/.test(onSearch));
check('districtText is never sent as a search value',
  !/districts: [^\n]*districtText/.test(indexSrc) && !/districtLabel: [^\n]*districtText/.test(indexSrc));

console.log(failed
  ? `\n${failed} check(s) FAILED`
  : '\n✓ a typed-but-untapped حي can no longer be dropped in silence — «بحث» stops and says so');
process.exit(failed ? 1 : 0);
