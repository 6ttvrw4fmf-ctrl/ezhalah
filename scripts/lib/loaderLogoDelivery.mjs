// The verdict for «do the search loader's logos reach a phone in time?» — ONE predicate, shared by the
// live post-deploy gate (scripts/verify-live-loader-logos.ts) and its offline mutation proof
// (scripts/verify-loader-logos-prefetched.ts), so the proof is about the code that decides production.
//
// Earned 2026-10-25: the owner's iPhone showed every loader tile as a name and an empty frame. The logos
// were served, but `max-age=0, must-revalidate` made every search re-download ~145 of them on mobile data.

export const LOGO_PATH = /\/assets\/.*platform-logos\/[^/?]+\.png(\?|$)/;
// The catalog holds ~145 web logos; fewer than this after the prefetch means the prefetch did not run.
export const MIN_PREFETCHED_LOGOS = 100;

/**
 * @param {{ url: string, status: number, cacheControl: string }[]} firstVisit  logo responses a FRESH
 *        browser received on the home page, before any search
 * @param {{ url: string, fromCache: boolean, status: number }[]} repeatVisit  logo responses on a second
 *        load in the SAME browser; a phone that kept the logos asks the network for none of them
 * @returns {string[]} problems; empty means the logos reach a phone in time
 */
export function logoDeliveryProblems(firstVisit, repeatVisit) {
  const problems = [];
  const first = firstVisit.filter((r) => LOGO_PATH.test(r.url));
  const unique = new Set(first.map((r) => r.url.split('?')[0]));
  if (unique.size < MIN_PREFETCHED_LOGOS) {
    problems.push(`only ${unique.size} logos were fetched on the home page before any search (need ≥ ${MIN_PREFETCHED_LOGOS}) — the prefetch did not run, so the loader downloads them while it is on screen`);
  }
  const bad = first.filter((r) => r.status !== 200);
  if (bad.length) problems.push(`${bad.length} logo(s) did not load (e.g. ${bad[0].status} ${bad[0].url})`);
  const notKept = first.filter((r) => !/\bimmutable\b/.test(r.cacheControl || '') || !/max-age=(\d{7,})/.test(r.cacheControl || ''));
  if (notKept.length) problems.push(`${notKept.length} logo(s) are not cached long-term (e.g. "${notKept[0].cacheControl}" on ${notKept[0].url}) — phones re-download them on every search`);
  const refetched = repeatVisit.filter((r) => LOGO_PATH.test(r.url) && !r.fromCache);
  if (refetched.length) problems.push(`${refetched.length} logo(s) went back to the network on a second visit (e.g. ${refetched[0].status} ${refetched[0].url}) — the phone did not keep them`);
  return problems;
}
