// REMOVING THE LAST ADVANCED-FILTER PILL RETURNS THE USER TO EXACTLY THE PRE-AF SEARCH — PROVEN
// IN A REAL BROWSER AGAINST PRODUCTION.
//
// WHAT THIS EXISTS FOR
// --------------------
// `verify-af-pill-removal-live.ts` proves R9.2 for the MIDDLE of the pill row: with two or more
// committed answers, tapping one ✕ drops exactly that predicate and every other survives. It
// deliberately refuses the single-pill case as "vacuous" for R9.2.1 — and it is, for the SURVIVOR
// half of that rule. But the single-pill case carries a rule of its own that nothing executed
// against production until now: when the LAST committed answer is removed there is nothing left to
// replay, so `removeGuidedFacet` rebuilds the query from the interview's `baseQ` alone. The result
// MUST be the search the user had before Advanced Filter ever opened — the same request body, the
// same count, the same listings — and the interview must be re-openable on the same question.
//
// That is exactly where a wrong `baseQ` would hide. With survivors on the row, a stale or mutated
// baseQ is masked by the predicates replayed on top of it; with none, the baseQ IS the request.
// The defect class this catches is therefore: a pill removal that lands on a search which is NOT
// the pre-AF search — a leftover predicate, a scope key moved by the rebuild (city/type/deal/period/
// tables/category), a count that does not return to N0, a pill or summary row that survives its own
// removal, a headline above rewritten in place, or a removed question that stays BURNED in the asked
// carry so «تحديد أكثر» can no longer offer it (R9.2.3).
//
// CONTRACT RULES PROVED (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md)
//   R8.1.1/R8.1.2  Skip writes zero predicate — so a round of "answer one, skip the rest" commits
//                  exactly ONE facet, and the request carries exactly that one (the setup of this
//                  journey, asserted, not assumed)
//   R9.2.1  removing the only pill leaves ZERO AF predicates on the request
//   R9.2.2  the search re-runs; the count returns to N0 exactly; a new results turn lands below with
//           N0; nothing above is rewritten; the normal-filter scope is byte-identical to the pre-AF
//           request; the landed number is DB truth (anon replay AND the independent PostgREST
//           oracle both return N0, and the returned ID set equals the oracle's — missing = extra =
//           duplicates = 0)
//   R9.2.3  the removed question is offerable again — the offer comes back AND opening it asks the
//           SAME first question the user answered before (its id left the asked carry)
//   R9.1.1  the pill row and its summary line are gone once no committed answer remains
//   R7.1.2  the header chip after the tentative selection equals the count that landed (bonus)
//
// THE JOURNEY (defaults الرياض · شقة · Buy; env knobs below)
//   1. Residential · CITY · TYPE → بحث                 (baseline body B0, count N0)
//   2. open AF; note the first question's title; select its FIRST option; confirm; SKIP every
//      remaining question of the round                  (body B1, count N1 < N0, exactly 1 facet)
//      — if the round somehow left >1 removable pill, remove pills one at a time until one is left,
//        asserting each removal by the sibling template's rules
//   3. snapshot headlines, pill count, summary line
//   4. tap ✕ on af-pill-0 (the LAST pill)               (body B2, count N2)
//   5. assert everything in the list above on the request the browser actually sent
//   6. tap «خلّنا نحدد الطلب أكثر» again and compare the question title to step 2
//
// LIVE CHECK — excluded from `npm test` (it drives a real browser against production), runs in
// .github/workflows/af-live-truth-check.yml alongside the other AF live journeys.
//
//   PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium node --experimental-strip-types scripts/verify-af-remove-last-pill-live.ts
//   AF_LAST_CITY / AF_LAST_GROUP / AF_LAST_TYPE     scope (defaults الرياض / الشقق والسكن المشترك / شقة)
//   AF_LAST_DEAL=buy|rent|rent-monthly              deal leg (default buy; rent = Rent-Annual)
//   AF_LAST_MOBILE=1                                390x844 touch viewport

// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { chromium } from 'playwright';
import { openAfOffer, type OfferResult } from './lib/afOfferLive.ts';
import { gotoLive } from './lib/liveNav.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { buildOracleQS } from './lib/afOracleFilter.ts';
import { loadDirectionVariants } from './lib/afOracleLive.ts';

const BASE = 'https://ezhalah-app.vercel.app';
const { url: SUPABASE_URL, key: ANON_KEY } = resolvePublicSupabase(process.env);
const H: Record<string, string> = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' };

const CITY = process.env.AF_LAST_CITY || 'الرياض';
const GROUP = process.env.AF_LAST_GROUP || 'الشقق والسكن المشترك';
const TYPE = process.env.AF_LAST_TYPE || 'شقة';
const DEAL = (process.env.AF_LAST_DEAL || 'buy') as 'buy' | 'rent' | 'rent-monthly';
const MOBILE = process.env.AF_LAST_MOBILE === '1';
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const EXPECT_DEAL = DEAL === 'buy' ? 'بيع' : 'إيجار';
const EXPECT_PERIOD = DEAL === 'buy' ? null : DEAL === 'rent' ? 'سنوي' : 'شهري';

// Every AF answer field the search RPC accepts (same list as the sibling template).
const AF_PREDICATE_KEYS = [
  'p_bath_min', 'p_bath_exact', 'p_age_min', 'p_age_max', 'p_is_new_construction', 'p_age_unknown',
  'p_amenities', 'p_furnished', 'p_rating_min', 'p_reviews_min', 'p_unit_subtypes',
  'p_street_width_min', 'p_street_width_max', 'p_directions', 'p_rnpl',
];
// One committed ANSWER can write more than one key (age «1-2» → p_age_min+p_age_max; rating
// «9.0 with 10 reviews» → p_rating_min+p_reviews_min), so "exactly one predicate" is counted per
// QUESTION, not per key. Each group below is one question's key set.
const AF_FACET_GROUPS: Record<string, string[]> = {
  bathrooms: ['p_bath_min', 'p_bath_exact'],
  property_age: ['p_age_min', 'p_age_max', 'p_is_new_construction', 'p_age_unknown'],
  amenities: ['p_amenities', 'p_rnpl'],
  furnished: ['p_furnished'],
  rating: ['p_rating_min', 'p_reviews_min'],
  unit_subtype: ['p_unit_subtypes'],
  street_width: ['p_street_width_min', 'p_street_width_max'],
  direction: ['p_directions'],
};
// The only request key allowed to differ between the pre-AF search and the post-removal search:
// p_rotation_seed is a projected ORDER BY key, never a WHERE predicate (proven against the live RPC
// body in scripts/lib/afOracleFilter.ts, 2026-09-01), and it is minted per search on purpose.
const VOLATILE_KEYS = ['p_rotation_seed'];
const SCOPE_KEYS = ['p_cities', 'p_types', 'p_deal', 'p_rent_period', 'p_beds_exact', 'p_price_min', 'p_price_max', 'p_area_min', 'p_area_max'];

const CLICK_LEAF = (txt: string) => {
  let best: any = null;
  document.querySelectorAll('div,span,li,button').forEach((e: any) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  let a = best.parentElement, sc: any = null;
  while (a) {
    const s = getComputedStyle(a);
    if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight) { sc = a; break; }
    a = a.parentElement;
  }
  if (sc) { const er = best.getBoundingClientRect(), sr = sc.getBoundingClientRect(); sc.scrollTop += (er.top - sr.top) - sc.clientHeight / 2 + er.height / 2; }
  else best.scrollIntoView({ block: 'center' });
  const r = best.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

let failures = 0;
// Failed labels are re-printed in the closing summary as well as inline: CI and humans both read
// the END of a long log, so a single FAIL far up the scroll is invisible to `tail`.
const failedLabels: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) { failures++; failedLabels.push(label); }
};
// A SKIP is printed as SKIP, never as PASS: an assertion whose precondition failed proved nothing.
const skip = (label: string, why: string) => console.log(`SKIP  ${label}\n      ${why}`);

/** Which AF predicates are present (non-null, non-empty) on a captured request body. */
const afKeysOn = (body: any): string[] =>
  AF_PREDICATE_KEYS.filter((k) => body?.[k] != null && !(Array.isArray(body[k]) && body[k].length === 0));
/** Which QUESTIONS (facet groups) are present on a captured request body. */
const facetsOn = (body: any): string[] =>
  Object.entries(AF_FACET_GROUPS).filter(([, keys]) => keys.some((k) => afKeysOn(body).includes(k))).map(([id]) => id);
/** Every non-AF, non-volatile key of the union of two bodies whose value differs. */
const movedNonAfKeys = (b0: any, b2: any): string[] =>
  [...new Set([...Object.keys(b0 ?? {}), ...Object.keys(b2 ?? {})])]
    .filter((k) => !AF_PREDICATE_KEYS.includes(k) && !VOLATILE_KEYS.includes(k))
    .filter((k) => JSON.stringify(b0?.[k] ?? null) !== JSON.stringify(b2?.[k] ?? null))
    .sort();

// ── THE LOAD-BEARING PREDICATES, AS PURE FUNCTIONS ──────────────────────────────────────────────
// The live journey calls them on what production actually did; the mutation block at the bottom
// calls the SAME functions on deliberately corrupted copies of the same artefacts and requires each
// to return false. An assertion nobody has ever seen fail is not a barrier.
const R = {
  /** setup — the committed state is exactly ONE question's answer (R8.1.1: skips wrote nothing). */
  exactlyOneFacet: (body: any) => facetsOn(body).length === 1 && afKeysOn(body).length >= 1,
  /** setup — committing a narrowing answer must narrow (a non-narrowing answer proves nothing). */
  narrowed: (n0: number | null, n1: number | null) => n0 != null && n1 != null && Number.isFinite(n0) && Number.isFinite(n1) && n1 < n0,
  /** R9.2.1 — after the LAST pill goes, no AF predicate is left on the request. */
  noAfPredicate: (body: any) => body != null && afKeysOn(body).length === 0,
  /** R9.2.2 — every non-AF key is byte-identical to the pre-AF search (rotation seed excepted). */
  scopeRestored: (b0: any, b2: any) => b0 != null && b2 != null && movedNonAfKeys(b0, b2).length === 0,
  /** R9.2.2 — the count is back to N0 EXACTLY, not merely "widened". */
  countRestored: (n0: number | null, n2: number | null) => n0 != null && n2 != null && Number.isFinite(n0) && n2 === n0,
  /** R9.1.1 — no removable pill survives its own removal. */
  noPillRemains: (pills: number) => pills === 0,
  /** R9.2.2 — the rows the APP received on the restored turn (its own response, not a replay) are all in
   *  the oracle set, with no duplicate. */
  appRowsInOracle: (rows: string[], oracle: Set<string>) => rows.length > 0 && rows.every((id) => oracle.has(id)) && new Set(rows).size === rows.length,
  /** R10.1.1 — page 0 is complete: min(total, buffer) rows, never a short page under a full headline. */
  pageZeroComplete: (rows: number, total: number | null, buffer: number) => total != null && Number.isFinite(total) && rows === Math.min(total, buffer),
  /** R9.2.2 — the restored turn RENDERED exactly the first page of cards under its headline. */
  renderedFirstPage: (delta: number, total: number | null, firstPage: number) => total != null && Number.isFinite(total) && delta === Math.min(total, firstPage),
  /** R9.1.1 — the summary line that sat above the pills is gone too. */
  summaryGone: (occurrences: number) => occurrences === 0,
  /** R9.2.2 — every headline already on screen is still there, in place, unchanged. */
  nothingAboveRewritten: (before: string[], after: string[]) =>
    before.length > 0 && before.every((h, i) => after[i] === h),
  /** R9.2.2 — exactly one NEW results turn landed below, carrying N0. */
  newTurnLandedWith: (before: string[], after: string[], n0: number | null) =>
    after.length === before.length + 1 && n0 != null && toNum(after[after.length - 1] ?? '') === n0,
  /** R9.2.3 — re-opening AF asks the same first question the user answered (not burned). */
  sameQuestionReoffered: (answered: string | null, reoffered: string | null) =>
    !!answered && !!reoffered && answered === reoffered,
  /** the count the header chip showed for the tentative selection equals the count that landed. */
  chipMatchesLanded: (chip: number | null, landed: number | null) =>
    chip != null && landed != null && Number.isFinite(chip) && chip === landed,
  // Sibling-template rules, used only if the round unexpectedly leaves >1 pill and we must trim
  // pills one at a time down to a single survivor.
  droppedExactlyOne: (before: any, after: any) =>
    facetsOn(before).filter((f) => !facetsOn(after).includes(f)).length === 1,
  survivorsIntact: (before: any, after: any) =>
    afKeysOn(after).every((k) => afKeysOn(before).includes(k) && JSON.stringify(after[k]) === JSON.stringify(before[k])),
  widenedOrHeld: (before: number | null, after: number | null) => before != null && after != null && after >= before,
};

/** Every «لقينا N إعلان» headline currently rendered, in DOM order, one entry per turn. */
// Product constants restated (src/data/remote.ts QUERY_LIMIT page-0 buffer; the results turn shows the
// first 10 cards before any «عرض المزيد»). Restated on purpose: importing them would let a product
// change move the expectation with it.
const PAGE0_BUFFER = 1500;
const FIRST_PAGE = 10;
/** Every rendered listing card carries a leaf «#<n>» ordinal — count them (transcript-wide). */
const COUNT_CARDS = () => {
  let n = 0;
  document.querySelectorAll('div,span').forEach((e: any) => {
    if (e.children.length) return;
    if (/^#[\d٠-٩۰-۹]+$/.test((e.innerText || '').trim())) n++;
  });
  return n;
};

const READ_HEADLINES = () => {
  const re = /^لقينا\s+[\d,٬٠-٩]+\s+إعلان/;
  const all = [...document.querySelectorAll('div,span,p')].filter((e: any) => re.test((e.innerText || '').trim()));
  // Innermost only: a parent whose innerText is exactly the headline repeats its child. Keeping
  // every innermost match (NOT deduping by text) matters here — the pre-AF turn and the post-removal
  // turn carry the SAME headline text, and a text-deduped list would hide the new turn.
  return all.filter((e) => !all.some((o) => o !== e && e.contains(o))).map((e: any) => (e.innerText || '').trim());
};
const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d]/g, '');
const toNum = (s: string): number | null => {
  const m = s.match(/لقينا\s*([\d,٬٠-٩]+)/);
  return m ? Number(digits(m[1])) : null;
};

// ── the independent oracle (PostgREST over search_listings_ar, never our own RPC) ───────────────
const rest = async (path: string, extra: Record<string, string> = {}) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...H, ...extra } });
  if (!r.ok) throw new Error(`REST ${r.status} on ${path.slice(0, 120)}: ${(await r.text()).slice(0, 200)}`);
  return r;
};
// Category purity needs the same reference table production joins against (known_type_ar).
let TYPE_MACROS: Record<string, string> | null = null;
try {
  TYPE_MACROS = Object.fromEntries((await (await rest('known_type_ar?select=type_ar,macro')).json()).map((x: any) => [x.type_ar, x.macro]));
} catch (e: any) { console.log(`      [diag] known_type_ar unreadable: ${e.message} — the oracle will refuse p_category`); }

// DIRECTION VARIANTS. The index stores «شمال شرقي» alongside «شمال شرق» (a trailing ي on the last
// word) and the RPC normalises them together; the oracle's literal direction_ar=in.(…) would
// UNDERCOUNT. So when a direction option is on the body, the key is expanded to every stored value
// equal to it or to it with «ي» appended to its last word. Existence is established by a count-only
// probe per candidate (Range 0-0) instead of paging the whole index for distinct values — same fact,
// O(candidates) instead of O(rows). Any OTHER spelling the RPC may fold is not modelled here; that
// would surface as an oracle undercount, never as a false pass.
// The shared loader (scripts/lib/afOracleLive.ts) reads the OBSERVED spellings, throws on transport
// errors and returns a null map on any unclassified spelling; buildOracleQS then reports p_directions
// UNHANDLED and the case is a loud SKIP — never a body-level pre-expansion the translator ignores.
const DIRECTION = await loadDirectionVariants(SUPABASE_URL, H);
const oracleQS = async (body: any): Promise<{ qs: string; unhandled: string[] }> =>
  buildOracleQS(body, { ...(TYPE_MACROS ? { typeMacros: TYPE_MACROS } : {}), ...(DIRECTION.map ? { directionVariants: DIRECTION.map } : {}) });
const oracleCount = async (qs: string): Promise<number> => {
  const r = await rest(`search_listings_ar?select=listing_id&${qs}`, { Prefer: 'count=exact', Range: '0-0' });
  const cr = r.headers.get('content-range') || '';
  if (!cr.includes('/')) throw new Error(`no content-range on oracle count (${cr})`);
  return Number(cr.split('/')[1]);
};
// Range-paged PostgREST reads MUST carry a total order — unordered paging drops or repeats rows
// across page boundaries (measured 3,866 of 3,867 on جدة/Villa+Duplex, 2026-08-28).
const oracleIds = async (qs: string, cap: number): Promise<Set<string>> => {
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let off = 0; off < cap; off += PAGE) {
    const rows = await (await rest(`search_listings_ar?select=listing_id,source_table&${qs}&order=source_table.asc,listing_id.asc`, { Range: `${off}-${off + PAGE - 1}` })).json();
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) ids.add(`${row.source_table}:${row.listing_id}`);
    if (rows.length < PAGE) break;
  }
  return ids;
};
const rpcTotal = async (body: any): Promise<number> => {
  // count-only replay: total_count rides on every row, so p_limit 1 answers the same question without pulling 1,500 rows
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/location_search_candidates_ar`, { method: 'POST', headers: H, body: JSON.stringify({ ...body, p_per_platform: null, p_limit: 1, p_offset: 0 }) });
  if (!r.ok) throw new Error(`RPC total: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);   // an error body is never a count
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`RPC did not return rows: ${JSON.stringify(j).slice(0, 160)}`);
  return j.length ? Number(j[0]?.total_count ?? NaN) : 0;
};
// The search RPC is paged with p_offset in steps of its p_limit; total_count rides on every row.
const rpcIds = async (body: any, cap: number): Promise<{ ids: string[]; total: number }> => {
  const ids: string[] = [];
  const PAGE = 1000;
  let total = 0;
  for (let off = 0; off < cap; off += PAGE) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/location_search_candidates_ar`, {
      method: 'POST', headers: H, body: JSON.stringify({ ...body, p_per_platform: null, p_limit: PAGE, p_offset: off }),
    });
    if (!r.ok) throw new Error(`RPC page ${off}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);   // never an empty page
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(`RPC page ${off} unreadable: ${JSON.stringify(rows).slice(0, 160)}`);
    if (off === 0) total = rows.length ? Number(rows[0]?.total_count ?? NaN) : 0;
    for (const x of rows) ids.push(`${x.source_table}:${x.listing_id}`);
    if (rows.length < PAGE || ids.length >= total) break;
  }
  return { ids, total };
};

const browser = await chromium.launch({
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors',
         ...(process.env.HTTPS_PROXY ? ['--disable-quic', '--ssl-version-max=tls1.2'] : [])],
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  locale: 'ar-SA',
  viewport: VIEWPORT,
  ...(MOBILE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
});
const page = await ctx.newPage();

// Requests and responses are paired by the request OBJECT, never by RPC name: several
// location_search_candidates_ar calls can be in flight at once, and name-matching silently pairs a
// body with somebody else's totals.
const searches: { body: any; total: number | null; rows: string[] }[] = [];
const origins = new Set<string>();
page.on('response', async (r) => {
  if (!r.url().includes('/rpc/location_search_candidates_ar') || r.request().method() !== 'POST') return;
  try { origins.add(new URL(r.url()).origin); } catch { /* origin check below fails loudly */ }
  try {
    const j = await r.json();
    if (!Array.isArray(j)) return;
    searches.push({ body: JSON.parse(r.request().postData() || '{}'), total: j.length ? Number(j[0]?.total_count ?? NaN) : 0,
      rows: j.map((x: any) => `${x.source_table}:${x.listing_id}`) });   // what the APP received — not a Node replay
  } catch { /* a body we could not read is not a search we can assert on */ }
});

const tap = async (txt: string, timeoutMs = 10000) => {
  const until = Date.now() + timeoutMs;
  let box: any = null;
  while (Date.now() < until) {
    box = await page.evaluate(CLICK_LEAF, txt);
    if (box) break;
    await page.waitForTimeout(300);
  }
  if (!box) throw new Error(`control never rendered: ${txt}`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(900);
};
const scrollToBottom = async () => {
  await page.evaluate(() => {
    [...document.querySelectorAll('*')]
      .filter((e: any) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY))
      .forEach((e: any) => { e.scrollTop = e.scrollHeight; });
  });
  await page.waitForTimeout(1200);
};
const waitForSearch = async (countBefore: number, maxMs = 30000) => {
  const until = Date.now() + maxMs;
  while (searches.length === countBefore && Date.now() < until) await page.waitForTimeout(500);
  return searches.length > countBefore;
};
// A landed RPC response is not yet a landed TURN: the results bubble morphs in after the searching
// status (typed intro, card drip), so pills/headlines are read only once the transcript shows the
// expected number of headlines — never on a fixed sleep, which read pills=0 on a turn that had
// simply not rendered yet.
const waitForHeadlines = async (atLeast: number, maxMs = 40000): Promise<string[]> => {
  const until = Date.now() + maxMs;
  let hs: string[] = await page.evaluate(READ_HEADLINES);
  while (hs.length < atLeast && Date.now() < until) { await page.waitForTimeout(700); hs = await page.evaluate(READ_HEADLINES); }
  return hs;
};
const readCard = () => page.evaluate(() => {
  const card = document.querySelector('[data-testid="af-card"]');
  const q = card?.querySelector('[data-testid="af-question-title"]')?.textContent?.trim() ?? null;
  const chipTxt = card?.querySelector('[data-testid="af-count-chip"]')?.textContent ?? null;
  const d = chipTxt ? chipTxt.replace(/[٠-٩]/g, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[^\d]/g, '') : '';
  return { hasCard: !!card, q, chip: d ? parseInt(d, 10) : null, hasSkip: !!card?.querySelector('[data-testid="af-skip"]'), hasConfirm: !!card?.querySelector('[data-testid="af-confirm"]') };
});
const readCardUntil = async (pred: (s: any) => boolean, timeoutMs = 12000) => {
  const until = Date.now() + timeoutMs;
  let last = await readCard();
  while (Date.now() < until) { if (pred(last)) return last; await page.waitForTimeout(350); last = await readCard(); }
  return last;
};
// The offer sits behind the agent's own LLM turn, whose latency is variable — see
// scripts/lib/afOfferLive.ts for the 2026-09-03 CI failure that moved this out of three private
// copies of a 16-second poll. `reason` matters: 'no-turn' means the agent never answered (not a
// verdict about AF), 'absent' means the turn landed and the offer genuinely never rendered.
let lastOffer: OfferResult | null = null;
const openOffer = async (): Promise<boolean> => {
  lastOffer = await openAfOffer(page);
  return lastOffer.opened;
};
const countPills = () => page.evaluate(() => document.querySelectorAll('[data-testid^="af-pill-"]').length);
const pillLabels = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="af-pill-"]')].map((e: any) => (e.textContent || '').trim()));
/** The summary line above the pill row: the first child of the pills' wrapper that is NOT the row. */
const readSummaryLine = () => page.evaluate(() => {
  const pill = document.querySelector('[data-testid="af-pill-0"]');
  const row = pill?.parentElement, wrap = row?.parentElement;
  if (!pill || !row || !wrap) return null;
  const first = wrap.firstElementChild as any;
  if (!first || first === row) return null;
  return (first.textContent || '').trim() || null;
});
// The summary block renders the committed facet labels themselves (buildAfSummary — «+١ حمامات 🚿»),
// with no textual prefix in the DOM; it is mounted only while facets exist, so "gone" is proven by
// the exact summary text being absent AND the pill row being absent (both asserted below).
const countLeafText = (txt: string) => page.evaluate((t) =>
  [...document.querySelectorAll('div,span,p')].filter((e: any) => e.children.length === 0 && (e.textContent || '').trim() === t).length, txt);

const afValues = (body: any) => afKeysOn(body).map((k) => `${k}=${JSON.stringify(body[k])}`).join(', ') || '(none)';

let B0: any = null, B1: any = null, B2: any = null, B_DECOY: any = null;
let N0: number | null = null, N1: number | null = null, N2: number | null = null;
let answeredTitle: string | null = null, reofferedTitle: string | null = null;
let chipAfterSelect: number | null = null;
let headlinesBefore: string[] = [], headlinesAfter: string[] = [];
let summaryLine: string | null = null, summaryAfter = -1, pillsAfter = -1;
let replayN2: number = NaN, oracleN2: number | null = null;
let ROWS2: string[] = [], cardsDelta = -1;

try {
  console.log(`── scope: ${CITY} · ${GROUP} · ${TYPE} · ${DEAL} · ${MOBILE ? 'MOBILE 390x844' : 'desktop 1440x900'} ──\n`);
  await gotoLive(page, `${BASE}/`, { timeout: 60000 });
  await page.waitForTimeout(5000);

  // ── 0. a DECOY search first, in another city — so "restore the pre-AF search" is provably the
  //      LAST search and not merely any earlier query the store once held. Without it, a rebuild
  //      from a stale baseQ and a correct rebuild produce the same body, and the proof is vacuous.
  const DECOY_CITY = CITY === 'الدمام' ? 'جدة' : 'الدمام';
  await page.click('[data-testid="city-input"]');
  await page.fill('[data-testid="city-input"]', DECOY_CITY);
  await tap(DECOY_CITY).catch(() => {});
  await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 6000 }).catch(() => null);
  await tap(GROUP);
  await tap(TYPE);
  const nDecoy = searches.length;
  await tap('بحث');
  check('0. the decoy search (another city, same type) landed first', await waitForSearch(nDecoy, 40000), `${searches.length} request(s)`);
  B_DECOY = searches[searches.length - 1]?.body ?? null;
  await page.waitForTimeout(3000);
  await tap('تعديل البحث').catch(async () => { await page.goBack(); await page.waitForTimeout(2500); });
  await page.waitForTimeout(1500);

  // ── 1. the baseline search (the state the last-pill removal must restore) ────────────────────
  await page.click('[data-testid="city-input"]');
  await page.fill('[data-testid="city-input"]', '');
  await page.type('[data-testid="city-input"]', CITY, { delay: 60 });
  await tap(CITY).catch(() => {});
  await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 6000 }).catch(() => null);
  if (DEAL !== 'buy') {
    // «شراء» is pre-selected and Buy/Rent is multi-select: Rent-only = click «إيجار», then click
    // «شراء» to deselect. Monthly-only = «شهري» (gives both) then «سنوي» (drops annual).
    await tap('إيجار');
    await tap('شراء');
    if (DEAL === 'rent-monthly') { await tap('شهري'); await tap('سنوي'); }
  }
  // the group/type boxes stay selected from the decoy search; re-tapping would TOGGLE them off
  const n0 = searches.length;
  await tap('بحث');
  check('the baseline search landed', await waitForSearch(n0, 40000), `${searches.length} request(s)`);
  await page.waitForTimeout(6000);
  B0 = searches[searches.length - 1]?.body ?? null;
  N0 = searches[searches.length - 1]?.total ?? null;
  check('B0 — the pre-AF request carries NO AF predicate (nothing to restore would be vacuous)',
    R.noAfPredicate(B0), `AF predicates on B0: ${afValues(B0)}`);
  check('B0 — the pre-AF request is the requested scope (city · deal · period)',
    Array.isArray(B0?.p_cities) && B0.p_cities.includes(CITY) && B0?.p_deal === EXPECT_DEAL && (B0?.p_rent_period ?? null) === EXPECT_PERIOD,
    `p_cities=${JSON.stringify(B0?.p_cities)} p_deal=${B0?.p_deal} p_rent_period=${B0?.p_rent_period ?? null} · expected ${CITY} / ${EXPECT_DEAL} / ${EXPECT_PERIOD}`);
  check('N0 — the baseline count is a real number above the AF stop threshold (25)', N0 != null && Number.isFinite(N0) && N0 > 25, `N0=${N0}`);
  check('0. the baseline differs from the decoy in city (so a rebuild from an OLDER query is distinguishable)',
    JSON.stringify(B0?.p_cities) !== JSON.stringify(B_DECOY?.p_cities) && JSON.stringify(B0?.p_types) === JSON.stringify(B_DECOY?.p_types),
    `decoy p_cities=${JSON.stringify(B_DECOY?.p_cities)} baseline p_cities=${JSON.stringify(B0?.p_cities)}`);
  console.log(`      [diag] B0 non-AF keys: ${Object.keys(B0 ?? {}).filter((k) => !AF_PREDICATE_KEYS.includes(k)).sort().join(', ')}`);

  // ── 2. commit exactly ONE answer: first option of the first question, then Skip the rest ───────
  const turnsBeforeRound = (await waitForHeadlines(1)).length;
  const opened = await openOffer();
  if (!opened && lastOffer && !lastOffer.opened && lastOffer.reason === 'no-turn') {
    // The agent never produced a results turn inside the budget. That says nothing about whether
    // AF would have been offered, so recording it as a failed AF rule would be a false alarm —
    // and recording it as a pass would be worse. Neither: report it unverified and stop.
    check('the AF offer «خلّنا نحدد الطلب أكثر» is present on the baseline turn', false,
      `NOT VERIFIED — the agent produced no results turn within ${lastOffer.waitedMs}ms, so the ` +
      `offer could not be looked for. This is a dependency timeout, not an AF verdict.`);
    throw new Error('agent produced no results turn — AF offer could not be evaluated');
  }
  check('the AF offer «خلّنا نحدد الطلب أكثر» is present on the baseline turn', opened,
    opened ? `waited ${lastOffer && lastOffer.opened ? lastOffer.waitedMs : 0}ms`
           : `the results turn landed but NO offer rendered on it within ${lastOffer?.waitedMs}ms ` +
             `(N0=${N0} is above INTERVIEW_STOP_AT, so R4.3/R11.1 cannot explain the absence)`);
  if (!opened) throw new Error('offer absent on the baseline turn');
  const first = await readCardUntil((s) => s.hasCard && s.chip != null && !!s.q, 20000);
  answeredTitle = first.q;
  check('the first question rendered with a title and a resolved header chip', first.hasCard && !!first.q && first.chip != null, JSON.stringify(first));
  check('the first question header chip equals N0 before any selection (R7.1.1)', first.chip === N0, `chip=${first.chip} N0=${N0}`);
  const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="af-option-"]')].map((e) => e.getAttribute('data-testid')));
  check('the first question offers at least one option', opts.length > 0, `options: ${opts.join(', ') || '(none)'}`);
  if (!opts.length) throw new Error('no option rendered on the first question');
  const chosenOption = opts[0]!;
  await page.click(`[data-testid="${chosenOption}"]`);
  const sel = await readCardUntil((s) => s.chip != null && s.chip !== first.chip, 15000);
  chipAfterSelect = sel.chip;
  console.log(`      [diag] answered «${answeredTitle}» with ${chosenOption}; chip ${first.chip} → ${sel.chip}`);
  const nBeforeRound = searches.length;
  const confirm = await page.$('[data-testid="af-confirm"]');
  check('the question footer offers متابعة after a selection (R8.3.1)', !!confirm);
  if (confirm) await confirm.click();
  // Skip every remaining question of the round (R8.1.1: zero predicate each), until the round ends
  // and a search lands. Bounded: a round asks at most AF_ROUND_MAX_QUESTIONS = 4.
  let skips = 0, prevQ = first.q;
  for (let step = 0; step < 8 && searches.length === nBeforeRound; step++) {
    const st = await readCardUntil((s) => (s.hasCard && s.q !== prevQ && s.hasSkip) || searches.length > nBeforeRound, 20000);
    if (searches.length > nBeforeRound) break;
    if (!st.hasCard || !st.hasSkip) break;
    prevQ = st.q;
    await page.click('[data-testid="af-skip"]');
    skips++;
    await page.waitForTimeout(800);
  }
  check('the round ended and produced a new results turn (one answer committed, the rest skipped)',
    await waitForSearch(nBeforeRound, 30000), `${skips} skip(s) after the one committed answer`);
  check('the narrowed results turn rendered in the transcript', (await waitForHeadlines(turnsBeforeRound + 1)).length >= turnsBeforeRound + 1);
  await page.waitForTimeout(2500);

  // If the round somehow left more than one removable pill, trim to ONE the way the sibling
  // journey does, asserting each intermediate removal — never silently.
  let pills = await countPills();
  for (let guard = 0; pills > 1 && guard < 6; guard++) {
    const before = searches[searches.length - 1];
    const n = searches.length;
    await scrollToBottom();
    await page.click('[data-testid="af-pill-0"]');
    const hs = (await page.evaluate(READ_HEADLINES)).length;
    check(`trim — removing pill 0 of ${pills} re-ran the search`, await waitForSearch(n, 30000));
    await waitForHeadlines(hs + 1);
    await page.waitForTimeout(2500);
    const after = searches[searches.length - 1];
    check('trim — exactly ONE committed facet left the request (R9.2.1)', R.droppedExactlyOne(before?.body, after?.body), `${afValues(before?.body)} → ${afValues(after?.body)}`);
    check('trim — every surviving predicate is byte-identical (R9.2.1)', R.survivorsIntact(before?.body, after?.body));
    check('trim — the normal-filter scope is untouched (R9.2.2)', movedNonAfKeys(before?.body, after?.body).length === 0, movedNonAfKeys(before?.body, after?.body).join(', ') || 'identical');
    check('trim — the count widened or held (R9.2.2)', R.widenedOrHeld(before?.total ?? null, after?.total ?? null), `${before?.total} → ${after?.total}`);
    const p2 = await countPills();
    check('trim — exactly one pill left the row', p2 === pills - 1, `${pills} → ${p2}`);
    pills = p2;
  }
  B1 = searches[searches.length - 1]?.body ?? null;
  N1 = searches[searches.length - 1]?.total ?? null;
  const labels = await pillLabels();
  check('exactly ONE removable pill is on screen', pills === 1, `pills=${pills} labels=${JSON.stringify(labels)}`);
  check('B1 — the committed request carries exactly ONE question\'s predicate (skips wrote nothing, R8.1.1)',
    R.exactlyOneFacet(B1), `facets=${JSON.stringify(facetsOn(B1))} · ${afValues(B1)}`);
  check('N1 < N0 — the one committed answer genuinely narrowed', R.narrowed(N0, N1), `N0=${N0} N1=${N1}`);
  check('R7.1.2 — the header chip shown for the tentative selection equals the count that landed',
    R.chipMatchesLanded(chipAfterSelect, N1), `chip=${chipAfterSelect} N1=${N1}`);
  check('B1 — the normal-filter scope did not move when the answer was committed',
    R.scopeRestored(B0, B1), movedNonAfKeys(B0, B1).map((k) => `${k}: ${JSON.stringify(B0?.[k])} → ${JSON.stringify(B1?.[k])}`).join(' · ') || 'identical');

  // Bonus DB-truth on the narrowed state, so the N1 the mutation below relies on is itself proven.
  {
    const { qs, unhandled } = await oracleQS(B1);
    if (unhandled.length) skip('N1 — the independent oracle agrees with the narrowed count', `oracle INCONCLUSIVE: ${unhandled.join(' | ')}`);
    else { const oc = await oracleCount(qs); check('N1 — the independent oracle agrees with the narrowed count (R7.5.1)', oc === N1, `oracle=${oc} rpc=${N1}`); }
  }

  // ── 3. snapshot the screen before the removal ─────────────────────────────────────────────────
  headlinesBefore = await page.evaluate(READ_HEADLINES);
  summaryLine = await readSummaryLine();
  const summaryBefore = summaryLine ? await countLeafText(summaryLine) : 0;
  check('the «بناءً على» summary line is rendered above the pill before the removal', !!summaryLine && summaryBefore >= 1, `summary=${JSON.stringify(summaryLine)} occurrences=${summaryBefore}`);
  console.log(`      [diag] headlines before removal: ${JSON.stringify(headlinesBefore)}`);
  check('the transcript shows both the baseline turn and the narrowed turn before the removal',
    headlinesBefore.length >= 2 && toNum(headlinesBefore[headlinesBefore.length - 1] ?? '') === N1, `last=${headlinesBefore[headlinesBefore.length - 1]} N1=${N1}`);

  // ── 4. remove the LAST pill ───────────────────────────────────────────────────────────────────
  const nBeforeRemoval = searches.length;
  await scrollToBottom();
  let cardsBeforeRemoval: number = await page.evaluate(COUNT_CARDS);
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); const n: number = await page.evaluate(COUNT_CARDS); if (n === cardsBeforeRemoval) break; cardsBeforeRemoval = n; }
  await page.click('[data-testid="af-pill-0"]');
  check('R9.2.2 — removing the last pill re-runs the search (a new request was actually sent)', await waitForSearch(nBeforeRemoval, 30000));
  await waitForHeadlines(headlinesBefore.length + 1);
  await page.waitForTimeout(2500);
  B2 = searches[searches.length - 1]?.body ?? null;
  N2 = searches[searches.length - 1]?.total ?? null;
  ROWS2 = searches[searches.length - 1]?.rows ?? [];
  {
    let cardsNow: number = await page.evaluate(COUNT_CARDS);
    for (let i = 0; i < 10; i++) { await page.waitForTimeout(600); const n: number = await page.evaluate(COUNT_CARDS); if (n === cardsNow) break; cardsNow = n; }
    cardsDelta = cardsNow - cardsBeforeRemoval;
  }
  check('R10.1.1 — the restored turn\'s page 0 is complete (the app received min(N2, buffer) rows, no short page)',
    R.pageZeroComplete(ROWS2.length, N2, PAGE0_BUFFER), `rows=${ROWS2.length} N2=${N2} buffer=${PAGE0_BUFFER}`);
  check('R9.2.2 — the restored turn RENDERED exactly the first page of cards under the N0 headline (not the narrowed turn\'s cards, not none)',
    R.renderedFirstPage(cardsDelta, N2, FIRST_PAGE), `new cards=${cardsDelta} expected=${N2 == null ? '?' : Math.min(N2, FIRST_PAGE)}`);

  // ── 5. the assertions, on the request the browser actually sent and the turn that landed ──────
  check('R9.2.1 — B2 carries ZERO AF predicates', R.noAfPredicate(B2), `AF predicates on B2: ${afValues(B2)}`);
  const moved = movedNonAfKeys(B0, B2);
  check('R9.2.2 — every non-AF key of B2 equals B0 byte-for-byte (city/type/deal/period/beds/price/area/tables/category)',
    R.scopeRestored(B0, B2), moved.map((k) => `${k}: ${JSON.stringify(B0?.[k])} → ${JSON.stringify(B2?.[k])}`).join(' · ') || `${Object.keys(B0 ?? {}).length} keys identical (rotation seed excepted)`);
  check('R9.2.2 — N2 == N0 exactly (the count returned to the pre-AF search)', R.countRestored(N0, N2), `N0=${N0} N1=${N1} N2=${N2}`);

  replayN2 = await rpcTotal(B2).catch((e) => { console.log(`      [diag] replay error: ${e.message}`); return NaN; });
  check('R9.2.2 — anon replay of B2 returns N2 (the landed number is reproducible)', Number.isFinite(replayN2) && replayN2 === N2, `replay=${replayN2} ui/rpc=${N2}`);

  {
    const { qs, unhandled } = await oracleQS(B2);
    if (unhandled.length) {
      check('R7.5.1 — the independent oracle count for B2 == N2', false, `oracle INCONCLUSIVE (unhandled: ${unhandled.join(' | ')}) — a request the oracle cannot translate is a red, not a pass`);
    } else {
      oracleN2 = await oracleCount(qs);
      check('R7.5.1 — the independent oracle count for B2 == N2', oracleN2 === N2, `oracle=${oracleN2} rpc=${N2}`);
      // "clicking it must return exactly the correct listings": the ID set, not just the number.
      const CAP = 30000;
      if (N2 != null && N2 <= CAP) {
        const [o, r] = await Promise.all([oracleIds(qs, CAP), rpcIds(B2, CAP)]);   // 2 in flight, never more
        const rs = new Set(r.ids);
        const missing = [...o].filter((i) => !rs.has(i)), extra = r.ids.filter((i) => !o.has(i)), dupes = r.ids.length - rs.size;
        check('R9.2.2 — the restored search returns EXACTLY the oracle\'s listings (missing = extra = duplicates = 0, count matches)',
          missing.length === 0 && extra.length === 0 && dupes === 0 && r.total === o.size && o.size === N2,
          `rpc_total=${r.total} rpc_ids=${r.ids.length} oracle=${o.size} N2=${N2} MISSING=${missing.length} EXTRA=${extra.length} DUPES=${dupes}` +
          (missing.length ? ` · first missing: ${missing.slice(0, 3).join(', ')}` : '') + (extra.length ? ` · first extra: ${extra.slice(0, 3).join(', ')}` : ''));
        const offApp = ROWS2.filter((id) => !o.has(id));
        check('R9.2.2 — every row the APP itself received on the restored turn is in the oracle set, none duplicated (the browser\'s response, not a replay)',
          R.appRowsInOracle(ROWS2, o), offApp.length ? `${offApp.length} outside the oracle, sample ${offApp.slice(0, 3).join(', ')}` : `${ROWS2.length} app rows ⊆ ${o.size} oracle rows, ${new Set(ROWS2).size} distinct`);
      } else skip('R9.2.2 — the restored search returns EXACTLY the oracle\'s listings', `N2=${N2} exceeds the ${CAP}-row paging cap`);
    }
  }

  pillsAfter = await countPills();
  check('R9.1.1 — no pill remains after the last one is removed', R.noPillRemains(pillsAfter), `pills=${pillsAfter}`);
  summaryAfter = summaryLine ? await countLeafText(summaryLine) : -1;
  check('R9.1.1 — the summary block is gone with its last pill (its text is nowhere on screen, and the pill row is gone)', summaryLine != null && R.summaryGone(summaryAfter) && pillsAfter === 0, `occurrences of ${JSON.stringify(summaryLine)}: ${summaryAfter} · pills=${pillsAfter}`);

  headlinesAfter = await page.evaluate(READ_HEADLINES);
  console.log(`      [diag] headlines after removal: ${JSON.stringify(headlinesAfter)}`);
  check('R9.2.2 — nothing above was rewritten (every earlier headline is still there, in place)', R.nothingAboveRewritten(headlinesBefore, headlinesAfter),
    headlinesBefore.filter((h, i) => headlinesAfter[i] !== h).length ? `changed: ${JSON.stringify(headlinesBefore.filter((h, i) => headlinesAfter[i] !== h))}` : `${headlinesBefore.length} earlier headline(s) intact`);
  check('R9.2.2 — exactly one NEW results turn landed below, carrying N0', R.newTurnLandedWith(headlinesBefore, headlinesAfter, N0),
    `before=${headlinesBefore.length} after=${headlinesAfter.length} last=${headlinesAfter[headlinesAfter.length - 1] ?? '(none)'} N0=${N0}`);

  // ── 6. the removed question is offerable again, and it is the SAME question ───────────────────
  const reopened = await openOffer();
  check('R9.2.3 — the offer «خلّنا نحدد الطلب أكثر» is present again after the removal', reopened, reopened ? '' : 'no offer on the restored turn — the removed question may have stayed in the asked carry');
  if (reopened) {
    const again = await readCardUntil((s) => s.hasCard && !!s.q && s.chip != null, 20000);
    reofferedTitle = again.q;
    check('R9.2.3 — re-opening AF asks the SAME first question that was answered (not burned)', R.sameQuestionReoffered(answeredTitle, reofferedTitle), `answered=${JSON.stringify(answeredTitle)} reoffered=${JSON.stringify(reofferedTitle)}`);
    check('R7.1.1 — the re-offered question\'s header chip equals N0 (the restored eligible set)', again.chip === N0, `chip=${again.chip} N0=${N0}`);
  }

  check('the journey exercised the expected production backend', origins.size === 1 && origins.has(new URL(SUPABASE_URL).origin), `saw ${[...origins].join(', ') || '(none)'}, expected ${new URL(SUPABASE_URL).origin}`);

  // ── MUTATION PROOFS ─────────────────────────────────────────────────────────────────────────
  // Each takes the REAL captured artefacts and breaks exactly the property one assertion exists to
  // protect, then requires that assertion to return false. Values are DERIVED from the capture so a
  // mutation can never coincide with the real value and pass vacuously.
  console.log('\n── MUTATION PROOFS (each must turn the paired assertion RED) ──');
  const mut = (label: string, ok: boolean, detail = '') => check(`MUTATION — ${label}`, ok, detail);
  const afKeys1 = afKeysOn(B1);
  const leftover = Object.fromEntries(afKeys1.map((k) => [k, B1[k]]));
  mut('a leftover predicate on B2 is caught by noAfPredicate', afKeys1.length > 0 && !R.noAfPredicate({ ...B2, ...leftover }), `re-added ${afValues(leftover)}`);
  mut('N2 != N0 (off by one) is caught by countRestored', N0 != null && !R.countRestored(N0, N0 + 1) && !R.countRestored(N0, N0 - 1));
  mut('an app row outside the oracle set is caught by appRowsInOracle', !R.appRowsInOracle([...ROWS2, '__foreign_listings:0'], new Set(ROWS2)));
  mut('a duplicated app row is caught by appRowsInOracle', ROWS2.length > 0 && !R.appRowsInOracle([...ROWS2, ROWS2[0]], new Set(ROWS2)));
  mut('an empty app response under a non-zero headline is caught by appRowsInOracle', !R.appRowsInOracle([], new Set(ROWS2)));
  mut('a short page 0 (one row fewer) is caught by pageZeroComplete', N2 != null && !R.pageZeroComplete(Math.min(N2, PAGE0_BUFFER) - 1, N2, PAGE0_BUFFER));
  mut('a restored turn that rendered NO cards is caught by renderedFirstPage', N2 != null && N2 > 0 && !R.renderedFirstPage(0, N2, FIRST_PAGE));
  mut('a restored turn that rendered one card too many/few is caught by renderedFirstPage',
    N2 != null && !R.renderedFirstPage(Math.min(N2, FIRST_PAGE) + 1, N2, FIRST_PAGE) && !R.renderedFirstPage(Math.min(N2, FIRST_PAGE) - 1, N2, FIRST_PAGE));
  if (B_DECOY) mut('a rebuild from an OLDER query (the decoy city) is caught by scopeRestored', !R.scopeRestored(B0, { ...B2, p_cities: B_DECOY.p_cities }));
  mut('a scope key moved by the rebuild is caught by scopeRestored',
    !R.scopeRestored(B0, { ...B2, p_cities: [...(B2?.p_cities ?? []), '__not_a_city__'] }) && !R.scopeRestored(B0, { ...B2, p_deal: `${B2?.p_deal}__mutated__` }));
  mut('a dropped non-AF key (e.g. p_tables) is caught by scopeRestored', B0?.p_tables != null && !R.scopeRestored(B0, { ...B2, p_tables: null }));
  mut('a surviving pill is caught by noPillRemains', !R.noPillRemains(1));
  mut('a surviving summary line is caught by summaryGone', !R.summaryGone(1));
  mut('an earlier headline rewritten in place is caught by nothingAboveRewritten',
    headlinesBefore.length > 0 && !R.nothingAboveRewritten(headlinesBefore, headlinesAfter.map((h, i) => (i === 0 ? `لقينا ${(N0 ?? 0) + 1} إعلان يطابق طلبك.` : h))));
  mut('a turn that landed with N1 instead of N0 is caught by newTurnLandedWith',
    headlinesBefore.length > 0 && !R.newTurnLandedWith(headlinesBefore, [...headlinesBefore, `لقينا ${N1} إعلان يطابق طلبك.`], N0) && !R.newTurnLandedWith(headlinesBefore, headlinesBefore, N0));
  mut('a burned question (different title re-offered) is caught by sameQuestionReoffered',
    !!answeredTitle && !R.sameQuestionReoffered(answeredTitle, `${answeredTitle} ✗`) && !R.sameQuestionReoffered(answeredTitle, null));
  mut('a chip that disagrees with the landed count is caught by chipMatchesLanded', N1 != null && !R.chipMatchesLanded(N1 + 1, N1));
  // ADD a second question's key on top of the real one (the group is chosen so it is not the one
  // B1 already carries — otherwise the "mutation" would just re-answer the same question).
  const secondFacetKey = facetsOn(B1).includes('furnished') ? 'p_bath_min' : 'p_furnished';
  mut('a second facet on B1 is caught by exactlyOneFacet', !R.exactlyOneFacet({ ...B1, [secondFacetKey]: secondFacetKey === 'p_furnished' ? true : 3 }), `added ${secondFacetKey}`);
  mut('an answer that did not narrow is caught by narrowed', !R.narrowed(N0, N0));
  mut('a survivor dropped alongside the removed facet is caught by droppedExactlyOne', !R.droppedExactlyOne({ ...B1, p_furnished: B1?.p_furnished == null ? true : null }, B2));
  mut('a survivor whose value changed is caught by survivorsIntact', afKeys1.length > 0 && !R.survivorsIntact(B1, { ...B1, [afKeys1[0]!]: '__mutated__' }));

  // REAL-RPC MUTATION: add the removed predicate back onto B2 and require the backend to answer N1,
  // NOT N0. This is what makes the DB-truth checks above sensitive to the body: if production
  // returned N0 regardless of the predicate, "replay returns N2" would pass no matter what the client
  // sent, and the whole restoration claim would be decoration.
  if (afKeys1.length) {
    const reAdded = await rpcTotal({ ...B2, ...leftover }).catch((e) => { console.log(`      [diag] re-add error: ${e.message}`); return NaN; });
    check('MUTATION — adding the removed predicate back onto B2 makes the backend answer N1, not N0 (the restoration is body-sensitive)',
      Number.isFinite(reAdded) && reAdded === N1 && reAdded !== N0, `B2+${afValues(leftover)} → ${reAdded} · N1=${N1} N0=${N0}`);
  } else check('MUTATION — real-RPC re-add of the removed predicate', false, 'B1 carried no AF key to re-add — nothing to prove against');
} catch (e: any) {
  check('the journey completed without a harness error', false, e.message);
} finally {
  await ctx.close();
  await browser.close();
}

console.log(failures
  ? `\n✗ ${failures} check(s) FAILED:\n` + failedLabels.map((l) => `    • ${l}`).join('\n') + '\n'
  : '\n✓ removing the LAST AF pill returns the user to exactly the pre-AF search: same request, same count, same listings, same question re-offered\n');
process.exit(failures ? 1 : 0);
