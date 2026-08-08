// Regression guard (2026-08-08) for scrape_runs rows left dangling at ok=NULL forever when a CI
// job is killed at its `timeout-minutes` budget.
//
// THE BUG THIS EXISTS TO PREVENT
// ------------------------------
// Every scraper finalizes its run inside a `finally:` block. That is airtight for Python-level
// exceptions and USELESS when the process is killed by a signal — `finally` never runs. GitHub
// Actions kills any job that exceeds `timeout-minutes`, so the row stays ok=NULL / finished_at=NULL
// permanently. Two independent incidents on 2026-08-08:
//
//   * dealapp run 25397 — "Small sources sync" job cancelled at timeout-minutes:90
//     (GH run 31239278341, 04:22:49 -> 05:52:46). 1,800 rows written; row never closed.
//   * 7 aqar_residential shards of the weekly deep-fill (GH run 31233959785) — `Fill turabah`
//     (90.2m), `Fill umluj` (90.3m), `Fill abu_arish`, `Fill ahad_al_masarihah` and 3 more, each
//     killed at `timeout-minutes: 90`.
//
// A dangling row is worse than a failed one: ops_freshness_by_layer never advances the platform's
// last-OK, and mon_detect_silent_scraper_death needs THREE consecutive bad runs, so a job killed
// every single day is only noticed on day three — and reads as a dead SOURCE, not an infra kill.
//
// The fix is a SIGTERM/SIGINT handler armed by begin_run(). This guard EXECUTES it: it monkeypatches
// the Supabase client so nothing touches the network, opens a run, sends the process a real SIGTERM,
// and asserts the handler issued exactly the right UPDATE and then died from the signal. It also
// pins the two properties that make the handler safe (conditional on `ok is null`; disarmed by a
// normal end_run) and asserts the deep-fill budget covers its slowest observed shard.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-scrape-run-finalized-on-kill: a job killed at its CI timeout must still close');
console.log('  its scrape_runs row (finally: does not run on a signal).');

// ── 1. Execute the real handler under a real SIGTERM ───────────────────────────────────────────
// The harness stubs scrapers.common.db.sb() with a recorder, so begin_run/the handler exercise the
// genuine code path with zero network access.
const HARNESS = `
import json, os, signal, sys, types
sys.path.insert(0, os.getcwd())

# Stub the supabase package before scrapers.common.db imports it.
fake = types.ModuleType("supabase")
class Client: pass
def create_client(*a, **k): return Client()
fake.Client = Client; fake.create_client = create_client
sys.modules.setdefault("supabase", fake)

CALLS = []

class Q:
    def __init__(self, table): self.table_name = table; self.payload = None; self.filters = []
    def insert(self, row): self.payload = ("insert", row); return self
    def update(self, row): self.payload = ("update", row); return self
    def select(self, *a, **k): self.payload = ("select", a); return self
    def eq(self, col, val): self.filters.append(("eq", col, val)); return self
    def is_(self, col, val): self.filters.append(("is_", col, val)); return self
    def execute(self):
        CALLS.append({"table": self.table_name, "op": self.payload[0],
                      "row": self.payload[1], "filters": self.filters})
        with open(os.environ["CALLS_OUT"], "w") as fh: json.dump(CALLS, fh)
        return types.SimpleNamespace(data=[{"id": 4242}])

class SB:
    def table(self, name): return Q(name)

from scrapers.common import db
db.sb = lambda: SB()
db._execute = lambda q, what=None, **k: q.execute()

run_id = db.begin_run("verify_platform")
assert run_id == 4242, run_id
assert signal.getsignal(signal.SIGTERM) is db._finalize_open_run_on_signal, "SIGTERM not armed"
assert signal.getsignal(signal.SIGINT) is db._finalize_open_run_on_signal, "SIGINT not armed"

os.kill(os.getpid(), signal.SIGTERM)   # the handler must close the row, then re-die
sys.exit(99)                           # must never be reached
`;

let harnessOk = false;
let calls: any[] = [];
let exitSignal = '';
const tmp = mkdtempSync(join(tmpdir(), 'kill-guard-'));
const callsOut = join(tmp, 'calls.json');

try {
  execFileSync('python3', ['-c', HARNESS], {
    env: { ...process.env, CALLS_OUT: callsOut },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Reaching here means python exited 0 — it should have died from SIGTERM instead.
  check('harness process died from the signal (not a clean exit)', false, 'exited 0');
} catch (e: any) {
  exitSignal = e.signal ?? '';
  const stderr = String(e.stderr ?? '');
  if (stderr.trim()) console.log(`    python stderr: ${stderr.trim().split('\n').slice(-3).join(' | ')}`);
  check(
    'handler re-raised the signal so the process still dies as the runner expects',
    exitSignal === 'SIGTERM',
    `signal=${exitSignal || 'none'} status=${e.status}`,
  );
  harnessOk = exitSignal === 'SIGTERM';
}

if (existsSync(callsOut)) calls = JSON.parse(readFileSync(callsOut, 'utf8'));

const insert = calls.find((c) => c.op === 'insert' && c.table === 'scrape_runs');
check('begin_run opened a scrape_runs row', !!insert);

const update = calls.find((c) => c.op === 'update' && c.table === 'scrape_runs');
check('the SIGTERM handler wrote a finalizing UPDATE to scrape_runs', !!update);

if (update) {
  check('it closes the run as ok=false (never true — the run really was cut short)', update.row.ok === false);
  check('it stamps finished_at so the row is no longer dangling', typeof update.row.finished_at === 'string');
  check(
    'it does NOT invent rows_seen / rows_upserted',
    !('rows_seen' in update.row) && !('rows_upserted' in update.row),
  );
  check(
    'the note says the job was killed before end_run()',
    /killed by SIGTERM/.test(String(update.row.notes ?? '')) &&
      /end_run\(\)/.test(String(update.row.notes ?? '')),
  );
  check(
    'it targets the row this process opened',
    update.filters.some((f: any[]) => f[0] === 'eq' && f[1] === 'id' && f[2] === 4242),
  );
  check(
    'it is conditional on `ok is null`, so a normally-finalized run can never be overwritten',
    update.filters.some((f: any[]) => f[0] === 'is_' && f[1] === 'ok' && f[2] === 'null'),
  );
}

// ── 2. A normally-finalized run disarms the handler ────────────────────────────────────────────
const src = readFileSync('scrapers/common/db.py', 'utf8');
check(
  'end_run() clears _OPEN_RUN so a shutdown SIGTERM cannot re-write a closed run',
  /_OPEN_RUN\.get\("run_id"\) == run_id/.test(src) && /_OPEN_RUN\["run_id"\] = None/.test(src),
);
check('begin_run() arms the handler', /_install_run_signal_handlers\(\)/.test(src));
check(
  'the handler only replaces a DEFAULT disposition (never stomps a caller-installed handler)',
  /signal\.getsignal\(sig\) in \(signal\.SIG_DFL, signal\.default_int_handler\)/.test(src),
);

// ── 3. The deep-fill budget must cover its slowest observed shard ───────────────────────────────
// The handler makes a kill HONEST; it does not make the shard finish. `Fill turabah` needed >90.2m
// against `timeout-minutes: 90`, so those cities never completed a deep fill at all.
const OBSERVED_SLOWEST_SHARD_MIN = 90.3; // Fill umluj, GH run 31233959785, 2026-08-08
const deepFill = readFileSync('.github/workflows/aqar-deep-fill.yml', 'utf8');
const tmo = deepFill.match(/^\s*timeout-minutes:\s*(\d+)\s*$/m);
check('aqar-deep-fill declares a per-job timeout-minutes', !!tmo);
if (tmo) {
  const budget = Number(tmo[1]);
  console.log(`    deep-fill budget ${budget}m vs slowest observed shard ${OBSERVED_SLOWEST_SHARD_MIN}m`);
  check(
    'the deep-fill budget exceeds the slowest shard actually observed',
    budget > OBSERVED_SLOWEST_SHARD_MIN,
    `${budget}m`,
  );
}

console.log('');
if (!harnessOk) console.error('  (the signal harness did not run to completion — treat the above as unproven)');
if (failures > 0) {
  console.error(`❌ verify-scrape-run-finalized-on-kill: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ verify-scrape-run-finalized-on-kill: all checks passed.');
