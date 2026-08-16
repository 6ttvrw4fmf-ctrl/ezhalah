// Where a HARD WEB REFRESH lands. Zero-dep and pure so the permanent guard
// (scripts/verify-refresh-restores-filter-search.ts) can execute the real decision, not grep for it.
//
// Background: on the web a refresh reloads whatever deep route the user was on. Most screens keep
// their state in memory only, so they would come back empty — those are sent Home on purpose.
//
// `/agent` is the exception, and the REASON changed on 2026-08-16 (owner decision). It used to be
// exempt because `?filter=` carried the whole search and the screen re-ran it on open, so a refresh
// "restored" the results. The owner ruled that behaviour out:
//
//     "A browser refresh must never accidentally count as a new user search. There should be no
//      duplicate AI request, duplicate property-search RPC, duplicate conversation message,
//      duplicate analytics event, or duplicate saved conversation caused simply by refreshing."
//
// The intended state after a refresh is now the AI HOME / NEW-CHAT screen — a fresh empty composer —
// for guests and signed-in users alike. So `/agent` is still never redirected, but for the opposite
// reason: it is now the DESTINATION. agent.tsx consumes `?filter=`/`?seed=` the moment it acts on
// them (see consumeSearchParams), so by the time any refresh happens the URL is already a bare
// `/agent` and the screen simply renders its new-chat state. There is no search left to replay.
//
// A signed-in user does not lose that conversation: it is written to their history at SEARCH time
// (store.tsx recordHistory → `history:<sub>`, de-duped by query so a repeat can never fork a second
// copy), and it stays in the left sidebar to reopen on purpose. Guests keep no visible history.
//
// DO NOT "fix" this by restoring a search on load. That reintroduces the duplicate-execution class
// the owner rejected; the barrier in scripts/verify-refresh-restores-filter-search.ts enforces it.

/** The AI chat surface. It owns its own new-chat state, so a refresh is never bounced off it. */
const AGENT_PATH = '/agent';
/** Already-Home / auth-callback paths the guard never touches. */
const EXEMPT_PATHS = new Set(['/', '/auth']);

/**
 * True when the URL still carries an unconsumed search intent.
 *
 * Kept (rather than deleted with the old restore behaviour) because it states the one fact the
 * refresh contract depends on: after agent.tsx consumes the params, a reloaded `/agent` URL must
 * carry NOTHING that could be re-executed. The barrier asserts exactly that, so a future change
 * that starts leaving `?filter=` in the URL fails loudly instead of silently re-running searches.
 */
export function hasRestorableQuery(search: string): boolean {
  const params = new URLSearchParams(search || '');
  const seed = params.get('seed');
  if (seed && seed.trim()) return true;
  const filter = params.get('filter');
  if (!filter) return false;
  try {
    const q: unknown = JSON.parse(filter);
    return !!q && typeof q === 'object' && !Array.isArray(q);
  } catch {
    return false;
  }
}

/** Should a hard web refresh on this route be redirected Home? */
export function shouldSendRefreshHome(pathname: string | null | undefined, search: string): boolean {
  if (!pathname) return false;
  if (EXEMPT_PATHS.has(pathname)) return false;
  // The AI chat surface is the refresh destination itself — never bounce it Home, with or without
  // params. (A param-carrying reload is only reachable if a user hand-edits or bookmarks a URL mid
  // hop; agent.tsx still starts a new chat in that case — see AGENT_REFRESH_STARTS_NEW_CHAT.)
  if (pathname === AGENT_PATH) return false;
  return true;
}

/**
 * The contract, stated once so both the app and its barrier read the same sentence:
 * a reload of the AI surface starts a NEW CHAT and executes nothing.
 */
export const AGENT_REFRESH_STARTS_NEW_CHAT = true;
