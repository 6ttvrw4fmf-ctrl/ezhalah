#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
// PRE-MERGE static guard — the district catalog's live-fallback exclusion cannot be quietly
// dropped by a future migration, ever.
//
// Owner, 2026-09-11: "we never want it happening [again]. add as many barriers." Migration
// 20260911201716 taught refresh_loc_canonical_district() to exclude internal plan/parcel codes via
// public.district_ar_looks_bogus(); migration 20260911211255 added a runtime self-check inside that
// same function AND a standing mon_detect_district_catalog_pollution() detector. Both of those only
// fire AFTER a regressed migration is applied. This is the earlier layer: it reads git history
// itself and fails the PR BEFORE merge if the most recent migration redefining
// refresh_loc_canonical_district() has dropped the exclusion call.
//
// migrations/*.sql accumulate; whichever file most recently did
// `CREATE OR REPLACE FUNCTION public.refresh_loc_canonical_district` is the one whose body actually
// runs in production (CREATE OR REPLACE fully replaces the prior definition — pg_get_functiondef
// only ever reflects the LAST one applied). Reads real files, on the real filesystem, sorted by
// their own timestamp-prefixed names — the same ordering Supabase applies them in.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const FUNCTION_NAME = 'refresh_loc_canonical_district';
const REQUIRED_CALL = 'district_ar_looks_bogus';

/** Pure — the body of the LAST `CREATE OR REPLACE FUNCTION public.<fn>` block found across a set of
 *  migration files (in filename order), or null if the function is never defined. Exported so the
 *  mutation proof below exercises the exact function this barrier's verdict comes from. */
export function latestFunctionBody(files: { name: string; sql: string }[], fnName: string): string | null {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fnName}\\b`, 'i');
  let last: string | null = null;
  for (const f of sorted) {
    const m = re.exec(f.sql);
    if (!m) continue;
    // Take from the match to the function's closing `$function$;` / `$$;` delimiter (whichever
    // dollar-tag this particular migration used) — or to EOF if the tag never closes in this file
    // (should not happen in a well-formed migration, but never silently grab the WRONG delimiter).
    const tail = f.sql.slice(m.index);
    const tagMatch = /\$(\w*)\$/.exec(tail);
    if (!tagMatch) { last = tail; continue; }
    const closeIdx = tail.indexOf(tagMatch[0], tagMatch.index! + tagMatch[0].length);
    last = closeIdx === -1 ? tail : tail.slice(0, closeIdx + tagMatch[0].length);
  }
  return last;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// ── MUTATION PROOF (executable — this barrier is watched failing, not assumed to work) ────────────
const OLD_GOOD = { name: '20260101000000_old.sql', sql: `CREATE OR REPLACE FUNCTION public.${FUNCTION_NAME}() RETURNS bigint LANGUAGE plpgsql AS $function$ begin return 1; end; $function$;` };
const WITH_GUARD = (ts: string) => ({ name: `${ts}_x.sql`, sql: `CREATE OR REPLACE FUNCTION public.${FUNCTION_NAME}() RETURNS bigint LANGUAGE plpgsql AS $function$ begin if public.${REQUIRED_CALL}(x) then return 0; end if; return 1; end; $function$;` });
const WITHOUT_GUARD = (ts: string) => ({ name: `${ts}_y.sql`, sql: `CREATE OR REPLACE FUNCTION public.${FUNCTION_NAME}() RETURNS bigint LANGUAGE plpgsql AS $function$ begin return 1; end; $function$;` });

const mustCatch = (label: string, ok: boolean) => check(`mutation caught: ${label}`, !ok);

// M-1: the ONLY migration ever written already lacks the guard.
mustCatch('the function has never once carried the guard call',
  (latestFunctionBody([WITHOUT_GUARD('20260910000000')], FUNCTION_NAME) ?? '').includes(REQUIRED_CALL));
// M-2: a LATER migration re-defines the function WITHOUT the guard, after an earlier one HAD it —
// the exact shape of someone "simplifying" the function later and forgetting the exclusion.
mustCatch('a later migration drops the guard that an earlier one had',
  (latestFunctionBody([WITH_GUARD('20260910000000'), WITHOUT_GUARD('20260911000000')], FUNCTION_NAME) ?? '').includes(REQUIRED_CALL));
// M-3: file ORDER must be by name, not array order — feed the regressed file FIRST in the array,
// prove the checker still finds it as latest by its (later) timestamp name, not by list position.
mustCatch('file order is read from the FILENAME timestamp, not array position',
  (latestFunctionBody([WITHOUT_GUARD('20260911000000'), WITH_GUARD('20260910000000')], FUNCTION_NAME) ?? '').includes(REQUIRED_CALL));
// Negative control — a genuinely guarded latest definition must NOT be flagged, or every proof
// above would be passing vacuously against a checker that is blind for everything.
check('a genuinely guarded latest definition is NOT flagged',
  (latestFunctionBody([WITHOUT_GUARD('20260910000000'), WITH_GUARD('20260911000000')], FUNCTION_NAME) ?? '').includes(REQUIRED_CALL));
// The function must exist at all, or a migration that DELETES it entirely (DROP FUNCTION with no
// replacement) reads as "no violation found" by an empty-string vacuity, not a real pass.
check('a function that was never defined is reported as null, not silently ignored',
  latestFunctionBody([OLD_GOOD], 'a_function_name_that_does_not_exist_anywhere') === null);

// ── the real check, against the real repository ────────────────────────────────────────────────
const files = readdirSync(MIGRATIONS_DIR)
  .filter((n) => n.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
check(`${files.length} migration files scanned`, files.length > 500, `only found ${files.length} — is MIGRATIONS_DIR wrong?`);

const body = latestFunctionBody(files, FUNCTION_NAME);
check(`public.${FUNCTION_NAME}() has been defined at least once`, body !== null);
check(`the MOST RECENT definition of public.${FUNCTION_NAME}() still calls ${REQUIRED_CALL}()`,
  !!body && body.includes(REQUIRED_CALL),
  'a later migration redefined this function without the internal-plan-code exclusion — the exact '
  + 'Advanced Filter district-dropdown pollution reported 2026-09-11 would silently return');

console.log(failed === 0
  ? '\n✓ refresh_loc_canonical_district() still excludes internal plan/parcel codes, and this check can prove it either way'
  : `\n✗ ${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
