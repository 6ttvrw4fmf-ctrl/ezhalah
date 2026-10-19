// WHICH city suggestion a journey clicks — as a pure rule, so it can be proven instead of trusted.
//
// WHY THIS EXISTS (routine #9, 2026-09-25). `pickCity` chose its option with `.pop()` — the LAST DOM
// node whose text merely STARTS WITH the requested city. Measured live against production the day
// this was written, typing «الخبر» offers four nodes, in this order:
//
//     [0] "الخبر\n6,606 إعلان"     [1] "الخبر\n6,606 إعلان"
//     [2] "الخبراء\n13 إعلان"       [3] "الخبراء\n13 إعلان"
//
// `.pop()` takes [3]. So every sweep journey asking for الخبر — a city holding 14,066 production_ready
// rows — actually searched الخبراء, which holds 17. THE PRODUCT IS HEALTHY: it offers both cities, in
// sensible order, biggest first. The harness picked the wrong one and then measured it.
//
// AND THE CHAIN'S OWN GUARD CANNOT SEE IT. assertChain's INTENT→UI equality is
// `!ui.city.includes(intent.city) && !intent.city.includes(ui.city)`, and `'الخبراء'.includes('الخبر')`
// is TRUE — so the journey reported `ok` and `ops_qa_coverage_ledger` recorded coverage for a city
// that was never searched. Two blindnesses compounding: the wrong pick, and a substring test that
// cannot distinguish a city from a longer city containing it.
//
// ELEVEN city pairs in production collide this way (measured 2026-09-25, `b.city_ar LIKE a.city_ar||'%'`
// over distinct production_ready cities). By shorter-city inventory:
//     الخبر 14,066 / الخبراء 17 · الجبيل 1,169 / الجبيلة 69 · صبيا 208 / صبياء 29 · بيش 162 / بيشة 147
//     الشنان 122 / الشنانة 4 · الجلة 14 / «الجلة وتبراك» 5 · الخرماء 5 / «الخرماء الجنوبية» 1
//     خيبر 4 / «خيبر الجنوب» 2 · السلام 3 / «السلام العليا» 1 · القاع 2 / القاعد 3 · العمار 2 / العمارية 21
//
// THE RULE: prefer an EXACT city match; fall back to the previous last-match behaviour only when no
// exact match exists. That fallback is deliberate — it cannot make any currently-working journey
// worse, and a city the product renders with extra decoration still resolves the way it always did.

/**
 * The city NAME a suggestion node is offering, with its «N إعلان» count stripped.
 *
 * Production renders the two on SEPARATE lines ("الخبر\n6,606 إعلان" — measured), so the first line
 * is the name. The count is stripped anyway, for a rendering that puts them on one line, and a
 * trailing separator with it. Read the NAME, never the whole node text: the count is exactly the part
 * that makes two nodes for the same city look different.
 */
export function cityOptionName(optionText) {
  return String(optionText ?? '')
    .trim()
    .split('\n')[0]
    .replace(/\s*[·•|،,\-–—]?\s*[\d٠-٩][\d٠-٩,،.\s]*إعلان.*$/u, '')
    .replace(/\s*[·•|،,\-–—]\s*$/u, '')
    .trim();
}

/**
 * The INDEX of the option a journey asking for `city` should click, or -1 when none qualifies.
 *
 * `optionTexts` is the rendered text of each candidate node, in DOM order — the same nodes the
 * caller's own filter produced. Returns an index rather than a node so the rule stays pure and
 * provable; the caller maps it back to the element it will actually click.
 */
export function pickCityOptionIndex(optionTexts, city) {
  const want = String(city ?? '').trim();
  if (!want || !Array.isArray(optionTexts) || optionTexts.length === 0) return -1;

  // EXACT first. The LAST exact match, not the first, so the only behaviour that changes is which
  // city is chosen — never which duplicate of it, and production renders every option twice.
  let exact = -1;
  for (let i = 0; i < optionTexts.length; i++) {
    if (cityOptionName(optionTexts[i]) === want) exact = i;
  }
  if (exact >= 0) return exact;

  // No exact match: the product is rendering this city under a name we did not type, and guessing
  // which longer name is "the same city" is precisely the judgement that produced the الخبراء
  // measurement. Keep the historical fallback so nothing that worked stops working, and let the
  // caller's own INTENT→UI comparison be the thing that judges the result.
  for (let i = optionTexts.length - 1; i >= 0; i--) {
    if (cityOptionName(optionTexts[i]).startsWith(want)) return i;
  }
  return -1;
}
