/**
 * A liveness job that STOPS RUNNING must raise an alarm — and the detector that says so must be
 * reachable, must stay rostered, and must keep the guards that make it trustworthy.
 *
 * THE RULE (owner, 2026-09-21; `docs/ops/LISTING_LIVENESS.md` §9):
 *
 *   source removes a listing → Ezhalah detects it → safely verifies it → deactivates it
 *   AND
 *   the checker or its scheduled job stops working → Ezhalah detects THAT failure too,
 *   instead of silently accumulating stale listings.
 *
 * WHY IT EXISTS, MEASURED. wasalt's enumeration was dead for SEVEN DAYS (2026-09-12 → 09-19) while
 * its workflow reported `conclusion: success` on every scheduled run — enumerating 96 rows instead
 * of ~105,000, because the enum step still used the transport wasalt.sa null-routed on 2026-08-17.
 * ~3,900 dead listings stayed active and clickable the whole time. Nothing alerted, and it was
 * eventually found by a human reading `scrape_runs` by hand.
 *
 * `mon_detect_silent_partial_success()` asks the right question — is this platform capturing far
 * fewer rows than it normally does — but its candidate set is RUNS THAT EXIST. A job that stops
 * producing runs entirely contributes no row, so there is nothing to compare and nothing fires.
 * **Absence cannot be compared.** `mon_detect_liveness_job_silent()` closes that by watching for
 * EXPECTED-BUT-ABSENT runs, measuring each job against its own observed cadence.
 *
 * WHAT THIS BARRIER IS, AND HONESTLY IS NOT. The detector's *behaviour* was proven in both
 * directions against real production data on the day it landed (an injected 5-days-silent job fired
 * at 5.0 overdue cycles while all 39 real job labels stayed quiet), and it is re-executed twice an
 * hour by `mon_run_all_detectors()`. That is the live half. THIS half is hermetic and structural:
 * it reads the COMMITTED migration and fails if the detector stops existing, stops being rostered,
 * or loses one of the guards that stop it crying wolf. Those are exactly the ways a detector rots
 * into decoration — `mon_detect_orphaned_detectors()` fires on one nothing reaches, and this fails
 * the PR before it can get that far.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const DETECTOR = 'mon_detect_liveness_job_silent';

let failures = 0;
function check(ok: boolean, name: string, detail = ''): void {
  if (ok) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
}

/** The committed migration that defines the detector — located by CONTENT, never by a pinned
 *  filename, so a later legitimate re-apply under a new timestamp is still checked. */
function detectorSql(): string {
  const hits = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .filter((s) => s.includes(`function public.${DETECTOR}(`));
  if (hits.length === 0) {
    console.error(`✗ no committed migration defines public.${DETECTOR}() — the owner rule of `
      + `2026-09-21 (LISTING_LIVENESS.md §9) has no enforcement left.`);
    process.exit(1);
  }
  return hits[hits.length - 1];
}

// ── The guards that make the detector trustworthy. Each carries WHY, because a future reader
//    removing one needs to know what it cost to learn. ────────────────────────────────────────────
type Guard = { name: string; present: (sql: string) => boolean; why: string };

const GUARDS: Guard[] = [
  {
    name: 'it is registered in the mon_run_all_detectors roster, in the same migration',
    present: (s) => s.includes('mon_run_all_detectors') && s.includes('fns text[] := array['),
    why: 'AGENTS.md: a detector outside the roster is decoration. Registering it in a LATER '
       + 'migration leaves a window where it exists and nothing reaches it.',
  },
  {
    name: 'the registration FAILS CLOSED if the roster anchor moves',
    present: (s) => /raise exception[^;]*roster anchor not found/i.test(s),
    why: 'A textual insertion that silently no-ops would leave the detector unrostered while the '
       + 'migration reports success — the precise "green but doing nothing" shape this whole rule '
       + 'exists to catch.',
  },
  {
    name: 'the migration ASSERTS both halves landed before it commits',
    present: (s) => /raise exception[^;]*did not land in the mon_run_all_detectors roster/i.test(s),
    why: 'Proving the outcome in the same transaction is what makes "it was applied" mean "it is '
       + 'wired", instead of something a human has to go and confirm afterwards.',
  },
  {
    name: 'cadence is measured between BATCHES, not between shards (gap floor of 1800s)',
    present: (s) => s.includes('batch_gap_s') && s.includes('1800')
                 && /filter \(where gap_s >= batch_gap_s\)/.test(s),
    why: 'THE SHARDED-JOB TRAP. A first version took the median of ALL inter-run gaps, which for '
       + 'wasalt_enum_shard is ~2 MINUTES — its 34 shards all start inside one batch — making a '
       + 'perfectly healthy job look 1,714x overdue. Removing this filter re-introduces a detector '
       + 'that cries wolf on every sharded job, which is how people learn to ignore it.',
  },
  {
    name: 'a job needs real history before it can be judged (min_batch_gaps)',
    present: (s) => /min_batch_gaps\s+constant int\s*:=\s*[1-9]/.test(s)
                 && s.includes('>= min_batch_gaps'),
    why: 'A newly-labelled job has no cadence yet. Judging it would fire on every new platform on '
       + 'its first day, which is the same cry-wolf failure from the other direction.',
  },
  {
    name: 'it is overdue by MULTIPLES of the job\'s own cadence, never a hardcoded age',
    present: (s) => /silence_factor\s+constant numeric/.test(s)
                 && s.includes('silence_factor * (median_gap_s'),
    why: 'A fixed threshold is wrong for both a 10-minute job and a weekly one. Each job is judged '
       + 'against itself, so no per-platform number has to be declared or remembered.',
  },
  {
    name: 'there is an absolute floor so a fast job cannot alert on a trivial delay',
    present: (s) => /floor_gap\s+constant interval/.test(s) && s.includes('greatest(silence_factor'),
    why: 'Without it a job that normally runs every 2 minutes alerts after 6 minutes.',
  },
  {
    name: 'the alert forbids draining the backlog it reports',
    present: (s) => /do_not/.test(s) && /UNKNOWN never/i.test(s),
    why: 'LISTING_LIVENESS.md §7 and §9.3: a checker that was not running leaves its listings '
       + 'UNKNOWN. The tempting response — widen a strike or lower a coverage floor to "catch up" — '
       + 'converts a monitoring outage into mass false deactivation. The alert must say so itself, '
       + 'because that is where the responder is actually looking.',
  },
  {
    name: 'it self-heals via mon_resolve_stale_keys instead of leaving a stuck alert',
    present: (s) => s.includes(`mon_resolve_stale_keys('liveness_job_silent'`),
    why: 'A permanently unclearable alert is how a detector teaches people to dismiss it '
       + '(LISTING_LIFECYCLE_ENGINEER.md §2.5a).',
  },
];

console.log('verify-liveness-job-silence-is-detected: a checker that stops must be an alarm.');
const sql = detectorSql();
for (const g of GUARDS) check(g.present(sql), g.name, g.why);

// ── MUTATION PROOFS. Every guard above is re-checked against a deliberately broken copy of the
//    REAL committed SQL — if a guard cannot fail, it is a comment that runs. ────────────────────
type Mutation = { name: string; break: (sql: string) => string };

const MUTATIONS: Mutation[] = [
  { name: 'roster registration removed (detector becomes decoration)',
    break: (s) => s.replace(/fns text\[\] := array\[/g, 'fns_removed[] := arr[') },
  { name: 'the fail-closed anchor check is softened to a notice',
    break: (s) => s.replace(/raise exception 'roster anchor not found[^']*'/,
                            "raise notice 'anchor missing'") },
  { name: 'the post-apply assertion is dropped',
    break: (s) => s.replace(/raise exception 'detector did not land in the mon_run_all_detectors roster'/,
                            "raise notice 'skipped'") },
  { name: 'the batch-gap filter is removed (the sharded-job trap returns)',
    break: (s) => s.replace(/filter \(where gap_s >= batch_gap_s\)/g, 'filter (where gap_s > 0)') },
  { name: 'min_batch_gaps lowered to zero (judges a job with no history)',
    break: (s) => s.replace(/min_batch_gaps\s+constant int\s*:=\s*\d+/, 'min_batch_gaps  constant int     := 0') },
  { name: 'the cadence-relative test is replaced by a hardcoded age',
    break: (s) => s.replace(/silence_factor \* \(median_gap_s[^)]*\)/, "interval '72 hours'") },
  { name: 'the absolute floor is removed',
    break: (s) => s.replace(/floor_gap\s+constant interval/, 'floor_gap_unused constant interval') },
  { name: 'the do-not-drain warning is stripped from the alert',
    break: (s) => s.replace(/UNKNOWN never/g, 'it is fine to') },
  { name: 'self-resolution removed (the alert can never clear)',
    break: (s) => s.replace(/mon_resolve_stale_keys\('liveness_job_silent'/, "mon_noop('x'") },
];

/** The proof: `caught` must be the REAL result of running this barrier's own guards over a
 *  deliberately broken copy of the committed SQL. Never a literal. */
function mustCatch(label: string, caught: boolean): void {
  check(caught, `(mutation) catches: ${label}`,
    'no guard went red against this break — the guard above asserts something weaker than it reads.');
}

console.log('  — mutations —');
for (const m of MUTATIONS) {
  const broken = m.break(sql);
  if (broken === sql) {
    failures++;
    console.error(`  ✗ (mutation) "${m.name}" changed NOTHING — the mutation itself is broken, so `
      + 'it proves nothing about the guard it is supposed to exercise.');
    continue;
  }
  mustCatch(m.name, GUARDS.some((g) => !g.present(broken)));
}

if (failures) {
  console.error(`\n❌ verify-liveness-job-silence-is-detected: ${failures} failure(s).`);
  process.exit(1);
}
console.log('\n✅ verify-liveness-job-silence-is-detected: a silent liveness job still raises, and '
  + 'the detector cannot quietly become decoration.');
