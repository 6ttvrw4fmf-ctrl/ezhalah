// EVERY DATA REPAIR MUST BE IN THE REGISTRY THAT RE-VERIFIES IT — LIVE HALF.
//
// THE GAP THIS CLOSES (routine #7, 2026-09-12). The orphaned-guarantee registry
// (public.ops_repair_guarantee_registry) carries PERMANENT coverage with oldest-first rotation, so
// no repair ever ages out of re-verification — that is the whole design, written after a July
// district-suffix repair silently decayed for a month with zero alerts. But rotation can only reach
// repairs that are IN the registry, and nothing checked that they got there.
// mon_detect_repair_guarantee_stale() has two limbs — a REGISTERED repair nothing watches, and a
// REGISTERED repair nothing re-verified — and both take the registry as their universe. A repair
// that was never enrolled is outside both. Measured the day this shipped: 28 strict-era listing
// repairs committed and live, **9 never enrolled** (20260831195108, 20260905072446, 20260906042842,
// 20260906043755, 20260906045735, 20260911195109, 20260911215017, 20260911221734, 20260911222018) —
// five of them landed in the previous 24 hours, including BOTH halves of an aqarmonthly
// district-suffix backfill, which is the very repair family this registry was built for.
//
// So this is the enrollment limb, and it lives outside the database on purpose: the classifier it
// needs already exists once, in TypeScript (scripts/lib/repairClassifier.ts), and a SQL re-write of
// it under-detected six of 28 repairs when it was tried. One predicate, two callers.
//
// WHY THE LIVE HALF IS NOT IN `npm test`. Its verdict is decided by PRODUCTION's registry contents,
// which move when any of the eleven routines writes a row — so inside the required suite it would
// fail unrelated pull requests on unchanged code, the exact defect AGENTS.md records for four other
// checks on 2026-09-06. The hermetic half (scripts/verify-repair-guarantee-enrollment.ts) keeps the
// predicate and its mutation proofs per-PR, and asserts by EXECUTION that the workflow named in
// scripts/test-exclusions.txt really invokes this file — so the split cannot decay into a deletion.
//
// FAILS CLOSED, AND SPECIFICALLY AGAINST THE FRIENDLY-LOOKING FAILURE. ops_repair_guarantee_registry
// is RLS-protected: an ANON read of it returns HTTP 200 with `[]`. Read naively that says "nothing
// is enrolled", which is a confident negative manufactured out of a permissions failure — AGENTS.md's
// "A FAILED FETCH IS NOT AN EMPTY ANSWER". enrollmentVerdict() is given `null` on any non-2xx and
// refuses outright on a zero-row registry, rather than reporting all 28 repairs as unenrolled and
// sending someone to fix a gap that does not exist. Run it with SUPABASE_SERVICE_ROLE_KEY.
//
//   SUPABASE_SERVICE_ROLE_KEY=… node --experimental-strip-types \
//     scripts/verify-repair-guarantee-enrollment-live.ts
//
// SCOPE, stated rather than hidden: the repair side is computed from COMMITTED migration files. A
// repair applied to production and never committed is invisible here by construction — that is
// migration drift (AGENTS.md condition 1, applied-but-not-committed), which has its own guard
// running every 15 minutes and blocks every deploy while it is red.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { COMMITTED_NOT_APPLIED_BASELINE } from './lib/migrationDrift.ts';
import {
  repairsData, migrationVersion, enrollmentVerdict, parseWaivers,
} from './lib/repairClassifier.ts';

const root = join(import.meta.dirname, '..');
const MIGRATIONS = join(root, 'supabase', 'migrations');
const WAIVERS = join(root, 'scripts', 'repair-enrollment-waivers.txt');

const { url: URL_BASE } = resolvePublicSupabase();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const DEDUP_KEY = 'repair_guarantee_unenrolled';

async function callRpc(fn: string, body: unknown): Promise<void> {
  if (!SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(`  (could not reach ${fn}: ${(e as Error).message})`);
  }
}

/** Returns the enrolled versions, or null when the registry could not be READ. Never `[]` on error. */
async function readRegistry(): Promise<string[] | null> {
  if (!SERVICE_ROLE_KEY) {
    console.error('  registry read needs SUPABASE_SERVICE_ROLE_KEY (the table is RLS-protected and '
      + 'an anon read returns 200 with [] — which this check must never mistake for an empty registry)');
    return null;
  }
  // Retried, like every other scheduled live check here: a transient 5xx passes on attempt 2 or 3,
  // while a genuine enrollment gap is deterministic and fails all three. An unreadable answer stays
  // a FAILURE — it is never allowed to imitate the clean result.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(
        `${URL_BASE}/rest/v1/ops_repair_guarantee_registry?select=repair_version&limit=10000`,
        { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } });
      if (!r.ok) { console.error(`  registry read attempt ${attempt}: HTTP ${r.status}`); continue; }
      const rows = await r.json() as Array<{ repair_version: string }>;
      if (!Array.isArray(rows)) { console.error(`  registry read attempt ${attempt}: not an array`); continue; }
      return rows.map((x) => String(x.repair_version));
    } catch (e) {
      console.error(`  registry read attempt ${attempt}: ${(e as Error).message}`);
    }
  }
  return null;
}

console.log('\nEvery data repair is enrolled in the registry that re-verifies it\n');

const repairs: string[] = [];
for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
  const v = migrationVersion(f);
  if (v < COMMITTED_NOT_APPLIED_BASELINE) continue;       // pre strict-era: out of scope entirely
  if (repairsData(readFileSync(join(MIGRATIONS, f), 'utf8'))) repairs.push(v);
}

const waived = existsSync(WAIVERS) ? parseWaivers(readFileSync(WAIVERS, 'utf8')) : new Map<string, string>();
const enrolled = await readRegistry();
const verdict = enrollmentVerdict({ repairs, enrolled, waived });

console.log(`  in-era repairs (committed): ${repairs.length}`);
console.log(`  registered in production:   ${enrolled === null ? 'UNREADABLE' : enrolled.length}`);
console.log(`  waived with a reason:       ${waived.size}`);

if (verdict.ok) {
  console.log(`\n✓ all ${repairs.length} in-era repairs are enrolled or waived\n`);
  await callRpc('mon_resolve_key', { p_kind: 'repair_guarantee', p_dedup: DEDUP_KEY });
  process.exit(0);
}

for (const p of verdict.problems) console.error(`  ✗ ${p}`);
if (verdict.unenrolled.length) {
  console.error(`  ✗ ${verdict.unenrolled.length} repair(s) the registry rotation can NEVER reach:`);
  for (const v of verdict.unenrolled) console.error(`      ${v}`);
  console.error('    Re-verify each invariant against production NOW, then insert a row into '
    + 'ops_repair_guarantee_registry naming the repair, the invariant in plain words, and the '
    + 'detector that watches it. If it is genuinely not a repair, add a reasoned line to '
    + 'scripts/repair-enrollment-waivers.txt instead. Do NOT clear this by widening the classifier.');
}

await callRpc('mon_raise', {
  p_sev: 'P2',
  p_kind: 'repair_guarantee',
  p_platform: 'monitoring',
  p_dedup: DEDUP_KEY,
  p_detail: {
    unenrolled: verdict.unenrolled,
    problems: verdict.problems,
    in_era_repairs: repairs.length,
    why: 'These migrations executed a data repair and are not in ops_repair_guarantee_registry, so '
      + 'the permanent oldest-first rotation can never reach them: nothing will ever re-verify that '
      + 'what they fixed is still fixed. mon_detect_repair_guarantee_stale() cannot see this — both '
      + 'of its limbs read the registry as their universe, so a repair that was never enrolled is '
      + 'outside both.',
    action: 'Re-verify each invariant against production, then enrol it (repair, invariant in plain '
      + 'words, watching detector). A genuine non-repair goes in scripts/repair-enrollment-waivers.txt '
      + 'with a reason, never into the registry with an empty detector.',
  },
});

console.error('\n✗ enrollment gap\n');
process.exit(1);
