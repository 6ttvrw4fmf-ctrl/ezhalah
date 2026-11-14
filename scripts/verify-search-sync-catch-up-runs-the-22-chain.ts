// 🔧 2026-11-14: pg_cron skips the :22 search-index tick about three times a day (no run row at all; cron_health 14774,
// attendance 87.5 %), and each miss left the served index, the counts and the text-facts marker an hour behind (P1 14772,
// 81 wasalt ads). Migration 20261114143000 makes the :50 «refresh-district-list-after-sync» job run the SAME chain first,
// only when this hour's tick never started. This guard keeps that chain honest: the catch-up must perform exactly the eight
// steps of job «sync-search-listings-ar» (read from production on 2026-11-14 13:2x UTC), in the same order, inside the same
// advisory lock, and the :50 job must still end with its own refresh. Drop a step, reorder one, or lose the lock → RED.
//   node --experimental-strip-types scripts/verify-search-sync-catch-up-runs-the-22-chain.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).find((f) => /^20261114143000_.*\.sql$/.test(f));
if (!file) { console.error('FAIL  migration 20261114143000 (the sync catch-up) is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');

// The chain of cron job 28 «sync-search-listings-ar», as production ran it on 2026-11-14 (cron.job.command).
export const SYNC_CHAIN = [
  'sync_search_listings_ar', 'refresh_rnpl_flags', 'sync_payment_monthly', 'sync_all_rich_attrs',
  'sync_gathern_native_attrs', 'refresh_photo_capture_trust', 'sync_all_listing_photos', 'sync_raw_land_subtype',
];
export const LOCK = "pg_advisory_xact_lock(hashtext('location_pipeline:v1_refresh'))";

export function problems(text: string): string[] {
  const out: string[] = [];
  const fn = /create or replace function public\.sync_search_listings_catch_up\(\)([\s\S]*?)\$\$;/i.exec(text)?.[1] ?? '';
  if (!fn) return ['no sync_search_listings_catch_up() definition'];
  const performed = [...fn.matchAll(/perform public\.([a-z_]+)\(\)/g)].map((m) => m[1]);
  if (performed.join(',') !== SYNC_CHAIN.join(',')) out.push(`chain is [${performed.join(', ')}], expected [${SYNC_CHAIN.join(', ')}]`);
  const lockAt = fn.indexOf(LOCK); const firstStep = fn.indexOf('perform public.sync_search_listings_ar()');
  if (lockAt < 0 || firstStep < 0 || lockAt > firstStep) out.push('the chain does not run inside the single-writer advisory lock');
  if (!/if v_last is not null and v_last >= v_due then/.test(fn)) out.push('the catch-up does not skip when this hour\'s tick ran');
  if (!/status = 'running'/.test(fn)) out.push('the catch-up does not skip while the tick is still running');
  const cmd = /command := \$cmd\$([\s\S]*?)\$cmd\$/.exec(text)?.[1] ?? '';
  if (!cmd) out.push('no cron.alter_job command for the :50 job');
  else {
    const a = cmd.indexOf('sync_search_listings_catch_up()'); const b = cmd.indexOf('refresh_loc_canonical_district()');
    if (a < 0 || b < 0 || a > b) out.push('the :50 job must run the catch-up first and still end with refresh_loc_canonical_district()');
    if (!/statement_timeout to '300s'[\s\S]*refresh_loc_canonical_district/.test(cmd)) out.push('the refresh step lost its own 300 s budget');
  }
  if (!/alter_job\(\s*\(select j\.jobid from cron\.job j where j\.jobname = 'refresh-district-list-after-sync'/.test(text)) out.push('the command is not attached to refresh-district-list-after-sync');
  if (/cron\.schedule\(/.test(text)) out.push('a new cron slot: the hour is full (max_per_instant 2) — ride the :50 job instead');
  return out;
}

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => { if (ok) console.log(`PASS  ${label}`); else { failures++; console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`); } };
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught, 'the predicate did NOT report this defect');

const p = problems(sql);
check('the catch-up runs the :22 chain, in order, inside the lock, only when the tick is missing, from the :50 job', p.length === 0, p.join('; '));
mustCatch('a dropped chain step', problems(sql.replace('  perform public.sync_all_listing_photos();\n', '')).length > 0);
mustCatch('a reordered chain', problems(sql.replace('perform public.refresh_rnpl_flags();', 'perform public.sync_payment_monthly();').replace('perform public.sync_payment_monthly();\n  perform public.sync_all_rich_attrs', 'perform public.refresh_rnpl_flags();\n  perform public.sync_all_rich_attrs')).length > 0);
mustCatch('the lock removed', problems(sql.replace(`perform ${LOCK};`, '')).length > 0);
mustCatch('the «tick ran» skip removed', problems(sql.replace('if v_last is not null and v_last >= v_due then', 'if false then')).length > 0);
mustCatch('the :50 job losing its own refresh', problems(sql.replace('select public.refresh_loc_canonical_district();', '')).length > 0);
mustCatch('a new cron slot instead of the :50 job', problems(sql + "\nselect cron.schedule('x', '48 * * * *', 'select 1');").length > 0);

if (failures) { console.error(`\n❌ verify-search-sync-catch-up-runs-the-22-chain: ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ verify-search-sync-catch-up-runs-the-22-chain: a missed :22 tick is caught up at :50 with the same chain.');
