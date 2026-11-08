// Repeat escalation must reach the source kind's owner on its first dispatch.
// Run: node --experimental-strip-types scripts/verify-repeat-bug-routing.ts
import assert from 'node:assert/strict';
import { routineForKind, labelForKind, type RoutineNumber } from './lib/alertRouting.ts';

// Explicit expected owners: comparing wrapped/unwrapped results alone would pass
// if both paths regressed to the fallback owner.
const owners: Array<[string, RoutineNumber]> = [
  ['run_duration_explosion', 1],
  ['alert_payload_subject_mismatch', 2],
  ['district_contradicts_source', 3],
  ['search_live_check_failed', 4],
  ['af_live_check_failed', 5],
  ['journey_live_check_failed', 6],
  ['migration_drift', 7],
  ['regression_survived', 8],
  ['layer_disagreement', 9],
  ['barrier_missing', 10],
  ['false_resurrection', 11],
];
for (const [kind, owner] of owners) {
  for (const prefix of ['repeat_bug:', 'repeat_bug:repeat_bug:']) {
    assert.equal(routineForKind(prefix + kind), owner, `${prefix}${kind}: owner`);
    assert.equal(labelForKind(prefix + kind), labelForKind(kind), `${prefix}${kind}: dispatch label`);
  }
}
for (const kind of ['', 'unknown_future_detector', 'كسر_السعر', 'run', 'AF_live_check_failed']) {
  assert.equal(routineForKind(`repeat_bug:${kind}`), 2, `unclaimed source ${JSON.stringify(kind)}`);
  assert.equal(labelForKind(`repeat_bug:${kind}`), 'routine-2-production');
}
// The marker is literal and anchored; similar kinds must not be unwrapped.
for (const kind of ['repeat_bug_run_duration_explosion', 'repeat_bug',
  'Repeat_bug:run_duration_explosion', 'prefix_repeat_bug:run_duration_explosion',
  ' repeat_bug:run_duration_explosion', 'repeat_bug: run_duration_explosion']) {
  assert.equal(routineForKind(kind), 2, `non-marker ${JSON.stringify(kind)}`);
}
console.log('✓ verify-repeat-bug-routing: every owning lane, nested escalation, fallback and literal-prefix cases');
