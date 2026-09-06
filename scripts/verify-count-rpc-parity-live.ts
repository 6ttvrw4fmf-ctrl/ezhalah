// LIVE regression barrier (2026-08-10 filter audit): the two Advanced Filter COUNT RPCs
// (apartment_guided_counts_ar, property_age_option_counts_ar) must report the exact same base
// population as the real search RPC (location_search_candidates_ar) for the same filter params —
// per docs/ADVANCED_FILTER_DESIGN_CONTRACT.md §8: "count == search, always — same predicate at
// count and search time." A user must never see a count next to an option that the search itself
// cannot fulfil.
//
// BACKGROUND: all three RPCs share byte-identical base eligibility SQL (verified 2026-08-10), but
// location_search_candidates_ar alone had received the PR #409 read-side defense-in-depth hardening
// (blocks a production_ready row that carries a negative price/area, a null deal, or
// production_ready=true with no resolved location). Migration 20260810145200 extended that same
// guard to both count RPCs so all three can never drift apart again. This script proves it, live,
// through the same anon key real clients use (a privileged connection could mask RLS/permission
// differences — memory: verify-via-anon-key rule).
//
// NOT wired into `npm test` (CI has no network/DB). Run after any change to location_search_candidates_ar,
// apartment_guided_counts_ar, or property_age_option_counts_ar, and from the daily production audit:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
//     node --experimental-strip-types scripts/verify-count-rpc-parity-live.ts

// PACING (ops_incident #48, 2026-09-05). This check is scheduled `47 */6 * * *`, so one of its four
// daily runs always lands at 04:47–04:58 — inside the 01:00–06:00 UTC heavy scraper window AGENTS.md
// already names. On 2026-09-05 at 04:57 apartment_guided_counts_ar came back 500 / 57014 «canceling
// statement due to statement timeout», rpc() threw, and the whole workflow went red raising a P1 that
// read like a COUNT PARITY defect. It was not: re-measured at 08:42 outside the window, the same five
// scopes were fine (buy-unfiltered 2,540ms, rent-unfiltered 3,265ms, buy-الرياض 1,311ms, rent-annual-
// جدة 542ms, buy-شقة-300k-800k 907ms). The unfiltered AF count simply runs close enough to the limit
// that the nightly batch tips it over.
//
// The answer is NOT to move the schedule or raise a tolerance — that hides the window instead of
// measuring it. It is the mechanism the AF journeys already use (harness note 19): wait, bounded, for
// production to be inside its OWN envelope before measuring, and classify a non-arrival against that
// signal. A timeout while production was healthy is a real red. A timeout while it was degraded is
// NOT EXERCISED — which STILL FAILS the run, so this can never become a route to green; the only
// thing it changes is whether the failure says "the counts disagree" or "this run did not certify
// them, and here is the measured reason".
//
// The three RPCs also used to fire as one Promise.all — three concurrent heavy counts, against a
// measured concurrency knee of 3 (§40.1). They are sequential now, so the check stops contributing
// to the load it is trying to survive.
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { paceUntilHealthy, readSearchLoad, describeLoad, verdictForNonArrival, type SearchLoad } from './lib/afJourneyPacing.ts';
const { url: URL_BASE, key: KEY } = resolvePublicSupabase();
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Postgres «canceling statement due to statement timeout» surfaced through PostgREST. */
export const isStatementTimeout = (status: number, body: string): boolean => (
  status >= 500 && /"code"\s*:\s*"57014"|statement timeout/i.test(body)
);

class RpcTimeout extends Error {}

async function rpc(fn: string, args: Record<string, unknown>): Promise<any[]> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(args) });
  if (!res.ok) {
    const body = await res.text();
    if (isStatementTimeout(res.status, body)) throw new RpcTimeout(`${fn} timed out (57014)`);
    throw new Error(`${fn} ${res.status}: ${body}`);
  }
  return (await res.json()) as any[];
}

async function searchTotal(args: Record<string, unknown>): Promise<number> {
  const rows = await rpc('location_search_candidates_ar', { p_per_platform: 100000000, p_limit: 1, ...args });
  return rows.length ? Number(rows[0].total_count) : 0;
}

const BUY = 'بيع';
const RENT = 'إيجار';

let failed = 0;
let notExercised = 0;
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
};
/** A scope we could not measure. Counted separately, but it still fails the run. */
const skip = (label: string, why: string) => {
  notExercised++;
  console.log(`NOT EXERCISED  ${label}  (${why})`);
};

const SCOPES: { name: string; args: Record<string, unknown> }[] = [
  { name: 'buy, unfiltered', args: { p_deal: BUY } },
  { name: 'rent, unfiltered', args: { p_deal: RENT } },
  { name: 'buy · الرياض', args: { p_deal: BUY, p_cities: ['الرياض'] } },
  { name: 'rent annual · جدة', args: { p_deal: RENT, p_rent_period: 'سنوي', p_cities: ['جدة'] } },
  { name: 'buy · شقة · price 300k-800k', args: { p_deal: BUY, p_types: ['شقة'], p_price_min: 300000, p_price_max: 800000 } },
];

async function main() {
  const readLoad = () => readSearchLoad(URL_BASE, HEADERS);
  const load: SearchLoad = await paceUntilHealthy(readLoad, sleep, undefined, undefined, (s) => console.log(s));
  console.log(`Measuring against production: ${describeLoad(load)}${load.degraded ? ' — STILL DEGRADED after the pacing budget' : ''}\n`);

  for (const s of SCOPES) {
    // Sequential, not Promise.all: three concurrent unfiltered counts is the contention this check
    // was dying of, and it is load this check creates itself.
    try {
      const search = await searchTotal(s.args);
      const apt = await rpc('apartment_guided_counts_ar', s.args).then((r) => Number(r[0]?.cnt_total_base ?? 0));
      const age = await rpc('property_age_option_counts_ar', s.args).then((r) => Number(r[0]?.cnt_total ?? 0));
      check(`${s.name}: apartment_guided_counts_ar == search`, apt === search, `apt=${apt} search=${search}`);
      check(`${s.name}: property_age_option_counts_ar == search`, age === search, `age=${age} search=${search}`);
    } catch (e) {
      if (!(e instanceof RpcTimeout)) throw e;
      // The verdict is production's, not ours: read the load AT THE MOMENT OF THE TIMEOUT.
      const at = await readLoad();
      if (verdictForNonArrival(at) === 'red') {
        check(`${s.name}: count RPCs answered`, false,
          `${(e as Error).message} while production was HEALTHY — ${describeLoad(at)}. ` +
          `This is a real regression in the count RPC, not a load artefact.`);
      } else {
        skip(`${s.name}`, `${(e as Error).message}; ${describeLoad(at)} (degraded)`);
      }
    }
  }

  const clean = failed === 0 && notExercised === 0;
  console.log(clean
    ? '\n✓ count-RPC parity holds — apartment_guided_counts_ar and property_age_option_counts_ar match location_search_candidates_ar exactly on every scope'
    : failed > 0
      ? `\n✗ ${failed} count-RPC parity check(s) FAILED — a filter count would show a number search cannot fulfil` +
        (notExercised ? ` (and ${notExercised} scope(s) NOT EXERCISED)` : '')
      : `\n✗ ${notExercised} scope(s) NOT EXERCISED — production was degraded, so this run did NOT certify count parity. ` +
        `Not a pass: re-run outside the 01:00-06:00 UTC scraper window.`);
  process.exit(clean ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
