// loc_rel_refresh_tick()'s tables-per-tick must FOLLOW the rotation size — never be a bare constant again.
//
// WHY (alert loc_rel_cycle_budget #6002, 2026-09-26 → 2026-11-04). 20260919061517 set `c_max_tables constant int := 4`
// for a 101-table rotation. By 2026-11-04 the rotation held 303 tables, 16 tables/hour were ticked and the projected cycle
// was 18.9 h (warning 18 h, starvation 30 h), while each tick averaged 2.2 s against a 30 s budget. A constant is exactly
// what made the cycle grow with every platform launch. 20261104061546 derives it from loc_rel_scope_tables() (~6 h plan)
// and keeps the 30 s wall budget as the ceiling.
//
// WHAT THIS PINS. The NEWEST migration that sets c_max_tables must derive it from loc_rel_scope_tables(), keep the floor
// of 4, and keep the 30 s budget check before each table. Hermetic, with a mutation proof.
//
//   node --experimental-strip-types scripts/verify-loc-rel-tick-work-follows-rotation.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

function problems(sql: string): string[] {
  const fail: string[] = [];
  const decl = sql.match(/c_max_tables\s+constant\s+int\s*:=\s*([^;]+);/g)?.at(-1) ?? '';
  if (!decl) fail.push('c_max_tables is not declared');
  else if (/:=\s*\d+\s*;$/.test(decl)) fail.push(`c_max_tables is a bare constant again (${decl.trim()})`);
  else if (!/greatest\(4,\s*ceil\(\(select count\(\*\) from public\.loc_rel_scope_tables\(\)\)\s*\/\s*24\.0\)::int\)/.test(decl)) {
    fail.push('c_max_tables is not derived from the rotation size (loc_rel_scope_tables() / 24, floor 4)');
  }
  return fail;
}

const newest = files.filter((f) => /c_max_tables\s+constant\s+int\s*:=/.test(readFileSync(join(dir, f), 'utf8'))).at(-1);
let bad = 0;
function mustCatch(label: string, caught: boolean): void {
  if (!caught) { console.log(`FAIL  mutation not caught: ${label}`); bad++; }
}

if (!newest) { console.log('FAIL  no migration sets c_max_tables'); process.exit(1); }
const sql = readFileSync(join(dir, newest), 'utf8');
for (const p of problems(sql)) { console.log(`FAIL  ${newest}: ${p}`); bad++; }

// The 30 s budget is the ceiling that keeps a derived count safe; it must still be in the live procedure's last full body.
const fullBody = files.filter((f) => /create\s+or\s+replace\s+procedure\s+public\.loc_rel_refresh_tick/i.test(readFileSync(join(dir, f), 'utf8'))).at(-1);
if (!fullBody || !/exit when extract\(epoch from \(clock_timestamp\(\) - v_t0\)\) >= c_budget_s;/.test(readFileSync(join(dir, fullBody), 'utf8'))) {
  console.log('FAIL  the 30 s wall budget checked before each table is gone'); bad++;
}

// Mutation proofs: the 2026-09-19 constant, and a bigger constant, must both go red.
const old = readFileSync(join(dir, '20260919061517_loc_rel_rotation_throughput_must_scale_with_the_platform_count.sql'), 'utf8');
mustCatch('the fixed 4 of 20260919061517', problems(old).length > 0);
mustCatch('a bigger constant', problems('  c_max_tables constant int     := 40;').length > 0);

if (bad) process.exit(1);
console.log(`✓ loc_rel tick work follows the rotation size (${newest}), bounded by the 30 s budget`);
