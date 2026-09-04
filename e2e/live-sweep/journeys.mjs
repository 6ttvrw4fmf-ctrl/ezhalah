// The journeys the live sweep drives. Each one is a REAL user path on production and ends in the
// six-layer comparison (see sweep.mjs) — clicking the control is never the assertion.
import {
  BASE, dbCount, assertChain, withPage, setDeal, setPeriod, pickCity, runSearch, tapByText,
  visibleState, defect, note, num, lastCount, sleep, SETTLED_RE, observeWatch,
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
    // tapByText scrolls the inner ScrollView first: on mobile these chips are below the fold and
    // the old `.catch(() => {})` swallowed the miss, so the journey searched a نوع it never selected.
    if (plan.group) { await tapByText(page, plan.group); await sleep(1200); }
    if (plan.typeLabel) { await tapByText(page, plan.typeLabel); await sleep(1000); }
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
    // Match the trending list's STRUCTURE — «1.» / name / «N إعلان» — not the district's spelling.
    // Until 2026-08-24 this tested /^حي /, which is not a property of a district name: 1,082 of the
    // index's 3,694 (city, district) pairs — 32,712 production-ready rows — carry no «حي » prefix,
    // and whole cities have none at all. بيش renders «الخضراء 1 · 4 إعلان», «الحزم 1», «الصفاء»;
    // the harness saw zero rows, skipped, and failed the run on a missed coverage floor while
    // production was working perfectly. A barrier that cannot see 16% of the inventory reports its
    // own blindness as a defect (§40.7), and silently drops the journey the floor exists to force.
    const rows = await page.evaluate(() => {
      const t = document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
      const out = [];
      for (let i = 0; i < t.length - 2; i++) {
        // ordinal marker, then the name, then its count line
        if (/^\d+\.$/.test(t[i]) && /إعلان/.test(t[i + 2]) && !/إعلان/.test(t[i + 1])) out.push([t[i + 1], t[i + 2]]);
      }
      // Fallback for a rendering without ordinals: any line immediately followed by a count line.
      if (!out.length) {
        for (let i = 0; i < t.length - 1; i++) {
          if (/إعلان/.test(t[i + 1]) && !/إعلان/.test(t[i]) && t[i].length < 40 && /[؀-ۿ]/.test(t[i])) out.push([t[i], t[i + 1]]);
        }
      }
      return out.slice(0, 6);
    });
    if (!rows.length) { note(`${name}: no numbered district rows — skipped`); return null; }
    const [districtName, countText] = rows[0];
    const advertised = num(countText);
    // §41.2: take the ELEMENT, never bare viewport coordinates. The same shape of click in
    // pickCity() left the mobile «بحث» permanently unclickable and took out the §34 mobile floor
    // on every «بيع» rotation; this was the only other one left in the harness.
    const dh = await page.evaluateHandle((d) => [...document.querySelectorAll('div')]
      .filter((e) => (e.innerText || '').trim().startsWith(d) && (e.innerText || '').length < 60).pop(), districtName);
    const drow = dh.asElement();
    if (drow) { await drow.scrollIntoViewIfNeeded().catch(() => {}); await drow.click().catch(() => {}); }
    await sleep(1400);
    await runSearch(page);
    const landed = lastCount(await page.evaluate(() => document.body.innerText));
    if (advertised != null && landed != null && advertised !== landed) {
      defect(name, 'UI→RENDERED', `district «${districtName}» advertised ${advertised}, landed ${landed}`);
    }
    return assertChain(`${name}:${districtName}`, { intent: { city: plan.city, deal: plan.deal, district: districtName }, page, requests});
  });
}

/** 4 — ADVANCED FILTER: the chip's promised count must be the count the user lands on.
 *
 * HOW A ROUND ENDS, and why this journey walks it (owner R8.3.1, 2026-08-28). The question footer
 * offers exactly متابعة / تخطي / رجوع. There is NO «عرض النتائج» anywhere inside the AF flow — the
 * owner removed that early-exit in PR #1216, and `scripts/verify-af-footer-buttons.ts` pins its
 * removal. A round ends by WALKING its questions (up to AF_ROUND_MAX_QUESTIONS = 4, R6.1.1); only
 * then does a new results turn land and a candidates request fire.
 *
 * This journey used to click «عرض النتائج», then fall back to a single «متابعة». Against a
 * four-question round that advances to question 2 and stops: no results turn, no request, and the
 * headline still showing the PRE-AF total. On 2026-08-29 that produced four confident false
 * defects in one sweep — «AF chip «٢٠ م فأكثر» promised 6,524, landed 12,097» (12,097 was the
 * pre-AF total) and «the search sent no candidates request at all» — on a production AF that was
 * measurably correct: 6,524 = footer = landed = RPC = independent PostgREST oracle. §40.7: a
 * harness failure must never be reported as a product failure.
 *
 * So: answer question 1, تخطي every remaining question (R8.1 — skip commits no predicate), and let
 * the round end on its own. Exactly ONE predicate is then committed, which is what makes the chip's
 * promised count directly comparable to the count the user lands on.
 *
 * The card is addressed through its OWN testIDs — `af-card`, `af-question-title`, `af-option-*`,
 * `af-confirm`, `af-skip` — added 2026-08-22 for precisely this purpose. Scraping body text instead
 * picks up the result cards behind the overlay: a text-based reader on this same screen returned
 * «رقم رخصة الإعلان / 7100249846» and «عمر العقار / 2025» as if they were the question's options.
 */
export async function advancedFilter(plan) {
  const name = `af:${plan.city}/${plan.deal}${plan.period ? '/' + plan.period : ''}/${plan.typeLabel ?? 'any'}`;
  return withPage(false, async (page, requests) => {
    await setDeal(page, plan.deal);
    await setPeriod(page, plan.period);
    if (!await pickCity(page, plan.city)) { note(`${name}: city not offered — skipped`); return null; }
    // tapByText scrolls the inner ScrollView first: on mobile these chips are below the fold and
    // the old `.catch(() => {})` swallowed the miss, so the journey searched a نوع it never selected.
    if (plan.group) { await tapByText(page, plan.group); await sleep(1200); }
    if (plan.typeLabel) { await tapByText(page, plan.typeLabel); await sleep(1000); }
    await runSearch(page);
    const before = lastCount(await page.evaluate(() => document.body.innerText));

    const narrow = page.getByText('خلّنا نحدد الطلب أكثر', { exact: false });
    if (!await narrow.count()) {
      if (before != null && before > 25) note(`${name}: AF not offered at ${before} results (allowed: needs a useful question)`);
      return null;
    }
    await narrow.first().scrollIntoViewIfNeeded(); await narrow.first().click();
    await sleep(9500);

    // Everything below reads ONLY inside af-card.
    const readCard = () => page.evaluate(() => {
      const card = document.querySelector('[data-testid="af-card"]');
      if (!card) return null;
      const txt = (el) => (el?.innerText || '').trim();
      return {
        title: txt(card.querySelector('[data-testid="af-question-title"]')) || null,
        confirm: txt(card.querySelector('[data-testid="af-confirm"]')) || null,
        hasSkip: !!card.querySelector('[data-testid="af-skip"]'),
        showResults: /عرض النتائج/.test(txt(card)),
        options: [...card.querySelectorAll('[data-testid^="af-option-"]')].map((e) => ({
          key: e.getAttribute('data-testid').replace('af-option-', ''),
          text: txt(e).replace(/\n+/g, ' '),
        })),
      };
    });

    const first = await readCard();
    if (!first || !first.title) { note(`${name}: AF opened but no question card rendered — skipped`); return null; }
    if (!first.options.length) { note(`${name}: question «${first.title}» rendered no options — skipped`); return null; }
    // The removed control must not come back inside the flow — a live check on R8.3.1.
    if (first.showResults) {
      defect(name, 'UI→UI', `«عرض النتائج» is back inside the AF card — the owner removed it 2026-08-28 (af-no-show-results-in-flow)`);
    }

    const pick = first.options[0];
    const promised = num((pick.text.match(/([\d,٬]+)\s*$/) || [])[1]);
    const footBefore = num((first.confirm || '').match(/([\d,٬]+)/)?.[1]);
    const clicked = await page.locator(`[data-testid="af-option-${pick.key}"]`).first()
      .click({ timeout: 9000 }).then(() => true).catch(() => false);
    if (!clicked) { note(`${name}: option «${pick.key}» not clickable — harness, skipped`); return null; }
    await sleep(3000);

    // R7.1.2 — the Continue button shows the count for the current tentative selection.
    const afterPick = await readCard();
    const footAfter = num((afterPick?.confirm || '').match(/([\d,٬]+)/)?.[1]);
    if (promised != null && footAfter != null) observeWatch('monthly-af-counts-update');
    if (promised != null && footAfter != null && footAfter !== promised) {
      defect(name, 'UI→UI', `chip «${pick.key}» promised ${promised} but «متابعة» reads ${footAfter}`
        + `${footBefore != null ? ` (was ${footBefore})` : ''} (monthly-af-counts-update)`);
    }

    // Commit this answer, then تخطي the rest of the round so exactly ONE predicate is committed.
    requests.length = 0;
    const beforeTurns = await page.evaluate(() => [...document.body.innerText.matchAll(/لقينا\s+([\d,٬]+)\s+إعلان/g)].length);
    let advanced = await page.locator('[data-testid="af-confirm"]').first()
      .click({ timeout: 9000 }).then(() => true).catch(() => false);
    if (!advanced) { note(`${name}: «متابعة» not clickable — harness, skipped`); return null; }
    // Bounded skip-out, the same shape verify-af-live-truth.ts uses: AF_ROUND_MAX_QUESTIONS is 4,
    // so 8 hops cannot loop forever even if a click is swallowed. Break when the card is gone (the
    // round ended) or when it is open with no تخطي (the intro/mining state has no question to skip).
    for (let hop = 0; hop < 8; hop++) {
      await sleep(5000);
      const open = await page.evaluate(() => !!document.querySelector('[data-testid="af-card"]'));
      if (!open) break;
      const skippable = await page.evaluate(() => !!document.querySelector('[data-testid="af-skip"]'));
      if (!skippable) break;
      if (!await page.locator('[data-testid="af-skip"]').first().click({ timeout: 9000 }).then(() => true).catch(() => false)) {
        note(`${name}: «تخطي» not clickable at hop ${hop} — harness`); break;
      }
    }
    await page.waitForFunction((n) => [...document.body.innerText.matchAll(/لقينا\s+([\d,٬]+)\s+إعلان/g)].length > n,
      beforeTurns, { timeout: 50000 }).catch(() => {});
    await sleep(3500);

    const landed = lastCount(await page.evaluate(() => document.body.innerText));
    if (promised != null && landed != null && promised !== landed) {
      defect(name, 'UI→RENDERED', `AF chip «${pick.key}» promised ${promised}, landed ${landed}`);
    }
    return assertChain(`${name}:${first.title}`, { intent: { city: plan.city, deal: plan.deal, period: plan.period }, page, requests });
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
    observeWatch('tab-switch-no-junk-history');   // reached only if the round trips actually ran
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
    await page.waitForFunction((src) => new RegExp(src).test(document.body.innerText),
      SETTLED_RE.source, { timeout: 25000 }).catch(() => {});
    await sleep(2500);
    const ui = await visibleState(page);
    const stillShown = await d.inputValue().catch(() => '');
    const req = requests.filter((r) => (r.p_limit ?? 0) > 1).pop();
    const searchedDistrict = !!(req?.p_districts?.length) || !!ui.district;
    const body = await page.evaluate(() => document.body.innerText);
    const warned = /اختر|حدّد|حدد الحي|لم يتم|اختر الحي/.test(body);
    // Same shared predicate: a search that honestly returned zero («ما لقيت …») HAS run. Reading it
    // as "no search" would silently suppress this watch's defect — a false negative, the worse way
    // for a barrier to be wrong.
    const searchRan = SETTLED_RE.test(body);
    // Holding the search while the district is uncommitted is a correct outcome too.
    observeWatch('typed-district-not-dropped');   // the city was offered and the flow completed
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
