// Where a HARD WEB REFRESH lands. Zero-dep and pure so the permanent guard
// (scripts/verify-refresh-restores-filter-search.ts) can execute the real decision, not grep for it.
//
// Background: on the web a refresh reloads whatever deep route the user was on. Most screens keep
// their state in memory only, so they would come back empty — those are sent Home on purpose.
//
// `/agent` was the one exception, and it is no longer. The rule there changed TWICE on 2026-08-16,
// both times by owner decision — read both, because the second only makes sense on top of the first:
//
//  1. Refresh must never re-run the search:
//     "A browser refresh must never accidentally count as a new user search. There should be no
//      duplicate AI request, duplicate property-search RPC, duplicate conversation message,
//      duplicate analytics event, or duplicate saved conversation caused simply by refreshing."
//     That made the post-refresh state an EMPTY AI chat (greeting + empty composer).
//
//  2. Then, seeing that empty screen: "when i refresh takes me to the filter page … not this here."
//     An emptied AI chat is a dead end — the Filter home is where a fresh visit belongs. So `/agent`
//     now follows the SAME rule as every other deep route: a hard refresh lands on Home.
//
// Rule 1 is untouched and still enforced independently: the session gate in src/lib/appSession.ts
// (consulted by agent.tsx before it acts on any param) is what guarantees ZERO AI/RPC calls on a
// reload. This file only decides WHERE the refresh lands, never whether a search runs — so the
// redirect cannot reintroduce duplicate execution even if a load reaches the agent screen first.
//
// ⚡ WHY THE SAME REDIRECT ALSO EXISTS IN vercel.json (`/agent` → `/`, 307), and why that is not a
// duplicate to "clean up": this module can only run AFTER the whole JS bundle has downloaded and
// booted. On a hard refresh that is seconds of dead screen before the redirect fires — the owner's
// report was literally "still get stuck then it shows filter". The edge rule answers the document
// request immediately, so a refresh never loads the AI page at all. Only REAL document requests hit
// it; in-app navigation to الوكيل الذكي is client-side routing and never asks the server.
// This module remains the native path (no Vercel there), the rule for every other deep route, and
// the fallback if the edge rule is ever removed. Keep both; they are one decision at two layers.
//
// A signed-in user does not lose that conversation: it is written to their history at SEARCH time
// (store.tsx recordHistory → `history:<sub>`, de-duped by query so a repeat can never fork a second
// copy), and it stays in the left sidebar to reopen on purpose. Guests keep no visible history.
//
// DO NOT "fix" this by restoring a search on load. That reintroduces the duplicate-execution class
// the owner rejected; the barrier in scripts/verify-refresh-restores-filter-search.ts enforces it.

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
  // Every other deep route — including `/agent` since 2026-08-16 (owner: "when i refresh takes me to
  // the filter page … not this here") — comes back on Home. With or without params: `?filter=`/
  // `?seed=` on a page load are never executable anyway (appSession gate), so carrying them to an
  // emptied chat only produced a dead-end screen.
  return true;
}

/**
 * The contract, stated once so both the app and its barrier read the same sentence:
 * a reload of the AI surface lands on the Filter home and executes nothing.
 *
 * Both halves matter. "Executes nothing" is rule 1 (appSession gate, still enforced in agent.tsx);
 * "lands on the Filter home" is rule 2 (this module). A change that satisfies only one of them is
 * a regression of the other.
 */
export const AGENT_REFRESH_LANDS_HOME = true;
