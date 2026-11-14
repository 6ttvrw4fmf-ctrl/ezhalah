// A failed results call is never «a plain search landed» (🦅 2026-11-14, af-live-truth run 43497097270).
//
// The mobile and desktop card-evidence journeys stored every location_search_candidates_ar response as `rows`. Under a
// 429 the body is PostgREST's error OBJECT, so «a plain search landed» PASSED on a failed request and the next line died
// on `(plain.rows ?? []).every is not a function` — two FATALs that said nothing about the card (backlog 1108 learned
// nothing). This EXECUTES the real searchRows() lifted from verify-af-card-evidence-live.ts (importing it would drive
// production) and pins that the listener routes a non-row answer to failedSearches.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const SRC = join(import.meta.dirname, 'verify-af-card-evidence-live.ts');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failed++;
};
const mutation = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

const m = await liftSymbols(SRC, [{ header: 'export const searchRows', endsWith: /;\s*$/ }], ['searchRows']);
const searchRows = m.searchRows as (ok: boolean, json: unknown) => unknown[] | null;
const ERR429 = { code: 'PGRST', message: 'Too Many Requests', details: null, hint: null };

/** The contract: rows only from a 200 that answered an array; every failure is null. */
const holds = (f: (ok: boolean, json: unknown) => unknown[] | null) =>
  Array.isArray(f(true, [{ total_count: 3 }])) && Array.isArray(f(true, []))
  && f(false, ERR429) === null && f(true, ERR429) === null && f(false, [{ total_count: 3 }]) === null;

check('a 200 with rows (or a genuine empty array) is a search', holds(searchRows));
check('a 429 error object is NOT rows', searchRows(false, ERR429) === null);
mutation('the old «store whatever came back» reader is caught', !holds((_ok, j) => j as unknown[]));
mutation('a reader that checks only res.ok (an error object under 200) is caught', !holds((ok, j) => (ok ? (j as unknown[]) : null)));
mutation('a reader that checks only the shape (rows under a 500) is caught', !holds((_ok, j) => (Array.isArray(j) ? j : null)));

const src = readFileSync(SRC, 'utf8');
check('the listener pushes only searchRows() answers and counts the rest as failed',
  /const rows = searchRows\(res\.ok\(\), await res\.json\(\)\);\s*\n\s*if \(rows\) searches\.push\(\{ body, rows \}\); else failedSearches\.push\(res\.status\(\)\);/.test(src));
check('«a plain search landed» names the failed calls when none answered', /failed call\(s\), HTTP/.test(src));

console.log(failed === 0 ? '\n✓ a failed results call is reported as failed, never read as rows' : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
