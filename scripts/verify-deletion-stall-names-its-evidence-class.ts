// A STALLED DELETION QUEUE MUST NAME THE EVIDENCE CLASS OF ITS OWN BACKLOG — and the classifier
// that names it must keep being able to tell the classes apart.
//
// WHAT HAPPENED (2026-09-27, routine-11-lifecycle)
// -----------------------------------------------
// mon_detect_deletion_clock_stalled fired for the first time ever (alert_event 6325, aqarcity: 331
// candidates, 0 deleted, anomaly breaker at 312) and told the reader, in two hardcoded string
// constants that nothing had measured:
//
//   why_it_matters: "the verification the deletion depends on is not happening, so nobody is
//                    learning whether those listings are alive or dead"
//   action:         "fix the VERIFICATION side: re-probe the candidates so the real live/dead
//                    split is known"
//
// For aqarcity both were FALSE. All 334 eligible rows carry a DIRECT GONE verdict from
// prune_unseen.verify_gone whose note is «هذا الإعلان منتهي» — the source's OWN expired banner, on
// the listing's own URL. Measured across all four delete-enabled platforms the same hour:
//
//   aqarcity    334 eligible, 334 latest-GONE   -> SOURCE_CONFIRMED_DEAD  (verifier DONE)
//   aqar     26,032 eligible,   6 latest-GONE   -> PARTIALLY_VERIFIED
//   gathern   1,686 eligible,   0 latest-GONE   -> UNVERIFIED             (verifier INCOMPLETE)
//   wasalt   12,540 eligible,   0 latest-GONE   -> UNVERIFIED
//
// Both cases are live in production, they need OPPOSITE responses, and the detector emitted
// identical text for them — LISTING_LIFECYCLE_ENGINEER.md §8.3's trap and §2.3's lesson 2 exactly:
// a detector right about the WHAT and wrong about the WHY, whose remedy field sends every responder
// down a path that cannot work. That is how a real breaker stops being trusted.
//
// WHERE THE EXECUTED PROOF LIVES, AND WHY THIS FILE IS A WIRING CHECK
// ------------------------------------------------------------------
// AGENTS.md is emphatic that a barrier reading source as TEXT can pass for the entire time a defect
// is live, and this file is text over SQL — so it does NOT claim to prove the classifier behaves.
// That proof is EXECUTED, in the database, on every half-hourly roster sweep:
// mon_detect_deletion_clock_stalled() runs ops_lifecycle_backlog_evidence_class() against an
// INJECTED census in FOUR directions before it reports anything, and raises
// `lifecycle_evidence_class_blind` if any of them stops holding.
//
// Both directions were watched in production on 2026-09-27: mutating the classifier so UNVERIFIED
// collapsed into SOURCE_CONFIRMED_DEAD (the most dangerous possible direction — it would tell every
// responder that a backlog started by crawl absence alone had been source-confirmed) made the
// detector return 1 with one open lifecycle_evidence_class_blind; restoring the byte-identical
// definition (md5 7bdd8b6a31d382833fe98ae279120e0a, verified equal before and after) returned it to
// 0 open and the real alert to evidence_class SOURCE_CONFIRMED_DEAD / backlog_latest_gone 334.
//
// So this file guards the one thing the database cannot guard about itself: that the self-test, the
// injected-census seam it needs, the four directions, and the detector's call to the classifier all
// still EXIST in the committed migrations. A self-test someone deletes is a self-test that never
// fails.
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

console.log('verify-deletion-stall-names-its-evidence-class: the guard proves itself.');

// ── What does the repo CURRENTLY say each function is? The last migration to define it wins. ─────
// Reading only 20260927150016 would go green forever even if a later migration replaced the
// classifier with one that has no injected seam at all.
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const latestDefinitionOf = (fn: string): { file: string; sql: string } | null => {
  let found: { file: string; sql: string } | null = null;
  for (const f of files) {
    const src = readFileSync(join(MIGRATIONS, f), 'utf8');
    const at = src.indexOf('function public.' + fn + '(');
    if (at < 0) continue;
    const end = src.indexOf('$fn$;', at);
    found = { file: f, sql: end < 0 ? src.slice(at) : src.slice(at, end + 5) };
  }
  return found;
};

const CLS = 'ops_lifecycle_backlog_evidence_class';
const DET = 'mon_detect_deletion_clock_stalled';

// ── The rules, as a pure function so the mutations below execute the same judgement ─────────────
type Sources = { cls: string; det: string };
type Verdict = { id: string; ok: boolean }[];

const before = (hay: string, a: string, b: string): boolean => {
  const ia = hay.indexOf(a);
  const ib = hay.indexOf(b);
  return ia >= 0 && ib >= 0 && ia < ib;
};

const judge = (s: Sources): Verdict => [
  // ── THE SEAM. Without an injected census the detector cannot test the classifier without
  // writing rows, and a self-test that writes is not a self-test.
  { id: 'classifier-takes-an-injected-census', ok: /p_inject\s+jsonb/.test(s.cls) },
  { id: 'classifier-answers-the-injected-census-early', ok: /if p_inject is not null then/.test(s.cls) },

  // ── THE MEASUREMENT. Both halves were got wrong by hand during this very investigation, which
  // is why each is a rule rather than a comment.
  // §4.1c: a source that relists a unit publishes the reversal, so an older GONE superseded by a
  // newer LIVE is not evidence of death. "A GONE exists" is the wrong question.
  {
    id: 'classifier-takes-the-LATEST-verdict-per-row',
    ok: /order by p\.probed_at desc/.test(s.cls) && /limit 1/.test(s.cls),
  },
  // ops_stale_inactivation_probe's identity columns are populated inconsistently per writer, and
  // the two joins disagree in OPPOSITE directions on the two platforms that matter most: aqarcity
  // matches 334/334 by ad_number and 0 by listing_id; aqar matches 6 by listing_id and 0 by
  // ad_number. Either arm alone under-counts evidence and mislabels an EVIDENCED backlog
  // UNVERIFIED, which is the mislabel this whole change exists to stop.
  { id: 'classifier-joins-on-listing_id', ok: /p\.listing_id = e\.id/.test(s.cls) },
  { id: 'classifier-joins-on-ad_number-too', ok: /p\.ad_number = e\.ad_number/.test(s.cls) },
  // A hardcoded 30/3 goes green the day someone changes a platform's thresholds.
  {
    id: 'classifier-reads-the-platforms-own-thresholds',
    ok: /pol\.min_missing_count/.test(s.cls) && /pol\.min_inactive_days/.test(s.cls),
  },
  // Tables by shape, never a list someone has to remember to extend when a platform is enabled.
  {
    id: 'classifier-discovers-its-tables-by-shape',
    ok: /information_schema\.columns/.test(s.cls) && /'deactivated_at'/.test(s.cls),
  },

  // ── THE CLASSES. Ordering inside the CASE is load-bearing, not stylistic.
  // A deletion-eligible row whose LATEST verdict is LIVE is a RESTORE candidate (§3.1's
  // DELETION_ELIGIBLE -> RESTORED). If CONTRADICTED were tested after SOURCE_CONFIRMED_DEAD it
  // could never win — but if it were tested after the (v_u + v_n) = 0 arm, the one row that must
  // never be deleted would hide inside a class whose action text says the verifier is done.
  {
    id: 'CONTRADICTED-outranks-SOURCE_CONFIRMED_DEAD',
    ok: before(s.cls, 'v_l > 0', '(v_u + v_n) = 0'),
  },
  { id: 'CONTRADICTED-is-reachable-on-any-live-row', ok: /when v_l > 0\s+then 'CONTRADICTED'/.test(s.cls) },
  { id: 'UNVERIFIED-requires-zero-gone', ok: /when v_g = 0\s+then 'UNVERIFIED'/.test(s.cls) },
  {
    id: 'SOURCE_CONFIRMED_DEAD-requires-no-unverified-remainder',
    ok: /when \(v_u \+ v_n\) = 0\s+then 'SOURCE_CONFIRMED_DEAD'/.test(s.cls),
  },

  // ── THE DETECTOR MUST ASK. A classifier nothing calls is decoration, and the shipped defect —
  // two hardcoded sentences asserting the verifier is broken — returns the moment this call goes.
  { id: 'detector-asks-the-classifier', ok: s.det.includes('public.' + CLS + '(r.platform)') },
  { id: 'detector-emits-the-measured-class', ok: /'evidence_class', ev\.evidence_class/.test(s.det) },
  {
    id: 'detector-emits-the-counts-behind-the-class',
    ok: /'backlog_latest_gone', ev\.latest_gone/.test(s.det)
      && /'backlog_latest_live', ev\.latest_live/.test(s.det)
      && /'backlog_no_verdict', ev\.no_verdict/.test(s.det),
  },

  // ── THE SELF-TEST, all four directions. A classifier that collapses to ONE answer is invisible
  // in the SQL. Always-UNVERIFIED restores the shipped defect; always-SOURCE_CONFIRMED_DEAD is far
  // worse, because it would tell every responder that an absence-only backlog was source-confirmed.
  { id: 'selftest-covers-the-all-gone-direction', ok: s.det.includes(`'["GONE","GONE"]'::jsonb`) },
  { id: 'selftest-covers-the-no-verdict-direction', ok: s.det.includes(`'[null,null]'::jsonb`) },
  { id: 'selftest-covers-the-mixed-direction', ok: s.det.includes(`'["GONE",null]'::jsonb`) },
  { id: 'selftest-covers-the-contradicted-direction', ok: s.det.includes(`'["GONE","LIVE"]'::jsonb`) },
  {
    id: 'selftest-asserts-each-expected-class',
    ok: /<> 'SOURCE_CONFIRMED_DEAD'/.test(s.det) && /<> 'UNVERIFIED'/.test(s.det)
      && /<> 'PARTIALLY_VERIFIED'/.test(s.det) && /<> 'CONTRADICTED'/.test(s.det),
  },
  { id: 'detector-raises-when-blind', ok: /lifecycle_evidence_class_blind/.test(s.det) },
  // …and it must run BEFORE anything is reported, or a blind classifier still publishes a class.
  {
    id: 'selftest-runs-before-any-alert-is-raised',
    ok: before(s.det, 'lifecycle_evidence_class_blind', `'deletion_clock_stalled', r.platform`),
  },
  // mon_raise() returns 0 on an already-open dedup key, so an alarm nothing lowers would sit under
  // every later all-zero sweep and make it read as a clean bill of health (AGENTS.md's nine dark
  // detectors). This was a real defect in the first cut of the ledger-predicate detector.
  {
    id: 'detector-self-heals-the-blind-alarm',
    ok: /mon_resolve_key\('lifecycle_evidence_class_blind'/.test(s.det),
  },
  // …and the enrichment must not have silenced the case it was meant to explain.
  { id: 'detector-still-raises-the-real-kind', ok: /'deletion_clock_stalled', r\.platform/.test(s.det) },
  { id: 'detector-still-resolves-stale-keys', ok: /mon_resolve_stale_keys\('deletion_clock_stalled'/.test(s.det) },

  // ── NO CLASS IS PERMISSION. This is the one rule whose absence would make the whole change
  // dangerous rather than merely useless: SOURCE_CONFIRMED_DEAD must not read as a licence to
  // drain. The refusal is a single constant emitted byte-identically in every branch, and it must
  // name drain_backlog explicitly, because that is the field a reader of this alert will reach for.
  { id: 'refusal-is-one-constant-not-a-per-branch-string', ok: /c_do_not\s+text\s*:=/.test(s.det) },
  { id: 'refusal-is-the-only-do_not-emitted', ok: /'do_not', c_do_not/.test(s.det) },
  { id: 'refusal-names-drain_backlog', ok: /setting drain_backlog/.test(s.det) },
  {
    id: 'refusal-applies-to-every-class-including-the-fully-evidenced-one',
    ok: /EVERY evidence class, SOURCE_CONFIRMED_DEAD included/.test(s.det),
  },
];

const found = { cls: latestDefinitionOf(CLS), det: latestDefinitionOf(DET) };
for (const [name, f] of Object.entries(found)) {
  check(f !== null, 'the committed migrations define the ' + name,
    'no migration creates it — this barrier would otherwise pass vacuously');
}
if (!found.cls || !found.det) {
  console.log('\n❌ verify-deletion-stall-names-its-evidence-class: nothing to check.');
  process.exit(1);
}

const live: Sources = { cls: found.cls.sql, det: found.det.sql };
console.log('  ⓘ latest definitions: ' + found.cls.file + ' / ' + found.det.file);

const verdict = judge(live);
for (const v of verdict) check(v.ok, v.id);
const HELD = verdict.length;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — each mutant is a real defect applied to the COMMITTED SQL and re-judged.
// ─────────────────────────────────────────────────────────────────────────────────────────────
let mutants = 0;
const mustCatch = (what: string, mutant: Sources) => {
  mutants++;
  const held = judge(mutant).filter((v) => v.ok).length;
  check(held < HELD, '(mutation) catches ' + what,
    'MUTANT SURVIVED — every rule above still held with the defect present, so this barrier is ' +
    'asserting the bug rather than the rule');
};

// THE SHIPPED DEFECT, way 1: the detector stops asking and goes back to asserting.
mustCatch('the detector no longer consulting the classifier',
  { ...live, det: live.det.split('public.' + CLS + '(r.platform)').join('/* dropped */ (select null)') });
// THE SHIPPED DEFECT, way 2: it still asks, but never publishes what it learned.
mustCatch('the measured class never reaching the payload',
  { ...live, det: live.det.replace("'evidence_class', ev.evidence_class", "'evidence_class', 'UNVERIFIED'") });

// THE MISLABEL. Either join arm alone under-counts evidence: dropping the ad_number arm turns
// aqarcity's 334/334 GONE into 0 and relabels a fully-evidenced backlog UNVERIFIED; dropping the
// listing_id arm does the same to aqar's 6. Two arms, two rules, two mutants.
mustCatch('the ad_number join arm being dropped (aqarcity 334 -> 0 evidence)',
  { ...live, cls: live.cls.replace('p.ad_number = e.ad_number', 'false') });
mustCatch('the listing_id join arm being dropped (aqar 6 -> 0 evidence)',
  { ...live, cls: live.cls.replace('p.listing_id = e.id', 'false') });

// §4.1c: without the ordering, a GONE that a newer LIVE has already superseded counts as death.
mustCatch('latest-verdict degrading to "a GONE exists somewhere"',
  { ...live, cls: live.cls.replace('order by p.probed_at desc', '') });

// THE DANGEROUS REORDER. CONTRADICTED tested after the fully-evidenced arm means a row the source
// says is ALIVE hides inside a class whose action text says the verifier is done.
mustCatch('CONTRADICTED being demoted below SOURCE_CONFIRMED_DEAD',
  {
    ...live,
    cls: live.cls
      .replace(/when v_l > 0\s+then 'CONTRADICTED'\n/, '')
      .replace(/when \(v_u \+ v_n\) = 0(\s+)then 'SOURCE_CONFIRMED_DEAD'/,
        "when (v_u + v_n) = 0$1then 'SOURCE_CONFIRMED_DEAD'\n      when v_l > 0 then 'CONTRADICTED'"),
  });

// THE MUTANT WATCHED IN PRODUCTION on 2026-09-27: UNVERIFIED collapses into SOURCE_CONFIRMED_DEAD.
mustCatch('UNVERIFIED collapsing into SOURCE_CONFIRMED_DEAD',
  { ...live, cls: live.cls.replace(/when v_g = 0(\s+)then 'UNVERIFIED'/, "when v_g = 0$1then 'SOURCE_CONFIRMED_DEAD'") });

// The thresholds stop being the platform's own, so the queue measured is not the queue the engine
// will act on.
mustCatch('the platform thresholds being hardcoded',
  { ...live, cls: live.cls.split('pol.min_missing_count').join('3').split('pol.min_inactive_days').join('30') });

// The injected seam disappears, so the self-test can no longer run without writing rows.
mustCatch('the injected-census seam being removed',
  { ...live, cls: live.cls.replace('if p_inject is not null then', 'if false then') });

// The self-test survives but loses a direction — a classifier stuck on one answer sails through.
mustCatch('the self-test losing its no-verdict direction',
  { ...live, det: live.det.split(`'[null,null]'::jsonb`).join(`'["GONE","GONE"]'::jsonb`) });
mustCatch('the self-test losing its contradicted direction',
  { ...live, det: live.det.split(`'["GONE","LIVE"]'::jsonb`).join(`'["GONE","GONE"]'::jsonb`) });
mustCatch('the self-test no longer asserting the expected classes',
  { ...live, det: live.det.split("<> 'CONTRADICTED'").join("<> ''") });

// The self-test runs, but after the alerts it is supposed to qualify.
mustCatch('the self-test being moved after the reporting loop',
  {
    ...live,
    det: live.det.split('lifecycle_evidence_class_blind').join('zzz_moved_to_the_end'),
  });

// The detector can no longer say it has gone blind, or can never lower the alarm again.
mustCatch('the blind-classifier alarm being removed',
  { ...live, det: live.det.split('lifecycle_evidence_class_blind').join('nothing_to_see') });
mustCatch('a blind alarm that can never be lowered',
  { ...live, det: live.det.split("mon_resolve_key('lifecycle_evidence_class_blind'").join('perform (null') });

// The enrichment silences the case instead of explaining it.
mustCatch('the real finding being silenced rather than explained',
  { ...live, det: live.det.split("'deletion_clock_stalled', r.platform").join("'quiet', r.platform") });
mustCatch('the stale-key resolve being dropped so the alert can never clear',
  { ...live, det: live.det.split("mon_resolve_stale_keys('deletion_clock_stalled'").join('perform (null') });

// ── THE ONE THAT MATTERS MOST. A class must never read as permission. If SOURCE_CONFIRMED_DEAD
// gets its own softer refusal, or the refusal stops naming drain_backlog, this change turns from
// "more information" into "an alert that invites a destructive act".
mustCatch('the refusal becoming a per-branch string instead of one constant',
  { ...live, det: live.det.replace(/c_do_not\s+text\s*:=/, 'c_unused text :=') });
mustCatch('the refusal no longer naming drain_backlog',
  { ...live, det: live.det.split('setting drain_backlog').join('setting nothing') });
mustCatch('the refusal exempting the fully-evidenced class',
  { ...live, det: live.det.split('EVERY evidence class, SOURCE_CONFIRMED_DEAD included').join('most classes') });

console.log(
  failed === 0
    ? '\n✅ verify-deletion-stall-names-its-evidence-class: ' + HELD + ' rules held, ' + mutants + ' mutants caught.'
    : '\n❌ verify-deletion-stall-names-its-evidence-class: ' + failed + ' failure(s).',
);
process.exit(failed === 0 ? 0 : 1);
