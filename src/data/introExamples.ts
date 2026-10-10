// Rotating composer examples for the EMPTY AI-search landing screen (owner brief 2026-08-23).
//
// EVERY example here is a PRODUCT PROMISE: it may only ship if the exact sentence was submitted to
// the PRODUCTION agent edge function and its parsed intent came back correct and stable (3
// repetitions, byte-identical on every asserted field). The proof artifact is
// docs/ops/INTRO_EXAMPLES_PROOF.md — each sentence below appears there VERBATIM with its proven
// parse. scripts/verify-intro-rotator-contract.ts (npm test) pins this list against that proof doc,
// so adding an example without re-running the proof turns CI red. Candidates that FAILED the truth
// test (property age, furnished, bathrooms, area ranges, street width, «دوبلكس», «سكن عمال»,
// amenity promises like مسبح/مدخل خاص) are documented there too and MUST NOT be re-added without
// new proof that the search system actually honors them.
//
// ORDER IS CURATED FOR ROTATION DIVERSITY (owner addendum): consecutive examples change dimension —
// location / budget / area / beds / monthly-vs-annual / commercial / land / notation — so the user
// never sees three near-identical sentences in a row. Keep that interleaving when editing.
//
// Arabic-literal content lives here directly (same convention as HYPE_AR / RESULT_AR in
// src/app/agent.tsx) — these are product copy, not UI chrome, so they do not go through t().
export const INTRO_EXAMPLES: readonly string[] = [
  'أبي فيلا شمال الرياض',
  'أبي شقة في الرياض ثلاث غرف بحدود ٨٠ ألف بالسنة',
  'دور لي مستودع في الدمام',
  'أبي شقة شهرية في الخبر، غرفتين، بحدود ٥٥٠٠ ريال بالشهر',
  'أبحث عن أرض سكنية في جدة مساحتها ٥٠٠ متر',
  'دور لي شقة رخيصة في جدة',
  'أبي فيلا للبيع شمال الرياض، خمس غرف، وميزانيتي إلى ٣ مليون',
  'دور لي استراحة في الرياض',
  'أبي عقار للبيع في حي العارض بحدود مليون ونص',
  'أبي مكتب للإيجار في الرياض مساحته حول ١٥٠ متر',
  'شقة شهرية في الخبر',
  'دور لي شقة سنوية في جدة، ثلاث غرف، وميزانيتي ٩٠ ألف',
  'أبي مصنع للإيجار في المنطقة الشرقية',
  'شقة غرفتين في مكة',
  'أبي مستودع في الدمام وإيجاره أقل من ٢٠٠ ألف بالسنة',
  'أبي شاليه للإيجار في جدة',
  'أبي فيلا ما تتجاوز ٣,٠٠٠,٠٠٠ ريال',
  'أبي مكتب للإيجار في حي العليا بالرياض',
  'أرض للبيع في الرياض',
  'أبحث عن أرض سكنية في الرياض وميزانيتي مليون ونص',
  'أبي شقة شهرية في جدة قريبة من البحر',
  'أبي شقة ٣ غرف في الدمام',
  'ميزانيتي ١٢٠ ألف بالسنة وأبي مكتب بالرياض',
  'أبحث عن محل للإيجار في الرياض',
  'أبي شقة شهرية ما تتعدى ٦ آلاف ريال',
];

// The English UI's examples (owner 2026-10-10: «the Arabic text below we need to change it to English»).
// Same promise, same proof: each sentence was sent to the PRODUCTION agent with locale 'en', 3 reps,
// and parsed to the same search as its Arabic twin (docs/ops/INTRO_EXAMPLES_PROOF.md, «English»).
// English candidates that failed there (an «m²» size read as a price, a factory that came back as a
// message, an unstable deal) are listed under its English FAILED table and must not be added here.
// The short ones («Shop in Riyadh») exist for phones: the slot there is ~124px, and Latin text is
// wider than Arabic, so the long sentences would always end in «…».
export const INTRO_EXAMPLES_EN: readonly string[] = [
  'Villa for sale in north Riyadh, 5 bedrooms, budget up to 3 million',
  'Shop in Riyadh',
  'Apartment in Riyadh, 3 bedrooms, up to 80K a year',
  'Villa in Jeddah',
  'Find me a warehouse in Dammam',
  'Flat in Jeddah',
  'Chalet for rent in Jeddah',
  'Office in Riyadh',
  'Monthly apartment in Khobar, 2 bedrooms, up to 5,500 SAR a month',
  'Shop in Dammam',
  'Land for sale in Riyadh',
  'Villa in Riyadh',
  'Find me a cheap apartment in Jeddah',
  'Chalet in Jeddah',
  'Shop for rent in Riyadh',
  '2-bedroom apartment in Makkah',
  'Find me a rest house in Riyadh',
  'Monthly apartment in Khobar',
];

// Approximate advance width of Arabic body text at the composer's 16px web font — used ONLY to pick
// examples that fit the measured placeholder width on one line, so narrow screens rotate the SHORT
// members of the pool instead of truncating a long sentence (owner brief §9). Conservative on
// purpose: an example that still overflows is clipped by numberOfLines={1}, never by the layout.
export const INTRO_EXAMPLE_CHAR_PX = 8;

// Pure + deterministic (the barrier unit-tests it): the curated order is preserved so rotation
// diversity survives the width filter. When fewer than 3 fit (very narrow), fall back to the 5
// shortest so the rotation always has variety and the text stays readable.
export function introExamplesForWidth(width: number, locale: 'ar' | 'en' = 'ar'): string[] {
  // NOTE: `width` is a MEASURED element width (onLayout of the placeholder slot, never negative),
  // not a viewport breakpoint — the repo's breakpoint barrier (verify-ssr-hydration-parity C)
  // rightly owns those in lib/responsive.ts; the falsy guard keeps its full-tree scan clean.
  if (!width) return [];
  const pool = locale === 'en' ? INTRO_EXAMPLES_EN : INTRO_EXAMPLES;
  const budget = Math.floor(width / INTRO_EXAMPLE_CHAR_PX);
  const fit = pool.filter((s) => s.length <= budget);
  if (fit.length >= 3) return fit;
  return [...pool].sort((a, b) => a.length - b.length).slice(0, 5);
}

// Each example holds long enough to actually read (~2.6–4s, scaled by length — owner brief §3).
export function introExampleHoldMs(text: string): number {
  return Math.max(2600, Math.min(4000, 2600 + text.length * 14));
}
