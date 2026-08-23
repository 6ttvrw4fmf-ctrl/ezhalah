// The journeys the live sweep drives. Each one is a REAL user path on production and ends in the
// six-layer comparison (see sweep.mjs) — clicking the control is never the assertion.
import {
  BASE, dbCount, assertChain, withPage, setDeal, setPeriod, pickCity, runSearch,
  visibleState, defect, note, num, lastCount, sleep,
} from './sweep.mjs';

const enc = encodeURIComponent;
/** The DB-truth filter for a plain city+deal(+period) search, in PostgREST's own operators. */
export function truthFilter({ city, deal, period, types }) {
  let f = `city_ar=eq.${enc(city)}`;
  if (deal === 'بيع' || deal === 'إيجار') f += `&deal_ar=eq.${enc(deal)}`;
  if (deal === 'إيجار' && period === 'سنوي') f += `&or=(rent_period_ar.eq.${enc('سنوي')},and(rent_period_ar.eq.${enc('شهري')},rent_now_pay_later.is.true))`;
  if (deal === 'إيجار' && period === 'شهري') f += '&payment_monthly=is.true&rent_now_pay_later=not.is.true';
  if (types?.length) f += `&type_ar=in.(${enc(types.map((t) => `"${t}"`).join(','))})`;
  return f;
}

/** 1 — NORMAL FILTER: city + deal (+period) (+type) → results. The backbone journey. */
export async function normalFilter(plan) {
  const name = `normal:${plan.city}/${plan.deal}${plan.period ? '/' + plan.period : ''}${plan.typeLabel ? '/' + plan.typeLabel : ''}`;
  return withPage(!!plan.mobile, async (page, requests) => {
    await setDeal(page, plan.deal);
    await setPeriod(page, plan.period);
    if (!await pickCity(page, plan.city)) { note(`${name}: city «${plan.city}» not offered — skipped`); return null; }
    if (plan.group) { await page.getByText(plan.group, { exact: true }).first().click().catch(() => {}); await sleep(1200); }
    if (plan.typeLabel) { await page.getByText(plan.typeLabel, { exact: true }).first().click().catch(() => {}); await sleep(1000); }
    await runSearch(page);
    return assertChain(name, {
      intent: { city: plan.city, deal: plan.deal, period: plan.period, type: plan.typeLabel },
      page, requests,
    });
  });
}

/** 2 — TRENDING CITY: the number beside a city must be what selecting it returns. */
export async function trendingCity(plan) {
  const name = `trending-city:${plan.deal}${plan.period ? '/' + plan.period : ''}`;
  return withPage(false, async (page, requests) => {
    await setDeal(page, plan.deal);
    await setPeriod(page, plan.period);
    if (plan.beds) { await page.getByText(plan.beds, { exact: true }).first().click().catch(() => {}); await sleep(900); }
    await page.locator('[data-testid="city-input"]').click(); await sleep(3800);
    const rows = await page.evaluate(() => {
      const t = document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
      const out = [];
      for (let i = 0; i < t.length - 1; i++) if (/إعلان/.test(t[i + 1]) && t[i].length > 1 && t[i].length < 26 && !/إعلان|بحث|مدينة|حي/.test(t[i])) out.push([t[i], t[i + 1]]);
      return out.slice(0, 6);
    });
    if (!rows.length) { note(`${name}: no trending city rows rendered — skipped`); return null; }
    const [cityName, countText] = rows[0];
    const advertised = num(countText);
    if (!await pickCity(page, cityName)) { note(`${name}: could not select «${cityName}» — skipped`); return null; }
    await runSearch(page);
    const landed = lastCount(await page.evaluate(() => document.body.innerText));
    if (advertised != null && landed != null && advertised !== landed) {
      defect(name, 'UI→RENDERED', `trending city «${cityName}» advertised ${advertised}, landed ${landed}`);
    }
    return assertChain(`${name}:${cityName}`, {
      intent: { city: cityName, deal: plan.deal, period: plan.period }, page, requests,
    });
  });
}

/** 3 — TRENDING DISTRICT: same contract one level down, under an active narrowing filter. */
export async function trendingDistrict(plan) {
  const name = `trending-district:${plan.city}/${plan.deal}`;
  return withPage(false, async (page, requests) => {
    await setDeal(page, plan.deal);
    await setPeriod(page, plan.period);
    if (!await pickCity(page, plan.city)) { note(`${name}: city «${plan.city}» not offered — skipped`); return null; }
    // A narrowing filter is the point: an unnarrowed district count cannot expose the class of bug
    // this journey exists for (the count that ignores the active filter).
    if (plan.priceMax) { await page.locator('[data-testid="price-max-input"]').fill(String(plan.priceMax)).catch(() => {}); await sleep(1600); }
    await page.locator('[data-testid="district-input"]').click(); await sleep(4200);
    const rows = await page.evaluate(() => {
      const t = document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
      const out = [];
      for (let i = 0; i < t.length - 1; i++) if (/^حي /.test(t[i]) && /إعلان/.test(t[i + 1])) out.push([t[i], t[i + 1]]);
      return out.slice(0, 6);
    });
    if (!rows.length) { note(`${name}: no numbered district rows — skipped`); return null; }
    const [districtName, countText] = rows[0];
    const advertised = num(countText);
    const hit = await page.evaluate((d) => {
      const el = [...document.querySelectorAll('div')].filter((e) => (e.innerText || '').trim().startsWith(d) && (e.innerText || '').length < 60).pop();
      if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, districtName);
    if (hit) await page.mouse.click(hit.x, hit.y);
    await sleep(1400);
    await runSearch(page);
    const landed = lastCount(await page.evaluate(() => document.body.innerText));
    if (advertised != null && landed != null && advertised !== landed) {
      defect(name, 'UI→RENDERED', `district «${districtName}» advertised ${advertised}, landed ${landed}`);
    }
    return assertChain(`${name}:${districtName}`, { intent: { city: plan.city, deal: plan.deal, district: districtName }, page, requests});
  });
}

/** 4 — ADVANCED FILTER: the chip's promised count must be the count the user lands on. */
export async function advancedFilter(plan) {
  const name = `af:${plan.city}/${plan.deal}${plan.period ? '/' + plan.period : ''}/${plan.typeLabel ?? 'any'}`;
  const TITLES = ['تفضل تدفع الإيجار على دفعات؟', 'كم عمر العقار تقريباً؟', 'وش المميزات المهمة لك؟', 'كم دورة مياه تفضل؟',
    'تفضلها مفروشة؟', 'كم عرض الشارع تفضل؟', 'وش الاتجاه اللي تفضله؟', 'كم التقييم اللي تفضله؟', 'وش نوع الوحدة اللي تبغاها؟'];
  return withPage(false, async (page, requests) => {
    await setDeal(page, plan.deal);
    await setPeriod(page, plan.period);
    if (!await pickCity(page, plan.city)) { note(`${name}: city not offered — skipped`); return null; }
    if (plan.group) { await page.getByText(plan.group, { exact: true }).first().click().catch(() => {}); await sleep(1200); }
    if (plan.typeLabel) { await page.getByText(plan.typeLabel, { exact: true }).first().click().catch(() => {}); await sleep(1000); }
    await runSearch(page);
    const before = lastCount(await page.evaluate(() => document.body.innerText));
    const narrow = page.getByText('خلّنا نحدد الطلب أكثر', { exact: false });
    if (!await narrow.count()) {
      if (before != null && before > 25) note(`${name}: AF not offered at ${before} results (allowed: needs 2+ useful questions)`);
      return null;
    }
    await narrow.first().scrollIntoViewIfNeeded(); await narrow.first().click();
    await sleep(9500);
    const card = await page.evaluate((TT) => {
      const t = TT.find((x) => document.body.innerText.includes(x)); if (!t) return null;
      const el = [...document.querySelectorAll('div,span')].reverse().find((e) => (e.innerText || '').trim() === t);
      if (!el) return null;
      let c = el; for (let i = 0; i < 10 && c.parentElement; i++) { c = c.parentElement; if ((c.innerText || '').includes('تخطي')) break; }
      return { title: t, text: c.innerText || '' };
    }, TITLES);
    if (!card) { note(`${name}: AF opened but no question rendered — skipped`); return null; }
    const lines = card.text.split('\n').map((x) => x.trim()).filter(Boolean);
    const chips = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const a = lines[i], b = lines[i + 1];
      if (/^[\d,٬٠-٩]+$/.test(b) && !/^[\d,٬٠-٩]+$/.test(a)
          && !/تخطي|عرض النتائج|متابعة|نتيجة|الخيارات|؟/.test(a)) chips.push({ label: a, count: num(b) });
    }
    if (!chips.length) { note(`${name}: question «${card.title}» rendered no chips — skipped`); return null; }
    const pick = chips[0];
    // MONTHLY WATCH: the card's own live footer must MOVE when an answer is selected.
    const footBefore = num((card.text.match(/(?:عرض|متابعة)[^\n]*?([\d,٬]+)\s*نتيجة/) || [])[1]);
    await page.getByText(pick.label, { exact: true }).first().click({ timeout: 12000 });
    await sleep(2600);
    const footAfter = await page.evaluate(() => (document.body.innerText.match(/(?:عرض|متابعة)[^\n]*?([\d,٬]+)\s*نتيجة/) || [])[1] ?? null);
    const footAfterN = num(footAfter);
    if (footBefore != null && footAfterN != null && pick.count != null
        && footBefore !== pick.count && footAfterN === footBefore) {
      defect(name, 'UI→UI', `AF live count did not update after selecting «${pick.label}» (${footBefore} → ${footAfterN}, chip promised ${pick.count}) (monthly-af-counts-update)`);
    }
    const beforeN = await page.evaluate(() => [...document.body.innerText.matchAll(/لقينا\s+([\d,٬]+)\s+إعلان/g)].length);
    requests.length = 0;
    const fire = async (label) => { const b = page.getByText(label, { exact: false }); if (await b.count()) { await b.first().click({ timeout: 9000 }).catch(() => {}); return true; } return false; };
    await fire('عرض النتائج'); await sleep(6500);
    if (!requests.some((r) => (r.p_limit ?? 0) > 1)) { await fire('متابعة'); await sleep(4200); await fire('عرض النتائج'); }
    await page.waitForFunction((n) => [...document.body.innerText.matchAll(/لقينا\s+([\d,٬]+)\s+إعلان/g)].length > n, beforeN, { timeout: 50000 }).catch(() => {});
    await sleep(3200);
    const landed = lastCount(await page.evaluate(() => document.body.innerText));
    if (pick.count != null && landed != null && pick.count !== landed) {
      defect(name, 'UI→RENDERED', `AF chip «${pick.label}» promised ${pick.count}, landed ${landed}`);
    }
    return assertChain(`${name}:${card.title}`, { intent: { city: plan.city, deal: plan.deal, period: plan.period }, page, requests});
  });
}

/** 5 — HONEST ZERO: an impossible search must say so, not invent results. */
export async function zeroResult(plan) {
  const name = `zero:${plan.city}`;
  return withPage(false, async (page, requests) => {
    if (!await pickCity(page, plan.city)) { note(`${name}: city not offered — skipped`); return null; }
    await page.locator('[data-testid="price-min-input"]').fill('999000000').catch(() => {});
    await page.locator('[data-testid="price-max-input"]').fill('999999999').catch(() => {});
    await sleep(1400);
    await runSearch(page);
    const ui = await visibleState(page);
    const landed = ui.headline != null ? num(ui.headline) : 0;
    if (!ui.zero && landed > 0) defect(name, 'RENDERED', `an impossible budget returned ${landed} listings instead of an honest zero`);
    const req = requests.filter((r) => (r.p_limit ?? 0) > 1).pop();
    if (req) { const rpc = await rpcTotalSafe(req); if (rpc != null && rpc > 0) defect(name, 'RPC', `impossible budget still matched ${rpc} rows in the RPC`); }
    return { name, zero: ui.zero, ok: ui.zero || landed === 0 };
  });
}
const rpcTotalSafe = async (req) => { const { rpcTotal } = await import('./sweep.mjs'); return rpcTotal(req); };

/** 6 — CARD → EXTERNAL SITE → BACK: the listing must open its real source, and Back must restore. */
export async function cardClickBack(plan) {
  const name = `card-back:${plan.city}`;
  return withPage(false, async (page, requests) => {
    if (!await pickCity(page, plan.city)) { note(`${name}: city not offered — skipped`); return null; }
    await runSearch(page);
    const before = lastCount(await page.evaluate(() => document.body.innerText));
    const card = page.locator('text=/الضغط على هذا الإعلان/').first();
    if (!await card.count()) { note(`${name}: no cards rendered — skipped`); return null; }
    const target = await page.evaluate(() => (document.body.innerText.match(/الضغط على هذا الإعلان سيأخذك إلى\s*([^\s\n]+)/) || [])[1] ?? null);
    const ctx = page.context();
    const opened = ctx.waitForEvent('page', { timeout: 25000 }).catch(() => null);
    await card.click({ timeout: 15000 }).catch(() => {});
    const tab = await opened;
    if (tab) {
      await tab.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      const host = new URL(tab.url()).hostname.replace(/^www\./, '');
      if (target && !host.includes(target.replace(/^www\./, '').split('/')[0])) {
        defect(name, 'RENDERED→EXTERNAL', `card promised ${target} but opened ${host}`);
      }
      await tab.close();
    }
    await page.bringToFront(); await sleep(2200);
    const after = lastCount(await page.evaluate(() => document.body.innerText));
    if (before != null && after != null && before !== after) {
      defect(name, 'BACK-STATE', `results changed after returning from the listing (${before} → ${after})`);
    }
    return { name, ok: true, opened: !!tab };
  });
}

/** 7 — TAB SWITCHING must not push junk history (تصفية ↔ الوكيل الذكي). */
export async function tabHistory() {
  const name = 'watch:tab-switch-no-junk-history';
  return withPage(false, async (page) => {
    const h0 = await page.evaluate(() => history.length);
    for (let i = 0; i < 3; i++) {
      await page.getByText('الوكيل الذكي', { exact: true }).first().click().catch(() => {}); await sleep(2200);
      await page.getByText('تصفية', { exact: true }).first().click().catch(() => {}); await sleep(2200);
    }
    const h1 = await page.evaluate(() => history.length);
    const forms = await page.locator('[data-testid="city-input"]').count();
    if (h1 - h0 > 1) defect(name, 'NAVIGATION', `3 round trips added ${h1 - h0} history entries (tab-switch-no-junk-history)`);
    if (forms > 1) defect(name, 'NAVIGATION', `${forms} Filter forms mounted at once — screens are leaking`);
    return { name, ok: h1 - h0 <= 1 && forms <= 1, historyGrowth: h1 - h0, forms };
  });
}

/** 8 — TYPED-BUT-UNCOMMITTED DISTRICT must not vanish silently. */
export async function typedDistrict(plan) {
  const name = 'watch:typed-district-not-dropped';
  return withPage(false, async (page, requests) => {
    if (!await pickCity(page, plan.city)) { note(`${name}: city not offered — skipped`); return null; }
    const d = page.locator('[data-testid="district-input"]');
    await d.click(); await d.fill(plan.districtText); await sleep(2600);
    // The search may legitimately NOT run: since 2026-08-23 an uncommitted district is no longer
    // silently discarded, so the app can hold the search and prompt instead. That is the PASS state
    // for this watch, not a timeout — wait softly and judge on what the user is left looking at.
    await page.getByText('بحث', { exact: true }).first().click().catch(() => {});
    await page.waitForFunction(() => /لقينا|ما لقينا|ما فيه/.test(document.body.innerText), null, { timeout: 25000 })
      .catch(() => {});
    await sleep(2500);
    const ui = await visibleState(page);
    const stillShown = await d.inputValue().catch(() => '');
    const req = requests.filter((r) => (r.p_limit ?? 0) > 1).pop();
    const searchedDistrict = !!(req?.p_districts?.length) || !!ui.district;
    const body = await page.evaluate(() => document.body.innerText);
    const warned = /اختر|حدّد|حدد الحي|لم يتم|اختر الحي/.test(body);
    const searchRan = /لقينا|ما لقينا|ما فيه/.test(body);
    // Holding the search while the district is uncommitted is a correct outcome too.
    if (stillShown && !searchedDistrict && !warned && searchRan) {
      defect(name, 'UI→REQUEST', `field still shows «${stillShown}» but the search ran city-wide with no warning (typed-district-not-dropped)`);
    }
    return { name, ok: !(stillShown && !searchedDistrict && !warned && searchRan) };
  });
}

/** 9 — CLEAR ALL must reset the form. */
export async function clearAll(plan) {
  const name = `clear-all:${plan.city}`;
  return withPage(false, async (page) => {
    if (!await pickCity(page, plan.city)) return null;
    await page.locator('[data-testid="price-max-input"]').fill('500000').catch(() => {});
    await sleep(1200);
    const clear = page.getByText('مسح الكل', { exact: false });
    if (!await clear.count()) { note(`${name}: no «مسح الكل» control — skipped`); return null; }
    await clear.first().click(); await sleep(2200);
    const city = await page.locator('[data-testid="city-input"]').inputValue().catch(() => '');
    const price = await page.locator('[data-testid="price-max-input"]').inputValue().catch(() => '');
    if (city || price) defect(name, 'UI', `Clear All left city="${city}" priceMax="${price}"`);
    return { name, ok: !city && !price };
  });
}
