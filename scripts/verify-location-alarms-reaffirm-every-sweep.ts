// An open location alarm is re-affirmed every sweep — never frozen at the numbers of the day it opened.
//
// WHY (2026-11-04). Five location detectors called mon_raise() only when NO alert was open
// (`elsif v_open is null then r := public.mon_raise(...)`). Once open they never touched it again: the detail kept its
// first-day numbers and last_affirmed_at stayed NULL, which mon_raise() defines as «no detector stands behind this
// alert». district_blank_unexplained #9964 still read its 2026-10-18 counts two weeks later. mon_raise() already dedups
// and refreshes the open row, so 20261104 (…_location_alarms_reaffirm_every_sweep) calls it on every sweep.
//
// WHAT THIS PINS. (1) The fix migration patches all five and replaces the raise-only-when-closed anchor.
// (2) No migration NEWER than the fix brings the pattern back for any of the five. Hermetic, with a mutation proof.
//
//   node --experimental-strip-types scripts/verify-location-alarms-reaffirm-every-sweep.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
const FIVE = ['mon_detect_unknown_named_district', 'mon_detect_district_blank_unexplained', 'mon_detect_source_district_dropped',
  'mon_detect_served_district_not_offered', 'mon_detect_location_whitespace_irregular'];
const FROZEN = /elsif v_open is null then\s+r := public\.mon_raise\(/;

function fixProblems(sql: string): string[] {
  const fail: string[] = [];
  for (const f of FIVE) if (!sql.includes(`'${f}'`)) fail.push(`${f} is not patched`);
  if (!/a_old constant text := E'elsif v_open is null then\\n    r := public\.mon_raise\(';/.test(sql)) fail.push('the frozen anchor is not the one replaced');
  if (!/a_new constant text := E'else\b/.test(sql)) fail.push('the replacement does not raise on every sweep');
  return fail;
}

let bad = 0;
const fix = files.filter((f) => f.endsWith('_location_alarms_reaffirm_every_sweep.sql')).at(-1);
if (!fix) { console.log('FAIL  the re-affirm migration is missing'); process.exit(1); }
const fixSql = readFileSync(join(dir, fix), 'utf8');
for (const p of fixProblems(fixSql)) { console.log(`FAIL  ${fix}: ${p}`); bad++; }

// A later full redefinition of any of the five must not restore the frozen branch.
for (const f of files.filter((n) => n > fix)) {
  const s = readFileSync(join(dir, f), 'utf8');
  for (const fn of FIVE) {
    const m = s.match(new RegExp(`create or replace function public\\.${fn}\\(\\)[\\s\\S]*?\\$function\\$;`, 'i'));
    if (m && FROZEN.test(m[0])) { console.log(`FAIL  ${f}: ${fn} raises only when no alert is open again`); bad++; }
  }
}

// Mutation proofs.
if (fixProblems(fixSql.replace(/'mon_detect_district_blank_unexplained',\s*/, '')).length === 0) { console.log('FAIL  mutation: dropping a detector passes'); bad++; }
if (fixProblems(fixSql.replace(/a_new constant text := E'else/, "a_new constant text := E'elsif v_open is null then")).length === 0) {
  console.log('FAIL  mutation: keeping the frozen branch passes'); bad++;
}
const frozenBody = "create or replace function public.mon_detect_source_district_dropped() as $function$ begin if n = 0 then null;\n  elsif v_open is null then\n    r := public.mon_raise('P1'); end if; end $function$;";
if (!FROZEN.test(frozenBody)) { console.log('FAIL  mutation: the frozen-branch pattern does not match a frozen body'); bad++; }

if (bad) process.exit(1);
console.log(`✓ the five location alarms re-affirm every sweep (${fix})`);
