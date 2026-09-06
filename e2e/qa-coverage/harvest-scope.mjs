// THE SCOPE HARVESTER — refreshes `ops_qa_scope` from what production ACTUALLY sends.
//
// WHY THIS FILE EXISTS. `ops_qa_scope` is the registry three layers reason from:
//
//   • `mon_detect_search_scope_unreachable_inventory()` judges whether a source table is reachable
//     by any Normal Filter search at all — the "stored, indexed and invisible" P1.
//   • `ops_qa_cohort_catalog()` joins it to build the `p_tables` the daily RPC coverage layer
//     (`e2e/qa-coverage/run.mjs`) and the §3.1 narrowing probe send.
//   • `ops_qa_diff` reaches the same tables when it reimplements the matching predicate.
//
// It is a HARVEST of the real client's own request, never a hand-written list — §41.6 is explicit
// that guessing `p_tables` invents matching defects production does not have. The 2026-09-04
// hardening pass wrote the detector's freshness gate, the `ops_qa_record_scope` write path, and a
// one-off re-harvest migration, and documented all three as depending on THIS FILE — which was
// never written. The consequence arrived in seventeen hours: ألتا and شموع الشمال shipped
// (commit 3c5644b), the registry did not move, and the detector raised the exact false P1s the
// hardening existed to prevent, claiming 13 production-ready listings were invisible while every
// one of them was returned by a real anon search of the deployed bundle's own table scope.
//
// The freshness gate cannot cover for a harvester that does not run: it trips at three days, and
// platform drift produced false alerts at seventeen hours. The registry has to be REFRESHED, and
// this is the thing that refreshes it.
//
// HOW IT HARVESTS. One real production search per scope label, driven through the real UI with the
// same helpers the live sweep uses, reading `p_tables` out of the intercepted request body. Six
// labels, because six is what `ops_qa_cohort.scope` / `.scope2` / the `||'m'` monthly variant can
// name:
//
//   res  · resm   شقة, annual / monthly          — Residential-macro tables, ± the monthly-only pair
//   com           محل                            — Commercial-macro tables
//   s1   · s1m    أرض سكنية, annual / monthly     — the both-kind scope (reads BOTH table families)
//   s2            مكتب                            — the commercial scope + its dealapp residential overlay
//
// TWO SAFETY PROPERTIES, both deliberate:
//
//  1. A WRONG harvest is worse than a stale one — a mis-click that records «شقة»'s tables under
//     `com` would make the detector confidently wrong in both directions. So every capture is
//     ANCHOR-CHECKED against the request production actually sent (`p_category` and the anchor type
//     in `p_types`) before it is accepted, and a capture that fails its anchor is discarded.
//  2. A PARTIAL harvest is refused. `ops_qa_record_scope` already refuses an EMPTY table list
//     (an empty registry reads as "everything is reachable"); this refuses to write ANY label
//     unless all six were captured, so a half-failed run cannot leave the registry internally
//     inconsistent — one stale label among five fresh ones would let the oldest-label freshness
//     check pass while the stale label mis-judges every table it covers.
//
// Read-only against the app; the only write is the anon-granted `ops_qa_record_scope` RPC, exactly
// as the sweep records coverage. Zero source-platform traffic.
//
// Usage:  PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium node e2e/qa-coverage/harvest-scope.mjs

import { withPage, setDeal, setPeriod, pickCity, runSearch, tapByText, sleep } from '../live-sweep/sweep.mjs';

const SUPA = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY;

// A city that stocks every deal/period and every macro, so no plan is lost to a legitimate refusal
// («the city field's pool is deal+category scoped» — live-sweep/run.mjs). الرياض is the one city
// the sweep itself pins its pagination journeys to for exactly this reason.
const CITY = 'الرياض';

/**
 * The six labels, each with the real UI path that reaches it and the anchor that proves the search
 * production ran is the one we meant. `category` is the «سكني»/«تجاري» chip; `group` and `type` are
 * the Arabic subcategory-group and clean-type labels (src/i18n.tsx).
 */
const PLANS = [
  { scope: 'res',  category: 'سكني',  group: 'الشقق والسكن المشترك', type: 'شقة',
    deal: 'إيجار', period: 'سنوي', macro: 'Residential', anchor: 'شقة' },
  { scope: 'resm', category: 'سكني',  group: 'الشقق والسكن المشترك', type: 'شقة',
    deal: 'إيجار', period: 'شهري', macro: 'Residential', anchor: 'شقة' },
  { scope: 'com',  category: 'تجاري', group: 'التجزئة والمكاتب',      type: 'محل',
    deal: 'إيجار', period: 'سنوي', macro: 'Commercial',  anchor: 'محل' },
  { scope: 's1',   category: 'سكني',  group: 'الأراضي السكنية',       type: null,
    deal: 'إيجار', period: 'سنوي', macro: 'Residential', anchor: 'أرض سكنية' },
  { scope: 's1m',  category: 'سكني',  group: 'الأراضي السكنية',       type: null,
    deal: 'إيجار', period: 'شهري', macro: 'Residential', anchor: 'أرض سكنية' },
  { scope: 's2',   category: 'تجاري', group: 'التجزئة والمكاتب',      type: 'مكتب',
    deal: 'إيجار', period: 'سنوي', macro: 'Commercial',  anchor: 'مكتب' },
];

/** §41.5 — only a `p_limit > 1` request is a result search; the حي option probes reuse this RPC at 1. */
const resultSearches = (requests) => requests.filter((r) => (r.p_limit ?? 0) > 1);

/**
 * Drive ONE plan through the real production UI and return the `p_tables` production sent.
 * Returns null — never a guess — when the search did not land the cohort we asked for.
 */
export async function harvestOne(plan) {
  return withPage(false, async (page, requests) => {
    await setDeal(page, plan.deal);
    await setPeriod(page, plan.period);
    if (!(await pickCity(page, CITY))) return null;
    // «تجاري» must be committed before its groups render; «سكني» is the default but is tapped
    // anyway so both paths run the identical sequence and neither is exercised less than the other.
    if (!(await tapByText(page, plan.category))) return null;
    await sleep(900);
    if (!(await tapByText(page, plan.group))) return null;
    await sleep(1200);
    if (plan.type && !(await tapByText(page, plan.type))) return null;
    await sleep(900);
    await runSearch(page);
    await sleep(6000);

    const req = resultSearches(requests).at(-1);
    if (!req) return null;

    // ── ANCHOR CHECK (safety property 1) ─────────────────────────────────────────────────────────
    // What production SENT decides, never what the harness believes it clicked (§40.4). A capture
    // that does not carry the macro and the anchor type we asked for is discarded, because
    // recording it would put one cohort's tables under another cohort's label.
    if (req.p_category !== plan.macro) return null;
    if (!Array.isArray(req.p_types) || !req.p_types.includes(plan.anchor)) return null;
    if (!Array.isArray(req.p_tables) || req.p_tables.length === 0) return null;

    // The monthly labels must differ from their annual twin, or the «شهري» selection did not take
    // (§41.7: شهري needs two clicks, in order) and we would record the annual pool as the monthly
    // one — silently hiding the two monthly-only sources from every layer that reads this registry.
    return { scope: plan.scope, tables: [...req.p_tables].sort(), anchor: plan.anchor, macro: plan.macro };
  });
}

async function record(scope, tables, note) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/ops_qa_record_scope`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_scope: scope, p_tables: tables, p_note: note }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`ops_qa_record_scope(${scope}) ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

async function main() {
  if (!KEY) { console.error('harvest-scope: EXPO_PUBLIC_SUPABASE_ANON_KEY is required'); process.exit(1); }
  console.error(`══ SCOPE HARVEST — ${new Date().toISOString()} ══\n`);

  const captured = [];
  for (const plan of PLANS) {
    console.error(`▶ ${plan.scope}  (${plan.category} / ${plan.group}${plan.type ? ' / ' + plan.type : ''} / ${plan.deal}${plan.period ? '/' + plan.period : ''})`);
    let got = null;
    try { got = await harvestOne(plan); }
    catch (e) { console.error(`  harness error: ${String(e).slice(0, 200)}`); }
    if (!got) { console.error(`  ✗ ${plan.scope}: production did not land this cohort — capture discarded`); continue; }
    console.error(`  ✓ ${plan.scope}: ${got.tables.length} tables`);
    captured.push(got);
  }

  // ── PARTIAL-HARVEST REFUSAL (safety property 2) ────────────────────────────────────────────────
  // Writing the labels that succeeded would refresh `harvested_at` on some rows while leaving others
  // stale — and the detector's freshness gate reads the OLDEST label, so a partial write cannot even
  // be detected as partial. All six, or none.
  if (captured.length !== PLANS.length) {
    console.error(`\n✗ PARTIAL HARVEST — captured ${captured.length}/${PLANS.length}; refusing to write any label.`);
    console.error('  The registry is left exactly as it was; the detector\'s staleness gate stays the truthful signal.');
    process.exit(1);
  }

  // A monthly label identical to its annual twin means «شهري» never committed (§41.7). Recording it
  // would erase the two monthly-only sources from every layer that reads this registry.
  const by = new Map(captured.map((c) => [c.scope, c]));
  for (const [m, a] of [['resm', 'res'], ['s1m', 's1']]) {
    if (JSON.stringify(by.get(m).tables) === JSON.stringify(by.get(a).tables)) {
      console.error(`\n✗ «${m}» captured the same table list as «${a}» — the «شهري» selection did not commit.`);
      console.error('  Refusing to write: this would hide the monthly-only sources from the whole registry.');
      process.exit(1);
    }
  }

  for (const c of captured) {
    await record(c.scope, c.tables, `harvested from a real production browser search (${c.anchor}) — e2e/qa-coverage/harvest-scope.mjs`);
    console.error(`  wrote ${c.scope}: ${c.tables.length} tables`);
  }

  const union = new Set(captured.flatMap((c) => c.tables));
  console.error(`\n✓ ops_qa_scope refreshed — ${captured.length} labels, ${union.size} distinct source tables reachable by some search.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
