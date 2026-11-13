// A GONE probe of a DELETED earlier row is not evidence about a NEW row (♻️, 2026-11-13).
//
// Every gathern false_resurrection from 11-11 to 11-13 (GTH253915, GTH145646, GTH246298, GTH194435,
// GTH209847, GTH263601, GTH202632) was one shape: the GONE probe (09-28/29) named an older row id, the
// 30-day cleanup deleted that row (cleanup_deletion_log 10-09 .. 11-04), Gathern listed the unit again,
// and the crawl inserted a NEW row. ops_lifecycle_false_resurrection() joined probes to rows by
// ad_number only, so it charged the new row with the dead row's verdict and a P1 reopened every
// night (repeat_bug:false_resurrection:gathern_residential_listings, 13 reopens).
//
// The effective body (replayed over every migration, not "the last file") must:
//   1. carry the probe's own row id (listing_id) through to the join, and
//   2. skip a probe ONLY when it names a different row AND predates this row's birth (scraped_at);
//      a same-row probe, a probe with no row id, or a probe taken after the row was born still raises.
// The predicate is mutation-proven below: each mutant must be caught.
import { codeOnly, replayFunction, MIGRATIONS_DIR } from './lib/rpcReplay.ts';

const FN = 'ops_lifecycle_false_resurrection';
const CLAUSE = 'not (l.probe_row is not null and l.probe_row <> t.id and l.probed_at < t.scraped_at)';

export function problemsIn(body: string | null): string[] {
  if (!body) return [`${FN}() is defined by no committed migration`];
  const code = codeOnly(body).replace(/\s+/g, ' ').toLowerCase();
  const out: string[] = [];
  if (!/p\.listing_id::bigint as probe_row/.test(code))
    out.push('all_probes no longer carries the probe\'s own row id (p.listing_id as probe_row)');
  if (!/distinct on \(a\.ad_number\) a\.ad_number, a\.probe_row/.test(code))
    out.push('latest no longer carries probe_row, so the join cannot tell one row from another');
  if (!code.includes(CLAUSE))
    out.push(`the previous-incarnation clause is missing or changed; expected: ${CLAUSE}`);
  if (!/t\.last_verified_alive_at is null or t\.last_verified_alive_at < l\.probed_at/.test(code))
    out.push('the never-proven-alive condition is gone: the detector would stop seeing real resurrections');
  return out;
}

const r = replayFunction(MIGRATIONS_DIR, FN);
const problems = [...r.unresolved.map((u) => `unresolved migration touching ${FN}: ${u}`), ...problemsIn(r.body)];

// Mutation proof: the predicate must reject each of these.
const MUTANTS: Array<[string, (b: string) => string]> = [
  ['clause dropped', (b) => b.replace(/and not \(l\.probe_row[^)]*\)/i, '')],
  ['blanket skip by birth time', (b) => b.replace('l.probe_row is not null and l.probe_row <> t.id and ', '')],
  ['row id not carried', (b) => b.replace('p.listing_id::bigint as probe_row', 'null::bigint as probe_row')],
  ['alive condition dropped', (b) => b.replace(/and \(t\.last_verified_alive_at is null or t\.last_verified_alive_at < l\.probed_at\)/i, '')],
];
if (r.body) {
  for (const [name, m] of MUTANTS) {
    const mutated = m(r.body);
    if (mutated === r.body) problems.push(`mutant «${name}» did not apply: the guard's anchor drifted`);
    else if (problemsIn(mutated).length === 0) problems.push(`mutant «${name}» was NOT caught`);
  }
}

if (problems.length) {
  console.error(`✗ verify-false-resurrection-skips-a-deleted-previous-incarnation\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`✓ ${FN}() skips only a deleted previous incarnation (${r.touchedBy.at(-1)}); ${MUTANTS.length} mutants caught`);
