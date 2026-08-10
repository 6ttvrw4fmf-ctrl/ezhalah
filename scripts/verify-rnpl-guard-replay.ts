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
const READ_GUARD = 'payment_monthly = true and not coalesce(s.rent_now_pay_later, false)';

// The two WRITERS of payment_monthly. Both must carry the same predicate, or whichever runs last
// wins and silently inverts the other (exactly the 2026-08-09 trigger bug).
const WRITER_GUARD = /not\s+coalesce\(\s*(?:NEW\.|s\.)?rent_now_pay_later\s*,\s*false\s*\)/i;

console.log('\nRNPL/Monthly guard — asserted against the REPLAYED final state of each function\n');

// AUDITED EXCEPTIONS — named, dated, and justified. NOT a blanket mute: any migration NOT on this
// list that the replayer cannot interpret still fails the build. Each entry was read line by line and
// confirmed not to touch the RNPL/Monthly predicates. Remove an entry the moment its migration is
// superseded by an explicit definition.
const AUDITED_UNINTERPRETABLE = new Map<string, string>([
  ['20260809113302_aqar_ppm_source_truth_repair_and_searchable_price_per_meter.sql',
   'audited 2026-08-09: price_per_meter only — 0 occurrences of beds/bedroom/غرف, and it needle-edits ' +
   'from the LIVE body so it preserves whatever predicates exist. Does not touch payment_monthly or ' +
   'rent_now_pay_later.'],
  ['20260809110618_fix_bedroom_mixed_exact_plus_5plus_or_predicate.sql',
   'audited 2026-08-10 (recovered from prod drift): bedrooms p_beds_exact/p_beds_min OR-predicate ' +
   'only — 0 occurrences of payment_monthly/rent_now_pay_later/rnpl/RNPL, and it needle-edits from ' +
   'the LIVE body (pg_get_functiondef at apply time) so it preserves whatever the RNPL/Monthly ' +
   'predicates were, unchanged.'],
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

// ── 1. READ layer: the شهري bucket excludes RNPL in all three RPCs ───────────────────────────────
for (const fn of READERS) {
  const r = replayed.get(fn)!;
  if (!r.body) continue;
  check(`READ  ${fn}: شهري bucket excludes rent_now_pay_later`,
    codeOnly(r.body).includes(READ_GUARD),
    'a stale payment_monthly could otherwise surface an instalment listing under Monthly');
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
    bodies.length === READERS.length && bodies.every((b) => codeOnly(b).includes(READ_GUARD)));
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
