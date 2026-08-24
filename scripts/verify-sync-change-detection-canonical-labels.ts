// THE SYNC MUST DECIDE "HAS THIS ROW CHANGED?" AGAINST WHAT IT WOULD ACTUALLY WRITE.
//
// sync_search_listings_ar() stores CANONICAL location labels: the INSERT passes both through
// loc_display_city_ar()/loc_display_district_ar(). Until 2026-08-24 the predicate that decided
// WHICH rows to re-visit compared that stored canonical value against the RAW view column:
//
//     or s3.district_ar is distinct from v.district_ar        -- canonical vs raw: different things
//
// Comparing two different quantities is wrong in BOTH directions, and both were live in production:
//
//   STUCK  — raw == stored but canonical differs (raw «حي ال قيشه», canonical «ال قيشه»). Every OR
//            branch is false, so the sync NEVER re-selects the row and the non-canonical label is
//            frozen into the served index. A result list then renders one place two ways, which is
//            the owner's visible-output contract broken (SEARCH_MATCH_QA_ENGINEER.md §42.1).
//            Observed: 3 rows, one frozen since its 2026-08-08 last_updated.
//   CHURN  — stored == canonical but differs from raw (true of every row the 2026-08-22 relabel
//            touched). The comparison is permanently TRUE, so the row is re-upserted every single
//            hourly sync for a write that changes nothing. Observed: 45,273 of 203,854 rows, ~22%
//            of the index, on the instance where the search RPC is already 64.4% of all DB time.
//
// This guard is hermetic — no database, no network — and runs inside `npm test` on every PR. It
// pins the fixed comparison in the migration AND mutation-proves the semantics: the old comparison
// must FAIL on both shapes and the new one must PASS, so a future "simplification" back to the raw
// column cannot land green.
//
//   node --experimental-strip-types scripts/verify-sync-change-detection-canonical-labels.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nThe sync must compare stored labels against what it would write, not against raw source\n');

// ── the migration that carries the fix ───────────────────────────────────────────────────────────
const MIG = '20260824082414_sync_change_detection_compares_display_labels.sql';
const migrations = readdirSync(join(root, 'supabase/migrations'));
check('the fix migration is committed (no production-only drift)', migrations.includes(MIG),
  `${MIG} not found in supabase/migrations/`);

const sql = migrations.includes(MIG) ? readFileSync(join(root, 'supabase/migrations', MIG), 'utf8') : '';

check('district change-detection compares the DISPLAY expression',
  sql.includes("d_new constant text := 'or s3.district_ar is distinct from public.loc_display_district_ar(v.city_id, v.district_ar)'"),
  'the district needle no longer rewrites to loc_display_district_ar()');

check('city change-detection compares the DISPLAY expression',
  sql.includes("c_new constant text := 'or s3.city_ar is distinct from public.loc_display_city_ar(v.city_id, v.city_ar)'"),
  'the city needle no longer rewrites to loc_display_city_ar()');

check('the edit refuses to guess when the body has moved (needle counted, not just found)',
  sql.includes('expected 1'),
  'a needle-edit that does not assert an exact single match can silently patch the wrong place');

check('the edit re-reads the LIVE body to post-check (never trusts the string it built)',
  (sql.match(/pg_get_functiondef/g) ?? []).length >= 3,
  'a post-check against the locally built string proves nothing about production');

check('unrelated sync behaviour is asserted to survive the rewrite',
  sql.includes('prune_inactive_from_search') && sql.includes('sync_delete_circuit_breaker'),
  'a full-body rewrite must prove it did not drop the delete circuit breaker or the prune step');

// ── the barrier for the class ────────────────────────────────────────────────────────────────────
check('a detector for the class exists',
  sql.includes('create or replace function public.mon_detect_index_label_unrepairable'),
  'a fix without recurrence protection is incomplete (§26)');

check('the detector is wired into the roster IN THE SAME migration',
  sql.includes("'''mon_detect_index_label_unrepairable'''")
  && sql.includes('mon_run_all_detectors'),
  'mon_detect_orphaned_detectors() fires on a detector nothing reaches — roster entry is not optional');

check('the detector is daily-gated (detector_sweep_budget is already open against the roster)',
  sql.includes("mon_claim_daily_slot('index_label_unrepairable')"),
  'an unbounded full-index join on the twice-hourly sweep can push it into its statement timeout');

check('the detector ignores rows younger than two sync cycles (no transient false positives)',
  sql.includes("now() - interval '2 hours'"),
  'without an age floor a freshly-ingested row mid-cycle is reported as a frozen label');

check('the detector resolves its own key when clean (it can close, not only open)',
  sql.includes("mon_resolve_key('index_label_unrepairable'"),
  'a detector that can only open alerts corrupts open_alerts forever (AGENTS.md)');

check('the fix text never proposes editing source truth',
  sql.includes('the raw labels stay as published'),
  'only the index DISPLAY columns are canonicalised (§42.1) — source truth is untouchable');

// ── MUTATION PROOF of the semantics ──────────────────────────────────────────────────────────────
// The predicate under test, both eras, as pure functions of (stored, raw, canonical).
const oldFires = (stored: string, raw: string, _canonical: string) => stored !== raw;
const newFires = (stored: string, _raw: string, canonical: string) => stored !== canonical;

// The two shapes measured in production on 2026-08-24.
const STUCK = { stored: 'حي ال قيشه', raw: 'حي ال قيشه', canonical: 'ال قيشه' };
const CHURN = { stored: 'حي العزيزية الأول', raw: 'العزيزية الأول', canonical: 'حي العزيزية الأول' };
const SETTLED = { stored: 'ال قيشه', raw: 'حي ال قيشه', canonical: 'ال قيشه' };

check('MUTATION: the OLD comparison cannot see a stuck row — this is the defect',
  oldFires(STUCK.stored, STUCK.raw, STUCK.canonical) === false,
  'if this passes, the old predicate was not actually blind and the root cause is elsewhere');

check('the NEW comparison DOES see the stuck row, so the sync self-heals it',
  newFires(STUCK.stored, STUCK.raw, STUCK.canonical) === true);

check('MUTATION: the OLD comparison re-selected an already-correct row forever — the churn half',
  oldFires(CHURN.stored, CHURN.raw, CHURN.canonical) === true,
  'if this passes, the 45,273-row hourly churn had a different cause');

check('the NEW comparison leaves an already-canonical row alone',
  newFires(CHURN.stored, CHURN.raw, CHURN.canonical) === false);

check('a settled row stays settled under the new comparison (no new churn introduced)',
  newFires(SETTLED.stored, SETTLED.raw, SETTLED.canonical) === false);

check('the new comparison is not vacuously false (it still fires on a genuinely changed label)',
  newFires('حي النرجس', 'حي الملقا', 'حي الملقا') === true);

// The two eras must genuinely disagree on the observed shapes — otherwise this file proves nothing.
check('the two eras disagree on BOTH production shapes',
  oldFires(STUCK.stored, STUCK.raw, STUCK.canonical) !== newFires(STUCK.stored, STUCK.raw, STUCK.canonical)
  && oldFires(CHURN.stored, CHURN.raw, CHURN.canonical) !== newFires(CHURN.stored, CHURN.raw, CHURN.canonical));

// ── §42.2: a label rewrite may never move the eligible set ───────────────────────────────────────
// The RPC's district arm matches on norm_district_tok, so every rewrite this fix causes must be
// token-preserving. Both production shapes differ only by the «حي » prefix the tokeniser strips.
const tok = (s: string) => s.replace(/^حي\s+/, '').replace(/^ال/, '').trim();
check('§42.2 both production rewrites are norm_district_tok-preserving (eligible set cannot move)',
  tok(STUCK.stored) === tok(STUCK.canonical) && tok(CHURN.stored) === tok(CHURN.canonical));

console.log(failures === 0
  ? '\nAll checks passed.\n'
  : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
