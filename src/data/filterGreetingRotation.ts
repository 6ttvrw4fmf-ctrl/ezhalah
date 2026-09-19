// PURE cache + picker for the rotating Filter-search → chat bubble opening (owner rule 2026-09-18).
// Lives in its own file, with ZERO dependency on the Supabase client, so a plain-Node barrier can
// import and EXECUTE it directly — the same reason loaderActivePlatforms.ts / loaderPlatforms.ts
// are split (Metro-only path aliases would otherwise break the barrier's plain-Node run). The actual
// RPC fetch lives in loaderFilterGreetings.ts, which pushes its result in here via setCache().
//
// ONLY the opening words of the Filter-search bubble rotate — "أبحث عن ..." onward (the filter
// summary itself) is untouched, and so is the SEPARATE AI-chat greeting (agent.tsx greetingText())
// and the Advanced-Filter/interview bubble (interview.tsx). See src/data/search.ts (filterToChat)
// for the one call site. The rotation pool lives in Supabase (public.ui_filter_greetings /
// ui_filter_greetings_ar()), not hardcoded, per the owner's explicit instruction — see
// supabase/migrations/20260918214451_ui_filter_greetings_rotation.sql.

export type FilterGreeting = { greeting: string; emoji: string };

// The exact pre-rotation fixed opening (owner-authored, live until 2026-09-18) — the safe-
// degradation fallback while the pool is still loading (always true for the FIRST filter search of
// a session — the fetch has not had time to resolve yet) or if the RPC ever fails. Every search
// after the first successful fetch reads the live rotation; this line never regresses behavior
// below what shipped before this feature (A FAILED FETCH IS NOT AN EMPTY ANSWER).
const FALLBACK_OPENING = 'ارحب إزهله 👋، ';

let cache: FilterGreeting[] | null = null;
let lastIndex = -1;

/** Pushes a freshly-resolved pool (or `[]` on any failure) into the cache. Called ONLY from
 *  loaderFilterGreetings.ts once its RPC call settles. */
export function setFilterGreetingsCache(rows: FilterGreeting[] | null): void {
  cache = rows;
  lastIndex = -1;
}

/** True once a fetch has resolved (success or failure) — lets the loader avoid firing twice. */
export function hasFilterGreetingsCache(): boolean {
  return cache != null;
}

/**
 * Builds the rotating opening: "{greeting}، إزهله {emoji}، ". Synchronous, so filterToChat()
 * (a plain function, not a React component) can call it with no network wait on the hot path.
 * Falls back to the exact pre-rotation fixed line whenever nothing is cached yet, or the pool is
 * empty. Never repeats the immediately-previous pick when 2+ rows exist.
 */
export function pickFilterGreetingOpening(): string {
  if (!cache || cache.length === 0) return FALLBACK_OPENING;
  let i = Math.floor(Math.random() * cache.length);
  if (cache.length > 1 && i === lastIndex) i = (i + 1) % cache.length;
  lastIndex = i;
  const { greeting, emoji } = cache[i];
  return `${greeting}، إزهله ${emoji}، `;
}

// Test-only export: the exact fallback string, so a barrier can assert against it by identity
// rather than re-typing the literal (and silently drifting from it).
export const __testing = { FALLBACK_OPENING };
