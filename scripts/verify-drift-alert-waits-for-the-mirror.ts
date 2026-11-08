// The migration_drift P1 waits for the auto-mirror's window, and NOTHING ELSE waits (🔧 2026-11-08).
// It reopened 24× in 7 days: every legitimate apply is missing_in_git until its mirror PR merges (~2 h).
// This executes driftAlertIsDue() — the one predicate verify-migration-drift-vs-production.ts calls — in both directions.
import { readFileSync } from 'node:fs';
import { driftAlertIsDue, driftIsClean, type DriftReport } from './lib/migrationDrift.ts';

const now = new Date(Date.UTC(2026, 10, 8, 2, 0, 0));
const empty = { missing_in_git: [], missing_in_prod: [], duplicate_versions: [], duplicate_overloads: [] };
const cases: Array<[string, boolean, boolean]> = [
  ['a migration applied 30 min ago, mirror in flight', driftAlertIsDue({ ...empty, missing_in_git: ['20261108013000'] }, now), false],
  ['a migration still unmirrored after 3 h', driftAlertIsDue({ ...empty, missing_in_git: ['20261107230000'] }, now), true],
  ['one young + one stale', driftAlertIsDue({ ...empty, missing_in_git: ['20261108013000', '20261107200000'] }, now), true],
  ['an unparsable version', driftAlertIsDue({ ...empty, missing_in_git: ['rega_land'] }, now), true],
  ['committed but not applied', driftAlertIsDue({ ...empty, missing_in_prod: ['x.sql'] }, now), true],
  ['duplicate overloads', driftAlertIsDue({ ...empty, duplicate_overloads: ['f'] }, now), true],
  ['duplicate versions', driftAlertIsDue({ ...empty, duplicate_versions: ['20261108013000'] }, now), true],
];
// Millisecond boundaries prevent a change from >= to > (or an hour-rounding shortcut).
const appliedAt = Date.UTC(2026, 10, 7, 23);
for (const [offset, due] of [[-1, false], [0, true], [1, true]] as const) {
  cases.push([`default grace boundary ${offset} ms`, driftAlertIsDue(
    { ...empty, missing_in_git: ['20261107230000'] },
    new Date(appliedAt + 3 * 3600_000 + offset)), due]);
}
cases.push(
  ['clean report', driftAlertIsDue(empty, now), false],
  ['multiple young mirrors', driftAlertIsDue({ ...empty, missing_in_git: ['20261108013000', '20261108015959'] }, now), false],
  ['stale first, young second', driftAlertIsDue({ ...empty, missing_in_git: ['20261107200000', '20261108013000'] }, now), true],
  ['just applied', driftAlertIsDue({ ...empty, missing_in_git: ['20261108020000'] }, now), false],
  ['fractional grace not yet elapsed', driftAlertIsDue({ ...empty, missing_in_git: ['20261108013001'] }, now, 0.5), false],
  ['fractional grace exactly elapsed', driftAlertIsDue({ ...empty, missing_in_git: ['20261108013000'] }, now, 0.5), true],
  ['zero grace raises immediately', driftAlertIsDue({ ...empty, missing_in_git: ['20261108020000'] }, now, 0), true],
  ['longer custom grace', driftAlertIsDue({ ...empty, missing_in_git: ['20261107230000'] }, now, 4), false],
  ['UTC timestamp with offset clock', driftAlertIsDue({ ...empty, missing_in_git: ['20261107230000'] }, new Date('2026-11-08T05:00:00+03:00')), true],
  ['year rollover within grace', driftAlertIsDue({ ...empty, missing_in_git: ['20261231235959'] }, new Date('2027-01-01T02:59:58Z')), false],
  ['year rollover at grace', driftAlertIsDue({ ...empty, missing_in_git: ['20261231235959'] }, new Date('2027-01-01T02:59:59Z')), true],
  ['leap day within grace', driftAlertIsDue({ ...empty, missing_in_git: ['20280229233000'] }, new Date('2028-03-01T02:29:59Z')), false],
);
for (const version of ['', '20261108', '2026110801300', '202611080130000',
  '20261108013000_name', ' 20261108013000', '20261108013000 ', '2026-11-08T01:30:00Z']) {
  cases.push([`invalid version ${JSON.stringify(version)} fails closed`, driftAlertIsDue(
    { ...empty, missing_in_git: [version] }, now), true]);
}
// Other drift never inherits the mirror grace, even alongside a young missing_in_git.
for (const other of [
  { missing_in_prod: ['not_applied.sql'] },
  { duplicate_overloads: ['public.f'] },
  { duplicate_versions: ['20261108013000'] },
  { duplicate_versions: [{ version: '20261108013000', files: ['a.sql', 'b.sql'] }] },
]) {
  const report = { ...empty, missing_in_git: ['20261108013000'], ...other };
  cases.push([`mixed drift ${JSON.stringify(other)} raises immediately`, driftAlertIsDue(report, now), true]);
}
const pendingMirror = { ...empty, missing_in_git: ['20261108013000'] };
cases.push(['young mirror still blocks deployment', driftIsClean(pendingMirror), false]);
const frozenReport: DriftReport = { ...empty, missing_in_git: ['20261108013000'] };
Object.freeze(frozenReport.missing_in_git);
Object.freeze(frozenReport);
// Freeze the actual inputs: classification must not reorder or remove pending versions.
cases.push(['frozen inputs are accepted', driftAlertIsDue(frozenReport, now), false]);
const fail = cases.filter(([, got, want]) => got !== want).map(([name, got]) => `${name}: got ${got}`);

// The gate itself must not wait: the script still decides its exit code from `drifted`, never from `alertDue`.
const script = readFileSync(new URL('./verify-migration-drift-vs-production.ts', import.meta.url), 'utf8');
if (!/driftAlertIsDue\(/.test(script)) fail.push('the drift script no longer asks driftAlertIsDue()');
if (!/if \(drifted\) \{\n  console\.error/.test(script)) fail.push('the exit-1 branch is no longer decided by `drifted` alone');
if (/if \(alertDue\) \{\n  console\.error/.test(script)) fail.push('the exit code now waits for the mirror window — the gate was loosened');

if (fail.length) {
  console.error('✗ verify-drift-alert-waits-for-the-mirror:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log(`✓ verify-drift-alert-waits-for-the-mirror: ${cases.length} cases; only a young missing_in_git waits, the gate never does.`);
