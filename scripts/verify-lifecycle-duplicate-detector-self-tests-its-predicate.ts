// A DECISION IS NOT A CONTRADICTION — and the detector that draws that line must prove it can
// still draw it, on every sweep, rather than being trusted.
//
// WHAT HAPPENED (2026-09-06, routine #11)
// ---------------------------------------
// mon_detect_lifecycle_duplicate_stale_copy() raises when one source URL exists in both a
// platform's residential and commercial table with exactly one copy active. Its remedy read
// "restore both if the source serves the page". On dealapp, ALL FIVE reported pairs turned out to
// be rows the 20260830140110 residential/commercial collision repair deliberately retired — every
// one recorded in ops_adjudicated_listing — and the shared URL is live at source. Following that
// advice would have RESTORED the retired copies: undoing a correct repair and putting a mis-typed
// duplicate back into search (two of them a محطة بنزين whose retired copy sat in the RESIDENTIAL
// table). Migration 20260906150549 excludes adjudicated dead copies, leaving the 13 genuine pairs
// across five other platforms untouched.
//
// WHY THIS BARRIER IS A WIRING CHECK, AND WHERE THE EXECUTED PROOF ACTUALLY LIVES
// ------------------------------------------------------------------------------
// AGENTS.md is emphatic that a barrier reading source as TEXT can pass for the entire time a defect
// is live, and this file is text over SQL — so it does NOT claim to prove the predicate behaves.
// That proof is EXECUTED, in the database, on the half-hourly roster sweep: the detector runs
// ops_lifecycle_dead_copy_is_a_contradiction() against an injected ledger in four directions before
// it reports anything, and raises `lifecycle_duplicate_detector_blind` if any direction stops
// holding. It was watched failing three different ways in production on 2026-09-06 (predicate
// always TRUE → "an ADJUDICATED dead copy was still reported"; always FALSE → the alert goes dark;
// ignoring which TABLE the ledger row names → "the exclusion is too wide") and green afterwards.
//
// The fourth of those was not a drill. A `create or replace` that was expected to roll back did not,
// so the table-blind mutant was briefly LIVE in production — and the self-test is what said so,
// while a reader of the SQL would have seen the committed text and concluded all was well.
//
// So this file guards the one thing the database cannot guard about itself: that the self-test, the
// injected-input seam it needs, and the generator's call to the predicate all still EXIST in the
// committed migrations. A self-test someone deletes is a self-test that never fails.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  const suffix = ok || !detail ? '' : ' — ' + detail;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + what + suffix);
  if (!ok) failed++;
};

console.log('verify-lifecycle-duplicate-detector-self-tests-its-predicate: the guard proves itself.');

// ── What does the repo CURRENTLY say each function is? The last migration to define it wins. ─────
// Reading only 20260906150549 would go green forever even if a later migration replaced the
// function with one that has no self-test at all.
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const latestDefinitionOf = (fn: string): { file: string; sql: string } | null => {
  let found: { file: string; sql: string } | null = null;
  for (const f of files) {
    const src = readFileSync(join(MIGRATIONS, f), 'utf8');
    const at = src.indexOf('function public.' + fn + '(');
    if (at < 0) continue;
    // The body runs to the dollar-quoted terminator that closes this definition.
    const end = src.indexOf('$;', at);
    found = { file: f, sql: end < 0 ? src.slice(at) : src.slice(at, end + 2) };
  }
  return found;
};

const PRED = 'ops_lifecycle_dead_copy_is_a_contradiction';
const GEN = 'ops_lifecycle_duplicate_stale_copy';
const DET = 'mon_detect_lifecycle_duplicate_stale_copy';

// ── The rules, as a pure function so the mutations below execute the same judgement ─────────────
type Sources = { pred: string; gen: string; det: string };
type Verdict = { id: string; ok: boolean }[];

const judge = (s: Sources): Verdict => [
  // The predicate must exist and must be able to take an injected ledger — without that seam the
  // detector cannot test it without writing rows, and a self-test that writes is not a self-test.
  { id: 'predicate-takes-an-injected-ledger', ok: /p_inject\s+jsonb/.test(s.pred) },
  // It must discriminate on BOTH parts of the identity. Dropping the table half is the exact mutant
  // that was briefly live in production: it silently widens the exclusion to any row with a
  // colliding id on ANY platform, which suppresses genuine contradictions.
  { id: 'predicate-matches-on-the-table', ok: /e->>'tbl'\s*=\s*p_dead_table/.test(s.pred) },
  { id: 'predicate-matches-on-the-id', ok: /listing_id'\)::bigint\s*=\s*p_dead_id/.test(s.pred) },
  // …and the real branch must read the adjudication ledger, keyed the same way.
  { id: 'predicate-reads-the-adjudication-ledger', ok: /ops_adjudicated_listing/.test(s.pred) },
  { id: 'predicate-real-branch-keys-on-the-table', ok: /a\.tbl\s*=\s*p_dead_table/.test(s.pred) },
  // The generator must ASK. A predicate nothing calls is decoration, and the pre-fix behaviour
  // returns the moment this call goes away.
  { id: 'generator-calls-the-predicate', ok: s.gen.includes('public.' + PRED + '(') },
  // The detector must run the self-test in BOTH directions before reporting, and must have a way
  // to say so out loud.
  { id: 'detector-tests-the-adjudicated-direction', ok: /ADJUDICATED dead copy/.test(s.det) },
  { id: 'detector-tests-the-unadjudicated-direction', ok: /UNADJUDICATED dead copy/.test(s.det) },
  { id: 'detector-tests-the-empty-ledger', ok: /EMPTY ledger/.test(s.det) },
  { id: 'detector-tests-the-wrong-table', ok: /DIFFERENT table/.test(s.det) },
  { id: 'detector-raises-when-blind', ok: /lifecycle_duplicate_detector_blind/.test(s.det) },
  // …and it must still be able to report the real finding, or the fix has silenced the alert
  // rather than narrowed it.
  { id: 'detector-still-raises-the-real-kind', ok: /'lifecycle_duplicate_stale_copy'/.test(s.det) },
  // The remedy text must not still tell a reader to blanket-restore, which is the advice that
  // would have undone the repair.
  { id: 'remedy-no-longer-says-restore-both', ok: !/restore both if it serves the page/.test(s.det) },
];

const found = { pred: latestDefinitionOf(PRED), gen: latestDefinitionOf(GEN), det: latestDefinitionOf(DET) };
for (const [name, f] of Object.entries(found)) {
  check(f !== null, 'the committed migrations define the ' + name,
    'no migration creates it — this barrier would otherwise pass vacuously');
}
if (!found.pred || !found.gen || !found.det) {
  console.log('\n❌ verify-lifecycle-duplicate-detector-self-tests-its-predicate: nothing to check.');
  process.exit(1);
}

const live: Sources = { pred: found.pred.sql, gen: found.gen.sql, det: found.det.sql };
console.log('  ⓘ latest definitions: ' + found.pred.file + ' / ' + found.gen.file + ' / ' + found.det.file);

const verdict = judge(live);
for (const v of verdict) check(v.ok, v.id);
const HELD = verdict.length;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — each mutant is a real defect applied to the COMMITTED SQL and re-judged. Three
// of them are the defects that were actually watched firing in production on 2026-09-06.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, mutant: Sources) => {
  const held = judge(mutant).filter((v) => v.ok).length;
  check(held < HELD, '(mutation) catches ' + what,
    'MUTANT SURVIVED — every rule above still held with the defect present, so this barrier is ' +
    'asserting the bug rather than the rule');
};

// The exclusion goes table-blind: any adjudicated id suppresses a pair on ANY platform. This one
// was briefly LIVE in production and only the in-database self-test noticed.
mustCatch('an exclusion that ignores WHICH table the ledger row names',
  { ...live, pred: live.pred.replace(/e->>'tbl'\s*=\s*p_dead_table\s*\n?\s*and /, '') });
// The generator stops asking — the pre-fix behaviour, restored silently.
mustCatch('the generator no longer consulting the predicate',
  { ...live, gen: live.gen.split('public.' + PRED + '(').join('true or false_(') });
// The injected-input seam disappears, so the self-test can no longer run without writing rows.
mustCatch('the injected-ledger seam being removed from the predicate',
  { ...live, pred: live.pred.replace(/p_inject\s+jsonb/, 'p_unused text') });
// The self-test loses a direction — the shape that lets a one-sided predicate pass.
mustCatch('the self-test dropping its UNADJUDICATED direction (the alert could go dark unnoticed)',
  { ...live, det: live.det.replace(/UNADJUDICATED dead copy/, 'something else entirely') });
mustCatch('the self-test dropping its ADJUDICATED direction (the exclusion could stop working)',
  { ...live, det: live.det.replace(/ADJUDICATED dead copy/g, 'something else entirely') });
// The detector can no longer say it is blind.
mustCatch('the detector losing its ability to report that it is blind',
  { ...live, det: live.det.split('lifecycle_duplicate_detector_blind').join('some_other_kind') });
// Narrowing turns into silencing: the real alert kind stops being raised at all.
mustCatch('the fix silencing the alert instead of narrowing it',
  { ...live, det: live.det.split("'lifecycle_duplicate_stale_copy'").join("'nothing'") });
// The harmful remedy comes back into the alert text.
mustCatch('the blanket-restore remedy returning to the alert',
  { ...live, det: live.det + "\n-- restore both if it serves the page\n" });
// And the control: a mutation that changes nothing relevant must NOT read as caught, or the
// judgement is simply always red and proves nothing.
const noop = { ...live, det: live.det + '\n-- an ordinary comment\n' };
check(judge(noop).filter((v) => v.ok).length === HELD,
  '(control) an irrelevant edit does NOT trip the judgement',
  'the rules go red on any change at all, so their red carries no information');

console.log(failed === 0
  ? '\n✅ verify-lifecycle-duplicate-detector-self-tests-its-predicate: the self-test cannot be quietly deleted.'
  : '\n❌ verify-lifecycle-duplicate-detector-self-tests-its-predicate: ' + failed + ' check(s) failed.');
process.exit(failed === 0 ? 0 : 1);
