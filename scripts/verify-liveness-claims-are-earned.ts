// A PLATFORM MAY NOT BE REPRESENTED AS LIVENESS-PROVEN WITHOUT THE EVIDENCE THAT WORD REQUIRES.
//
// WHAT "PROVEN" MEANS HERE — derived, not invented. docs/ops/LISTING_LIVENESS.md §3 splits the two
// facts into two columns: `last_seen_at` means "a crawl encountered this row" and "says nothing
// about the source's opinion"; `last_verified_alive_at` means "the source affirmatively told us
// this listing is alive, on DIRECT evidence, at that moment". §4 grades the mechanism that can
// produce the second one into three tiers, and says of the weakest:
//
//     `CRAWL_PRESENCE_ONLY` is not an approved design. It is an honest label ... so monitoring can
//     *see* the gap instead of counting them as healthy. Rows there are reported as unverified,
//     never as verified-alive.
//
// verify-liveness-registry-mirror.ts §4 already enforces one direction of that, and states the
// principle this barrier completes: "a tier-1/tier-2 registry entry is a CLAIM, and the claim has
// to be cashed in code" — a platform registered DIRECT_REVISIT or CANDIDATE_PLUS_DIRECT must own a
// liveness module that calls direct_alive_patch()/verification_patch().
//
// THE HALF NOBODY WAS CHECKING. That barrier is offline and reads only `scrapers/**/*.py`. It
// therefore cannot see the opposite forgery, which needs no Python at all: a stamp appearing on a
// platform that has no mechanism to earn one. `last_verified_alive_at` is a plain nullable column
// on all 67 listing tables; one `update ... set last_verified_alive_at = now()` in a migration, a
// backfill or a console session would make ops_platform_liveness_coverage report a
// CRAWL_PRESENCE_ONLY platform at 100% verified — and every committed barrier would stay green,
// because not one of them reads production's verification state. LISTING_LIVENESS.md §3 already
// names this as the worse failure: a hand-set stamp "can stamp a row it never read, which is
// *worse* than the blind spot the column was added to remove: it puts a confident, recent-looking
// timestamp on inventory nobody checked."
//
// So: a CRAWL_PRESENCE_ONLY registration is a DISCLAIMER, and the disclaimer has to be cashed in
// the data. This barrier reads what production actually reports and fails if it is not.
//
// WHAT IT DOES NOT DO. It never asserts a platform is dead, unsearchable, or false. It fires only
// on a POSITIVE claim that outruns its evidence. Absence of verification is the expected, honest
// state for 31 of the 35 registered platforms and is never a failure here — UNKNOWN stays UNKNOWN.
//
// NO PLATFORM LIST. The set is derived from what production serves, for the reason migration
// 20260904151820 gives: "the previous barriers failed precisely because they enumerated instead of
// deriving." A platform registered tomorrow is graded the moment it appears.
//
// IF A PLATFORM EVER LEGITIMATELY EARNS A STAMP UNDER TIER 3: it cannot today —
// liveness_contract.presence_patch() exists but LivenessPolicy raises if absence_is_candidate_only
// is disabled, and no platform declares presence-as-evidence. Making one do so is a deliberate
// registry decision, and it should land together with the edit to this file. Do not loosen the
// check to make a red run green; that converts a visible gap into an invisible false claim, which
// is the exact move LISTING_LIVENESS.md §5.1 forbids.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/verify-liveness-claims-are-earned.ts

import { readFileSync } from 'node:fs';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

export type CoverageRow = {
  platform: string;
  strategy: string;
  active: number;
  verified_ever: number;
  verified_in_sla: number;
};
export type MirrorRow = { platform: string; strategy: string };

/** The tier that declares "nothing re-verifies these listings". */
export const UNVERIFIABLE_TIER = 'CRAWL_PRESENCE_ONLY';

/**
 * The whole decision, as a pure function so a mutation proof can execute THIS code against rows
 * from a rolled-back transaction rather than re-implementing the rule and testing its own copy.
 * Returns one message per violation; empty means every liveness claim in production is earned.
 */
export function judge(live: CoverageRow[], mirror: MirrorRow[]): string[] {
  const bad: string[] = [];

  // FAIL CLOSED. An empty read is "unjudgeable", never "clean" — the dark-detector shape this repo
  // has been burned by. The registry is the mirror's size; production must report every row of it.
  if (live.length === 0) {
    return ['ops_platform_liveness_coverage returned NO rows — every claim is unjudgeable, not clean'];
  }
  const declared = new Map(mirror.map((r) => [r.platform, r.strategy]));
  for (const [platform, strategy] of declared) {
    if (!live.some((r) => r.platform === platform)) {
      bad.push(
        `${platform} is registered ${strategy} in sql/mirrors/liveness_registry.json but production ` +
          'reports no coverage row for it — its liveness claim cannot be graded',
      );
    }
  }

  for (const r of live) {
    // 1. The tier production SERVES must be the tier the repo DECLARES. Without this, check 2 is
    //    bypassable by editing ops_liveness_registry directly: promote a platform to
    //    DIRECT_REVISIT in the table only, and its stamps stop being "impossible". The offline
    //    mirror barrier pins Python == JSON == migration, but nothing until now compared any of
    //    them to the row production actually reads.
    const want = declared.get(r.platform);
    if (want === undefined) {
      bad.push(
        `${r.platform} appears in production's liveness coverage but is in no committed registry ` +
          'mirror — an unreviewed platform is being graded against an unreviewed strategy',
      );
      continue;
    }
    if (want !== r.strategy) {
      bad.push(
        `${r.platform}: production serves strategy ${r.strategy}, the committed mirror declares ` +
          `${want}. A tier is a claim about what re-verifies this platform; production must not ` +
          'hold a claim no reviewed change ever made.',
      );
      continue;
    }

    // 2. A tier-3 platform must have earned nothing, because it has no mechanism that can earn.
    if (r.strategy !== UNVERIFIABLE_TIER) continue;
    if (r.verified_ever > 0 || r.verified_in_sla > 0) {
      bad.push(
        `${r.platform} is registered ${UNVERIFIABLE_TIER} — no per-listing revisit exists for it — ` +
          `yet production reports ${r.verified_ever} row(s) verified-alive ever and ` +
          `${r.verified_in_sla} inside SLA, over ${r.active} active. Nothing that platform runs can ` +
          'write last_verified_alive_at, so that verification was invented: either something set the ' +
          'column outside liveness_contract, or the platform gained a real oracle without its ' +
          'registration being updated in all three registry copies.',
      );
    }
  }
  return bad;
}

// ── MUTATION PROOFS. judge() was written as a pure function precisely so these could execute the
//    REAL rule rather than a re-implementation of it (see its doc comment). Each feeds it rows that
//    carry the forgery this barrier exists to catch, and asserts judge() reports it. They run on
//    import as well as as the entrypoint, so a caller cannot get the rule without its proof.
{
  const mustCatch = (what: string, wouldFail: boolean) => {
    if (!wouldFail) {
      console.error(`✗ MUTATION SURVIVED: ${what} would NOT be caught`);
      process.exit(1);
    }
  };
  const OK: MirrorRow[] = [{ platform: 'p1', strategy: UNVERIFIABLE_TIER }];
  const row = (o: Partial<CoverageRow> = {}): CoverageRow =>
    ({ platform: 'p1', strategy: UNVERIFIABLE_TIER, active: 100, verified_ever: 0, verified_in_sla: 0, ...o });

  mustCatch('a stamp on a CRAWL_PRESENCE_ONLY platform (the forgery this barrier exists for)',
    judge([row({ verified_ever: 7 })], OK).length > 0);
  mustCatch('a stamp that is inside SLA but never counted as ever-verified',
    judge([row({ verified_in_sla: 3 })], OK).length > 0);
  mustCatch('production serving a tier the committed mirror never declared',
    judge([row({ strategy: 'DIRECT_REVISIT' })], OK).length > 0);
  mustCatch('a platform graded in production that is in no committed mirror',
    judge([row(), row({ platform: 'ghost' })], OK).length > 0);
  mustCatch('a registered platform production reports no coverage row for',
    judge([row()], [...OK, { platform: 'missing', strategy: 'DIRECT_REVISIT' }]).length > 0);
  mustCatch('an EMPTY read being read as clean (the dark-detector shape)',
    judge([], OK).length > 0);
  // …and the rule is not vacuous: a genuinely honest tier-3 platform must pass.
  mustCatch('nothing — an honest CRAWL_PRESENCE_ONLY platform with zero stamps still passes',
    judge([row()], OK).length === 0);
}

// ── The live read. Only runs when this file is the entrypoint, so the mutation proof and any other
//    caller can import judge() without touching production. ────────────────────────────────────
if (import.meta.filename === process.argv[1]) {
  const { url, key } = resolvePublicSupabase();
  const res = await fetch(
    `${url}/rest/v1/ops_platform_liveness_coverage` +
      '?select=platform,strategy,active,verified_ever,verified_in_sla',
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) {
    console.error(`✗ could not read ops_platform_liveness_coverage: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const live = (await res.json()) as CoverageRow[];
  const mirror = JSON.parse(
    readFileSync(new URL('../sql/mirrors/liveness_registry.json', import.meta.url).pathname, 'utf8'),
  ) as MirrorRow[];

  const bad = judge(live, mirror);
  for (const b of bad) console.log(`  ❌ ${b}`);
  if (bad.length) {
    console.log(`\n✗ ${bad.length} liveness claim(s) in production are not earned.`);
    process.exit(1);
  }
  const tier3 = live.filter((r) => r.strategy === UNVERIFIABLE_TIER);
  const rows = tier3.reduce((n, r) => n + Number(r.active ?? 0), 0);
  console.log(
    `✓ Every liveness claim is earned — ${live.length} platforms graded against the committed ` +
      `mirror; ${tier3.length} registered ${UNVERIFIABLE_TIER} report 0 verified over ${rows} ` +
      'active rows, exactly as that tier promises.',
  );
}
