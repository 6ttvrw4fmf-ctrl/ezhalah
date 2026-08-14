// Where a HARD WEB REFRESH lands. Zero-dep and pure so the permanent guard
// (scripts/verify-refresh-restores-filter-search.ts) can execute the real decision, not grep for it.
//
// Background: on the web a refresh reloads whatever deep route the user was on. Most screens keep
// their state in memory only, so they would come back empty — those are sent Home on purpose.
// `/agent` is the exception: a Filter search routes there as `/agent?filter=<JSON SearchQuery>` (and
// a "Start here" chip as `?seed=…`), i.e. the WHOLE query — «شراء»/«إيجار», «سنوي»/«شهري», المدينة,
// الأحياء, فئة/نوع, غرف النوم, السعر, المساحة — travels in the URL, and agent.tsx re-runs it on open.
// Sending that Home silently discarded every selection the user had made (and broke bookmarked and
// shared result links), even though the screen could rebuild itself perfectly. (QA 2026-08-14.)

/** Routes that own their state and must never be sent Home by the refresh guard. */
const SELF_RESTORING_PATH = '/agent';
/** Already-Home / auth-callback paths the guard never touches. */
const EXEMPT_PATHS = new Set(['/', '/auth']);

/**
 * True when the URL carries state the destination screen can rebuild itself from.
 * Only a PARSEABLE `filter` object or a non-empty `seed` counts — a malformed value would leave the
 * screen empty, so those still go Home.
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
  if (pathname === SELF_RESTORING_PATH && hasRestorableQuery(search)) return false;
  return true;
}
