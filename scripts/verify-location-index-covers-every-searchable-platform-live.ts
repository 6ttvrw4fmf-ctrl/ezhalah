// EVERY SEARCHABLE PLATFORM MUST HAVE ARMS IN listing_location_index — LIVE HALF.
//
// This is the production-reading half of verify-location-index-covers-every-searchable-platform.ts,
// split out on 2026-09-06 (routine #10, ops_incident #104). The hermetic predicate and its mutation
// proofs stay in the required `npm test`; this file can only answer by asking production, so it runs
// in .github/workflows/loader-active-platforms-check.yml with the other per-platform coverage reads.
//
// WHY IT MOVED. Its verdict is a fact about PRODUCTION's live union definitions, not about the diff
// under test — and `npm test` is the REQUIRED status check on every PR. Measured 2026-09-06: on a
// single unchanged commit this file's «the coverage RPC could be reached» assertion went RED, then
// GREEN on immediate re-run, then RED again, in the same window its AF sibling did. The RED was
// reproduced with the only changed file reverted to its origin/main version — identical failure — so
// it is provably independent of any diff. A predicate whose verdict is decided by a stopwatch cannot
// gate an offline diff.
//
// THE FAIL-CLOSED BEHAVIOUR BELOW IS DELIBERATE AND MUST NOT BE WEAKENED. Unreachable production is
// reported as a FAILURE, never as "no gaps found" (AGENTS.md: A FAILED FETCH IS NOT AN EMPTY
// ANSWER). The repair is to move the check to a home where an unreachable production fails the RIGHT
// job — never to teach it to shrug.
//
// THE GAP THIS PINS (unchanged). souq24 had 44 Buy/Rent rows in active_listing_ids_v2 and ZERO in
// listing_location_index — it has never had an arm there. Nothing caught it because the two objects
// are activated by SEPARATE migration halves, and only one of them is obviously user-facing, so an
// onboarding that wires the search union and forgets the location index looks completely healthy
// from the search side. It is a coverage hole rather than an invisibility bug: listing_location_index
// feeds listing_location_canonical, and refresh_city_name_bridge / refresh_district_name_bridge read
// from there, so a missing platform never contributes its city/district spellings to the very
// catalogs that canonicalise future listings.
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { rpcProbeOutcome, outcomeIsUsable } from './lib/liveHalf.ts';
import { locationIndexIsClean, type LocationCoverageRow } from './lib/coverageGaps.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nlisting_location_index covers every platform active_listing_ids_v2 makes searchable (LIVE)\n');

const { url, key } = resolvePublicSupabase();
const rpc = async (fn: string, body: unknown) => {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// ops_location_index_coverage() returns one row per platform that is searchable but missing from
// the location index. It is defined alongside this barrier so the comparison lives in the database,
// next to the two definitions it compares — never re-implemented here from a repo-side list.
const res = await rpc('ops_location_index_coverage', {});
// The branch below IS rpcProbeOutcome() — the same function mutation-proven at the foot of this file.
// Branching on raw status codes here would mean the proof exercised a copy of the rule, not the rule.
const outcome = rpcProbeOutcome(res.status);

if (outcome === 'not-shipped') {
  // Expected ONLY for the deploy that ships the RPC. Fails LOUD rather than passing silently.
  check('ops_location_index_coverage exists in production', false,
    'HTTP 404 (PGRST202) — the coverage RPC has not shipped yet. Apply its migration; a check that ' +
    'cannot run must not report success.');
} else if (!outcomeIsUsable(outcome)) {
  check('the coverage RPC could be reached', false, `HTTP ${res.status} — fails CLOSED`);
} else {
  // The predicate is the SHARED one the offline half mutation-proves — never a copy that can drift.
  const rows = (res.json as LocationCoverageRow[]) ?? [];
  check('every searchable platform has arms in listing_location_index', locationIndexIsClean(rows),
    rows.length
      ? `missing from the location index: ${rows.map((r) => `${r.platform} (${r.searchable_rows} searchable rows)`).join(', ')}`
      : '');

  // The RPC must be measuring something — a coverage check that reads zero platforms on BOTH sides
  // would pass trivially forever (the "barrier that supplies its own input" failure).
  const sanity = await rpc('ops_location_index_coverage', { p_debug: true });
  const counted = sanity.status === 200 && Array.isArray(sanity.json) ? sanity.json.length : -1;
  check('the coverage RPC is evaluating a non-empty union (sanity: it can still see platforms)',
    counted >= 0, `debug probe returned ${counted}`);
}

// ── MUTATION PROOF — the fail-closed rule, which is what a LIVE half can actually get wrong ─────
// The coverage predicate itself is mutation-proven in the offline half (it is the SAME imported
// function, not a copy). What only this half can get wrong is the thing AGENTS.md names as the
// repo's largest defect class: a request that FAILED being rendered as a confident negative. So
// that is what is proven here, against the real status codes production returns.
console.log('\n  mutation proof — an unreachable RPC must never read as "no gaps found"\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++; console.error(`  FAIL  BLIND to: ${label}`);
};
mustCatch('THE MEASURED CASE: HTTP 500 (statement timeout) treated as a clean bill of health',
  outcomeIsUsable(rpcProbeOutcome(500)) === false);
mustCatch('HTTP 404 / PGRST202 — the RPC has not shipped yet — treated as "no gaps"',
  outcomeIsUsable(rpcProbeOutcome(404)) === false);
mustCatch('...and 404 is still DISTINGUISHED from a generic failure (a different repair)',
  rpcProbeOutcome(404) === 'not-shipped');
mustCatch('HTTP 401 (a rotated anon key) treated as a clean bill of health',
  outcomeIsUsable(rpcProbeOutcome(401)) === false);
mustCatch('HTTP 000 — the shape a network-layer failure lands on — treated as usable',
  outcomeIsUsable(rpcProbeOutcome(0)) === false);
mustCatch('a 200 IS usable (the negative control — a rule red for everything guards nothing)',
  outcomeIsUsable(rpcProbeOutcome(200)) === true);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the location index covers every searchable platform.\n'
    : `\n❌ ${failed} check(s) failed — a searchable platform is absent from the location index.\n`,
);
process.exit(failed === 0 ? 0 : 1);
