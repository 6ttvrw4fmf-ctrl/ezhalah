// §12A / R13.12 IN A REAL BROWSER — selection → visible on the card, proven against DB truth.
//
// R12A.6 asks for exactly this and names it as the rule's own barrier: "a live journey proves
// selection → visible-on-card for each certified field". scripts/verify-af-card-evidence.ts is the
// offline half — it EXECUTES the registry against synthetic rows and holds the SQL and the
// TypeScript to one contract. It cannot see the deployed bundle. This is the other half: it drives
// production, commits real Advanced-Filter answers, and reads the chips a human would read.
//
// WHAT IT ASSERTS, per rendered card of the committed turn:
//   R12A.1  every ACTIVE answer is present on the card, visible — no expander, no «+N», no slice
//   R12A.2  the chip carries the LISTING's own value, not the filter's label: a «+3» bathrooms
//           answer on a 5-bath listing must read «5 حمامات», never «+3» and never «3».
//   R12A.3  a column the source never published renders NOTHING for that question — no «غير مذكور»,
//           no 0, no false.
//   R13.12  no chip claims something the row does not satisfy (the strip never lies).
//
// WHERE THE GROUND TRUTH COMES FROM. Not from the DOM, and not from a second query that might see a
// different row: every expected chip is computed from the `af_canon` object carried by the SEARCH
// RESPONSE ITSELF, intercepted off the wire. That object is, by the migration's construction, the
// exact search_listings_ar row the predicate ran on — so a card and its truth cannot drift apart
// between two reads, and a stale/rotated listing cannot make a real mismatch look like a race.
// Each strip is joined to its row by the listing id on the card's own `card-listing-<id>` wrapper,
// never by position: a row that earns no chip renders no strip, so positional pairing would shift
// every later strip onto the wrong listing and report honest cards as lies.
//
// AND THE NEGATIVE, which is what makes the rest non-vacuous: a search with NO AF answer must show
// NO strip at all. Without it, a card that always rendered the same chips would pass every check
// above. The same case also proves the payload gate — af_canon is SQL NULL on that request.
//
// LIVE CHECK — excluded from `npm test` (drives a real browser against production); runs in
// .github/workflows/af-live-truth-check.yml beside the other AF journeys.
//
//   PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium node --experimental-strip-types scripts/verify-af-card-evidence-live.ts
//   AF_EV_CITY / AF_EV_GROUP / AF_EV_TYPE   scope (defaults الرياض / الشقق والسكن المشترك / شقة)
//   AF_EV_MOBILE=1                          390x844 touch viewport
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { openAfOffer } from './lib/afOfferLive.ts';
import { gotoLive } from './lib/liveNav.ts';
import { liftSymbols } from './lib/liftSymbols.ts';
import { AF_EVIDENCE, afActive, type AfCanon } from '../src/lib/afEvidence.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ONE BUDGET FOR "WAIT FOR THE AGENT'S NEXT TURN" — the same constant, for the same reason, as
// verify-af-live-truth.ts: every wait on an AF card is behind a paid LLM turn whose latency is
// variable and has been measured near 40s on a slow afternoon. 60s is set by the worst turn actually
// observed, not by a good day, and still fails in bounded time.
const AGENT_TURN_MS = 60_000;
const BASE = 'https://ezhalah-app.vercel.app';

const CITY = process.env.AF_EV_CITY || 'الرياض';
const GROUP = process.env.AF_EV_GROUP || 'الشقق والسكن المشترك';
const TYPE = process.env.AF_EV_TYPE || 'شقة';
const MOBILE = process.env.AF_EV_MOBILE === '1';
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 };

let failed = 0;
const skipped: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const skip = (label: string, why: string) => { skipped.push(label); console.log(`SKIP  ${label}\n      ${why}`); };

// The production Arabic voice, LIFTED from src/i18n.tsx rather than re-typed here — the same table
// and the same `{n}` interpolator the shipped bundle uses, so an expected chip text is the app's own
// string and not this file's guess at it. Imported as a module it would drag in react-native and
// reanimated, which do not load under node; liftSymbols builds a throwaway module from just those
// two declarations. (scripts/verify-af-card-evidence.ts, the offline half, lifts the identical pair.)
const i18n = await liftSymbols(join(ROOT, 'src/i18n.tsx'), [{ header: 'const AR' }, { header: 'function fill' }], ['AR', 'fill']);
const AR = i18n.AR as Record<string, string>;
const fill = i18n.fill as (tpl: string, vars?: Record<string, string | number>) => string;
const t = (en: string, vars?: Record<string, string | number>) => fill(AR[en] ?? en, vars);

// Verbatim technique from the sibling live journeys: a control can sit inside a scroll container
// that scrollIntoView() alone does not bring into the viewport, so walk up to the scroller first.
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

async function main() {
  const browser = await chromium.launch({
    ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors',
           ...(process.env.HTTPS_PROXY ? ['--disable-quic', '--ssl-version-max=tls1.2'] : [])],
  });
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: 'ar', hasTouch: MOBILE });
  const page = await ctx.newPage();

  // Every results request the app sends, with the body — the carrier of the ACTIVE predicates.
  const searches: Array<{ body: any; rows: any[] }> = [];
  page.on('response', async (res) => {
    if (!res.url().includes('/rpc/location_search_candidates_ar')) return;
    try {
      const body = JSON.parse(res.request().postData() || '{}');
      searches.push({ body, rows: await res.json() });
    } catch { /* a non-JSON body is not a search we can reason about */ }
  });

  console.log(`── scope: ${CITY} · ${GROUP} · ${TYPE} · ${MOBILE ? 'MOBILE 390x844' : 'desktop 1440x900'} ──\n`);

  const tap = async (txt: string, timeoutMs = 10_000) => {
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
  /** A RESULTS search, chosen by SHAPE not by arrival order — several calls share this RPC name and
   *  complete out of order, so "the newest response" can be a count-style probe, not the page. */
  const isResults = (s: { body: any }) => (s.body?.p_offset ?? 0) === 0 && Number(s.body?.p_limit ?? 0) > 1;
  const waitForSearch = async (armed: number, timeoutMs = 45_000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const c = searches.slice(armed).filter(isResults);
      if (c.length) return c[c.length - 1];
      await page.waitForTimeout(400);
    }
    return null;
  };

  // ── 1. the NEGATIVE first: a plain search shows no strip and pays no payload ──────────────────
  // The Filter flow, never the paid AI path: city (typed + confirmed) → group → type → بحث.
  const armed0 = searches.length;
  await gotoLive(page, `${BASE}/`, { timeout: 60_000 });
  await page.waitForTimeout(5000);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.click('[data-testid="city-input"]');
    await page.fill('[data-testid="city-input"]', '');
    await page.type('[data-testid="city-input"]', CITY, { delay: 60 });
    await tap(CITY, 6000).catch(() => {});
    if (await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 4000 }).catch(() => null)) break;
    if (attempt === 3) throw new Error(`the app never confirmed the city ${CITY} after 3 attempts`);
  }
  await tap(GROUP);
  await tap(TYPE);
  await tap('بحث');
  const plain = await waitForSearch(armed0);
  check('a plain search landed', !!plain, plain ? `total ${plain.rows?.[0]?.total_count}, ${plain.rows?.length} row(s)` : 'no results-shaped request captured in 45s');
  if (!plain) { await browser.close(); process.exit(1); }
  await page.waitForTimeout(4000);
  check('R12A/gate — a search with NO AF answer carries no af_canon (the payload gate holds live)',
    (plain.rows ?? []).every((r: any) => r.af_canon == null),
    `${(plain.rows ?? []).filter((r: any) => r.af_canon != null).length} of ${(plain.rows ?? []).length} rows packed`);
  const stripsBefore = await page.evaluate(() => document.querySelectorAll('[data-testid="card-af-evidence"]').length);
  check('R12A — no «مطابق لطلبك» strip before any AF answer (the strip is not always-on)',
    stripsBefore === 0, `${stripsBefore} strip(s) on screen`);

  // ── 2. commit real AF answers through the agent flow ─────────────────────────────────────────
  const opened = await openAfOffer(page);
  if (!opened.opened) {
    skip('the AF offer opened', `NOT VERIFIED — ${opened.reason} after ${opened.waitedMs}ms`);
    console.log(`\n✗ could not reach Advanced Filter; nothing about §12A was proved`);
    await browser.close(); process.exit(1);
  }
  const before = searches.length;
  // The offer's click starts a turn; the question card renders after it, not with it.
  const card0 = await page.waitForSelector('[data-testid="af-card"]', { timeout: 45_000 }).catch(() => null);
  if (!card0) {
    skip('an AF question card rendered', 'NOT VERIFIED — the offer opened but no [data-testid="af-card"] appeared in 45s');
    console.log('\n✗ could not reach an Advanced Filter question; nothing about §12A was proved');
    await browser.close(); process.exit(1);
  }
  await page.waitForTimeout(2500);

  // Answer EVERY question the round offers, not just the first: each answered facet is one more
  // active question the card must account for, so answering widely is what makes the comparison
  // below bite on more than a single chip. R11 ends the round on its own; the loop just follows it.
  // POLL FOR THE OPTIONS; NEVER READ THEM ONCE AFTER A FIXED SLEEP (2026-09-04). The card element
  // mounts as soon as the round opens, but its options render only when the agent's turn resolves —
  // a paid LLM round-trip whose latency is variable and has been measured at ~40s (see the same
  // lesson recorded in verify-af-live-truth.ts's AGENT_TURN_MS comment). A single read after 2,500 ms
  // therefore saw an empty option list on a perfectly healthy card, broke the loop at step 0, and the
  // run reported «no AF predicate was committed — §12A could not be exercised» — a harness timeout
  // dressed as an unprovable product rule (run 33855677911, desktop الرياض/شقة, while the mobile
  // جدة/فيلا scope in the same run confirmed four questions on the same build).
  //
  // An empty list is only meaningful once the card has had the agent's full budget to fill it. This
  // returns the instant options appear, so a fast round is not slowed down, and still terminates.
  const optionsWhenRendered = async (budgetMs = AGENT_TURN_MS): Promise<string[]> => {
    const until = Date.now() + budgetMs;
    for (;;) {
      const opts: string[] = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid^="af-option-"]')].map((e) => e.getAttribute('data-testid') || ''));
      if (opts.length) return opts;
      if (!(await page.$('[data-testid="af-card"]'))) return [];   // the round ended — nothing left to answer
      if (Date.now() >= until) return [];
      await page.waitForTimeout(500);
    }
  };

  let answered = 0;
  for (let step = 0; step < 12; step++) {
    const opts = await optionsWhenRendered();
    if (!opts.length) {
      console.log(`      [diag] round ${step}: no af-option rendered within ${AGENT_TURN_MS}ms (af-card ${await page.$('[data-testid="af-card"]') ? 'present' : 'gone'})`);
      break;
    }
    await page.click(`[data-testid="${opts[0]}"]`).catch(() => {});
    await page.waitForTimeout(700);
    const confirm = await page.$('[data-testid="af-confirm"]');
    if (confirm) { await confirm.click(); answered++; await page.waitForTimeout(2200); continue; }
    const skip = await page.$('[data-testid="af-skip"]');
    if (!skip) break;
    await skip.click(); await page.waitForTimeout(1800);
  }

  const committed = await (async () => {
    const until = Date.now() + 45_000;
    while (Date.now() < until) {
      const c = searches.slice(before).filter((s) => isResults(s) && afActive(bodyToQuery(s.body)).length > 0);
      if (c.length) return c[c.length - 1];
      await page.waitForTimeout(500);
    }
    return null;
  })();
  const active = committed ? afActive(bodyToQuery(committed.body)) : [];
  check('an AF answer reached a new search', !!committed && active.length > 0,
    `${answered} question(s) confirmed · active: ${active.map((a) => `${a.id}=${JSON.stringify(a.keys)}`).join(', ') || '(none)'}`);
  if (!committed || active.length === 0) {
    console.log('\n✗ no AF predicate was committed — §12A could not be exercised');
    await browser.close(); process.exit(1);
  }
  check('R12A/gate — the AF-narrowed search DOES carry af_canon',
    (committed.rows ?? []).every((r: any) => r.af_canon != null),
    `${(committed.rows ?? []).filter((r: any) => r.af_canon == null).length} of ${(committed.rows ?? []).length} rows unpacked`);

  // ── 3. read the chips a human reads, and hold each to the listing's own canonical row ─────────
  await page.waitForTimeout(4000);
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid="card-af-evidence"]')]
    .map((strip: any) => ({
      // WHICH LISTING this strip belongs to. Matching strips to response rows by POSITION is
      // unsound: a row that earns no chip renders no strip, which shifts every strip after it onto
      // the wrong row and turns an honest card into a reported lie (and vice versa).
      listingId: (() => {
        let a = strip.parentElement;
        while (a) {
          const m = /^card-listing-(\d+)$/.exec(a.getAttribute?.('data-testid') || '');
          if (m) return Number(m[1]);
          a = a.parentElement;
        }
        return null;
      })(),
      chips: [...strip.querySelectorAll('[data-testid^="card-af-evidence-"]')]
        // The chip is «icon + text», and BOTH halves of that reach innerText as things a reader
        // never sees: the Ionicons checkmark is a font glyph in the Unicode private-use area
        // (U+E000-U+F8FF, plus the supplementary planes), and an RTL layout can insert bidi
        // controls (LRM/RLM/ALM and the isolate marks). Neither is whitespace, so `\s` misses them
        // and trim() cannot remove them — the first live run reported four «mismatches» that were
        // one invisible glyph, rendered by the terminal as a blank so it read as a leading space.
        // Strip both, then collapse whitespace: the assertion is about the VALUE the user reads,
        // never about how the renderer laid the glyphs out.
        .map((c: any) => ({
          id: (c.getAttribute('data-testid') || '').replace('card-af-evidence-', ''),
          text: (c.innerText || '')
            .replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '')  // icon glyphs (private use)
            .replace(/[\u200E\u200F\u061C\u2066-\u2069]/g, '')                              // bidi controls
            .replace(/\s+/g, ' ')
            .trim(),
        })),
      // R12A.1 forbids a cap. Today ResultCard renders a plain .map() with no expander, so a
      // dedicated testID would only ever be absent — a check that cannot fail. This looks for the
      // SHAPE an expander takes instead (a «+4» / «عرض الكل» affordance sitting inside the strip),
      // so it still bites if someone adds one later under a name this file never heard of.
      hasMore: [...strip.querySelectorAll('*')].some((e: any) => {
        const s = (e.innerText || '').trim();
        return /^\+\s*\d+$/.test(s) || s === 'عرض الكل' || s === 'المزيد';
      }),
    })));
  check('R12A.1 — the committed turn renders «مطابق لطلبك» strips', cards.length > 0, `${cards.length} strip(s)`);
  check('R12A.1 — no strip hides a selection behind an expander', cards.every((c) => !c.hasMore),
    `${cards.filter((c) => c.hasMore).length} strip(s) carry a «+N»`);

  // The rows the app was handed, keyed by listing_id. The key is VERIFIED unique on this very page
  // rather than assumed: listing_id is a global sequence across all 25 source tables today, but a
  // barrier that silently degrades when that stops holding is worse than one that says so.
  const rows: Array<{ source_table: string; listing_id: number; af_canon: AfCanon }> = (committed.rows ?? []) as any;
  const byId = new Map<number, AfCanon>();
  let dupIds = 0;
  for (const r of rows) { if (byId.has(r.listing_id)) dupIds++; byId.set(r.listing_id, r.af_canon); }
  check('the join key is sound — listing_id is unique across the page the app rendered',
    dupIds === 0, `${dupIds} duplicate listing_id(s) among ${rows.length} row(s)`);
  const unidentified = cards.filter((c) => c.listingId == null).length;
  check('every rendered strip could be traced back to its own listing',
    unidentified === 0, `${unidentified} of ${cards.length} strip(s) had no card-listing-<id> ancestor`);

  // `unknownSeen` / `unsatisfiedSeen` count how many times each branch was actually REACHED, not
  // how many times it misbehaved. Without them, "R12A.3 passed" and "R13.12 passed" are silent on
  // whether the run ever met an UNKNOWN column or a non-satisfying row at all — and a check that
  // asserts nothing about an unvisited branch is a check that cannot fail. They are reported as
  // NOT EXERCISED rather than PASS when the count is 0, so the grade this journey earns matches
  // what it really proved.
  let compared = 0, wrongValue = 0, missingChip = 0, falseChip = 0, unknownShown = 0, unmatched = 0;
  let unknownSeen = 0, unsatisfiedSeen = 0;
  const notes: string[] = [];

  for (let i = 0; i < cards.length; i++) {
    const lid = cards[i].listingId;
    const canon = lid == null ? null : byId.get(lid);
    if (!canon) { if (lid != null) unmatched++; continue; }
    const got = new Map(cards[i].chips.map((c) => [`${c.id}|${c.text}`, true]));
    for (const { id, keys } of active) {
      const def = AF_EVIDENCE[id];
      if (!def) continue;
      const reads = def.reads(keys);
      const anyUnknown = reads.some((col) => canon[col] == null);
      const satisfied = !anyUnknown && def.ok(keys, canon);
      const expected = satisfied ? def.chips(keys, canon, t) : [];
      const rendered = cards[i].chips.filter((c) => c.id === id).map((c) => c.text);

      if (anyUnknown) {
        // R12A.3 — a column the source never published must render NOTHING for this question.
        unknownSeen++;
        if (rendered.length) { unknownShown++; notes.push(`listing ${lid} «${id}»: UNKNOWN column but rendered ${JSON.stringify(rendered)}`); }
        continue;
      }
      if (!satisfied) {
        // R13.12 — the strip must never claim something the row does not satisfy.
        unsatisfiedSeen++;
        if (rendered.length) { falseChip++; notes.push(`listing ${lid} «${id}»: row does NOT satisfy it but rendered ${JSON.stringify(rendered)}`); }
        continue;
      }
      compared++;
      for (const want of expected) {
        if (!got.has(`${id}|${want}`)) {
          if (rendered.length) { wrongValue++; notes.push(`listing ${lid} «${id}»: expected «${want}» (the ROW's value), card shows ${JSON.stringify(rendered)}`); }
          else { missingChip++; notes.push(`listing ${lid} «${id}»: expected «${want}», card shows nothing`); }
        }
      }
    }
  }

  check('R12A.1 — every active answer the row satisfies is ON the card', missingChip === 0,
    notes.filter((n) => n.includes('shows nothing')).slice(0, 4).join('\n      '));
  check('R12A.2 — every chip carries the LISTING\'s own value, not the filter\'s label', wrongValue === 0,
    notes.filter((n) => n.includes('the ROW\'s value')).slice(0, 4).join('\n      '));
  if (unknownSeen > 0) {
    check(`R12A.3 — an UNKNOWN column renders nothing for that question (${unknownSeen} case(s) met)`,
      unknownShown === 0, notes.filter((n) => n.includes('UNKNOWN')).slice(0, 4).join('\n      '));
  } else {
    skip('R12A.3 — an UNKNOWN column renders nothing for that question',
      'NOT EXERCISED: every (question × card) pair this run met had a published value on every column it '
      + 'reads, so the null-guard was never reached. Expected — §2.5 predicates are NULL-excluding, so a '
      + 'returned row normally HAS the value. The offline twin covers this branch with synthetic rows.');
  }
  if (unsatisfiedSeen > 0) {
    check(`R13.12 — no chip claims something the row does not satisfy (${unsatisfiedSeen} case(s) met)`,
      falseChip === 0, notes.filter((n) => n.includes('does NOT satisfy')).slice(0, 4).join('\n      '));
  } else {
    skip('R13.12 — no chip claims something the row does not satisfy',
      'NOT EXERCISED: every row the search returned satisfied every active answer, which is what a correct '
      + 'predicate DOES — so this branch is unreachable through the UI while search is right. A row that '
      + 'reached it would itself be a §2.5 violation. Covered offline against synthetic rows.');
  }
  check('every identified strip belongs to a listing THIS search returned', unmatched === 0,
    `${unmatched} strip(s) carried a listing id absent from the committed response — a stale card left on screen`);
  check('the comparison actually bit (chips were checked against real rows)', compared > 0,
    `${compared} (question × card) pair(s) compared across ${cards.length} card(s)`);

  console.log(`\n      [diag] active=${active.map((a) => a.id).join(',')} · cards=${cards.length}`
    + ` · comparisons=${compared} · UNKNOWN cases met=${unknownSeen} · non-satisfying rows met=${unsatisfiedSeen}`);
  await browser.close();

  console.log('');
  if (skipped.length) console.log(`(${skipped.length} check(s) NOT EXERCISED)`);
  if (failed) { console.error(`✗ ${failed} check(s) FAILED — §12A is not honest on the live card`); process.exit(1); }
  console.log('✓ every Advanced-Filter answer is visible on the card, carries the listing\'s own value, and never claims what the row does not prove');
}

/** The request body the app sent, back into the SearchQuery shape afActive() reads. */
function bodyToQuery(b: any): any {
  if (!b) return null;
  return {
    amenities: b.p_amenities ?? undefined,
    bathMin: b.p_bath_min ?? undefined,
    furnishedPref: b.p_furnished ?? undefined,
    streetWidthMin: b.p_street_width_min ?? undefined,
    directions: b.p_directions ?? undefined,
    ratingMin: b.p_rating_min ?? undefined,
    reviewsMin: b.p_reviews_min ?? undefined,
    unitSubtypes: b.p_unit_subtypes ?? undefined,
    ageMin: b.p_age_min ?? undefined,
    ageMax: b.p_age_max ?? undefined,
    isNewConstruction: b.p_is_new_construction ?? undefined,
  };
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
