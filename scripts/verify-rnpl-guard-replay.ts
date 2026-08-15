// THE RNPL/MONTHLY GUARD MUST SURVIVE EVERY FUTURE MIGRATION.
//
// Owner, 2026-08-09:
//   "I do not want a future engineer to accidentally remove the RNPL protection because the
//    regression test is looking at an old function body."
//
// This is not hypothetical. It happened DURING this work: 20260809125830 added the payment_monthly /
// RNPL block to enforce_price_size_sanity(), and hours later an unrelated (and correct) change
// re-issued that whole function from an OLDER body to drop the sub-1000 Buy price gate — silently
// deleting the RNPL block with it. The repo replayed to md5 2957ce97… while production ran
// 2d104260…. Restored by 20260809160352. A checker that reads "the last CREATE OR REPLACE" cannot
// see that class of loss at all.
//
// So this file does not grep the newest migration. It REPLAYS the whole migration history — full
// definitions AND patcher migrations — via scripts/lib/rpcReplay.ts, and asserts the guard exists in
// the EFFECTIVE final body of every function that has to carry it. If the replayer meets a change to
// a tracked function it cannot interpret, it reports `unresolved` and this file FAILS rather than
// passing on a stale body: refusing to answer is safe, answering from the wrong body is not.
//
//   node --experimental-strip-types scripts/verify-rnpl-guard-replay.ts      (wired into `npm test`)

import { replayFunction, codeOnly, MIGRATIONS_DIR } from './lib/rpcReplay.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// The three READ paths that bucket شهري. Results and BOTH counts must agree, or the UI shows a
// count it cannot deliver.
const READERS = ['location_search_candidates_ar', 'apartment_guided_counts_ar', 'property_age_option_counts_ar'];

// ── WHERE THE GUARD LIVES CHANGED, 2026-08-10 ────────────────────────────────────────────────────
// The شهري bucket used to be `payment_monthly = true and not coalesce(s.rent_now_pay_later, false)`
// — the RNPL exclusion repeated at all three read sites. The period-routing rework
// (rent_period_filter_symmetric_no_unreachable_listings, rent_period_rnpl_rows_are_annual_not_
// unreachable, annual_bucket_absorbs_rnpl_only_not_unknown_period) consolidated it: the readers now
// say simply `p_rent_period = 'شهري' and s.payment_monthly = true`, and RNPL is excluded ONCE, at
// the WRITE layer, so payment_monthly can never be true for an RNPL row in the first place.
//
// That is a STRONGER design — one enforcement point instead of four that can drift apart — so this
// file follows the guard rather than pinning the old string. Asserting the retired read predicate
// would now fail on correct code, and a check that cries wolf gets muted, which is how the
// protection would really be lost.
//
// What is asserted instead:
//   • both WRITERS still carry `not coalesce(..., false)`   (below, via replay)
//   • the readers bucket شهري on payment_monthly ALONE, so write-side enforcement is sufficient
//   • the behavioural invariant — ZERO rnpl rows inside the monthly bucket — is asserted against
//     the LIVE database by scripts/verify-safety-barrier.ts, which is location-independent and
//     therefore survives any future relocation of the predicate.
const READER_MONTHLY_BUCKET = /p_rent_period\s*=\s*'شهري'\s*and\s*s\.payment_monthly\s*=\s*true/;

// The two WRITERS of payment_monthly. Both must carry the same predicate, or whichever runs last
// wins and silently inverts the other (exactly the 2026-08-09 trigger bug).
const WRITER_GUARD = /not\s+coalesce\(\s*(?:NEW\.|s\.)?rent_now_pay_later\s*,\s*false\s*\)/i;

console.log('\nRNPL/Monthly guard — asserted against the REPLAYED final state of each function\n');

// AUDITED EXCEPTIONS — named, dated, and justified. NOT a blanket mute: any migration NOT on this
// list that the replayer cannot interpret still fails the build. Each entry was read line by line and
// confirmed not to touch the RNPL/Monthly predicates. Remove an entry the moment its migration is
// superseded by an explicit definition.
const AUDITED_UNINTERPRETABLE = new Map<string, string>([
  ['20260810201309_wire_filter_audit_barriers_into_daily_detector_roster.sql',
   'audited 2026-08-10 (mine): wires five Filter-audit detectors into mon_run_all_detectors(). ' +
   'ZERO occurrences of payment_monthly and ZERO of rent_now_pay_later/rnpl/RNPL. Every function it ' +
   'creates is a mon_detect_* / mon_* monitor, and its single DO block re-executes exactly one ' +
   'function — mon_run_all_detectors — which is a detector roster, not a search RPC. Its two ' +
   'location_search_candidates_ar hits are CALLS inside the performance detector ' +
   '(`perform 1 from public.location_search_candidates_ar(...)`) that time the query; the RPC is ' +
   'read, never redefined, so no Monthly/RNPL predicate can be reached from this file.'],
  ['20260810201833_daily_gate_expensive_filter_detectors.sql',
   'audited 2026-08-10 (mine): same shape and same audit as the migration above — it re-emits those ' +
   'detectors wrapped in a ~20h gate (ops_detector_last_full_run) and adds ' +
   'mon_detect_stalled_daily_detector. ZERO payment_monthly, ZERO rent_now_pay_later/rnpl. Creates ' +
   'only mon_* functions plus one ops_* table; its DO block re-executes only mon_run_all_detectors. ' +
   'The two location_search_candidates_ar hits are again timing CALLS, not a redefinition.'],
  ['20260809113302_aqar_ppm_source_truth_repair_and_searchable_price_per_meter.sql',
   'audited 2026-08-09: price_per_meter only — 0 occurrences of beds/bedroom/غرف, and it needle-edits ' +
   'from the LIVE body so it preserves whatever predicates exist. Does not touch payment_monthly or ' +
   'rent_now_pay_later.'],
  ['20260809110618_fix_bedroom_mixed_exact_plus_5plus_or_predicate.sql',
   'audited 2026-08-10 (recovered from prod drift): bedrooms p_beds_exact/p_beds_min OR-predicate ' +
   'only — 0 occurrences of payment_monthly/rent_now_pay_later/rnpl/RNPL, and it needle-edits from ' +
   'the LIVE body (pg_get_functiondef at apply time) so it preserves whatever the RNPL/Monthly ' +
   'predicates were, unchanged.'],
  ['20260810145200_extend_readside_guard_to_count_rpcs.sql',
   'audited 2026-08-10 (Filter audit): extends the PR #409 read-side defense-in-depth guard ' +
   '(negative price/area, null deal, production_ready-without-location) from location_search_' +
   'candidates_ar to the two count RPCs — 0 occurrences of payment_monthly/rent_now_pay_later/rnpl/' +
   'RNPL anywhere in the file. It needle-edits from the LIVE body (pg_get_functiondef at apply time, ' +
   'anchor-count-guarded — aborts rather than rewriting blind if the anchor is not found exactly ' +
   'once), so it preserves whatever the RNPL/Monthly predicates were, unchanged. Self-proven live: ' +
   'both count RPCs returned the identical baseline (109581 for p_deal=\'بيع\') before and after.'],
  ['20260810125657_filter_rpc_readside_defense_in_depth.sql',
   'audited 2026-08-10 (read line by line): ZERO occurrences of payment_monthly and ZERO of ' +
   'rent_now_pay_later/rnpl. Adds the negative-price/negative-area/null-deal/production_ready-' +
   'without-location guard. Needle-edits from the LIVE body (pg_get_functiondef) and RAISEs rather ' +
   'than rewriting blind if the anchor is missing, so existing predicates survive verbatim.'],
  ['20260810190845_guided_counts_add_ac_and_private_entrance.sql',
   'audited 2026-08-10 (mine): adds cnt_ac + cnt_private_entrance to apartment_guided_counts_ar. ' +
   'ZERO occurrences of payment_monthly. Its two rent_now_pay_later hits are the inner projection ' +
   'list being WIDENED (`select s.rent_now_pay_later, ... , s.air_conditioner, s.private_entrance`) ' +
   '- the column is carried through unchanged, never re-predicated. DROP+CREATE (return type widens) ' +
   'built from the LIVE body, with a needle-count guard that RAISEs unless each anchor matches once. ' +
   'Verified live: cnt_ac 6,209 and cnt_private_entrance 2,575 both equal the results RPC exactly.'],
  ['20260810195452_location_predicate_indexable_scalar_array_form.sql',
   'audited 2026-08-10: ZERO occurrences of payment_monthly and ZERO of rent_now_pay_later/rnpl. ' +
   'Rewrites the location predicate from IN (SELECT) to = ANY(ARRAY(SELECT)) so it can use an index. ' +
   'Needle-edits from the LIVE body with three RAISE guards.'],
  ['20260810185359_buy_rows_must_not_carry_a_zero_annual_rent.sql',
   'audited 2026-08-10 CAREFULLY - this one DOES contain `payment_monthly := false`, twice. Both ' +
   'occurrences sit INSIDE the needle string and its replacement, which re-emits that line byte-for-' +
   'byte; the migration only APPENDS a Buy-side zero-price rule after it. It never writes ' +
   'payment_monthly := true and never touches the RNPL clause, so it cannot add a row to the monthly ' +
   'bucket. Behaviourally confirmed after the fact: 0 of 32,419 monthly rows carry rent_now_pay_later.'],
]);

// ── every tracked function must be fully interpretable ───────────────────────────────────────────
const TRACKED = [...READERS, 'sync_payment_monthly', 'enforce_price_size_sanity'];
const replayed = new Map(TRACKED.map((fn) => [fn, replayFunction(MIGRATIONS_DIR, fn)]));

for (const fn of TRACKED) {
  const r = replayed.get(fn)!;
  const novel = r.unresolved.filter((u) => ![...AUDITED_UNINTERPRETABLE.keys()].some((k) => u.startsWith(k)));
  check(`replay resolves ${fn} to a single effective body`,
    r.body !== null && novel.length === 0,
    r.body === null
      ? 'no CREATE OR REPLACE found in any migration'
      : `cannot interpret: ${novel.join('; ')} — teach scripts/lib/rpcReplay.ts this shape, or land an ` +
        'explicit CREATE OR REPLACE. Do NOT add it to AUDITED_UNINTERPRETABLE without reading it first.');
  for (const u of r.unresolved) {
    const hit = [...AUDITED_UNINTERPRETABLE.keys()].find((k) => u.startsWith(k));
    if (hit) console.log(`      (audited exception: ${hit} — ${AUDITED_UNINTERPRETABLE.get(hit)})`);
  }
}

// ── 1. READ layer: شهري is bucketed on payment_monthly ALONE ─────────────────────────────────────
// Since the routing rework the readers no longer repeat the RNPL exclusion; they delegate entirely
// to payment_monthly, which the write layer guarantees is never true for an RNPL row. So what has
// to be true here is that the bucket really is defined by payment_monthly — if a reader ever starts
// bucketing on something else (rent_period_ar, a platform name, a derived expression), write-side
// enforcement stops covering it and the RNPL exclusion is silently bypassed.
for (const fn of READERS) {
  const r = replayed.get(fn)!;
  if (!r.body) continue;
  const b = codeOnly(r.body);
  check(`READ  ${fn}: شهري bucket is defined by payment_monthly (write-side guard covers it)`,
    READER_MONTHLY_BUCKET.test(b),
    'the monthly bucket is no longer keyed on payment_monthly, so the write-layer RNPL exclusion no ' +
    'longer protects this reader — either restore the payment_monthly bucket or re-add the explicit ' +
    'read guard `and not coalesce(s.rent_now_pay_later, false)`');
}

// ── 2. WRITE layer: both writers carry the same predicate ────────────────────────────────────────
{
  const sweep = replayed.get('sync_payment_monthly')!;
  if (sweep.body) {
    const b = codeOnly(sweep.body);
    check('WRITE sync_payment_monthly: RNPL excluded from the row itself', WRITER_GUARD.test(b));
    check('WRITE sync_payment_monthly: no platform name decides the period',
      !/s\.platform\s+in\s*\(/i.test(b));
  }
  const trig = replayed.get('enforce_price_size_sanity')!;
  if (trig.body) {
    const b = codeOnly(trig.body);
    const touchesPm = /payment_monthly/i.test(b);
    // The trigger may legitimately not touch payment_monthly at all. What it must NEVER do is set it
    // true without consulting RNPL — that is the inversion that defeated the sweep.
    check('WRITE trigger never force-sets payment_monthly := true unconditionally',
      !/rent_period_ar\s*=\s*'شهري'\s*then\s*NEW\.payment_monthly\s*:=\s*true\s*;/i.test(b),
      'this exact line silently overrode sync_payment_monthly() on every write');
    check('WRITE trigger: if it sets payment_monthly at all, it honours RNPL',
      !touchesPm || WRITER_GUARD.test(b),
      'writer and trigger must carry ONE predicate or the last writer wins');
  }
}

// ── 3. counts and results must use the SAME predicate (no count you cannot deliver) ──────────────
{
  const bodies = READERS.map((fn) => replayed.get(fn)!.body).filter(Boolean) as string[];
  check('counts RPCs and the results RPC share one identical شهري predicate',
    bodies.length === READERS.length && bodies.every((b) => READER_MONTHLY_BUCKET.test(codeOnly(b))),
    'all three must bucket شهري the same way — a count the search cannot deliver is the exact defect ' +
    'this file exists to prevent');
}

// ── 4. the RNPL flag refresh must be fleet-wide, never a hardcoded platform list ─────────────────
{
  const r = replayFunction(MIGRATIONS_DIR, 'refresh_rnpl_flags');
  check('replay resolves refresh_rnpl_flags', r.body !== null && r.unresolved.length === 0,
    r.unresolved.join('; '));
  if (r.body) {
    const b = codeOnly(r.body);
    check('refresh_rnpl_flags names no platform tables (fleet-wide)',
      !/from public\.(aqar|alhoshan|wasalt|gathern|dealapp|sanadak|souq24|mustqr)_(residential|commercial)_listings/i.test(b),
      'a hardcoded list silently misses any NEW platform that starts publishing RNPL');
    check('refresh_rnpl_flags discovers source tables from the catalog',
      /information_schema\.columns/i.test(b) && /rent_now_pay_later/i.test(b));
  }
}

console.log(failures === 0
  ? '\n✓ RNPL guard present in the replayed final state of every reader and writer\n'
  : `\n✗ ${failures} check(s) FAILED — the RNPL/Monthly protection is not intact\n`);
process.exit(failures === 0 ? 0 : 1);
