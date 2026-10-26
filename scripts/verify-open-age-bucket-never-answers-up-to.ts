// Barrier: an OPEN age bucket («more than 10» stored as 10) never answers «up to N years» (2026-10-25).
//
// Seven sites publish both an exact «10» and an open «more than 10» and store both as 10: aqar
// («أكثر من 10 سنوات»), wasalt («10+ years»), muhaysini / tuba / aqarcity / reinvest («اكثر من عشر سنوات»)
// and haraj (REGA's English «Ten Year», which covers both). Before migrations 20261025065509 and
// 20261025072931 the AF clause read those 10s as exact, so «أقل من 15 سنة» (p_age_max = 15) listed ~32k ads
// the source calls older than ten, one of them «عمرها ٥٠ سنه». This EXECUTES the committed clause's age arm
// (sql/mirrors/af_eligibility_clause.sql, md5-pinned to production) on sample rows, and checks the
// independent oracle excludes exactly the same platforms. Its scraper half runs haraj's REAL parser: REGA's open
// top bucket «اكثر من عشر سنوات» is stored as 10 (was NULL — 983 live ads stated an age and showed none), so
// «10+» finds it and «up to N» never does.
//
//   node --experimental-strip-types scripts/verify-open-age-bucket-never-answers-up-to.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildOracleQS, AGE_OPEN_10_PLATFORMS } from './lib/afOracleFilter.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

type Row = { platform: string; source_table: string; property_age: number };
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

const row = (platform: string, property_age: number, kind = 'residential'): Row =>
  ({ platform, source_table: `${platform}_${kind}_listings`, property_age });
/** The invariant: on every open platform a 10 stays out of every «up to N»; everything else is unchanged. */
export const holds = (arm: Arm) =>
  AGE_OPEN_10_PLATFORMS.every((p) => !arm(row(p, 10), null, 15) && !arm(row(p, 10, 'commercial'), 10, 20) && arm(row(p, 10), 10, null))
  && !arm(row('aqar', 12), null, 15) && arm(row('aqar', 5), null, 15) && arm(row('dealapp', 10), null, 15) && !arm(row('wasalt', 10), null, 9);

const mirror = readFileSync(join(import.meta.dirname, '..', 'sql', 'mirrors', 'af_eligibility_clause.sql'), 'utf8');
const arm = ageArm(mirror);
for (const p of AGE_OPEN_10_PLATFORMS) {
  check(`«up to 15» excludes a ${p} 10 (its open «more than 10»)`, !arm(row(p, 10), null, 15));
  check(`«10+» still finds a ${p} 10`, arm(row(p, 10), 10, null));
}
check('«10 to 20» excludes a wasalt commercial 10 (its upper end is unknown)', !arm(row('wasalt', 10, 'commercial'), 10, 20));
check('«up to 15» still finds an aqar 5 and a dealapp exact 10', arm(row('aqar', 5), null, 15) && arm(row('dealapp', 10), null, 15));

/** The platforms the clause's open-bucket line names, read from the committed SQL. */
export const clausePlatforms = (sql: string) =>
  [...(sql.match(/s\.platform not in \(([^)]*)\)/)?.[1] ?? '').matchAll(/''([a-z_]+)''/g)].map((m) => m[1]).sort();
check('the clause and the oracle name the SAME open platforms', clausePlatforms(mirror).join(',') === [...AGE_OPEN_10_PLATFORMS].sort().join(','),
  `${clausePlatforms(mirror).join(',')} vs ${[...AGE_OPEN_10_PLATFORMS].sort().join(',')}`);
const { qs } = buildOracleQS({ p_age_max: 15 } as never);
check('the independent oracle excludes the open bucket under «up to 15»',
  decodeURIComponent(qs).includes(`or=(property_age.lt.10,platform.not.in.(${AGE_OPEN_10_PLATFORMS.join(',')}))`), decodeURIComponent(qs));
check('the oracle leaves «up to 9» untouched (no open bucket can be ≤ 9)', !/property_age\.lt\.10/.test(buildOracleQS({ p_age_max: 9 } as never).qs));

const OLD_ARM = `((p_age_min is null and p_age_max is null)
           or (s.property_age is not null
               and s.property_age >= coalesce(p_age_min, 0) and s.property_age <= coalesce(p_age_max, 32767)))
      and (p_age_unknown`;
const AQAR_ONLY_ARM = `((p_age_min is null and p_age_max is null)
           or (s.property_age is not null
               and s.property_age >= coalesce(p_age_min, 0) and s.property_age <= coalesce(p_age_max, 32767)
               and (p_age_max is null or s.property_age < 10
                    or s.source_table not in (''aqar_residential_listings'', ''aqar_commercial_listings''))))
      and (p_age_unknown`;
mustCatch('the pre-2026-10-25 arm that let every open 10 answer «up to 15»', !holds(ageArm(OLD_ARM)));
mustCatch('the aqar-only arm of 20261025065509 that let a wasalt «10+ years» through', !holds(ageArm(AQAR_ONLY_ARM)));
mustCatch('an arm that forgets one proven platform (haraj)', !holds(ageArm(mirror.replace("''haraj'', ", ''))));
mustCatch('an arm that excludes every 10 (kills dealapp\'s exact 10s)', !holds(ageArm(mirror.replace(/or s\.platform not in \([^)]*\)/, 'or false'))));
mustCatch('a clause/oracle platform list that drifted apart', clausePlatforms(mirror.replace("''tuba'', ", '')).join(',') !== [...AGE_OPEN_10_PLATFORMS].sort().join(','));
check('the committed clause satisfies the invariant', holds(arm));

// ── the scraper half: haraj's own parser, executed ──────────────────────────────────────────────────
const HARAJ_EXPECT: Record<string, number | null> = {
  'اكثر من عشر سنوات': 10, 'Ten Year': 10, 'عشر سنوات': 10, 'Seven Year': 7, '45سنه': 45,
  'أكثر من 20 سنة': null,   // not REGA's vocabulary: an open bound we cannot floor honestly stays unknown
};
const py = spawnSync('python3', ['-c', `import json, sys
sys.path.insert(0, '.')
from scrapers.haraj.parse import age_of
print(json.dumps({k: age_of(k) for k in json.loads(sys.argv[1])}, ensure_ascii=False))`, JSON.stringify(Object.keys(HARAJ_EXPECT))],
  { encoding: 'utf8', cwd: join(import.meta.dirname, '..') });
let harajOut: Record<string, number | null> = {};
try { harajOut = JSON.parse(py.stdout.trim().split('\n').pop() ?? '{}'); } catch { /* reported below */ }
check('haraj\'s parser ran', py.status === 0 && Object.keys(harajOut).length === Object.keys(HARAJ_EXPECT).length, py.stderr.slice(0, 200));
/** The scraper invariant: every REGA value lands where the AF can read it, and nothing is guessed. */
export const harajOk = (out: Record<string, number | null>) =>
  Object.entries(HARAJ_EXPECT).every(([k, want]) => out[k] === want)
  && arm(row('haraj', out['اكثر من عشر سنوات'] as number), 10, null) && !arm(row('haraj', out['اكثر من عشر سنوات'] as number), null, 15);
for (const [k, want] of Object.entries(HARAJ_EXPECT)) check(`haraj «${k}» → ${want}`, harajOut[k] === want, `got ${harajOut[k]}`);
check('a haraj «اكثر من عشر سنوات» ad is found by «10+» and never by «up to 15»', harajOk(harajOut));
mustCatch('the pre-2026-10-25 haraj parser that stored «اكثر من عشر سنوات» as NULL', !harajOk({ ...harajOut, 'اكثر من عشر سنوات': null }));
mustCatch('a parser that floors a non-REGA open bound («أكثر من 20» → 20)', !harajOk({ ...harajOut, 'أكثر من 20 سنة': 20 }));

console.log(failures ? `\n✗ ${failures} failed` : '\n✓ an open age bucket never answers «up to N»');
process.exit(failures ? 1 : 0);
