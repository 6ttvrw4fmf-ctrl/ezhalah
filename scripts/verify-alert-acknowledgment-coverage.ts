// Barrier: A FILED GITHUB ISSUE IS NOT THE SAME AS A HUMAN HAVING SEEN IT.
// Daily engineer, 2026-08-26. Offline, deterministic, wired into `npm test`.
//
// WHAT WAS FOUND. alert_event.acknowledged_at has existed since the schema was introduced and
// nothing ever wrote to it: 28 open P0/P1 alerts, all already dispatched (a GitHub issue exists
// for each), zero acknowledged, oldest since 2026-08-11. mon_raise() only ever CLEARS this column
// (on escalation) -- nothing sets it. Delivery (this same day's fix, verify-alert-delivery-
// coverage.ts) proves an issue gets FILED. It does not prove a human is coming.
//
// THE FIX, two halves that must stay paired:
//   1. .github/workflows/alert-dispatch.yml -- a human assigning themselves to the GitHub issue
//      IS the acknowledgment signal; a step PATCHes acknowledged_at back for any open
//      ezhalah-alert issue that has a non-empty assignees array.
//   2. public.mon_detect_unacknowledged_p0() (migration-mirrored below) -- re-pages (a fresh P1,
//      kind alert_acknowledgment) if a P0 sits dispatched-but-unassigned past a 4-hour grace
//      window. Self-clears via mon_resolve_key so it cannot ratchet.
//
// PRODUCTION-VERIFIED the same session this shipped: alert 1011 (P0 silent_scraper_death:
// erapulse, dispatched 07:16) was still unassigned at 13:45 -- mon_detect_unacknowledged_p0()
// raised alert 1029 naming exactly that row. See the PR description for the full before/after.
//
// MUTATION-PROVEN (each of these turns this check RED, verified then reverted):
//   - the workflow step stops reading `.assignees`
//   - the workflow step stops PATCHing `acknowledged_at`
//   - the detector's migration drops the `mon_raise('P1', 'alert_acknowledgment'` call
//   - the detector's migration drops the `mon_resolve_key('alert_acknowledgment'` call
//   - the roster-wiring migration is a hand-pasted body instead of a pg_get_functiondef+replace
//     needle-edit (this last one is also independently caught by
//     verify-detector-roster-edits-are-guarded.ts -- belt and suspenders on the same class of bug)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

// "Is this guard actually wired in?" — asked of the test registry, which is what `npm test`
// resolves its run set from (scripts/lib/testRegistry.ts). String-matching package.json used to
// answer it; since the 201-command chain became one runner invocation, that match would read
// "not wired" for every barrier in the suite.
const REPO_ROOT = join(import.meta.dirname, '..');

const ROOT = join(import.meta.dirname, '..');
const WORKFLOW_PATH = join(ROOT, '.github/workflows/alert-dispatch.yml');
const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations');
const DETECTOR_FIX = '20260826134525_unacknowledged_p0_detector_and_roster_wire.sql';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('verify-alert-acknowledgment-coverage');

// ---------------------------------------------------------------------------
// §1 -- the workflow must actually turn a GitHub assignee into acknowledged_at.
// ---------------------------------------------------------------------------
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
// Only inspect the real step body, not this file's own header prose describing it -- the exact
// trap verify-alert-delivery-coverage.ts already hit once (matching a comment instead of code).
const ackStepMatch = workflow.match(
  /- name: Acknowledge alerts whose issue has an assignee\n([\s\S]*?)(?=\n {6}- name:|\n?$)/,
);
check(
  '§1 alert-dispatch.yml has an "Acknowledge alerts..." step',
  !!ackStepMatch,
  'no step named "Acknowledge alerts whose issue has an assignee" found',
);
const ackStep = ackStepMatch?.[1] ?? '';
check(
  '§1 the step reads issue .assignees',
  /\.assignees\b/.test(ackStep),
  'the step body does not reference .assignees -- it cannot know whether a human picked up the issue',
);
check(
  '§1 the step filters for a NON-EMPTY assignees array',
  /assignees\s*\|\s*length\s*\)\s*>\s*0/.test(ackStep),
  'the step does not gate on assignees.length > 0 -- it would fire for every open alert, assigned or not',
);
check(
  '§1 the step PATCHes acknowledged_at',
  /acknowledged_at/.test(ackStep) && /-X\s+PATCH/.test(ackStep),
  'the step does not PATCH acknowledged_at -- an assignee would never be reflected back into the DB',
);
check(
  '§1 the PATCH only touches rows still acknowledged_at IS NULL (idempotent, safe to run every cycle)',
  /acknowledged_at=is\.null/.test(ackStep),
  'the PATCH filter is missing acknowledged_at=is.null -- re-running the step could stomp a real ack timestamp',
);

// ---------------------------------------------------------------------------
// §2 -- the detector must exist, page, and self-clear (never ratchet).
// ---------------------------------------------------------------------------
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
check(`§2 ${DETECTOR_FIX} is present`, files.includes(DETECTOR_FIX));
const detectorSql = files.includes(DETECTOR_FIX)
  ? readFileSync(join(MIGRATIONS_DIR, DETECTOR_FIX), 'utf8')
  : '';
check(
  '§2 defines mon_detect_unacknowledged_p0()',
  /create\s+or\s+replace\s+function\s+public\.mon_detect_unacknowledged_p0/i.test(detectorSql),
);
check(
  '§2 scopes to severity = P0 only (P1/P2/P3 ack SLAs are a separate, unproven decision)',
  /severity\s*=\s*'P0'/.test(detectorSql),
);
check(
  '§2 only considers alerts that were actually dispatched (dispatched_at is not null)',
  /dispatched_at\s+is\s+not\s+null/.test(detectorSql),
);
check(
  '§2 checks acknowledged_at IS NULL before raising',
  /acknowledged_at\s+is\s+null/.test(detectorSql),
);
check(
  '§2 applies a grace window before raising (a human needs time to see the issue at all)',
  /make_interval\s*\(\s*hours\s*=>/.test(detectorSql),
);
check(
  '§2 raises via mon_raise on kind alert_acknowledgment',
  /mon_raise\(\s*'P1'\s*,\s*'alert_acknowledgment'/.test(detectorSql),
);
check(
  '§2 can clear its own kind via mon_resolve_key (no ratchet)',
  /mon_resolve_key\(\s*'alert_acknowledgment'/.test(detectorSql),
);
check(
  '§2 dedup key is per-alert (unacknowledged_p0:<id>), so concurrent P0s page independently',
  /'unacknowledged_p0:'\s*\|\|\s*rec\.id/.test(detectorSql),
);

// ---------------------------------------------------------------------------
// §3 -- the roster edit must be a guarded needle-edit, not a pasted body.
// (verify-detector-roster-edits-are-guarded.ts enforces this generically for every migration
// touching mon_run_all_detectors; this section pins that THIS specific migration is the shape
// that check requires, so a regression is caught here with a acknowledgment-specific message too.)
// ---------------------------------------------------------------------------
check(
  '§3 splices via pg_get_functiondef, not a hand-pasted CREATE OR REPLACE body',
  /pg_get_functiondef\(\s*'public\.mon_run_all_detectors\(\)'::regprocedure\s*\)/.test(detectorSql),
);
check(
  '§3 uses replace() to splice, and never has to read what else is in the array',
  /\breplace\s*\(\s*v_body\s*,/.test(detectorSql),
);
check(
  '§3 refuses to run if the anchor detector is missing (would splice blind)',
  /raise exception[^;]*anchor[^;]*not found/i.test(detectorSql),
);
check(
  '§3 refuses to duplicate if already present (idempotency guard against a second apply)',
  /raise exception[^;]*already present/i.test(detectorSql),
);
check(
  '§3 the new detector name actually appears in the splice-in string',
  detectorSql.includes("'mon_detect_unacknowledged_p0',"),
);

// ---------------------------------------------------------------------------
// §4 -- this guard is worthless if nothing runs it.
// ---------------------------------------------------------------------------
check(
  '§4 npm test runs this file',
  npmTestRuns(REPO_ROOT, 'verify-alert-acknowledgment-coverage'),
  '`npm test` no longer runs verify-alert-acknowledgment-coverage.ts (see scripts/test-exclusions.txt) -- this guard is inert',
);

if (failures > 0) {
  console.error(`\n❌ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('verify-alert-acknowledgment-coverage: all checks passed');
