// The migration_drift P1 waits for the auto-mirror's window, and NOTHING ELSE waits (🔧 2026-11-08).
// It reopened 24× in 7 days: every legitimate apply is missing_in_git until its mirror PR merges (~2 h).
// This executes driftAlertIsDue() — the one predicate verify-migration-drift-vs-production.ts calls — in both directions.
import { readFileSync } from 'node:fs';
import { driftAlertIsDue } from './lib/migrationDrift.ts';

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
const fail = cases.filter(([, got, want]) => got !== want).map(([name, got]) => `${name}: got ${got}`);

// Mutation proof: a broken predicate must be caught by the same table.
type Pred = typeof driftAlertIsDue;
const table = (p: Pred) => [
  p({ ...empty, missing_in_git: ['20261108013000'] }, now) === false,
  p({ ...empty, missing_in_git: ['20261107230000'] }, now) === true,
  p({ ...empty, missing_in_prod: ['x.sql'] }, now) === true,
  p({ ...empty, missing_in_git: ['rega_land'] }, now) === true,
];
function mutation(name: string, mutant: Pred) {
  if (table(mutant).every(Boolean)) fail.push(`mutation NOT caught: ${name}`);
}
if (!table(driftAlertIsDue).every(Boolean)) fail.push('the real predicate fails its own table');
mutation('the alert never waits (old behaviour, flaps on every apply)', () => true);
mutation('the alert waits forever on missing_in_git', (r, n) => driftAlertIsDue({ ...r, missing_in_git: [] }, n));
mutation('other drift conditions wait too', (r, n) => (r.missing_in_git ?? []).length > 0 && driftAlertIsDue(r, n));
mutation('an unparsable version is treated as young', (r, n) => driftAlertIsDue({ ...r, missing_in_git: (r.missing_in_git ?? []).filter((v) => /^\d{14}$/.test(v)) }, n));

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
