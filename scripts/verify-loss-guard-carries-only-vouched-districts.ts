// The district-recovery LOSS GUARD may carry forward a district the SOURCE wrote, never an unvouched pin or title one.
//
// WHY (alert pin_district_unvouched, 2026-11-04). 20261103052931 made refresh_district_recovery_table()'s loss guard carry
// last run's would-be-lost district_recovery rows into the new set (owner 10-18: never drop a district). It carried
// basis 'pin' and basis 'title' rows too. Those are not source words: a pin district is served only while a switched-on
// listing_pin_district row vouches for it (owner 10-24), a title district only while listing_title_district names it.
// Six served ads kept a pin district whose vouching row was gone, re-carried every hour, so the alarm could never clear.
// 20261104060958 makes both the carry and the lost-count require the vouching row for those two bases.
//
// WHAT THIS PINS. The NEWEST migration that writes the loss-guard carry (an insert into _drt selecting from
// public.district_recovery o, or a patch anchored on it) must carry the vouch predicate for BOTH bases. A later rewrite that drops it is RED.
// Hermetic: reads only the repo. A built-in mutation proof strips the predicate and requires the check to go red.
//
//   node --experimental-strip-types scripts/verify-loss-guard-carries-only-vouched-districts.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

// Every migration that writes or patches the carry names its anchor `o.source_table = p_table`.
const CARRY = /o\.source_table = p_table/;
const MENTIONS = /refresh_district_recovery_table/;

export function vouchProblems(sql: string): string[] {
  const fail: string[] = [];
  if (!/coalesce\(o\.basis, ''\) not in \('pin', 'title'\)/.test(sql)) fail.push('source-word rows are not separated from pin/title rows');
  if (!/o\.basis = 'pin' and exists \(select 1 from public\.listing_pin_district pv[\s\S]{0,260}pv\.applied and pv\.district_ar = o\.district_ar/.test(sql)) {
    fail.push('a pin row is carried without a switched-on listing_pin_district row naming the same district');
  }
  if (!/o\.basis = 'title' and exists \(select 1 from public\.listing_title_district tv[\s\S]{0,260}tv\.district_ar = o\.district_ar/.test(sql)) {
    fail.push('a title row is carried without a listing_title_district row naming the same district');
  }
  return fail;
}

const newest = files.filter((f) => {
  const s = readFileSync(join(dir, f), 'utf8');
  return MENTIONS.test(s) && CARRY.test(s);
}).at(-1);

let bad = 0;
function mustCatch(label: string, caught: boolean): void {
  if (!caught) { console.log(`FAIL  mutation not caught: ${label}`); bad++; }
}

if (!newest) {
  console.log('FAIL  no migration writes the district-recovery loss-guard carry');
  process.exit(1);
}
const sql = readFileSync(join(dir, newest), 'utf8');
// The pre-fix carry (20261103052931) is a carry with no vouch: it must not be the newest word.
if (newest < '20261104060958') { console.log(`FAIL  newest loss-guard carry is ${newest}, older than the vouch fix`); bad++; }
for (const p of vouchProblems(sql)) { console.log(`FAIL  ${newest}: ${p}`); bad++; }

// Mutation proof: the same file with the predicate stripped must be judged unsafe.
const mutant = sql.replace(/o\.basis = 'pin' and exists/g, 'true or exists').replace(/coalesce\(o\.basis, ''\) not in/g, 'o.basis not in');
mustCatch('a carry without the vouch', vouchProblems(mutant).length > 0);
const old = readFileSync(join(dir, '20261103052931_district_recovery_never_freezes_and_title_heals.sql'), 'utf8');
mustCatch('the pre-fix carry (20261103052931)', vouchProblems(old).length > 0);

if (bad) process.exit(1);
console.log(`✓ loss-guard carry (${newest}) keeps source words and carries a pin/title district only while it is vouched for`);
