// CHANGING DEAL OR RENT PERIOD UNDER COMMITTED ADVANCED-FILTER ANSWERS, PROVEN IN A REAL BROWSER
// AGAINST PRODUCTION.
//
// WHAT THIS EXISTS FOR
// --------------------
// A committed AF answer is a predicate the user can no longer see once they are back on the Filter
// screen — except as the carried chips src/lib/afCarry.ts renders. That screen can move the COHORT
// under those answers: شراء → إيجار, سنوي → شهري, or both periods at once. The certification rule is
// R2.1.1 / R2.3.1 (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md): a question exists for a
// (type × deal × period) triple only if COHORT_QUESTIONS certifies it there, and a 'both'-period
// scope is the INTERSECTION of RentAnnual and RentMonthly. The shared SQL predicates are
// strict-NULL-excluding (R2.2.2), so an answer that outlives its cohort does not narrow honestly —
// it deletes every row whose source never stated the attribute: UNKNOWN turned into No. The
// opposite error is just as real: an answer the new cohort DOES certify must ride along byte-
// identical, or the search silently WIDENS past what the user asked for (owner P0 2026-09-01,
// measured 243 → 566 on re-entry).
//
// RULES PROVED HERE, on the request the browser actually sends and the turn that actually lands:
//   R2.1.1 / R2.3.1  every AF predicate on the post-change request belongs to a question the NEW
//                    cohort certifies — executed through the REAL gate, cohortAllows() /
//                    certifiedAmenityKeys() from src/lib/afCohorts.ts, never a hand-copied list
//   afCarry §carry   every committed predicate the new cohort certifies SURVIVED, same value
//   afCarry §prune   every committed predicate the new cohort does NOT certify is ABSENT
//   §13 (never)      no predicate appears that the user never committed (nothing resurrected,
//                    nothing invisible)
//   R1.5.1           the 'both'-period request really carries p_rent_period = 'كلاهما'
//   R7.4.1 / R7.5.1  the headline == the search RPC's total_count == an anon replay of the same
//                    body == the INDEPENDENT PostgREST oracle over search_listings_ar, and the
//                    paged ID sets agree exactly (MISSING = EXTRA = DUPLICATES = 0)
//
// THE DEFECT CLASS: a stale predicate crossing a deal/period boundary, a certified predicate dropped
// by the carry, a predicate resurrected from the store, a certification map that diverges from
// what the search sends, or a count that is not DB truth after the scope moved.
//
// THE JOURNEY (one browser, one conversation, four searches):
//   B1  الرياض · شقة · شراء → open AF, walk ONE round committing the FIRST option of EVERY question
//       offered (Apartment/Buy certifies property_age, amenities, bathrooms, direction)
//   B2  back to the Filter → إيجار, then شراء off (Rent-only, سنوي pre-selected) → بحث
//       assertions run against cohortAllows(Apartment/Rent/annual): direction must go, the rest stay
//   B3  back → شهري on top of سنوي (rentPeriod 'both') → بحث              ← Journey B, from Annual
//       assertions against cohortAllows(Apartment/Rent/both): only amenities + bathrooms survive
//   B4  back → سنوي off (Monthly-only) → بحث
//       assertions against cohortAllows(Apartment/Rent/monthly): rating/unit_subtype/amenities/
//       bathrooms certified — of the committed set, again only amenities + bathrooms may remain
// Ordered Buy → Annual → Both → Monthly (rather than Annual → Monthly → Annual → Both) so the
// 'both' leg starts from Annual exactly as specified, with one fewer production search.
//
// EVERY EXPECTATION IS DERIVED FROM THE CAPTURED B1, NOT NAMED IN ADVANCE. If the round committed
// nothing, or committed nothing the next cohort drops (or nothing it keeps), the run says so and
// FAILS: a transition with no survivor and no casualty proves neither half of the rule.
//
// LIVE CHECK — excluded from `npm test` (it drives a real browser against production).
//
// Run:  PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium node --experimental-strip-types \
//         scripts/verify-af-scope-change-live.ts
// Knobs: AF_SCOPE_CITY (الرياض) · AF_SCOPE_GROUP (الشقق والسكن المشترك) · AF_SCOPE_TYPE (شقة) ·
//        AF_SCOPE_CLEAN (Apartment — the clean type the cohort gate is asked about; must map to
//        AF_SCOPE_TYPE, and the run checks that against the captured body) · AF_SCOPE_MOBILE=1

// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { chromium } from 'playwright';
import { gotoLive } from './lib/liveNav.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { buildOracleQS } from './lib/afOracleFilter.ts';
import { loadDirectionVariants } from './lib/afOracleLive.ts';
import { cohortAllows, certifiedAmenityKeys } from '../src/lib/afCohorts.ts';
import { CLEAN_TO_TYPE_AR } from '../src/data/propertyTypes.ts';
import type { SearchQuery } from '../src/data/search.ts';

const BASE = 'https://ezhalah-app.vercel.app';
const { url: SUPABASE_URL, key: ANON_KEY } = resolvePublicSupabase(process.env);
const H = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

const CITY = process.env.AF_SCOPE_CITY || 'الرياض';
const GROUP = process.env.AF_SCOPE_GROUP || 'الشقق والسكن المشترك';
const TYPE = process.env.AF_SCOPE_TYPE || 'شقة';
const CLEAN = process.env.AF_SCOPE_CLEAN || 'Apartment';
const MOBILE = process.env.AF_SCOPE_MOBILE === '1';
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 };

// ── the cohort gate, asked exactly the way production asks it ────────────────────────────────────
// SearchQuery shape per src/data/search.ts. Only the fields cohortAllows() reads matter (deal,
// category, types, rentPeriod); the rest are the empty defaults so the object is a real SearchQuery.
const scopeQuery = (deal: 'Buy' | 'Rent', rentPeriod: 'annual' | 'monthly' | 'both'): SearchQuery => ({
  deal, category: 'Residential', types: [CLEAN], rentPeriod,
  location: '', type: null, detail: null, priceInput: '', priceBand: null,
});

// request key → AF question id (src/data/remote.ts ~421-431 is where each question's apply() lands
// on the wire). p_amenities is a BAG three questions write into — the amenities chips, the furnished
// chip (token 'furnished'), and rnpl (token 'rnpl') — so it is split into one atom per token below.
const KEY_QUESTION: Record<string, string> = {
  p_bath_min: 'bathrooms', p_bath_exact: 'bathrooms',
  p_age_min: 'property_age', p_age_max: 'property_age', p_is_new_construction: 'property_age', p_age_unknown: 'property_age',
  p_furnished: 'furnished',
  p_street_width_min: 'street_width', p_street_width_max: 'street_width',
  p_directions: 'direction',
  p_rating_min: 'rating', p_reviews_min: 'rating',
  p_unit_subtypes: 'unit_subtype',
};
const RNPL_TOKENS = new Set(['rnpl', 'rent_now_pay_later']);

/** One AF predicate, small enough to be certified on its own: `p_bath_min`, `p_amenities:kitchen`, … */
type Atoms = Record<string, string>;            // atom → JSON-encoded value
const atomsOf = (body: any): Atoms => {
  const out: Atoms = {};
  for (const k of Object.keys(KEY_QUESTION)) {
    const v = body?.[k];
    if (v == null || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = JSON.stringify(v);
  }
  for (const tok of (Array.isArray(body?.p_amenities) ? body.p_amenities : [])) out[`p_amenities:${tok}`] = 'true';
  return out;
};
const tokenOf = (atom: string) => (atom.startsWith('p_amenities:') ? atom.slice('p_amenities:'.length) : null);
const questionOf = (atom: string): string => {
  const tok = tokenOf(atom);
  if (tok != null) return RNPL_TOKENS.has(tok) ? 'rnpl' : 'amenities';
  return KEY_QUESTION[atom] ?? '(unmapped)';
};

/** The certification gate as an injectable pair, so the mutation block can hand in a FAKE one. */
type Gate = { allows: (q: SearchQuery, id: string) => boolean; amenityKeys: (q: SearchQuery) => string[] };
const REAL_GATE: Gate = { allows: cohortAllows, amenityKeys: certifiedAmenityKeys };
/** Is this one predicate certified for this scope? Per-question for everything, per-TOKEN for the
 *  amenity chips (afCarry.ts certifiedAmenityFacet: a chip certified on one cohort is not thereby
 *  certified on the next; the question-level gate alone is not the token's gate). */
const certified = (q: SearchQuery, atom: string, gate: Gate = REAL_GATE): boolean => {
  const id = questionOf(atom);
  if (!gate.allows(q, id)) return false;
  const tok = tokenOf(atom);
  if (id === 'amenities' && tok != null) return gate.amenityKeys(q).includes(tok);
  return true;
};

let failures = 0;
const failedLabels: string[] = [];
const skippedLabels: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) { failures++; failedLabels.push(label); }
};
// A SKIP is never a pass: it is printed loudly, re-printed in the summary, and only ever used where a
// precondition outside this journey's control makes an assertion INCONCLUSIVE — never to soften one.
const skip = (label: string, reason: string) => {
  console.log(`SKIP  ${label}\n      ${reason}`);
  skippedLabels.push(`${label} — ${reason}`);
};

// ── THE LOAD-BEARING PREDICATES, AS PURE FUNCTIONS ──────────────────────────────────────────────
// Every key the search RPC accepts (pg_proc, 2026-09-02) — a key outside this set is an unknown predicate.
const KNOWN_WIRE_KEYS = new Set(['p_deal', 'p_cities', 'p_districts', 'p_tables', 'p_platforms', 'p_per_platform', 'p_limit', 'p_region_ids', 'p_types',
  'p_price_min', 'p_price_max', 'p_rent_period', 'p_area_min', 'p_area_max', 'p_beds_exact', 'p_beds_min', 'p_bath_min', 'p_furnished', 'p_age_max',
  'p_tenant', 'p_directions', 'p_has_license', 'p_amenities', 'p_offset', 'p_tables2', 'p_types2', 'p_age_min', 'p_bath_exact', 'p_street_width_min',
  'p_street_width_max', 'p_floor_min', 'p_floor_max', 'p_is_new_construction', 'p_category', 'p_sort_by', 'p_age_unknown', 'p_rating_min',
  'p_reviews_min', 'p_unit_subtypes', 'p_price_min_rent', 'p_price_max_rent', 'p_rotation_seed']);
const MONTHLY_ONLY_TABLES = ['gathern_residential_listings', 'aqarmonthly_residential_listings'];
// Non-AF keys that a deal/period change must leave untouched (deal, period and the ordering seed excepted).
// `p_tables` is NOT in this list on purpose: it is deal/period-DERIVED (src/data/remote.ts resTables():
// the two monthly-only sources join exactly when the period scope includes Monthly) — see tablesFollowPeriod.
const NON_AF_STABLE = ['p_cities', 'p_districts', 'p_region_ids', 'p_types', 'p_tables2', 'p_types2', 'p_category', 'p_platforms',
  'p_beds_exact', 'p_beds_min', 'p_area_min', 'p_area_max', 'p_price_min', 'p_price_max', 'p_price_min_rent', 'p_price_max_rent',
  'p_tenant', 'p_has_license', 'p_floor_min', 'p_floor_max', 'p_age_unknown', 'p_bath_exact', 'p_limit', 'p_offset', 'p_per_platform'];

// The live journey calls these on what production actually did; the mutation block calls the SAME
// functions on deliberately corrupted inputs and requires each to return false.
const R = {
  /** R2.1.1 — every predicate on the post-change request belongs to a question this cohort certifies. */
  onlyCertified: (after: Atoms, q: SearchQuery, gate: Gate = REAL_GATE) =>
    Object.keys(after).every((a) => certified(q, a, gate)),
  /** carry — every committed predicate the new cohort certifies is still there, byte-identical. */
  certifiedSurvived: (committed: Atoms, after: Atoms, q: SearchQuery, gate: Gate = REAL_GATE) =>
    Object.keys(committed).filter((a) => certified(q, a, gate)).every((a) => after[a] === committed[a]),
  /** prune — every committed predicate the new cohort does NOT certify is gone. */
  uncertifiedAbsent: (committed: Atoms, after: Atoms, q: SearchQuery, gate: Gate = REAL_GATE) =>
    Object.keys(committed).filter((a) => !certified(q, a, gate)).every((a) => !(a in after)),
  /** §13 — nothing the user never committed appeared (no resurrection, no invisible predicate). */
  nothingInvented: (committed: Atoms, after: Atoms) =>
    Object.keys(after).every((a) => a in committed),
  /** the transition can prove BOTH halves: something must survive and something must be dropped. */
  transitionMeaningful: (committed: Atoms, q: SearchQuery, gate: Gate = REAL_GATE) =>
    Object.keys(committed).some((a) => certified(q, a, gate)) &&
    Object.keys(committed).some((a) => !certified(q, a, gate)),
  /** GATE-INDEPENDENT R2.3.1: on the captured bodies alone, what survives into the BOTH-period scope
   *  must be exactly what survives into Annual AND into Monthly — no cohortAllows() involved. */
  bothIsIntersection: (annual: Atoms, monthly: Atoms, both: Atoms) => {
    const inter = Object.keys(annual).filter((a) => a in monthly).sort();
    return JSON.stringify(Object.keys(both).sort()) === JSON.stringify(inter);
  },
  /** GATE-INDEPENDENT: a scope change may only DROP committed predicates, never add or alter one. */
  onlyDrops: (committed: Atoms, after: Atoms) =>
    Object.keys(after).every((a) => a in committed && after[a] === committed[a]),
  /** whole-body hygiene: no wire key outside the known vocabulary (an invisible predicate on an
   *  unmapped key would otherwise never be seen), and no non-AF value moved except the deal/period. */
  onlyKnownKeys: (body: any) => Object.keys(body ?? {}).every((k) => KNOWN_WIRE_KEYS.has(k)),
  nonAfUnchanged: (b1: any, bn: any) => NON_AF_STABLE.every((k) => JSON.stringify(b1?.[k] ?? null) === JSON.stringify(bn?.[k] ?? null)),
  /** p_tables follows the documented derivation (remote.ts resTables, owner 2026-08-14): the base table set is
   *  B1's exactly, plus the two monthly-only sources IFF the period scope includes Monthly (شهري or كلاهما). */
  tablesFollowPeriod: (b1Tables: unknown, bnTables: unknown, wantsMonthly: boolean) => {
    if (!Array.isArray(b1Tables) || !Array.isArray(bnTables) || b1Tables.length === 0) return false;
    const base = b1Tables.filter((t) => !MONTHLY_ONLY_TABLES.includes(String(t)));
    if (base.length !== b1Tables.length) return false;                       // B1 (Buy) must not carry them
    const want = wantsMonthly ? [...base, ...MONTHLY_ONLY_TABLES] : base;
    return bnTables.length === want.length && want.every((t) => bnTables.includes(t)) && new Set(bnTables).size === bnTables.length;
  },
  /** the normal-filter scope reads exactly as expected (deal/period moved as asked; nothing else did). */
  scopeAs: (body: any, expected: Record<string, unknown>) =>
    Object.entries(expected).every(([k, v]) => JSON.stringify(body?.[k] ?? null) === JSON.stringify(v ?? null)),
  /** R7.4.1 / R7.5.1 — every witness of the count is the same finite number. */
  countsAgree: (...ns: (number | null | undefined)[]) =>
    ns.length > 1 && ns.every((n) => n != null && Number.isFinite(n)) && ns.every((n) => n === ns[0]),
  /** R7.5.1 — the ID sets agree exactly. */
  diffClean: (d: { missing: string[]; extra: string[]; duplicates: string[] }) =>
    d.missing.length === 0 && d.extra.length === 0 && d.duplicates.length === 0,
  /** the Filter screen shows one removable chip per surviving question — visible AND removable, the
   *  only way the carry and the invisible-filter rule reconcile (afCarry.ts header). */
  chipsMatchSurvivors: (chips: number | null, survivors: Atoms) =>
    chips != null && chips === new Set(Object.keys(survivors).map(questionOf)).size,
};

// ── browser helpers (template shape: verify-af-pill-removal-live.ts) ────────────────────────────
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

/** Every «لقينا N إعلان» headline currently rendered, oldest first. Digits may be Arabic-Indic. */
const READ_HEADLINES = () => {
  const out: string[] = [];
  document.querySelectorAll('div,span,p').forEach((e: any) => {
    const t = (e.innerText || '').trim();
    if (!/^لقينا\s+[\d٠-٩,٬]+\s+إعلان/.test(t)) return;
    if (e.children.length > 2) return;
    if (!out.includes(t)) out.push(t);
  });
  return out;
};
const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const toNum = (s: string): number | null => {
  const m = latinDigits(s).match(/لقينا\s*([\d,٬]+)/);
  return m ? Number(m[1].replace(/[,٬]/g, '')) : null;
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

// Requests and responses are paired by the request OBJECT, never by RPC name.
const searches: { body: any; total: number | null }[] = [];
const origins = new Set<string>();
page.on('response', async (r) => {
  if (!r.url().includes('/rpc/location_search_candidates_ar') || r.request().method() !== 'POST') return;
  try { origins.add(new URL(r.url()).origin); } catch { /* origin check below fails loudly */ }
  try {
    const j = await r.json();
    if (!Array.isArray(j)) return;
    searches.push({ body: JSON.parse(r.request().postData() || '{}'), total: j.length ? Number(j[0]?.total_count ?? NaN) : 0 });
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

/** Walk one AF round: first option of every question, confirm, until a NEW search lands. */
const walkOneRound = async (): Promise<boolean> => {
  const before = searches.length;
  await scrollToBottom();
  const opened = await tap('خلّنا نحدد الطلب أكثر').then(() => true)
    .catch(async () => tap('نحدد الطلب أكثر').then(() => true).catch(() => false));
  if (!opened) return false;
  await page.waitForTimeout(3500);
  for (let step = 1; step <= 8 && searches.length === before; step++) {
    const opts = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="af-option-"]')].map((e) => e.getAttribute('data-testid')));
    if (!opts.length) break;
    await page.click(`[data-testid="${opts[0]}"]`);
    await page.waitForTimeout(1400);
    const confirm = await page.$('[data-testid="af-confirm"]');
    if (!confirm) break;
    await confirm.click();
    await page.waitForTimeout(3800);
  }
  for (let i = 0; i < 12 && searches.length === before; i++) await page.waitForTimeout(1500);
  return searches.length > before;
};

/** Press «بحث» and wait for the search it fires; returns the LAST new capture (null if none). */
const searchAndCapture = async () => {
  const n = searches.length;
  await tap('بحث');
  for (let i = 0; i < 30 && searches.length === n; i++) await page.waitForTimeout(1000);
  await page.waitForTimeout(4000);                       // let sibling calls of the same بحث land
  // BY SHAPE, never by recency: index.tsx fires one p_limit:1 probe per visible district on every
  // deal/period change, and any of them can complete after the main search. The main search is
  // page 0 of a real page size.
  const cands = searches.slice(n).filter((x) => (x.body?.p_offset ?? 0) === 0 && Number(x.body?.p_limit ?? 0) > 1);
  return cands.length ? cands[cands.length - 1] : null;
};

/** Leave the results screen for the Filter screen. «تصفية» is ModeSwitch's Filter segment
 *  (router.replace('/') — the same navigation the app's own Stop path uses); the older
 *  «تعديل البحث» label and history.back() are fallbacks, never the primary route. */
const backToFilter = async () => {
  await tap('تصفية', 6000)
    .catch(async () => tap('تعديل البحث', 4000))
    .catch(async () => { await page.goBack(); await page.waitForTimeout(2500); });
  await page.waitForTimeout(2500);
  const cityStillSelected = await page.$('[data-testid="selected-city-visual"]');
  if (!cityStillSelected) {
    // The Filter rehydrates city/district from the shared query; if that ever regressed, re-pick
    // rather than search nationwide — and say so, because a re-pick is itself a finding.
    console.log('      [diag] the Filter screen did NOT restore the selected city — re-picking it');
    await page.click('[data-testid="city-input"]');
    await page.fill('[data-testid="city-input"]', CITY);
    await tap(CITY).catch(() => {});
    await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 6000 }).catch(() => null);
  }
};
const countFilterChips = () =>
  page.evaluate(() => document.querySelectorAll('[data-testid^="filter-af-chip-"]').length);

/** Poll until the newest headline shows `want`, then return what it shows (a mismatch is returned, not hidden). */
const newestHeadlineNumber = async (want: number | null, timeoutMs = 25000): Promise<number | null> => {
  const until = Date.now() + timeoutMs;
  let last: number | null = null;
  while (Date.now() < until) {
    const hs = await page.evaluate(READ_HEADLINES);
    last = hs.length ? toNum(hs[hs.length - 1]) : null;
    if (last != null && last === want) return last;
    await page.waitForTimeout(500);
  }
  return last;
};

// ── the independent oracle (verify-af-live-truth.ts technique) ──────────────────────────────────
const rpc = async (body: any): Promise<any[] | { error: string }> =>
  fetch(`${SUPABASE_URL}/rest/v1/rpc/location_search_candidates_ar`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
const totalOf = (j: any): number => (Array.isArray(j) ? Number(j[0]?.total_count ?? (j.length === 0 ? 0 : NaN)) : NaN);

const TYPE_MACROS: Record<string, string> = await (async () => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/known_type_ar?select=type_ar,macro`, { headers: H });
  if (!r.ok) throw new Error(`known_type_ar unreadable (${r.status}) — the oracle cannot apply category purity`);
  return Object.fromEntries((await r.json()).map((x: any) => [x.type_ar, x.macro]));
})();
// Directions: the index stores «شمال شرقي» beside «شمال شرق» and the RPC normalises both; a literal
// direction_ar=in.(key) UNDERCOUNTS. The variants are read from the live index (every value equal
// to a key or to the key with «ي» on its last word) — loaded lazily, only if a body carries them.
let directionVariants: Record<string, string[]> | null | undefined;
const oracleOpts = async (body: any) => {
  if (Array.isArray(body?.p_directions) && body.p_directions.length && directionVariants === undefined) {
    directionVariants = (await loadDirectionVariants(SUPABASE_URL, H)).map;
  }
  return { typeMacros: TYPE_MACROS, ...(directionVariants ? { directionVariants } : {}) };
};
const oracleCount = async (body: any) => {
  const { qs, unhandled } = buildOracleQS(body, await oracleOpts(body));
  if (unhandled.length) return { count: null as number | null, unhandled, qs };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/search_listings_ar?select=listing_id&${qs}`,
    { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  if (!r.ok) throw new Error(`oracle count: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);   // an error is not a count
  const cr = r.headers.get('content-range');
  if (!cr?.includes('/')) throw new Error(`oracle count: no content-range total (${cr})`);
  return { count: Number(cr.split('/')[1]), unhandled, qs };
};
const oracleIds = async (qs: string, cap = 30000) => {
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let off = 0; off < cap; off += PAGE) {
    // ordered paging: unordered Range paging drops/repeats rows across page boundaries
    const r = await fetch(`${SUPABASE_URL}/rest/v1/search_listings_ar?select=listing_id,source_table&${qs}&order=source_table.asc,listing_id.asc`,
      { headers: { ...H, Range: `${off}-${off + PAGE - 1}` } });
    if (!r.ok) throw new Error(`oracle page ${off}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);   // never an empty set
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(`oracle page ${off}: not an array`);
    if (!rows.length) break;
    for (const row of rows) ids.add(`${row.source_table}:${row.listing_id}`);
    if (rows.length < PAGE) break;
  }
  return ids;
};
const rpcIds = async (body: any, totalHint: number, cap = 30000) => {
  const ids: string[] = [];
  const PAGE = 1000;
  for (let off = 0; off < Math.min(totalHint, cap); off += PAGE) {
    const rows = await rpc({ ...body, p_per_platform: null, p_limit: PAGE, p_offset: off });
    if (!Array.isArray(rows)) throw new Error(`RPC page ${off}: ${JSON.stringify(rows).slice(0, 160)}`);   // an error is never an empty page
    if (!rows.length) break;
    for (const row of rows) ids.push(`${row.source_table}:${row.listing_id}`);
    if (rows.length < PAGE) break;
  }
  return ids;
};
const diffIds = (rpcList: string[], oracleSet: Set<string>) => {
  const rpcSet = new Set(rpcList);
  const seen = new Set<string>(); const duplicates: string[] = [];
  for (const id of rpcList) { if (seen.has(id)) duplicates.push(id); seen.add(id); }
  return {
    missing: [...oracleSet].filter((id) => !rpcSet.has(id)),
    extra: [...rpcSet].filter((id) => !oracleSet.has(id)),
    duplicates,
  };
};

/** The DB-truth battery for one landed search: headline == RPC == anon replay == oracle, IDs exact. */
const proveTruth = async (label: string, s: { body: any; total: number | null }) => {
  const headline = await newestHeadlineNumber(s.total);
  const replayTotal = totalOf(await rpc(s.body));
  check(`${label} — headline == RPC total_count == anon replay of the same body (R7.4.1)`,
    R.countsAgree(headline, s.total, replayTotal),
    `headline=${headline} rpc=${s.total} replay=${Number.isFinite(replayTotal) ? replayTotal : 'unreadable'}`);
  const { count, unhandled, qs } = await oracleCount(s.body);
  if (unhandled.length) {
    // The brief for this file predates the oracle's 'كلاهما' translation (afOracleFilter.ts,
    // 2026-09-02). If a future oracle refuses the both-period token again, the headline is still
    // held to the RPC and the anon replay above — and the refusal is printed as a loud SKIP, never
    // a pass. Any OTHER refusal is a FAIL: an inconclusive oracle on a scope it should cover is a gap.
    const onlyBoth = unhandled.every((u) => u.startsWith('p_rent_period=كلاهما'));
    if (onlyBoth) skip(`${label} — independent oracle (R7.5.1)`, `oracle refused the both-period token; only RPC == replay was proved for this body: ${unhandled.join(' · ')}`);
    else check(`${label} — independent oracle covers every predicate on the request (R7.5.1)`, false, `unhandled: ${unhandled.join(' · ')}`);
    return;
  }
  check(`${label} — RPC total_count == INDEPENDENT PostgREST oracle over search_listings_ar (R7.5.1)`,
    R.countsAgree(s.total, count), `rpc=${s.total} oracle=${count}`);
  const [rIds, oIds] = await Promise.all([rpcIds(s.body, s.total ?? 0), oracleIds(qs)]);   // ≤ 2 in flight
  const d = diffIds(rIds, oIds);
  check(`${label} — MISSING = EXTRA = DUPLICATES = 0 on the exact (source_table, listing_id) diff (R7.5.1)`,
    R.diffClean(d),
    `rpc=${rIds.length} oracle=${oIds.size} missing=${d.missing.length} extra=${d.extra.length} dupes=${d.duplicates.length}` +
    (d.missing.length ? ` missing⊂${d.missing.slice(0, 3).join(',')}` : '') + (d.extra.length ? ` extra⊂${d.extra.slice(0, 3).join(',')}` : ''));
};

/** The certification battery for one transition, executed through the REAL gate. */
const proveTransition = (label: string, committed: Atoms, after: Atoms, q: SearchQuery, chips: number | null) => {
  const survivors = Object.keys(committed).filter((a) => certified(q, a));
  const casualties = Object.keys(committed).filter((a) => !certified(q, a));
  const fmt = (as: string[], src: Atoms) => as.map((a) => `${a}=${src[a]}`).join(', ') || '(none)';
  check(`${label} — the transition is a real test: the new cohort keeps some committed predicate AND drops some`,
    R.transitionMeaningful(committed, q),
    `certified for the new scope: ${survivors.join(', ') || '(none)'} · not certified: ${casualties.join(', ') || '(none)'}`);
  check(`${label} — every AF predicate on the request belongs to a question the new cohort certifies (R2.1.1)`,
    R.onlyCertified(after, q),
    `on the request: ${fmt(Object.keys(after), after)} · uncertified among them: ${Object.keys(after).filter((a) => !certified(q, a)).join(', ') || '(none)'}`);
  check(`${label} — every committed predicate the new cohort certifies SURVIVED, byte-identical (nothing dropped)`,
    R.certifiedSurvived(committed, after, q),
    survivors.map((a) => `${a}: ${committed[a]} → ${after[a] ?? '(absent)'}`).join(' · ') || '(no survivor to keep)');
  check(`${label} — every committed predicate the new cohort does NOT certify is ABSENT (nothing stale)`,
    R.uncertifiedAbsent(committed, after, q),
    `should be gone: ${casualties.join(', ') || '(none)'} · still on the request: ${casualties.filter((a) => a in after).join(', ') || '(none)'}`);
  check(`${label} — no predicate appeared that was never committed (nothing resurrected or invented)`,
    R.nothingInvented(committed, after),
    `unexpected: ${Object.keys(after).filter((a) => !(a in committed)).join(', ') || '(none)'}`);
  check(`${label} — the Filter screen showed exactly one removable chip per surviving question (visible AND removable)`,
    R.chipsMatchSurvivors(chips, Object.fromEntries(survivors.map((a) => [a, committed[a]]))),
    `filter-af-chip-* count=${chips} · surviving questions=${[...new Set(survivors.map(questionOf))].join(', ') || '(none)'}`);
};

const STABLE_SCOPE_KEYS = ['p_cities', 'p_districts', 'p_region_ids', 'p_types', 'p_category', 'p_beds_exact', 'p_area_min', 'p_area_max'];

const captured: Record<string, { body: any; total: number | null } | null> = { B1: null, B2: null, B3: null, B4: null };
try {
  console.log(`── scope: ${CITY} · ${GROUP} · ${TYPE} (${CLEAN}) · ${MOBILE ? 'MOBILE 390x844' : 'desktop 1440x900'} ──\n`);
  await gotoLive(page, `${BASE}/`, { timeout: 60000 });
  await page.waitForTimeout(5000);

  // ── B0/B1: the Buy search, then one committed round ─────────────────────────────────────────
  await page.click('[data-testid="city-input"]');
  await page.fill('[data-testid="city-input"]', CITY);
  await tap(CITY).catch(() => {});
  await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 6000 }).catch(() => null);
  await tap(GROUP);
  await tap(TYPE);
  const b0 = await searchAndCapture();
  await page.waitForTimeout(8000);
  check('B0 — the baseline Buy search landed with NO AF predicate', !!b0 && Object.keys(atomsOf(b0.body)).length === 0,
    b0 ? `p_deal=${b0.body.p_deal} p_rent_period=${b0.body.p_rent_period ?? null} atoms=${Object.keys(atomsOf(b0.body)).join(',') || '(none)'}` : 'no search captured');
  check('B0 — the baseline really is a Buy search of the requested clean type',
    b0?.body?.p_deal === 'بيع' && Array.isArray(b0?.body?.p_types) && b0.body.p_types.every((t: string) => (CLEAN_TO_TYPE_AR[CLEAN] ?? []).includes(t)),
    `p_deal=${b0?.body?.p_deal} p_types=${JSON.stringify(b0?.body?.p_types)} · ${CLEAN} ↔ ${JSON.stringify(CLEAN_TO_TYPE_AR[CLEAN] ?? null)}`);

  const round = await walkOneRound();
  check('B1 — one AF round committed (first option of every question offered) and a new search landed', round);
  const B1 = captured.B1 = searches[searches.length - 1];
  const committed = atomsOf(B1?.body);
  console.log(`      [diag] B1 committed: ${Object.entries(committed).map(([a, v]) => `${a}=${v}`).join(', ') || '(none)'}`);
  check('B1 — the committed answers reached the search request (at least one AF predicate)', Object.keys(committed).length > 0);
  check('B1 — every committed predicate is certified for the cohort that asked it (Buy)',
    R.onlyCertified(committed, scopeQuery('Buy', 'annual')),
    Object.keys(committed).filter((a) => !certified(scopeQuery('Buy', 'annual'), a)).join(', ') || 'all certified');
  if (B1) await proveTruth('B1 (Buy, committed)', B1);

  // ── B2: Buy → Rent-Annual ─────────────────────────────────────────────────────────────────
  const qAnnual = scopeQuery('Rent', 'annual');
  await backToFilter();
  await tap('إيجار');
  await tap('شراء');                                    // deselect Buy → Rent-only, سنوي pre-selected
  await page.waitForTimeout(800);
  const chipsB2 = await countFilterChips();
  const B2 = captured.B2 = await searchAndCapture();
  check('B2 — switching to Rent-Annual and pressing بحث sent a new search', !!B2);
  if (B2) {
    check('B2 — the request is Rent · سنوي (the deal moved exactly as asked)',
      R.scopeAs(B2.body, { p_deal: 'إيجار', p_rent_period: 'سنوي' }), `p_deal=${B2.body.p_deal} p_rent_period=${B2.body.p_rent_period}`);
    const moved = STABLE_SCOPE_KEYS.filter((k) => JSON.stringify(B2.body[k] ?? null) !== JSON.stringify(B1.body[k] ?? null));
    check('B2 — city/type/category and the other normal filters did not move', moved.length === 0,
      moved.map((k) => `${k}: ${JSON.stringify(B1.body[k])} → ${JSON.stringify(B2.body[k])}`).join(' · ') || 'identical');
    proveTransition('B2 Buy→RentAnnual', committed, atomsOf(B2.body), qAnnual, chipsB2);
    await proveTruth('B2 (Rent-Annual)', B2);
  }

  // ── B3: Rent-Annual → BOTH periods (Journey B) ────────────────────────────────────────────
  const qBoth = scopeQuery('Rent', 'both');
  await backToFilter();
  await tap('شهري');                                    // on top of سنوي → 'both'
  await page.waitForTimeout(800);
  const chipsB3 = await countFilterChips();
  const B3 = captured.B3 = await searchAndCapture();
  check('B3 — adding شهري to سنوي and pressing بحث sent a new search', !!B3);
  if (B3) {
    check('B3 — the request carries p_rent_period = كلاهما (R1.5.1: the union of two KNOWN periods, not "no period")',
      R.scopeAs(B3.body, { p_deal: 'إيجار', p_rent_period: 'كلاهما' }), `p_deal=${B3.body.p_deal} p_rent_period=${B3.body.p_rent_period}`);
    proveTransition('B3 RentAnnual→both', committed, atomsOf(B3.body), qBoth, chipsB3);
    await proveTruth('B3 (Rent-both)', B3);
  }

  // ── B4: both → Rent-Monthly only ──────────────────────────────────────────────────────────
  const qMonthly = scopeQuery('Rent', 'monthly');
  await backToFilter();
  await tap('سنوي');                                    // drop annual → شهري only
  await page.waitForTimeout(800);
  const chipsB4 = await countFilterChips();
  const B4 = captured.B4 = await searchAndCapture();
  check('B4 — dropping سنوي (Monthly-only) and pressing بحث sent a new search', !!B4);
  if (B4) {
    check('B4 — the request is Rent · شهري', R.scopeAs(B4.body, { p_deal: 'إيجار', p_rent_period: 'شهري' }),
      `p_deal=${B4.body.p_deal} p_rent_period=${B4.body.p_rent_period}`);
    proveTransition('B4 →RentMonthly', committed, atomsOf(B4.body), qMonthly, chipsB4);
    await proveTruth('B4 (Rent-Monthly)', B4);
  }

  // ── GATE-INDEPENDENT structure over the CAPTURED bodies (no cohortAllows() in the loop) ────────
  if (B1 && B2 && B3 && B4) {
    const a2 = atomsOf(B2.body), a3 = atomsOf(B3.body), a4 = atomsOf(B4.body);
    check('STRUCTURE — R2.3.1 on the wire: the both-period body carries EXACTLY the predicates common to the Annual and Monthly bodies',
      R.bothIsIntersection(a2, a4, a3), `annual=[${Object.keys(a2)}] monthly=[${Object.keys(a4)}] both=[${Object.keys(a3)}]`);
    for (const [lbl, bn, wantsMonthly] of [['B2', B2, false], ['B3', B3, true], ['B4', B4, true]] as const) {
      check(`STRUCTURE — ${lbl} p_tables = B1's base set ${wantsMonthly ? 'PLUS' : 'WITHOUT'} the two monthly-only sources (period-derived, nothing else moved)`,
        R.tablesFollowPeriod(B1.body.p_tables, bn.body.p_tables, wantsMonthly),
        `B1=${(B1.body.p_tables ?? []).length} tables · ${lbl}=${(bn.body.p_tables ?? []).length} tables · monthly-only present: ${MONTHLY_ONLY_TABLES.filter((t) => (bn.body.p_tables ?? []).includes(t)).length}/2`);
      check(`STRUCTURE — ${lbl} only DROPPED committed predicates (none added, none altered)`, R.onlyDrops(committed, atomsOf(bn.body)),
        Object.entries(atomsOf(bn.body)).filter(([a, v]) => !(a in committed) || committed[a] !== v).map(([a, v]) => `${a}=${v}`).join(', ') || 'clean');
      check(`STRUCTURE — ${lbl} carries no wire key outside the RPC vocabulary (no invisible predicate on an unmapped key)`, R.onlyKnownKeys(bn.body),
        Object.keys(bn.body).filter((k) => !KNOWN_WIRE_KEYS.has(k)).join(', ') || 'all known');
      check(`STRUCTURE — ${lbl} moved no non-AF narrowing other than deal/period`, R.nonAfUnchanged(B1.body, bn.body),
        NON_AF_STABLE.filter((k) => JSON.stringify(B1.body[k] ?? null) !== JSON.stringify(bn.body[k] ?? null)).map((k) => `${k}: ${JSON.stringify(B1.body[k])} → ${JSON.stringify(bn.body[k])}`).join(' · ') || 'identical');
    }
    check('STRUCTURE — the B1..B4 bodies all carry the SAME non-empty p_types (the cohort gate was judged on one scope)',
      [B2, B3, B4].every((bn) => JSON.stringify(bn.body.p_types) === JSON.stringify(B1.body.p_types)) && Array.isArray(B1.body.p_types) && B1.body.p_types.length > 0,
      `B1 p_types=${JSON.stringify(B1.body.p_types)}`);
  }

  check('the journey exercised the expected production backend',
    origins.size === 1 && origins.has(new URL(SUPABASE_URL).origin),
    `saw ${[...origins].join(', ') || '(none)'}, expected ${new URL(SUPABASE_URL).origin}`);

  // ── MUTATION PROOFS ────────────────────────────────────────────────────────────────────────
  // Each takes the REAL captured artefacts and breaks exactly the property one assertion protects,
  // then requires that assertion to return false. Every corruption is DERIVED from the capture so it
  // is provably different from the real value — a mutation that could equal reality proves nothing.
  console.log('\n── MUTATION PROOFS (each must turn the paired assertion RED) ──');
  const mut = (label: string, ok: boolean, detail = '') => check(`MUTATION — ${label}`, ok, detail);
  const B2atoms = atomsOf(B2?.body);
  const survivor = Object.keys(committed).find((a) => certified(qAnnual, a) && a in B2atoms) ?? null;
  const casualty = Object.keys(committed).find((a) => !certified(qAnnual, a)) ?? null;
  mut('the mutation block has a real survivor and a real casualty to corrupt', survivor != null && casualty != null,
    `survivor=${survivor} casualty=${casualty}`);
  if (survivor && casualty && B2) {
    mut('a STALE predicate crossing the deal boundary is caught by uncertifiedAbsent AND onlyCertified',
      !R.uncertifiedAbsent(committed, { ...B2atoms, [casualty]: committed[casualty] }, qAnnual) &&
      !R.onlyCertified({ ...B2atoms, [casualty]: committed[casualty] }, qAnnual), `re-added ${casualty}`);
    const { [survivor]: _gone, ...dropped } = B2atoms;
    mut('a CERTIFIED predicate the carry dropped is caught by certifiedSurvived', !R.certifiedSurvived(committed, dropped, qAnnual), `removed ${survivor}`);
    mut('a survivor whose VALUE silently changed is caught by certifiedSurvived',
      !R.certifiedSurvived(committed, { ...B2atoms, [survivor]: '"__mutated__"' }, qAnnual));
    const invented = ['p_rating_min', 'p_street_width_min', 'p_furnished', 'p_amenities:__never_committed__'].find((a) => !(a in committed))!;
    mut('an INVENTED predicate the user never committed is caught by nothingInvented',
      !R.nothingInvented(committed, { ...B2atoms, [invented]: '1' }), `added ${invented}`);
    // The gate itself is part of what is under test: a certification map that quietly certified
    // everything would let a stale predicate through, and one that certified nothing would call
    // every survivor stale. Both fakes must turn the paired assertion red on the REAL capture.
    const FAKE_ALL: Gate = { allows: () => true, amenityKeys: () => [...new Set(Object.keys(committed).map(tokenOf).filter((t): t is string => t != null))] };
    const FAKE_NONE: Gate = { allows: () => false, amenityKeys: () => [] };
    mut('a certification map that certifies EVERYTHING committed is caught (the real casualty then reads as a dropped survivor)',
      !R.certifiedSurvived(committed, B2atoms, qAnnual, FAKE_ALL));
    mut('a certification map that certifies NOTHING is caught (every real survivor then reads as uncertified)',
      !R.onlyCertified(B2atoms, qAnnual, FAKE_NONE));
    mut('a deal that did not move is caught by scopeAs', !R.scopeAs(B2.body, { p_deal: B1.body.p_deal, p_rent_period: 'سنوي' }));
    mut('a period token other than كلاهما on the both-period body is caught by scopeAs',
      B3 != null && !R.scopeAs(B3.body, { p_deal: 'إيجار', p_rent_period: B2.body.p_rent_period }));
    mut('a headline off by one from the RPC is caught by countsAgree', !R.countsAgree((B2.total ?? 0) + 1, B2.total, B2.total));
    mut('one missing ID is caught by diffClean', !R.diffClean({ missing: ['x:1'], extra: [], duplicates: [] }));
    mut('a chip row that lost a surviving question is caught by chipsMatchSurvivors',
      !R.chipsMatchSurvivors(chipsB2 - 1, Object.fromEntries(Object.keys(committed).filter((a) => certified(qAnnual, a)).map((a) => [a, committed[a]]))));

    // REAL-RPC MUTATIONS: the DB-truth checks are only worth anything if the backend's answer really
    // depends on the body. (1) drop the surviving predicate; (2) flip the period token — the very
    // dimension this journey moves — and require a DIFFERENT total each time.
    const without = (body: any, atom: string) => {
      const tok = tokenOf(atom);
      if (tok == null) return { ...body, [atom]: null };
      const rest = (body.p_amenities as string[]).filter((t) => t !== tok);
      return { ...body, p_amenities: rest.length ? rest : null };
    };
    const loosened = totalOf(await rpc(without(B2.body, survivor)));
    mut(`dropping the surviving ${survivor} really changes the backend's answer (the DB-truth check is sensitive to the body)`,
      Number.isFinite(loosened) && loosened !== B2.total, `with: ${B2.total} · without: ${Number.isFinite(loosened) ? loosened : 'unreadable'}`);
    const flipped = totalOf(await rpc({ ...B2.body, p_rent_period: 'شهري' }));
    {
      const a2 = atomsOf(B2.body), a4 = atomsOf(captured.B4?.body), a3 = atomsOf(captured.B3?.body);
      const anyA2 = Object.keys(a2)[0];
      mut('a both-period body carrying a predicate Monthly does not certify is caught by bothIsIntersection',
        anyA2 != null && !R.bothIsIntersection(a2, Object.fromEntries(Object.entries(a4).filter(([k]) => k !== anyA2)), { ...a3, [anyA2]: a2[anyA2] }));
      mut('a scope change that ADDED a predicate is caught by onlyDrops', !R.onlyDrops(committed, { ...a2, 'p_rating_min': '9' }));
      mut('a scope change that ALTERED a surviving value is caught by onlyDrops', anyA2 != null && !R.onlyDrops(committed, { ...a2, [anyA2]: '"__mutated__"' }));
      mut('an unknown wire key is caught by onlyKnownKeys', !R.onlyKnownKeys({ ...B2.body, p_secret_filter: 1 }));
      mut('a moved non-AF key (p_cities) is caught by nonAfUnchanged', !R.nonAfUnchanged(B1.body, { ...B2.body, p_cities: ['__moved__'] }));
      mut('a Monthly scope MISSING the monthly-only sources is caught by tablesFollowPeriod',
        !R.tablesFollowPeriod(B1.body.p_tables, B1.body.p_tables, true));
      mut('an Annual scope that ADDED the monthly-only sources is caught by tablesFollowPeriod',
        !R.tablesFollowPeriod(B1.body.p_tables, [...B1.body.p_tables, ...MONTHLY_ONLY_TABLES], false));
      mut('a foreign table smuggled into p_tables is caught by tablesFollowPeriod',
        !R.tablesFollowPeriod(B1.body.p_tables, [...B4.body.p_tables, '__smuggled_listings'], true));
      mut('a base table DROPPED under a period change is caught by tablesFollowPeriod',
        !R.tablesFollowPeriod(B1.body.p_tables, B4.body.p_tables.slice(1), true));
      mut('a duplicated table is caught by tablesFollowPeriod',
        !R.tablesFollowPeriod(B1.body.p_tables, [...B4.body.p_tables.slice(1), B4.body.p_tables[1]], true));
    }
    mut('flipping the period token سنوي→شهري on the same body really changes the backend\'s answer',
      Number.isFinite(flipped) && flipped !== B2.total, `سنوي: ${B2.total} · شهري: ${Number.isFinite(flipped) ? flipped : 'unreadable'}`);
  }
} catch (e: any) {
  check('the journey completed without a harness error', false, e.message);
} finally {
  await ctx.close();
  await browser.close();
}

if (skippedLabels.length) console.log(`\n⚠ ${skippedLabels.length} check(s) SKIPPED (inconclusive, NOT passed):\n` + skippedLabels.map((l) => `    • ${l}`).join('\n'));
console.log(failures
  ? `\n✗ ${failures} check(s) FAILED:\n` + failedLabels.map((l) => `    • ${l}`).join('\n') + '\n'
  : '\n✓ changing deal or rent period keeps exactly the answers the new cohort certifies, drops the rest, resurrects nothing, and every count is DB truth\n');
process.exit(failures || skippedLabels.length ? 1 : 0);   // inconclusive is not green
