// Cohort-aware Trending contract (owner, 2026-08-15) — the frontend half of the barrier set.
// The DB half is mon_detect_trending_cohort_drift() (pg_cron 'mon-trending-cohort-drift'), which
// proves trending count == search count on live production cohorts every 6h. This script pins the
// frontend plumbing that keeps those cohorts identical in the first place:
//
//   #7/#17 one type definition — trending sends the EXACT array the search RPC receives
//   #11/#12 changing type recomputes cities AND districts (pool keys + effect deps)
//   #4  percentages clamped, never >100 / negative
//   #10 zero-inventory locations cannot be presented as trending
//
//   node --experimental-strip-types scripts/verify-trending-cohort-contract.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const loc = readFileSync(join(root, 'src/data/locations.ts'), 'utf8');
const rem = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
const idx = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ONE definition of the cohort's Arabic types, shared by search + trending
check('remote.ts exports cohortTypesAr and rpcFilterParams consumes it (single type-expansion definition)',
  /export function cohortTypesAr/.test(rem) && /const p_types = cohortTypesAr\(q\);/.test(rem));
check('index.tsx derives the trending cohort from cohortTypesAr — never its own expansion',
  /const cohortTypes = cohortTypesAr\(query\);/.test(idx) && !/typeArForTypes\(/.test(idx));

// pool keys carry the types dimension → changing type recomputes by construction
check('city pool key includes the cohort types', /cityPoolKey = \([^)]*types[^)]*\) => `\$\{deal\}:\$\{pmKey\(paymentMonthly\)\}:\$\{category \?\? ''\}:\$\{typesKey\(types\)\}`/.test(loc));
check('district cache key includes the cohort types', /districtCacheKey = \([^)]*types[^)]*\)[^`]*`\$\{cityId\}:\$\{deal\}:\$\{category \?\? ''\}:\$\{pmKey\(paymentMonthly\)\}:\$\{typesKey\(types\)\}`/.test(loc));
check('both RPC calls send p_types for the cohort',
  (loc.match(/args\.p_types = types;/g) || []).length === 2);
check('both RPC calls degrade gracefully on a pre-p_types signature (drop types, never blank)',
  (loc.match(/const \{ p_types: _droppedTypes, \.\.\.noTypes \}/g) || []).length === 2);

// effect deps: a type change re-fetches cities AND districts
check('city + district effects re-run when the cohort types change',
  (idx.match(/cohortTypesSig\]\);/g) || []).length >= 3);

// exact denominators travel WITH the counts (one RPC row → numerator and denominator)
check('CityOption carries totalInCohort; DistrictOption carries totalInCity',
  /totalInCohort: Number\(r\.total_in_cohort\) \|\| 0/.test(loc) && /totalInCity: Number\(r\.total_in_city\) \|\| 0/.test(loc));

// COUNT honesty. The share percentage («… · 38٪») was REMOVED by owner instruction 2026-08-16
// ("remove this percentage and show these active numbers") — so the label must show the active count
// and NOTHING derived from a denominator. Both directions are pinned: the count is present, and no
// percentage may creep back into this label.
check('the option label shows the active count and hides a zero count',
  /const cohortCountLabel = \(n: number\)/.test(idx)
  && /if \(!\(n > 0\)\) return undefined;/.test(idx)
  && /return `\$\{grouped\(n\)\} \$\{t\('ads'\)\}`;/.test(idx));
// Tested against CODE ONLY — line comments are stripped first, so the history of this decision can
// still be written down (and must be) without the guard reading its own explanation as a violation.
const idxCode = idx.replace(/^\s*\/\/.*$/gm, '');
check('no share percentage is rendered next to a count (owner removed it)',
  !/٪/.test(idxCode) && !/cohortShareLabel/.test(idxCode) && !/Math\.round\(\(100 \*/.test(idxCode));

// zero-inventory can never trend
check('trending slices exclude zero-count locations (cities AND districts)',
  /filter\(\(c\) => c\.listingCount > 0\)\.slice\(0, k\)/.test(loc)
  && /filter\(\(d\) => d\.listingCount > 0\)\.slice\(0, k\)/.test(loc));

console.log(failed === 0 ? '\n✓ trending cohort contract holds' : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
