// A later UNTRUSTED re-probe must not ERASE an earlier TRUSTED dead confirmation.
//
// WHY THIS EXISTS (ops_incident #188, 2026-09-11). mon_detect_served_despite_direct_404 is the ONLY
// P1 barrier watching whether source-confirmed-dead listings are still being served to users. v3
// required the SINGLE LATEST probe per listing to itself carry a trusted (ok=true, within 6h)
// anchor — so re-probing a listing during a legitimately-quarantined run (canary-block, or the
// aggregate alive-rate floor: both real anti-false-kill gates, ops_incident #180) silently dropped
// that listing from the alert the moment it was touched, even when an EARLIER trusted probe already
// confirmed the exact same 404/410 and nothing has said otherwise since. Measured live 2026-09-11:
// gathern went 8 days (09-03..09-11) with zero ok=true liveness runs; v3 reported 388 rows (only
// today's freshly-touched batch) where the true trusted-and-uncontradicted count was 1,244.
//
// THE FIX (v4, 20260911203303): split "is it still dead" from "was death ever proven". The LATEST
// probe at ANY trust level must still read 404/410 (so a 200, trusted or not, still clears a listing
// immediately — a blocked environment cannot manufacture a live page). Separately, SOME probe that
// specifically carries a trust anchor must ALSO have read 404/410. A later untrusted re-probe that
// still says dead can no longer erase that trusted evidence.
//
// This guard is hermetic — no database, no network — and pins the migration's SQL text: the v4 CTE
// split must exist, and the v3 shape it replaced (one CTE requiring trust and dead on the SAME row)
// must be gone. It does NOT touch, and does not need to touch, ops_incident #180's separate,
// owner-gated question of whether the SWEEP may strike/kill on a canary-passed-but-floor-failed run —
// this detector never writes to a listing, only raises a read-only alert.
//
//   node --experimental-strip-types scripts/verify-served-despite-404-trust-not-erased-by-later-untrusted.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

console.log('\nA later untrusted re-probe must not erase an earlier trusted dead confirmation\n');

// ── 1. the v4 migration is committed (no production-only drift) ───────────────────────────────────
const MIG = '20260911203303_served_despite_direct_404_v4_trust_is_not_erased_by_a_later_untrusted_agree.sql';
const migrations = readdirSync(join(root, 'supabase/migrations'));
check('the v4 fix migration is committed', migrations.includes(MIG), `${MIG} not found`);

const sql = migrations.includes(MIG) ? readFileSync(join(root, 'supabase/migrations', MIG), 'utf8') : '';

// ── 2. the fixed function really does decouple "latest" from "trusted" ─────────────────────────────
check('a separate CTE names the latest probe at ANY trust level',
  /latest_probe as \([\s\S]{0,200}?select distinct on \(src, listing_id\)/.test(sql),
  'latest_probe CTE not found in the shape the fix depends on');

check('a separate CTE names the latest TRUSTED-and-dead probe, independent of "latest"',
  /latest_trusted_dead as \([\s\S]{0,400}?select distinct on \(p\.src, p\.listing_id\)/.test(sql),
  'latest_trusted_dead CTE not found');

check('the trust-anchor condition (ok=true within 6h) still lives ONLY inside latest_trusted_dead — '
    + 'not re-attached to the latest-probe selection',
  (() => {
    const ltdIdx = sql.indexOf('latest_trusted_dead as (');
    const lpIdx = sql.indexOf('latest_probe as (');
    if (ltdIdx === -1 || lpIdx === -1) return false;
    const latestProbeBlock = sql.slice(lpIdx, ltdIdx);
    // latest_probe's own CTE body must NOT itself filter on trusted_runs — that was v3's bug.
    return !latestProbeBlock.includes('trusted_runs');
  })(),
  'the latest-probe CTE still references trusted_runs directly — the old single-row coupling survived');

check('the final predicate requires the LATEST probe to still read dead (resurrection still clears '
    + 'a listing instantly, from any trust level)',
  (() => {
    const iStatus = sql.indexOf('where lp.http_status in (404, 410)');
    const iActive = sql.indexOf('and lp.active', iStatus);
    const iSeen = sql.indexOf('and lp.last_seen_at <= lp.run_at', iActive);
    return iStatus !== -1 && iActive !== -1 && iSeen !== -1 && iStatus < iActive && iActive < iSeen;
  })(),
  'final selection no longer re-checks the latest probe status, in order — resurrection would go unguarded');

check('the two CTEs are joined by listing (src + listing_id), not merely unioned',
  /join latest_trusted_dead ltd on ltd\.src = lp\.src and ltd\.listing_id = lp\.listing_id/.test(sql),
  'latest_probe and latest_trusted_dead are not joined per listing — the split is decorative, not real');

// ── 3. the OLD (buggy) v3 shape — one CTE requiring trust+dead on the SAME latest row — is gone ────
check('v3\'s single coupled condition (exists(trusted_runs...) applied directly to the latest-DISTINCT-'
    + 'ON probe) no longer appears',
  !/order by src, listing_id, run_at desc\s*\)\s*select p\.src,[\s\S]*?exists \(\s*select 1 from trusted_runs/
    .test(sql),
  'the old v3 shape (trust required on the single latest row) is still present alongside the v4 fix');

// ── v5 (20260911203658) — the SECOND half of #188: the resolve limb may only clear a platform it
// could actually SEE. A platform with no ok=true liveness run in the last 48h was never re-raised
// (the raise loop had no trusted group for it) — that is silence, not a cleared condition, and
// mon_resolve must not run on it. Landed by a concurrent session while this PR was in flight;
// mirrored here in the same change per the migration-mirror rule.
const MIG_V5 = '20260911203658_served_despite_direct_404_v5_resolve_only_what_was_observed.sql';
check('the v5 resolve-observability migration is committed', migrations.includes(MIG_V5),
  `${MIG_V5} not found`);
const sqlV5 = migrations.includes(MIG_V5) ? readFileSync(join(root, 'supabase/migrations', MIG_V5), 'utf8') : '';

check('the resolve loop is gated on a recent (48h) trusted liveness run for that platform',
  /if exists \(select 1[\s\S]{0,200}?from public\.scrape_runs sr[\s\S]{0,200}?sr\.ok is true[\s\S]{0,100}?'48 hours'\)[\s\S]{0,100}?then\s*\n\s*perform public\.mon_resolve/
    .test(sqlV5),
  'resolve is not wrapped in an observability-window check before v5\'s naive unguarded resolve pattern');

check('v5 carries its own apply-time self-test asserting the gate on the LIVE compiled function body',
  sqlV5.includes("pg_get_functiondef('public.mon_detect_served_despite_direct_404()'::regprocedure)")
    && sqlV5.includes('v5 self-test: the resolve limb lost its observability gate')
    && sqlV5.includes('v5 self-test: the naive unguarded resolve loop is still present'),
  'the migration no longer self-verifies against the live function it just replaced');

// ── 4. MUTATION PROOF — this check must fail on the actual pre-fix (v3) function text ──────────────
const mustCatch = (label: string, checkPassesOnBrokenInput: boolean) => {
  check(`MUTATION ${label} — the check catches it`, checkPassesOnBrokenInput === false,
    'the check passed on a deliberately reverted (v3, pre-fix) shape, so it cannot catch a regression');
};

const V3_SHAPE = `
    ), probes(src, tok, listing_id, http_status, run_at, last_seen_at, active) as (
      select * from g  union all select * from wr union all select * from wc
      union all select * from ar union all select * from ac
      union all select * from dr union all select * from dc
    )
    select p.src,
           count(*) as cnt,
           min(p.run_at) as oldest_probe,
           max(p.run_at) as newest_probe
      from probes p
      join public.search_listings_ar s
        on s.source_table = p.src and s.listing_id = p.listing_id and s.production_ready
     where p.http_status in (404, 410)
       and p.active
       and p.last_seen_at <= p.run_at
       and exists (
             select 1 from trusted_runs tr
              where tr.tok = p.tok
                and tr.started_at <= p.run_at
                and tr.started_at >  p.run_at - interval '6 hours')
     group by p.src
`;
mustCatch('reverting to the v3 single-row-coupled shape',
  /latest_probe as \(\s*select distinct on \(src, listing_id\)/.test(V3_SHAPE));
mustCatch('reverting to the v3 shape (latest_trusted_dead absent)',
  /latest_trusted_dead as \(\s*select distinct on \(p\.src, p\.listing_id\)/.test(V3_SHAPE));

// v5's own gate check must fail against the naive pre-v5 resolve loop (byte-identical to what
// v3/v4 actually shipped: unconditional, no observability window).
const NAIVE_RESOLVE_LOOP = `
  if v_open is not null then
    foreach r.src in array v_open loop
      perform public.mon_resolve('served_despite_direct_404', r.src);
    end loop;
  end if;
`;
mustCatch('the pre-v5 unguarded resolve loop would pass the "gate is present" check',
  /if exists \(select 1[\s\S]{0,200}?from public\.scrape_runs sr[\s\S]{0,200}?sr\.ok is true[\s\S]{0,100}?'48 hours'\)[\s\S]{0,100}?then\s*\n\s*perform public\.mon_resolve/
    .test(NAIVE_RESOLVE_LOOP));

console.log(failed
  ? `\n✗ verify-served-despite-404-trust-not-erased-by-later-untrusted: ${failed} check(s) failed.\n`
  : '\n✅ verify-served-despite-404-trust-not-erased-by-later-untrusted: a real trusted-dead finding '
    + 'survives a later untrusted re-probe that still agrees.\n');
process.exit(failed ? 1 : 0);
