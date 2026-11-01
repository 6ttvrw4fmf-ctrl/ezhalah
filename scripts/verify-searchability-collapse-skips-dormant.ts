// BARRIER — searchability_collapse must tell a platform hidden ON PURPOSE (registry status 'dormant')
// from a search that broke (QA & Repair, 2026-10-07, migration 20261007131631).
//
// THE INCIDENT. On 2026-10-07 the Scraping Engineer set dwelleo (source catalogue answering 404) and
// nafithh (domain gone) to platform_registry.status = 'dormant', which hides their rows from search
// on purpose. mon_detect_searchability_collapse() read that intended zero as a P1
// SEARCHABILITY_COLLAPSE (alerts 8538, 8549) — two loud false alarms sitting on top of the two real
// NEW_ROWS_STUCK_BEFORE_SEARCH cases. reactivate_recovered_dormant_platforms() flips a site back to
// 'active' the hour it serves listings again, so skipping dormant rows loses no coverage.
//
// WHAT THIS CHECKS. The NEWEST committed definition of the detector (the one production runs, since
// the migration drift guard holds repo == production) still filters out dormant platforms inside
// the loop that raises. Mutation proof below: the same predicate run on that definition with the
// clause removed must fail, so the check cannot pass vacuously.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const FN = /create\s+or\s+replace\s+function\s+public\.mon_detect_searchability_collapse\s*\(/i;

const newest = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => FN.test(readFileSync(join(DIR, f), 'utf8')))
  .pop();

const problems = (sql: string): string[] => {
  const m = sql.match(FN);
  if (!m) return ['no definition of mon_detect_searchability_collapse found'];
  // Read the body's own dollar tag; no matching close → no body (fail closed, never the rest of the file).
  const rest = sql.slice(m.index!);
  const tag = rest.match(/\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
  if (!tag) return ['the definition has no dollar-quoted body'];
  const open = rest.indexOf(tag[0]);
  const close = rest.indexOf(tag[0], open + tag[0].length);
  if (close < 0) return [`the body opened with ${tag[0]} never closes`];
  const body = rest.slice(open + tag[0].length, close);
  const at = body.search(/for\s+r\s+in/i);
  if (at < 0) return ['the detector has no `for r in … loop` that raises'];
  const end = body.slice(at).search(/\bloop\b/i);
  const loop = end < 0 ? '' : body.slice(at, at + end);
  const out: string[] = [];
  if (!/mon_searchability_alerts/i.test(loop)) out.push('the raising loop no longer reads mon_searchability_alerts');
  if (!/not\s+exists\s*\(\s*select\s+1\s+from\s+public\.platform_registry[\s\S]*?status\s*=\s*'dormant'/i.test(loop)) {
    out.push("the raising loop no longer skips platform_registry.status = 'dormant' — a deliberately hidden site will raise P1 SEARCHABILITY_COLLAPSE again");
  }
  return out;
};

let failures = 0;
if (!newest) {
  console.error('❌ no committed migration defines mon_detect_searchability_collapse');
  process.exit(1);
}
const sql = readFileSync(join(DIR, newest), 'utf8');
const real = problems(sql);
for (const p of real) { console.error(`❌ ${newest}: ${p}`); failures++; }

const mustCatch = (label: string, caught: boolean) => {
  if (!caught) { console.error(`❌ mutation proof: ${label} — NOT caught, this check is vacuous`); failures++; }
};
const mutant = sql.replace(/\n\s*and not exists \(select 1 from public\.platform_registry pr[\s\S]*?'dormant'\)/i, '');
mustCatch('the newest definition with the dormant clause removed fails', mutant !== sql && problems(mutant).length > 0);
mustCatch('a body whose dollar tag never closes fails (no widening to the rest of the file)',
  problems(sql.replace(/\$function\$;\s*$/m, '')).length > 0);

if (failures === 0) console.log(`✅ searchability_collapse skips dormant platforms (${newest}); mutation without the clause is caught`);
process.exit(failures === 0 ? 0 : 1);
