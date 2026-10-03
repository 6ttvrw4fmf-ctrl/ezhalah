#!/usr/bin/env node
// 🆕 New Listings Engineer — the READY customer-journey tool (normal filter + Advanced Filter),
// read-only against production. Built 2026-10-02 so no run ever rebuilds it again (the 2026-10-02
// run lost 10 of its 18 minutes to throwaway lib.js/journey.js/run1.js; the 2026-09-28 run could
// not confirm its 3 AF tests because it trusted the on-screen count, which updates late).
//
//   node e2e/engineers/customer-journey.mjs --mode normal --sample 5
//   node e2e/engineers/customer-journey.mjs --mode af --listings '[{"platform":"aqar","source_table":"listings","listing_id":123}]'
//   flags: --mode normal|af (required) · --sample N | --listings '<json>' · --phone (full mobile
//          emulation; the viewport is phone-size either way) · --json (machine lines only)
//
// NORMAL: drive the Filter home the way a customer does (deal toggle, city typeahead, district
//   typeahead, type group, area/price ranges around the listing's own values, بحث), page through
//   «عرض المزيد», find the card (testid card-listing-<id> — the per-card anchor
//   docs/ops/VERIFYING_PRODUCTION.md names), click it. PASS = card found AND it opened the
//   listing's own stored source URL (read from its source table via the public anon key).
// AF: continue into the Advanced Filter (results-narrow), answer 1–2 questions whose answer the
//   listing is KNOWN in the DB to carry (amenity chips / furnished), then verify on the SEARCH
//   REQUEST the page sent (its p_* parameters) that the answers reached the backend, and prove
//   membership by replaying that exact body through the anon RPC (narrowed to the listing's own
//   platform — a pure subset, so presence there is presence in the full set). NEVER the on-screen
//   count. PASS = request carried the answers AND the listing is in the returned rows.
//
// The app offers the guided interview only when MORE than 25 results are left to narrow, so AF mode
// searches the district without area/price, widens to the whole city if that is <= 25, and says
// UNKNOWN (never FAIL, never PASS) when even the city is that small.
// Each journey retries once on a transient loading state. Verdicts: PASS / FAIL (failed step +
// screenshot path) / UNKNOWN (site unreachable, or the journey cannot be driven for a stated
// reason — e.g. the interview never offered a question the listing can answer). Never PASS
// without evidence. Exit 0 ⇔ no FAIL. One JSON line per listing + a summary line.
//
// Works in both environments: Playwright from the routine container path first, then normal
// resolution; when /opt/pw-browsers exists the launch uses the container-safe recipe from
// docs/ops/VERIFYING_PRODUCTION.md (pinned executable, --proxy-server=$HTTPS_PROXY,
// --ssl-version-max=tls1.2 — certificate verification stays ON). Politeness: ≤ 1 page action/sec,
// ≤ 40 listings per run (hard-capped below), «عرض المزيد» capped at 8 presses.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normUrl, isMainSearch, afTargetsFor, carriedOnRequest, typeUi, TYPE_UI,
  priceOf, rangeAround, pickSpread, idKey,
} from './journey-lib.mjs';

// ── environment ────────────────────────────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
const pwPath = ['/opt/node22/lib/node_modules/playwright', 'playwright'].find((p) => {
  try { require.resolve(p); return true; } catch { return false; }
});
if (!pwPath) { console.error('playwright not found (container path or node_modules)'); process.exit(2); }
const { chromium } = require(pwPath);
const CONTAINER = fs.existsSync('/opt/pw-browsers');
const exe = CONTAINER
  ? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p))
  : undefined; // local: playwright's own browser install

const BASE = 'https://ezhalah-app.vercel.app';
// The app's PUBLIC anon endpoint (scripts/lib/public-supabase.ts) — RLS-respecting, read-only,
// the exact path a customer's browser reads data through. Env wins so a run can be re-pointed.
const SB = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbm5hcmJrd2N5bXJvdHp3ZGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDgxMDAsImV4cCI6MjA5NTk4NDEwMH0.Z-GhSpan6otYWkc8sU43Dw5PT5T_VBUMr0IDZShCQw0';
const H = { apikey: ANON, Authorization: `Bearer ${ANON}` };
const rest = async (pathAndQs, extra = {}) => {
  const r = await fetch(`${SB}/rest/v1/${pathAndQs}`, { headers: { ...H, ...extra.headers }, ...extra });
  if (!r.ok) throw new Error(`PostgREST ${r.status} on ${pathAndQs.split('?')[0]}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const rpc = (body) => fetch(`${SB}/rest/v1/rpc/location_search_candidates_ar`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

// ── args ───────────────────────────────────────────────────────────────────────────────────
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : null; };
const MODE = arg('mode');
const PHONE = process.argv.includes('--phone');
const JSON_ONLY = process.argv.includes('--json');
if (MODE !== 'normal' && MODE !== 'af') { console.error("need --mode normal|af"); process.exit(2); }
const SAMPLE = arg('sample') ? Math.min(8, parseInt(arg('sample'), 10)) : null;     // politeness cap
const LISTINGS = arg('listings') ? JSON.parse(arg('listings')) : null;
if (!SAMPLE && !Array.isArray(LISTINGS)) { console.error("need --sample N or --listings '<json>'"); process.exit(2); }
const MAX_PER_RUN = 12;                                   // hard politeness cap (<= 40 rule, with margin)
const LOAD_MORE_MAX = 8;
const SHOT_DIR = process.env.JOURNEY_OUT_DIR || path.join(os.tmpdir(), 'customer-journey');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const log = (...m) => { if (!JSON_ONLY) console.log(...m); };

// ── listing data (anon key, read-only) ───────────────────────────────────────────────────────
const ROW_COLS = 'platform,source_table,listing_id,city_ar,district_ar,region_ar,deal_ar,type_ar,' +
  'rent_period_ar,price_total,price_annual,price_total_effective,area_m2,furnished,elevator,kitchen,' +
  'parking,air_conditioner,private_entrance,maid_room,driver_room,balcony,pool,garden,gym,' +
  'laundry_room,optical_fibers,first_seen_at,production_ready';

const fetchRow = async (l) => {
  const rows = await rest(`search_listings_ar?select=${ROW_COLS}` +
    `&source_table=eq.${encodeURIComponent(l.source_table)}&listing_id=eq.${encodeURIComponent(l.listing_id)}&limit=1`);
  return rows[0] ?? null;
};
const fetchSourceUrl = async (row) => {
  const rows = await rest(`${encodeURIComponent(row.source_table)}?select=listing_url&id=eq.${encodeURIComponent(row.listing_id)}&limit=1`);
  return rows[0]?.listing_url ?? null;
};

const sampleListings = async (n) => {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  // Types the tool knows how to tap; AF additionally needs a known amenity/furnished answer and a
  // cohort that certifies those questions (residential apartment-form / villa types).
  const afTypes = ['شقة', 'فيلا', 'دور', 'عمارة سكنية'];
  const afOr = 'or=(furnished.is.true,elevator.is.true,kitchen.is.true,parking.is.true,air_conditioner.is.true,maid_room.is.true,driver_room.is.true,balcony.is.true,pool.is.true)';
  const typeList = (MODE === 'af' ? afTypes : Object.keys(TYPE_UI))
    .map((t) => encodeURIComponent(`"${t}"`)).join(',');   // quoted: several type_ar carry spaces
  const base = `production_ready=is.true&first_seen_at=gte.${since}` +
    `&city_ar=not.is.null&district_ar=not.is.null&type_ar=in.(${typeList})` +
    `&or=(deal_ar.eq.بيع,rent_period_ar.in.(سنوي,شهري))` +
    (MODE === 'af' ? `&${afOr}` : '');
  // Platforms crawl in bursts, so the newest K rows can be ONE site (measured 400/400 aqar on
  // 2026-10-02). Discover which platforms sent eligible arrivals, then take a few newest per
  // platform, so the spread is real.
  const platforms = [];
  for (let i = 0; i < 15; i++) {
    const notIn = platforms.length ? `&platform=not.in.(${platforms.map((p) => encodeURIComponent(`"${p}"`)).join(',')})` : '';
    const one = await rest(`search_listings_ar?select=platform&${base}${notIn}&limit=1`);
    if (!one.length) break;
    platforms.push(one[0].platform);
  }
  const rows = (await Promise.all(platforms.map((p) =>
    rest(`search_listings_ar?select=${ROW_COLS}&${base}&platform=eq.${encodeURIComponent(p)}&order=first_seen_at.desc&limit=30`)))).flat();
  const usable = rows.filter((r) => typeUi(r.type_ar) && (MODE !== 'af' || afTargetsFor(r).length));
  if (MODE !== 'af') return pickSpread(usable, n);
  // The app offers the guided interview only above 25 results, so an AF sample prefers listings
  // whose city + deal + type scope is comfortably larger (one cheap exact-count request each).
  const out = [];
  for (const r of pickSpread(usable, n * 3)) {
    if (out.length >= n) break;
    const cnt = await fetch(`${SB}/rest/v1/search_listings_ar?select=listing_id&production_ready=is.true` +
      `&city_ar=eq.${encodeURIComponent(r.city_ar)}&deal_ar=eq.${encodeURIComponent(r.deal_ar)}&type_ar=eq.${encodeURIComponent(r.type_ar)}` +
      (r.deal_ar === 'إيجار' ? `&rent_period_ar=eq.${encodeURIComponent(r.rent_period_ar)}` : ''),
    { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } }).then((x) => Number((x.headers.get('content-range') || '').split('/')[1])).catch(() => 0);
    if (cnt > 40) out.push(r);
  }
  return out;
};

// ── browser plumbing ─────────────────────────────────────────────────────────────────────────
const VIEWPORT = { width: 390, height: 844 };             // phone-size, both modes (owner rule)
const launch = () => chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    ...(CONTAINER ? ['--ssl-version-max=tls1.2'] : []),
    ...(CONTAINER && process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [])],
});

// Click the smallest visible element whose text is exactly `txt` (shape: verify-af-*-live.ts).
const CLICK_LEAF = (txt) => {
  let best = null;
  document.querySelectorAll('div,span,li,button').forEach((e) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  let a = best.parentElement, sc = null;
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

async function runJourney(row, sourceUrl, attempt, opts = {}) {
  const steps = [];
  const step = (s) => { steps.push(s); log(`    · ${s}`); };
  const browser = await launch();
  const result = { status: 'FAIL', failedStep: null, screenshot: null, evidence: {}, noDistrictUsed: !!opts.noDistrict };
  let page = null;
  try {
    const ctx = await browser.newContext({
      locale: 'ar-SA', viewport: VIEWPORT,
      ...(PHONE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
    });
    // A card opens its source in a new tab: record the URL instead of loading the source site.
    await ctx.addInitScript(() => {
      window.__opened = [];
      window.open = (u) => { window.__opened.push(String(u)); return null; };
    });
    page = await ctx.newPage();
    const searches = [];
    page.on('response', async (r) => {
      if (!r.url().includes('/rpc/location_search_candidates_ar') || r.request().method() !== 'POST') return;
      try {
        const j = await r.json();
        if (!Array.isArray(j)) return;
        searches.push({
          body: JSON.parse(r.request().postData() || '{}'),
          total: j.length ? Number(j[0]?.total_count ?? NaN) : 0,
          rows: j.map((x) => `${x.source_table}:${x.listing_id}`),
        });
      } catch { /* a body we could not read is not a search we can assert on */ }
    });
    const tap = async (txt, timeoutMs = 10000) => {
      const until = Date.now() + timeoutMs;
      let box = null;
      while (Date.now() < until && !(box = await page.evaluate(CLICK_LEAF, txt))) await page.waitForTimeout(400);
      if (!box) throw new Error(`control never rendered: ${txt}`);
      await page.mouse.click(box.x, box.y);
      await page.waitForTimeout(1000);                    // politeness: ≤ 1 action/sec
    };
    const lastMainSearchAfter = (n) => {
      const c = searches.slice(n).filter((x) => isMainSearch(x.body));
      return c.length ? c[c.length - 1] : null;
    };
    const awaitNewMainSearch = async (n, tries = 30) => {
      for (let i = 0; i < tries; i++) {
        if (lastMainSearchAfter(n)) break;
        await page.waitForTimeout(1000);
      }
      await page.waitForTimeout(3000);                    // let sibling calls of the same بحث land
      return lastMainSearchAfter(n);
    };

    // ── navigate (UNKNOWN territory until the app renders) ────────────────────────────────
    step('goto');
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      result.status = 'UNKNOWN'; result.failedStep = `goto: ${e.message?.split('\n')[0]}`;
      return result;
    }
    await page.waitForTimeout(4000);
    await page.getByText('الضروري فقط').click({ timeout: 8000 }).catch(() => {}); // consent: decline non-essential

    // ── the filter, the way a customer fills it ────────────────────────────────────────────
    const ui = typeUi(row.type_ar);
    if (!ui) { result.status = 'UNKNOWN'; result.failedStep = `type_ar «${row.type_ar}» has no UI mapping in journey-lib.mjs`; return result; }

    step('deal');
    if (row.deal_ar === 'إيجار') {
      await tap('إيجار');
      await tap('شراء');                                  // deselect Buy → Rent-only (سنوي pre-selected)
      if (row.rent_period_ar === 'شهري') { await tap('شهري'); await tap('سنوي'); }
    }

    step(`city «${row.city_ar}»`);
    await page.click('[data-testid="city-input"]');
    await page.fill('[data-testid="city-input"]', row.city_ar);
    await page.waitForTimeout(2000);
    await tap(row.city_ar, 8000);
    await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 8000 }).catch(() => {});

    const districtBare = String(row.district_ar).replace(/^حي\s+/, '');
    if (!opts.noDistrict) {
      step(`district «${districtBare}»`);
      await page.click('[data-testid="district-input"]');
      await page.fill('[data-testid="district-input"]', districtBare);
      await page.waitForTimeout(2500);
      await tap(`حي ${districtBare}`, 6000).catch(() => tap(districtBare, 6000));
    }

    step(`type ${ui.cat} → ${ui.group} → ${ui.tap}`);
    await tap(ui.cat).catch(() => {});                    // category may already be the default tab
    await tap(ui.group);
    await tap(ui.tap).catch(() => log(`    ! no «${ui.tap}» box (group-level search)`));

    // ranges around the listing's own values (customer behaviour; never written over the source)
    const fillRange = async (tid, v) => {
      if (v == null) return;
      const el = await page.$(`[data-testid="${tid}"]`);
      if (!el) { log(`    ! no ${tid} input visible`); return; }
      await el.click(); await el.fill(String(v)); await page.waitForTimeout(600);
    };
    // AF mode keeps the scope broad: the app offers the guided interview only when MORE than 25
    // listings are left to narrow (INTERVIEW_STOP_AT, src/lib/afRanking.ts), and the AF answers
    // are what narrows — membership is proven on the request, so no area/price box is needed.
    const area = MODE === 'af' ? null : rangeAround(Number(row.area_m2));
    const price = MODE === 'af' ? null : rangeAround(priceOf(row));
    if (area) { step(`area ${area.min}–${area.max}`); await fillRange('area-min-input', area.min); await fillRange('area-max-input', area.max); }
    if (price) { step(`price ${price.min}–${price.max}`); await fillRange('price-min-input', price.min); await fillRange('price-max-input', price.max); }

    step('بحث');
    const n0 = searches.length;
    await tap('بحث');
    const main = await awaitNewMainSearch(n0);
    if (!main) throw new Error('no main search landed after بحث (transient loading?)');
    result.evidence.search = { p_deal: main.body.p_deal, p_rent_period: main.body.p_rent_period ?? null, total: main.total };
    await page.waitForSelector('[data-testid^="card-listing-"]', { timeout: 60000 }).catch(() => {
      throw new Error(`no result cards appeared (total=${main.total})`);
    });

    // ── find the card (both modes prove normal findability first) ─────────────────────────
    step('find card');
    const cardSel = `[data-testid="card-listing-${row.listing_id}"]`;
    const card = page.locator(cardSel);
    const all = page.locator('[data-testid^="card-listing-"]');
    const revealAll = async () => {                       // cascade reveal (src/lib/initialReveal.ts)
      let prev = -1;
      for (let i = 0; i < 40; i++) {
        if (await card.count()) return;
        const now = await all.count();
        if (now === prev) return;
        prev = now;
        await all.last().scrollIntoViewIfNeeded().catch(() => {});
        await page.mouse.wheel(0, 4000);
        await page.waitForTimeout(1000);
      }
    };
    let presses = 0, found = false;
    const maxPresses = MODE === 'normal' ? LOAD_MORE_MAX : 0; // AF proves membership on the request, not by paging
    for (let p = 0; p <= maxPresses; p++) {
      await page.waitForTimeout(2000);
      await revealAll();
      if (await card.count()) { found = true; presses = p; break; }
      if (p === maxPresses) break;
      const more = page.locator('[data-testid="results-load-more"]');
      if (!(await more.count())) { const t = page.getByText('عرض المزيد', { exact: true }); if (!(await t.count())) break; await t.last().scrollIntoViewIfNeeded(); await t.last().click(); }
      else { await more.last().scrollIntoViewIfNeeded(); await more.last().click(); }
      await page.waitForTimeout(1500);
    }
    result.evidence.loadMorePresses = presses;
    if (MODE === 'af' && main.total <= 25) {
      // by design the interview is not offered on a result set this small — widen, never fake it
      result.status = opts.noDistrict ? 'UNKNOWN' : 'WIDER';
      result.failedStep = `search total ${main.total} ≤ 25: the app offers no guided interview on so few results${opts.noDistrict ? ' (city-wide too)' : ''}`;
      return result;
    }
    if (MODE === 'normal') {
      if (!found) throw new Error(`card not found after ${LOAD_MORE_MAX} «عرض المزيد» presses (total=${main.total})`);
      const text = (await card.first().innerText()).replace(/\s*\n+\s*/g, ' | ');
      result.evidence.card = text.slice(0, 300);
      step('click card');
      const link = card.first().getByRole('link').first();
      if (await link.count()) await link.click(); else await card.first().click();
      await page.waitForTimeout(1500);
      const opened = await page.evaluate(() => window.__opened.at(-1) ?? null);
      result.evidence.opened = opened;
      result.evidence.sourceUrl = sourceUrl;
      if (!opened) throw new Error('card click opened nothing');
      if (normUrl(opened) !== normUrl(sourceUrl)) throw new Error(`opened ${opened} ≠ stored ${sourceUrl}`);
      result.status = 'PASS';
      return result;
    }

    // ── AF mode: the guided interview ──────────────────────────────────────────────────────
    const targets = afTargetsFor(row);
    if (!targets.length) { result.status = 'UNKNOWN'; result.failedStep = 'listing carries no DB-known AF answer (all unknown/false)'; return result; }
    result.evidence.cardFoundBeforeAF = found;            // informative, not the AF verdict
    step(`open AF (targets: ${targets.map((t) => t.kind === 'amenity' ? t.token : 'furnished=yes').join(', ')})`);
    const nAF = searches.length;
    // The narrow button renders at the END of the results turn and only once the reveal cascade
    // settles (agent.tsx resultsRowIsReady) — scroll every scrollable to its bottom and poll.
    const scrollToBottom = () => page.evaluate(() => {
      [...document.querySelectorAll('*')]
        .filter((e) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY))
        .forEach((e) => { e.scrollTop = e.scrollHeight; });
    });
    const narrow = page.locator('[data-testid="results-narrow"]');
    let opened = false;
    for (let i = 0; i < 45 && !opened; i++) {
      await scrollToBottom();
      await page.waitForTimeout(1200);
      if (await narrow.count()) {
        await narrow.first().scrollIntoViewIfNeeded().catch(() => {});
        await narrow.first().click();
        opened = true;
      } else {
        opened = await tap('خلّنا نحدد الطلب أكثر', 500).then(() => true)
          .catch(() => tap('نحدد الطلب أكثر', 500).then(() => true).catch(() => false));
      }
    }
    if (!opened) throw new Error('AF entry (results-narrow / «خلّنا نحدد الطلب أكثر») never rendered');
    step('AF entry clicked');
    await page.waitForTimeout(3500);

    const answered = [];
    const readQuestion = async (timeoutMs = 15000) => {   // the options wait on a live count probe
      const until = Date.now() + timeoutMs;
      let seen = { opts: [], title: '' };
      while (Date.now() < until && !seen.opts.length && !lastMainSearchAfter(nAF)) {
        seen = await page.evaluate(() => ({
          opts: [...document.querySelectorAll('[data-testid^="af-option-"]')].map((e) => e.getAttribute('data-testid').slice('af-option-'.length)),
          title: document.querySelector('[data-testid="af-question-title"]')?.innerText?.trim() ?? '',
        }));
        if (!seen.opts.length) await page.waitForTimeout(1000);
      }
      return seen;
    };
    for (let screen = 0; screen < 8; screen++) {
      if (lastMainSearchAfter(nAF)) break;                // the round already closed into a search
      const seen = await readQuestion();
      step(`question «${seen.title}» options: ${seen.opts.join(',') || '(none)'}`);
      if (!seen.opts.length) break;
      let clicked = 0;
      for (const t of targets) {
        if (answered.includes(t)) continue;
        const key = t.kind === 'amenity' && seen.opts.includes(t.token) ? t.token
          : t.kind === 'furnished' && /مفروش/.test(seen.title) && seen.opts.includes('yes') ? 'yes' : null;
        if (!key) continue;
        await page.click(`[data-testid="af-option-${key}"]`);
        await page.waitForTimeout(1200);
        answered.push(t); clicked++;
      }
      const btn = clicked ? await page.$('[data-testid="af-confirm"]')
        : (await page.$('[data-testid="af-skip"]')) ?? (await page.$('[data-testid="af-confirm"]'));
      if (!btn) break;
      step(clicked ? `answered «${seen.title}» (${clicked})` : `skipped «${seen.title}»`);
      await btn.click();
      await page.waitForTimeout(3500);
    }
    if (!answered.length) { result.status = 'UNKNOWN'; result.failedStep = `interview never offered a question for: ${targets.map((t) => t.kind === 'amenity' ? t.token : 'furnished').join(', ')}`; return result; }

    step('await AF search');
    const afSearch = await awaitNewMainSearch(nAF);
    if (!afSearch) throw new Error('no search landed after the AF round');
    const { carried, missing } = carriedOnRequest(afSearch.body, answered);
    result.evidence.afRequest = {
      p_amenities: afSearch.body.p_amenities ?? null, p_furnished: afSearch.body.p_furnished ?? null,
      total: afSearch.total,
      answered: answered.map((t) => t.kind === 'amenity' ? t.token : 'furnished=yes'),
    };
    if (!carried) throw new Error(`answers did not reach the request: missing ${missing.map((t) => t.kind === 'amenity' ? t.token : 'p_furnished').join(', ')}`);

    // membership: replay the EXACT captured body via the anon RPC, narrowed to the listing's own
    // platform (a pure subset of the full result set) — never the on-screen count.
    step('replay request for membership');
    const want = idKey(row);
    let present = afSearch.rows.includes(want);
    const replayScan = async (body) => {
      let sawAny = false;
      for (let off = 0; off < 5000; off += 1000) {
        const rows = await rpc({ ...body, p_per_platform: null, p_limit: 1000, p_offset: off });
        if (!Array.isArray(rows)) throw new Error(`anon replay failed: ${JSON.stringify(rows).slice(0, 160)}`);
        if (rows.length) sawAny = true;
        if (rows.some((x) => `${x.source_table}:${x.listing_id}` === want)) return { found: true, sawAny };
        if (rows.length < 1000) break;
      }
      return { found: false, sawAny };
    };
    if (!present) {
      // Replay the EXACT captured body, narrowed only by keys that can remove rows and never add
      // (platform, then the listing's own area): a pure subset of the full result set, so presence
      // there is presence in it. The first replay that returns ANY row is decisive; one that returns
      // nothing may just mean a wire-spelling mismatch of the narrowing, so widen toward the
      // untouched body before judging.
      const area = Number(row.area_m2);
      const chain = [
        ...(Number.isFinite(area) && area > 0 ? [{ p_platforms: [row.platform], p_area_min: Math.floor(area), p_area_max: Math.ceil(area) }] : []),
        { p_platforms: [row.platform] }, {},
      ];
      for (const narrow of chain) {
        const r = await replayScan({ ...afSearch.body, ...narrow });
        if (r.found) { present = true; break; }
        if (r.sawAny) break;
      }
    }
    result.evidence.membership = present ? 'listing in result set (anon replay of the captured body)' : 'NOT in result set';
    if (!present) throw new Error('listing absent from the result set of the request its own answers produced');
    result.status = 'PASS';
    return result;
  } catch (e) {
    result.failedStep = `${steps.at(-1) ?? 'start'}: ${String(e.message || e).split('\n')[0]}`;
    if (page) {
      const shot = path.join(SHOT_DIR, `journey-${row.source_table}-${row.listing_id}-a${attempt}.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      if (fs.existsSync(shot)) result.screenshot = shot;
    }
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

const TRANSIENT = /transient loading|no result cards|never rendered|no main search|Timeout|timeout|net::|Target closed/;

// ── main ───────────────────────────────────────────────────────────────────────────────────
const picked = SAMPLE ? await sampleListings(SAMPLE) : LISTINGS.slice(0, MAX_PER_RUN);
if (!picked.length) { console.error('no eligible listings (last 24h, production-served, UI-mappable)'); process.exit(2); }
const out = [];
for (const l of picked.slice(0, MAX_PER_RUN)) {
  const row = l.city_ar ? l : await fetchRow(l);          // sampled rows are already full
  const label = row ? idKey(row) : `${l.source_table}:${l.listing_id}`;
  if (!row) { out.push({ listing: label, platform: l.platform, status: 'UNKNOWN', failedStep: 'not in search_listings_ar' }); continue; }
  const sourceUrl = await fetchSourceUrl(row).catch(() => null);
  if (MODE === 'normal' && !sourceUrl) { out.push({ listing: label, platform: row.platform, status: 'UNKNOWN', failedStep: 'no stored listing_url to compare against' }); continue; }
  log(`\n▶ ${MODE} journey — ${label} (${row.platform}) · ${row.deal_ar}${row.rent_period_ar ? '/' + row.rent_period_ar : ''} · ${row.type_ar} · ${row.city_ar}/${row.district_ar}`);
  let r = await runJourney(row, sourceUrl, 1);
  if (r.status === 'WIDER') { log(`  ↔ ${r.failedStep}; widening to the whole city`); r = await runJourney(row, sourceUrl, 1, { noDistrict: true }); }
  if (r.status !== 'PASS' && r.status !== 'UNKNOWN' && TRANSIENT.test(r.failedStep ?? '')) {
    log(`  ↻ retry (transient: ${r.failedStep})`);
    r = await runJourney(row, sourceUrl, 2, { noDistrict: r.noDistrictUsed });
  }
  const rec = { listing: label, platform: row.platform, mode: MODE, status: r.status, ...r };
  out.push(rec);
  console.log(JSON.stringify(rec));
}
const counts = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
for (const r of out) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log(`SUMMARY mode=${MODE} listings=${out.length} PASS=${counts.PASS} FAIL=${counts.FAIL} UNKNOWN=${counts.UNKNOWN}`);
process.exit(counts.FAIL ? 1 : 0);
