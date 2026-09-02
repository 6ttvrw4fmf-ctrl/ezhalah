// THE FULL-SURFACE SWEEP MUST STAY FULL — its option catalog is pinned to the product, offline.
//
// scripts/verify-af-full-surface-differential.ts proves every certified Advanced Filter option
// against production. It can only prove options it KNOWS ABOUT, and a sweep that quietly loses an
// option the product gained is the vacuous-pass shape this repo keeps finding: still green, one
// chip narrower than the product, forever. So the catalog inside the sweep is checked here, on
// every PR, against the three things it mirrors:
//
//   1. src/lib/afCohorts.ts      every question id any cohort certifies has an optionsFor() arm
//   2. src/data/remote.ts        every cnt_* column the catalog reads exists on GuidedCounts /
//                                AgeOptionCounts (a chip with no count path is not a chip)
//   3. src/data/remote.ts        every request key the catalog applies is one rpcAdvancedFilterParams()
//                                can emit (the click must be the click the app makes)
//   4. sql/mirrors/af_eligibility_clause.sql
//                                every column a catalog predicate reads is one the clause reads
//                                (the JS row check must judge the same column the server filters)
//   5. the sweep is wired into a scheduled workflow and excluded from npm test with that home
//
// And one arithmetic pin: the sweep's own catalog must be at least as wide as the card's option
// vocabulary in src/data/advancedFilters.ts — every `key: '…'` the card can render must be a key the
// sweep can apply. Hermetic. In `npm test`.
//
//   node --experimental-strip-types scripts/verify-af-full-surface-catalog.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COHORT_QUESTIONS } from '../src/lib/afCohorts.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const sweep = stripComments(read('scripts/verify-af-full-surface-differential.ts'));
const remote = stripComments(read('src/data/remote.ts'));
const advanced = stripComments(read('src/data/advancedFilters.ts'));
const clause = read('sql/mirrors/af_eligibility_clause.sql');

console.log('\nverify-af-full-surface-catalog: the sweep can never be narrower than the product\n');

// ── 1. every certified question id has a catalog arm ─────────────────────────────────────────────
const certifiedIds = [...new Set(Object.values(COHORT_QUESTIONS).flatMap((cfg) => Object.values(cfg ?? {}).flat()))].sort();
const catalogArms = [...sweep.matchAll(/case '([a-z_]+)': return/g)].map((m) => m[1]);
check('every question id any cohort certifies has an optionsFor() arm in the sweep',
  certifiedIds.every((id) => catalogArms.includes(id)),
  `missing: ${certifiedIds.filter((id) => !catalogArms.includes(id)).join(', ') || 'none'} · certified: ${certifiedIds.join(', ')}`);
check('the catalog has at least the nine shipping question kinds', catalogArms.length >= 9, `arms: ${catalogArms.join(', ')}`);

// ── 2. every cnt_* column the catalog reads exists on the count RPC types ────────────────────────
const guidedType = remote.slice(remote.indexOf('export type GuidedCounts'), remote.indexOf('};', remote.indexOf('export type GuidedCounts')));
const ageType = remote.slice(remote.indexOf('export type AgeOptionCounts'), remote.indexOf('};', remote.indexOf('export type AgeOptionCounts')));
const knownCols = new Set([...`${guidedType}\n${ageType}`.matchAll(/\b(cnt_[a-z0-9_]+)\b/g)].map((m) => m[1]));
const catalogCols = [...new Set([
  ...[...sweep.matchAll(/col: '(cnt_[a-z0-9_]+)'/g)].map((m) => m[1]),
  ...[...sweep.matchAll(/col: `cnt_(bath|stw)\$\{n\}`/g)].flatMap((m) => (m[1] === 'bath' ? [1, 2, 3, 4].map((n) => `cnt_bath${n}`) : [15, 20, 25, 30].map((n) => `cnt_stw${n}`))),
  ...[...sweep.matchAll(/'cnt_(sub_[a-z]+|dir_[a-z]+)'/g)].map((m) => `cnt_${m[1]}`),
  'cnt_kitchen', 'cnt_parking', 'cnt_elevator', 'cnt_ac', 'cnt_private_entrance', 'cnt_maid_room', 'cnt_driver_room', 'cnt_car_entrance', 'cnt_sanitation', 'cnt_electricity', 'cnt_water_supply', 'cnt_furnished',
])];
check('every cnt_* column the catalog reads is a real GuidedCounts / AgeOptionCounts column',
  catalogCols.every((c) => knownCols.has(c)),
  `unknown: ${catalogCols.filter((c) => !knownCols.has(c)).join(', ') || 'none'}`);
check('the catalog reads a plausible number of count columns', catalogCols.length >= 30, `${catalogCols.length}`);

// ── 3. every request key the catalog applies is one the app can send ─────────────────────────────
const advBlock = remote.slice(remote.indexOf('export function rpcAdvancedFilterParams'), remote.indexOf('}\n', remote.indexOf('export function rpcAdvancedFilterParams') + 60) + 2);
const appKeys = new Set([...advBlock.matchAll(/\{ (p_[a-z_]+):/g)].map((m) => m[1]));
// Only the option CATALOG (type Opt … optionsFor), not the scope parser, which legitimately carries
// p_region_ids / p_cities — those are location, never an Advanced Filter answer.
const catalog = sweep.slice(sweep.indexOf('type Opt ='), sweep.indexOf('type Leg ='));
check('the catalog region is locatable in the sweep (type Opt … type Leg)', catalog.length > 500, `${catalog.length} chars`);
const catalogKeys = [...new Set([...catalog.matchAll(/params: \{ ([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/(p_[a-z_]+):/g)].map((x) => x[1])))];
check('every request key the catalog applies is one rpcAdvancedFilterParams() can emit',
  catalogKeys.every((k) => appKeys.has(k)),
  `not app-emittable: ${catalogKeys.filter((k) => !appKeys.has(k)).join(', ') || 'none'} · app keys: ${[...appKeys].join(', ')}`);

// ── 4. every predicate column the JS row check reads is one the clause filters ───────────────────
const predCols = [...new Set([...sweep.matchAll(/kind: '(?:true|false|gte|between|eq|in)', col: '([a-z_]+)'/g)].map((m) => m[1]))];
const clauseCols = new Set([...clause.matchAll(/\bs\.([a-z_]+)\b/g)].map((m) => m[1]));
// amenity predicates are built from AMENITY_COL values; RICH_TOKENS become columns of their own name
const amenityCols = [...sweep.matchAll(/AMENITY_COL: Record<string, string> = \{([\s\S]*?)\};/g)][0]?.[1] ?? '';
const amenityColNames = [...amenityCols.matchAll(/: '([a-z_]+)'/g)].map((m) => m[1]);
const rich = [...(sweep.match(/RICH_TOKENS = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const allPredCols = [...new Set([...predCols, ...amenityColNames, ...rich])];
check('every column a catalog predicate reads is a column af_eligibility_clause() filters (same column, both evaluators)',
  allPredCols.every((c) => clauseCols.has(c)),
  `not in the clause: ${allPredCols.filter((c) => !clauseCols.has(c)).join(', ') || 'none'}`);

// ── 5. the card's option vocabulary ⊆ the sweep's ─────────────────────────────────────────────────
const cardKeys = [...new Set([...advanced.matchAll(/\{ key: '([^']+)'/g)].map((m) => m[1]))];
const sweepText = sweep;
const missingKeys = cardKeys.filter((k) => !sweepText.includes(`'${k}'`) && !sweepText.includes(`:${k}`) && !/^\d+$/.test(k) && !['1', '2', '3', '4', '15', '20', '25', '30'].includes(k));
check('every option key the card can render is a key the sweep can apply',
  missingKeys.length === 0, `card keys absent from the sweep: ${missingKeys.join(', ')}`);
check('the card vocabulary is non-trivial (the check above can bite)', cardKeys.length >= 20, `${cardKeys.length}: ${cardKeys.join(', ')}`);

// ── 6. wiring: scheduled, excluded with a home, judge in npm test ────────────────────────────────
const wf = read('.github/workflows/af-live-truth-check.yml');
check('the sweep runs in the scheduled AF live workflow', wf.includes('scripts/verify-af-full-surface-differential.ts'));
check('…in the Riyadh region AND a city scope (two steps)', (wf.match(/verify-af-full-surface-differential\.ts/g) ?? []).length >= 2 && wf.includes('AF_FSD_SCOPES: city:'));
const excl = read('scripts/test-exclusions.txt');
check('the sweep is excluded from npm test WITH that workflow named as its home',
  /verify-af-full-surface-differential\.ts\s*\|\s*\.github\/workflows\/af-live-truth-check\.yml/.test(excl));
check('the judge (afSurfaceJudge) mutation proof runs in npm test', npmTestRuns(root, 'verify-af-surface-judge'));
check('the sweep judges through afSurfaceJudge, not a private comparison', sweep.includes("from './lib/afSurfaceJudge.ts'") && sweep.includes('judgeOption(') && sweep.includes('judgeUnion(') && sweep.includes('judgeIntersection('));
check('the sweep refuses an unmapped certified question loudly (never skips it)', /certified question with NO catalog entry/.test(read('scripts/verify-af-full-surface-differential.ts')));

console.log(failures ? `\n✗ ${failures} check(s) FAILED\n` : '\n✓ the full-surface sweep catalog mirrors the product: no certified option can fall out of the sweep silently\n');
process.exit(failures ? 1 : 0);
