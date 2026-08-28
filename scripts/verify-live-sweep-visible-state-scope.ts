// THE SWEEP'S UI-STATE ORACLE MUST READ THE APP, NOT THE ADVERTISER.
//
// §40.4 makes the app's own «ملخص البحث» the ONLY admissible source of "what the user's screen says
// this search is". Every INTENT→UI verdict rests on it, including the permanent
// `exact-city-never-rescoped` watch — so a parser that can be fed by ad copy does not merely produce
// noise, it produces a CONFIDENT FALSE MATCHING FAILURE on a healthy search. §40.7 forbids exactly
// that ("do NOT call a harness failure a product failure"), and §41.15 states the general rule: an
// oracle that accuses the product for its own imprecision is worse than no oracle.
//
// WHAT WENT WRONG (production, 2026-08-28, مدينة الملك عبدالله الاقتصادية / بيع / فيلا).
// The parser sliced `document.body.innerText` at the first «الضغط على هذا الإعلان» and searched that
// slice with an UNANCHORED regex. But `ResultCard` renders the advertiser's description ABOVE that
// host hint (src/components/ResultCard.tsx), so the slice always contains the whole first card. An
// aqar villa ad reads «📍 الموقع والتميز: • الحي: تالة جاردنز • ⁠(Tala Gardens)…», and the sweep
// reported that the exact city had been «re-scoped to district «تالة جاردنز • ⁠(Tala Gardens). •
// الموقع: تقع الفيلا على شارع»» and failed the run. Production's real summary carried FOUR bullets
// and no الحي line at all: it had done nothing wrong.
//
// THE FIXTURES BELOW ARE THE VERBATIM CAPTURE of that page (trimmed to the head), so this barrier
// re-runs the exact evidence that found the defect — and the MUTATION half re-implements the old
// slice-and-search and requires it to FAIL, so "fixed" cannot be claimed by a test that never
// distinguished the two.
//
//   node --experimental-strip-types scripts/verify-live-sweep-visible-state-scope.ts

import { parseVisibleState } from '../e2e/live-sweep/visibleState.mjs';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── fixture 1: the real page. Summary = 4 bullets, NO الحي. Card #1 carries «• الحي: …» in ad copy.
const REAL = [
  'إزهله',
  'ملخص البحث',
  '• نوع العقار: فيلا',
  '• نوع العملية: للبيع',
  '• المدينة: مدينة الملك عبدالله الاقتصادية',
  '• الإقليم: مكة',
  'لقينا 12 إعلان يطابق طلبك.',
  '#1',
  'عقار · sa.aqar.fm',
  'فيلا للبيع',
  'حي ازميرالدا, مدينة الملك عبدالله الاقتصادية',
  'ر.س 1,700,000',
  '‏فرصة عقارية استثنائية فيلا فاخرة للبيع في مدينة الملك عبدالله الاقتصادية (KAEC) 💎 استمتع برغد'
    + ' العيش في أرقى أحياء "التالة جاردنز حيث تجتمع الفخامة، الخصوصية، والخدمات المتكاملة. 📍 الموقع'
    + ' والتميز: • الحي: تالة جاردنز • ⁠(Tala Gardens). • الموقع: تقع الفيلا على شارعين (ركنية) وعلى'
    + ' الشارع الرئيسي مباشرة، مما يمنحها إطلالة مميزة وسهولة في الدخول والخروج.',
  'الضغط على هذا الإعلان سيأخذك إلى sa.aqar.fm',
].join('\n');

// ── fixture 2: a GENUINE re-scope — the app itself put a حي in its own summary. Must still be caught.
const RESCOPED = [
  'ملخص البحث',
  '• نوع العقار: شقة',
  '• نوع العملية: للإيجار · سنوي',
  '• المدينة: الرياض',
  '• الحي: النرجس',
  'لقينا 1,058 إعلان يطابق طلبك.',
  '#1',
  'الضغط على هذا الإعلان سيأخذك إلى sa.aqar.fm',
].join('\n');

// ── fixture 3: no summary rendered at all. Reading LESS is safe; reading a card is not.
const NO_SUMMARY = ['إزهله', '#1', 'شقة للإيجار', '• الحي: الملقا • المدينة: جدة',
  'الضغط على هذا الإعلان سيأخذك إلى sa.aqar.fm'].join('\n');

// ── 1. SCOPE — ad copy can never become app state ───────────────────────────────────────────────
const real = parseVisibleState(REAL);
check('the real production page yields NO الحي (the summary has no district line)',
  real.district === null, `got «${real.district}» — that string is card #1's advertiser description`);
check('المدينة comes from the summary, exactly as the app rendered it',
  real.city === 'مدينة الملك عبدالله الاقتصادية', `got «${real.city}»`);
check('نوع العقار / نوع العملية / الإقليم are read from the summary',
  real.type === 'فيلا' && real.deal === 'للبيع' && real.region === 'مكة',
  `type=${real.type} deal=${real.deal} region=${real.region}`);
check('the headline is still read from the whole document', real.headline === '12');
check('summaryFound is true when the app rendered a summary', real.summaryFound === true);

// ── 2. THE WATCH STILL BITES — a real re-scope is still detected ─────────────────────────────────
const resc = parseVisibleState(RESCOPED);
check('a GENUINE «• الحي: …» summary line is still read (the watch is not silenced)',
  resc.district === 'النرجس', `got «${resc.district}» — silencing the layer would be worse than the bug`);
check('a genuine summary still yields its city', resc.city === 'الرياض');

// ── 3. NO SUMMARY → NO FIELDS (never fall back to the document) ─────────────────────────────────
const none = parseVisibleState(NO_SUMMARY);
check('no «ملخص البحث» on screen → every summary field is null',
  none.city === null && none.district === null && none.type === null && none.deal === null,
  'the old fallback was "search the whole document", which is how a card became app state');
check('summaryFound reports the absence rather than hiding it', none.summaryFound === false);

// ── 4. MUTATION PROOF — the OLD implementation fails fixture 1 ───────────────────────────────────
// Verbatim re-implementation of the pre-2026-08-28 parse. If this ever PASSES fixture 1, the fixture
// stopped exercising the defect and the barrier above proves nothing.
function legacyParse(all: string) {
  const cardAt = all.indexOf('الضغط على هذا الإعلان');
  const sumAt = all.indexOf('ملخص البحث');
  const head = all.slice(0, cardAt > 0 ? cardAt : all.length);
  const summary = sumAt >= 0 ? head.slice(sumAt) : head;
  const line = (label: string) => {
    const m = summary.match(new RegExp(`[•·]\\s*${label}:\\s*([^\\n]{1,60})`));
    return m ? m[1].trim() : null;
  };
  return { city: line('المدينة'), district: line('الحي') };
}
const legacy = legacyParse(REAL);
check('MUTATION: the old parse DOES read the ad copy as a district (so the fix is load-bearing)',
  legacy.district !== null && legacy.district.startsWith('تالة جاردنز'),
  `old parse returned «${legacy.district}» — expected the advertiser string`);
check('MUTATION: the old parse also mis-reads a page with no summary at all',
  legacyParse(NO_SUMMARY).district === 'الملقا • المدينة: جدة',
  'the "degrade to read less" comment described behaviour the code did not have');

// ── 5. the anchor is a SECOND, independent defence ───────────────────────────────────────────────
// Even inside the summary block, a label must begin its own line. A single-line summary that glued
// the bullets together must not let a later «• الحي:» win over the app's real fields.
const GLUED = ['ملخص البحث', '• المدينة: الدمام والحي: ليس حقلاً • الحي: مزيف', 'لقينا 5 إعلان'].join('\n');
const glued = parseVisibleState(GLUED);
check('a mid-line «• الحي:» inside a bullet is part of that bullet\'s VALUE, never a field',
  glued.district === null && glued.city?.startsWith('الدمام'),
  `city=«${glued.city}» district=«${glued.district}»`);

console.log(failures === 0
  ? '\n✓ the UI-state oracle reads the app\'s own summary, and only that'
  : `\n✗ ${failures} check(s) FAILED`);
process.exit(failures ? 1 : 0);
