// Automated test — the age expression indexes that keep cron jobid 22 under its statement timeout
// must stay in the migration history, and must stay DATA-DRIVEN. 2026-08-09.
//
// CONTEXT
// jobid 22 (loc_rel_refresh_tick) failed ~1x/day with:
//     ERROR: canceling statement due to statement timeout
//     CONTEXT: SQL function "age_from_text_ar" statement 1
// listing_native_location_v2 has a UNION arm filtering on an opaque IMMUTABLE function:
//     age_from_text_ar(additional_info->>'property_age_text') between 0 and 100
// With no statistics for that expression the planner estimated rows=1 (actual 198) and chose a
// Nested Loop, re-running the arm once per outer row. Measured on dealapp_commercial_listings —
// 287 active rows — the arm ran with loops=351, each a full Seq Scan evaluating the function twice
// per row: ~247,000 regex-heavy calls for a 287-row table.
//     BEFORE: Seq Scan,   Execution Time 9,741 ms
//     AFTER : Index Scan, Execution Time    77 ms      (126x; the timeout stopped)
// CREATE STATISTICS on the same expression was tried first and did NOT move the estimate
// (9,742ms -> 9,731ms, identical plan). Only the expression index does.
//
// WHY THIS FILE EXISTS
// The indexes are the whole fix. If the migration is deleted or rewritten to a hardcoded table
// list, a platform table added later silently loses its index and jobid 22 starts timing out on
// that table — a slow, confusing regression whose only symptom is a nightly cron failure.
//
// Run: node --experimental-strip-types scripts/verify-loc-rel-age-expression-indexes.ts
// (wired into `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) { failed++; if (detail) console.error(`  ${detail}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url).pathname;
const files = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql'));

const migName = files.find((f) => f.includes('loc_rel_age_expression_index'));
check('the age expression-index migration is still in the history', migName !== undefined,
      'expected a migration matching *loc_rel_age_expression_index*');

if (migName) {
  const sql = readFileSync(join(MIG_DIR, migName), 'utf8');

  check('it indexes the exact expression the v2 age arm filters on',
        /age_from_text_ar\(additional_info->>''property_age_text''\)/.test(sql),
        'the index expression must match the view predicate byte-for-byte or the planner ignores it');

  check('it is DATA-DRIVEN over the catalog, not a hardcoded table list',
        /FROM pg_class c/i.test(sql) && /relname LIKE '%\\_listings'/.test(sql),
        'a hardcoded list silently skips platform tables added later');

  check('it is idempotent (IF NOT EXISTS), so re-running is safe',
        /CREATE INDEX IF NOT EXISTS/i.test(sql));

  check('it only indexes live rows (partial index on active)',
        /WHERE active/i.test(sql));

  check('it records WHY, with the measured before/after',
        /9741|9,741/.test(sql) && /77 ms|77ms/.test(sql),
        'the timing evidence is what stops someone "cleaning up" these indexes');

  // The fix must not have been implemented by weakening the timeout or the refresh instead.
  // Naming statement_timeout in the rationale is fine; SETTING it is the regression.
  const sqlNoComments = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
  check('it does NOT raise or remove the statement timeout',
        !/(SET|ALTER)[^\n]*statement_timeout/i.test(sqlNoComments),
        'raising the timeout hides the misestimate instead of fixing it, and blocks the rotation');
  check('it does NOT alter the refresh procedure or the view',
        !/CREATE OR REPLACE (PROCEDURE|FUNCTION|VIEW)/i.test(sql),
        'this is a pure plan fix — it must not change any behaviour or result');
}

console.log(failed === 0
  ? '\n✓ loc_rel age expression indexes are protected (jobid 22 timeout fix intact)'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
