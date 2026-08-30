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
// THE ARCHITECTURE THIS NOW GUARDS (owner decision, 2026-08-30). The fast lane has its OWN
// dedicated, slot-disciplined cron job (`mon-p0-fast-lane`, 24 minutes, max gap 3), so a slow
// detector sweep can no longer eat the SLO budget before dispatch starts. The sweep is preserved
// unchanged and still calls the lane as defence-in-depth. See the block at "THE FAST LANE HAS ITS
// OWN DEDICATED SLOT" below for why the earlier "no polling schedule can work" conclusion was wrong.
//
// MUTATION-PROVEN offline (each turns this check RED):
//   - c_sla_minutes raised above 5
//   - the dedicated fast lane unscheduled entirely
//   - the lane's cadence slowed so its worst gap no longer fits the SLO (the "delay" mutation)
//   - the lane moved onto minute 0, which is reserved for the matview refresh
//   - a return to per-minute polling ('* * * * *'), which trips cron_minute_collision
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
const CRON_JOB = 'mon-p0-fast-dispatch';   // the retired per-minute poller; must stay unscheduled
const FAST_LANE = 'mon-p0-fast-lane';      // the owner-approved dedicated slot (2026-08-30)

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

// A THIRD SCOPE, added 2026-08-30, because two were not enough.
//
// `code` is the newest migration defining the DETECTOR. Several checks below are about the
// DISPATCHER (`mon_dispatch_p0_fast`) — retry cap, throttle, Vault, the channel row — and they were
// reading `code` too. That worked only for as long as one migration happened to define both. The
// moment a migration touched the detector alone (this one did, adding LIMB 3), four dispatcher
// properties "vanished" and this barrier went red while production's dispatcher was untouched and
// completely correct. A barrier that fails for a reason that isn't a defect is one people learn to
// route around, which is the same failure the two-scope comment above was written to avoid.
//
// Worse, one check passed for the WRONG reason: `net._http_response` matched a mention inside the
// detector's own `action` payload string. Comments are stripped before matching precisely so prose
// cannot satisfy a behavioural check — but a payload string is code, not a comment, so it slipped
// through the same trap one layer over. Scoping it to the dispatcher fixes that too.
const dispatcherOwning = files
  .map((f) => ({ f, sql: readFileSync(join(MIGRATIONS, f), 'utf8') }))
  .filter((x) => new RegExp(`function\\s+public\\.${DISPATCHER}\\b`, 'i').test(x.sql))
  .sort((a, b) => a.f.localeCompare(b.f));
check(
  `at least one migration defines ${DISPATCHER}()`,
  dispatcherOwning.length >= 1,
  'the fast lane has no migration at all',
);
const dispatcherCode = (dispatcherOwning[dispatcherOwning.length - 1]?.sql ?? '')
  .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

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
// THE FAST LANE HAS ITS OWN DEDICATED SLOT (OWNER DECISION, 2026-08-30) AND IS *ALSO* CHAINED.
//
// History, because this reversed a previous conclusion and the reversal must not be re-reversed by
// someone reading only the older comment. The first version scheduled `mon-p0-fast-dispatch` as
// '* * * * *'. That was genuinely wrong — a job in every minute slot collides with everything,
// including the :00 slot reserved for the matview refresh, and cron stampede is what wedged the
// database on 2026-08-10. 20260828231336 unscheduled it and concluded that "exactly TWO minute-slots
// in the hour are free (24 and 42), so NO polling schedule can satisfy both the 5-minute SLO and the
// slot discipline."
//
// THAT CONCLUSION WAS WRONG, and measurably so. It read "free" as "zero jobs on that minute". The
// gate does not say that. mon_detect_cron_minute_collision() raises only on
//     having count(*) >= 3 or (minute = 0 and count(*) > 1)
// so TWO hourly jobs per minute are permitted and only minute 0 is reserved; it also counts ONLY
// jobs whose hour field is '*', so daily jobs are not counted at all. On the live roster, 49 of 60
// minutes sit at <= 1 and can take one more. The design space was never two slots; it was 49.
//
// So chaining alone was load-bearing for the SLO, and that was the defect: alert_event.created_at is
// TRANSACTION START, so the whole sweep runtime was spent before dispatch began (P0 1166: 371s,
// a 71s breach). The owner's instruction on 2026-08-30 was to decouple the lane onto its own slot,
// keep the 5-minute SLO exactly as it is, and preserve the full sweep. Both paths now exist: the
// dedicated lane is what MEETS the SLO, and the sweep's leading call remains as defence-in-depth
// (it is the one that survives a sweep aborting on statement_timeout and rolling its trailing call
// back). Decoupled means the SLO no longer DEPENDS on the sweep, not that the sweep stops helping.
check(
  'the every-minute polling job is still gone',
  new RegExp(`cron\\.unschedule\\(\\s*'${CRON_JOB}'`).test(corpus)
    && !new RegExp(`cron\\.schedule\\(\\s*'${CRON_JOB}'`).test(corpus.slice(corpus.lastIndexOf(`cron.unschedule('${CRON_JOB}'`))),
  'a job in every minute slot collides with every other job and trips '
    + 'mon_detect_cron_minute_collision — the 2026-08-10 stampede discipline. The owner-approved '
    + 'decoupling is a SLOT-DISCIPLINED schedule, never a return to per-minute polling.',
);

// --- THE DEDICATED FAST LANE (owner decision, 2026-08-30) ----------------------------------------
const laneSchedule = corpus.match(
  new RegExp(`cron\\.schedule\\(\\s*'${FAST_LANE}'\\s*,\\s*'([^']+)'`),
)?.[1] ?? '';
check(
  `${FAST_LANE} is scheduled on its own cron slot`,
  laneSchedule !== '',
  'without a dedicated lane the SLO is once again hostage to however long the sweep takes',
);
check(
  `${FAST_LANE} runs ${DISPATCHER}()`,
  new RegExp(`cron\\.schedule\\(\\s*'${FAST_LANE}'[\\s\\S]{0,400}?${DISPATCHER}\\(\\)`).test(corpus),
  'a dedicated slot that calls something else delivers nothing',
);

// THE CHECK THAT ACTUALLY DEFENDS THE SLO. A lane that exists but fires every 10 minutes is worse
// than useless: it looks like a fix and cannot deliver one. Parse the real minute list and measure
// the WORST gap, including the wrap past the top of the hour — the wrap is the one a hand-edited
// list silently breaks.
const laneMinutes = (laneSchedule.split(/\s+/)[0] ?? '')
  .split(',').map((m) => Number(m)).filter((m) => Number.isInteger(m) && m >= 0 && m <= 59)
  .sort((a, b) => a - b);
let worstGapMin = 60;
if (laneMinutes.length > 1) {
  worstGapMin = 0;
  for (let i = 0; i < laneMinutes.length; i++) {
    const next = i + 1 < laneMinutes.length ? laneMinutes[i + 1] : laneMinutes[0] + 60;
    worstGapMin = Math.max(worstGapMin, next - laneMinutes[i]);
  }
}
// Measured filing cost, POST -> GitHub issue exists: alert 1166's fast-lane POST at 05:34:56 and its
// issue at 05:35:11 = 15s. 60s is a deliberately pessimistic allowance over that.
const FILING_BUDGET_S = 60;
const worstDeliveryS = worstGapMin * 60 + FILING_BUDGET_S;
check(
  `the lane's worst-case wait + filing fits the ${SLA_MINUTES}-minute SLO `
    + `(worst gap ${worstGapMin}min → ~${worstDeliveryS}s of ${SLA_MINUTES * 60}s)`,
  laneMinutes.length > 1 && worstDeliveryS < SLA_MINUTES * 60,
  `worst gap ${worstGapMin}min gives ~${worstDeliveryS}s against a ${SLA_MINUTES * 60}s budget. `
    + 'Fix the SCHEDULE, never the SLO: widening c_sla_minutes to fit a slow lane is the exact move '
    + 'the owner forbade on 2026-08-30.',
);
check(
  'the lane does not occupy minute 0 (reserved for the matview refresh alone)',
  laneMinutes.length > 1 && !laneMinutes.includes(0),
  'mon_detect_cron_minute_collision() raises on ANY second job at minute 0',
);
check(
  `${DISPATCHER}() is ALSO still chained onto the sweep, as defence-in-depth`,
  /mon_dispatch_alerts\(\);[\s\S]{0,80}mon_dispatch_p0_fast\(\)/.test(corpus),
  'the dedicated lane is what meets the SLO, but the sweep\'s calls are what cover a lane that is '
    + 'itself unscheduled or failing — removing them trades a belt-and-braces path for one',
);
check(
  'the chain does NOT change the sweep schedule (owner-only)',
  /v_sched <> '29,59 \* \* \* \*'/.test(corpus),
  'appending to the command is in scope; changing when it runs is an owner decision',
);
check(
  'the dispatcher caps retries',
  /c_max_attempts\s+int\s*:=\s*\d+/.test(dispatcherCode)
    && /attempts\s*>=\s*c_max_attempts/.test(dispatcherCode),
  'without a cap, one down channel becomes a POST every minute forever aimed at whoever is already '
    + 'having a bad day',
);
check(
  'the dispatcher reconciles net._http_response rather than trusting the enqueue',
  /net\._http_response/.test(dispatcherCode),
  'net.http_post returns on ENQUEUE, not on response — a request_id alone proves nothing was '
    + 'delivered. That distinction is the entire reason this barrier exists.',
);

// --- it must not become a second writer of dispatched_at -----------------------------------------
check(
  'the fast lane never stamps alert_event.dispatched_at',
  !/dispatched_at\s*=\s*now\(\)/.test(dispatcherCode),
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
  /actions\/workflows\/alert-dispatch\.yml\/dispatches/.test(dispatcherCode),
  'the P0 destination must be the existing workflow — a second issue-filer would be the parallel '
    + 'ownership system the owner forbade',
);
check(
  'the GitHub PAT is read from Vault at send time, never stored in ops_alert_channel',
  /vault\.decrypted_secrets/.test(dispatcherCode) && !/ghp_[A-Za-z0-9]/.test(dispatcherCode),
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
  /c_retrigger_after\s+interval\s*:=/.test(dispatcherCode)
    && /last_tried\s*>\s*now\(\)\s*-\s*c_retrigger_after/.test(dispatcherCode),
  'without a throttle the every-minute job would re-dispatch the workflow while a run is still in '
    + 'flight, racing its own concurrency group',
);

// --- THE COUPLING THE CHAIN CREATED, added 2026-08-29 --------------------------------------------
// Chaining the fast lane onto the sweep (20260828231336) was the right call, but it silently made
// SWEEP DURATION a term in P0 delivery latency: alert_event.created_at defaults to now(), which is
// TRANSACTION START, so a P0's 5-minute clock starts when the sweep starts and the sweep's whole
// runtime is spent before dispatch begins. Nothing was updated to watch that.
//
// Measured 2026-08-29: the 04:29 sweep ran 185.3s and its P0s were filed at 204.0s -- ~19s of
// overhead past the sweep, i.e. the sweep IS the delivery time. The slowest sweep in that 24h was
// 332.1s => 351s forecast, a breach; 5 of 48 sweeps would have breached. The pre-existing budget
// limb caught NONE of them, because it measures the same runtime against statement_timeout (900s)
// and stays green until 540s. These two checks pin the fix so it cannot be quietly undone.
check(
  'the sweep is measured against the P0 SLO budget, not only its own statement_timeout',
  /detector_sweep_vs_p0_slo/.test(corpus),
  'without this limb the sweep can grow from 332s to 540s -- guaranteeing SLO breach the whole way '
    + '-- while the only detector watching its duration reads a comfortable 37% of 900s',
);
check(
  'the fast lane is front-loaded as well as trailing, so an ABORTED sweep cannot strand every P0',
  /front-load|front_load|FRONT-LOAD/i.test(corpus)
    && /mon_dispatch_p0_fast\(\);'\s*\|\|\s*chr\(10\)/.test(corpus),
  'pg_cron runs the whole command in ONE transaction: when mon_run_all_detectors() hits '
    + 'statement_timeout the rollback takes the trailing mon_dispatch_p0_fast() with it and NO P0 '
    + 'is dispatched at all. Observed 2026-08-26: the 17:29 AND 17:59 sweeps both aborted, a full '
    + 'hour with zero dispatch capability, and P0 1011 waited 2h47m for the Actions backstop.',
);

// --- LIMB 3: DELIVERED, BUT LATE, added 2026-08-30 -----------------------------------------------
// THE HOLE THIS CLOSES. Limbs 1 and 2 both match only while `a.dispatched_at is null`. The instant
// alert-dispatch.yml stamps that column, a breach becomes invisible to this detector forever — so a
// path that delivers every single P0 late reads permanently GREEN. The SLO is defined on DELIVERY
// LATENCY; limbs 1-2 measure only PENDING latency, and the gap between those two predicates is the
// whole failure mode.
//
// Measured on production the day this shipped: alert 1166 (deleted_but_source_live:73) was created
// 2026-08-30 05:29:00 and dispatched 05:35:11 — 371s end-to-end, a 71s breach of the 300s SLO, and
// NOTHING raised, because by evaluation time dispatched_at was already stamped. The 05:29 sweep ran
// 356.8s and created_at is transaction start, so the clock had expired before the fast lane began.
check(
  'LIMB 3 exists: a P0 that was DELIVERED but LATE still raises',
  /mon_raise\(\s*'P1',\s*'p0_delivery_sla',\s*'monitoring',\s*'p0_delivery_sla_late'/.test(code),
  'without it, a breach vanishes the moment the issue is filed and the SLO becomes unmeasurable',
);
// THE DISTINGUISHING PROPERTY, and the one a "simplifying" refactor is most likely to destroy.
// Limb 3 must look at DELIVERED alerts. Reusing limbs 1-2's `dispatched_at is null` here would make
// it dead code that can never fire while still looking present in review. Both the counting query
// and the sample query must agree — the same lesson the github_workflow exclusion check above
// learned the hard way, where mutating only the counting query left the barrier green.
const deliveredFilters = (code.match(/a\.dispatched_at\s+is\s+not\s+null/g) ?? []).length;
check(
  'LIMB 3 matches DELIVERED alerts, in both its counting and sample queries',
  deliveredFilters >= 2,
  `found ${deliveredFilters}, expected the counting query AND the sample query. With `
    + '`dispatched_at is null` instead, limb 3 is unreachable code: limb 2 already owns that set.',
);
check(
  'LIMB 3 measures true end-to-end latency (dispatched_at - created_at) against the SLO',
  /a\.dispatched_at\s*-\s*a\.created_at\s*>\s*make_interval\(mins\s*=>\s*c_sla_minutes\)/.test(code),
  'dispatched_at is the only honest clock: one writer, stamped after `gh issue create` succeeds. A '
    + 'github_workflow 204 receipt is a trigger accepted, not a delivery.',
);
check(
  'LIMB 3 can go GREEN again on its own',
  /mon_resolve_key\('p0_delivery_sla',\s*'p0_delivery_sla_late'\)/.test(code),
  'a limb that can only ever raise corrupts open_alerts and suppresses its own future raises — '
    + 'mon_raise() returns 0 on an already-open dedup key',
);
check(
  'LIMB 3 uses a bounded rolling window, so a one-off ages out instead of pinning a permanent red',
  /c_late_window\s+constant\s+interval\s*:=\s*interval\s*'24 hours'/.test(code)
    && /a\.created_at\s*>\s*now\(\)\s*-\s*c_late_window/.test(code),
  'unbounded, alert 1011 (10037s, 2026-08-26, from before the fast-lane fix) would hold this red '
    + 'forever and train people to ignore the key',
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
