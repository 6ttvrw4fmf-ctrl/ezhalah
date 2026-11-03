// THE STALE-PATH DETECTOR MUST SEE THE FLEET'S OWN LIVENESS RUNS (♻️ lifecycle, 2026-10-26)
//
//   node --experimental-strip-types scripts/verify-stale-remediation-sees-fleet-liveness.ts   (in `npm test`)
//
// mon_detect_stale_no_remediation_path() decides "this platform has a liveness path" from scrape_runs
// labels. It accepted only labels STARTING with the platform (`^plat([_:]|$)`), while the fleet daily
// direct check writes `fleet_liveness:<plat>`. 13 of 18 open P1s on 2026-10-26 were therefore false
// (haraj's fleet run had probed 9,776 ads and hidden 112 that morning).
//
// This check EXECUTES the label pattern from the NEWEST migration that defines the function, rather
// than grepping for a phrase: it pulls the `r.platform ~ (<pattern>)` template out of has_path, builds
// the regex for each platform, and runs it against real run labels in both directions.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(import.meta.dirname, '..', 'supabase', 'migrations');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};

const defining = readdirSync(MIG).sort()
  .filter((f) => /create\s+or\s+replace\s+function\s+public\.mon_detect_stale_no_remediation_path\s*\(/i
    .test(readFileSync(join(MIG, f), 'utf8')));
if (!defining.length) { console.log('FAIL  no migration defines mon_detect_stale_no_remediation_path'); process.exit(1); }
const newest = readFileSync(join(MIG, defining[defining.length - 1]), 'utf8');
console.log(`reading ${defining[defining.length - 1]}`);

// `r.platform ~* 'liveness' and r.platform ~ ('<a>'||plat||'<b>')`
const tpl = (sql: string) => {
  const m = /r\.platform\s*~\*\s*'liveness'\s+and\s+r\.platform\s*~\s*\(\s*'([^']*)'\s*\|\|\s*plat\s*\|\|\s*'([^']*)'\s*\)/i.exec(sql);
  return m ? { pre: m[1], post: m[2] } : null;
};
const hasLivenessPath = (t: { pre: string; post: string }, plat: string, label: string) =>
  /liveness/i.test(label) && new RegExp(t.pre + plat + t.post).test(label);

const t = tpl(newest);
check('the newest definition carries a readable liveness-label pattern', !!t);
if (!t) process.exit(1);

const SEES: Array<[string, string]> = [
  ['haraj', 'fleet_liveness:haraj'],
  ['tuba', 'fleet_liveness:tuba'],
  ['gathern', 'gathern_liveness'],
  ['aqar', 'aqar_liveness_recheck:aqar_residential_listings'],
  ['dealapp', 'dealapp_liveness'],
];
const BLIND: Array<[string, string]> = [
  ['aqar', 'fleet_liveness:aqarmonthly'],   // a longer platform name is not this platform
  ['haraj', 'haraj'],                        // an ordinary crawl is not a liveness path
  ['ashab', 'fleet_liveness:ashabx'],
];
for (const [p, l] of SEES) check(`${p}: «${l}» counts as a liveness path`, hasLivenessPath(t, p, l));
for (const [p, l] of BLIND) check(`${p}: «${l}» does NOT count`, !hasLivenessPath(t, p, l));

// MUTATION: the pre-2026-10-26 prefix-only pattern must be caught by the fleet cases above.
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
const old = tpl(newest.replace(/'\(\^\|:\)'/, "'^'"));
mustCatch('the old prefix-only pattern, blind to fleet_liveness:haraj',
  !!old && !SEES.every(([p, l]) => hasLivenessPath(old, p, l)));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nOK: the stale-path detector sees fleet liveness runs');
