// SECURITY (owner-approved plan, Phase 1.1, 2026-10-20): maintenance jobs and the raw-predicate function are not
// callable with the publishable key.
//
// THE HOLE. Fifteen SECURITY INVOKER functions — so outside the 2026-10-18 SECURITY DEFINER lockdown — were
// EXECUTE-able by anon/authenticated: ops_af_option_db_truth spliced the caller's raw text into dynamic SQL (anyone
// could run their own read query, a free 20 s DoS lever), and the rest were batch repairs/syncs/rebuilds any visitor
// could start. Migration *_maintenance_functions_are_not_a_public_api.sql revokes them from public/anon/authenticated
// and keeps service_role. Measured live after apply: the public key now gets 401 "permission denied" on them, and a
// real Filter search still returns cards. This barrier reads the committed SQL: dropping a function from the list,
// or weakening the revoke, turns it red.
//   node --experimental-strip-types scripts/verify-maintenance-functions-are-not-public.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_maintenance_functions_are_not_a_public_api\.sql$/.test(f)).sort().at(-1);
if (!file) { console.log('FAIL  migration *_maintenance_functions_are_not_a_public_api.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');

const MUST_CLOSE = [
  'ops_af_option_db_truth(text,text,text,text)', 'ops_af_option_truth_sweep(text,text,text,integer,boolean,integer,integer)',
  'ops_af_cert_cohort(text,text,text,text)', 'ops_nf_cert_cell(text,text,jsonb)', 'ops_nf_cert_run(text,integer)',
  'rebuild_af_filter_rpcs()', 'refresh_district_recovery_table(text)', 'refresh_district_recovery()',
  'repair_blanket_false_batch(integer)', 'repair_manufactured_negatives(text,boolean)', 'sync_listing_photos(text)',
  'sync_all_listing_photos()', 'sync_listing_rich_attrs(text)', 'sync_all_rich_attrs(text[])', 'backfill_location_display_labels(integer)',
];

function problems(s: string): string[] {
  const fail: string[] = [];
  for (const sig of MUST_CLOSE) if (!s.includes(`'public.${sig}'`)) fail.push(`${sig} is no longer closed to the public key`);
  if (!/execute format\('revoke execute on function %s from public, anon, authenticated', sig\);/.test(s)) fail.push('the revoke no longer covers public, anon AND authenticated');
  if (!/execute format\('grant execute on function %s to service_role', sig\);/.test(s)) fail.push('service_role lost execute (server tooling would break)');
  if (/grant execute on function %s to (anon|authenticated|public)/.test(s)) fail.push('the migration grants a public role back');
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const p = problems(sql);
check('all 15 maintenance / raw-query functions are closed to public, anon and authenticated; service_role keeps them', p.length === 0, p.join('; '));
mustCatch('the raw-predicate function dropped from the list', problems(sql.replace("'public.ops_af_option_db_truth(text,text,text,text)',", '')).length > 0);
mustCatch('a revoke that forgets signed-in users', problems(sql.replace('from public, anon, authenticated', 'from public, anon')).length > 0);
mustCatch('service_role losing execute', problems(sql.replace("grant execute on function %s to service_role", "grant execute on function %s to postgres")).length > 0);
mustCatch('granting anon back', problems(sql + "\nexecute format('grant execute on function %s to anon', sig);").length > 0);

if (failed) { console.error(`\n❌ verify-maintenance-functions-are-not-public: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-maintenance-functions-are-not-public: maintenance jobs and the raw-query function are not a public API.');
