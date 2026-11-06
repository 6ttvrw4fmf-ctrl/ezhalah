// pin_district_candidates() must judge each (city, district name) pair ONCE (🔧 2026-11-06).
//
// pin-district-nightly.yml run 42197780131 died on «57014 statement timeout»: the own_town CTE that was written to call
// district_is_own_town() once per distinct name was INLINED by the planner (it estimates `blank` at 1 row; it held
// 4,251), so the ~7 ms test ran once per listing: >60 s against PostgREST's 8 s. MATERIALIZED made it 2.3 s.
//
// This check reads the LATEST committed definition of the function (the last migration, in version order, that
// creates it) and fails unless every CTE that calls district_is_own_town(), and the `blank` and `shared` CTEs it
// reads, is declared MATERIALIZED. Mutation proof: the same predicate is run on the pre-fix definition and must fail.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const FN = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?pin_district_candidates\s*\(/i;

export function problems(sql: string): string[] {
  const out: string[] = [];
  const body = sql.slice(sql.search(FN));
  const ctes = [...body.matchAll(/(?:with|,)\s*(\w+)\s+as\s+(materialized\s+)?\(/gi)];
  if (!ctes.length) return ['no CTEs found in pin_district_candidates()'];
  // A rename must not let a CTE escape the rule: the three that carry the fix have to exist by name.
  for (const required of ['own_town', 'blank', 'shared']) {
    if (!ctes.some((m) => m[1].toLowerCase() === required)) out.push(`CTE «${required}» is missing`);
  }
  for (const m of ctes) {
    const name = m[1].toLowerCase();
    const start = (m.index ?? 0) + m[0].length;
    let depth = 1, i = start;
    while (i < body.length && depth > 0) { if (body[i] === '(') depth++; else if (body[i] === ')') depth--; i++; }
    const cte = body.slice(start, i);
    const needs = /district_is_own_town\s*\(/i.test(cte) || name === 'blank' || name === 'shared';
    if (needs && !m[2]) out.push(`CTE «${name}» is not MATERIALIZED`);
  }
  return out;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const defining = files.filter((f) => FN.test(readFileSync(join(DIR, f), 'utf8')));
if (!defining.length) { console.error('verify-pin-district-candidates-judges-names-once: no migration defines pin_district_candidates()'); process.exit(1); }
const latest = defining[defining.length - 1];
const bad = problems(readFileSync(join(DIR, latest), 'utf8'));
if (bad.length) { console.error(`✗ ${latest}: ${bad.join('; ')}`); process.exit(1); }
console.log(`✓ ${latest}: own_town, blank and shared are MATERIALIZED`);

// Mutation proof: the barrier's own predicate must CATCH the pre-fix definition (CTEs not MATERIALIZED) and a
// synthetic mutant that strips MATERIALIZED from the current one.
function mutation(name: string, sql: string): void {
  const found = problems(sql);
  if (!found.length) { console.error(`✗ mutation not caught: ${name}`); process.exit(1); }
  console.log(`✓ mutation caught: ${name} (${found.join('; ')})`);
}
const prefix = defining.find((f) => f.startsWith('20261105093525'));
if (prefix) mutation('the pre-fix definition 20261105093525', readFileSync(join(DIR, prefix), 'utf8'));
mutation('shared renamed (and not MATERIALIZED)', readFileSync(join(DIR, latest), 'utf8').replace(/shared\s+as\s+materialized/i, 'shared2 as').replace(/from shared x/i, 'from shared2 x'));
mutation('own_town without MATERIALIZED', readFileSync(join(DIR, latest), 'utf8').replace(/own_town\s+as\s+materialized/i, 'own_town as'));
console.log('verify-pin-district-candidates-judges-names-once: OK');
