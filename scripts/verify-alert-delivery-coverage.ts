// Barrier: THE HIGHEST-SEVERITY ALERT MUST BE THE ONE MOST CERTAIN TO BE DELIVERED.
// Senior Production Engineer, 2026-08-26. Offline, deterministic, wired into `npm test`.
//
// WHAT WENT WRONG. .github/workflows/alert-dispatch.yml is the only channel that turns an
// alert_event row into something a human sees. Its PostgREST filter read `severity=in.(P1,P2)`.
// P0 is more severe than P1, not less -- but it was not in the list. Every P0 raised between
// 2026-07-16 and 2026-08-26 (53 of them, all kind silent_scraper_death) was dropped: dispatched=0.
//
// WHY NOTHING CAUGHT IT. mon_detect_alert_delivery() -- the barrier for exactly this -- only asked
// "is a destination CONFIGURED?". That had been true since 2026-08-11, so it read green for 41
// days while nothing was actually being delivered. It even computed the undelivered count and
// threw it away. A barrier that can only see one cause of a failure reports every other cause as
// health.
//
// WHAT THIS FILE PINS. Three components must agree, forever:
//   1. scripts/lib/alertDelivery.ts  DELIVERED_SEVERITIES  (canonical)
//   2. .github/workflows/alert-dispatch.yml  severity filter
//   3. public.mon_detect_alert_delivery()  c_delivered      (via its migration mirror in git)
// plus the two structural facts that make the pair meaningful: the dispatcher can actually label
// a P0 issue, and the detector really does check undelivered-ness rather than only configured-ness.
//
// MUTATION-PROVEN (each of these turns this check RED):
//   - workflow filter back to in.(P1,P2), or to in.(P0,P1,P2,P3)
//   - DELIVERED_SEVERITIES losing 'P0'
//   - the detector's c_delivered array disagreeing with either
//   - deleting the `gh label create P0` line
//   - reverting the detector to the configured-only shape (no dispatched_at predicate)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DELIVERED_SEVERITIES,
  UNDELIVERED_GRACE_MINUTES,
  ALERT_DELIVERY_DEDUP_KEYS,
  parseWorkflowSeverityFilter,
  countWorkflowSeverityFilters,
  parseDetectorSeverities,
  sameSeveritySet,
} from './lib/alertDelivery.ts';

const ROOT = join(import.meta.dirname, '..');
const WORKFLOW = join(ROOT, '.github/workflows/alert-dispatch.yml');
// The newest migration that (re)defines mon_detect_alert_delivery() is the one live in production.
const MIGRATIONS = join(ROOT, 'supabase/migrations');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('verify-alert-delivery-coverage');

// ---------------------------------------------------------------------------
// §0 -- the canonical statement itself must still be sane.
// ---------------------------------------------------------------------------
check(
  '§0 DELIVERED_SEVERITIES includes P0 (the severity the 2026-08-26 blackout dropped)',
  DELIVERED_SEVERITIES.includes('P0' as never),
  `got ${JSON.stringify(DELIVERED_SEVERITIES)}`,
);
check(
  '§0 DELIVERED_SEVERITIES excludes P3 (informational, deliberately not delivered)',
  !DELIVERED_SEVERITIES.includes('P3' as never),
  `got ${JSON.stringify(DELIVERED_SEVERITIES)}`,
);
check(
  '§0 grace window is a positive number of minutes',
  Number.isInteger(UNDELIVERED_GRACE_MINUTES) && UNDELIVERED_GRACE_MINUTES > 0,
  `got ${UNDELIVERED_GRACE_MINUTES}`,
);

// ---------------------------------------------------------------------------
// §1 -- the deliverer's filter must equal the canonical set, exactly.
// ---------------------------------------------------------------------------
const workflow = readFileSync(WORKFLOW, 'utf8');
const wfSeverities = parseWorkflowSeverityFilter(workflow);

check(
  '§1 alert-dispatch.yml still carries a severity filter this check can read',
  wfSeverities !== null,
  'no `severity=in.(...)` found -- either the filter was deleted (every alert would be ' +
    'dispatched, a different bug) or its shape changed and this barrier went vacuous',
);

if (wfSeverities) {
  check(
    '§1 dispatcher severity filter == DELIVERED_SEVERITIES',
    sameSeveritySet(wfSeverities, DELIVERED_SEVERITIES),
    `workflow=${JSON.stringify(wfSeverities)} canonical=${JSON.stringify(DELIVERED_SEVERITIES)}`,
  );
}

check(
  '§1 exactly one severity filter in the workflow (a second one would go unchecked)',
  countWorkflowSeverityFilters(workflow) === 1,
  `found ${countWorkflowSeverityFilters(workflow)} executable \`severity=in.(\` occurrences`,
);

// ---------------------------------------------------------------------------
// §2 -- a P0 issue must be labellable, or `gh issue create --label P0` fails and the row is
//       never stamped: the alert would silently stay undelivered for a second, different reason.
// ---------------------------------------------------------------------------
for (const sev of DELIVERED_SEVERITIES) {
  check(
    `§2 alert-dispatch.yml creates the ${sev} label before filing`,
    new RegExp(`gh label create ${sev}\\b`).test(workflow),
    `no \`gh label create ${sev}\` step -- filing a ${sev} issue would fail`,
  );
}

// ---------------------------------------------------------------------------
// §3 -- the detector must agree with the canonical set, and must really check DELIVERY.
// ---------------------------------------------------------------------------
import { readdirSync } from 'node:fs';

const detectorFiles = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => readFileSync(join(MIGRATIONS, f), 'utf8').includes('function public.mon_detect_alert_delivery'))
  .sort();

check(
  '§3 at least one migration defines mon_detect_alert_delivery()',
  detectorFiles.length > 0,
  `searched ${MIGRATIONS}`,
);

if (detectorFiles.length > 0) {
  // The last one by version is what production runs.
  const newest = detectorFiles[detectorFiles.length - 1];
  const sql = readFileSync(join(MIGRATIONS, newest), 'utf8');
  console.log(`  ..   newest definition: ${newest}`);

  const detSeverities = parseDetectorSeverities(sql);
  check(
    '§3 detector declares a c_delivered severity array',
    detSeverities !== null,
    'no `c_delivered text[] := array[...]` -- the detector has no delivery scope to check',
  );
  if (detSeverities) {
    check(
      '§3 detector c_delivered == DELIVERED_SEVERITIES',
      sameSeveritySet(detSeverities, DELIVERED_SEVERITIES),
      `detector=${JSON.stringify(detSeverities)} canonical=${JSON.stringify(DELIVERED_SEVERITIES)}`,
    );
  }

  // The regression that actually hid the blackout: a detector that only looks at CONFIGURATION.
  check(
    '§3 detector inspects dispatched_at (delivery), not only configuration',
    /dispatched_at\s+is\s+null/i.test(sql),
    'the detector no longer looks at whether anything was actually dispatched -- this is the ' +
      'exact pre-2026-08-26 shape that read green through a 41-day P0 blackout',
  );
  check(
    '§3 detector applies a grace window before raising',
    /make_interval\s*\(\s*mins\s*=>/i.test(sql),
    'no grace window -- a single transient Actions failure would raise',
  );

  // Both dedup keys must exist AND both must be resolvable, or the kind becomes a ratchet
  // (mon_detect_unresolvable_alert_kinds would then fire on kind 'alert_delivery').
  for (const key of ALERT_DELIVERY_DEDUP_KEYS) {
    check(
      `§3 detector raises on dedup key ${key}`,
      new RegExp(`mon_raise\\([^)]*'${key}'`, 's').test(sql),
      `no mon_raise for ${key}`,
    );
    check(
      `§3 detector can clear dedup key ${key} (no ratchet)`,
      new RegExp(`mon_resolve_key\\('alert_delivery',\\s*'${key}'\\)`).test(sql),
      `no mon_resolve_key for ${key} -- an alert kind that cannot be cleared is a ratchet`,
    );
  }
}

// ---------------------------------------------------------------------------
// §4 -- self-check: the parsers must not silently succeed on nonsense, or §1/§3 are theatre.
// ---------------------------------------------------------------------------
check(
  '§4 workflow parser returns null when no filter is present',
  parseWorkflowSeverityFilter('name: nothing here') === null,
);
// The trap this barrier fell into on its first run: the workflow header documents the old bug by
// quoting `severity=in.(P1,P2)`. Prose must never be mistaken for the executable filter.
check(
  '§4 workflow parser ignores commented-out / documented filters',
  JSON.stringify(
    parseWorkflowSeverityFilter(
      '# it used to say severity=in.(P1,P2) and that was the bug\n  url="...severity=in.%28P0,P1,P2%29..."',
    ),
  ) === JSON.stringify(['P0', 'P1', 'P2']),
);
check(
  '§4 filter counter ignores comments too',
  countWorkflowSeverityFilters('# severity=in.(P1,P2)\nx severity=in.%28P0,P1,P2%29') === 1,
);
check(
  '§4 workflow parser reads the encoded form',
  JSON.stringify(parseWorkflowSeverityFilter('x&severity=in.%28P0,P1%29&y')) ===
    JSON.stringify(['P0', 'P1']),
);
check(
  '§4 workflow parser reads the literal-paren form',
  JSON.stringify(parseWorkflowSeverityFilter('x&severity=in.(P0,P1)&y')) ===
    JSON.stringify(['P0', 'P1']),
);
check(
  '§4 detector parser returns null when the declaration is absent',
  parseDetectorSeverities('create function f() ...') === null,
);
check(
  '§4 set comparison rejects a missing element',
  !sameSeveritySet(['P1', 'P2'], ['P0', 'P1', 'P2']),
);
check(
  '§4 set comparison rejects an extra element',
  !sameSeveritySet(['P0', 'P1', 'P2', 'P3'], ['P0', 'P1', 'P2']),
);
check(
  '§4 set comparison is order-insensitive',
  sameSeveritySet(['P2', 'P0', 'P1'], ['P0', 'P1', 'P2']),
);

if (failures > 0) {
  console.error(`\nverify-alert-delivery-coverage: ${failures} FAILED`);
  process.exit(1);
}
console.log('verify-alert-delivery-coverage: all checks passed');
