// WHAT THE USER'S SCREEN SAYS THE SEARCH IS — parsed from the app's OWN «ملخص البحث», and from
// nothing else.
//
// This is layer 2 of the six-layer comparison (§40.4: "read UI state from the app's OWN «ملخص البحث»
// summary and chips — never from the harness's memory of what it clicked"). Every INTENT→UI verdict
// the sweep reaches, including the permanent `exact-city-never-rescoped` watch, is decided here.
//
// WHY IT IS ITS OWN MODULE (2026-08-28). It used to live inside a `page.evaluate()` in sweep.mjs and
// read the summary out of a slice of `document.body.innerText`:
//
//     const cardAt = all.indexOf('الضغط على هذا الإعلان');   // "clicking this ad will take you to…"
//     const head   = all.slice(0, cardAt > 0 ? cardAt : all.length);
//
// That slice was intended to stop before the first result card. It does not. `ResultCard` renders the
// advertiser's description ABOVE its «الضغط على هذا الإعلان» host hint (src/components/ResultCard.tsx),
// so the first card's title, price and full description are always INSIDE `head`. The field regex was
// unanchored, so any advertiser who writes a bulleted ad — and they do — could forge the app's state.
//
// Measured live on production 2026-08-28, مدينة الملك عبدالله الاقتصادية / بيع / فيلا:
//   the real summary was «• نوع العقار: فيلا • نوع العملية: للبيع • المدينة: مدينة الملك عبدالله
//   الاقتصادية • الإقليم: مكة» — FOUR bullets, no الحي line, production perfectly correct;
//   card #1's aqar description contained «📍 الموقع والتميز: • الحي: تالة جاردنز • ⁠(Tala Gardens)…»,
//   and the sweep reported «exact city … was re-scoped to district «تالة جاردنز …»» and failed the run.
// A false total-matching failure, manufactured by ad copy. §40.7 forbids exactly that shape, and
// §41.15's rule applies to this layer too: an oracle that accuses the product for its own imprecision
// is worse than no oracle.
//
// THE CONTRACT NOW — two independent defences, either one sufficient, both asserted by
// `scripts/verify-live-sweep-visible-state-scope.ts`:
//   1. SCOPE — fields are read ONLY from the contiguous run of «• …» bullet lines that immediately
//      follows the «ملخص البحث» heading. That run IS the summary: buildSummary() in src/data/search.ts
//      emits `${t('Search Summary')}\n${lines.join('\n')}` with every line prefixed «• ». The first
//      line that is not a bullet ends it.
//   2. ANCHOR — a field must start its own line. «• الحي: …» in the middle of a sentence is not a field.
// No «ملخص البحث» on screen → every field is null (`summaryFound: false`). Reading LESS is always
// safe: assertChain only fires INTENT→UI on a NON-null field, so a missing summary can never invent a
// defect — while the old fallback («use the whole document») is what read a card in the first place.

/** Labels are matched at line start only; the value is the rest of that one line. */
const FIELD_MAX = 120;

/**
 * @param {string} all  document.body.innerText of the live results screen
 */
export function parseVisibleState(all) {
  const lines = String(all ?? '').split('\n');
  const at = lines.findIndex((l) => l.trim() === 'ملخص البحث');
  const summary = [];
  if (at >= 0) {
    for (let i = at + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!/^[•·]/.test(t)) break;      // the first non-bullet line ends the summary block
      summary.push(t);
    }
  }
  const line = (label) => {
    for (const l of summary) {
      const m = l.match(new RegExp(`^[•·]\\s*${label}:\\s*(.+)$`));
      if (m) { const v = m[1].trim(); return v.length <= FIELD_MAX ? v : v.slice(0, FIELD_MAX); }
    }
    return null;
  };
  return {
    summaryFound: at >= 0,
    city: line('المدينة'), district: line('الحي'), region: line('الإقليم'),
    deal: line('نوع العملية'), type: line('نوع العقار'), budget: line('الميزانية'),
    // These three are deliberately whole-document: the headline and the zero-state sit OUTSIDE the
    // summary block, and an entity/placeholder leak is a defect wherever on the screen it renders.
    headline: ([...all.matchAll(/لقينا\s+([\d,٬]+)\s+إعلان/g)].pop() || [])[1] ?? null,
    zero: /ما لقينا|ما فيه نتائج/.test(all),
    entities: (all.match(/&(?:bull|quot|amp|ndash|mdash|nbsp|lt|gt|#\d+);/g) || []).slice(0, 5),
    latinInCards: (all.match(/\b(?:undefined|NaN|\[object)\b/g) || []).slice(0, 5),
  };
}
