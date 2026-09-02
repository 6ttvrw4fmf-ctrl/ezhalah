// REMOVING AN ADVANCED-FILTER PILL, PROVEN IN A REAL BROWSER AGAINST PRODUCTION.
//
// WHAT THIS EXISTS FOR
// --------------------
// §9.2 of docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md is the one AF interaction that runs BACKWARDS —
// every other control narrows, this one widens — and until now the whole family rested on
// `verify-af-cross-round-carry.ts`, which reasons over `removeGuidedFacet`'s inputs and outputs
// offline. That barrier is real, but it cannot see the deployed bundle, and R9.2.2's own half —
// «the search re-runs without that predicate, the count may WIDEN, a new results turn lands below
// with the new count, nothing above is rewritten» — was graded P (partial) in
// scripts/lib/afContractCoverage.ts with the note "not directly asserted". A rule nothing executes
// against production is a rule production is free to break silently.
//
// The failure this catches is not hypothetical in shape. `removeGuidedFacet` rebuilds the query
// from the interview's `baseQ` by REPLAYING every surviving facet through its own question's
// `apply()` — it never un-applies the removed one. That rebuild is the correct design (owner
// 2026-08-23: a hand-written un-apply is what silently widens a search), but it means a wrong
// `baseQ`, a facet whose question id no longer resolves, or a predicate that leaks in from
// somewhere other than the replay all produce the SAME user-visible symptom: a plausible-looking
// number that is not the search the user asked for. A count alone cannot tell those apart, so this
// journey asserts on the REQUEST BODY as well — the exact artefact the bug would live in.
//
// THE JOURNEY
//   1. Residential · الرياض · شقة → بحث                        (baseline count N0)
//   2. open Advanced Filter, walk a round, commit answers      (count N1 < N0, pills appear)
//   3. open it again, commit a second round                    (count N2 <= N1, >= 2 pills)
//   4. snapshot every results headline currently in the transcript
//   5. tap the ✕ on the FIRST pill
//   6. assert, on the request the browser actually sent and the turn that actually landed:
//        R9.2.1  only that one predicate left; every other committed predicate is still on the body
//        R9.2.2  the count WIDENED (or held), a NEW results turn landed, and every headline that
//                was already on screen is still there unchanged — nothing above was rewritten
//        R9.2.2  the landed count is re-derivable: replaying the captured body through the anon
//                REST path returns the same total_count the UI is showing
//        R9.2.3  the removed question is offerable again — its id is gone from the asked carry, so
//                «تحديد أكثر» can ask that dimension a second time
//
// WHY A SECOND ROUND IS NOT OPTIONAL: with a single pill, "removes ONLY that one" is vacuous —
// there is nothing left to survive. The journey needs two committed answers or it proves half a
// rule. If the cohort genuinely cannot supply a second useful question the run says so and stops
// rather than passing on the weaker shape.
//
// LIVE CHECK — excluded from `npm test` (it drives a real browser against production), runs in
// .github/workflows/af-live-truth-check.yml alongside the other AF live journeys.

import { chromium } from 'playwright';
import { gotoLive } from './lib/liveNav.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const BASE = 'https://ezhalah-app.vercel.app';
const { url: SUPABASE_URL, key: ANON_KEY } = resolvePublicSupabase(process.env);

// The scope is a knob, not a constant, so ONE journey covers the rotation this routine owes every
// run (a mobile viewport and a non-Riyadh city — docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md
// PART 8) instead of three near-identical files drifting apart. Defaults reproduce the desktop
// Riyadh/Apartment cohort the rule was first proved on.
const CITY = process.env.AF_PILL_CITY || 'الرياض';
const GROUP = process.env.AF_PILL_GROUP || 'الشقق والسكن المشترك';
const TYPE = process.env.AF_PILL_TYPE || 'شقة';
const MOBILE = process.env.AF_PILL_MOBILE === '1';
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 };

// Every AF answer field the search RPC accepts. The journey does not know in advance which the
// cohort will offer, so it diffs whichever ones actually appear rather than naming an expectation.
const AF_PREDICATE_KEYS = [
  'p_bath_min', 'p_bath_exact', 'p_age_min', 'p_age_max', 'p_is_new_construction', 'p_age_unknown',
  'p_amenities', 'p_furnished', 'p_rating_min', 'p_reviews_min', 'p_unit_subtypes',
  'p_street_width_min', 'p_street_width_max', 'p_directions', 'p_rnpl',
];

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
// the END of a long log, so a single FAIL far up the scroll is invisible to `tail` — which is how a
// one-in-five intermittent in the sibling four-way journey became unnameable on 2026-09-02.
const failedLabels: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) { failures++; failedLabels.push(label); }
};

/** Which AF predicates are present (non-null) on a captured request body. */
const afKeysOn = (body: any): string[] => AF_PREDICATE_KEYS.filter((k) => body?.[k] != null);

const SCOPE_KEYS = ['p_cities', 'p_types', 'p_deal', 'p_rent_period', 'p_beds_exact', 'p_price_min', 'p_price_max', 'p_area_min', 'p_area_max'];

// ── THE LOAD-BEARING PREDICATES, AS PURE FUNCTIONS ──────────────────────────────────────────────
// Named and exported-shaped on purpose: the live journey calls them on what production actually
// did, and the mutation block at the bottom calls the SAME functions on deliberately corrupted
// inputs to prove each one can return false. An assertion nobody has ever seen fail is not a
// barrier — this repo has shipped several (nine dark detectors reading as a clean bill of health),
// and a live journey is the easiest place to write one by accident, because the happy path passes
// whether the assertion is sharp or vacuous.
const R = {
  /** R9.2.1 — exactly the removed predicate left; nothing else moved. */
  droppedExactlyOne: (before: any, after: any) =>
    afKeysOn(before).filter((k) => !afKeysOn(after).includes(k)).length === 1,
  /** R9.2.1 — every predicate that survived kept its exact value. */
  survivorsIntact: (before: any, after: any) => {
    const survived = afKeysOn(before).filter((k) => afKeysOn(after).includes(k));
    const dropped = afKeysOn(before).filter((k) => !afKeysOn(after).includes(k));
    return survived.length === afKeysOn(before).length - dropped.length &&
      survived.every((k) => JSON.stringify(after[k]) === JSON.stringify(before[k]));
  },
  /** R9.2.1 — no predicate the user never committed appeared out of the rebuild. */
  nothingInvented: (before: any, after: any) =>
    afKeysOn(after).every((k) => afKeysOn(before).includes(k)),
  /** R9.2.2 — the normal-filter scope is not a casualty of an AF rebuild. */
  scopeUntouched: (before: any, after: any) =>
    SCOPE_KEYS.every((k) => JSON.stringify(after?.[k]) === JSON.stringify(before?.[k])),
  /** R9.2.2 — removing a narrowing can only widen or hold. */
  widenedOrHeld: (before: number | null, after: number | null) =>
    before != null && after != null && after >= before,
  /** R9.2.2 — every headline already on screen is still there, unchanged. */
  nothingAboveRewritten: (before: string[], after: string[]) =>
    before.every((h) => after.includes(h)),
};

/** Every «لقينا N إعلان» headline currently rendered, oldest first. */
const READ_HEADLINES = () => {
  const out: string[] = [];
  document.querySelectorAll('div,span,p').forEach((e: any) => {
    const t = (e.innerText || '').trim();
    if (!/^لقينا\s+[\d,٬]+\s+إعلان/.test(t)) return;
    if (e.children.length > 2) return;          // innermost node only — parents repeat the text
    if (!out.includes(t)) out.push(t);
  });
  return out;
};

const toNum = (s: string): number | null => {
  const m = s.match(/لقينا\s*([\d,٬]+)/);
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

// Requests and responses are paired by the request OBJECT, never by RPC name: several
// location_search_candidates_ar calls are in flight at once during a round, and name-matching
// silently pairs a body with somebody else's totals (harness note 3 in the routine spec).
const searches: { body: any; total: number | null }[] = [];
const origins = new Set<string>();
page.on('response', async (r) => {
  if (!r.url().includes('/rpc/location_search_candidates_ar') || r.request().method() !== 'POST') return;
  try { origins.add(new URL(r.url()).origin); } catch { /* not a parseable url — origin check below fails loudly */ }
  try {
    const j = await r.json();
    if (!Array.isArray(j)) return;
    searches.push({
      body: JSON.parse(r.request().postData() || '{}'),
      total: j.length ? Number(j[0]?.total_count ?? NaN) : 0,
    });
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

/**
 * Walk one AF round to its end, i.e. until a NEW search request lands. Returns true if it did.
 *
 * A MISSING offer button is a legitimate production answer, not a harness error: R11.2 says AF
 * stops when no remaining question narrows meaningfully, and R4.4.1 hides the offer in exactly that
 * case. So this returns false rather than throwing — the caller decides whether it still has the
 * two committed answers the removal test needs. Treating "AF correctly stopped" as a crash is how a
 * journey ends up reporting a product defect that is really the product obeying its own contract.
 */
const walkOneRound = async (): Promise<boolean> => {
  const before = searches.length;
  await scrollToBottom();
  const opened = await tap('خلّنا نحدد الطلب أكثر')
    .then(() => true)
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

const countPills = () =>
  page.evaluate(() => document.querySelectorAll('[data-testid^="af-pill-"]').length);

try {
  console.log(`── scope: ${CITY} · ${GROUP} · ${TYPE} · ${MOBILE ? 'MOBILE 390x844' : 'desktop 1440x900'} ──\n`);
  await gotoLive(page, `${BASE}/`, { timeout: 60000 });
  await page.waitForTimeout(5000);

  // ── 1. the baseline search ──────────────────────────────────────────────────────────────────
  await page.click('[data-testid="city-input"]');
  await page.fill('[data-testid="city-input"]', CITY);
  await tap(CITY).catch(() => {});
  await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 6000 }).catch(() => null);
  await tap(GROUP);
  await tap(TYPE);
  await tap('بحث');
  await page.waitForTimeout(14000);
  check('the baseline search landed', searches.length > 0, `${searches.length} request(s)`);
  const baseline = searches[searches.length - 1];
  check('the baseline search carries NO AF predicate yet (nothing to remove would be vacuous)',
    afKeysOn(baseline?.body).length === 0,
    `AF predicates on the pre-AF request: ${afKeysOn(baseline?.body).join(', ') || '(none)'}`);

  // ── 2 & 3. enough committed answers that a removal has something left to preserve ───────────
  // A round asks up to AF_ROUND_MAX_QUESTIONS = 4 questions before it searches, so ONE round
  // usually already leaves two or more pills. A second round is opened only if it did not — and if
  // the offer is legitimately gone (R11.2: nothing left that narrows), the run says so and stops,
  // rather than removing a lone pill and calling the vacuous half of R9.2.1 proved.
  const round1 = await walkOneRound();
  check('round 1 committed and produced a new results turn', round1);
  const pillsAfter1 = await countPills();
  let rounds = 1;
  let pillsAfter2 = pillsAfter1;
  if (pillsAfter1 < 2) {
    const round2 = await walkOneRound();
    check('a second round was needed and opened (round 1 left fewer than 2 removable pills)', round2,
      `pills after round 1 = ${pillsAfter1}` +
      (round2 ? '' : ' — the offer was gone, which is R11.2 behaving correctly, but leaves this journey without a survivor to assert on'));
    rounds = round2 ? 2 : 1;
    pillsAfter2 = await countPills();
  }

  check('at least TWO removable pills are on screen (R9.2.1 needs a survivor to be meaningful)',
    pillsAfter2 >= 2, `after ${rounds} round(s): ${pillsAfter2} removable pill(s)`);

  const preRemoval = searches[searches.length - 1];
  const preKeys = afKeysOn(preRemoval?.body);
  check('the committed state reached the search request', preKeys.length >= 2,
    `AF predicates before removal: ${preKeys.map((k) => `${k}=${JSON.stringify(preRemoval.body[k])}`).join(', ') || '(none)'}`);

  // ── 4. what is on screen BEFORE the removal ─────────────────────────────────────────────────
  const headlinesBefore = await page.evaluate(READ_HEADLINES);
  const countBefore = preRemoval?.total ?? null;
  console.log(`      [diag] headlines before removal: ${JSON.stringify(headlinesBefore)}`);

  // ── 5. remove the FIRST pill ────────────────────────────────────────────────────────────────
  const nBefore = searches.length;
  await scrollToBottom();
  await page.click('[data-testid="af-pill-0"]');
  await page.waitForTimeout(4000);
  for (let i = 0; i < 14 && searches.length === nBefore; i++) await page.waitForTimeout(1500);

  const after = searches[searches.length - 1];
  const afterKeys = afKeysOn(after?.body);

  // ── 6. the assertions ───────────────────────────────────────────────────────────────────────
  check('R9.2.2 — removing a pill re-runs the search (a new request was actually sent)',
    searches.length > nBefore, `captured ${searches.length - nBefore} new request(s)`);

  const dropped = preKeys.filter((k) => !afterKeys.includes(k));
  const survived = preKeys.filter((k) => afterKeys.includes(k));
  check('R9.2.1 — exactly ONE committed predicate left the request',
    R.droppedExactlyOne(preRemoval?.body, after?.body),
    `dropped: ${dropped.join(', ') || '(none)'} · survived: ${survived.join(', ') || '(none)'}`);
  check('R9.2.1 — every OTHER committed predicate is still on the request, byte-identical',
    R.survivorsIntact(preRemoval?.body, after?.body),
    survived.map((k) => `${k}: ${JSON.stringify(preRemoval.body[k])} → ${JSON.stringify(after.body[k])}`).join(' · ') || '(nothing survived)');
  check('R9.2.1 — no predicate APPEARED that the user never committed',
    R.nothingInvented(preRemoval?.body, after?.body),
    `unexpected: ${afterKeys.filter((k) => !preKeys.includes(k)).join(', ') || '(none)'}`);

  // The non-AF half of the query must be untouched too: a rebuild from a stale baseQ would show up
  // here as a moved city/type long before it showed up as a wrong number.
  const movedScope = SCOPE_KEYS.filter((k) => JSON.stringify(after?.body?.[k]) !== JSON.stringify(preRemoval?.body?.[k]));
  check('R9.2.2 — the normal-filter scope is untouched by a pill removal',
    R.scopeUntouched(preRemoval?.body, after?.body),
    movedScope.map((k) => `${k}: ${JSON.stringify(preRemoval.body[k])} → ${JSON.stringify(after.body[k])}`).join(' · ') || 'city/type/deal/period/beds/price/area all identical');

  check('R9.2.2 — the count WIDENED or held (removing a narrowing can never narrow)',
    R.widenedOrHeld(countBefore, after?.total),
    `before=${countBefore} after=${after?.total}`);

  // Re-derive the landed number independently: replay the captured body through the anon REST path
  // the client itself uses. A UI number the backend does not reproduce is the R9.2.2/R13.6 defect.
  const replay = await fetch(`${SUPABASE_URL}/rest/v1/rpc/location_search_candidates_ar`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(after.body),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const replayTotal = Array.isArray(replay) ? Number(replay[0]?.total_count ?? (replay.length === 0 ? 0 : NaN)) : NaN;
  check('R9.2.2 — the post-removal count is DB truth (anon replay of the same body agrees)',
    Number.isFinite(replayTotal) && replayTotal === after?.total,
    `ui/rpc=${after?.total} anon-replay=${Number.isFinite(replayTotal) ? replayTotal : JSON.stringify(replay).slice(0, 160)}`);

  const headlinesAfter = await page.evaluate(READ_HEADLINES);
  console.log(`      [diag] headlines after removal: ${JSON.stringify(headlinesAfter)}`);
  const lost = headlinesBefore.filter((h) => !headlinesAfter.includes(h));
  check('R9.2.2 — nothing above was rewritten (every earlier headline is still on screen, unchanged)',
    R.nothingAboveRewritten(headlinesBefore, headlinesAfter),
    lost.length ? `headlines that changed or vanished: ${JSON.stringify(lost)}` : `${headlinesBefore.length} earlier headline(s) intact`);
  check('R9.2.2 — a NEW results turn landed BELOW with the new count',
    headlinesAfter.length > headlinesBefore.length &&
      toNum(headlinesAfter[headlinesAfter.length - 1] ?? '') === after?.total,
    `last headline=${headlinesAfter[headlinesAfter.length - 1] ?? '(none)'} rpc=${after?.total}`);

  const pillsAfterRemoval = await countPills();
  check('R9.2.1 — exactly one pill was removed from the visible summary',
    pillsAfterRemoval === pillsAfter2 - 1, `pills ${pillsAfter2} → ${pillsAfterRemoval}`);

  // R9.2.3 — the removed dimension is askable again. The user-visible proof is that the offer
  // button comes back at all: if the removed id had stayed in the asked carry, the pool would be
  // one question poorer, and on a cohort whose pool the two rounds have spent, «تحديد أكثر»
  // disappears entirely with no way back. Asserting the offer is present after a widening removal
  // is the observable half; verify-af-cross-round-carry.ts asserts the carry itself.
  await scrollToBottom();
  const offerBack = await page.evaluate(() =>
    [...document.querySelectorAll('div,span,button')].some((e: any) => /نحدد الطلب أكثر/.test((e.innerText || '').trim())));
  check('R9.2.3 — the offer to narrow again is available after the removal (the question was not burned)',
    offerBack, offerBack ? 'the «تحديد أكثر» offer is on the new turn' : 'no offer rendered — a removed question may have stayed in the asked carry');

  check('the journey exercised the expected production backend',
    origins.size === 1 && origins.has(new URL(SUPABASE_URL).origin),
    `saw ${[...origins].join(', ') || '(none)'}, expected ${new URL(SUPABASE_URL).origin}`);

  // ── MUTATION PROOFS ────────────────────────────────────────────────────────────────────────
  // Each takes the REAL captured artefacts and breaks exactly the property one assertion exists to
  // protect, then requires that assertion to return false. A green journey above plus a green
  // mutation block below is the only combination that means "production is correct AND this file
  // would have noticed if it were not".
  console.log('\n── MUTATION PROOFS (each must turn the paired assertion RED) ──');
  const mut = (label: string, ok: boolean) => check(`MUTATION — ${label}`, ok);
  const survivorKey = survived[0];

  mut('a rebuild that also drops a survivor is caught by droppedExactlyOne',
    survivorKey != null &&
    !R.droppedExactlyOne(preRemoval.body, { ...after.body, [survivorKey]: null }));
  mut('a survivor whose VALUE silently changed is caught by survivorsIntact',
    survivorKey != null &&
    !R.survivorsIntact(preRemoval.body, { ...after.body, [survivorKey]: ['__mutated__'] }));
  mut('a predicate the user never committed is caught by nothingInvented',
    !R.nothingInvented(preRemoval.body, { ...after.body, p_rating_min: 4 }));
  // The mutated city must be provably different from the one this run is actually searching, or the
  // "mutation" is a no-op and the proof is vacuous. It was, on the first جدة run of this file:
  // a hard-coded 'جدة' equalled the real value and the mutation could not turn the check red.
  // Derive it from the captured body instead of naming a city.
  mut('a city moved by the rebuild is caught by scopeUntouched',
    !R.scopeUntouched(preRemoval.body, { ...after.body, p_cities: [...(after.body.p_cities ?? []), '__not_a_city__'] }));
  mut('a count that NARROWED after a removal is caught by widenedOrHeld',
    !R.widenedOrHeld(countBefore, (countBefore ?? 1) - 1));
  mut('an earlier headline rewritten in place is caught by nothingAboveRewritten',
    !R.nothingAboveRewritten(headlinesBefore, headlinesAfter.map((h, i) => (i === 0 ? 'لقينا 1 إعلان يطابق طلبك.' : h))));

  // The DB-truth assertion is the one that must NOT be provable by pure logic — it is only worth
  // anything if the number really comes back from production. So this mutation is a REAL RPC: drop
  // the surviving predicate from the body and require the backend to return a DIFFERENT total. If
  // it returned the same number, the check above would pass no matter what the client sent, and the
  // whole DB-truth claim would be decoration.
  if (survivorKey) {
    const loosened = { ...after.body, [survivorKey]: null };
    const loosenedTotal = await fetch(`${SUPABASE_URL}/rest/v1/rpc/location_search_candidates_ar`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(loosened),
    }).then((r) => r.json()).then((j) => (Array.isArray(j) ? Number(j[0]?.total_count ?? (j.length === 0 ? 0 : NaN)) : NaN)).catch(() => NaN);
    check(`MUTATION — dropping the surviving ${survivorKey} really changes the backend's answer (the DB-truth check is sensitive to the body)`,
      Number.isFinite(loosenedTotal) && loosenedTotal !== after.total,
      `with ${survivorKey}=${JSON.stringify(after.body[survivorKey])}: ${after.total} · without it: ${Number.isFinite(loosenedTotal) ? loosenedTotal : 'unreadable'}`);
  }
} catch (e: any) {
  check('the journey completed without a harness error', false, e.message);
} finally {
  await ctx.close();
  await browser.close();
}

console.log(failures
  ? `\n✗ ${failures} check(s) FAILED:\n` + failedLabels.map((l) => `    • ${l}`).join('\n') + '\n'
  : '\n✓ removing an AF pill drops exactly that predicate, widens honestly, and rewrites nothing above it\n');
process.exit(failures ? 1 : 0);
