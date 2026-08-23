// Regression guard (2026-08-09) for the retention-cleanup anomaly gate deadlocking, and for the
// destructive-path safety properties that must survive any future edit to it.
//
// THE BUG THIS EXISTS TO PREVENT
// ------------------------------
// The anomaly gate compared the candidate count against max(anomaly_floor, factor × trailing
// median). But the candidate SELECT was `.limit(max_delete_per_run + 1)`, so the MEASUREMENT was
// pinned at cap+1. gathern shipped with anomaly_floor == max_delete_per_run == 300, so the count
// was reported as exactly 301 > 300 and the job aborted DETERMINISTICALLY on every run
// (cleanup_runs id 6, 2026-08-09) — a permanent deadlock: the backlog could never drain below the
// floor because deletion is capped at the floor. 488 rows sat eligible and untouched.
//
// The SAME clamp had a second, worse consequence: the measurement SATURATED at cap+1, so a genuine
// catastrophe (source outage, sitemap collapse) reported as ~301 eligible rows under any sane floor
// and the gate would happily delete a full batch every run. The gate could not see a spike at all.
//
// The fix separates measurement from work-set: an exact unclamped count feeds the gate, and a
// separate capped SELECT feeds the deletion batch. This guard EXECUTES the real `run()` against a
// stubbed Supabase client (no network, no DB), asserting that both failure modes are gone AND that
// every safety property the owner required still holds:
//   1. a catastrophic spike is SEEN and refused (the saturation blindness is gone)
//   2. the gate sees the TRUE eligible population, not a cap-clamped number
//   3. anomaly_floor == max_delete_per_run no longer deadlocks a normal backlog
//   4. deletion stays capped at max_delete_per_run per run, logged before deleting
//   5. source verification: a LIVE page reactivates and is never deleted
//   6. source verification: an ambiguous response (403/timeout) is skipped and never deleted
//   7. a mass-inactivation fraction guard aborts a partial-crawl / source-outage shape
//
// NOTE on what is deliberately NOT enforced: an earlier draft made anomaly_floor <= max_delete_per_run
// a hard abort. That is wrong — it is not the deadlock condition (any floor below the standing
// backlog deadlocks, whatever the cap) and it fails closed for every platform on DEFAULT_POLICY,
// where floor=300 < cap=500. CI caught it. The abort message now names the remedy instead.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-cleanup-anomaly-gate: the retention gate must never deadlock, and must never');
console.log('  delete anything the source has not proven gone.');

const HARNESS = `
import json, os, sys, types
sys.path.insert(0, os.getcwd())

fake = types.ModuleType("supabase")
class Client: pass
def create_client(*a, **k): return Client()
fake.Client = Client; fake.create_client = create_client
sys.modules.setdefault("supabase", fake)

SCENARIO = json.loads(os.environ["SCENARIO"])
DELETED, REACTIVATED, LOGGED = [], [], []

TABLE = "gathern_residential_listings"

def _rows(n, start=1):
    return [{"id": start + i, "ad_number": "G%d" % (start + i),
             "listing_url": "https://gathern.co/u/%d" % (start + i),
             "missing_count": 3, "last_seen_at": "2026-07-05T00:00:00+00:00"} for i in range(n)]

class Q:
    def __init__(self, t): self.t=t; self.op=None; self.payload=None; self._count=False; self._limit=None
    def select(self, *a, **k):
        self.op="select"; self._count = (k.get("count")=="exact"); return self
    def insert(self, row): self.op="insert"; self.payload=row; return self
    def update(self, row): self.op="update"; self.payload=row; return self
    def delete(self): self.op="delete"; return self
    def eq(self,c,v): return self
    def gte(self,c,v): return self
    def lt(self,c,v): return self
    def is_(self,c,v): return self
    def order(self,*a,**k): return self
    def limit(self,n): self._limit=n; return self
    def in_(self,c,vals):
        if self.op=="delete": DELETED.extend(vals)
        elif self.op=="update" and self.payload.get("active") is True: REACTIVATED.extend(vals)
        return self
    def execute(self):
        R = types.SimpleNamespace
        if self.t=="platform_retention_policy":
            return R(data=[SCENARIO["policy"]], count=None)
        if self.t=="cleanup_runs":
            if self.op=="select": return R(data=[], count=None)   # trailing median = 0
            return R(data=[{"id":1}], count=None)
        if self.t=="scrape_runs":
            return R(data=[{"id": 999}], count=None)
        if self.t=="cleanup_deletion_log":
            if self.op=="insert": LOGGED.extend(self.payload)
            return R(data=[], count=None)
        if self.t=="alert_event":
            # Platform-health precondition (barrier 2, 2026-08-22). Empty by default (healthy) so
            # every pre-existing scenario is unaffected; a scenario opts into the degraded case by
            # setting "alert_event_rows" explicitly (see the health-gate scenario below).
            return R(data=SCENARIO.get("alert_event_rows", []), count=None)
        if self.t==TABLE:
            if self._count:
                # two count queries per table: eligible, then total rows
                if not hasattr(self,"_seen"):
                    Q._ncount = getattr(Q,"_ncount",0)+1
                if SCENARIO.get("no_count"):
                    return R(data=[], count=None)   # broken/absent Content-Range
                return R(data=[{"id":1}], count=(SCENARIO["eligible"] if Q._ncount%2==1 else SCENARIO["platform_rows"]))
            n = min(SCENARIO["eligible"], self._limit or SCENARIO["eligible"])
            return R(data=_rows(n), count=None)
        return R(data=[], count=None)

class SB:
    def table(self, name): return Q(name)

from scrapers.common import cleanup, db
db.sb = lambda: SB()
cleanup.sb = lambda: SB()
db.begin_run = lambda p: 999
db.end_run = lambda *a, **k: True
cleanup.begin_run = lambda p: 999
cleanup.end_run = lambda *a, **k: True
cleanup._probe = lambda url: tuple(SCENARIO["probe"])

try:
    stats = cleanup.run("gathern", dry_run=SCENARIO.get("dry_run", False))
    err = None
except Exception as e:
    stats, err = {}, str(e)
out = {"stats": stats, "err": err, "deleted": len(DELETED),
       "reactivated": len(REACTIVATED), "logged": len(LOGGED)}
with open(os.environ["OUT"], "w") as fh: json.dump(out, fh)
`;

const tmp = mkdtempSync(join(tmpdir(), 'cleanup-guard-'));
const POLICY = (over: Record<string, unknown> = {}) => ({
  platform: 'gathern', enabled: true, min_inactive_days: 30, min_missing_count: 3,
  require_source_recheck: true, max_delete_per_run: 300, anomaly_floor: 1000,
  anomaly_factor: 4, max_eligible_frac: 0.10, ...over,
});

function scenario(name: string, s: Record<string, unknown>) {
  const out = join(tmp, `${name}.json`);
  try {
    execFileSync('python3', ['-c', HARNESS], {
      env: { ...process.env, SCENARIO: JSON.stringify(s), OUT: out },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e: any) {
    console.log(`    [${name}] python failed: ${String(e.stderr ?? '').trim().split('\n').slice(-2).join(' | ')}`);
    return null;
  }
  return existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
}

// 1. SATURATION BLINDNESS — the defect that mattered most.
// The old candidate SELECT was `.limit(max_delete_per_run + 1)`, so the measurement SATURATED at
// cap+1. A catastrophic mass-inactivation (source outage, sitemap collapse) therefore looked like
// exactly 301 eligible rows — under any sane floor — and the gate happily proceeded to delete a
// full batch, every run. The gate literally could not see a spike. With the clamp gone it sees
// 20,000 and refuses.
const blind = scenario('saturation', {
  policy: POLICY({ anomaly_floor: 1000, max_delete_per_run: 300 }),
  eligible: 20000, platform_rows: 31688, probe: [404, ''],
});
check('a catastrophic 20,000-row eligible spike is SEEN and refused', !!blind && blind.stats.aborted === true);
check('  …and it deletes NOTHING', !!blind && blind.deleted === 0);
check(
  '  …the gate reports the true magnitude, not a cap-saturated number',
  !!blind && blind.stats.eligible_total === 20000,
  blind ? `eligible_total=${blind.stats.eligible_total}` : '',
);

// 1b. AN UNMEASURED POPULATION MUST NEVER BE DELETED FROM.
// The 2026-08-09 dry run proved this the hard way: `head=True` returned no Content-Range, the
// count came back None, an earlier len(data) fallback read it as 0 — which is under EVERY
// threshold, so the anomaly gate and the fraction guard were both silently disabled while the
// work-set query still returned 300 rows to delete. Absent count must now fail closed.
const nocount = scenario('no-count', {
  policy: POLICY(), eligible: 488, platform_rows: 31688, probe: [404, ''], no_count: true,
});
check('a missing exact count refuses to run rather than reading 0', !!nocount && !!nocount.err);
check('  …and it deletes NOTHING', !!nocount && nocount.deleted === 0);
check('  …and the error names the unmeasured population',
      !!nocount && /unmeasured population/.test(String(nocount.err)));

// 2. THE REAL GATHERN SHAPE — 488 eligible, floor 1000, cap 300: must proceed, capped.
const live = scenario('proceed', {
  policy: POLICY(), eligible: 488, platform_rows: 31688, probe: [404, ''],
});
check('the real backlog (488 eligible, floor 1000) is NOT an anomaly — it proceeds', !!live && live.stats.aborted === false);
check(
  '  …the gate judged the TRUE unclamped population, not cap+1',
  !!live && live.stats.eligible_total === 488,
  live ? `eligible_total=${live.stats.eligible_total}` : '',
);
check(
  '  …deletion is capped at max_delete_per_run',
  !!live && live.deleted === 300 && live.stats.work_set === 300,
  live ? `deleted=${live.deleted} cap=300` : '',
);
check('  …every deletion is written to the audit log first', !!live && live.logged === live.deleted);

// 2b. anomaly_floor == max_delete_per_run must no longer be inherently fatal: with the clamp gone,
// a backlog UNDER the floor proceeds normally instead of being pinned at cap+1 and aborting.
const eq = scenario('floor-equals-cap', {
  policy: POLICY({ anomaly_floor: 300, max_delete_per_run: 300 }),
  eligible: 250, platform_rows: 31688, probe: [404, ''],
});
check('floor == cap no longer deadlocks when the real backlog is under the floor',
      !!eq && eq.stats.aborted === false && eq.stats.eligible_total === 250);

// 3. SOURCE VERIFICATION — a LIVE page must reactivate, never delete.
const alive = scenario('live-page', {
  policy: POLICY(), eligible: 50, platform_rows: 31688, probe: [200, '<html>still listed</html>'],
});
check('a 200 LIVE page deletes nothing and self-heals the row', !!alive && alive.deleted === 0 && alive.reactivated === 50);

// 4. SOURCE VERIFICATION — an ambiguous response must be skipped, never deleted.
const blocked = scenario('blocked', {
  policy: POLICY(), eligible: 50, platform_rows: 31688, probe: [403, ''],
});
check('a 403 / block deletes nothing and is skipped', !!blocked && blocked.deleted === 0 && blocked.stats.skipped === 50);

// 5. MASS-INACTIVATION — a partial crawl / outage shape must abort even under the floor.
const mass = scenario('mass', {
  policy: POLICY({ anomaly_floor: 100000 }), eligible: 900, platform_rows: 3000, probe: [404, ''],
});
check('a large FRACTION of the platform going eligible aborts even under the floor', !!mass && mass.stats.aborted === true);
check('  …and the abort names the mass-inactivation guard', !!mass && /mass-inactivation/.test(String(mass.stats.abort_reason)));
check('  …and it deletes NOTHING', !!mass && mass.deleted === 0);

// 5b. PLATFORM HEALTH PRECONDITION (barrier 2, 2026-08-22) — an open scraper_failure_step_change
// or silent_scraper_death alert for this platform must freeze deletion BEFORE any candidate is
// even measured (eligible_total stays 0), distinct from the anomaly gate above which only reacts
// AFTER a degraded platform has already produced a spike.
const degraded = scenario('degraded-health', {
  policy: POLICY(), eligible: 488, platform_rows: 31688, probe: [404, ''],
  alert_event_rows: [{ id: 686, kind: 'scraper_failure_step_change', platform: 'gathern', severity: 'P1' }],
});
check('an open scraper_failure_step_change alert freezes deletion before measuring candidates',
      !!degraded && degraded.stats.aborted === true && degraded.deleted === 0);
check('  …eligible_total is never even measured',
      !!degraded && degraded.stats.eligible_total === 0,
      degraded ? `eligible_total=${degraded.stats.eligible_total}` : '');
check('  …the abort names the degraded platform',
      !!degraded && /platform health degraded/.test(String(degraded.stats.abort_reason)));

// 5c. …and a HEALTHY platform (no matching alert) must proceed exactly as before — the gate must
// not be a blanket freeze that happens to look right only because the mock defaults to healthy.
const healthy = scenario('healthy', {
  policy: POLICY(), eligible: 488, platform_rows: 31688, probe: [404, ''], alert_event_rows: [],
});
check('a healthy platform (no matching alert) proceeds normally',
      !!healthy && healthy.stats.aborted === false && healthy.stats.eligible_total === 488);

// 6. DRY RUN — classifies but never writes.
const dry = scenario('dry', {
  policy: POLICY(), eligible: 488, platform_rows: 31688, probe: [404, ''], dry_run: true,
});
check('dry-run classifies but deletes nothing', !!dry && dry.stats.aborted === false && dry.deleted === 0);
check('  …and still reports what it would delete', !!dry && dry.stats.deleted === 300);

// 7. Source-lint: the invariant and the cap must not be quietly removed.
const src = readFileSync('scrapers/common/cleanup.py', 'utf8');
check('the unclamped count feeds the gate (count="exact")', /count="exact"/.test(src));
check('an absent count raises instead of defaulting to 0', /unmeasured population/.test(src));
check('the cap-saturating `max_delete_per_run + 1` measurement never returns',
      !/max_delete_per_run"\] \+ 1/.test(src));
check('the work-set SELECT is capped by max_delete_per_run', /\.limit\(pol\["max_delete_per_run"\]\)/.test(src));
check('require_source_recheck is still honoured', /require_source_recheck/.test(src));
check('the platform-health precondition function still exists', /_platform_health_ok/.test(src));
check('the health check runs before eligible_total is ever measured',
      src.indexOf('_platform_health_ok(client, platform)') < src.indexOf('eligible_total = 0'));

console.log('');
if (failures > 0) {
  console.error(`❌ verify-cleanup-anomaly-gate: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ verify-cleanup-anomaly-gate: all checks passed.');
