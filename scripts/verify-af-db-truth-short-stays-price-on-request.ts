// The chip-vs-DB-truth oracle (ops_af_cohort_predicate_sql) must state the owner's 2026-10-26 price-on-request rule
// (docs/ARCHITECTURE.md §20): a rent row with no price is admitted under «إقامات قصيرة» (شهري) only when it is a
// Gathern / Aqar Monthly row. Before 2026-11-02 the oracle let every no-price rent row into شهري, and
// mon_detect_af_chip_vs_db_truth raised three P1 slices on chips that were right (backlog 1187).
// This reads the LATEST committed definition, strips SQL comments, and checks the no-price branch.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(import.meta.dirname, '..', 'supabase', 'migrations');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const DEF = /function\s+(public\.)?ops_af_cohort_predicate_sql\s*\(/i;
const read = (f: string) => readFileSync(join(MIG, f), 'utf8');
const body = (sql: string) => sql.slice(sql.search(DEF)).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

/** The no-price branch of the oracle: true when شهري admits a no-price row only from the two stay-length sites. */
export function noPriceShortStaysIsScoped(sql: string): boolean {
  const b = body(sql);
  const i = b.indexOf('s.price_annual is null and');
  if (i < 0) return false;
  const branch = b.slice(i, i + 260);
  const admitsShortStaysForAll = /in \('شهري', ?'سنوي'\)|in \('سنوي', ?'شهري'\)/.test(branch);
  const scoped = /= 'شهري' and s\.platform in \('gathern', ?'aqarmonthly'\)/.test(branch);
  return scoped && !admitsShortStaysForAll;
}

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().filter((f) => DEF.test(read(f)));
const latest = files.at(-1);
check('a committed oracle definition exists', !!latest, latest ?? 'none');
check(`the latest oracle (${latest}) admits no-price rows under شهري only for Gathern / Aqar Monthly`,
  !!latest && noPriceShortStaysIsScoped(read(latest)));

mustCatch('the 2026-09-28 oracle (every no-price rent row passes شهري)',
  !noPriceShortStaysIsScoped(read('20260928100046_price_on_request_shows_under_every_rent_period.sql')));
mustCatch('a branch that drops the platform scope',
  !noPriceShortStaysIsScoped("function ops_af_cohort_predicate_sql( ... (s.price_annual is null and (%L::text = 'سنوي' or %L::text = 'شهري')) ..."));
mustCatch('a scoped branch that also keeps the old list',
  !noPriceShortStaysIsScoped("function ops_af_cohort_predicate_sql( ... (s.price_annual is null and %L::text in ('شهري','سنوي') or (%L::text = 'شهري' and s.platform in ('gathern','aqarmonthly'))) ..."));

console.log(failures ? `\n✗ ${failures} failed` : '\n✓ the chip oracle states the short-stays price-on-request rule');
process.exit(failures ? 1 : 0);
