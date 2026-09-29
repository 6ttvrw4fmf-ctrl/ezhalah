// CUSTOMER CARDS — search production like a person, read every result card, optionally click some.
//
//   node e2e/engineers/customer-cards.mjs --city الرياض --deal rent --type شقة [--district النرجس]
//        [--more] [--open 3] [--mobile] [--out cards.json]
//
// Built for the nightly engineers (the SCRAPING, NEW_LISTINGS and LIFECYCLE rulebooks in docs/ops):
// their live-site step is "search, see the cards, click one, check it opens the real ad", and each has
// a one-hour budget. The search itself is the proven live-sweep path (e2e/live-sweep/sweep.mjs:
// setDeal, pickCity, tapByText, runSearch), not a second harness. This file only adds: walk the reveal
// cascade, read the cards, press «عرض المزيد», click N cards.
//
// READ-ONLY. It never writes to any database. Clicking a card makes the APP insert a CPC billing row
// (src/data/clicks.ts → `clicks`); a nightly robot must not bill partners, so every non-GET request to
// a Supabase table (anything under /rest/v1/ that is not an /rpc/ read) is aborted and counted in
// `blocked_writes`. The click-through itself is unaffected: trackClick is fire-and-forget.
//
// `href` is the URL the card opens: the fetched row's listing_url for the card's listing id (openListing
// opens source_url unchanged in the Arabic UI). --open proves it: `opened_url` is what the app actually
// passed to window.open, `landed_url` + `status` are where the new tab ended up. `ref` (table:id) is the
// form scrapers/common/source_reread.py and lifecycle_spot_check.py take as --ids (see README.md).
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { withPage, setDeal, pickCity, tapByText, runSearch, lastCount, sleep, BASE } from '../live-sweep/sweep.mjs';

const { values: a } = parseArgs({ options: {
  city: { type: 'string' }, deal: { type: 'string' }, type: { type: 'string' }, district: { type: 'string' },
  more: { type: 'boolean', default: false }, mobile: { type: 'boolean', default: false }, open: { type: 'string', default: '0' },
  out: { type: 'string', default: `${tmpdir()}/customer-cards.json` },
} });
const fail = (why, code = 2) => { console.log(`customer-cards: FAILED — ${why}`); process.exit(code); };
if (!a.city || !['buy', 'rent'].includes(a.deal) || !a.type) {
  fail('usage: --city <Arabic city> --deal <buy|rent> --type <Arabic type> [--district <Arabic>] [--more] [--open N] [--mobile] [--out file]');
}
const openN = Number(a.open) || 0;
setTimeout(() => fail('20-minute cap reached', 3), 20 * 60_000).unref();

// The form's chips are t(group) and t(type) (src/app/index.tsx), so the Arabic type resolves to its
// category and group through the canonical taxonomy + i18n, never a copied table that can drift.
const tax = JSON.parse(readFileSync(new URL('../../src/data/taxonomy.source.json', import.meta.url), 'utf8'));
const AR = {};
for (const m of readFileSync(new URL('../../src/i18n.tsx', import.meta.url), 'utf8').matchAll(/^\s*'([^']+)':\s*'([^']+)'/gm)) AR[m[1]] ??= m[2];
const ct = tax.cleanTypes.find((c) => c.hierarchy?.group && AR[c.clean] === a.type);
if (!ct) fail(`«${a.type}» is not a type chip label (see src/data/taxonomy.source.json)`);

const place = (u) => { try { const x = new URL(u); return decodeURI(x.host.replace(/^www\./, '') + x.pathname).replace(/\/$/, ''); } catch { return u; } };
const tail = (p) => (p.length > 60 ? `…${p.slice(-57)}` : p);
const CARD = '[data-testid^="card-listing-"]';
// THE CASCADE WALK. A results turn arrives with one screenful of cards and reveals the rest as the
// user scrolls (src/lib/initialReveal.ts, maybeRevealOnScroll). So scroll to the last card and re-read,
// until the count held still for 4 reads AND reached `min` (or ~12 s passed: an honest zero).
async function walkCards(page, min, maxMs) {
  const t0 = Date.now(); let last = -1, stable = 0;
  while (Date.now() - t0 < maxMs) {
    const n = await page.locator(CARD).count();
    stable = n === last ? stable + 1 : 0; last = n;
    if (stable >= 4 && (n >= min || Date.now() - t0 > 12_000)) return n;
    if (n) await page.locator(CARD).last().evaluate((el) => el.scrollIntoView({ block: 'end' })).catch(() => {});
    await sleep(700);
  }
  return last;
}

const result = await withPage(a.mobile, async (page, requests) => {
  const ctx = page.context();
  let blocked = 0;
  await ctx.route((u) => u.pathname.includes('/rest/v1/') && !u.pathname.includes('/rest/v1/rpc/'), (route) => {
    if (route.request().method() === 'GET') return route.continue();
    blocked++; return route.abort();
  });
  // listing id → [{ url, table }] off the app's own card fetches (remote.ts fetchRawByIds: one GET
  // /rest/v1/<table> per source table, LIST_SELECT carries listing_url). Ids are unique per table only.
  const rowsById = new Map();
  page.on('response', async (r) => {
    const table = new URL(r.url()).pathname.match(/\/rest\/v1\/(\w+)$/)?.[1];
    if (!table) return;
    const body = await r.json().catch(() => null);
    if (!Array.isArray(body)) return;
    for (const row of body) {
      if (row?.id == null || !row.listing_url) continue;
      const k = String(row.id), list = rowsById.get(k) ?? [];
      if (!list.some((x) => x.table === table)) list.push({ url: row.listing_url, table });
      rowsById.set(k, list);
    }
  });
  // Main-frame navigation responses, for the landing status of a clicked card. A popup's FIRST
  // navigation has no frame yet (Playwright throws), so it is kept with page:null.
  const navs = [];
  ctx.on('response', (r) => {
    if (!r.request().isNavigationRequest()) return;
    let f = null; try { f = r.frame(); } catch { /* issued before the popup's frame existed */ }
    if (!f || f === f.page().mainFrame()) navs.push({ page: f ? f.page() : null, url: r.url(), status: r.status() });
  });

  if (a.deal === 'rent') await setDeal(page, 'إيجار');
  if (!await pickCity(page, a.city)) fail(`city «${a.city}» was not offered / did not commit`);
  if (a.district) {
    const d = page.locator('[data-testid="district-input"]');
    await d.click(); await d.fill(a.district);
    // An option is exactly two lines, «حي النرجس» / «2,420 إعلان»; match the name with or without «حي ».
    const pickDistrict = () => page.evaluateHandle((want) => [...document.querySelectorAll('div')].filter((e) => {
      const L = (e.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      return L.length === 2 && /^[\d,٬٠-٩]+ إعلان$/.test(L[1]) && L[0].replace(/^حي\s+/, '') === want;
    }).pop(), a.district.trim().replace(/^حي\s+/, ''));
    let row = null;
    for (let i = 0; i < 20 && !row; i++) { await sleep(750); row = (await pickDistrict()).asElement(); }
    if (row) { await row.evaluate((el) => el.scrollIntoView({ block: 'center' })); await sleep(300); await row.click().catch(() => {}); }
    const ok = await page.waitForSelector('[data-testid="district-chip"]', { timeout: 6000 }).then(() => true).catch(() => false);
    if (!ok) fail(`district «${a.district}» was not offered / did not commit`);
  }
  if (ct.macro === 'Commercial' && !await tapByText(page, AR.Commercial)) fail('could not select «تجاري»');
  await sleep(600);
  if (!await tapByText(page, AR[ct.hierarchy.group])) fail(`group chip «${AR[ct.hierarchy.group]}» not offered`);
  await sleep(1200);
  if (!await tapByText(page, a.type)) fail(`type chip «${a.type}» not offered`);
  await sleep(1000);
  await runSearch(page).catch((e) => fail(`search did not settle: ${e.message.split('\n')[0]}`));
  let shown = await walkCards(page, 1, 60_000);

  let presses = 0;
  while (a.more && presses < 4) {
    const btn = page.locator('[data-testid="results-load-more"]').last();
    if (!await btn.count()) break;
    await btn.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await sleep(600);
    if (!await btn.click({ timeout: 30_000 }).then(() => true).catch(() => false)) break;
    presses++;
    const n = await walkCards(page, shown + 1, 120_000);
    if (n <= shown) break;
    shown = n;
  }

  const cards = (await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => {
    const L = e.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
    const pick = (re) => { for (const s of L) { const m = s.match(re); if (m) return m[1]; } return null; };
    const ti = L.findIndex((s) => /(للإيجار|للبيع)$/.test(s));      // «شقة للإيجار», then the bold heading
    const title = ti >= 0 ? (L[ti + 1] ?? null) : null;                // «الحي, المدينة» or just «المدينة»
    return {
      listing_id: e.dataset.testid.slice('card-listing-'.length),
      platform: pick(/^مستضاف على (.+)$/), host: pick(/سيأخذك إلى\s*(\S+)/),
      type: ti >= 0 ? L[ti] : null, title,
      district: title && title.includes(', ') ? title.slice(0, title.lastIndexOf(', ')) : null,
      price: L.slice(ti + 1).find((s) => /ر\.س|السعر عند الطلب/.test(s)) ?? null,
    };
  }), CARD)).map((c, i) => {
    const rows = rowsById.get(c.listing_id) ?? [];
    const hit = rows.length === 1 ? rows[0] : rows.find((r) => c.host && r.url.includes(c.host));
    return { rank: i + 1, ...c, href: hit?.url ?? null, ref: hit ? `${hit.table}:${c.listing_id}` : null };
  });

  // --open N: click like a user (the card's own Pressable), follow the new tab, record where it landed.
  await page.evaluate(() => {
    const o = window.open; window.__opened = [];
    window.open = function (u, ...rest) { window.__opened.push(String(u)); return o.call(window, u, ...rest); };
  });
  const opened = [];
  for (let i = 0; i < Math.min(openN, cards.length); i++) {
    const card = page.locator(CARD).nth(i);
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await sleep(500);
    const before = await page.evaluate(() => window.__opened.length), n0 = navs.length;
    const popup = ctx.waitForEvent('page', { timeout: 25_000 }).catch(() => null);
    const clicked = await card.getByText(/(للإيجار|للبيع)$/).first().click({ timeout: 15_000 }).then(() => true).catch(() => false);
    const tab = clicked ? await popup : null;
    const rec = { rank: i + 1, ref: cards[i].ref, href: cards[i].href,
      opened_url: await page.evaluate((b) => window.__opened[b] ?? null, before), via: tab ? 'new-tab' : 'none',
      landed_url: null, status: null, error: clicked ? null : 'card click failed' };
    if (tab) {
      await tab.waitForLoadState('domcontentloaded', { timeout: 45_000 }).catch((e) => { rec.error = e.message.split('\n')[0]; });
      await sleep(3000);                                              // let a client-side redirect finish
      rec.landed_url = tab.url();
      rec.status = navs.slice(n0).filter((n) => n.page === tab || n.page === null).at(-1)?.status ?? null;
      await tab.close().catch(() => {});
      await page.bringToFront();
    } else if (clicked && !page.url().startsWith(BASE)) {
      rec.via = 'same-tab'; rec.landed_url = page.url();
      rec.status = navs.slice(n0).filter((n) => n.page === page).at(-1)?.status ?? null;
      await page.goBack().catch(() => {}); await sleep(2500);
    } else if (clicked && !rec.error) rec.error = 'click opened nothing';
    // Landed somewhere other than the href: a homepage or search page is the first sign of a dead ad;
    // a site moving the same ad to its canonical URL also counts, so read landed_url before judging.
    rec.moved = rec.landed_url && rec.href ? place(rec.landed_url) !== place(rec.href) : null;
    opened.push(rec);
  }

  const req = requests.filter((r) => (r.p_limit ?? 0) > 1).at(-1) ?? {};
  return {
    run_at: new Date().toISOString(), base: BASE,
    query: { city: a.city, deal: a.deal, type: a.type, district: a.district ?? null, more: a.more, open: openN, mobile: a.mobile },
    sent: { p_deal: req.p_deal, p_category: req.p_category, p_cities: req.p_cities, p_districts: req.p_districts, p_types: req.p_types, p_rent_period: req.p_rent_period },
    headline_total: lastCount(await page.evaluate(() => document.body.innerText)),
    presses, blocked_writes: blocked, cards, opened,
  };
});

writeFileSync(a.out, JSON.stringify(result, null, 2));
const noHref = result.cards.filter((c) => !c.href).length;
console.log(`customer-cards: ${a.city}/${a.deal}/${a.type}${a.district ? '/' + a.district : ''} — ${result.cards.length} cards`
  + ` (headline ${result.headline_total ?? '?'}, ${result.presses} «عرض المزيد» presses, ${noHref} without href)`
  + (openN ? `; opened ${result.opened.map((o) => `#${o.rank} ${o.status ?? o.error ?? '?'} ${o.landed_url ? new URL(o.landed_url).host : '-'}${o.opened_url === o.href ? '' : ' (opened≠href)'}${o.moved ? ` (moved to ${tail(place(o.landed_url))})` : ''}`).join(', ')}` : '')
  + ` → ${a.out}`);
process.exit(0);
