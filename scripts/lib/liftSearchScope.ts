// ONE lift spec for the searchable-table scope — because five barriers had five copies of it.
//
// WHY THIS EXISTS (2026-09-04, found the hard way). PR #1653 made RES_TABLES/COM_TABLES DERIVED —
// `const RES_TABLES = SEARCHABLE_TABLES.filter(...);` — one line each, ending in `);`. Four barriers
// had their lift specs updated with it. The fifth, scripts/verify-af-matrix-truth-live.ts, still
// asked for `{ header: 'const RES_TABLES', endsWith: /\];$/ }`. No line there ends in `];` any more,
// so the slice ran forward to the next one it could find (DEEPLINK_TABLES), swallowing COM_TABLES on
// the way — and the lifted module then declared COM_TABLES twice:
//
//     SyntaxError: Identifier 'COM_TABLES' has already been declared
//
// The whole live matrix died before its first assertion. It is a LIVE check, excluded from
// `npm test` by design, so nothing in CI ever compiled it: the barrier was broken for as long as it
// took someone to run it by hand. That is the same shape as the defect #1653 fixed — one fact, five
// hand-maintained copies, and the copy nobody looked at is the one that drifts.
//
// So the spec lives here once. Four of the five callers ARE in `npm test`, which means a change to
// src/data/remote.ts that breaks the lift now fails on the PR that makes it, not on a nightly.
import { join } from 'node:path';
import { liftSymbols } from './liftSymbols.ts';

/** The three query fields the lifted code actually reads. Not `any`: a rename must break loudly. */
export type ScopeQuery = { deal?: string; rentPeriod?: string; dealCombined?: boolean };

export type SearchScopeSymbols = {
  SEARCHABLE_TABLES: string[];
  RES_TABLES: string[];
  COM_TABLES: string[];
  DEEPLINK_TABLES: string[];
  monthlyInScope: (q: ScopeQuery) => boolean;
  resTables: (q: ScopeQuery) => string[];
  comTables: (q: ScopeQuery) => string[];
};

/** Lift and EXECUTE the real scope out of src/data/remote.ts. Throws if any symbol is missing. */
export async function liftSearchScope(root: string): Promise<SearchScopeSymbols> {
  const m = await liftSymbols(
    join(root, 'src/data/remote.ts'),
    [
      { header: 'const SEARCHABLE_TABLES = [', endsWith: /\];$/ },
      { header: 'const MONTHLY_ONLY_TABLE = ', endsWith: /;$/ },
      { header: 'const RES_TABLES = ', endsWith: /;$/ },
      { header: 'const COM_TABLES = ', endsWith: /;$/ },
      { header: 'const DEEPLINK_TABLES = [', endsWith: /^\];$/ },
      { header: 'function monthlyInScope(' },
      { header: 'function monthlyOnly(' },
      { header: 'function resTables(' },
      { header: 'function comTables(' },
    ],
    ['SEARCHABLE_TABLES', 'RES_TABLES', 'COM_TABLES', 'DEEPLINK_TABLES', 'monthlyInScope', 'resTables', 'comTables'],
    'type SearchQuery = { deal?: string; rentPeriod?: string; dealCombined?: boolean };\n',
  );
  return m as unknown as SearchScopeSymbols;
}
