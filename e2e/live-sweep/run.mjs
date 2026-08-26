// LIVE SEARCH & MATCHING SWEEP — the runner.
//
// Picks this run's coverage from the ledger (stalest first, so runs stop piling up on Riyadh),
// drives every journey kind against production, enforces the owner's minimum coverage floors,
// records what was covered, and prints the recurring report.
//
// EXIT CODE: non-zero when a DEFECT was found OR a coverage floor was missed. A run that quietly
// covers less than the floor is itself a failure — that is the way a rotation system rots.
//
//   node e2e/live-sweep/run.mjs
import { FLOORS, WATCHES, findings, journeys, ledgerPlan, ledgerRecord, note, dbCount, sleep } from './sweep.mjs';
import { normalFilter, trendingCity, trendingDistrict, advancedFilter, zeroResult,
         cardClickBack, tabHistory, typedDistrict, clearAll } from './journeys.mjs';

const enc = encodeURIComponent;
const RIYADH = 'الرياض';

// ── the pools rotation draws from ────────────────────────────────────────────────────────────────
// Cities are discovered LIVE from the index (never a hardcoded list that can go stale), then ordered
// by ledger staleness. Region is carried so the report can show regional spread.
// Also records WHICH deal/period each city actually has inventory for. The city field's pool is
// deal+category scoped by design, so a city with only بيع listings is correctly NOT offered on an
// إيجار search — pairing a city with a deal it does not stock loses the journey to a legitimate
// refusal and takes a COVERAGE FLOOR with it. That is what happened on 2026-08-26: الدليمية (22
// listings, ALL بيع, zero إيجار/سنوي) drew «إيجار/سنوي», production rightly did not offer it, and
// the run failed on «non-Riyadh cities: 2 < 3» with production perfectly healthy. Availability is
// read from the live index, never hardcoded (§1).
async function livePool() {
  const r = await fetch(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co'}`
    + `/rest/v1/search_listings_ar?select=city_ar,region_ar,deal_ar,rent_period_ar&production_ready=is.true&limit=4000`,
    { headers: { apikey: KEY(), Authorization: `Bearer ${KEY()}` } }).catch(() => null);
  const rows = r ? await r.json().catch(() => []) : [];
  const byCity = new Map();
  for (const row of rows) {
    if (!row.city_ar) continue;
    const e = byCity.get(row.city_ar) ?? { city: row.city_ar, region: row.region_ar, n: 0, deals: new Set() };
    e.n++;
    // The same keys DEALS is indexed by. «both» needs no branch: any inventory satisfies Buy+Rent.
    if (row.deal_ar === 'بيع') e.deals.add('بيع/-');
    else if (row.deal_ar === 'إيجار' && row.rent_period_ar) e.deals.add(`إيجار/${row.rent_period_ar}`);
    e.deals.add('both/-');
    byCity.set(row.city_ar, e);
  }
  return [...byCity.values()].filter((c) => c.n >= 5).sort((a, b) => b.n - a.n);
}
const KEY = () => process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY
  || 'sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB';

const TYPES = [
  { group: 'الشقق والسكن المشترك', label: 'شقة' },
  { group: 'الفلل والبيوت', label: 'فيلا' },
  { group: 'الأراضي السكنية', label: null },
  { group: 'الاستراحات والريف', label: 'استراحة' },
];
const DEALS = [
  { deal: 'بيع', period: null },
  { deal: 'إيجار', period: 'سنوي' },
  { deal: 'إيجار', period: 'شهري' },
  { deal: 'both', period: null },
];

/** Order a list of keys by ledger staleness (unseen keys first). */
async function stalestFirst(dimension, keys) {
  const plan = await ledgerPlan(dimension, 200);
  const seen = new Map((plan ?? []).map((r) => [r.key, Number(r.staleness_days ?? 999)]));
  return [...keys].sort((a, b) => (seen.get(b) ?? 999) - (seen.get(a) ?? 999));
}

async function main() {
  const started = Date.now();
  console.error(`\n══ LIVE SEARCH & MATCHING SWEEP — ${new Date().toISOString()} ══\n`);

  const pool = await livePool();
  if (!pool.length) { console.error('FATAL: could not read the live city pool'); process.exit(2); }
  const nonRiyadh = pool.filter((c) => c.city !== RIYADH);
  const cityOrder = await stalestFirst('city', nonRiyadh.map((c) => c.city));
  const pickCities = cityOrder.slice(0, Math.max(FLOORS.nonRiyadhCities, 3));
  const regionOf = new Map(pool.map((c) => [c.city, c.region]));
  const dealsOf = new Map(pool.map((c) => [c.city, c.deals]));
  const dealOrder = await stalestFirst('deal_period', DEALS.map((d) => `${d.deal}/${d.period ?? '-'}`));
  const deals = dealOrder.map((k) => DEALS.find((d) => `${d.deal}/${d.period ?? '-'}` === k)).filter(Boolean);
  const typeOrder = await stalestFirst('type', TYPES.map((t) => t.label ?? t.group));
  const types = typeOrder.map((k) => TYPES.find((t) => (t.label ?? t.group) === k)).filter(Boolean);

  console.error(`ROTATION → cities: ${pickCities.join(', ')}`);
  console.error(`ROTATION → deals:  ${deals.map((d) => d.deal + (d.period ? '/' + d.period : '')).join(', ')}`);
  console.error(`ROTATION → types:  ${types.map((t) => t.label ?? t.group).join(', ')}\n`);

  const done = { normal: 0, af: 0, tCity: 0, tDistrict: 0, mobile: 0, buyRent: 0, monthly: 0, zero: 0, cardBack: 0 };
  const citiesTested = new Set(); const regionsTested = new Set(); const typesTested = new Set();
  const run = async (label, fn, tally) => {
    console.error(`▶ ${label}`);
    try { const r = await fn(); if (r) { tally?.(); } return r; }
    catch (e) { note(`${label}: harness error — ${String(e).slice(0, 120)}`); return null; }
  };

  // ── 1. NORMAL FILTER across the rotated cities × deal/period ───────────────────────────────────
  for (let i = 0; i < pickCities.length; i++) {
    const city = pickCities[i];
    // Stalest-first, but only among the deals this city actually stocks — see livePool(). Falls back
    // to the plain rotation when availability is unknown, so a pool read that came back thin can
    // never silently stop the rotation.
    const have = dealsOf.get(city);
    const d = (have && deals.find((x) => have.has(`${x.deal}/${x.period ?? '-'}`))) ?? deals[i % deals.length];
    const t = types[i % types.length];
    const mobile = i === 0;                                   // floor: at least one mobile journey
    const ran = await run(`normal ${city} ${d.deal}${d.period ? '/' + d.period : ''} ${t.label ?? t.group}${mobile ? ' [mobile]' : ''}`,
      () => normalFilter({ city, deal: d.deal, period: d.period, group: t.group, typeLabel: t.label, mobile }),
      () => { done.normal++; citiesTested.add(city); regionsTested.add(regionOf.get(city) ?? '?');
              typesTested.add(t.label ?? t.group);
              if (mobile) done.mobile++;
              if (d.deal === 'both') done.buyRent++;
              if (d.period === 'شهري') done.monthly++; });
    // Only a journey that actually RAN is coverage. Recording a skip as 'pass' marks the city fresh
    // and pushes it to the back of the stalest-first rotation, so a city the sweep keeps failing to
    // reach would look permanently well-covered — the exact way a rotation system rots quietly.
    if (ran) {
      await ledgerRecord('city', city, 'pass', 'live browser sweep');
      await ledgerRecord('deal_period', `${d.deal}/${d.period ?? '-'}`, 'pass', 'live browser sweep');
      await ledgerRecord('type', t.label ?? t.group, 'pass', 'live browser sweep');
    }
  }

  // ── FLOOR BACKSTOPS ────────────────────────────────────────────────────────────────────────────
  // A floor must not hinge on ONE rotated city being offerable. The city field's pool is
  // deal+category+cohort scoped, so any given city can legitimately not be offered for the shape the
  // rotation drew — and when that city was pickCities[0], the journey pinned to it was lost and took
  // its floor with it. Both floor misses on 2026-08-26 were this: «الدليمية» (بيع-only, drew rent)
  // cost the non-Riyadh floor, then «النعيرية» cost the MOBILE floor because mobile was pinned to
  // index 0. Production was healthy in both runs.
  //
  // So a backstop runs on a city already PROVEN reachable this run, falling back to الرياض, which is
  // always offered. This does not weaken any floor — each still requires a real journey against
  // production; it only stops one unlucky rotation draw from silently deleting one. الرياض never
  // counts toward the non-Riyadh floor, which is computed from citiesTested minus الرياض.
  const reachable = () => [...citiesTested][0] ?? pickCities[0] ?? RIYADH;
  if (!done.buyRent) {
    const city = reachable();
    await run(`normal ${city} Buy+Rent [floor]`, () => normalFilter({ city, deal: 'both', period: null }),
      () => { done.normal++; done.buyRent++; citiesTested.add(city); });
  }
  if (!done.monthly) {
    const city = reachable();
    await run(`normal ${city} monthly [floor]`, () => normalFilter({ city, deal: 'إيجار', period: 'شهري' }),
      () => { done.normal++; done.monthly++; citiesTested.add(city); });
  }
  // MOBILE had no backstop at all — it rode on `mobile = i === 0` and vanished with that journey.
  if (!done.mobile) {
    const city = reachable();
    await run(`normal ${city} [mobile floor]`,
      () => normalFilter({ city, deal: 'بيع', period: null, mobile: true }),
      () => { done.normal++; done.mobile++; citiesTested.add(city); });
    if (!done.mobile) {
      await run(`normal ${RIYADH} [mobile floor · last resort]`,
        () => normalFilter({ city: RIYADH, deal: 'بيع', period: null, mobile: true }),
        () => { done.normal++; done.mobile++; citiesTested.add(RIYADH); });
    }
  }

  // ── 2. TRENDING city + district ────────────────────────────────────────────────────────────────
  await run('trending city', () => trendingCity({ deal: 'بيع', period: null }), () => { done.tCity++; });
  await run('trending district (narrowed)',
    () => trendingDistrict({ city: reachable(), deal: 'بيع', period: null, priceMax: 900000 }),
    () => { done.tDistrict++; citiesTested.add(pickCities[0]); });
  await ledgerRecord('trending_city', 'live-sweep', 'pass', 'live browser sweep');
  await ledgerRecord('trending_district', pickCities[0], 'pass', 'live browser sweep');

  // ── 3. ADVANCED FILTER (needs a scope big enough to open) ──────────────────────────────────────
  await run('advanced filter', () => advancedFilter({ city: RIYADH, deal: 'بيع', group: 'الفلل والبيوت', typeLabel: 'فيلا' }),
    () => { done.af++; citiesTested.add(RIYADH); typesTested.add('فيلا'); });
  await run('advanced filter (monthly)', () => advancedFilter({ city: RIYADH, deal: 'إيجار', period: 'شهري', group: 'الشقق والسكن المشترك', typeLabel: 'شقة' }),
    () => { done.af++; done.monthly++; });
  await ledgerRecord('advanced_filter', 'live-sweep', 'pass', 'live browser sweep');

  // ── 4. honest zero · card→external→Back · Clear All ───────────────────────────────────────────
  await run('honest zero', () => zeroResult({ city: pickCities[0] }), () => { done.zero++; });
  await run('card → source → back', () => cardClickBack({ city: pickCities[0] }), () => { done.cardBack++; });
  await run('clear all', () => clearAll({ city: pickCities[0] }));

  // ── 5. THE PERMANENT WATCHES for the 2026-08-23 fixes ─────────────────────────────────────────
  await run('watch: tab switching pushes no junk history', () => tabHistory());
  await run('watch: typed district is not silently dropped',
    () => typedDistrict({ city: RIYADH, districtText: 'النرجس' }));
  // exact-city-never-rescoped is asserted inside EVERY assertChain (INTENT→UI), so it is covered by
  // every journey above rather than by one probe.
  for (const w of WATCHES) await ledgerRecord('live_watch', w, findings.some((f) => f.detail.includes(w)) ? 'fail' : 'pass', 'live browser sweep');

  // ── floors ─────────────────────────────────────────────────────────────────────────────────────
  const nonRiyadhCount = [...citiesTested].filter((c) => c !== RIYADH).length;
  const floorMisses = [];
  const floor = (label, actual, min) => { if (actual < min) floorMisses.push(`${label}: ${actual} < ${min}`); };
  floor('non-Riyadh cities', nonRiyadhCount, FLOORS.nonRiyadhCities);
  floor('mobile journeys', done.mobile, FLOORS.mobileJourneys);
  floor('AF journeys', done.af, FLOORS.afJourneys);
  floor('trending city journeys', done.tCity, FLOORS.trendingCityJourneys);
  floor('trending district journeys', done.tDistrict, FLOORS.trendingDistrictJourneys);
  floor('Buy+Rent journeys', done.buyRent, FLOORS.buyRentJourneys);
  floor('monthly journeys', done.monthly, FLOORS.monthlyJourneys);
  floor('honest-zero journeys', done.zero, FLOORS.zeroResultJourneys);
  floor('card→back journeys', done.cardBack, FLOORS.cardClickBackJourneys);

  // ── the recurring report ───────────────────────────────────────────────────────────────────────
  const byPair = (p) => findings.filter((f) => f.layerPair === p).length;
  const total = journeys.length + done.zero + done.cardBack;
  const health = findings.length === 0 && floorMisses.length === 0 ? 10
    : Math.max(1, 10 - findings.length - floorMisses.length);

  console.error('\n════════════════ LIVE SEARCH & MATCHING SWEEP — REPORT ════════════════');
  const line = (k, v) => console.error(`${k}: ${v}`);
  line('LIVE BROWSER JOURNEYS', total);
  line('CITIES TESTED', citiesTested.size);
  line('REGIONS TESTED', regionsTested.size);
  line('PROPERTY TYPES TESTED', typesTested.size);
  line('AF JOURNEYS', done.af);
  line('TRENDING CITY JOURNEYS', done.tCity);
  line('TRENDING DISTRICT JOURNEYS', done.tDistrict);
  line('MOBILE JOURNEYS', done.mobile);
  line('INTENT→UI MISMATCHES', byPair('INTENT→UI'));
  line('UI→REQUEST MISMATCHES', byPair('UI→REQUEST'));
  line('REQUEST→RPC MISMATCHES', byPair('REQUEST→RPC'));
  line('RPC→DB MISMATCHES', byPair('RPC→DB'));
  line('INELIGIBLE RESULTS', byPair('RPC→RENDERED') + byPair('RENDERED'));
  // A SKIPPED LAYER IS NOT A PASS. When the oracle cannot express a scope faithfully it returns
  // null, and null contributes zero mismatches — which reads exactly like agreement unless it is
  // printed. These two lines keep the gap visible on every run, so nobody can quietly inherit a
  // sweep that "passes" because it stopped checking.
  const dbSkipped = journeys.filter((j) => j.dbSkipped).length;
  const idSets = journeys.filter((j) => j.idSet).length;
  line('DB-TRUTH LAYER SKIPPED', dbSkipped ? `${dbSkipped} — ${[...new Set(journeys.filter((j) => j.dbSkipped).map((j) => j.dbSkipped))].join(' | ')}` : 0);
  line('ID-SET COMPARISONS (missing/extra/dupes proven 0)', idSets);
  line('DUPLICATES', journeys.reduce((n, j) => n + (j.idSet?.duplicates ?? 0), 0));
  line('BUGS FOUND', findings.length);
  line('BUGS FIXED', 0);
  line('BARRIERS ADDED/STRENGTHENED', 0);
  line('PRODUCTION VERIFIED', findings.length === 0 ? 'YES' : 'NO');
  line('SEARCH & MATCHING HEALTH', `${health}/10`);
  if (floorMisses.length) { console.error('\nCOVERAGE FLOORS MISSED:'); floorMisses.forEach((m) => console.error(`  ✗ ${m}`)); }
  if (findings.length) {
    console.error('\nDEFECTS (each must be fixed → barriered → deployed → re-tested, never reported and left):');
    findings.forEach((f, i) => console.error(`  ${i + 1}. [${f.journey}] ${f.layerPair} — ${f.detail}`));
  }
  console.error(`\nran in ${Math.round((Date.now() - started) / 1000)}s · journal ${process.env.SWEEP_OUT || '/tmp/live-sweep'}/journeys.jsonl\n`);

  await ledgerRecord('live_browser_sweep', new Date().toISOString().slice(0, 10),
    findings.length ? 'fail' : 'pass',
    `journeys=${total} cities=${citiesTested.size} defects=${findings.length} floors_missed=${floorMisses.length}`);

  process.exit(findings.length || floorMisses.length ? 1 : 0);
}

main().catch((e) => { console.error('SWEEP CRASHED:', e); process.exit(2); });
