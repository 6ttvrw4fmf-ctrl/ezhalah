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
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
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
    def lt(self, col, val): self.filters.append(("lt", col, val)); return self
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

const update = calls.find(
  (c) => c.op === 'update' && c.table === 'scrape_runs' && c.filters.some((f: any[]) => f[1] === 'id'),
);
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

// ── 1b. begin_run reconciles this platform's orphaned stubs (the SIGKILL path) ──────────────────
// The handler above covers SIGTERM/SIGINT. It CANNOT cover SIGKILL, an OOM kill, or a lost runner
// — and that is what actually happened on 2026-08-09: aqar liveness shard 8 (run 25880) died at
// ~77 min inside a 120-min budget with GH run 31287355118 concluding `failure`, and
// aqar_stub_recovery run 26102 the same way. The handler closed neither. So begin_run() must also
// finalize the platform's abandoned stubs on startup.
const reconcileUpdate = calls.find(
  (c) => c.op === 'update' && c.table === 'scrape_runs' && c.filters.some((f: any[]) => f[1] === 'platform'),
);
check('begin_run() reconciles this platform\'s orphaned stubs before opening a new run', !!reconcileUpdate);
if (reconcileUpdate) {
  check(
    '    reconciliation is scoped to the exact platform string (parallel shards never race)',
    reconcileUpdate.filters.some((f: any[]) => f[0] === 'eq' && f[1] === 'platform' && f[2] === 'verify_platform'),
  );
  check(
    '    it only touches rows with finished_at null',
    reconcileUpdate.filters.some((f: any[]) => f[0] === 'is_' && f[1] === 'finished_at' && f[2] === 'null'),
  );
  check(
    '    it only touches stubs older than the cutoff (a running sibling is never closed)',
    reconcileUpdate.filters.some((f: any[]) => f[0] === 'lt' && f[1] === 'started_at'),
  );
  check('    it closes them ok=false, never true', reconcileUpdate.row.ok === false);
  check(
    '    it does NOT invent rows_seen / rows_upserted',
    !('rows_seen' in reconcileUpdate.row) && !('rows_upserted' in reconcileUpdate.row),
  );
}

// The orphan cutoff must exceed the LONGEST job budget in the repo, or a still-running sibling
// shard could be finalized out from under itself.
const dbSrcForCutoff = readFileSync('scrapers/common/db.py', 'utf8');
const cutoffHours = Number(dbSrcForCutoff.match(/^ORPHAN_RUN_HOURS\s*=\s*(\d+)/m)?.[1] ?? NaN);
check('db.py declares ORPHAN_RUN_HOURS', Number.isFinite(cutoffHours));
const allBudgets = readdirSync('.github/workflows')
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .flatMap((f) => [...readFileSync(`.github/workflows/${f}`, 'utf8').matchAll(/timeout-minutes:\s*(\d+)/g)])
  .map((m) => Number(m[1]));
const longestBudgetMin = Math.max(...allBudgets);
if (Number.isFinite(cutoffHours)) {
  console.log(`    orphan cutoff ${cutoffHours}h vs longest workflow budget ${longestBudgetMin}m`);
  check(
    'the orphan cutoff comfortably exceeds the longest workflow timeout-minutes',
    cutoffHours * 60 > longestBudgetMin * 1.5,
    `${cutoffHours * 60}m > ${Math.round(longestBudgetMin * 1.5)}m`,
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

// ── 4. SIGNAL DELIVERY: the workflow must `exec` the scraper ────────────────────────────────────
// THE BUG THIS EXISTS TO PREVENT (2026-08-15 senior audit, run #21). Sections 1-3 prove the handler
// is CORRECT — it just never ran. From the day it shipped (2026-08-08) to 2026-08-15 it closed
// exactly 0 rows, while the 12h reconciler closed 29. The handler was never reached because it was
// never SIGNALLED:
//
//   GitHub writes a `run:` block to a script and executes `bash -e <script>`. Without `exec`, the
//   scraper is a CHILD of that bash. On cancellation the runner signals the STEP process — bash —
//   which dies; python is orphaned and then destroyed by the runner's post-job "Cleaning up orphan
//   processes" sweep, which is not a catchable signal. The row stays dangling.
//
// PROOF, from `Fill turabah` (GH job 94946244863, deep-fill run 31858007330):
//   04:42:51.788  ##[error]The operation was canceled.
//   04:42:52.049  Terminate orphan process: pid (2245) (python)      <- python OUTLIVED the step
// No handler output, no UPDATE, 261ms between cancel and the orphan kill. All 31 scraper workflows
// invoked python this way, so the handler was undeliverable fleet-wide, not just here.
//
// `exec` makes python REPLACE bash, so the step process IS python and the runner's signal reaches
// the handler directly. This check pins that property for every scraper-launching step.
const EXEC_EXEMPT = new Set([
  // 4 sequential read-only probes in one block — `exec` would replace the shell at probe #1 and
  // silently skip the rest. Short-lived and never timeout-killed, so it needs no kill handler.
  'mustqr-probe.yml',
]);
const SCRAPER_CMD = /(?:python -m scrapers\.|\$\{\{ matrix\.cmd \}\})/;

const wfDir = '.github/workflows';
let execChecked = 0;
const execMissing: string[] = [];
for (const wf of readdirSync(wfDir).filter((f) => f.endsWith('.yml')).sort()) {
  if (EXEC_EXEMPT.has(wf)) continue;
  const lines = readFileSync(join(wfDir, wf), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)run:\s*(\|-?|>-?)?\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    let cmds: string[] = [];
    if (!m[2]) {
      cmds = [m[3]]; // single-line `run: <cmd>`
    } else {
      // Block scalar: collect the body, then fold backslash/`>-` continuations into one command
      // each so "the last command" means the last COMMAND, not the last line.
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() !== '' && l.length - l.trimStart().length <= indent) break;
        body.push(l);
      }
      i = j - 1;
      const folded = m[2].startsWith('>')
        ? [body.map((l) => l.trim()).filter(Boolean).join(' ')]
        : body.join('\n').replace(/\\\n\s*/g, ' ').split('\n');
      cmds = folded.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    }
    const last = cmds[cmds.length - 1];
    if (!last || !SCRAPER_CMD.test(last)) continue;
    execChecked++;
    if (!/^exec\s/.test(last)) execMissing.push(`${wf}: ${last.slice(0, 60)}`);
  }
}
console.log(`    scraper-launching steps checked: ${execChecked}`);
check(
  'every scraper-launching workflow step uses `exec` so the kill signal reaches python, not bash',
  execChecked > 0 && execMissing.length === 0,
  execMissing.length ? `missing exec → ${execMissing.join(' | ')}` : `${execChecked} steps`,
);
// A fleet this size must not silently shrink to zero checked steps (e.g. a refactor that renames
// the invocation form) — that would turn this guard into decoration.
check('the exec guard still sees the whole scraper fleet', execChecked >= 25, `${execChecked} steps`);

console.log('');
if (!harnessOk) console.error('  (the signal harness did not run to completion — treat the above as unproven)');
if (failures > 0) {
  console.error(`❌ verify-scrape-run-finalized-on-kill: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ verify-scrape-run-finalized-on-kill: all checks passed.');
