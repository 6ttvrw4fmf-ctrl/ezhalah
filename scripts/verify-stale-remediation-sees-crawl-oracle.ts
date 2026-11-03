// THE STALE-PATH DETECTOR MUST SEE THE CRAWL'S OWN PRUNE ORACLE — AND ONLY WHEN IT DECIDED (2026-11-03)
//
//   node --experimental-strip-types scripts/verify-stale-remediation-sees-crawl-oracle.ts   (in `npm test`)
//
// mon_detect_stale_no_remediation_path() raised «NO cleanup/liveness run … nothing will ever re-check
// them» on abralosol, amlakalahsa and wahadat, whose crawls re-read every at-grace row's own page through
// prune_unseen(verify_gone=…) and had recorded 3–35 GONE verdicts in ops_stale_inactivation_probe that
// month. That path writes no separate scrape_runs label, so the detector could not see it.
//
// This check reads the NEWEST migration that defines the function, pulls out the clause on
// ops_stale_inactivation_probe, and EXECUTES it as a predicate over evidence rows in both directions:
//   a table whose oracle decided (GONE / LIVE) in the window → has a path (resolved);
//   a table whose oracle only ever said UNKNOWN (maqrat) → no path (stays raised);
//   another table's verdict, or one older than the window → no path.
// Mutations: dropping the clause, admitting UNKNOWN, or keying by platform instead of table each fail.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(import.meta.dirname, '..', 'supabase', 'migrations');
let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const defining = readdirSync(MIG).sort()
  .filter((f) => /create\s+or\s+replace\s+function\s+public\.mon_detect_stale_no_remediation_path\s*\(/i
    .test(readFileSync(join(MIG, f), 'utf8')));
if (!defining.length) { console.log('FAIL  no migration defines mon_detect_stale_no_remediation_path'); process.exit(1); }
const newestName = defining[defining.length - 1];
const newest = readFileSync(join(MIG, newestName), 'utf8');
console.log(`reading ${newestName}`);

type Clause = { keyedByTable: boolean; windowed: boolean; verdicts: string[] };
const parse = (sql: string): Clause | null => {
  const body = sql.replace(/--[^\n]*/g, '');
  const m = /from\s+public\.ops_stale_inactivation_probe\s+(\w+)\s+where\s+([\s\S]*?)\)\s*;/i.exec(body);
  if (!m) return null;
  const [, a, where] = m;
  const v = new RegExp(`${a}\\.verdict\\s+in\\s*\\(([^)]*)\\)`, 'i').exec(where);
  return {
    keyedByTable: new RegExp(`${a}\\.source_table\\s*=\\s*rec\\.tn\\b`, 'i').test(where),
    windowed: new RegExp(`${a}\\.probed_at\\s*>\\s*now\\(\\)\\s*-\\s*path_window`, 'i').test(where),
    verdicts: v ? [...v[1].matchAll(/'([^']*)'/g)].map((x) => x[1].toUpperCase()) : [],
  };
};

type Row = { source_table: string; verdict: string; ageDays: number };
const hasPath = (c: Clause | null, table: string, rows: Row[]) =>
  !!c && c.keyedByTable && c.windowed &&
  rows.some((r) => r.source_table === table && r.ageDays < 30 && c.verdicts.includes(r.verdict));

const EVIDENCE: Row[] = [
  { source_table: 'jurash_residential_listings', verdict: 'GONE', ageDays: 1 },
  { source_table: 'compoundin_residential_listings', verdict: 'LIVE', ageDays: 2 },
  { source_table: 'maqrat_residential_listings', verdict: 'UNKNOWN', ageDays: 0 },
  { source_table: 'maqrat_residential_listings', verdict: 'UNKNOWN', ageDays: 5 },
  { source_table: 'maqrat_commercial_listings', verdict: 'GONE', ageDays: 3 },
  { source_table: 'wahadat_residential_listings', verdict: 'GONE', ageDays: 45 },
];
const cases = (c: Clause | null) => ({
  gone: hasPath(c, 'jurash_residential_listings', EVIDENCE),
  live: hasPath(c, 'compoundin_residential_listings', EVIDENCE),
  unknownOnly: !hasPath(c, 'maqrat_residential_listings', EVIDENCE),
  oldOnly: !hasPath(c, 'wahadat_residential_listings', EVIDENCE),
  none: !hasPath(c, 'vmksa_residential_listings', EVIDENCE),
});

const c = parse(newest);
check('the newest definition carries a readable ops_stale_inactivation_probe clause', !!c);
const r = cases(c);
check('a table whose oracle read GONE in the window has a path', r.gone);
check('a table whose oracle read LIVE in the window has a path', r.live);
check('a table whose oracle only ever said UNKNOWN (maqrat) has NO path — sibling table GONE does not lend one', r.unknownOnly);
check('a verdict older than the window is not a path', r.oldOnly);
check('a table with no evidence has no path', r.none);
check('the scrape_runs label paths are still there (cleanup / aqar_cleanup / liveness)',
  /r\.platform\s*=\s*'cleanup:'\|\|plat/.test(newest) && /aqar\\_cleanup:/.test(newest)
  && /r\.platform\s*~\*\s*'liveness'/.test(newest));

// MUTATIONS — each must break at least one case above.
const allPass = (x: ReturnType<typeof cases>) => Object.values(x).every(Boolean);
const mut = (label: string, sql: string) => check(`(mutation) catches ${label}`, !allPass(cases(parse(sql))));
mut('the clause removed', newest.replace(/ops_stale_inactivation_probe/g, 'ops_nothing'));
mut('UNKNOWN admitted as a path', newest.replace(/'GONE','LIVE'/, "'GONE','LIVE','UNKNOWN'"));
mut('keyed by platform instead of table', newest.replace(/p\.source_table = rec\.tn/, "p.source_table like plat||'%'"));
mut('no time window', newest.replace(/and p\.probed_at > now\(\) - path_window /, ''));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nOK: the stale-path detector sees the crawl oracle only when it decided');
