// EVERY DELIVERED ALERT HAS AN OWNER (2026-08-28)
//
// Delivery was fixed on 2026-08-26. Ownership was not: 55 open `[alert]` issues carried a severity
// label and nothing else, and 18 open P1s sat with acknowledged_at NULL, the oldest since
// 2026-08-11. This barrier pins the properties that keep an alert from being filed to nobody.
//
// Source-shape barrier: no network, no database. It executes the real routing function (so the
// totality claims are tested, not asserted) and reads the workflow's EXECUTABLE text.
//
// COMMENTS ARE STRIPPED BEFORE MATCHING THE WORKFLOW, and that is load-bearing rather than tidy.
// scripts/lib/alertDelivery.ts records how the first version of the sibling barrier went green
// against prose in the workflow header instead of the executable line. The same trap is live here:
// the header now documents this routing in English, including the label names, so a naive matcher
// would confirm its own documentation and pass a workflow whose routing step had been deleted.

import { readFileSync, existsSync } from 'node:fs';
import {
  ROUTINES,
  ROUTING_RULES,
  ALERT_ROUTINE_LABELS,
  FALLBACK_ROUTINE,
  routineForKind,
  labelForKind,
} from './lib/alertRouting.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

console.log('\nAlert routing wired: every delivered alert reaches an owning routine\n');

// ── 1. The mapping is TOTAL ────────────────────────────────────────────────────────────────────
// The hole this closes is "filed with no owner", so the interesting inputs are the ones nobody
// designed for: a kind invented next month, an empty string, non-ASCII, a key-shaped string.
const HOSTILE = [
  '',
  'x',
  'totally_new_detector_kind_2099',
  'af',
  'PRICE_SOURCE_MISMATCH',
  'كسر_السعر',
  'silent_scraper_death:aqar:12345',
  '../../etc/passwd',
  ' leading_space',
];
check(
  'routeForKind is total — every hostile input returns one of the eleven routines',
  HOSTILE.every((k) => {
    const r = routineForKind(k);
    return Number.isInteger(r) && r >= 1 && r <= 7 && ROUTINES[r] !== undefined;
  }),
);
check(
  'labelForKind never returns empty/undefined for the same inputs',
  HOSTILE.every((k) => typeof labelForKind(k) === 'string' && labelForKind(k).startsWith('routine-')),
);

// ── 2. Eleven routines, distinct labels, all published ─────────────────────────────────────────
// Seven surface owners plus four added 2026-09-04 (owner) whose object is a gap, a layer
// disagreement, the verification apparatus, or a listing lifecycle. The count is pinned as a
// CONTIGUOUS RANGE rather than a literal list, so adding a routine is one edit here and a gap in
// the numbering (a routine deleted without renumbering) still fails.
const nums = Object.keys(ROUTINES).map(Number).sort((a, b) => a - b);
const EXPECTED_ROUTINES = 11;
check(`exactly ${EXPECTED_ROUTINES} routines, contiguously numbered 1..${EXPECTED_ROUTINES}`,
  JSON.stringify(nums) === JSON.stringify(Array.from({ length: EXPECTED_ROUTINES }, (_, i) => i + 1)));
check('every routine label is distinct', new Set(ALERT_ROUTINE_LABELS).size === EXPECTED_ROUTINES);
check('every routine label is `routine-<n>-…`', nums.every((n) => ROUTINES[n as 1].label.startsWith(`routine-${n}-`)));
check(
  'ALERT_ROUTINE_LABELS lists every routine (the workflow creates labels from it — a missing one makes `gh issue edit --add-label` fail and leaves the issue unowned)',
  nums.every((n) => ALERT_ROUTINE_LABELS.includes(ROUTINES[n as 1].label)),
);

// ── 3. The fallback is a real owner, not a sentinel ────────────────────────────────────────────
check('FALLBACK_ROUTINE is a real routine', ROUTINES[FALLBACK_ROUTINE] !== undefined);
check(
  'fallback is routine #2 (🎖️ Senior Production), the standing triage router in SENTRY_ROUTING §2',
  FALLBACK_ROUTINE === 2 && /Senior Production/.test(ROUTINES[FALLBACK_ROUTINE].name),
);
check('an unmatched kind lands on the fallback', routineForKind('totally_new_detector_kind_2099') === FALLBACK_ROUTINE);

// ── 4. Ordering invariants — first-match-wins makes rule order semantic ────────────────────────
// Each of these is a kind that TWO rules match; the assertion is that the right one wins. A
// reordering that broke them would otherwise be silent.
check('#7 before #3: stale_no_remediation_path is a seam failure, not a stale-data one',
  routineForKind('stale_no_remediation_path') === 7);
check('#3 still owns ordinary stale kinds', routineForKind('stale_active') === 3);
check('#5 before #3: af_* stays with Advanced Filter', routineForKind('af_null_to_false_conversion') === 5);
check('#7 owns the monitoring chain itself', routineForKind('alert_delivery') === 7 && routineForKind('cron_health') === 7);
check('#1 owns the capture layer', routineForKind('silent_scraper_death') === 1);
check('rule order is meaningful (the broad #3 rules come after the specific ones)',
  ROUTING_RULES.findIndex((r) => r.routine === 7) < ROUTING_RULES.findIndex((r) => r.routine === 3));

// ── 5. The workflow actually executes the mapping ──────────────────────────────────────────────
const wfPath = new URL('../.github/workflows/alert-dispatch.yml', import.meta.url).pathname;
check('.github/workflows/alert-dispatch.yml exists', existsSync(wfPath));
const wfRaw = readFileSync(wfPath, 'utf8');
const wf = wfRaw
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

check('workflow checks the repo out (the routing shim is a tracked file)', /uses:\s*actions\/checkout/.test(wf));
check('workflow sets up node (the shim runs under --experimental-strip-types)', /uses:\s*actions\/setup-node/.test(wf));
check('workflow EXECUTES scripts/alert-routing-label.ts rather than restating the table in bash',
  /scripts\/alert-routing-label\.ts/.test(wf));
check('workflow creates the routine labels from ALERT_ROUTINE_LABELS', /ALERT_ROUTINE_LABELS/.test(wf));
check('workflow applies the label to the issue', /gh issue edit .*--add-label/.test(wf));
check('workflow only routes issues that have no routine label yet (a human re-route is respected)',
  /startswith\("routine-"\)/.test(wf));
check('workflow still selects only unrouted issues from the ezhalah-alert queue',
  /--label ezhalah-alert/.test(wf));

// The shim must not be able to silently print nothing: a blank label makes `gh issue edit
// --add-label ""` a no-op and the issue stays unowned, which is the failure being prevented.
const shimPath = new URL('./alert-routing-label.ts', import.meta.url).pathname;
check('scripts/alert-routing-label.ts exists', existsSync(shimPath));
const shim = readFileSync(shimPath, 'utf8');
check('shim exits non-zero when given no kind (a workflow bug must be loud, not blank)',
  /process\.exit\(2\)/.test(shim));
check('shim prints labelForKind, not a hand-written mapping', /labelForKind/.test(shim));

// ── 6. The canonical doc exists and states the invariants ──────────────────────────────────────
const docPath = new URL('../docs/ops/ALERT_ROUTING.md', import.meta.url).pathname;
check('docs/ops/ALERT_ROUTING.md exists', existsSync(docPath));
const doc = readFileSync(docPath, 'utf8');
check('doc names scripts/lib/alertRouting.ts as the single source of truth',
  /scripts\/lib\/alertRouting\.ts.*single source of truth/s.test(doc));
check('doc states routing is total', /total/.test(doc));
check('doc names routine #2 as the fallback / triage router', /routine #2/.test(doc));
check('doc explains that assignment is what writes acknowledged_at', /acknowledged_at/.test(doc));

console.log(
  failed
    ? `\n✗ ${failed} check(s) FAILED — an alert could be delivered to nobody`
    : '\n✓ Alert routing wired: mapping is total, eleven distinct owners, fallback is a real routine, and the workflow executes the mapping rather than mirroring it',
);
process.exit(failed ? 1 : 0);
