// The liveness registry now exists twice, and the copies must not drift.
//
// scrapers/common/liveness_policies.py decides what the CRAWLERS do: which platforms are
// production-searchable, which strategy tier each one uses, how many consecutive direct dead
// verdicts it takes to deactivate, and how fresh a verification has to be. ops_liveness_registry
// (migration 20260830191646) decides what MONITORING believes: the same facts, in SQL, because the
// dashboard and both liveness detectors have to read them from inside Postgres.
//
// Two copies of one truth is exactly how a monitor goes quietly wrong. If someone tightens aqar's
// SLA from 48h to 24h in Python and nobody touches the SQL, the crawler probes on the new schedule
// while ops_platform_liveness_coverage keeps grading it against the old one — and reports a
// platform as healthy on a window it no longer runs. Worse: drop a platform from the Python
// registry and the SQL row survives, so the dashboard goes on reporting coverage for inventory
// that nothing verifies any more.
//
// sql/mirrors/liveness_registry.json is the pivot. This check proves all three agree:
//
//   liveness_policies.py  ==  sql/mirrors/liveness_registry.json  ==  the migration's seed
//
// so a change in any one of them fails at PR time, in a suite with no database and no Python.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const PY = join(ROOT, 'scrapers', 'common', 'liveness_policies.py');
const JSON_MIRROR = join(ROOT, 'sql', 'mirrors', 'liveness_registry.json');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const SEED_MIGRATION = '20260830191646';

const TIERS = ['DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT', 'CRAWL_PRESENCE_ONLY'] as const;

let failures = 0;
// Detail is diagnosis, printed only when something is wrong: a passing run that explains at
// length what its failure WOULD have meant buries the one line that matters.
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

type Row = { platform: string; strategy: string; sla_hours: number; grace: number };
const key = (r: Row) => `${r.platform}|${r.strategy}|${r.sla_hours}|${r.grace}`;
const sorted = (rows: Row[]) => [...rows].sort((a, b) => a.platform.localeCompare(b.platform));

console.log('verify-liveness-registry-mirror: one liveness registry, three places, no drift.');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. The Python registry — the source of truth every other copy is derived from.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const py = readFileSync(PY, 'utf8');
const fromPython: Row[] = [];

// Tier 1 and 2 are written out one platform at a time:
//     "aqar": _P(_pol("aqar", 3, 48), DIRECT_REVISIT, "...
for (const m of py.matchAll(
  /"(\w+)":\s*_P\(\s*_pol\("(\w+)",\s*(\d+),\s*(\d+)\),\s*(DIRECT_REVISIT|CANDIDATE_PLUS_DIRECT|CRAWL_PRESENCE_ONLY)/g,
)) {
  const [, name, polName, grace, sla, strategy] = m;
  check(`tier-1/2 entry ${name} names itself consistently`, name === polName,
    `dict key "${name}" vs _pol("${polName}") — a mismatch here silently registers the wrong ` +
    'platform under the wrong policy');
  fromPython.push({ platform: name, strategy, sla_hours: Number(sla), grace: Number(grace) });
}

// Tier 3 is one comprehension over a tuple of names:
//     **{ p: _P(_pol(p, 3, 168), CRAWL_PRESENCE_ONLY, ...) for p in ("abeea", "aldarim", ...) }
const tier3 = py.match(
  /_P\(_pol\(p,\s*(\d+),\s*(\d+)\),\s*(CRAWL_PRESENCE_ONLY)[\s\S]*?for p in \(([\s\S]*?)\)\s*\}/,
);
check('the CRAWL_PRESENCE_ONLY comprehension is present and parseable', Boolean(tier3),
  tier3 ? '' : 'the tier-3 block in liveness_policies.py no longer matches the shape this check ' +
  'parses. Do not delete this check — update it, or the known-gap platforms stop being verified ' +
  'against the SQL registry at all.');
if (tier3) {
  const [, grace, sla, strategy, names] = tier3;
  for (const m of names.matchAll(/"(\w+)"/g)) {
    fromPython.push({ platform: m[1], strategy, sla_hours: Number(sla), grace: Number(grace) });
  }
}

// A shape this parser cannot read must fail loudly rather than silently register fewer platforms.
// Every `_P(...)` CALL in the file is either one tier-1/2 entry or the single tier-3
// comprehension; `class _P(dict)` is the type itself and is not a registry entry.
const pCalls = (py.match(/(?<!class )_P\(/g) ?? []).length;
const tier12 = (py.match(/"\w+":\s*_P\(/g) ?? []).length;
const expectedPCalls = tier12 + (tier3 ? 1 : 0);
check('every _P(...) registry entry was parsed', pCalls === expectedPCalls,
  `${pCalls} _P( calls in the file, ${expectedPCalls} attributed (${tier12} tier-1/2 + ` +
  `${tier3 ? 1 : 0} comprehension). An unparsed entry would be a platform this barrier cannot see.`);
check('the Python registry is non-empty', fromPython.length > 0, `${fromPython.length} platforms`);

const dupes = fromPython.map((r) => r.platform)
  .filter((p, i, a) => a.indexOf(p) !== i);
check('no platform is registered twice in Python', dupes.length === 0, dupes.join(', '));

for (const r of fromPython) {
  if (!TIERS.includes(r.strategy as typeof TIERS[number])) {
    check(`${r.platform} declares a known strategy tier`, false, r.strategy);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. The JSON mirror.
// ─────────────────────────────────────────────────────────────────────────────────────────────
let fromJson: Row[] = [];
try {
  fromJson = JSON.parse(readFileSync(JSON_MIRROR, 'utf8')) as Row[];
} catch (e) {
  check('sql/mirrors/liveness_registry.json is readable JSON', false, String(e));
}

const pyKeys = sorted(fromPython).map(key);
const jsonKeys = sorted(fromJson).map(key);
const diff = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));
check('the JSON mirror matches liveness_policies.py exactly',
  pyKeys.join('\n') === jsonKeys.join('\n'),
  pyKeys.join('\n') === jsonKeys.join('\n') ? `${pyKeys.length} platforms` :
  `only in Python: [${diff(pyKeys, jsonKeys).join(', ')}] | only in JSON: ` +
  `[${diff(jsonKeys, pyKeys).join(', ')}]. Regenerate the mirror from the Python registry.`);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. The migration that seeds ops_liveness_registry.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const seedFile = readdirSync(MIGRATIONS).find((f) => f.startsWith(SEED_MIGRATION));
check('the seeding migration is mirrored in the repo', Boolean(seedFile),
  seedFile ?? `no file starting ${SEED_MIGRATION} — ops_liveness_registry exists in production ` +
  'with no committed source (migration drift).');

if (seedFile) {
  const sql = readFileSync(join(MIGRATIONS, seedFile), 'utf8');
  const fromSql: Row[] = [...sql.matchAll(/\('(\w+)','(\w+)',(\d+),(\d+)\)/g)].map((m) => ({
    platform: m[1], strategy: m[2], sla_hours: Number(m[3]), grace: Number(m[4]),
  }));
  const sqlKeys = sorted(fromSql).map(key);
  check('the migration seeds exactly the registry the JSON mirror declares',
    sqlKeys.join('\n') === jsonKeys.join('\n'),
    sqlKeys.join('\n') === jsonKeys.join('\n') ? `${sqlKeys.length} platforms` :
    `only in SQL: [${diff(sqlKeys, jsonKeys).join(', ')}] | only in JSON: ` +
    `[${diff(jsonKeys, sqlKeys).join(', ')}]`);

  // Insert-only would let a removed platform live on in the SQL table forever, still counted on
  // the dashboard, still graded against an SLA nothing enforces.
  const notIn = sql.match(/delete from public\.ops_liveness_registry\s*\n?\s*where platform not in \(([^)]*)\)/);
  check('the migration also DELETES platforms that left the registry', Boolean(notIn),
    notIn ? '' : 'no `delete ... where platform not in (...)` — an insert-only seed cannot ' +
    'retire a platform, so the dashboard would keep reporting coverage for inventory nothing ' +
    'verifies any more.');
  if (notIn) {
    const kept = [...notIn[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    const want = sorted(fromJson).map((r) => r.platform);
    check('the retention list matches the registry', kept.join(',') === want.join(','),
      kept.join(',') === want.join(',') ? `${kept.length} platforms kept` :
      `keep-list [${diff(kept, want).join(', ')}] vs registry [${diff(want, kept).join(', ')}]`);
  }

  // Both detectors must be reachable, or the dashboard is decoration (AGENTS.md: a detector
  // nothing calls is decoration, and mon_detect_orphaned_detectors fires on it).
  // The name must appear as a DOUBLED-quote literal — that is the roster payload spliced into
  // mon_run_all_detectors by the replace(). The migration's own post-check reads the same names in
  // single quotes, so accepting either form would let the roster entry be deleted while the
  // post-check's mention alone kept this green (it did, until the mutation run caught it).
  for (const fn of ['mon_detect_liveness_coverage_ramp', 'mon_detect_liveness_verification_sla']) {
    check(`${fn} is spliced into the mon_run_all_detectors roster by the migration`,
      sql.includes(`''${fn}''`),
      `no ''${fn}'' literal in the roster replace() — a detector nothing calls is decoration`);
  }
  check('the roster edit refuses rather than silently no-ops if its anchor moved',
    /raise exception 'roster anchor not found/.test(sql),
    'without this, a rebuilt mon_run_all_detectors would leave both detectors unreachable and ' +
    'the migration would still report success');
  check('the census is scheduled, not left to be called by hand',
    /cron\.schedule\('liveness-coverage-snapshot'/.test(sql));

  // The two thresholds the owner set are load-bearing; changing them is a decision, not a nit.
  check('the ramp monitor is temporary and self-retiring', /v_expires date := date '2026-10-15'/.test(sql));
  check('the SLA monitor is grace-dated rather than alerting from day one',
    /v_active_from date := date '2026-09-13'/.test(sql),
    'day-one coverage is 0% everywhere by construction; alerting immediately would produce 29 ' +
    'alerts that say only "the column is new"');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. A platform the registry calls verifiable must ACTUALLY stamp verification.
//
// This is the gap that made the dashboard a lie for its first hour. aqar, gathern and wasalt are
// all registered DIRECT_REVISIT — they each fetch a listing's own URL and read an affirmative live
// answer — and not one of them wrote last_verified_alive_at. The census would have read 0%
// verified across 173,501 active rows forever, and "0% verified" would have looked like a fleet
// with no verification rather than three working sweeps that simply never recorded their result.
//
// So: a tier-1/tier-2 registry entry is a CLAIM, and the claim has to be cashed in code.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const STAMPERS = ['direct_alive_patch', 'verification_patch'];
for (const r of fromJson.filter((x) => x.strategy !== 'CRAWL_PRESENCE_ONLY')) {
  const candidates = [
    join(ROOT, 'scrapers', r.platform, 'liveness.py'),
    join(ROOT, 'scrapers', r.platform, 'liveness_run.py'),
  ];
  const sources = candidates.map((f) => {
    try { return readFileSync(f, 'utf8'); } catch { return ''; }
  });
  check(`${r.platform} has a liveness module`, sources.some((s) => s.length > 0),
    `neither liveness.py nor liveness_run.py under scrapers/${r.platform}/ — it is registered ` +
    `${r.strategy}, which is a claim that something re-verifies its listings`);
  const all = sources.join('\n');
  check(`${r.platform} records its own ALIVE verdicts (last_verified_alive_at)`,
    STAMPERS.some((fn) => all.includes(`${fn}(`)),
    `its liveness module never calls ${STAMPERS.join('() or ')}(), so every row it proves alive ` +
    'is written back with no record that it was proven. ops_platform_liveness_coverage would ' +
    `read 0% verified for ${r.platform} no matter how well the sweep runs.`);
}

// And the column stays the contract's to write. A sweep that sets it by hand can stamp a row it
// never verified — a confident, recent-looking timestamp on inventory nobody checked, which is
// worse than the blind spot the column was added to remove.
const COLUMN = 'last_verified_alive_at';
const offenders: string[] = [];
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__pycache__' || e.name === 'tests') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.py')) continue;
    if (p.endsWith(join('common', 'liveness_contract.py'))) continue;  // where the rule lives
    const src = readFileSync(p, 'utf8');
    // A mention inside a comment or docstring is documentation, not a write.
    const code = src.replace(/#[^\n]*/g, '').replace(/"""[\s\S]*?"""/g, '');
    // A WRITE, specifically: the column as a dict key in an update payload. Reading it is fine and
    // necessary -- the dealapp runner selects and orders by it to probe never-verified rows first.
    if (new RegExp(`["']${COLUMN}["']\\s*:`).test(code)) {
      offenders.push(p.slice(ROOT.length + 1));
    }
  }
};
walk(join(ROOT, 'scrapers'));
check(`no scraper writes ${COLUMN} outside the contract`, offenders.length === 0,
  offenders.length
    ? `${offenders.join(', ')} — route the write through direct_alive_patch() or ` +
      'verification_patch() so the "only a direct affirmative read stamps this" rule stays in one ' +
      'place'
    : 'every stamp goes through liveness_contract.py');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. This check must itself be run.
// ─────────────────────────────────────────────────────────────────────────────────────────────
check('this barrier is discovered and run by npm test',
  npmTestRuns(ROOT, 'verify-liveness-registry-mirror'));

console.log(
  failures === 0
    ? '\n✅ verify-liveness-registry-mirror: all checks passed.'
    : `\n❌ verify-liveness-registry-mirror: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
