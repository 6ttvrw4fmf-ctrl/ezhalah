// POST-DEPLOY PRODUCTION PROOF for ops_incident #82 — the mixed-period rent price basis.
//
// NOT named verify-* ON PURPOSE. scripts/lib/testRegistry.ts discovers `scripts/verify-*.{ts,mjs}`
// and `npm test` is a REQUIRED status check on every PR. This script drives LIVE production, so
// wiring it into that suite would make every unrelated PR's required check depend on production
// reachability — exactly the defect filed as ops_incident #81, and the same reason AGENTS.md keeps
// verify-migration-drift-vs-production.ts out of `npm test`. Its home is a live/scheduled workflow
// or a hand-run after a deploy, never the hermetic suite.
//
// WHAT IT PROVES (owner acceptance criteria, ops_incident #82, given 2026-09-06). The fix in
// PR #1935 is "not complete until it is actually served in production", so all five must hold on the
// SERVED bundle at https://ezhalah-app.vercel.app for Rent with «شهري» and «سنوي» selected TOGETHER:
//
//   (a) the live displayed count = the exact returned SET — same ids, not merely the same number
//   (b) no valid MONTHLY row is removed by the client net
//   (c) no valid ANNUAL row is removed by the client net
//   (d) price range, price sort, price-per-m² and budget/closeness all read the canonical basis the
//       RPC uses — price_annual for a rent row
//   (e) pagination stays exact — zero duplicates, zero gaps, reconciling with the advertised total
//
// SPLIT, because the two halves need different things:
//   • SERVER ORACLE (a, e, and the server's own price contract) needs only the anon REST endpoint.
//     Runs anywhere, including a cloud agent container.
//   • BROWSER PROOF (b, c, d, and (a) end-to-end) needs a real browser that can reach production.
//     A cloud agent container cannot: Chromium through this egress proxy dies with
//     ERR_CONNECTION_RESET even though curl and fetch succeed. Run it in CI, where
//     .github/workflows/web-runtime-smoke.yml already drives the same origin successfully.
//
//   node scripts/prove-rent-basis-live.mjs              # server oracle only
//   node scripts/prove-rent-basis-live.mjs --browser    # + the browser proof (needs a real browser)
//
// A FAILED FETCH IS NOT AN EMPTY ANSWER (AGENTS.md, permanent rule). Every request here either
// produces a judged answer or FAILS LOUDLY. There is no path on which unreachable production reads
// as "nothing to report" — that is the exact class this repo has been burned by five times.

import { resolvePublicSupabase } from './lib/public-supabase.ts';

const CITY = 'الرياض';
const FLOOR = 20000;          // SAR/year. A monthly card prints price_annual÷12, so on the pre-fix
                              // bundle every monthly row reads as ~1/12 of this and is deleted.
const PAGE = 200;
const MAX_PAGES = 8;
const ORIGIN = process.env.EZHALAH_ORIGIN || 'https://ezhalah-app.vercel.app';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

const { url, key } = await resolvePublicSupabase();

/** The results RPC, through the anon path a guest actually uses. Throws rather than returning []. */
async function rpc(body) {
  const r = await fetch(`${url}/rest/v1/rpc/location_search_candidates_ar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`RPC returned a non-array: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

const BASE = { p_deal: 'إيجار', p_cities: [CITY], p_rent_period: 'كلاهما', p_price_min: FLOOR };
const idOf = (r) => `${r.source_table}:${r.listing_id}`;

console.log(`\n── SERVER ORACLE — ${CITY} / إيجار / كلاهما / ≥ ${FLOOR.toLocaleString()} SAR-year ──\n`);

// Paginate exactly as «عرض المزيد» does: one seed held constant across the whole walk.
const seed = `prove-${Date.now()}`;
const pages = [];
let advertised = null;
for (let i = 0; i < MAX_PAGES; i++) {
  const rows = await rpc({ ...BASE, p_limit: PAGE, p_offset: i * PAGE, p_rotation_seed: seed });
  if (!rows.length) break;
  if (advertised === null) advertised = Number(rows[0].total_count);
  pages.push(rows);
  if (rows.length < PAGE) break;
}

check('production answered the search at all (an unreachable origin is a FAILURE, never an empty result)',
  pages.length > 0 && advertised !== null,
  'the RPC returned no pages — this proof cannot be satisfied by finding nothing');

const all = pages.flat();
const ids = all.map(idOf);
const unique = new Set(ids);

// (a) count = the exact SET, server side.
check('(a) every page advertises the SAME total, so the count describes one stable set',
  pages.every((p) => Number(p[0].total_count) === advertised),
  `totals seen: ${[...new Set(pages.map((p) => Number(p[0].total_count)))].join(', ')}`);

// (e) pagination exactness.
check('(e) the paged walk has ZERO duplicates across pages',
  unique.size === ids.length,
  `${ids.length} rows returned but only ${unique.size} distinct — ${ids.length - unique.size} duplicate(s)`);

const expected = Math.min(advertised, MAX_PAGES * PAGE);
check('(e) the paged walk has ZERO gaps — it delivered every row it should have by this depth',
  unique.size === expected,
  `walked ${unique.size} distinct rows, expected ${expected} (advertised ${advertised})`);

// An unpaged re-fetch is an INDEPENDENT oracle: same predicate, different shape of request.
const unpaged = await rpc({ ...BASE, p_limit: expected, p_rotation_seed: seed });
const unpagedIds = new Set(unpaged.map(idOf));
const missing = [...unique].filter((i) => !unpagedIds.has(i));
const extra = [...unpagedIds].filter((i) => !unique.has(i));
check('(a) the union of the pages is the SAME SET as one unpaged fetch — ids, not just a count',
  missing.length === 0 && extra.length === 0,
  `missing ${missing.length}, extra ${extra.length}; e.g. ${[...missing, ...extra].slice(0, 3).join(', ')}`);

// The server's own price contract: effective_price for a rent row IS price_annual, and every row it
// returned honours the floor on THAT basis. This is the number the client must compare against.
const belowFloor = all.filter((r) => Number(r.effective_price) < FLOOR);
check(`(d) every row the server returned is ≥ the floor on the ANNUAL basis (effective_price)`,
  belowFloor.length === 0,
  `${belowFloor.length} row(s) below ${FLOOR}, e.g. ${belowFloor.slice(0, 3).map((r) => `${idOf(r)}=${r.effective_price}`).join(', ')}`);

// The premise of the whole proof: a set that would LOOK cheap if read on the printed unit. Any row
// whose annual rent is under FLOOR×12 prints under the floor once divided by 12, so the pre-fix
// client net deleted it. If none exist the scenario is not exercised and a green run means nothing.
const wouldHaveBeenDeleted = all.filter((r) => Number(r.effective_price) / 12 < FLOOR);
check('the scenario is genuinely exercised (rows exist that the PRE-FIX net would have deleted)',
  wouldHaveBeenDeleted.length > 0,
  'no row in this set reads below the floor when divided by 12 — pick a different city or floor, '
  + 'because a pass here would prove nothing about the defect');

console.log(`\n  advertised total ${advertised?.toLocaleString()} · walked ${unique.size} distinct rows`
  + ` · ${wouldHaveBeenDeleted.length} of them print below the floor when read as ÷12\n`);

// ── BROWSER PROOF — (b), (c), (d) and (a) end-to-end on the SERVED bundle ─────────────────────────
if (process.argv.includes('--browser')) {
  console.log(`── BROWSER PROOF — ${ORIGIN} ──\n`);
  // REUSE THE REPO'S OWN HARNESS rather than hand-rolling a second set of taps. The first version of
  // this block did hand-roll them and failed on its very first dispatch (run 34012764978) with
  // `waiting for getByText('شهري')` — because ONE «إيجار» tap leaves the Filter in dealCombined
  // (بيع+إيجار), and index.tsx hides the period boxes entirely in that mode
  // (`query.deal === 'Rent' && !query.dealCombined`). setDeal() already encodes that two-tap
  // sequence, pickCity() asserts the city actually COMMITTED rather than trusting the click, and
  // runSearch() scrolls «بحث» into view because on a narrow viewport it sits below the fold. Every
  // one of those is a lesson this harness already paid for.
  const { withPage, setDeal, pickCity, runSearch, tapByText, sleep } =
    await import('../e2e/live-sweep/sweep.mjs');

  await withPage(false, async (page, requests) => {
    await setDeal(page, 'إيجار');        // Rent ONLY — two taps; combined would hide the period boxes
    await tapByText(page, 'شهري');       // ADD Monthly to the default Yearly → rentPeriod 'both'.
    await sleep(900);                    // (setPeriod() would then untick Yearly, giving monthly-only)

    // The period toggle deliberately CLEARS any bound whose unit just changed, so the budget is typed
    // AFTER the period is settled — typing it first would silently discard it.
    await page.locator('[data-testid="price-min-input"]').fill(String(FLOOR));
    await sleep(1200);

    const committed = await pickCity(page, CITY);
    check('the browser journey actually reached the search it claims to prove',
      committed, `the city «${CITY}» never committed — this run proves nothing, it is not a pass`);
    await runSearch(page);
    await sleep(9000);

    // INTENDED STATE = SERIALIZED REQUEST STATE. The request the page really sent must carry both
    // predicates; if it does not, any card assertion below is measuring a different search.
    const sent = requests[requests.length - 1] || {};
    check('the served page sent the search it was asked for (كلاهما + the floor)',
      sent.p_rent_period === 'كلاهما' && Number(sent.p_price_min) === FLOOR,
      `last request carried p_rent_period=${JSON.stringify(sent.p_rent_period)}, p_price_min=${JSON.stringify(sent.p_price_min)}`);

    const text = await page.locator('body').innerText();
    const m = text.match(/لقينا\s*([\d,٠-٩]+)/);
    const shown = m ? Number(m[1].replace(/[,،]/g, '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))) : null;

    check('(a) the headline count on the served page equals the RPC total for the same search',
      shown === advertised, `page said ${shown}, RPC says ${advertised}`);

    // Every rendered price, with its period suffix — the card is the only place the unit is visible.
    const prices = await page.locator('text=/ر\\.س|SAR/').allInnerTexts().catch(() => []);
    const monthly = prices.filter((p) => /\/?شهر|\/mo/.test(p));
    const annual = prices.filter((p) => /\/?سنة|\/yr/.test(p));

    check('(b) MONTHLY cards survive the client net on a both-periods search with a floor',
      monthly.length > 0,
      'zero monthly cards rendered while the server returned monthly rows — THE DEFECT IS STILL LIVE');
    check('(c) ANNUAL cards survive it too', annual.length > 0,
      'zero annual cards rendered — the repair over-corrected and now drops the other period');

    // (d) Every rendered card, read on the canonical annual basis, honours the floor. A monthly card
    // printing X means X×12; if the served bundle still compared the printed figure, either the
    // monthly cards are gone (caught above) or a sub-floor annual value slipped through here.
    const num = (s) => Number((s.match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''));
    const violations = prices
      .map((p) => ({ p, annual: /\/?شهر|\/mo/.test(p) ? num(p) * 12 : num(p) }))
      .filter((x) => x.annual > 0 && x.annual < FLOOR);
    check('(d) every rendered card honours the floor on the ANNUAL basis, the RPC\'s own basis',
      violations.length === 0,
      `${violations.length} card(s) below the floor once annualised, e.g. ${violations.slice(0, 3).map((v) => v.p).join(' | ')}`);

    // A sweep that rendered nothing must never read as "no violations found". Same rule as the
    // server half: absence of evidence is not evidence, and a silent zero is the failure mode this
    // repo keeps paying for.
    check('cards were actually rendered and judged (an empty screen proves nothing)',
      prices.length > 0,
      'zero priced cards on the page — the journey did not reach a result set, so (b), (c) and (d) '
      + 'above are vacuous rather than passing');

    console.log(`\n  rendered ${prices.length} priced cards · ${monthly.length} monthly · ${annual.length} annual\n`);
  });
} else {
  console.log('── BROWSER PROOF SKIPPED (pass --browser) ──');
  console.log('   (b), (c) and the end-to-end half of (a) and (d) are NOT proven by this run.');
  console.log('   They require a real browser against the served bundle. ops_incident #82 stays open.\n');
}

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — the mixed-period rent price basis is not proven in production`);
  process.exit(1);
}
console.log('\nOK — every check in this run passed. Note which half ran before claiming #82 is closed.');
