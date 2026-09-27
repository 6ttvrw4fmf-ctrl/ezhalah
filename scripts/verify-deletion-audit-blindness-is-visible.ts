// A PERMANENT DELETE NOTHING CONFIRMED MUST BE VISIBLE — and the detector that says so must keep
// being able to say it.
//
// WHAT WAS MEASURED (2026-09-23, routine #11)
// -------------------------------------------
// `scrapers/common/verify_deletions.py` re-probes a sample of already-deleted listings so a deleter
// whose oracle is systematically wrong gets caught. `mon_detect_deleted_but_source_live` escalates
// that to P0 — but ONLY on `verdict = 'live'`. A platform whose every audit sample comes back
// `unknown`, or that is never sampled at all, contributes ZERO rows to it, forever.
//
//   platform   deleted all-time   audit samples   readable   unknown
//   aqar               5,807              0            0         0     <- NEVER_AUDITED
//   wasalt             4,015             40            0        40     <- AUDIT_BLIND
//   gathern            1,936            160          160         0
//   aqarcity             811            160          160         0
//
// 9,822 of 12,569 permanent deletions (78%) carried no independent confirmation, and nothing said
// so. That is docs/ops/LISTING_LIVENESS.md §9 verbatim: **absence cannot be compared, so silence
// reads as health** — the same shape as wasalt's enumeration dying for seven days while its
// workflow reported success on every run.
//
// Where the audit CAN read, it earns its keep: gathern's 160 readable samples found 3 LIVE (~1.9%).
//
// WHY THIS IS A WIRING CHECK, AND WHERE THE EXECUTED PROOF LIVES
// --------------------------------------------------------------
// AGENTS.md is emphatic that a barrier reading source as TEXT can pass for the entire time a defect
// is live, and this file is text over SQL — so it does NOT claim to prove the predicate behaves.
// That proof is EXECUTED, in the database, on the half-hourly roster sweep:
// `mon_detect_deletion_audit_unconfirmed()` runs `ops_lifecycle_deletion_audit_unconfirmed()`
// against an INJECTED input in BOTH directions before it reports anything — a blind platform must
// yield exactly one row, a fully-readable one exactly zero — and raises
// `lifecycle_audit_predicate_blind` if either direction stops holding. Both directions were watched
// in production the day it landed: the detector raised P1s naming aqar (NEVER_AUDITED, 5,807) and
// wasalt (AUDIT_BLIND, 4,015) and left gathern and aqarcity alone.
//
// So this file guards the one thing the database cannot guard about itself: that the self-test, its
// injected-input seam, the roster entry, and the two shape arms all still EXIST in the committed
// migration. A self-test someone deletes is a self-test that never fails.
//
// This check is OFFLINE and hermetic: it reads committed SQL only and never touches production, so
// it belongs in the required suite (see AGENTS.md, "The required suite is HERMETIC").
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const PREDICATE = 'ops_lifecycle_deletion_audit_unconfirmed';
const DETECTOR = 'mon_detect_deletion_audit_unconfirmed';

/** Everything this barrier requires to still be true of the committed SQL. */
const clauses: Array<{ id: string; test: (sql: string) => boolean; why: string }> = [
  {
    id: 'predicate exists',
    test: s => new RegExp(`create or replace function public\\.${PREDICATE}`, 'i').test(s),
    why: 'the predicate that finds unconfirmed deletions is gone',
  },
  {
    id: 'injected-input seam',
    test: s => /p_inject jsonb default/i.test(s) && /jsonb_array_elements\(coalesce\(p_inject/i.test(s),
    why: 'without the p_inject seam the detector cannot self-test, and a predicate that cannot be '
       + 'exercised is a predicate nobody can prove still discriminates',
  },
  {
    id: 'both shape arms',
    test: s => s.includes("'AUDIT_BLIND'") && s.includes("'NEVER_AUDITED'"),
    why: 'the two shapes need different remedies — AUDIT_BLIND means the verifier cannot READ the '
       + 'source, NEVER_AUDITED means it never LOOKED — and collapsing them hides one of them',
  },
  {
    id: 'detector runs the self-test in BOTH directions',
    test: s => /__selftest_blind/.test(s) && /__selftest_ok/.test(s)
            && /v_pos <> 1 or v_neg <> 0/.test(s),
    why: 'the detector no longer proves, every sweep, that its predicate separates a blind audit '
       + 'from a readable one — so its silence would stop meaning anything',
  },
  {
    id: 'self-test failure is raised, not swallowed',
    test: s => s.includes('lifecycle_audit_predicate_blind'),
    why: 'a self-test whose failure raises nothing is a self-test that never fails',
  },
  {
    id: 'roster entry in the same migration',
    test: s => /mon_run_all_detectors/.test(s)
            && new RegExp(`'${DETECTOR}'`).test(s)
            && /roster anchor not matched/.test(s),
    why: 'a detector nothing calls is decoration (mon_detect_orphaned_detectors fires on one), and '
       + 'the anchor guard is what stops the insert failing silently — measured the day this '
       + 'landed: a concurrent session recreated mon_run_all_detectors and dropped the entry',
  },
  {
    id: 'NEVER_AUDITED distinguishes a LAG from a broken sampler',
    test: s => /verifier_last_word/.test(s) && /read_verifier_last_word_first/.test(s)
            && /scrape_runs/.test(s),
    why: 'NEVER_AUDITED has two causes needing opposite responses, and the alert must carry the '
       + "verifier's own last run notes so the responder classifies it instead of guessing. "
       + 'Measured 2026-09-24: aqar read as NEVER_AUDITED because its first deletion landed three '
       + 'hours AFTER that week\'s verifier run, not because anything was broken — the original '
       + 'action text said "find why it never samples this platform" and would have sent the next '
       + 'reader hunting a sampler bug that does not exist (§8.3: a remedy field that misdirects '
       + 'is worse than no remedy field)',
  },
  {
    id: 'the deleter is never throttled to clear the alert',
    test: s => /do NOT stop, slow or widen the sanctioned deleter/i.test(s)
            && /evidence about the VERIFIER/i.test(s),
    why: 'LISTING_LIVENESS.md §7 / DELETION_SAFETY.md §6: a gap in the verifier is evidence about '
       + 'the verifier, never permission to change a cap, a floor or the kill rate',
  },
  {
    id: 'it does not overclaim',
    test: s => /NOT a claim that live listings were destroyed/i.test(s),
    why: 'this detector reports a MISSING CONFIRMATION, not a false deletion. An alert that reads '
       + 'as "we destroyed live inventory" would get the deleter stopped for the wrong reason',
  },
];

const sqlFiles = readdirSync(MIGRATIONS)
  .filter(f => f.endsWith('.sql'))
  .map(f => readFileSync(join(MIGRATIONS, f), 'utf8'));

/** The committed migration(s) that define the predicate — concatenated, so a later migration may
 *  legitimately redefine it without this barrier pinning the original file. */
const committed = (override?: string): string =>
  override ?? sqlFiles.filter(s => s.includes(PREDICATE)).join('\n');

const check = (sql: string): string[] =>
  clauses.filter(c => !c.test(sql)).map(c => `${c.id}: ${c.why}`);

const problems: string[] = check(committed());
if (!committed().includes(PREDICATE)) {
  problems.length = 0;
  problems.push(
    `no committed migration defines public.${PREDICATE} — it exists in production or it does not, ` +
    'but either way the repo cannot see it, which is the migration-drift shape AGENTS.md exists to ' +
    'prevent');
}

// ── Mutations: break the committed SQL and watch each clause go red ──────────────────────────────
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) problems.push(`MUTATION NOT CAUGHT: ${label}`);
};
const real = committed();
const broke = (from: string | RegExp, to: string): boolean => {
  // replaceAll, deliberately: a clause that survives because ONE of several occurrences was left
  // behind is a mutation that proves nothing.
  const mutated = typeof from === 'string'
    ? real.split(from).join(to)
    : real.replace(new RegExp(from, from.flags.includes('g') ? from.flags : from.flags + 'g'), to);
  if (mutated === real) {
    problems.push(`mutation target vanished: ${String(from).slice(0, 60)}…`);
    return false;
  }
  return check(mutated).length > 0;
};

mustCatch('the self-test removed, so the predicate is never exercised',
  broke('__selftest_blind', '__disabled_blind'));
mustCatch('the self-test kept but its failure no longer raised',
  broke('lifecycle_audit_predicate_blind', 'nothing_at_all'));
mustCatch('the NEVER_AUDITED arm collapsed into AUDIT_BLIND, hiding a never-sampled platform',
  broke("'NEVER_AUDITED'", "'AUDIT_BLIND'"));
mustCatch('the p_inject seam removed, so nothing can inject a known-blind platform',
  broke(/jsonb_array_elements\(coalesce\(p_inject/, 'jsonb_array_elements((select 1)'));
mustCatch('the roster anchor guard removed, letting the insert fail silently',
  broke('roster anchor not matched', 'ok whatever'));
mustCatch('the verifier last-word field dropped, so a LAG reads as a broken sampler',
  broke('verifier_last_word', 'some_other_field'));
mustCatch('the do-not-throttle-the-deleter instruction dropped from the alert',
  broke('Do NOT stop, slow or widen the sanctioned deleter', 'Feel free to adjust the deleter'));

if (problems.length) {
  console.error('RED  verify-deletion-audit-blindness-is-visible\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(
  `PASS verify-deletion-audit-blindness-is-visible — ${clauses.length} clauses hold over the ` +
  'committed migration, 7 mutations caught; the behavioural proof runs in production on every ' +
  `roster sweep via ${DETECTOR}()'s two-direction self-test`);
