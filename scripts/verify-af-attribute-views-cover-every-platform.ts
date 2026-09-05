// EVERY SEARCHABLE PLATFORM MUST APPEAR IN **BOTH** ADVANCED-FILTER ATTRIBUTE VIEWS.
// Auto-discovered barrier. Found 2026-09-05 while auditing AF coverage across all 38 platforms.
//
// THE GAP THIS PINS. awal was searchable with only HALF its Advanced Filter wiring: 51 rows in
// listing_extra_attrs and ZERO in listing_rich_attrs. It was the only platform in that state, and
// nothing could see it — searching for awal listings worked perfectly, because area / price /
// bedrooms / bathrooms travel through active_listing_ids_v2, not through these views.
//
// HOW IT HAPPENED, AND WHY IT WILL HAPPEN AGAIN WITHOUT THIS FILE. awal was UN-RETIRED, not
// onboarded. Its two tables were already union arms from before the 2026-07-28 retirement, so
// flipping platform_registry to 'active' made search work instantly — and that success hid the
// missing layer. listing_extra_attrs still carried an awal arm from before; listing_rich_attrs
// never did. A REVIVAL has a different shape from an ONBOARDING, and the difference is precisely
// the layer no one re-checks.
//
// WHAT THE GAP COSTS: listing_rich_attrs and listing_extra_attrs are the two views
// sync_all_rich_attrs reads to fill the AF columns of search_listings_ar. A platform missing from
// one of them can never contribute the fields that view carries (property_age, street_width_m,
// direction, majlis rooms, the installment mapping, the additional_info lat/long extraction), so
// its listings answer UNKNOWN to those AF questions instead of answering with what the source
// actually published. That is invisible from the search side — which is the whole problem.
//
// Both sides are read from PRODUCTION's live definitions, so this cannot be satisfied by editing a
// list in this repo. The view definitions are fetched ONCE and scanned in memory: the first
// attempt at this check lived in the migration and called pg_get_viewdef() once per platform,
// which hit the statement timeout on a 270KB definition and rolled the migration back.
import { resolvePublicSupabase } from './lib/public-supabase.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nEvery searchable platform appears in BOTH Advanced Filter attribute views\n');

const { url, key } = resolvePublicSupabase();
const rpc = async (fn: string, body: unknown) => {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const res = await rpc('ops_af_attribute_coverage', {});

if (res.status === 404) {
  check('ops_af_attribute_coverage exists in production', false,
    'HTTP 404 (PGRST202) — the coverage RPC has not shipped yet. Apply its migration; a check that ' +
    'cannot run must not report success.');
} else if (res.status !== 200) {
  check('the coverage RPC could be reached', false, `HTTP ${res.status} — fails CLOSED`);
} else {
  type Row = { platform: string; in_rich: boolean; in_extra: boolean; searchable_rows: number };
  const rows = (res.json as Row[]) ?? [];
  const gaps = rows.filter((r) => !r.in_rich || !r.in_extra);

  check('every searchable platform is in BOTH listing_rich_attrs and listing_extra_attrs',
    gaps.length === 0,
    gaps.length
      ? gaps.map((g) => `${g.platform} (${g.searchable_rows} rows) missing from ` +
          [!g.in_rich && 'listing_rich_attrs', !g.in_extra && 'listing_extra_attrs'].filter(Boolean).join(' + ')).join('; ')
      : '');

  // A coverage check that sees zero platforms would pass forever — the "barrier that supplies its
  // own input" failure. Prove the comparison is evaluating the real fleet.
  check('the coverage RPC is evaluating the real fleet (sanity: it still sees platforms)',
    rows.length >= 30, `saw ${rows.length} searchable platforms`);
}

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the same predicate, against broken coverage data\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
type Row = { platform: string; in_rich: boolean; in_extra: boolean; searchable_rows: number };
// THIS is the predicate the barrier runs, extracted so the mutants exercise the real thing.
const isClean = (rows: Row[]) => rows.filter((r) => !r.in_rich || !r.in_extra).length === 0;
const ok = (p: string): Row => ({ platform: p, in_rich: true, in_extra: true, searchable_rows: 10 });

// M-1: EXACTLY the awal shape — present in extra, absent from rich. The half-wired revival.
mustCatch('a platform in listing_extra_attrs but NOT listing_rich_attrs (the awal shape)',
  !isClean([ok('aqar'), { platform: 'awal', in_rich: false, in_extra: true, searchable_rows: 51 }]));
// M-2: the mirror image — an onboarding that wires rich and forgets extra.
mustCatch('a platform in listing_rich_attrs but NOT listing_extra_attrs',
  !isClean([ok('aqar'), { platform: 'newone', in_rich: true, in_extra: false, searchable_rows: 7 }]));
// M-3: missing from both — a fully un-wired platform that search still reaches via the union.
mustCatch('a platform missing from BOTH views',
  !isClean([{ platform: 'ghost', in_rich: false, in_extra: false, searchable_rows: 900 }]));
// M-4: a gap on a platform with FEW rows is still a gap — small platforms are exactly the ones
// that get half-wired and shrugged off.
mustCatch('a gap on a 6-row platform is still a gap',
  !isClean([{ platform: 'tiny', in_rich: false, in_extra: true, searchable_rows: 6 }]));
// M-5: and a genuinely clean fleet must NOT be reported as broken.
mustCatch('a fully-wired fleet is not reported as a failure', isClean([ok('a'), ok('b')]) === true);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ every searchable platform reaches the Advanced Filter through both attribute views.\n'
    : `\n❌ ${failed} check(s) failed — a searchable platform is half-wired to the Advanced Filter.\n`,
);
process.exit(failed === 0 ? 0 : 1);
