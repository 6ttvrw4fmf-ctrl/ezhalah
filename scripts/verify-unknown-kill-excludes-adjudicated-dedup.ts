// AN ADJUDICATED DE-DUPLICATION IS NOT A DEATH ON UNKNOWN EVIDENCE — AND THE DETECTOR THAT SAYS
// "UNKNOWN IS NOT DEAD" MUST NOT CRY WOLF OVER ONE.
//
// WHAT WENT WRONG (2026-09-13). A res/com collision repair retired seven duplicate rows across
// amaall and arkaan at 07:36:30, each one recorded in `ops_res_com_collision_adjudication` with
// verdict='REPAIRABLE' and the side it retired. `mon_detect_unknown_treated_as_dead()` counted all
// seven as deactivations with no source verdict and raised two P1s at 07:59 (alert_event 2719,
// 2720). Every one of the seven has an active twin holding the identical `listing_url`, so nothing
// left a user's view and nothing entered the retention window on an unknown.
//
// The alert's own `action` field says "RESTORE every one the source still serves". Followed on these
// seven, that restores the retired duplicate, re-creates the double card migration 20260830140110
// repaired, and trips `mon_detect_res_com_collision_repair_regression()` — extended THAT SAME
// MORNING (20260913074036) to watch exactly these rows for exactly that. One detector's remedy was
// another's alarm condition.
//
// Why a false P1 is a real defect and not noise: AGENTS.md opens on nine dark detectors reading as a
// clean bill of health. A P1 that fires daily on correct, ledgered maintenance is that same failure
// from the other side — the one detector that states docs/ops/LISTING_LIVENESS.md §1 (UNKNOWN IS NOT
// DEAD) becomes the one nobody believes, and the day it is right about a real absence-kill it reads
// like the six days it was wrong.
//
// WHAT THIS BARRIER HOLDS. The exclusion must stay an AFFIRMATIVE RECORD, never an inference, and it
// must stay NARROW. Four keys and a time bound, all load-bearing:
//
//   platform + retired_side + that side's id  — the ledger row that performed THIS retirement
//   verdict = 'REPAIRABLE'                    — an adjudication, not a rejected candidate
//   adjudicated_at within 1h of deactivated_at — so August's dealapp/sadin adjudications can never
//                                                excuse a fresh absence-kill on the same id
//
// and the counts must exclude the dedup rows while `deactivated_48h` still counts every deactivation
// and `adjudicated_dedup_excluded` reports the excluded ones. Nothing is silently subtracted:
// docs/ops/LISTING_LIVENESS.md §7 forbids silencing a barrier to make it green and requires it to
// DISTINGUISH cases and prove both directions.
//
// HOW IT IS PROVEN, AND THE LIMIT — STATED, NOT HIDDEN. The implementation is plpgsql living in the
// database; a node process cannot execute it, so this half asserts the committed definition's
// structure and each assertion is mutation-proven by breaking the REAL file one condition at a time
// (the shape AGENTS.md credits in verify-no-unguarded-deleter.ts: every limb proven load-bearing
// individually, never as a group where one survivor hides four dead ones). It also proves it cannot
// be bypassed by a LATER `create or replace` that drops the exclusion.
//
// The BEHAVIOURAL proof was taken in production, both directions, on real rows, recorded here so the
// next reader does not have to trust an adjective:
//
//   before  amaall 6/6 adjudicated · arkaan 1/1 · aqaratikom 0/1 · satel 0/3   (old count: 6 1 1 3)
//   after   mon_detect_unknown_treated_as_dead() ⇒ alert_event 2719 (arkaan) and 2720 (amaall)
//           resolved_at 2026-09-13 14:45:50, while 1488 (mustqr), 2681 (aqaratikom) and 2682
//           (satel) stayed OPEN. The genuine absence-only kills are exactly as loud as they were.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const FN = 'mon_detect_unknown_treated_as_dead';

/** Every committed migration that (re)defines the detector, in APPLICATION order. */
function definitions(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((f) => new RegExp(`function\\s+public\\.${FN}\\s*\\(`).test(files[f]))
    .sort();
}

/**
 * The predicate under test. Reads the migration corpus exactly as production applied it and returns
 * one problem string per broken guarantee — so a mutation can be proven to break ONE of them.
 */
export function dedupExclusionProblems(files: Record<string, string>): string[] {
  const problems: string[] = [];
  const defs = definitions(files);
  if (defs.length === 0) {
    // Fails CLOSED: "the detector is not in the repo" must never read as "the detector is fine".
    return [`no committed migration defines public.${FN}() — cannot judge its exclusion`];
  }
  // The LAST definition is what production runs. An earlier correct one proves nothing.
  const latest = defs[defs.length - 1];
  const sql = files[latest];

  const need = (label: string, re: RegExp) => {
    if (!re.test(sql)) problems.push(`${latest}: ${label}`);
  };

  // ── The exclusion exists and is keyed on the ledger row that performed the retirement ──────────
  need('the detector never consults ops_res_com_collision_adjudication, so an adjudicated '
     + 'de-duplication is indistinguishable from a death on unknown evidence',
    /ops_res_com_collision_adjudication/);
  need('the exclusion does not key on the platform', /a\.platform\s*=\s*%2\$L/);
  need('the exclusion does not key on the retired side', /a\.retired_side\s*=\s*%3\$L/);
  need('the exclusion does not key on that side\'s own id', /a\.%4\$I\s*=\s*d\.id/);
  need('the exclusion accepts an adjudication that is not REPAIRABLE',
    /a\.verdict\s*=\s*'REPAIRABLE'/);

  // ── …and is bounded in time, so an old adjudication cannot excuse a fresh kill ─────────────────
  const window = /a\.adjudicated_at\s+between\s+d\.deactivated_at\s*-\s*interval\s*'1 hour'\s+and\s+d\.deactivated_at\s*\+\s*interval\s*'1 hour'/;
  need('the adjudication is not bounded to the hour around the deactivation — an adjudication from '
     + 'any date would excuse an absence-kill on the same id forever', window);

  // ── The side → id-column mapping is not swapped ────────────────────────────────────────────────
  // Both CASEs must branch on the SAME residential test and agree: a swap would look up a
  // residential retirement under com_id, find nothing, and re-count every repair as a kill.
  need('the retired side is not derived as residential/commercial from the table name',
    /then\s*'residential'\s*else\s*'commercial'\s*end\s*as\s*side/);
  need('the id column does not follow the side (residential→res_id, commercial→com_id)',
    /then\s*'res_id'\s*else\s*'com_id'\s*end\s*as\s*idcol/);

  // ── The counts exclude the dedup rows ─────────────────────────────────────────────────────────
  need('without_direct_evidence still counts adjudicated de-duplications',
    /count\(\*\)\s*filter\s*\(where\s+not\s+dedup\s+and\s+not\s+gone\)/);
  need('oracle_said_unknown still counts adjudicated de-duplications',
    /count\(\*\)\s*filter\s*\(where\s+not\s+dedup\s+and\s+unk\)/);

  // ── …while nothing is hidden from the operator ────────────────────────────────────────────────
  need('the excluded rows are not reported, so the subtraction is invisible',
    /'adjudicated_dedup_excluded',\s*v_dedup/);
  need('the payload does not explain why an excluded row must NOT be restored',
    /excluded_note/);

  return problems;
}

function load(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(MIGRATIONS)) {
    if (!f.endsWith('.sql')) continue;
    const body = readFileSync(join(MIGRATIONS, f), 'utf8');
    if (body.includes(FN)) out[f] = body;   // only the corpus this barrier judges
  }
  return out;
}

const files = load();
const real = dedupExclusionProblems(files);

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  ❌ ${msg}`); };

console.log(`verify-unknown-kill-excludes-adjudicated-dedup: ${Object.keys(files).length} `
  + `migration(s) mention ${FN}`);

if (real.length) {
  console.log('\nThe committed detector does not hold the exclusion contract:');
  for (const p of real) fail(p);
} else {
  console.log('  ✓ the committed detector excludes adjudicated de-duplications, narrowly and visibly');
}

// ── MUTATION PROOFS — break the REAL corpus one guarantee at a time ────────────────────────────
const latest = definitions(files).slice(-1)[0];

const mustCatch = (what: string, mutate: (sql: string) => string) => {
  const broken = { ...files, [latest]: mutate(files[latest]) };
  if (broken[latest] === files[latest]) {
    fail(`MUTATION NOT APPLIED (${what}) — the proof would pass without proving anything`);
    return;
  }
  const caught = dedupExclusionProblems(broken).length > real.length;
  if (caught) console.log(`  ✓ mutation caught: ${what}`);
  else fail(`MUTATION SURVIVED: ${what}`);
};

mustCatch('the ledger consulted not at all (the pre-fix detector)',
  (s) => s.replace(/ops_res_com_collision_adjudication/g, 'ops_some_other_table'));
mustCatch('the platform key dropped, so one platform\'s adjudication excuses another\'s kill',
  (s) => s.replace(/a\.platform\s*=\s*%2\$L/, 'true'));
mustCatch('the retired-side key dropped, so a repair on one side excuses a kill on the other',
  (s) => s.replace(/a\.retired_side\s*=\s*%3\$L/, 'true'));
mustCatch('the id key dropped, so any adjudication on the platform excuses every kill',
  (s) => s.replace(/a\.%4\$I\s*=\s*d\.id/, 'true'));
mustCatch('a rejected (non-REPAIRABLE) adjudication accepted as an excuse',
  (s) => s.replace(/a\.verdict\s*=\s*'REPAIRABLE'/, 'true'));
mustCatch('the time window widened, so an August adjudication excuses a kill today',
  (s) => s.replace(/d\.deactivated_at\s*-\s*interval '1 hour'/, "d.deactivated_at - interval '90 days'"));
mustCatch('the time window removed entirely',
  (s) => s.replace(/and a\.adjudicated_at between[\s\S]*?interval '1 hour'\n/, '\n'));
mustCatch('the side → id-column mapping swapped, so every repair is re-counted as a kill',
  (s) => s.replace(/then 'res_id' else 'com_id' end as idcol/, "then 'com_id' else 'res_id' end as idcol"));
mustCatch('the retired side no longer derived from the table name',
  (s) => s.replace(/then 'residential' else 'commercial' end as side/, "'residential' as side"));
mustCatch('without_direct_evidence counting the excluded rows again',
  (s) => s.replace(/filter \(where not dedup and not gone\)/, 'filter (where not gone)'));
mustCatch('oracle_said_unknown counting the excluded rows again',
  (s) => s.replace(/filter \(where not dedup and unk\)/, 'filter (where unk)'));
mustCatch('the excluded count hidden from the payload',
  (s) => s.replace(/'adjudicated_dedup_excluded',\s*v_dedup,/, ''));
mustCatch('the do-not-restore explanation dropped from the payload',
  (s) => s.replace(/excluded_note/g, 'note_about_nothing'));

// The bypass this barrier exists to survive: a LATER migration that redefines the function without
// the exclusion. Judging any definition but the last one would read that as clean.
{
  const later = '29991231000000_a_later_migration_redefines_it.sql';
  const stripped = `create or replace function public.${FN}() returns integer language plpgsql as $function$ begin return 0; end; $function$;`;
  const broken = { ...files, [later]: stripped };
  const caught = dedupExclusionProblems(broken).length > real.length;
  if (caught) console.log('  ✓ mutation caught: a later create-or-replace dropping the exclusion');
  else fail('MUTATION SURVIVED: a later create-or-replace dropping the exclusion');
}

// Fails CLOSED on an absent corpus — "no definition" is never "no problem".
{
  const caught = dedupExclusionProblems({}).length > 0;
  if (caught) console.log('  ✓ mutation caught: an empty corpus fails closed');
  else fail('MUTATION SURVIVED: an empty corpus read as clean');
}

// ── NEGATIVE CONTROL — a check that cannot pass is not a check ─────────────────────────────────
{
  const cosmetic = { ...files, [latest]: files[latest].replace(/^-- /gm, '--   ') };
  const still = dedupExclusionProblems(cosmetic).length;
  if (still === real.length) console.log('  ✓ negative control: a comment-only edit stays green');
  else fail(`NEGATIVE CONTROL FAILED: reformatting comments changed the verdict `
    + `(${real.length} → ${still})`);
}

if (failures) {
  console.log(`\n❌ verify-unknown-kill-excludes-adjudicated-dedup: ${failures} failure(s).`);
  process.exit(1);
}
console.log('\n✅ verify-unknown-kill-excludes-adjudicated-dedup: all checks passed.');
