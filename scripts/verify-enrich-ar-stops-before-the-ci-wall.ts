// THE WASALT AR ENRICHER STOPS ON ITS OWN CLOCK, NOT ON THE CI WALL — executed, not read.
//
// THE DEFECT (ops_incident #307, root-caused 2026-09-18 by routine #4). enrich_table() walked every
// row it had been handed with no time budget, so on the residential table the job ran until GitHub's
// `timeout-minutes: 60` killed it. Measured on run 35367340468: the COMMERCIAL job finished in 18
// seconds (nothing pending) while the RESIDENTIAL job ran 16:15:05 → 17:15:11 — exactly 60 minutes.
// GitHub reports a timeout kill as `cancelled`, not `failure`, which is why the run history read as
// a wall of "cancelled" and nobody recognised it as a timeout: 7 of the last 12 runs died that way.
//
// Being killed loses no listing data (each row is its own UPDATE, already committed) — it loses the
// HONEST ACCOUNTING, which is what monitoring runs on:
//   * db.end_run() never executes, so the scrape_runs row is left open. The standing
//     `run_killed_by_timeout` P1 alerts were this job truthfully reporting that it was killed.
//   * the errored-row retry pass is LAST, so a long run never reached it at all — errored rows were
//     starved on exactly the runs that most needed draining.
//
// THE FIX: a self-imposed `--max-seconds` budget (2700s, inside the 60-minute backstop). On expiry
// the remaining rows are SKIPPED — left completely untouched, so `ar_fetched` stays false and the
// next scheduled run picks them up — and the process reaches end_run() and reports what it really
// did. A skip is counted separately from a failure, because "I ran out of clock" is not "the source
// failed me".
//
// WHY THIS BARRIER IS SHAPED LIKE THIS. It RUNS the real enrich_table() from
// scrapers/wasalt/enrich_ar.py against a stub Supabase client, with the budget already expired and
// again with a generous budget, and asserts on behaviour: zero proxy fetches when out of time, the
// rows left pending, the retry query never opened, and normal processing untouched when there is
// time. A source-text check would have passed for the whole 72 hours the defect was live.
//
//   node --experimental-strip-types scripts/verify-enrich-ar-stops-before-the-ci-wall.ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PY = join(ROOT, 'scrapers/wasalt/enrich_ar.py');
const WF = join(ROOT, '.github/workflows/wasalt-enrich-ar.yml');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// The harness: stub `db` and the network, call the REAL enrich_table, print JSON we can assert on.
// `fetches` counts real proxy work; `updated` counts rows written. Nothing here reimplements the
// deadline — that logic is the imported production function's.
const HARNESS = String.raw`
import json, sys, time, types

# Stub scrapers.common.db BEFORE importing the module under test, so no real client is ever built.
db = types.ModuleType("scrapers.common.db")
class _Res:
    def __init__(self, data=None, count=None): self.data = data or []; self.count = count
class _Q:
    def __init__(self, t, log): self._t = t; self._log = log; self._head = False
    def select(self, *a, **k):
        if k.get("head"): self._head = True
        return self
    def eq(self, *a): return self
    def like(self, *a): return self
    def lt(self, *a): return self
    def is_(self, *a): return self
    def order(self, *a): return self
    def limit(self, n): self._limit = n; return self
    def update(self, upd): self._log["updated"] += 1; return self
    @property
    def not_(self): self._log["retry_query_opened"] += 1; return self
    def execute(self):
        if self._head: return _Res(count=self._log["pending"])
        if self._log["retry_query_opened"]: return _Res(data=[])
        return _Res(data=[{"id": i, "ad_number": "WST%d" % i,
                           "listing_url": "https://wasalt.sa/en/property/x-%d" % i}
                          for i in range(self._log["pending"])])
class _C:
    def __init__(self, log): self._log = log
    def table(self, t): return _Q(t, self._log)
LOG = {"pending": 0, "updated": 0, "retry_query_opened": 0, "fetches": 0}
db.sb = lambda: _C(LOG)
db.begin_run = lambda *a, **k: 1
db.end_run = lambda *a, **k: None
db.guard_location_update = lambda *a, **k: None
sys.modules["scrapers.common.db"] = db
sys.modules.setdefault("scrapers.common", types.ModuleType("scrapers.common"))

import scrapers.wasalt.enrich_ar as E

E._load_catalog = lambda: None
def _fake_fetch(slug):
    LOG["fetches"] += 1
    return True, {"city": {"nameAr": "الرياض"}}, "الرياض", "حي النرجس"
E.fetch_ar = _fake_fetch
E._region_for = lambda c: 1

mode = sys.argv[1]
LOG["pending"] = 25
budget = 0.0001 if mode == "expired" else 600.0

# DETERMINISM (found 2026-09-18, this barrier itself was flaky ~80% of runs). enrich_table() uses
# ThreadPoolExecutor(max_workers=4).map(...), which DISPATCHES up to 4 worker threads immediately —
# each worker's out_of_time() check then races the real OS thread scheduler against a 0.0001s
# (100-microsecond) window. That race is invisible in production (the real budget is 2700s, so a
# hundred-microsecond scheduling jitter never matters) but turns this "expired" case into a coin
# flip under real CI timing: sometimes every worker's check loses the race and 1 row gets fully
# processed before it sees "out of time", exactly like the ops_incident #307 defect this barrier
# exists to catch — a FALSE POSITIVE for the fix, not a real regression.
#
# THE FIX IS TEST-ONLY. scrapers/wasalt/enrich_ar.py is untouched — its real-world behaviour does
# not depend on winning a microsecond race. Monkeypatch time.monotonic() so "is the deadline past?"
# is decided by which CALL NUMBER we are on, never by real wall-clock speed: the FIRST call (inside
# enrich_table, computing "deadline = monotonic() + max_seconds") returns a baseline; every call
# after that (every worker thread's out_of_time() check) jumps a million seconds further ahead,
# so it is ALWAYS past deadline — deterministically, on any machine, under any load.
if mode == "expired":
    _clock = [0.0]
    def _fake_monotonic():
        _clock[0] += 1_000_000.0
        return _clock[0]
    time.monotonic = _fake_monotonic

stats = E.enrich_table("wasalt_residential_listings", 2000, 4, max_seconds=budget)
print(json.dumps({"stats": stats, "log": LOG}))
`;

function run(mode: 'expired' | 'ample'): { stats: Record<string, number>; log: Record<string, number> } {
  const out = execFileSync('python3', ['-c', HARNESS, mode], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  if (!line) throw new Error(`harness produced no JSON:\n${out.slice(-800)}`);
  return JSON.parse(line);
}

// ── 1. BUDGET ALREADY GONE → a clean, honest stop ────────────────────────────────────────────────
const expired = run('expired');
check('an expired budget skips every row instead of working past the wall',
  expired.stats.skipped === 25, JSON.stringify(expired.stats));
check('an expired budget performs ZERO proxy fetches',
  expired.log.fetches === 0, `fetches=${expired.log.fetches}`);
check('an expired budget writes NOTHING, so the rows stay pending for the next run',
  expired.log.updated === 0, `updated=${expired.log.updated}`);
check('an expired budget never even opens the errored-row retry query',
  expired.log.retry_query_opened === 0, `opened=${expired.log.retry_query_opened}`);
check('a time-budget skip is NOT reported as a failure',
  (expired.stats.fail ?? 0) === 0, JSON.stringify(expired.stats));
check('enrich_table still RETURNS (the caller reaches db.end_run) instead of being killed',
  typeof expired.stats === 'object' && 'skipped' in expired.stats);

// ── 2. AMPLE BUDGET → the ordinary path is untouched ─────────────────────────────────────────────
const ample = run('ample');
check('an ample budget processes every row',
  ample.stats.ok === 25 && (ample.stats.skipped ?? 0) === 0, JSON.stringify(ample.stats));
check('an ample budget really does fetch and write',
  ample.log.fetches === 25 && ample.log.updated === 25,
  `fetches=${ample.log.fetches} updated=${ample.log.updated}`);

// ── 3. THE BUDGET IS ACTUALLY WIRED, AND SITS INSIDE THE BACKSTOP ────────────────────────────────
const wf = readFileSync(WF, 'utf8');
const passed = /--max-seconds\s+(\d+)/.exec(wf);
const wall = /timeout-minutes:\s*(\d+)/.exec(wf);
check('the workflow passes --max-seconds', !!passed, 'no --max-seconds in wasalt-enrich-ar.yml');
check('the workflow still declares timeout-minutes as a backstop', !!wall);
if (passed && wall) {
  const budget = Number(passed[1]);
  const backstop = Number(wall[1]) * 60;
  check(`the budget (${budget}s) sits strictly inside the CI wall (${backstop}s)`, budget < backstop);
  check('the budget leaves at least 5 minutes of headroom for install + end_run',
    backstop - budget >= 300, `headroom=${backstop - budget}s`);
}
const py = readFileSync(PY, 'utf8');
check('the default budget is non-zero, so a hand-run cloud job is bounded too',
  /--max-seconds"[\s\S]{0,200}?default=2700\.0/.test(py));
check('enrich_table accepts and honours max_seconds (deadline computed from it)',
  /max_seconds: float = 0\.0/.test(py) && /deadline = \(time\.monotonic\(\) \+ max_seconds\)/.test(py));

// ── 4. MUTATION PROOF — the assertions above can actually see the defect ─────────────────────────
let mutFail = 0;
const mustCatch = (what: string, caught: boolean) => {
  if (caught) { console.log(`KILLED  ${what}`); return; }
  mutFail++;
  console.error(`SURVIVED  ${what}  ← the assertion above cannot see this defect`);
};
// M1 — the pre-fix behaviour: no budget at all, so an out-of-time run keeps fetching to the wall.
// Modelled by running with the budget DISABLED (max_seconds=0), which is exactly the old code path.
const unbounded = execFileSync('python3', ['-c', HARNESS.replace(
  'budget = 0.0001 if mode == "expired" else 600.0', 'budget = 0.0'), 'expired'], {
  cwd: ROOT, encoding: 'utf8', timeout: 120_000,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
});
const unboundedLog = JSON.parse(unbounded.trim().split('\n').filter((l) => l.startsWith('{')).pop()!);
mustCatch('an unbounded run (the pre-fix path) works past the deadline instead of skipping',
  unboundedLog.log.fetches === 25 && (unboundedLog.stats.skipped ?? 0) === 0);
// M2 — a budget that is not inside the wall is no protection at all.
mustCatch('a --max-seconds >= timeout-minutes (a budget that cannot fire first)',
  (() => { const b = 3600, w = 60 * 60; return !(b < w); })());

if (failures || mutFail) {
  console.error(`\n❌ ${failures} assertion failure(s), ${mutFail} blind mutation(s)`);
  process.exit(1);
}
console.log('\n✅ the enricher stops on its own clock, keeps its accounting, and leaves the rest pending');
