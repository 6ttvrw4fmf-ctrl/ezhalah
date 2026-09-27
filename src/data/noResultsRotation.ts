// Rotating No-Results sentence for the search-completion bubble (owner rule 2026-09-26).
// Replaces the fixed generic fallback in src/data/search.ts's noResultsSuggestion() — the LAST of
// its ~9 branches, reached only when none of the 8 more specific diagnoses (empty district, price
// too narrow, wrong type, empty city, "did you mean X") apply. Those 8 are untouched; this rotation
// only covers the true catch-all.
//
// FOUR pools, keyed on (lang, hasName), 20 templates each — the owner's exact 80-message list:
//   ar+logged-in — {name} (owner wrote {الاسم})
//   ar+guest     — no name
//   en+logged-in — {name}
//   en+guest     — no name
//
// Same shape as resultsFoundRotation.ts (owner rule 2026-09-19): baked into the app bundle, picked
// with anti-repeat randomness, and pinned per-message via `stableKey` so a typewriter re-render
// never flips the sentence mid-typing. No DB mirror (unlike filterGreetingRotation / resultsFound) —
// this pool isn't meant to be edited without a deploy; add one later if that need shows up.
//
// {name} comes from the SAME AuthUser field the account menu / resultsFoundRotation already use —
// nameAr for ar, nameEn for en. A guest (or missing display name) picks the guest pool.

export type NoResultsTemplate = { lang: 'ar' | 'en'; hasName: boolean; template: string };

// ── BAKED POOL — owner-authored 2026-09-26, verbatim except {الاسم} → {name}. ──────────────────────
const BAKED: readonly NoResultsTemplate[] = [
  // AR, logged-in (owner's 1-20)
  { lang: 'ar', hasName: true, template: 'ما لقينا نتائج تطابق بحثك عن عقار يا {name}، جرّب تعدّل المواصفات وإزهله 😔' },
  { lang: 'ar', hasName: true, template: 'هالمرة ما طلع لنا عقار يطابق معايير بحثك يا {name}، غيّر اللي يناسبك ونبحث من جديد وإزهله 😕' },
  { lang: 'ar', hasName: true, template: 'بحثك عن عقار ما رجّع نتائج يا {name}، ودك نجرّب بمواصفات ثانية؟ وإزهله 😞' },
  { lang: 'ar', hasName: true, template: 'بحثنا يا {name} وما لقينا عقار يطابق كل الشروط، قل لنا وش ودك تعدّل وإزهله 🥲' },
  { lang: 'ar', hasName: true, template: 'ما طلع لنا تطابق في بحث العقار يا {name}، جرّب توسّع نطاق البحث وإزهله 😢' },
  { lang: 'ar', hasName: true, template: 'ما لقينا عقار حسب معايير بحثك الحالي يا {name}، نجرّب نغيّر أحد الشروط؟ وإزهله 🙁' },
  { lang: 'ar', hasName: true, template: 'نتائج بحث العقار طلعت صفر يا {name}، عطنا التعديل اللي تبيه ونبحث من جديد وإزهله 😓' },
  { lang: 'ar', hasName: true, template: 'ما لقينا عقار يجمع المواصفات اللي طلبتها يا {name}، ودك نخفف أحد الشروط؟ وإزهله 😥' },
  { lang: 'ar', hasName: true, template: 'ما ظهرت نتائج لبحثك عن عقار يا {name}، قل لنا كيف ودك نعدّل البحث وإزهله 😟' },
  { lang: 'ar', hasName: true, template: 'بحث العقار ما رجّع تطابق هالمرة يا {name}، جرّب تغيّر المواصفات وإزهله 💔' },
  { lang: 'ar', hasName: true, template: 'ما لقينا نتائج على مواصفات العقار هذي يا {name}، ودك نبحث بمعايير أوسع؟ وإزهله 😔' },
  { lang: 'ar', hasName: true, template: 'ما طلع لنا عقار يطابق بحثك يا {name}، عطنا مواصفات ثانية نجرّبها وإزهله 😕' },
  { lang: 'ar', hasName: true, template: 'بحثنا بالمواصفات اللي عطيتنا يا {name} وما لقينا عقار مطابق، وش ودك نغيّر؟ وإزهله 😞' },
  { lang: 'ar', hasName: true, template: 'ما ظهرت نتائج مطابقة في بحث العقار يا {name}، عدّل اللي يناسبك ونبحث مرة ثانية وإزهله 🥲' },
  { lang: 'ar', hasName: true, template: 'هالبحث عن عقار طلع بدون نتائج يا {name}، ودك نوسّع أحد معايير البحث؟ وإزهله 😢' },
  { lang: 'ar', hasName: true, template: 'ما لقينا عقار ضمن كل شروطك يا {name}، قل لنا أي شرط تبي تعدّله وإزهله 🙁' },
  { lang: 'ar', hasName: true, template: 'ما رجعت لنا نتائج لبحث العقار يا {name}، نجرّب وصف مختلف للبحث؟ وإزهله 😓' },
  { lang: 'ar', hasName: true, template: 'ما لقينا تطابق لطلب بحثك عن عقار يا {name}، عطنا التغييرات اللي في بالك وإزهله 😥' },
  { lang: 'ar', hasName: true, template: 'نتائج بحثك عن عقار صفر يا {name}، ودك نعدّل المعايير ونبحث من جديد؟ وإزهله 😟' },
  { lang: 'ar', hasName: true, template: 'هالمرة ما لقينا عقار حسب مواصفات بحثك يا {name}، قل لنا وش تبي نجرّب بعدها وإزهله 💔' },
  // AR, guest (owner's 21-40)
  { lang: 'ar', hasName: false, template: 'ما لقينا نتائج تطابق بحثك عن عقار، جرّب تعدّل المواصفات وإزهله 😔' },
  { lang: 'ar', hasName: false, template: 'هالمرة ما طلع لنا عقار يطابق معايير بحثك، غيّر اللي يناسبك ونبحث من جديد وإزهله 😕' },
  { lang: 'ar', hasName: false, template: 'بحثك عن عقار ما رجّع نتائج، ودك نجرّب بمواصفات ثانية؟ وإزهله 😞' },
  { lang: 'ar', hasName: false, template: 'بحثنا وما لقينا عقار يطابق كل الشروط، قل لنا وش ودك تعدّل وإزهله 🥲' },
  { lang: 'ar', hasName: false, template: 'ما طلع لنا تطابق في بحث العقار، جرّب توسّع نطاق البحث وإزهله 😢' },
  { lang: 'ar', hasName: false, template: 'ما لقينا عقار حسب معايير بحثك الحالي، نجرّب نغيّر أحد الشروط؟ وإزهله 🙁' },
  { lang: 'ar', hasName: false, template: 'نتائج بحث العقار طلعت صفر، عطنا التعديل اللي تبيه ونبحث من جديد وإزهله 😓' },
  { lang: 'ar', hasName: false, template: 'ما لقينا عقار يجمع المواصفات اللي طلبتها، ودك نخفف أحد الشروط؟ وإزهله 😥' },
  { lang: 'ar', hasName: false, template: 'ما ظهرت نتائج لبحثك عن عقار، قل لنا كيف ودك نعدّل البحث وإزهله 😟' },
  { lang: 'ar', hasName: false, template: 'بحث العقار ما رجّع تطابق هالمرة، جرّب تغيّر المواصفات وإزهله 💔' },
  { lang: 'ar', hasName: false, template: 'ما لقينا نتائج على مواصفات العقار هذي، ودك نبحث بمعايير أوسع؟ وإزهله 😔' },
  { lang: 'ar', hasName: false, template: 'ما طلع لنا عقار يطابق بحثك، عطنا مواصفات ثانية نجرّبها وإزهله 😕' },
  { lang: 'ar', hasName: false, template: 'بحثنا بالمواصفات اللي عطيتنا وما لقينا عقار مطابق، وش ودك نغيّر؟ وإزهله 😞' },
  { lang: 'ar', hasName: false, template: 'ما ظهرت نتائج مطابقة في بحث العقار، عدّل اللي يناسبك ونبحث مرة ثانية وإزهله 🥲' },
  { lang: 'ar', hasName: false, template: 'هالبحث عن عقار طلع بدون نتائج، ودك نوسّع أحد معايير البحث؟ وإزهله 😢' },
  { lang: 'ar', hasName: false, template: 'ما لقينا عقار ضمن كل شروطك، قل لنا أي شرط تبي تعدّله وإزهله 🙁' },
  { lang: 'ar', hasName: false, template: 'ما رجعت لنا نتائج لبحث العقار، نجرّب وصف مختلف للبحث؟ وإزهله 😓' },
  { lang: 'ar', hasName: false, template: 'ما لقينا تطابق لطلب بحثك عن عقار، عطنا التغييرات اللي في بالك وإزهله 😥' },
  { lang: 'ar', hasName: false, template: 'نتائج بحثك عن عقار صفر، ودك نعدّل المعايير ونبحث من جديد؟ وإزهله 😟' },
  { lang: 'ar', hasName: false, template: 'هالمرة ما لقينا عقار حسب مواصفات بحثك، قل لنا وش تبي نجرّب بعدها وإزهله 💔' },
  // EN, logged-in (owner's 41-60)
  { lang: 'en', hasName: true, template: "We found no results matching your property search, {name}, try adjusting your criteria and Ezhalah 😔" },
  { lang: 'en', hasName: true, template: "No results matched your property criteria this time, {name}, tell us what you'd like to change and Ezhalah 😕" },
  { lang: 'en', hasName: true, template: "Your property search returned no results, {name}, want to try different criteria and Ezhalah 😞" },
  { lang: 'en', hasName: true, template: "We searched but found no results matching all your property criteria, {name}, share an adjustment and Ezhalah 🥲" },
  { lang: 'en', hasName: true, template: "No matches came back from your property search, {name}, try broadening the criteria and Ezhalah 😢" },
  { lang: 'en', hasName: true, template: "We found no results for your current property criteria, {name}, try changing one condition and Ezhalah 🙁" },
  { lang: 'en', hasName: true, template: "Your property search returned zero results, {name}, tell us how you'd like to adjust it and Ezhalah 😓" },
  { lang: 'en', hasName: true, template: "No results matched every property feature you requested, {name}, try relaxing one condition and Ezhalah 😥" },
  { lang: 'en', hasName: true, template: "No results appeared for your property search, {name}, tell us what to change for another search and Ezhalah 😟" },
  { lang: 'en', hasName: true, template: "This property search returned no matches, {name}, try a different set of criteria and Ezhalah 💔" },
  { lang: 'en', hasName: true, template: "We found no results using these property criteria, {name}, let us know if you'd like to broaden them and Ezhalah 😔" },
  { lang: 'en', hasName: true, template: "No results matched your property search, {name}, share different criteria for us to try and Ezhalah 😕" },
  { lang: 'en', hasName: true, template: "We searched using your property criteria and found no matches, {name}, tell us what you'd like to revise and Ezhalah 😞" },
  { lang: 'en', hasName: true, template: "Your property search found no matching results, {name}, change what works for you and Ezhalah 🥲" },
  { lang: 'en', hasName: true, template: "This property search came back without results, {name}, try widening one of the criteria and Ezhalah 😢" },
  { lang: 'en', hasName: true, template: "We found no results meeting all your property conditions, {name}, tell us which one you'd like to adjust and Ezhalah 🙁" },
  { lang: 'en', hasName: true, template: "No results came back from the property search, {name}, try describing your search differently and Ezhalah 😓" },
  { lang: 'en', hasName: true, template: "We found no match for your property search request, {name}, share the changes you have in mind and Ezhalah 😥" },
  { lang: 'en', hasName: true, template: "Your property search returned zero matches, {name}, adjust the criteria for another search and Ezhalah 😟" },
  { lang: 'en', hasName: true, template: "We found no results matching your property criteria this time, {name}, tell us what you'd like to try next and Ezhalah 💔" },
  // EN, guest (owner's 61-80)
  { lang: 'en', hasName: false, template: "We found no results matching your property search, try adjusting your criteria and Ezhalah 😔" },
  { lang: 'en', hasName: false, template: "No results matched your property criteria this time, tell us what you'd like to change and Ezhalah 😕" },
  { lang: 'en', hasName: false, template: "Your property search returned no results, want to try different criteria and Ezhalah 😞" },
  { lang: 'en', hasName: false, template: "We searched but found no results matching all your property criteria, share an adjustment and Ezhalah 🥲" },
  { lang: 'en', hasName: false, template: "No matches came back from your property search, try broadening the criteria and Ezhalah 😢" },
  { lang: 'en', hasName: false, template: "We found no results for your current property criteria, try changing one condition and Ezhalah 🙁" },
  { lang: 'en', hasName: false, template: "Your property search returned zero results, tell us how you'd like to adjust it and Ezhalah 😓" },
  { lang: 'en', hasName: false, template: "No results matched every property feature you requested, try relaxing one condition and Ezhalah 😥" },
  { lang: 'en', hasName: false, template: "No results appeared for your property search, tell us what to change for another search and Ezhalah 😟" },
  { lang: 'en', hasName: false, template: "This property search returned no matches, try a different set of criteria and Ezhalah 💔" },
  { lang: 'en', hasName: false, template: "We found no results using these property criteria, let us know if you'd like to broaden them and Ezhalah 😔" },
  { lang: 'en', hasName: false, template: "No results matched your property search, share different criteria for us to try and Ezhalah 😕" },
  { lang: 'en', hasName: false, template: "We searched using your property criteria and found no matches, tell us what you'd like to revise and Ezhalah 😞" },
  { lang: 'en', hasName: false, template: "Your property search found no matching results, change what works for you and Ezhalah 🥲" },
  { lang: 'en', hasName: false, template: "This property search came back without results, try widening one of the criteria and Ezhalah 😢" },
  { lang: 'en', hasName: false, template: "We found no results meeting all your property conditions, tell us which one you'd like to adjust and Ezhalah 🙁" },
  { lang: 'en', hasName: false, template: "No results came back from the property search, try describing your search differently and Ezhalah 😓" },
  { lang: 'en', hasName: false, template: "We found no match for your property search request, share the changes you have in mind and Ezhalah 😥" },
  { lang: 'en', hasName: false, template: "Your property search returned zero matches, adjust the criteria for another search and Ezhalah 😟" },
  { lang: 'en', hasName: false, template: "We found no results matching your property criteria this time, tell us what you'd like to try next and Ezhalah 💔" },
];

// Anti-repeat tracked per (lang, hasName) key so back-to-back zero-result searches never show the
// exact same line twice.
const lastIndex: Record<string, number> = {};

// Per-message stability cache — same reason as resultsFoundRotation.ts's stableByKey: a typewriter
// re-render (~40 Hz) re-invokes the picker on every tick, and without a stable seed the sentence
// would flip mid-typing. First call for a key rotates normally; every later call for the SAME key
// returns exactly the same string.
const stableByKey: Map<string, string> = new Map();

/**
 * Pick one No-Results sentence and fill {name}. Synchronous, always returns a real rotated line.
 *
 * - `name` is the user's display name (nameAr for ar, nameEn for en — the SAME AuthUser field
 *   resultsFoundRotation.ts and the account menu already use). Pass `null`/undefined for a guest —
 *   the guest pool is picked and no name substitution ever runs.
 * - `stableKey` (optional) pins the pick across repeat calls with the same key — pass the message id
 *   so the sentence stays put across every re-render / typewriter tick.
 */
export function pickNoResultsSentence(args: {
  lang: 'ar' | 'en';
  name: string | null | undefined;
  stableKey?: string;
}): string {
  if (args.stableKey != null) {
    const hit = stableByKey.get(args.stableKey);
    if (hit != null) return hit;
  }
  const hasName = !!(args.name && args.name.trim());
  const pool = BAKED.filter((t) => t.lang === args.lang && t.hasName === hasName);
  // Absolute safety fallback — should never fire (the barrier asserts every (lang, hasName) combo
  // has 20 templates); better honest degradation than a crash.
  if (pool.length === 0) return args.lang === 'ar' ? 'ما فيه نتائج تطابق بحثك حالياً.' : 'No results match your search right now.';
  const key = `${args.lang}|${hasName}`;
  const prev = lastIndex[key] ?? -1;
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === prev) i = (i + 1) % pool.length;
  lastIndex[key] = i;
  let out = pool[i].template;
  if (hasName) out = out.split('{name}').join(args.name!.trim());
  if (args.stableKey != null) stableByKey.set(args.stableKey, out);
  return out;
}

/** Test-only export: the baked list itself, so a barrier can assert exact shape without touching
 *  Supabase. */
export const __testing = { BAKED };
