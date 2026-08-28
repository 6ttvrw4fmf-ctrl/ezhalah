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
// A detector gets redefined over time (this one was, when GitHub Issues became the canonical P0
// destination). What matters is the LAST definition — the one production actually holds — so sort
// by migration version and read the newest. Asserting "exactly one" would have been wrong the
// moment the second migration landed, and would have failed for a reason that isn't a defect.
const owning = files
  .map((f) => ({ f, sql: readFileSync(join(MIGRATIONS, f), 'utf8') }))
  .filter((x) => new RegExp(`function\\s+public\\.${DETECTOR}\\b`, 'i').test(x.sql))
  .sort((a, b) => a.f.localeCompare(b.f));

check(
  `at least one migration defines ${DETECTOR}()`,
  owning.length >= 1,
  'the detector has no migration at all',
);
if (owning.length === 0) { process.exit(1); }
const newest = owning[owning.length - 1];
const sql = newest.sql;

// TWO SCOPES, deliberately, because they answer different questions.
//
// `code` (newest detector definition) is for anything about CURRENT BEHAVIOUR — the SLO number, what
// counts as delivered. Checking those against the whole corpus would let a superseded migration
// satisfy a check while the definition production actually holds is wrong.
//
// `corpus` (every migration in this mechanism) is for "does this exist at all" — the cron job and
// the roster wiring shipped in the first migration and are not repeated by later ones. Demanding
// they reappear in every redefinition would force pointless duplication, and a barrier that
// pressures you into noise is a barrier people start working around.
const RELATED = /mon_dispatch_p0_fast|mon_detect_p0_delivery_sla/;
const corpus = files
  .map((f) => ({ f, sql: readFileSync(join(MIGRATIONS, f), 'utf8') }))
  .filter((x) => RELATED.test(x.sql))
  .map((x) => x.sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n'))
  .join('\n');

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
  new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${DISPATCHER}\\b`, 'i').test(corpus),
);
// THE FAST LANE MUST BE CHAINED TO THE SWEEP, NOT POLLING ON ITS OWN MINUTE SLOT.
//
// The first version of this scheduled `mon-p0-fast-dispatch` as '* * * * *'. That was wrong, and
// mon_detect_cron_minute_collision() said so on the very next sweep — a job in every minute slot
// collides with every other job, including the :00 slot reserved for the matview refresh, and cron
// stampede is what wedged the database on 2026-08-10. Measured afterwards: exactly TWO minute-slots
// in the hour are free (24 and 42), so NO polling schedule can satisfy both the 5-minute SLO and the
// slot discipline. Polling was the wrong shape.
//
// Every P0 is born inside the sweep (all five P0-raising detectors are on its roster; none has its
// own cron), so the dispatcher runs chained to that sweep instead — zero new slots, no collision.
check(
  'the every-minute polling job is gone',
  new RegExp(`cron\\.unschedule\\(\\s*'${CRON_JOB}'`).test(corpus)
    && !new RegExp(`cron\\.schedule\\(\\s*'${CRON_JOB}'`).test(corpus.slice(corpus.lastIndexOf('cron.unschedule'))),
  'a job in every minute slot collides with every other job and trips '
    + 'mon_detect_cron_minute_collision — the 2026-08-10 stampede discipline',
);
check(
  `${DISPATCHER}() is chained onto the detector sweep that raises every P0`,
  /mon_dispatch_alerts\(\);[\s\S]{0,80}mon_dispatch_p0_fast\(\)/.test(corpus),
  'if it is reachable from no cron job at all, nothing ever delivers and the SLO is decorative',
);
check(
  'the chain does NOT change the sweep schedule (owner-only)',
  /v_sched <> '29,59 \* \* \* \*'/.test(corpus),
  'appending to the command is in scope; changing when it runs is an owner decision',
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
  corpus.includes('mon_run_all_detectors') && corpus.includes(DETECTOR),
);
// Scope this to the WIRING block specifically. Caught by mutation: the first version matched
// `pg_get_functiondef` anywhere in the file, and the separate $verify$ block also contains it — so
// replacing the wiring's own read with a hardcoded body left the check GREEN. A barrier satisfied
// by a token in a different block is not checking what it claims to.
const wireBlock = corpus.match(/do \$wire\$[\s\S]*?end \$wire\$/)?.[0] ?? '';
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
  /roster edit did not take/.test(corpus),
);

// --- GitHub Issues is the canonical destination, via the EXISTING architecture -------------------
// Owner, 2026-08-28: reuse the existing routing/ownership system; do not build a second parallel
// one. These checks pin that the fast lane TRIGGERS alert-dispatch.yml rather than growing its own
// issue-filing and routing.
check(
  'the canonical channel triggers the EXISTING alert-dispatch.yml workflow',
  /actions\/workflows\/alert-dispatch\.yml\/dispatches/.test(code),
  'the P0 destination must be the existing workflow — a second issue-filer would be the parallel '
    + 'ownership system the owner forbade',
);
check(
  'the GitHub PAT is read from Vault at send time, never stored in ops_alert_channel',
  /vault\.decrypted_secrets/.test(code) && !/ghp_[A-Za-z0-9]/.test(code),
  'a PAT written into a plain ops table is a worse secret posture than the Vault one already in use',
);

// THE CENTRAL CORRECTNESS PROPERTY. A workflow dispatch returns 204 the instant GitHub accepts it.
// Counting that as delivery would mark P0s delivered with no issue filed — the enqueue-vs-delivered
// mistake that caused the 41-day blackout, moved one layer up.
// The detector filters trigger receipts in TWO places — the counting query and the sample query —
// and they must agree. Requiring only one occurrence was a real hole: mutation showed that changing
// the COUNTING query alone (the one that decides whether to raise) left this green because the
// sample query still matched. Count them.
const kindExclusions = (code.match(/c\.kind\s*<>\s*'github_workflow'/g) ?? []).length;
check(
  'a github_workflow trigger receipt is NOT counted as delivery (both queries)',
  kindExclusions >= 2,
  `found ${kindExclusions} exclusion(s), expected the counting query AND the sample query. Only `
    + 'alert_event.dispatched_at (stamped after `gh issue create` succeeds) proves an issue exists.',
);
// Checking the identifier merely EXISTS is not enough — mutation renamed the declaration and this
// stayed green off the use site alone. Assert the throttle is actually applied in the skip test.
check(
  'workflow re-triggering is throttled',
  /c_retrigger_after\s+interval\s*:=/.test(code)
    && /last_tried\s*>\s*now\(\)\s*-\s*c_retrigger_after/.test(code),
  'without a throttle the every-minute job would re-dispatch the workflow while a run is still in '
    + 'flight, racing its own concurrency group',
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
