// Rotating opening for the Filter-search → chat bubble. Baked into the app bundle so it works from
// search #1 onward — no fetch, no loading window, no fallback line to the retired «ارحب إزهله 👋»
// (owner rule 2026-09-19: "you make a rotation. When a user clicks, INSTEAD OF ارحب إزهله, you do
// a rotation between one of those." The previous shape shipped a first-search fallback that showed
// the retired text on every first search of a session and looked broken to the user.)
//
// The 60 rows here are the owner's trimmed list from 2026-09-26 (originally 100, authored
// 2026-09-18) — the owner cut Gulf-wide/Emirati-leaning entries («مرحبا الساع») and phrases that
// read forced or unnatural in Saudi Arabic («أرحب وأسهِل», «مرحبتين كبار», endings tacked on with a
// bare «يا»), on the reasoning that 60 natural openings beat 100 with filler. Also stored
// server-side in public.ui_filter_greetings for future editability — see
// supabase/migrations/20260918214451_ui_filter_greetings_rotation.sql (original 100) and
// supabase/migrations/20260926_filter_greetings_trimmed_to_60.sql (the 2026-09-26 replacement) —
// and src/data/loaderFilterGreetings.ts. If the server-side pool later differs from this list, the
// server pool wins as soon as its (bounded) fetch resolves; until then, the baked list still gives
// a real rotation from search #1. That means neither an offline start nor a slow first request can
// ever show the retired «ارحب إزهله» text again.
//
// ONLY the opening of the Filter-search bubble rotates — "أبحث عن ..." onward (the filter summary)
// is untouched, and so is the SEPARATE AI-chat greeting in agent.tsx's greetingText() and the
// Advanced-Filter/interview bubble in interview.tsx. See src/data/search.ts (filterToChat).

export type FilterGreeting = { greeting: string; emoji: string };

// Baked-in list: 60 Arabic openings, the owner's 2026-09-26 trim of the original 100 (authored
// 2026-09-18). Immediately available at import time so the picker never has to wait on a network
// request, so the very first Filter search of a fresh session already reads a random one. Order
// matches the DB rows byte-for-byte, and the DB mirror is asserted equal by
// scripts/verify-filter-greeting-rotation.ts so the two can never drift.
const BAKED: FilterGreeting[] = [
  { greeting: 'هلا', emoji: '👋' },
  { greeting: 'يا هلا', emoji: '🙌' },
  { greeting: 'هلا والله', emoji: '💚' },
  { greeting: 'مرحبا', emoji: '😊' },
  { greeting: 'أرحب', emoji: '✨' },
  { greeting: 'يا مرحبا', emoji: '🤝' },
  { greeting: 'حياك', emoji: '😎' },
  { greeting: 'أهلين', emoji: '🌟' },
  { greeting: 'هلا وغلا', emoji: '🤍' },
  { greeting: 'يا هلا والله', emoji: '🔥' },
  { greeting: 'مرحبتين', emoji: '😄' },
  { greeting: 'أرحب والله', emoji: '🫡' },
  { greeting: 'حيا الله', emoji: '🙏' },
  { greeting: 'يا حي', emoji: '🌴' },
  { greeting: 'هلا هلا', emoji: '🎉' },
  { greeting: 'يا مرحبا والله', emoji: '💫' },
  { greeting: 'أهلًا', emoji: '🌿' },
  { greeting: 'أهلين وسهلين', emoji: '😁' },
  { greeting: 'يا هلا وغلا', emoji: '🏡' },
  { greeting: 'حياك الله', emoji: '☀️' },
  { greeting: 'أرحب مليون', emoji: '🚀' },
  { greeting: 'هلا بالزين', emoji: '😉' },
  { greeting: 'يا مرحبتين', emoji: '🌹' },
  { greeting: 'يالله حيه', emoji: '⚡' },
  { greeting: 'يا هلا فيك', emoji: '🥳' },
  { greeting: 'هلا بك', emoji: '🏠' },
  { greeting: 'يا حيّك', emoji: '😌' },
  { greeting: 'أرحب وألف هلا', emoji: '💯' },
  { greeting: 'يا مرحبا مليون', emoji: '🌧️' },
  { greeting: 'هلا بالطلة', emoji: '🌞' },
  { greeting: 'حيا الله هالطلة', emoji: '🍃' },
  { greeting: 'أهلًا وسهلًا', emoji: '🔎' },
  { greeting: 'هلا من جديد', emoji: '🔄' },
  { greeting: 'يا مرحبا تراحيب', emoji: '🌸' },
  { greeting: 'حياك ربي', emoji: '👌' },
  { greeting: 'هلا فيك', emoji: '🧭' },
  { greeting: 'يا هلا بك', emoji: '💪' },
  { greeting: 'حي الله من جانا', emoji: '🏘️' },
  { greeting: 'أهلين والله', emoji: '😄' },
  { greeting: 'يا حي من لفانا', emoji: '🛬' },
  { greeting: 'مرحبا مليون', emoji: '💎' },
  { greeting: 'هلا والله ومرحبا', emoji: '🎈' },
  { greeting: 'حي الله', emoji: '😊' },
  { greeting: 'يا مرحبا بك', emoji: '🧡' },
  { greeting: 'أهلين فيك', emoji: '🪄' },
  { greeting: 'يا مرحبا', emoji: '🥰' },
  { greeting: 'أرحب تراحيب', emoji: '🌊' },
  { greeting: 'يا هلا بالطلة', emoji: '📍' },
  { greeting: 'حيّاك الله', emoji: '🏙️' },
  { greeting: 'هلا ومرحبا', emoji: '🛋️' },
  { greeting: 'يا مرحبا بالزين', emoji: '🌺' },
  { greeting: 'أهلًا ومرحبًا', emoji: '🎯' },
  { greeting: 'يا حي الله', emoji: '🍀' },
  { greeting: 'أهلًا أهلًا', emoji: '🙋' },
  { greeting: 'يا هلا مليون', emoji: '⭐' },
  { greeting: 'يالله حيّك', emoji: '🎊' },
  { greeting: 'هلا ومرحبتين', emoji: '🧩' },
  { greeting: 'يا هلا يا هلا', emoji: '🎵' },
  { greeting: 'أرحب وألف مرحبا', emoji: '🏅' },
  { greeting: 'هلا بك والله', emoji: '🛎️' },
];

// Live cache: starts equal to BAKED so the very first pick already rotates. The server-side loader
// (loaderFilterGreetings.ts) can OVERWRITE this later with the DB pool for editability without a
// deploy — but never falls BACK below the baked list, so an offline start / failed fetch never
// regresses to the retired «ارحب إزهله 👋» text.
let cache: FilterGreeting[] = BAKED;
let lastIndex = -1;

/** The loader calls this once its RPC settles. A non-empty pool replaces the cache; empty or null is
 *  ignored, so a failed fetch cannot demote the working baked list. */
export function setFilterGreetingsCache(rows: FilterGreeting[] | null): void {
  if (rows && rows.length > 0) {
    cache = rows.filter((g) => g && g.greeting && g.emoji);
    lastIndex = -1;
  }
}

/** True — the cache is always populated (baked-in at import time), so the loader knows it never has
 *  to inject a fallback. Kept for API compatibility with loaderFilterGreetings.ts. */
export function hasFilterGreetingsCache(): boolean {
  return cache.length > 0;
}

/**
 * Builds the opening: "{greeting} إزهله {emoji}، ". Synchronous and never falls back — the baked
 * list guarantees a real rotation from the very first Filter search of a session. Never repeats the
 * immediately-previous pick when 2+ rows are available.
 *
 * Owner rule 2026-09-19: a comma may ONLY appear AFTER the emoji, never before. The trailing "، "
 * separates the greeting-with-emoji from the "أبحث ..." filter summary that follows.
 */
export function pickFilterGreetingOpening(): string {
  const n = cache.length;
  let i = Math.floor(Math.random() * n);
  if (n > 1 && i === lastIndex) i = (i + 1) % n;
  lastIndex = i;
  const { greeting, emoji } = cache[i];
  return `${greeting} إزهله ${emoji}، `;
}

// Test-only export: the baked list itself, so a barrier can assert its exact size and shape.
export const __testing = { BAKED };
