// Barrier: A DISPATCHER MUST NEVER REPORT SUCCESS WITHOUT DISPATCHING.
// ops_incident #74, routine-7 seam, 2026-09-05. Offline, deterministic, wired into `npm test`.
//
// WHAT WAS FOUND. public.trigger_gh_workflow(wf) is the only path from pg_cron to a
// workflow_dispatch-only GitHub workflow — 22 cron jobs (21 active) call nothing else, including
// both hourly safety backstops (alert-dispatch.yml, migration-drift-guard.yml). It read the PAT
// from vault.decrypted_secrets and, on a null read, raised a NOTICE and returned. A notice is not
// an error: the function returned void, pg_cron recorded status='succeeded', and no HTTP request
// was made. Every one of those workflows could stop running with cron reporting success across the
// board. Project memory dates that PAT's expiry to 2027-06-22, so this was a fuse, not a theory.
//
// WHY NO EXISTING DETECTOR COULD SEE IT. mon_detect_outbound_http_failures reads
// net._http_response, the right watcher for a PAT that is present but rejected (401), and
// mon_detect_cron_health limb 1 raises P1 on a failed cron run. The silent branch produced NEITHER:
// no HTTP row, because no request; no failed run, because it returned normally.
//
// THE FIX, and what this file keeps honest:
//   1. the missing-credential branch RAISES, so the cron run fails and mon_detect_cron_health sees
//      it. A BLANK secret counts as absent — it cannot authenticate either, and treating it as
//      present would buy the silence back one 401 at a time.
//   2. public.mon_gh_dispatch_faults(def, tok, jobs) — the predicate, pure and injectable, so it
//      can be EXECUTED against a mutated definition instead of only read (same split as
//      mon_orphaned_detectors vs mon_detect_orphaned_detectors).
//   3. public.mon_detect_gh_dispatch_silently_skipped() — P1 when there is no usable PAT while
//      dispatch jobs are active, and separately when the dispatcher's shape has regressed to
//      something that can return before it dispatches. Limb 2 is what makes limb 1 permanent in
//      PRODUCTION: a LATER migration re-introducing the early return is caught by the running
//      system, not only by this file.
//
// EACH OBJECT IS READ FROM THE MIGRATION THAT DEFINED IT LAST, never from a fixed filename. A
// barrier pinned to one file keeps asserting a superseded definition while production has moved on
// — the stale-mirror trap — and this fix already needed two migrations (20260906025001 corrected an
// array-append bug in the predicate that 20260906024816 shipped).
//
// MUTATION-PROVEN in production (2026-09-06, nothing left changed):
//   - the predicate executed against injected definitions:
//       pre-fix live definition + real token  -> {returns_before_dispatch, no_loud_failure}
//       post-fix definition + null / blank tok -> {credential_missing}
//       post-fix definition + real token       -> {}
//       dispatcher deleted                     -> {dispatcher_missing}
//       a definition whose only net.http_post and raise exception sit in a COMMENT -> still faulted
//       a `return;` AFTER the dispatch          -> {} (the check distinguishes, it does not blanket-ban)
//   - the credential branch EXTRACTED FROM THE LIVE DEFINITION and executed: null token raised
//     28000, blank token raised 28000, a present token did not raise
//   - the predicate replaced by a stub returning faults: the detector raised 2 P1s; restored
//     byte-identically, it returned 0 and self-resolved both dedup keys, 0 left open
//   - the array-append bug itself was FOUND this way, by a green offline read of correct-looking SQL
//
// MUTATION-PROVEN offline: every predicate below is re-applied to a deliberately broken input at
// the end of this file and watched to catch it.
//
//   node --experimental-strip-types scripts/verify-gh-dispatch-fails-loud.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { routineForKind } from './lib/alertRouting.ts';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

const DETECTOR = 'mon_detect_gh_dispatch_silently_skipped';
const PREDICATE = 'mon_gh_dispatch_faults';
const KIND = 'gh_dispatch_credential';
const FAULTS = ['returns_before_dispatch', 'no_loud_failure', 'no_dispatch_call',
                'dispatcher_missing', 'credential_missing'] as const;

// ── the predicates, named so the mutation proofs at the bottom can re-apply them ────────────────

/** Read EXECUTABLE sql only. These migrations' own headers quote the silent body they remove, and
 *  a check a comment can satisfy is not a check. Trailing comments included. */
const executable = (s: string) => s.replace(/--.*$/gm, '');

/** The needle must be derived from the body production actually had, not one somebody invented:
 *  an invented anchor lands on a body a concurrent session may already have changed. */
const anchorIsTheSilentBody = (s: string) =>
  /raise notice\s+'github PAT not in Vault yet; skipping %',\s*wf;/.test(s) && /\breturn\s*;/.test(s);

/** The whole fix: raise instead of returning, and leave no early exit behind. */
const failsLoudly = (s: string) => /\braise\s+exception\b/.test(s) && !/\breturn\s*;/.test(s);

/** An empty-string PAT authenticates nothing; treating it as present buys the silence back as 401s. */
const blankCountsAsAbsent = (s: string) => /btrim\(\s*tok\s*\)\s*=\s*''/.test(s);

/** Reads the LIVE definition and splices. A hand-pasted body discards concurrent edits — the
 *  failure mode that cost the detector roster its entries four separate times. */
const isNeedleEdit = (s: string) => /pg_get_functiondef/.test(s) && /execute\s+replace\(\s*v_def/.test(s);

/** A `return;` AFTER net.http_post is harmless; only one BEFORE it is the defect. A check that
 *  flagged any return at all would be relaxed the first time it cried wolf. */
const comparesPositions = (s: string) => /v_ret\s*>\s*0\s*and\s*v_ret\s*<\s*v_post/.test(s);

/** `v_faults := v_faults || 'x'` does NOT append to a text[]: with an untyped literal Postgres
 *  picks anyarray||anyarray and throws 22P02 on every fault path. Shipped and caught in production
 *  the same night (20260906025001). array_append() has exactly one meaning. */
const appendsUnambiguously = (s: string) =>
  /array_append\(\s*v_faults\s*,/.test(s) && !/v_faults\s*:=\s*v_faults\s*\|\|/.test(s);

const raisesP1 = (s: string, dedup: string) =>
  new RegExp(`mon_raise\\(\\s*'P1'\\s*,\\s*'${KIND}'[\\s\\S]{0,200}'${dedup}'`).test(s);

/** Without a resolve path the dedup key sticks open and mon_raise suppresses every future raise. */
const resolvesKey = (s: string, dedup: string) =>
  new RegExp(`mon_resolve_key\\(\\s*'${KIND}'\\s*,\\s*'${dedup}'\\s*\\)`).test(s);

/** The PAT itself must never reach an alert payload: alert_event rows are read by humans, filed to
 *  GitHub issues, and kept. */
const secretStaysOutOfPayloads = (s: string) =>
  !s.split('\n').some((l) => l.includes('v_tok') && /jsonb_build_object|to_jsonb|mon_raise/.test(l));

// ── resolve each object to the migration that defined it LAST ──────────────────────────────────

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const sources = new Map<string, string>();
const latestDefining = (what: RegExp): { file: string; raw: string; sql: string } | null => {
  for (const f of [...files].reverse()) {
    let raw = sources.get(f);
    if (raw === undefined) { raw = readFileSync(join(MIGRATIONS, f), 'utf8'); sources.set(f, raw); }
    if (what.test(raw)) return { file: f, raw, sql: executable(raw) };
  }
  return null;
};

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
}

console.log('\nA dispatcher must never report success without dispatching (ops_incident #74)\n');

const fixSrc = latestDefining(/do \$fix\$[\s\S]*?trigger_gh_workflow/);
const predSrc = latestDefining(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${PREDICATE}\\b`, 'i'));
const detSrc = latestDefining(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${DETECTOR}\\b`, 'i'));

check('the trigger_gh_workflow fix is mirrored into supabase/migrations/', fixSrc !== null,
  'the migration applied to production must exist in git, or nothing below reads the shipped fix');
check(`${PREDICATE}() is mirrored into supabase/migrations/`, predSrc !== null);
check(`${DETECTOR}() is mirrored into supabase/migrations/`, detSrc !== null);
if (!fixSrc || !predSrc || !detSrc) process.exit(1);
console.log(`      fix: ${fixSrc.file}\n      predicate: ${predSrc.file}\n      detector: ${detSrc.file}`);

// ── the fix ────────────────────────────────────────────────────────────────────────────────────
const fix = fixSrc.sql.slice(fixSrc.sql.indexOf('do $fix$'), fixSrc.sql.indexOf('end $fix$'));
const needles = [...fix.matchAll(/\$a\$([\s\S]*?)\$a\$/g)].map((m) => m[1]);
check('the fix block declares an anchor and a replacement', needles.length === 2,
  `found ${needles.length} dollar-quoted needles`);
const [anchor = '', replacement = ''] = needles;

check('the anchor is the SILENT body production actually had', anchorIsTheSilentBody(anchor),
  'an invented anchor proves nothing: the edit must be derived from the definition that shipped '
    + 'the bug, so it cannot land on a body someone else has already changed underneath it');
check('the replacement RAISES and leaves no early return', failsLoudly(replacement),
  'a raise is what turns the cron run red so mon_detect_cron_health limb 1 can see it; raise '
    + 'notice returns void and pg_cron records succeeded');
check('a BLANK secret counts as absent', blankCountsAsAbsent(replacement));
check('the fix is a needle-edit built from the LIVE definition', isNeedleEdit(fix));
check('the fix verifies that it actually took', /edit did not take/.test(fixSrc.sql),
  'an edit that cannot fail is an edit you cannot trust');

// ── the predicate ──────────────────────────────────────────────────────────────────────────────
check(
  `${PREDICATE}() is pure and injectable`,
  new RegExp(`function\\s+public\\.${PREDICATE}\\s*\\(\\s*p_def\\s+text\\s*,\\s*p_tok\\s+text\\s*,\\s*p_jobs\\s+integer`, 'i').test(predSrc.sql),
  'the predicate must take its inputs as arguments, or it can never be executed against a mutated '
    + 'definition and the barrier is only ever read, never proven',
);
for (const fault of FAULTS) check(`the predicate can report ${fault}`, predSrc.sql.includes(`'${fault}'`));
check('the predicate compares POSITIONS, not mere presence, of an early return',
  comparesPositions(predSrc.sql));
check('the predicate appends faults unambiguously (array_append, never ||)',
  appendsUnambiguously(predSrc.sql),
  'text[] || an untyped literal resolves to anyarray||anyarray and throws 22P02 on every fault '
    + 'path, so the predicate works only while it has nothing to report');
// Asserted against the RAW text on purpose: this line necessarily contains a `--` literal (it IS
// the comment-stripping pattern), so the stripped copy cannot carry it.
check('the predicate strips comments before judging the code path',
  /regexp_replace\(\s*v_code\s*,\s*'--/.test(predSrc.raw),
  'without this, a comment quoting net.http_post would satisfy the dispatch check');

// ── the detector ───────────────────────────────────────────────────────────────────────────────
check('the detector raises P1 on the credential gap', raisesP1(detSrc.sql, 'gh_dispatch_credential_missing'),
  'a detector that cannot raise is decoration (mon_detect_detector_cannot_raise watches for this)');
check('the detector raises P1 on a shape regression', raisesP1(detSrc.sql, 'gh_dispatch_silent_shape'),
  'this limb is the only thing that catches a LATER migration re-introducing the early return');
for (const key of ['gh_dispatch_credential_missing', 'gh_dispatch_silent_shape']) {
  check(`the detector resolves ${key} when healthy`, resolvesKey(detSrc.sql, key));
}
check('the detector reads the vault for presence only', secretStaysOutOfPayloads(detSrc.sql));
check('the detector is wired into the mon_run_all_detectors() roster in the SAME migration',
  detSrc.sql.includes('mon_run_all_detectors') && detSrc.sql.includes(DETECTOR),
  'a detector nothing reaches is decoration and would trip mon_detect_orphaned_detectors()');
check('the roster edit is a needle-edit built from the LIVE definition', isNeedleEdit(detSrc.sql));
check('the roster edit verifies that it actually took', /roster edit did not take/.test(detSrc.sql));

check(`${KIND} routes to routine 7 (systems seam)`, routineForKind(KIND) === 7,
  `routineForKind('${KIND}') returned ${routineForKind(KIND)}. An alert saying the cron→workflow `
    + 'seam is dead must reach the routine that owns that seam, not the #2 triage fallback.');

// ── mutation self-proof: each predicate above, re-applied to a deliberately broken input ────────

let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

mustCatch('the replacement raising a NOTICE instead of an exception',
  !failsLoudly(replacement.replace('raise exception', 'raise notice')));
mustCatch('the replacement keeping a bare early return',
  !failsLoudly(`${replacement}\n    return;`));
mustCatch('…while the real replacement still reads as loud (the predicate is not vacuous)',
  failsLoudly(replacement));
mustCatch('a blank PAT being treated as present',
  !blankCountsAsAbsent(replacement.replace(/or btrim\(tok\) = ''/, '')));
mustCatch('an INVENTED anchor that never matched production',
  !anchorIsTheSilentBody('  if tok is null then\n    return;\n  end if;'));
mustCatch('…while the real anchor still reads as the silent body', anchorIsTheSilentBody(anchor));
mustCatch('a hand-pasted body replacing the needle-edit',
  !isNeedleEdit(fix.replace(/pg_get_functiondef/g, 'prosrc_copied_by_hand')));
mustCatch('the predicate flagging ANY return instead of one before the dispatch',
  !comparesPositions(predSrc.sql.replace(/v_ret > 0 and v_ret < v_post/, 'v_ret > 0')));
mustCatch('the || array-append bug coming back',
  !appendsUnambiguously(predSrc.sql.replace(/array_append\(v_faults, ('[a-z_]+')\)/g, 'v_faults || $1')));
mustCatch('…while the shipped array_append form still reads as unambiguous',
  appendsUnambiguously(predSrc.sql));
mustCatch('the detector losing its mon_raise',
  !raisesP1(detSrc.sql.replace(/mon_raise/g, 'perform_nothing'), 'gh_dispatch_credential_missing'));
for (const key of ['gh_dispatch_credential_missing', 'gh_dispatch_silent_shape']) {
  mustCatch(`the detector losing its ${key} resolve path`,
    !resolvesKey(detSrc.sql.replace(new RegExp(`mon_resolve_key\\('${KIND}', '${key}'\\)`), 'null'), key));
}
mustCatch('the PAT being put into an alert payload',
  !secretStaysOutOfPayloads("      jsonb_build_object('tok', v_tok,"));
mustCatch('a comment that merely QUOTES the fix satisfying the checks',
  !failsLoudly(executable('-- raise exception when the PAT is missing\n    return;')));

if (mutFail) failures += mutFail;
console.log(
  failures === 0
    ? '\n✓ gh dispatch: a missing PAT fails loudly, and the silence cannot come back unseen\n'
    : `\n✗ ${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
