// THE SCOPE THE USER'S BROWSER ACTUALLY HOLDS — not the one main claims to have.
//
// WHY THIS EXISTS (routine #9, ops_incident #731, 2026-09-25). أبعاد (abaad) had 380 rows live and
// searchable in `search_listings_ar` — 368 residential, 12 commercial — and NO user could reach one
// of them. The served production bundle carried a 207-table `SEARCHABLE_TABLES`; abaad's two tables
// were not in it, so `p_tables` never named them, in any scope. The repair (e49b25a,
// SEARCHABLE_TABLES 207 → 209) was MERGED on main and NOT SERVED: production was on 7434ddb while
// main sat 24 commits ahead, and the frontend deploy was hard-blocked by the global migration-drift
// gate for ~7 hours.
//
// EVERY LAYER THAT COULD HAVE SEEN IT WAS GREEN, AND EACH FOR ITS OWN REASON:
//
//   • `scripts/verify-searchable-scope-matches-inventory.ts` asks exactly the right question —
//     "is a platform live in search absent from the client scope?" — but it lifts resTables/comTables
//     out of `src/data/remote.ts` IN THE CHECKOUT. It answers it about MAIN. The moment e49b25a
//     merged it went green, while every real user still met the 207-table scope. A check reading the
//     source tree cannot see a bundle that never shipped.
//
//   • `e2e/live-sweep`'s six-layer chain drives the SERVED app and compares it to an independent
//     PostgREST oracle — but that oracle is built FROM THE APP'S OWN REQUEST, and
//     `dbFilterFromRequest` translates the captured `p_tables` straight through as
//     `source_table.in.(…)` (sweep.mjs:827). When the scope is the thing that is wrong, the oracle
//     inherits the defect and agrees with the product for the wrong reason. This is PART 2.2 of
//     `docs/ops/PRODUCTION_RED_TEAM_ENGINEER.md` in its sharpest form: the oracle is independent in
//     its PREDICATES and not in its SCOPE, and scope is a predicate.
//
//   • `scripts/verify-undeployed-user-visible-drift-live.ts` WAS red, correctly — but its evidence is
//     git metadata (recorded baseline commit vs head), not the bundle. It says "8 files differ", not
//     "a platform is unreachable", and it is only as true as the baseline record, which
//     `ops_incident` #651 already measured going stale for three days.
//
// So the class "a platform holds live inventory and the SERVED app cannot reach it" was covered by
// nothing that reads the served bytes. This module is that reading. It is the served-side twin of
// verify-searchable-scope-matches-inventory.ts and asks its question of production's own bundle.
//
// THE TECHNIQUE IS NOT A GREP FOR THE NAME. A bare `bundle.includes('abaad')` would be satisfied by
// any unrelated mention — a logo key, an i18n string, a SOURCE_TOKENS entry — while the search scope
// stayed 207 long. `scripts/verify-frontend-bundle-matches-source-live.ts` already learned this the
// hard way for amenity tokens ("a RUNTIME-APPENDED token whose push() call site never shipped, even
// though the word appears elsewhere"). So this extracts the ARRAY: the longest run of quoted
// `<name>_(residential|commercial)_listings` literals joined by commas, which is what
// SEARCHABLE_TABLES minifies to and what nothing else in the bundle looks like.

/** A table production holds, with the count of rows a user should be able to reach. */
export type LiveTable = { table: string; productionReadyRows: number };

/**
 * The tables named by the longest quoted, comma-joined run of `*_listings` literals in `bundle`.
 *
 * SEARCHABLE_TABLES is emitted by the bundler as one flat array literal, so it is the longest such
 * run by a wide margin — measured 2026-09-25 against the real served bundle
 * (entry-e2059aa8ec6ab1a404b969ae4dbbd59e.js, 7,014,751 bytes): 211 quoted table tokens in total,
 * of which the longest contiguous run is the 207-element scope; the strays are single mentions
 * elsewhere that are not comma-adjacent to anything.
 *
 * Returns `[]` when nothing matches. THE CALLER MUST TREAT THAT AS A FAILURE, never as "no tables" —
 * an extraction that produced nothing is a broken check, not a clean one. `servedScopeProblems`
 * enforces that, so the rule cannot be forgotten at a call site.
 */
export function extractServedSearchableTables(bundle: string): string[] {
  const TOKEN = /(['"])([a-z0-9_]+_(?:residential|commercial)_listings)\1/g;
  let best: string[] = [];
  let run: string[] = [];
  let runEnd = -1;

  for (let m = TOKEN.exec(bundle); m !== null; m = TOKEN.exec(bundle)) {
    // Contiguous means the previous literal ended, then exactly a comma, then this one began.
    // Anything else — a bracket, whitespace, a property name — starts a new run. Deliberately
    // strict: a loose join would let two unrelated arrays merge into one phantom "scope".
    const adjacent = runEnd >= 0 && bundle.slice(runEnd, m.index) === ',';
    run = adjacent ? [...run, m[2]] : [m[2]];
    runEnd = m.index + m[0].length;
    if (run.length > best.length) best = run;
  }
  return best;
}

/**
 * Everything wrong with what the SERVED bundle can reach, as human-readable lines. Empty means the
 * served scope and production's live inventory agree.
 *
 * Both directions, mirroring verify-searchable-scope-matches-inventory.ts's own vocabulary:
 *   UNREACHABLE — production holds production_ready rows in a table the served scope never names.
 *                 That is THE INCIDENT: inventory Ezhalah has and no user can reach.
 *   PHANTOM     — the served scope names a table production DOES NOT HAVE. A rename or a drop that
 *                 shipped; the scope describes an index that is gone.
 *
 * `absentFromProduction` IS A SEPARATE INPUT, AND THAT IS THE WHOLE POINT (measured 2026-09-25, the
 * first live run of this barrier). The first draft derived PHANTOM as `served \ live`, and it
 * immediately accused الحميدان's two tables. That was the BARRIER being wrong, not the product: those
 * tables exist in production and hold three rows, all «تم الإيجار», so the platform contributes no
 * production_ready inventory and drops out of `loader_active_platforms_ar()` — while a scope that
 * still names it is correct and harmless. الحميدان is a RECORDED OPEN OWNER QUESTION (2026-09-24,
 * PR #4298), so a barrier that reddened over it would have been crying wolf over a decision already
 * on the owner's desk. "Not in the active fleet" and "not in production" are different facts;
 * verify-searchable-scope-matches-inventory.ts already draws exactly this distinction for its own
 * EXTRA direction by probing each table for a 404, and the caller here must do the same and hand the
 * answer in. A predicate that cannot tell a staged platform from a dropped one is the "barrier
 * nobody believes" its sibling's comment warns about.
 *
 * `live` must be the FULL live table set, not a sample: a caller that could only read part of
 * production must fail before calling this, never pass a short list and read a clean answer.
 */
export function servedScopeProblems(
  served: readonly string[],
  live: readonly LiveTable[],
  absentFromProduction: readonly string[] = [],
): string[] {
  const problems: string[] = [];

  // An empty or implausible extraction is the failure mode that would make every other assertion
  // below vacuously true — zero served tables means zero PHANTOMs, and the UNREACHABLE list would
  // name the entire fleet, which reads as an obvious harness fault rather than a product one. Say
  // so explicitly instead, and fail.
  if (served.length === 0) {
    problems.push(
      'no SEARCHABLE_TABLES array could be extracted from the served bundle — the app may have '
      + 'changed how it ships its search scope. This check is BLIND until that is repaired; it is '
      + 'not evidence that the scope is fine.',
    );
    return problems;
  }
  if (served.length < 20) {
    problems.push(
      `only ${served.length} table(s) extracted from the served bundle — far below any plausible `
      + 'fleet. Treat as a broken extraction, not a tiny scope.',
    );
    return problems;
  }

  const servedSet = new Set(served);

  const unreachable = live
    .filter((t) => t.productionReadyRows > 0 && !servedSet.has(t.table))
    .sort((a, b) => b.productionReadyRows - a.productionReadyRows);
  if (unreachable.length) {
    const total = unreachable.reduce((n, t) => n + t.productionReadyRows, 0);
    problems.push(
      `UNREACHABLE: ${total.toLocaleString()} production_ready row(s) in `
      + `${unreachable.length} table(s) that the SERVED scope never names, so no user search can `
      + `return one: ${unreachable.map((t) => `${t.table} (${t.productionReadyRows.toLocaleString()})`).join(', ')}`,
    );
  }

  const phantom = absentFromProduction.filter((t) => servedSet.has(t));
  if (phantom.length) {
    problems.push(
      `PHANTOM: the SERVED scope names ${phantom.length} table(s) production does not have — a `
      + `rename, a drop, or a typo that shipped: ${phantom.join(', ')}`,
    );
  }

  return problems;
}
