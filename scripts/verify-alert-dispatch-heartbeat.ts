// Barrier: THE DELIVERY CHANNEL MUST REPORT ITS OWN LIVENESS.
// Systems Seam Engineer run 1, 2026-08-28. Offline, deterministic, wired into `npm test`.
//
// WHAT WAS FOUND. Since 2026-08-26 the entire alert delivery path is
// .github/workflows/alert-dispatch.yml (0 enabled ops_alert_channel rows, mon_config
// .alert_webhook_url NULL, github_issue_delivery='enabled'). mon_detect_alert_delivery watches it,
// but it can only ever see the SYMPTOM ON ALERT ROWS -- it counts delivery-eligible alerts still
// undispatched past a grace window. If the workflow stops running during a quiet spell there are no
// undelivered rows to count, the detector reads green, and the channel is dead with nothing saying
// so. Same shape as the 41-day P0 blackout (a destination existed, so it read green), one layer out.
//
// MEASURED, which is why this is not theoretical. The workflow is scheduled '9,39 * * * *' = 48
// runs/day. Over the 61.6h to 2026-08-28T11:12Z it ran 30 times: 11.7 runs/day actual, essentially
// never at :09 or :39, median gap 53 min, four largest gaps 11.3h / 11.1h / 9.4h / 5.1h. Real cost
// on real alerts: P0 id 1011 took 2h47m from raise to filed issue; P1 id 1058 took 6h14m. GitHub
// documents that `schedule` runs are delayed and dropped under load, so the cron expression is not
// evidence that anything ran.
//
// THE FIX, two halves that must stay paired (this file is what keeps them paired):
//   1. .github/workflows/alert-dispatch.yml -- a step, `if: always()`, upserts
//      ops_alert_dispatch_heartbeat with last_run_at on every run. always() is load-bearing: a run
//      that files issues and then fails still proves the channel is alive, and reporting "dead" for
//      a channel that is merely erroring sends the reader after the wrong problem.
//   2. public.mon_detect_alert_dispatch_silent() (migration-mirrored below) -- P1 when the heartbeat
//      is missing or older than 24h, self-clearing via mon_resolve_key.
//
// WHY 24h AND NOT TIGHTER. This asks "is the channel dead", not "is it slow". The largest observed
// healthy gap is 11.3h, so anything under ~12h flaps on throttled-but-working behaviour, and a
// flapping P1 is how real ones get ignored. Whether ~12 deliveries/day with an 11h tail is an
// acceptable SLO for P0 is a product/ops decision and an OWNER input -- deliberately not decided
// here. Note that mon_detect_alert_delivery's own comment reasons from the NOMINAL schedule
// ("alert-dispatch.yml runs at :09/:39. 60 minutes is two consecutive missed runs"), a premise this
// run measured to be false; that detector is deliberately left untouched, because loosening a live
// guard to match degraded reality is the move the hard safety rails forbid.
//
// MUTATION-PROVEN in production (each leg run against the live detector, then restored):
//   - heartbeat pushed 30h into the past -> mon_detect_alert_dispatch_silent() returned 1, alert
//     raised P1 with hours_since_last_run=30.0
//   - heartbeat restored to now() -> returned 0 and resolved its own dedup key (resolved_at set)
//   - heartbeat pushed back again -> returned 1, proving a re-occurrence still raises after a
//     resolve rather than being swallowed by mon_raise()'s dedup
//   - production left healthy: 2 raises, 0 open
//
// MUTATION-PROVEN offline (each of these turns this check RED):
//   - the workflow step drops `if: always()`
//   - the workflow step stops writing ops_alert_dispatch_heartbeat or last_run_at
//   - the detector migration drops the mon_raise / mon_resolve_key call
//   - the detector migration widens c_silent_hours
//   - the roster wiring is a hand-pasted body instead of a pg_get_functiondef+replace needle-edit

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const WORKFLOW = join(ROOT, '.github/workflows/alert-dispatch.yml');
const MIGRATION = join(
  ROOT,
  'supabase/migrations/20260828211856_alert_dispatch_heartbeat_and_silence_detector.sql',
);

const HEARTBEAT_TABLE = 'ops_alert_dispatch_heartbeat';
const DETECTOR = 'mon_detect_alert_dispatch_silent';
const SILENT_HOURS = 24;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`PASS  ${label}`);
    return;
  }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
}

console.log('\nThe alert delivery channel must report its own liveness\n');

const wf = readFileSync(WORKFLOW, 'utf8');
const mig = readFileSync(MIGRATION, 'utf8');

// --- half 1: the workflow actually stamps the heartbeat -----------------------------------------
// Match only EXECUTED yaml/shell, never prose: this file explains itself at length, and a check a
// comment can satisfy is not a check. (Caught by mutation: deleting the real `if: always()` left
// the sentence "if: always() is load-bearing" behind and the naive regex stayed green.)
const executable = (s: string) =>
  s
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

const wfCode = executable(wf);
const stepIdx = wfCode.indexOf(HEARTBEAT_TABLE);
check(
  'alert-dispatch.yml writes the heartbeat table',
  stepIdx !== -1,
  `no reference to ${HEARTBEAT_TABLE} in executable yaml — the detector would raise on a channel `
    + 'that is actually running',
);

// The step body: from the heartbeat mention back to its own "- name:" and forward to the next one.
const stepStart = stepIdx === -1 ? -1 : wfCode.lastIndexOf('- name:', stepIdx);
const nextStep = stepIdx === -1 ? -1 : wfCode.indexOf('- name:', stepIdx);
const step = stepStart === -1 ? '' : wfCode.slice(stepStart, nextStep === -1 ? wfCode.length : nextStep);

check(
  'the heartbeat step runs with if: always()',
  /^\s*if:\s*always\(\)\s*$/m.test(step),
  'without always(), a run that files issues then fails never stamps, and the detector reports a '
    + 'live-but-erroring channel as dead',
);
check(
  'the heartbeat step writes last_run_at',
  /last_run_at/.test(step),
  'the detector reads last_run_at; a stamp without it proves nothing',
);
check(
  'the heartbeat upserts rather than inserting a second row',
  /merge-duplicates/.test(step),
  'ops_alert_dispatch_heartbeat is a single-row table (id boolean primary key); a plain insert '
    + 'would 409 forever and silently stop stamping',
);

// --- half 2: the detector exists, raises, resolves, and is wired ---------------------------------
check(
  `${DETECTOR}() is defined in its migration`,
  new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${DETECTOR}\\b`, 'i').test(mig),
);
check(
  'the detector raises a P1 on alert_delivery',
  /mon_raise\(\s*'P1'\s*,\s*'alert_delivery'/.test(mig),
  'a detector that cannot raise is decoration',
);
check(
  'the detector resolves its own key when healthy',
  /mon_resolve_key\(\s*'alert_delivery'\s*,\s*'alert_dispatch_silent'\s*\)/.test(mig),
  'without a resolve path the dedup key sticks open and suppresses every future raise — the exact '
    + 'mechanism behind the nine dark detectors of 2026-08-10',
);

const hoursMatch = mig.match(/c_silent_hours\s+int\s*:=\s*(\d+)/);
check(
  `the silence threshold is still ${SILENT_HOURS}h`,
  hoursMatch !== null && Number(hoursMatch[1]) === SILENT_HOURS,
  `found ${hoursMatch?.[1] ?? 'nothing'}. Widening this is how a real blackout is made to read `
    + 'green. If it flaps, fix the channel, not the number.',
);

check(
  'the detector is wired into the mon_run_all_detectors() roster in the SAME migration',
  mig.includes('mon_run_all_detectors') && mig.includes(DETECTOR),
  'a detector nothing reaches is decoration and would trip mon_detect_orphaned_detectors()',
);
check(
  'the roster edit is a needle-edit built from the LIVE function definition',
  /pg_get_functiondef/.test(mig) && /replace\(\s*v_def/.test(mig),
  'a hand-pasted roster body silently drops concurrent sessions’ edits',
);
check(
  'the roster edit verifies that it actually took',
  /roster edit did not take/.test(mig),
  'a wiring step that cannot fail is a wiring step you cannot trust',
);

console.log(
  failures === 0
    ? '\n✓ alert-dispatch heartbeat: channel liveness is reported and watched\n'
    : `\n✗ ${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
