// A LEDGER ROW IS AN INTENTION, NOT AN OUTCOME — and the detector that draws that line must keep
// being able to draw it.
//
// WHAT HAPPENED (2026-09-19, routine #11)
// ---------------------------------------
// ops_lifecycle_orphan_after_delete() opened with `ledger as (select ... from cleanup_deletion_log)`
// and every one of its six arms then asked "this row was deleted, so why is it still in <surface>?".
// Nothing checked whether the raw row was actually gone. DELETION_SAFETY.md has the ledger row
// written BEFORE the delete, so a ledger row proves only that a delete was INTENDED.
//
// Migration 20260919010944 deactivated six wasalt listings on real DIRECT evidence (headed
// Chromium, /ar and /en, HTTP 404 on both, probed twice, live control) and recorded that
// DEACTIVATION in the DELETION ledger — "matching the shape the cleanup path already writes".
// Nothing was deleted. The detector then reported the six as orphans of a delete that never
// happened, in a state it could never leave: the raw rows exist, so listing_native_location_v1
// legitimately holds them and purged_listings_archive legitimately does not. Two P2s (alert_event
// 3911, 3912) that no repair could clear.
//
// The detector's own action text already warned the reader —
//     "do NOT delete an orphan row whose raw listing is actually still present: that is a
//      different (and opposite) bug"
// — while the predicate never implemented the distinction it documented. Measured over the whole
// ledger: 1,792 rows, 1,786 genuine deletes (gathern 978, aqarcity 770 + 38, all gone), 6 false,
// every one of them those wasalt rows.
//
// WHY THIS IS A WIRING CHECK, AND WHERE THE EXECUTED PROOF ACTUALLY LIVES
// ----------------------------------------------------------------------
// AGENTS.md is emphatic that a barrier reading source as TEXT can pass for the entire time a defect
// is live, and this file is text over SQL — so it does NOT claim to prove the predicate behaves.
// That proof is EXECUTED, in the database, on the half-hourly roster sweep:
// mon_detect_deletion_log_without_delete() runs ops_lifecycle_ledger_rows_not_deleted() against an
// INJECTED input in both directions before it reports anything, and raises
// `lifecycle_ledger_predicate_blind` if either direction stops holding. Both directions were
// watched in production on 2026-09-19: the detector raised alert 4051 naming the six real rows at
// 14:42:04Z, and resolved it at 14:43:41Z once the false ledger rows were removed, while
// orphan_after_delete went from two permanently-stuck P2s to zero.
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

console.log('verify-deletion-ledger-is-not-proof-of-a-delete: the guard proves itself.');

// ── What does the repo CURRENTLY say each function is? The last migration to define it wins. ─────
// Reading only 20260919144142 would go green forever even if a later migration replaced the
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

const PRED = 'ops_lifecycle_ledger_rows_not_deleted';
const GEN = 'ops_lifecycle_orphan_after_delete';
const DET = 'mon_detect_deletion_log_without_delete';

// ── The rules, as a pure function so the mutations below execute the same judgement ─────────────
type Sources = { pred: string; gen: string; det: string };
type Verdict = { id: string; ok: boolean }[];

const judge = (s: Sources): Verdict => [
  // The predicate must accept an injected input and answer from it WITHOUT touching production.
  // Without that seam the detector cannot test the predicate without writing rows, and a self-test
  // that writes is not a self-test.
  { id: 'predicate-takes-an-injected-input', ok: /p_inject\s+jsonb/.test(s.pred) },
  { id: 'predicate-answers-the-injected-input-early', ok: /if p_inject is not null then/.test(s.pred) },
  // The REAL branch must actually ask whether the raw row survives. This join IS the fix: without
  // it the predicate cannot tell an intended delete from a completed one, which is the shipped bug.
  {
    id: 'predicate-checks-the-raw-row-still-exists',
    ok: /join public\.%I r on r\.id = d\.listing_id/.test(s.pred),
  },
  // …and it must refuse to guess about a table it cannot resolve, rather than defaulting either way.
  { id: 'predicate-skips-a-table-it-cannot-resolve', ok: /to_regclass\(/.test(s.pred) },
  // The generator must ASK. A predicate nothing calls is decoration, and the pre-fix behaviour —
  // every ledger row treated as a completed delete — returns the moment this call goes away.
  {
    id: 'generator-excludes-rows-that-were-never-deleted',
    ok: s.gen.includes('public.' + PRED + '()'),
  },
  // The detector must run the self-test in BOTH directions before reporting, and must have a way
  // to say so out loud. A predicate that always reports suppresses every genuine orphan; one that
  // never reports restores the bug AND makes this detector dark. Neither is visible in the text.
  {
    id: 'detector-tests-the-reporting-direction',
    ok: new RegExp(PRED + "\\(\\s*\\n?\\s*'\\[\\{").test(s.det),
  },
  {
    id: 'detector-tests-the-silent-direction',
    ok: new RegExp(PRED + "\\('\\[\\]'::jsonb\\)").test(s.det),
  },
  { id: 'detector-raises-when-blind', ok: /lifecycle_ledger_predicate_blind/.test(s.det) },
  // …and it must be able to lower it again. mon_raise() returns 0 when its dedup key is already
  // open, so a blind alarm nothing resolves would sit under every later all-zero sweep and make it
  // read as a clean bill of health — AGENTS.md's nine-dark-detectors failure, exactly.
  {
    id: 'detector-self-heals-the-blind-alarm',
    ok: /mon_resolve_key\('lifecycle_ledger_predicate_blind'/.test(s.det),
  },
  // …and it must still be able to report the real finding, or the fix has silenced the case rather
  // than renamed it. The whole point was to keep reporting it, under a name that can reach zero.
  {
    id: 'detector-still-raises-the-real-kind',
    ok: /'lifecycle_deletion_log_without_delete',/.test(s.det),
  },
  // The remedy must not invite the catastrophic reading: making the ledger true by destroying the
  // listings it wrongly claims were destroyed.
  {
    id: 'remedy-forbids-deleting-listings-to-make-the-ledger-true',
    ok: /Do NOT delete the raw listings to make the ledger true/.test(s.det),
  },
];

const found = { pred: latestDefinitionOf(PRED), gen: latestDefinitionOf(GEN), det: latestDefinitionOf(DET) };
for (const [name, f] of Object.entries(found)) {
  check(f !== null, 'the committed migrations define the ' + name,
    'no migration creates it — this barrier would otherwise pass vacuously');
}
if (!found.pred || !found.gen || !found.det) {
  console.log('\n❌ verify-deletion-ledger-is-not-proof-of-a-delete: nothing to check.');
  process.exit(1);
}

const live: Sources = { pred: found.pred.sql, gen: found.gen.sql, det: found.det.sql };
console.log('  ⓘ latest definitions: ' + found.pred.file + ' / ' + found.gen.file + ' / ' + found.det.file);

const verdict = judge(live);
for (const v of verdict) check(v.ok, v.id);
const HELD = verdict.length;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — each mutant is a real defect applied to the COMMITTED SQL and re-judged. The
// first two are the shipped defect itself, reintroduced two different ways.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, mutant: Sources) => {
  const held = judge(mutant).filter((v) => v.ok).length;
  check(held < HELD, '(mutation) catches ' + what,
    'MUTANT SURVIVED — every rule above still held with the defect present, so this barrier is ' +
    'asserting the bug rather than the rule');
};

// THE SHIPPED DEFECT, way 1: the predicate stops asking whether the raw row survived, so every
// ledger row reads as a completed delete and the six wasalt rows are orphans again.
mustCatch('the predicate no longer checking that the raw row is gone',
  { ...live, pred: live.pred.replace('join public.%I r on r.id = d.listing_id', '') });
// THE SHIPPED DEFECT, way 2: the predicate is intact but the generator stops consulting it. Same
// user-visible outcome, entirely different line — which is why one rule cannot cover both.
mustCatch('the generator no longer consulting the predicate',
  { ...live, gen: live.gen.split('public.' + PRED + '()').join('/* dropped */ (select null,null)') });
// The injected-input seam disappears, so the self-test can no longer run without writing rows.
mustCatch('the injected-input seam being removed from the predicate',
  { ...live, pred: live.pred.replace('if p_inject is not null then', 'if false then') });
// The self-test survives but loses a direction — an always-reporting predicate would then sail
// through while silently suppressing every genuine orphan.
mustCatch('the self-test losing its silent direction',
  { ...live, det: live.det.replace(PRED + "('[]'::jsonb)", PRED + '(null)') });
// The detector can no longer say it has gone blind.
mustCatch('the blind-detector alarm being removed',
  { ...live, det: live.det.split('lifecycle_ledger_predicate_blind').join('nothing_to_see') });
// The blind alarm can be raised but never lowered, so it latches on and every later sweep reads
// clean on top of it. This one was a real defect in the first cut of this detector, caught before
// merge and repaired by 20260919144721.
mustCatch('a blind alarm that can never be lowered',
  { ...live, det: live.det.split("mon_resolve_key('lifecycle_ledger_predicate_blind'").join('perform (null') });
// The narrowing becomes a silencing: rows are excluded from orphan_after_delete and then reported
// by nobody. That is the one outcome this whole change exists to avoid.
mustCatch('the real finding being silenced rather than renamed',
  { ...live, det: live.det.split("'lifecycle_deletion_log_without_delete',").join("'quiet',") });

console.log(
  failed === 0
    ? '\n✅ verify-deletion-ledger-is-not-proof-of-a-delete: ' + HELD + ' rules held, 7 mutants caught.'
    : '\n❌ verify-deletion-ledger-is-not-proof-of-a-delete: ' + failed + ' failure(s).',
);
process.exit(failed === 0 ? 0 : 1);
