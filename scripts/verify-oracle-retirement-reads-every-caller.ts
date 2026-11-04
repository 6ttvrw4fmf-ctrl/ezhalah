// AN ORACLE IS THE CALLABLE, NOT ONE CALLER'S LABEL FOR IT — hermetic barrier (2026-11-03).
//
// The same per-platform verify_gone runs under two callers: the crawl's db.prune_unseen()
// (oracle = 'prune_unseen.verify_gone') and scrapers/common/fleet_liveness.py
// (oracle = 'fleet_liveness.<platform>', whose SITES map points at "exactly what it hands to
// db.prune_unseen()"). mon_oracle_never_retires() counted only the first label, so suwar read
// "asked 43 times, ZERO GONE or LIVE — it can never retire anything" while the SAME _verify_gone had
// retired 7 listings through the fleet (own page 404). The alarm said the opposite of the truth.
//
// This file EXECUTES oracleAnswerCounts() + oracleNeverRetires() over the measured production rows,
// proves the OLD crawl-only label rule produced the false alarm (mutation), proves an unrelated label
// (sakani's sold-pin end date, a res/com sibling) still does not count, and pins that the newest
// committed SQL definition of both functions carries the same two-label filter.
// Hermetic: reads only repo files.
//
// Run: node --experimental-strip-types scripts/verify-oracle-retirement-reads-every-caller.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  oracleAnswerCounts,
  oracleNeverRetires,
  CRAWL_ORACLE_LABEL,
  AFFIRMATIVE_VERDICTS,
  type OracleProbeRow,
} from './lib/oracleRetirement.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean) => check("mutant killed: " + what, caught);
const rows = (n: number, r: OracleProbeRow): OracleProbeRow[] => Array.from({ length: n }, () => ({ ...r }));

// Production, 2026-11-03 19:3x UTC (ops_stale_inactivation_probe grouped by oracle/verdict).
const SUWAR: OracleProbeRow[] = [
  ...rows(43, { source_table: 'suwar_residential_listings', oracle: CRAWL_ORACLE_LABEL, verdict: 'UNKNOWN' }),
  ...rows(7, { source_table: 'suwar_residential_listings', oracle: 'fleet_liveness.suwar', verdict: 'GONE' }),
  ...rows(1, { source_table: 'suwar_residential_listings', oracle: 'lifecycle_spot_check.suwar(site-oracle)', verdict: 'GONE' }),
];
const SAKANI: OracleProbeRow[] = [
  ...rows(655, { source_table: 'sakani_residential_listings', oracle: CRAWL_ORACLE_LABEL, verdict: 'UNKNOWN' }),
  ...rows(8, { source_table: 'sakani_residential_listings', oracle: 'sakani.sold_pin.ad_end_date', verdict: 'GONE' }),
  ...rows(1, { source_table: 'sakani_commercial_listings', oracle: 'res_com.sibling_classified_this_run', verdict: 'SUPERSEDED' }),
  // another platform's fleet GONE must never leak into sakani's count
  ...rows(3, { source_table: 'suwar_residential_listings', oracle: 'fleet_liveness.suwar', verdict: 'GONE' }),
  // a mislabelled fleet row (another site's label on a sakani table) is not sakani's oracle
  ...rows(2, { source_table: 'sakani_residential_listings', oracle: 'fleet_liveness.suwar', verdict: 'GONE' }),
];
const judge = (platform: string, probe: OracleProbeRow[]) => {
  const c = oracleAnswerCounts(platform, probe);
  return { ...c, flagged: oracleNeverRetires({ platform, strategy: 'CANDIDATE_PLUS_DIRECT', active: 100, ...c }) };
};

const su = judge('suwar', SUWAR);
check('suwar: the fleet GONE answers count — the oracle CAN retire, no alarm', !su.flagged && su.affirmative === 7,
  JSON.stringify(su));
check('suwar: a lifecycle spot-check is not the platform oracle (asks = 43 + 7)', su.asks === 50, JSON.stringify(su));
const sk = judge('sakani', SAKANI);
check('sakani: zero GONE through either caller is STILL flagged (the real alarm survives)', sk.flagged && sk.affirmative === 0,
  JSON.stringify(sk));
check('sakani: sold-pin / sibling / other-site labels are not counted (asks = 655)', sk.asks === 655, JSON.stringify(sk));

// MUTATION — the old rule (crawl label only) must reproduce the false alarm, or this barrier proves nothing.
const oldCounts = (platform: string, probe: OracleProbeRow[]) => {
  const own = probe.filter((r) => r.source_table.split('_')[0] === platform && r.oracle === CRAWL_ORACLE_LABEL);
  return { asks: own.length, affirmative: own.filter((r) => (AFFIRMATIVE_VERDICTS as readonly string[]).includes(r.verdict)).length };
};
mustCatch('the crawl-only label rule flags suwar (the 2026-11-03 false alarm)',
  oracleNeverRetires({ platform: 'suwar', strategy: 'DIRECT_REVISIT', active: 67, ...oldCounts('suwar', SUWAR) }));
// Mutant 2: "any GONE from any label" would clear sakani on its sold-pin rows — that rule is too wide.
const anyLabel = SAKANI.filter((r) => r.source_table.startsWith('sakani_'));
mustCatch('counting every label would wrongly clear sakani',
  !oracleNeverRetires({ platform: 'sakani', strategy: 'CANDIDATE_PLUS_DIRECT', active: 100, asks: anyLabel.length,
    affirmative: anyLabel.filter((r) => r.verdict === 'GONE' || r.verdict === 'LIVE').length }));

// SQL parity — the newest committed definition of each function filters on exactly these two labels.
const MIG = join(ROOT, 'supabase', 'migrations');
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const FILTER = /p\.oracle\s+in\s*\(\s*'prune_unseen\.verify_gone'\s*,\s*'fleet_liveness\.'\s*\|\|\s*split_part\(\s*p\.source_table\s*,\s*'_'\s*,\s*1\s*\)\s*\)/i;
for (const fn of ['mon_oracle_retirement_facts', 'mon_oracle_never_retires']) {
  const head = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, 'i');
  const latest = files.filter((f) => head.test(readFileSync(join(MIG, f), 'utf8'))).pop();
  if (!latest) { check(`${fn}: a committed definition exists`, false, 'none found'); continue; }
  const sql = readFileSync(join(MIG, latest), 'utf8');
  const start = sql.search(head);
  const nextFn = sql.slice(start + 1).search(/create\s+or\s+replace\s+function/i);
  const body = nextFn < 0 ? sql.slice(start) : sql.slice(start, start + 1 + nextFn);
  check(`${fn}: newest definition (${latest}) counts both callers of verify_gone`, FILTER.test(body),
    'expected: p.oracle in (\'prune_unseen.verify_gone\', \'fleet_liveness.\' || split_part(p.source_table, \'_\', 1))');
}

console.log(failed === 0 ? '\nOK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
