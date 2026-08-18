// A SEARCH MAY ONLY RUN IN RESPONSE TO A USER ACTION INSIDE A LIVE APP SESSION.
// A page load — first visit, refresh, restored tab, pasted URL — is not a user action.
//
// Owner rule, 2026-08-16: "A browser refresh must never accidentally count as a new user search.
// There should be no duplicate AI request, duplicate property-search RPC, duplicate conversation
// message, duplicate analytics event, or duplicate saved conversation caused simply by refreshing."
//
// WHY THIS EXISTS RATHER THAN A TIMER OR A BROWSER FLAG (the owner ruled those out explicitly):
// the agent screen reads `?filter=`/`?seed=` and runs that search. That is correct when the params
// arrive from the Filter pressing «بحث» — a real user action that happens to cross a route — and
// wrong when the identical params arrive because the browser re-loaded the document. The URL cannot
// tell those apart; only WHEN they arrived can. So the app records the one fact that separates them:
// whether its own session was already running.
//
// The flag is flipped one macrotask AFTER the root layout mounts, deliberately: every screen effect
// belonging to that same initial load has already run by then, so it cannot depend on React's
// parent/child effect ordering to be correct. Anything arriving later is, by definition, in-app
// navigation.
//
// Module scope is the right lifetime: it resets on exactly the event it needs to react to — a new
// document load. Nothing is persisted, so no storage to clear and nothing to leak between accounts.
let started = false;

/** Called once by the root layout, after the initial load's effects have all run. */
export function markAppSessionStarted(): void {
  started = true;
}

/**
 * True when this app session was ALREADY running before the caller ran — i.e. the caller was
 * reached by in-app navigation, not by loading the document.
 */
export function isAppSessionStarted(): boolean {
  return started;
}

/** Test-only: restore the pre-boot state so a spec can assert both sides of the rule. */
export function __resetAppSessionForTest(): void {
  started = false;
}
