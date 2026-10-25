// Barrier: an aqar «أكثر من 10 سنوات» ad never answers «up to N years» (2026-10-25).
//
// aqar's own age dictionary renders every raw age above 10 as «أكثر من 10 سنوات», and the scraper stores
// that open bucket as its floor 10. Before migration 20261025065509 the AF clause read the 10 as exact,
// so «أقل من 15 سنة» (p_age_max = 15) listed 20,343 aqar ads the source calls older than ten, one of
// them «عمرها ٥٠ سنه». This EXECUTES the committed clause's age arm (sql/mirrors/af_eligibility_clause.sql,
// md5-pinned to production) on sample rows, and checks the independent oracle says the same.
//
//   node --experimental-strip-types scripts/verify-open-age-bucket-never-answers-up-to.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOracleQS, AGE_OPEN_10_TABLES } from './lib/afOracleFilter.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

type Row = { source_table: string; property_age: number };
type Arm = (r: Row, p_age_min: number | null, p_age_max: number | null) => boolean;

/** The clause's age-range arm, `((p_age_min is null and p_age_max is null) or (…))`, as a JS predicate. */
export function ageArm(clause: string): Arm {
  const start = clause.indexOf('((p_age_min is null and p_age_max is null)');
  const end = clause.indexOf('and (p_age_unknown', start);
  if (start < 0 || end < 0) throw new Error('age arm not found in the clause');
  const js = clause.slice(start, end)
    .replace(/--[^\n]*/g, '').replace(/''/g, "'")
    .replace(/(\S+) not in \(([^)]*)\)/g, '!([$2].includes($1))')
    .replace(/coalesce\(([^,]+),\s*([^)]+)\)/g, '(($1) ?? ($2))')
    .replace(/ is not null/g, ' !== null').replace(/ is null/g, ' === null')
    .replace(/\band\b/g, '&&').replace(/\bor\b/g, '||')
    .replace(/\bs\./g, 'r.').replace(/\s+/g, ' ').trim();
  return new Function('r', 'p_age_min', 'p_age_max', `return (${js});`) as Arm;
}

const AQAR_10: Row = { source_table: 'aqar_residential_listings', property_age: 10 };
const AQAR_COM_12: Row = { source_table: 'aqar_commercial_listings', property_age: 12 };
const AQAR_5: Row = { source_table: 'aqar_residential_listings', property_age: 5 };
const DEALAPP_10: Row = { source_table: 'dealapp_residential_listings', property_age: 10 };
/** The invariant: an open bucket stays out of every «up to N», and everything else behaves as before. */
export const holds = (arm: Arm) =>
  !arm(AQAR_10, null, 15) && !arm(AQAR_COM_12, null, 15) && !arm(AQAR_10, 10, 20)
  && arm(AQAR_10, 10, null) && arm(AQAR_5, null, 15) && arm(DEALAPP_10, null, 15) && !arm(AQAR_10, null, 9);

const mirror = readFileSync(join(import.meta.dirname, '..', 'sql', 'mirrors', 'af_eligibility_clause.sql'), 'utf8');
const arm = ageArm(mirror);
check('«up to 15» excludes an aqar 10 (stored floor of «أكثر من 10 سنوات»)', !arm(AQAR_10, null, 15));
check('«up to 15» excludes an aqar commercial 12', !arm(AQAR_COM_12, null, 15));
check('«10 to 20» excludes an aqar 10 (its upper end is unknown)', !arm(AQAR_10, 10, 20));
check('«10+» still finds an aqar 10', arm(AQAR_10, 10, null));
check('«up to 15» still finds an aqar 5 and a dealapp exact 10', arm(AQAR_5, null, 15) && arm(DEALAPP_10, null, 15));

const { qs } = buildOracleQS({ p_age_max: 15 } as never);
const oracleExcludes = AGE_OPEN_10_TABLES.every((t) => decodeURIComponent(qs).includes(t)) && /property_age\.lt\.10/.test(qs);
check('the independent oracle excludes the same open bucket under «up to 15»', oracleExcludes, decodeURIComponent(qs));
check('the oracle leaves «up to 9» untouched (no open bucket can be ≤ 9)', !/property_age\.lt\.10/.test(buildOracleQS({ p_age_max: 9 } as never).qs));

const OLD_ARM = `((p_age_min is null and p_age_max is null)
           or (s.property_age is not null
               and s.property_age >= coalesce(p_age_min, 0) and s.property_age <= coalesce(p_age_max, 32767)))
      and (p_age_unknown`;
mustCatch('the pre-2026-10-25 arm that let an aqar 10 answer «up to 15»', !holds(ageArm(OLD_ARM)));
mustCatch('an arm that drops the commercial table', !holds(ageArm(mirror.replace(/, ''aqar_commercial_listings''/, ''))));
mustCatch('an arm that excludes every 10 (kills «10+» or other platforms)', !holds(ageArm(mirror.replace(/or s\.source_table not in \([^)]*\)/, 'or false'))));
check('the committed clause satisfies the invariant', holds(arm));

console.log(failures ? `\n✗ ${failures} failed` : '\n✓ an open age bucket never answers «up to N»');
process.exit(failures ? 1 : 0);
