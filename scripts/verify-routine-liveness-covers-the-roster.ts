// THE ROUTINE-LIVENESS WATCHDOG MUST WATCH THE ROSTER, NOT A FROZEN SLUG LIST.
//
// WHY THIS EXISTS (owner audit, 2026-09-21). mon_detect_routine_sentry_silent() is the ONLY signal
// that a daily engineer routine has stopped running. It hardcoded seven OLD routine slugs; the
// roster had since become eleven routine-N-* slugs and the routines had begun checking in under the
// new names. The watchdog was therefore watching GHOSTS — firing for renamed/never-seen old slugs
// while NINE of the eleven current routines had no liveness coverage at all. A routine could die for
// days and nothing would fire. A rename silently reopened the exact hole the detector exists to close.
//
// The fix (migration 20260921090000) reads the roster from incident_known_owners() and maps each
// routine to the heartbeat slug(s) it emits via ops_routine_heartbeat_alias. This barrier makes that
// un-driftable: the detector must read the roster function (never a literal slug list), and every
// canonical routine must have an alias row — a routine with none would be silently unwatched.
//
//   node --experimental-strip-types scripts/verify-routine-liveness-covers-the-roster.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTINES } from './lib/alertRouting.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MIG = 'supabase/migrations/20260921090000_routine_liveness_watchdog_covers_the_canonical_roster.sql';

const ok: string[] = [];
const problems: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const sql = readFileSync(join(ROOT, MIG), 'utf8');

// The eleven canonical routine slugs, from the single routing source. verify-incident-owner-roster-
// has-one-source.ts already pins ROUTINES <-> incident_known_owners() parity, so this is the roster.
const owners = Object.values(ROUTINES).map((r) => r.label);
check(owners.length === 11, `routing source lists ${owners.length} routines`,
  `expected 11 canonical routines, got ${owners.length} — the roster or this barrier has drifted`);

// Isolate the detector body (everything from its CREATE onward) from the seed/DDL above it.
const fnStart = sql.indexOf('create or replace function public.mon_detect_routine_sentry_silent');
check(fnStart >= 0, 'the migration defines mon_detect_routine_sentry_silent',
  'the migration no longer defines mon_detect_routine_sentry_silent — wrong file or renamed');
const body = fnStart >= 0 ? sql.slice(fnStart) : '';

// ── 1. The detector reads the ROSTER FUNCTION, not a literal list. ────────────────────────────
check(/incident_known_owners\(\)/.test(body),
  'the detector enumerates routines via incident_known_owners()',
  'DRIFT RISK: the detector no longer reads incident_known_owners() — it is back to a hardcoded ' +
  'list that a roster change will silently outdate, which is the exact 2026-09 defect.');

// ── 2. The old hardcoded canonical_slugs array must NOT return. ───────────────────────────────
check(!/canonical_slugs/.test(body) && !/array\s*\[\s*'(junior-scraping|senior-production|data-integrity)'/.test(body),
  'the detector body carries no hardcoded routine-slug array',
  'DRIFT: a hardcoded canonical_slugs/array of routine slugs is back in the detector body — a ' +
  'renamed or added routine will fall out of coverage without a single test failing.');

// ── 3. Every canonical routine has at least one heartbeat alias in the seed. ──────────────────
// A routine absent from ops_routine_heartbeat_alias is a routine the detector cannot see, i.e.
// silently unwatched — the failure this fix removes.
const missing = owners.filter((o) => !new RegExp(`\\(\\s*'${o}'\\s*,`).test(sql));
check(missing.length === 0,
  `all ${owners.length} canonical routines have a heartbeat alias seeded`,
  `these canonical routines have NO alias row, so the watchdog cannot watch them:\n      ${missing.join('\n      ')}`);

check(npmTestRuns(ROOT, 'verify-routine-liveness-covers-the-roster'),
  'npm test runs this guard',
  '`npm test` no longer runs this guard — the drift it exists for would return unnoticed');

// ── Mutation proofs (build the plausible mutant, confirm it is caught) ─────────────────────────
const mutations: string[] = [];
const mustCatch = (what: string, wouldFail: boolean) =>
  wouldFail ? mutations.push(what) : problems.push(`MUTATION SURVIVED: ${what} would NOT be caught`);

mustCatch('the detector reverting to a hardcoded slug list (incident_known_owners removed)',
  !/incident_known_owners\(\)/.test(body.replace(/incident_known_owners\(\)/g, "array['x']")));
mustCatch('the old canonical_slugs array being reintroduced',
  /canonical_slugs/.test(body + "\n  canonical_slugs constant text[] := array['junior-scraping'];"));
mustCatch('a canonical routine dropped from the alias seed',
  owners.filter((o) => !new RegExp(`\\(\\s*'${o}'\\s*,`).test(
    sql.replace(new RegExp(`\\(\\s*'${owners[owners.length - 1]}'\\s*,[^\\n]*\\n`), ''))).length > 0);

console.log('routine-liveness-covers-the-roster: the routine watchdog must track the roster, not a frozen list\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const m of mutations) console.log(`  ✓ mutation caught: ${m}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the routine-liveness watchdog can drift off the roster.`);
  process.exit(1);
}
console.log(`\n✅ routine-liveness-covers-the-roster: passed (${ok.length} checks, ${mutations.length} mutations, ${owners.length} routines).`);
