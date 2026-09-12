// Automated tests — the two sibling English-leak gaps found by the 2026-07-13 independent
// adversarial re-verification pass, after the original city-leak fix:
//
// 1. src/app/interview.tsx's guided-interview "Something else" custom answer had no Arabic-only
//    input guard (unlike src/app/index.tsx / src/app/agent.tsx), so a custom-typed English answer
//    (city/neighborhood/category/type/amenity) flowed unvalidated into t()/tWord() calls and leaked
//    raw English into the Arabic UI — and further downstream, into src/data/search.ts's
//    whatText()/searchSummary()/querySummaryLine(), which had NO guard on the property-type side
//    (only the location side was ever guarded via arabicOrUnresolved()).
// 2. scrapers/wasalt/run.py's deep-fetch backfill stores Wasalt's own raw attribute LABEL text
//    verbatim (unlike every sibling additional-info source, which only emits a small fixed,
//    AR{}-translated set), and src/components/ResultCard.tsx's AdditionalInformationPanel rendered
//    that label via a bare t(r.label) with no guard — the VALUE on the same row was only guarded
//    for its finite ENUM set (arAttrValue()'s property-usage/furniture/floor/facade/age/yes-no
//    maps); free-text values (street address, "other obligations", ad source, plan/land numbers)
//    were explicitly left raw by design ("never translate real source content").
// 3. A THIRD sibling gap (found 2026-07-16, owner report): abeea.com.sa's additional_info stores
//    `street_address` in English (e.g. "42 Faris Al Sharqiyah Compound, Al Osool Street") —
//    legitimate free-text per fix #2's design, but with no non-Arabic DETECTION layer, so an
//    English address leaked straight onto an otherwise-Arabic card. A blanket arabicOrPlaceholder
//    would wrongly blank legitimate non-Arabic free text that has NO Latin letters either (plan
//    numbers, land numbers, ad-source IDs — pure digits/codes), so this needed a new primitive,
//    arabicOrPlaceholderForFreeText(), that only flags text with an actual Latin LETTER and no
//    Arabic character as a leak, leaving numeric/code free-text and genuine Arabic free-text alone.
//
// All three fixes reuse the SAME zero-dependency arabicOrPlaceholder() family (src/lib/arabicText.ts,
// already proven directly executable — see scripts/verify-arabic-summary-fallback.ts), composed with
// a new placeholder constant per case (TYPE_UNRESOLVED_AR, ATTRIBUTE_UNRESOLVED_AR — both in
// src/i18n.tsx, which can't be live-imported here for the same reason as always: heavy React
// Native / Reanimated imports). So this test: (a) genuinely executes arabicOrPlaceholder with the
// exact literal placeholder values (proving the composition is correct), and (b) does a lightweight
// source-text check that the guard call sites actually exist, and that isLatinOnlyInput/ARABIC_ONLY_MSG
// are actually imported and used in interview.tsx (the input-side half of fix #1).
//
//   node --experimental-strip-types scripts/verify-type-and-attribute-fallback.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { arabicOrPlaceholder, arabicOrPlaceholderForFreeText, hasArabicChar, hasLatinLetter } from '../src/lib/arabicText.ts';

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

// These literal values must stay in sync with src/i18n.tsx's exported constants — checked below via
// a source-text assertion, so a drift between the two is caught rather than silently passing.
const TYPE_UNRESOLVED_AR = 'نوع غير محدد';
const ATTRIBUTE_UNRESOLVED_AR = 'بيان غير محدد';

// ── REAL, EXECUTED composition tests (the shared primitive both fixes rely on) ─────────────────────
eq('a custom interview type ("Penthouse", not in AR{}) becomes the type placeholder, not raw English', arabicOrPlaceholder('Penthouse', 'ar', TYPE_UNRESOLVED_AR), TYPE_UNRESOLVED_AR);
eq('a real, already-translated type word passes through unchanged', arabicOrPlaceholder('فيلا', 'ar', TYPE_UNRESOLVED_AR), 'فيلا');
eq('a Wasalt attribute label that misses the AR{} dict becomes the attribute placeholder, not raw English', arabicOrPlaceholder('Some Unmapped Label', 'ar', ATTRIBUTE_UNRESOLVED_AR), ATTRIBUTE_UNRESOLVED_AR);
eq('a real, already-translated attribute label passes through unchanged', arabicOrPlaceholder('الواجهة', 'ar', ATTRIBUTE_UNRESOLVED_AR), 'الواجهة');
check('both new placeholders are themselves genuinely Arabic (would be a no-op leak-guard otherwise)', hasArabicChar(TYPE_UNRESOLVED_AR) && hasArabicChar(ATTRIBUTE_UNRESOLVED_AR));

// ── Fix #3 (2026-07-16): arabicOrPlaceholderForFreeText — real abeea.com.sa leak + numeric-code safety ──
check('hasLatinLetter finds a Latin letter in an English street address', hasLatinLetter('42 Faris Al Sharqiyah Compound, Al Osool Street'));
check('hasLatinLetter is false for a pure-digit plan number', !hasLatinLetter('4471'));
check('hasLatinLetter is false for an alphanumeric-but-Latin-letter-free code (digits/punctuation only)', !hasLatinLetter('12-3456'));
eq(
  'the exact live abeea.com.sa English street_address leak becomes the attribute placeholder',
  arabicOrPlaceholderForFreeText('42 Faris Al Sharqiyah Compound, Al Osool Street', 'ar', ATTRIBUTE_UNRESOLVED_AR),
  ATTRIBUTE_UNRESOLVED_AR,
);
eq('a real Arabic free-text value (e.g. a street name) passes through unchanged', arabicOrPlaceholderForFreeText('شارع الأمير سلطان', 'ar', ATTRIBUTE_UNRESOLVED_AR), 'شارع الأمير سلطان');
eq('a pure numeric plan/land number passes through unchanged (not a language leak)', arabicOrPlaceholderForFreeText('4471', 'ar', ATTRIBUTE_UNRESOLVED_AR), '4471');
eq('empty string is a no-op', arabicOrPlaceholderForFreeText('', 'ar', ATTRIBUTE_UNRESOLVED_AR), '');
eq('non-Arabic locale is a no-op (English address is correct there, not a leak)', arabicOrPlaceholderForFreeText('42 Faris Al Sharqiyah Compound', 'en', ATTRIBUTE_UNRESOLVED_AR), '42 Faris Al Sharqiyah Compound');
// The primitive itself CANNOT distinguish a real English sentence from a letter-containing ID code
// (e.g. "FAL1234567") — by design, it flags any Latin-letter/no-Arabic text. That's why the call
// site (arAttrValue, checked via source-text below) scopes it to ONLY the "address" label, never to
// license/plan/parcel/postal-code labels — this asserts the primitive's raw (unscoped) behavior:
eq('the raw primitive treats a letter-containing code the same as prose (scoping happens at the call site, not here)', arabicOrPlaceholderForFreeText('FAL1234567', 'ar', ATTRIBUTE_UNRESOLVED_AR), ATTRIBUTE_UNRESOLVED_AR);

// ── Source-text checks for the parts that can't be live-imported (heavy RN/search.ts deps) ─────────
const stripWs = (s: string) => s.replace(/\s+/g, '');

// Note: stripWs strips whitespace INSIDE string literals too (e.g. 'نوع غير محدد' → 'نوعغيرمحدد') —
// harmless as long as both sides of a comparison go through the same transform, which they do here.
const I18N_TS = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');
check(
  "i18n.tsx's TYPE_UNRESOLVED_AR literal matches what this test asserts against",
  stripWs(I18N_TS).includes(stripWs(`export const TYPE_UNRESOLVED_AR = '${TYPE_UNRESOLVED_AR}';`)),
);
check(
  "i18n.tsx's ATTRIBUTE_UNRESOLVED_AR literal matches what this test asserts against",
  stripWs(I18N_TS).includes(stripWs(`export const ATTRIBUTE_UNRESOLVED_AR = '${ATTRIBUTE_UNRESOLVED_AR}';`)),
);

const INTERVIEW_TS = readFileSync(new URL('../src/app/interview.tsx', import.meta.url), 'utf8');
const INTERVIEW_NOWS = stripWs(INTERVIEW_TS);
check(
  'interview.tsx imports the Arabic-only input guard (isLatinOnlyInput, ARABIC_ONLY_MSG) from @/i18n',
  /import\{[^}]*isLatinOnlyInput[^}]*ARABIC_ONLY_MSG[^}]*\}from'@\/i18n'/.test(INTERVIEW_NOWS),
);
check(
  "interview.tsx's goNext() rejects a Latin-only custom answer before calling answer()",
  INTERVIEW_NOWS.includes("if(isLatinOnlyInput(customVal.trim())){setCustomErr(ARABIC_ONLY_MSG);return;}"),
);
// 2026-07-13 integration-gap fix: the pre-existing "isn't a city I recognize, I'll still search"
// note and the new Arabic-only rejection note must never render stacked/simultaneously — the old
// note's promise ("I'll still search") is false the instant goNext() has just rejected the answer.
check(
  "interview.tsx suppresses the cityUnknown note while customErr is showing (the two notes never stack)",
  INTERVIEW_NOWS.includes('{cityUnknown&&!customErr?'),
);

const SEARCH_TS = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');
const SEARCH_NOWS = stripWs(SEARCH_TS);
check(
  'search.ts defines arabicOrTypeUnresolved() (the property-type sibling of arabicOrUnresolved())',
  SEARCH_NOWS.includes('functionarabicOrTypeUnresolved(s:string):string{returnarabicOrPlaceholder(s,getLocale(),TYPE_UNRESOLVED_AR);}'),
);
check(
  'whatText() wraps its tWord() result in arabicOrTypeUnresolved()',
  SEARCH_NOWS.includes("constwhatText=(q:SearchQuery)=>arabicOrTypeUnresolved(tWord(q.type??q.category??'Property'));"),
);
// No new *unwrapped* tWord(q.type...)/tWord(q.category)/tWord(x) call site feeding a user-facing
// summary/heading line should appear without arabicOrTypeUnresolved on the same line — catches a
// FUTURE sibling leak in this same file, mirroring the tPlace() catch-all in
// scripts/verify-no-english-city-leak.ts.
const bareTypeWordLines = SEARCH_TS
  .split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => /\btWord\(/.test(line))
  .filter(({ line }) => !/arabicOrTypeUnresolved\(/.test(line))
  .filter(({ line }) => !/^\s*(\/\/|const whatText|export function tWord)/.test(line.trim()));
check(
  `no new unwrapped tWord() call sites feeding search.ts's user-facing type text (found: ${bareTypeWordLines.map((l) => l.n).join(', ') || 'none'})`,
  bareTypeWordLines.length === 0,
);

const RESULTCARD_TS = readFileSync(new URL('../src/components/ResultCard.tsx', import.meta.url), 'utf8');
const RESULTCARD_NOWS = stripWs(RESULTCARD_TS);
check(
  "ResultCard.tsx's AdditionalInformationPanel wraps the row label in arabicOrPlaceholder(..., ATTRIBUTE_UNRESOLVED_AR)",
  RESULTCARD_NOWS.includes('arabicOrPlaceholder(t(r.label),locale,ATTRIBUTE_UNRESOLVED_AR)'),
);
check(
  "ResultCard.tsx's row value passes locale into arAttrValue() (needed for the fix #3 leak check)",
  RESULTCARD_NOWS.includes('arAttrValue(r.label,r.value,locale)'),
);
// 2026-07-16 Arabic-only sweep: FREE_TEXT_PROSE_LABELS widened from 'address'-only to every
// genuine prose/status/enum label (defense-in-depth for unmapped future values) — but the code/ID
// labels (license/plan/parcel/postal numbers) must STILL be absent, or a real ID containing a
// Latin letter (e.g. "FAL1234567") would get wrongly blanked. Assert both directions.
const CODE_LABELS_MUST_STAY_EXCLUDED = ['rega ad license number', 'broker fal license', 'parcel number', 'plan number', 'postal code', 'rega license issue date', 'rega license expiry date'];
check(
  'FREE_TEXT_PROSE_LABELS still contains "address" (the original PR#104 case)',
  /FREE_TEXT_PROSE_LABELS=newSet\(\[[^\]]*'address'/.test(RESULTCARD_NOWS),
);
check(
  'FREE_TEXT_PROSE_LABELS was widened beyond address-only (status/parking type/ac type/kitchen/furnishing/etc.)',
  /FREE_TEXT_PROSE_LABELS=newSet\(\[[^\]]*'status'[^\]]*'parkingtype'[^\]]*'actype'[^\]]*'kitchen'/.test(RESULTCARD_NOWS),
);
check(
  `no code/ID label was accidentally added to FREE_TEXT_PROSE_LABELS (would wrongly blank a real license/plan/parcel/postal code): ${CODE_LABELS_MUST_STAY_EXCLUDED.filter((l) => new RegExp(`FREE_TEXT_PROSE_LABELS=newSet\\(\\[[^\\]]*'${l.replace(/ /g, '')}'`).test(RESULTCARD_NOWS)).join(', ') || 'none found (correct)'}`,
  CODE_LABELS_MUST_STAY_EXCLUDED.every((l) => !new RegExp(`FREE_TEXT_PROSE_LABELS=newSet\\(\\[[^\\]]*'${l.replace(/ /g, '')}'`).test(RESULTCARD_NOWS)),
);
check(
  "arAttrValue()'s free-text fallback calls arabicOrPlaceholderForFreeText only inside the FREE_TEXT_PROSE_LABELS branch",
  RESULTCARD_NOWS.includes('if(FREE_TEXT_PROSE_LABELS.has(ll))returnarabicOrPlaceholderForFreeText(v,locale,ATTRIBUTE_UNRESOLVED_AR);'),
);
check(
  "facade's own fallback branch (bypasses the generic FREE_TEXT_PROSE_LABELS check) also guards against non-Arabic garbage — dealapp's raw scraped HTML/meta-tag leak",
  RESULTCARD_NOWS.includes('returnarabicOrPlaceholderForFreeText(v,locale,ATTRIBUTE_UNRESOLVED_AR);}constmap=AR_ENUM[ll];'),
);

// New AR_ENUM entries (2026-07-16): fixes the 'furniture'-vs-'furnishing' key-mismatch bug (satel,
// 203 rows) and adds 4 previously-nonexistent enums (status/parking type/ac type/kitchen — all
// satel, ~200 rows each) plus 2 small extensions (usage's agricultural/mixed; license status's
// approved). Real, executed — imports AR_ENUM isn't possible (heavy RN deps in the same file), so
// this is a source-text check for each exact live value → Arabic translation pair.
// (CORRECTED 2026-07-17, owner audit M1) This assertion used to pin the RENAME 'furniture' → 'furnishing'
// and required the value map to be inline under the 'furnishing:' key. That encoded the bug: BOTH label
// spellings are real (satel sends 'Furnishing'; wasalt + aldarim send the legacy 'Furniture'), so the
// rename silently stranded 2,757 live wasalt/aldarim rows in raw English («الأثاث: Un-Furnished»). The
// correct invariant is that BOTH keys exist and share ONE value map, which is what we now pin. Full
// coverage of both labels + every live value lives in scripts/verify-furnishing-enum-both-labels.ts.
check(
  "AR_ENUM keeps BOTH 'furnishing' (satel) and 'furniture' (wasalt/aldarim) keys, sharing one value map — renaming either one strands the other's rows in raw English",
  RESULTCARD_NOWS.includes('furnishing:FURNISH_VALUES_AR') && RESULTCARD_NOWS.includes('furniture:FURNISH_VALUES_AR'),
);
check("furnishing: satel's exact live value 'Fully furnished' is mapped", RESULTCARD_NOWS.includes("'fullyfurnished':'مفروشبالكامل'"));
check("furnishing: satel's exact live value 'Partially furnished' is mapped", RESULTCARD_NOWS.includes("'partiallyfurnished':'مفروشجزئياً'"));
check("status: satel's 'Available'/'Rented out' (202 rows, previously had NO enum entry at all) are mapped", RESULTCARD_NOWS.includes("status:{available:'متاح','rentedout':'مؤجر'}"));
check("'parking type': satel's 'underground'/'outdoor'/'shadedOutdoor' (194 rows) are mapped", RESULTCARD_NOWS.includes("'parkingtype':{underground:'تحتالأرض',outdoor:'مكشوف',shadedoutdoor:'مكشوفمظلل'}"));
check("'ac type': satel's 'split'/'concealed'/'both' (201 rows) are mapped", RESULTCARD_NOWS.includes("'actype':{split:'سبليت',concealed:'مخفي',both:'مركزيوسبليت'}"));
check("kitchen: satel's 'with-appliances'/'without-appliances' (199 rows) are mapped", RESULTCARD_NOWS.includes("kitchen:{'with-appliances':'مجهزبأجهزة','without-appliances':'غيرمجهزبأجهزة'}"));
check("'property usage' extended with eaqartabuk/erapulse's 'agricultural'/'mixed'", RESULTCARD_NOWS.includes("residential:'سكني',commercial:'تجاري',agricultural:'زراعي',mixed:'مختلط'"));
check("'license status' extended with mizlaj's raw 'approved' (27 rows)", RESULTCARD_NOWS.includes("'licensestatus':{approved:'معتمد'}"));

// Card title/location line (2026-07-16, owner report — highest-visibility gap: the card's own
// HEADLINE had no Arabic guard at all, only an empty-string '||' fallback that never caught
// "present but not Arabic"). Live DB proof of the leak this closes: raw city values like "Eastern
// Province" (alhoshan), "Baljurashi"/"Sarat Abidah" (wasalt), "Al Dulaimiyah" (ramzalqasim) used to
// render straight onto the card title.
check(
  'ResultCard.tsx guards the city with arabicOrPlaceholder(..., LOCATION_UNRESOLVED_AR) BEFORE place() — a raw non-Arabic city (e.g. "Eastern Province") no longer reaches the card headline',
  RESULTCARD_NOWS.includes('constcityAr=arabicOrPlaceholder(t(listing.city),locale,LOCATION_UNRESOLVED_AR);'),
);
check(
  'the card title Text uses the guarded cityAr (not a bare place(t(listing.city))) for both the district-comma-city and city-only branches',
  RESULTCARD_NOWS.includes('place(cityAr)||LOCATION_UNRESOLVED_AR')
  && (RESULTCARD_TS.match(/place\(cityAr\)/g)?.length ?? 0) >= 2, // title branch + locText row, both fixed
);
check(
  // Refactored 2026-07-21 (owner "make the card honest and consistent"): the district is still guarded by
  // arabicOrPlaceholder (never a bare place(t(listing.district)) leak), but the headline is now composed in
  // a `locationTitle` const and an UNMATCHED district falls back to DISTRICT_UNRESOLVED_AR («الحي غير محدد»)
  // instead of showing a raw source token — display now agrees with the filter (remote.ts gates it).
  'the card title district text is guarded via arabicOrPlaceholder (never a bare place(t(listing.district))), and an unmatched district honestly falls back to DISTRICT_UNRESOLVED_AR',
  RESULTCARD_NOWS.includes('arabicOrPlaceholder(t(listing.district),locale,')
  && !RESULTCARD_NOWS.includes('place(t(listing.district))')
  && RESULTCARD_NOWS.includes('DISTRICT_UNRESOLVED_AR'),
);

// agent.tsx district refine-chip (2026-07-16): q.location can be the LLM's own canonical-ENGLISH
// city choice on the AI-agent path — was interpolated raw into an Arabic chip question.
const AGENT_TSX = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const AGENT_NOWS = stripWs(AGENT_TSX);
check(
  'agent.tsx\'s district refine-chip question wraps q.location in arLabel() on the Arabic branch (was raw — could render "أي حي تفضّل في Riyadh؟")',
  AGENT_NOWS.includes('ask=ar?`أيحيتفضّلفي${arLabel(q.location)}؟`:`Whichdistrictin${q.location}?`;'),
);

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} type-and-attribute-fallback assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ all type-and-attribute-fallback assertions passed');
