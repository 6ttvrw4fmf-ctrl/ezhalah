// CLI shim: alert kind -> owning routine's GitHub label. Called by .github/workflows/alert-dispatch.yml.
//
// This exists so the workflow EXECUTES scripts/lib/alertRouting.ts rather than restating its table
// in bash. A restated table is a mirror, and a mirror drifts -- which is the failure mode that cost
// this system 41 days of silence (alert-dispatch.yml's severity filter said P1,P2 while everything
// else said P0,P1,P2, and nothing compared them).
//
//   node --experimental-strip-types scripts/alert-routing-label.ts <kind>   ->  routine-N-...
//
// Exits non-zero on a missing argument so a workflow bug is loud. It cannot fail on an UNKNOWN
// kind: routineForKind() is total and falls back to routine #2.
import { labelForKind } from './lib/alertRouting.ts';

const kind = process.argv[2];
if (!kind) {
  console.error('usage: alert-routing-label.ts <alert_kind>');
  process.exit(2);
}
console.log(labelForKind(kind));
