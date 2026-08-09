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
// The fix separates measurement from work-set: an exact unclamped count feeds the gate, and a
// separate capped SELECT feeds the deletion batch. This guard EXECUTES the real `run()` against a
// stubbed Supabase client (no network, no DB) across five scenarios, asserting both that the
// deadlock is impossible AND that every safety property the owner required still holds:
//   1. anomaly_floor <= max_delete_per_run is refused outright (fail closed, deletes nothing)
//   2. the gate sees the TRUE eligible population, not a cap-clamped number
//   3. deletion stays capped at max_delete_per_run per run
//   4. source verification: a LIVE page reactivates and is never deleted
//   5. source verification: an ambiguous response (403/timeout) is skipped and never deleted
//   6. a mass-inactivation fraction guard aborts a partial-crawl / source-outage shape
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
        if self.t==TABLE:
            if self._count:
                # two count queries per table: eligible, then total rows
                if not hasattr(self,"_seen"):
                    Q._ncount = getattr(Q,"_ncount",0)+1
                return R(data=[], count=(SCENARIO["eligible"] if Q._ncount%2==1 else SCENARIO["platform_rows"]))
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

stats = cleanup.run("gathern", dry_run=SCENARIO.get("dry_run", False))
out = {"stats": stats, "deleted": len(DELETED), "reactivated": len(REACTIVATED), "logged": len(LOGGED)}
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

// 1. THE DEADLOCK ITSELF — floor <= cap must fail closed, not delete, not silently pass.
const dead = scenario('deadlock', {
  policy: POLICY({ anomaly_floor: 300, max_delete_per_run: 300 }),
  eligible: 488, platform_rows: 31688, probe: [404, ''],
});
check('floor <= cap is refused outright', !!dead && dead.stats.aborted === true);
check('  …and the abort names the config deadlock', !!dead && /config deadlock/.test(String(dead.stats.abort_reason)));
check('  …and it deletes NOTHING', !!dead && dead.deleted === 0);

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

// 6. DRY RUN — classifies but never writes.
const dry = scenario('dry', {
  policy: POLICY(), eligible: 488, platform_rows: 31688, probe: [404, ''], dry_run: true,
});
check('dry-run classifies but deletes nothing', !!dry && dry.stats.aborted === false && dry.deleted === 0);
check('  …and still reports what it would delete', !!dry && dry.stats.deleted === 300);

// 7. Source-lint: the invariant and the cap must not be quietly removed.
const src = readFileSync('scrapers/common/cleanup.py', 'utf8');
check('the unclamped count feeds the gate (count="exact")', /count="exact"/.test(src));
check('the work-set SELECT is capped by max_delete_per_run', /\.limit\(pol\["max_delete_per_run"\]\)/.test(src));
check('require_source_recheck is still honoured', /require_source_recheck/.test(src));

console.log('');
if (failures > 0) {
  console.error(`❌ verify-cleanup-anomaly-gate: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ verify-cleanup-anomaly-gate: all checks passed.');
