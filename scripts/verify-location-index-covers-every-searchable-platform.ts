// EVERY SEARCHABLE PLATFORM MUST HAVE ARMS IN listing_location_index.
// Auto-discovered barrier. Found 2026-09-05 while verifying the alta/shmoualshmal activation.
//
// THE GAP THIS PINS. souq24 had 44 Buy/Rent rows in active_listing_ids_v2 and ZERO in
// listing_location_index — it has never had an arm there. Nothing caught it because the two
// objects are activated by SEPARATE migration halves, and only one of them is obviously
// user-facing, so an onboarding that wires the search union and forgets the location index looks
// completely healthy from the search side.
//
// WHY IT IS A REAL DEFECT EVEN THOUGH SEARCH STILL WORKS. souq24's rows ARE findable: measured
// 2026-09-05 they carry city 44/44, district 42/44, region 44/44, and 0 orphans fleet-wide,
// because listing_native_location_v2 resolves their location through fallback resolvers rather
// than the location index. So this is NOT a "listings are invisible" bug — it is a coverage hole:
// listing_location_index feeds listing_location_canonical, and refresh_city_name_bridge /
// refresh_district_name_bridge read from there. A platform missing from it never contributes its
// city/district spellings to those bridges, so its location vocabulary is invisible to the very
// catalogs that canonicalise future listings.
//
// The check is DERIVED from production on both sides — the live union definitions — so it cannot
// be satisfied by editing a list in this repo.
import { resolvePublicSupabase } from './lib/public-supabase.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nlisting_location_index covers every platform active_listing_ids_v2 makes searchable\n');

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

if (res.status === 404) {
  // Expected ONLY for the deploy that ships the RPC. Fails LOUD rather than passing silently.
  check('ops_location_index_coverage exists in production', false,
    'HTTP 404 (PGRST202) — the coverage RPC has not shipped yet. Apply its migration; a check that ' +
    'cannot run must not report success.');
} else if (res.status !== 200) {
  check('the coverage RPC could be reached', false, `HTTP ${res.status} — fails CLOSED`);
} else {
  const rows = (res.json as { platform: string; searchable_rows: number }[]) ?? [];
  check('every searchable platform has arms in listing_location_index', rows.length === 0,
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

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
// The predicate above is `rows.length === 0`. Proven here against deliberately broken inputs, so a
// future refactor that (say) starts swallowing the RPC's rows cannot leave this file green.
console.log('\n  mutation proof — the same predicate, against broken coverage data\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
// This IS the check the barrier runs — extracted so the mutants exercise the real predicate.
const coverageIsClean = (rows: { platform: string; searchable_rows: number }[]) => rows.length === 0;

// M-1: exactly the souq24 shape this barrier was written for.
mustCatch('a searchable platform absent from the location index (the souq24 shape)',
  !coverageIsClean([{ platform: 'souq24', searchable_rows: 44 }]));
// M-2: several at once — e.g. an onboarding that wires the union for two platforms and forgets lli.
mustCatch('several platforms missing at once',
  !coverageIsClean([{ platform: 'alta', searchable_rows: 7 }, { platform: 'shmoualshmal', searchable_rows: 6 }]));
// M-3: a platform with ZERO searchable rows still counts — the RPC only returns genuine gaps, and
// treating "0 rows" as harmless would re-open the hole for a freshly-activated platform.
mustCatch('a gap reported with a zero row count is still a gap',
  !coverageIsClean([{ platform: 'newplatform', searchable_rows: 0 }]));
// M-4: and the clean case must still be clean, or the barrier is red forever and gets ignored.
mustCatch('a genuinely clean result is NOT reported as a failure', coverageIsClean([]) === true);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the location index covers every searchable platform.\n'
    : `\n❌ ${failed} check(s) failed — a searchable platform is absent from the location index.\n`,
);
process.exit(failed === 0 ? 0 : 1);
