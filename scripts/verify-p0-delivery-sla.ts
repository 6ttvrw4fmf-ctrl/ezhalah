// Barrier: THE 5-MINUTE P0 DELIVERY SLO IS OWNER-SET AND MUST NOT BE QUIETLY WIDENED.
// Systems Seam Engineer, 2026-08-28. Offline, deterministic, wired into `npm test`.
//
// THE OWNER DECISION THIS PINS (2026-08-28): "P0 alerts must be delivered within 5 minutes of
// detection. Do not loosen detectors to match slower reality. If the current GitHub delivery path
// cannot meet that SLO, investigate and fix the delivery mechanism, then prove it end-to-end with a
// safe synthetic P0." Full statement: docs/ops/SYSTEMS_SEAM_ENGINEER.md PART 1.
//
// WHY A BARRIER AND NOT JUST A NUMBER IN A FUNCTION. Every incident in this repo's history that
// stayed invisible did so because a threshold drifted to match reality instead of reality being
// fixed: the 41-day P0 blackout read green because the detector asked "is a destination CONFIGURED"
// rather than "was it DELIVERED". `c_sla_minutes` is the single value that, raised, makes this
// whole mechanism decorative — so it is pinned here, offline, where a future edit trips CI.
//
// WHY THE GITHUB SCHEDULE CANNOT MEET IT (measured, not assumed). alert-dispatch.yml is scheduled
// '9,39 * * * *'. Perfectly honoured, an alert raised at :29 waits until :39 — 10 minutes, twice
// the SLO, on paper. Measured over 61.6h to 2026-08-28T11:12Z: 30 runs against 288 scheduled
// (11.7/day vs 48/day), essentially never at :09/:39, gaps of 11.3h / 11.1h / 9.4h. P0 alert 1011
// took 2h47m; P1 1058 took 6h14m. A hand-triggered workflow_dispatch delivers in ~30s (alert 1070),
// which proves the WORKFLOW is fast and the SCHEDULER is the defect — a manual run is never
// evidence the SLO is met. Hence the database-side fast lane this file guards.
//
// MUTATION-PROVEN offline (each turns this check RED):
//   - c_sla_minutes raised above 5
//   - the fast-dispatch cron job removed, or its schedule slowed below once a minute
//   - the retry cap removed (a down channel would POST every minute forever)
//   - the detector's raise or resolve path dropped
//   - the roster wiring replaced by a hand-pasted body instead of a pg_get_functiondef needle-edit
//   - the fast lane made to stamp alert_event.dispatched_at (would trip BRANCH 3's single-writer
//     guard shipped the same day by a concurrent session)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const SPEC = join(ROOT, 'docs', 'ops', 'SYSTEMS_SEAM_ENGINEER.md');

const SLA_MINUTES = 5;
const DETECTOR = 'mon_detect_p0_delivery_sla';
const DISPATCHER = 'mon_dispatch_p0_fast';
const CRON_JOB = 'mon-p0-fast-dispatch';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
}

console.log('\nThe 5-minute P0 delivery SLO is owner-set and cannot be quietly widened\n');

// Find the migration that ships the SLO, by content rather than by a hardcoded filename: the
// server mints migration versions, so pinning a name here would break the moment it is re-applied.
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
const owning = files
  .map((f) => ({ f, sql: readFileSync(join(MIGRATIONS, f), 'utf8') }))
  .filter((x) => x.sql.includes(`function public.${DETECTOR}`));

check(
  `exactly one migration defines ${DETECTOR}()`,
  owning.length === 1,
  `found ${owning.length}. Two definitions means one silently wins and the other is a lie.`,
);
if (owning.length !== 1) { process.exit(1); }
const sql = owning[0].sql;

// Strip comments before matching: this file's own migration explains the SLO at length and quotes
// the numbers, and a check a comment can satisfy is not a check. (That exact trap turned up twice
// in this repo — once in verify-alert-delivery-coverage.ts, once in my own heartbeat barrier.)
const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

// --- the SLO number itself ----------------------------------------------------------------------
const slaMatch = code.match(/c_sla_minutes\s+int\s*:=\s*(\d+)/);
check(
  `the SLO is still ${SLA_MINUTES} minutes`,
  slaMatch !== null && Number(slaMatch[1]) === SLA_MINUTES,
  `found ${slaMatch?.[1] ?? 'nothing'}. This is an OWNER decision, not a tuning knob — if it `
    + 'raises, fix the delivery path instead.',
);

// --- the fast lane exists, runs every minute, and is bounded -------------------------------------
check(
  `${DISPATCHER}() is defined`,
  new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${DISPATCHER}\\b`, 'i').test(code),
);
check(
  `the ${CRON_JOB} cron job is scheduled every minute`,
  new RegExp(`cron\\.schedule\\(\\s*'${CRON_JOB}'\\s*,\\s*'\\*\\s+\\*\\s+\\*\\s+\\*\\s+\\*'`).test(code),
  'anything slower than every minute cannot guarantee a 5-minute delivery once the POST round trip '
    + 'and reconciliation are counted',
);
check(
  'the dispatcher caps retries',
  /c_max_attempts\s+int\s*:=\s*\d+/.test(code) && /attempts\s*>=\s*c_max_attempts/.test(code),
  'without a cap, one down channel becomes a POST every minute forever aimed at whoever is already '
    + 'having a bad day',
);
check(
  'the dispatcher reconciles net._http_response rather than trusting the enqueue',
  /net\._http_response/.test(code),
  'net.http_post returns on ENQUEUE, not on response — a request_id alone proves nothing was '
    + 'delivered. That distinction is the entire reason this barrier exists.',
);

// --- it must not become a second writer of dispatched_at -----------------------------------------
check(
  'the fast lane never stamps alert_event.dispatched_at',
  !/dispatched_at\s*=\s*now\(\)/.test(code),
  'dispatched_at has exactly one writer (alert-dispatch.yml, meaning "a GitHub issue exists") and '
    + 'mon_detect_alert_delivery() BRANCH 3 raises P1 on any database function that stamps it. '
    + 'Receipts belong in ops_p0_delivery.',
);

// --- the detector raises, self-clears, and refuses a sink-only configuration ----------------------
check(
  'the detector raises on an SLO breach',
  /mon_raise\(\s*'P0'\s*,\s*'p0_delivery_sla'/.test(code),
);
check(
  'the detector raises when no HUMAN-reaching channel is configured',
  /p0_delivery_no_human_channel/.test(code) && /alert-sink/.test(code),
  'meeting the SLO into the alert-sink proof fixture is not meeting the SLO — the detector must '
    + 'distinguish a real destination from the fixture',
);
check(
  'both detector branches self-clear',
  /mon_resolve_key\(\s*'p0_delivery_sla'\s*,\s*'p0_delivery_sla_breach'\s*\)/.test(code)
    && /mon_resolve_key\(\s*'p0_delivery_sla'\s*,\s*'p0_delivery_no_human_channel'\s*\)/.test(code),
  'a detector that cannot resolve leaves its dedup key open forever, which silently suppresses '
    + 'every future raise of the same class',
);

// --- roster wiring, done the safe way ------------------------------------------------------------
check(
  'the detector is wired into mon_run_all_detectors() in the SAME migration',
  code.includes('mon_run_all_detectors') && code.includes(DETECTOR),
);
// Scope this to the WIRING block specifically. Caught by mutation: the first version matched
// `pg_get_functiondef` anywhere in the file, and the separate $verify$ block also contains it — so
// replacing the wiring's own read with a hardcoded body left the check GREEN. A barrier satisfied
// by a token in a different block is not checking what it claims to.
const wireBlock = code.match(/do \$wire\$[\s\S]*?end \$wire\$/)?.[0] ?? '';
check(
  'the roster wiring block exists',
  wireBlock.length > 0,
);
check(
  'the roster edit is a needle-edit built from the LIVE definition',
  /pg_get_functiondef/.test(wireBlock) && /replace\(\s*v_def/.test(wireBlock),
  'a hand-pasted roster body silently drops a concurrent session’s detector — two sessions edited '
    + 'this roster on 2026-08-28 alone',
);
check(
  'the roster edit verifies that it actually took',
  /roster edit did not take/.test(code),
);

// --- the owner decision is recorded in the repo, not just in a migration -------------------------
const spec = readFileSync(SPEC, 'utf8');
check(
  'the SLO is recorded in the canonical spec',
  /within 5 minutes/i.test(spec) && /owner decision, 2026-08-28/i.test(spec),
  'owner decisions must be recoverable by reading the repo, not by replaying a session',
);
check(
  'the spec states the destination is still an owner input',
  /OWNER input/i.test(spec) && /alert-sink/.test(spec),
);

console.log(
  failures === 0
    ? '\n✓ p0-delivery-sla: the 5-minute SLO is pinned, bounded, wired and recorded\n'
    : `\n✗ ${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
