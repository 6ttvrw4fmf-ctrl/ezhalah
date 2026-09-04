// THE SCOPE HARVESTER — refresh ops_qa_scope from what production's client ACTUALLY sends.
//
// WHY THIS FILE EXISTS (production defect, found 2026-09-04).
// SEARCH_MATCH_QA_ENGINEER.md §41.6 says the client's table scope is "HARVESTED from real browser
// requests each run — refresh them, never hand-edit them". Nothing ever did. `ops_qa_scope` was
// populated BY HAND on 2026-08-20 and then drifted for fifteen days, and because it is a snapshot
// with no freshness contract, that drift was silent in BOTH directions:
//
//   • FALSE POSITIVE — mon_detect_search_scope_unreachable_inventory judges reachability against
//     this registry. Five platforms (abralosol/arkaan/therc/rawasidark/aouj) went live in
//     search_listings_ar and were added to RES_TABLES/COM_TABLES on 2026-09-03, so production
//     reaches them fine — but the registry had never heard of them, so the detector raised TEN P1
//     alerts claiming 4,320 production-ready listings were "stored, indexed and invisible". They
//     were not. Verified the same day against the SERVED bundle: all ten tables ship in it.
//
//   • FALSE NEGATIVE, and this is the dangerous half — if the client ever DROPS a table, a stale
//     registry still lists it, the detector reports "reachable", and genuinely invisible inventory
//     goes unnoticed. That is the exact bug class the detector exists to catch, and staleness
//     blinds it. A barrier that cannot fail is decoration.
//
//   • SILENT UNDER-COVERAGE — ops_qa_cohort_catalog() joins THIS TABLE, so the daily coverage layer
//     (run.mjs) and the narrowing probe build every p_tables from it. Both had been firing searches
//     that excluded those 4,320 rows since the platforms went live: self-consistent, so no oracle
//     mismatch ever fired, and any matching/price/area/diversity defect on those five platforms was
//     invisible to this routine.
//
// So the registry is not refreshed here as bookkeeping — it is the ground truth three separate
// layers reason from, and it had no way to stay true.
//
// HOW IT HARVESTS. One real browser search per scope label against production, reading `p_tables`
// out of the intercepted location_search_candidates_ar POST body. That is the client's own
// serialization, not a reimplementation of it: nothing here re-derives which tables belong to a
// scope, so this file cannot drift from the client the way a second copy of the lists would (the
// precise failure that put Trending and the results screen on different inventory, remote.ts §530).
//
// SAFETY. Read-only against Ezhalah's own index; never touches a source platform (§40.6). The
// upsert REFUSES a label whose harvest came back empty or unchanged-but-unproven rather than
// writing a guess — an empty registry reads as "everything is reachable" to the detector, so a
// half-failed harvest must never be allowed to land.
//
//   node e2e/qa-coverage/harvest-scope.mjs            # harvest + write
//   QA_HARVEST_DRY=1 node e2e/qa-coverage/harvest-scope.mjs   # harvest + diff, write nothing
import { withPage, setDeal, setPeriod, pickCity, runSearch, tapByText, sleep } from '../live-sweep/sweep.mjs';

const SUPA = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY
  || 'sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const DRY = !!process.env.QA_HARVEST_DRY;
const CITY = process.env.QA_HARVEST_CITY || 'الرياض';

// ops_qa_scope is OPS METADATA: RLS hides the TABLE from anon — a direct read returns `[]`, not an
// error. That matters more than it looks: with an unreadable "current", every label would diff as
// "+N -0" and a REMOVED table could never be reported, which is the exact fail-silent direction
// this fix exists to close. So the before/after diff is read through ops_qa_scope_current(), and a
// diff that cannot be computed is ANNOUNCED rather than printed as if it were empty.
//
// Writes go through ops_qa_record_scope() — SECURITY DEFINER, anon-callable, refuses an empty table
// list — for the same reason the sweep records coverage through an RPC: this harness drives a
// browser and must never be handed a service-role key (live-search-sweep.yml is anon-only).

/**
 * One representative cohort per scope label. The label is NOT computed here — it is the `scope` /
 * `scope||'m'` value ops_qa_cohort already records for that نوع, so this list only has to name a
 * cohort that reaches each label. Two cohorts sharing a label send identical p_tables by
 * construction (they resolve through the same client branch), so one witness per label is enough.
 */
const PLAN = [
  { scope: 'res',  group: 'الشقق والسكن المشترك', type: 'شقة',       deal: 'بيع' },
  { scope: 'resm', group: 'الشقق والسكن المشترك', type: 'شقة',       deal: 'إيجار', period: 'شهري' },
  { scope: 'com',  group: 'التجزئة والمكاتب',      type: 'محل',       deal: 'بيع', category: 'تجاري' },
  { scope: 's2',   group: 'التجزئة والمكاتب',      type: 'مكتب',      deal: 'بيع', category: 'تجاري' },
  { scope: 's1',   group: 'الأراضي السكنية',       type: 'أرض سكنية', deal: 'بيع' },
  { scope: 's1m',  group: 'الأراضي السكنية',       type: 'أرض سكنية', deal: 'إيجار', period: 'شهري' },
];

const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
const rpc = async (fn, body) => {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} → ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;   // a void RPC answers with an EMPTY body
};

/** Harvest ONE label by driving the real filter and reading the request the client made. */
async function harvest(step) {
  return withPage(false, async (page, requests) => {
    await setDeal(page, step.deal);
    await setPeriod(page, step.period);
    if (!(await pickCity(page, CITY))) throw new Error(`city «${CITY}» not offered`);
    // فئة العقار gates which groups render at all: the Commercial groups do not exist in the DOM
    // until «تجاري» is selected, so a commercial harvest without this step fails with "group not
    // offered" — which looks like a missing control and is really a missing click.
    if (step.category) {
      if (!(await tapByText(page, step.category))) throw new Error(`فئة «${step.category}» not offered`);
      await sleep(1200);
    }
    if (!(await tapByText(page, step.group))) throw new Error(`group «${step.group}» not offered`);
    await sleep(1200);
    if (!(await tapByText(page, step.type))) throw new Error(`نوع «${step.type}» not offered`);
    await sleep(1000);
    await runSearch(page);
    await sleep(2500);
    // §41.5 — autocomplete fires the SAME RPC with p_limit:1. Only a real result search counts.
    const searches = requests.filter((r) => Number(r.p_limit) > 1 && Array.isArray(r.p_tables));
    if (!searches.length) throw new Error('no result search observed');
    return searches[searches.length - 1].p_tables;
  });
}

// A registry we cannot read is announced, never silently treated as empty — an empty "current"
// would report every label as freshly added and could not report a removal at all.
let current = null;
try {
  const rows = await rpc('ops_qa_scope_current', {});
  if (Array.isArray(rows) && rows.length) current = new Map(rows.map((r) => [r.scope, r.tables]));
} catch (e) {
  console.log(`ops_qa_scope_current() unreadable (${e.message}) — harvesting without a diff.\n`);
}

const harvested = new Map();
const failures = [];
for (const step of PLAN) {
  try {
    const tables = await harvest(step);
    if (!tables?.length) throw new Error('client sent an EMPTY p_tables');
    harvested.set(step.scope, tables);
    if (!current) { console.log(`${step.scope.padEnd(5)} ${String(tables.length).padStart(3)} tables`); continue; }
    const before = current.get(step.scope) ?? [];
    const added = tables.filter((t) => !before.includes(t));
    const removed = before.filter((t) => !tables.includes(t));
    const verdict = sameSet(before, tables) ? 'unchanged' : `+${added.length} -${removed.length}`;
    console.log(`${step.scope.padEnd(5)} ${String(tables.length).padStart(3)} tables  ${verdict}`);
    if (added.length) console.log(`      added:   ${added.join(', ')}`);
    if (removed.length) console.log(`      REMOVED: ${removed.join(', ')}`);
  } catch (e) {
    failures.push(`${step.scope}: ${e.message}`);
    console.log(`${step.scope.padEnd(5)} HARVEST FAILED — ${e.message}`);
  }
}

// A partial harvest must not land. The registry is read as complete truth by the detector and by
// ops_qa_cohort_catalog(); writing only the labels that happened to succeed would leave the rest
// stale while stamping the table as freshly harvested — worse than not running at all.
if (failures.length) {
  console.error(`\nREFUSING TO WRITE — ${failures.length}/${PLAN.length} labels failed to harvest:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

if (DRY) {
  console.log('\nQA_HARVEST_DRY — nothing written.');
  console.log(JSON.stringify(Object.fromEntries([...harvested].map(([s, t]) => [s, [...t].sort()]))));
  process.exit(0);
}

for (const [scope, tables] of harvested) {
  await rpc('ops_qa_record_scope', {
    p_scope: scope,
    p_tables: tables,
    p_note: `harvested from a real production browser search (${PLAN.find((p) => p.scope === scope).type})`,
  });
}
console.log(`\nops_qa_scope refreshed — ${harvested.size} labels, harvested just now.`);
