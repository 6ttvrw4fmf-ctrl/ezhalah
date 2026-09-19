// Rotating Results-Found sentence for the search-completion bubble (owner rule 2026-09-19).
// Replaces the fixed «لقينا {n} إعلان يطابق طلبك.» rendered at agent.tsx around line 3363.
//
// FOUR pools, keyed on (lang, hasName):
//   ar+logged-in — 10 templates with {name} and {count}
//   ar+guest     — 10 templates with {count} only (never a name)
//   en+logged-in — 10 templates with {name} and {count}
//   en+guest     — 10 templates with {count} only
//
// Same shape as filterGreetingRotation.ts (owner rule 2026-09-18/19): baked into the app bundle so
// the very first search of a session already rotates — no fetch waiting, no fallback line. The DB
// mirror (public.ui_results_found + ui_results_found_ar() RPC) is optional, and OVERRIDES the baked
// pool as soon as loaderResultsFound.ts's bounded fetch resolves; a failed / empty fetch is
// ignored, never demotes the working baked pool. See supabase/migrations/20260919040825_*.sql for
// the byte-for-byte-mirrored SQL and scripts/verify-results-found-rotation.ts for the equality
// check that keeps the two in lockstep.
//
// {count} is ALWAYS the exact backend-returned total, filled at the CALL SITE via toLocaleString.
// {name} in the logged-in variants comes from useApp().user.nameAr / .nameEn — the SAME field the
// account menu already renders (src/store.tsx AuthUser). Never an email, never a guess, never the
// LLM. When the user is a guest, the guest pool is picked and no name substitution ever runs.

export type ResultsFoundTemplate = { lang: 'ar' | 'en'; hasName: boolean; template: string };

// ── BAKED POOL — owner-authored 2026-09-19, byte-for-byte equal to the DB rows. ───────────────────
// Immediately available at import time so a fresh session already rotates from search #1. Order
// matches the DB rows (lang asc → has_name asc → sort_order asc) and the equality is asserted by
// scripts/verify-results-found-rotation.ts against the migration file.
const BAKED: readonly ResultsFoundTemplate[] = [
  // AR, guest (has_name = false)
  { lang: 'ar', hasName: false, template: 'لقينا لك {count} نتيجة تطابق بحثك 🎉' },
  { lang: 'ar', hasName: false, template: 'أبشر، طلع لنا {count} نتيجة على بحثك 🏡' },
  { lang: 'ar', hasName: false, template: 'يا سلام، لقينا {count} نتيجة تطابق مواصفات بحثك 🙌' },
  { lang: 'ar', hasName: false, template: 'تم، عندنا {count} نتيجة مطابقة لبحثك ✨' },
  { lang: 'ar', hasName: false, template: 'بحثك رجّع لنا {count} نتيجة 🥳' },
  { lang: 'ar', hasName: false, template: 'تم البحث، وطلع لنا {count} نتيجة ✅' },
  { lang: 'ar', hasName: false, template: 'لقينا {count} نتيجة تطابق اللي بحثت عنه 🔍' },
  { lang: 'ar', hasName: false, template: 'تمام، عندنا {count} نتيجة من بحثك الحالي 💯' },
  { lang: 'ar', hasName: false, template: 'عندنا {count} نتيجة تطابق بحثك ⚡' },
  { lang: 'ar', hasName: false, template: 'تم، لقينا {count} نتيجة حسب مواصفات بحثك 🏡' },
  // AR, logged-in (has_name = true)
  { lang: 'ar', hasName: true,  template: 'لقينا لك {count} نتيجة تطابق بحثك يا {name} 🎉' },
  { lang: 'ar', hasName: true,  template: 'أبشر يا {name}، طلع لنا {count} نتيجة على بحثك 🏡' },
  { lang: 'ar', hasName: true,  template: 'يا سلام يا {name}، لقينا {count} نتيجة تطابق مواصفات بحثك 🙌' },
  { lang: 'ar', hasName: true,  template: 'تم يا {name}، عندنا {count} نتيجة مطابقة لبحثك ✨' },
  { lang: 'ar', hasName: true,  template: 'لقيناها يا {name}، {count} نتيجة على بحثك 🔎' },
  { lang: 'ar', hasName: true,  template: 'تمام يا {name}، بحثك رجّع لنا {count} نتيجة 🥳' },
  { lang: 'ar', hasName: true,  template: 'تم البحث يا {name}، وطلع لنا {count} نتيجة ✅' },
  { lang: 'ar', hasName: true,  template: 'لقينا {count} نتيجة على بحثك الحالي يا {name} 🔍' },
  { lang: 'ar', hasName: true,  template: 'عندنا {count} نتيجة يا {name} تطابق بحثك الحالي 🏘️' },
  { lang: 'ar', hasName: true,  template: 'لقينا نتائج يا {name}، وعددها {count} 🏡' },
  // EN, guest
  { lang: 'en', hasName: false, template: 'We found {count} results matching your search 🎉' },
  { lang: 'en', hasName: false, template: 'Good news, we found {count} results matching your search 🏡' },
  { lang: 'en', hasName: false, template: 'Search complete, we found {count} results ✅' },
  { lang: 'en', hasName: false, template: 'Your search returned {count} results 💫' },
  { lang: 'en', hasName: false, template: 'We found {count} results for your current search 🔍' },
  { lang: 'en', hasName: false, template: 'Done, we found {count} results matching your criteria ⚡' },
  { lang: 'en', hasName: false, template: 'Good news, we found {count} results matching your criteria 🎯' },
  { lang: 'en', hasName: false, template: 'Search complete, we found {count} matching results 🙌' },
  { lang: 'en', hasName: false, template: 'Good news, we found {count} results matching your search ⚡' },
  { lang: 'en', hasName: false, template: 'Done, we found {count} results based on your search criteria 🏡' },
  // EN, logged-in
  { lang: 'en', hasName: true,  template: 'We found {count} results matching your search, {name} 🎉' },
  { lang: 'en', hasName: true,  template: 'Good news, {name}, we found {count} results matching your search 🏡' },
  { lang: 'en', hasName: true,  template: 'Search complete, {name}, we found {count} results ✅' },
  { lang: 'en', hasName: true,  template: 'Your search returned {count} results, {name} 💫' },
  { lang: 'en', hasName: true,  template: 'We found {count} results for your current search, {name} 🔍' },
  { lang: 'en', hasName: true,  template: 'Done, {name}, we found {count} results matching your criteria ⚡' },
  { lang: 'en', hasName: true,  template: 'Good news, {name}, we found {count} results matching your criteria 🎯' },
  { lang: 'en', hasName: true,  template: 'Search complete, {name}, we found {count} matching results 🙌' },
  { lang: 'en', hasName: true,  template: 'Good news, {name}, we found {count} results matching your search ⚡' },
  { lang: 'en', hasName: true,  template: 'Done, {name}, we found {count} results based on your search criteria 🏡' },
];

// Live cache — starts equal to BAKED so the very first pick already rotates. Loader can override.
let cache: readonly ResultsFoundTemplate[] = BAKED;
// Anti-repeat tracked per (lang, hasName) key so switching pool never reads a repeat as a fresh one.
const lastIndex: Record<string, number> = {};

/** The loader calls this once its RPC settles. A non-empty pool replaces the cache; empty / null is
 *  ignored so a failed fetch can never demote the working baked list. */
export function setResultsFoundCache(rows: ResultsFoundTemplate[] | null): void {
  if (rows && rows.length > 0) {
    cache = rows.filter((t) => t && t.template);
    for (const k of Object.keys(lastIndex)) delete lastIndex[k];
  }
}

/** True — the cache is always populated at import time. Kept for API parity with the loader. */
export function hasResultsFoundCache(): boolean {
  return cache.length > 0;
}

/**
 * Pick one Results-Found sentence and fill its placeholders. Synchronous, never falls back to the
 * retired «لقينا {n} إعلان يطابق طلبك.» — the baked pool guarantees a real rotation from search #1.
 *
 * - `count` is the exact backend-returned total. The caller formats it (toLocaleString) BEFORE
 *   passing it in, so English digits are consistent with the rest of the app.
 * - `name` is the user's display name (nameAr for ar, nameEn for en, from the SAME AuthUser field
 *   the account menu renders). Pass `null` / undefined for a guest — the guest pool is picked and
 *   no name substitution ever runs.
 */
export function pickResultsFoundSentence(args: {
  lang: 'ar' | 'en';
  name: string | null | undefined;
  count: string;
}): string {
  const hasName = !!(args.name && args.name.trim());
  const pool = cache.filter((t) => t.lang === args.lang && t.hasName === hasName);
  // Absolute safety fallback for a caller that hands a lang no pool covers (should never happen —
  // the barrier asserts every (lang, hasName) combo has ≥1 template). Better honest degradation
  // than a crash.
  if (pool.length === 0) return `${args.count}`;
  const key = `${args.lang}|${hasName}`;
  const prev = lastIndex[key] ?? -1;
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === prev) i = (i + 1) % pool.length;
  lastIndex[key] = i;
  let out = pool[i].template.split('{count}').join(args.count);
  if (hasName) out = out.split('{name}').join(args.name!.trim());
  return out;
}

/** Test-only export: the baked list itself + the pure picker seams, so a barrier can assert exact
 *  shape without touching Supabase. */
export const __testing = { BAKED };
