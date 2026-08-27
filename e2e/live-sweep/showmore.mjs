// «عرض المزيد» — the pagination journey the daily sweep did not have.
//
// SEARCH_MATCH_QA_ENGINEER.md §10 requires «عرض المزيد» to be ACTUALLY CLICKED in production every
// day: after every batch all filters stay active, no duplicates appear, no wrong listing enters a
// later batch, and the true total never moves. On 2026-08-27 the sweep's ten journeys covered
// normal-filter, trending, AF, honest-zero, card→source→back and clear-all — but nothing clicked the
// pager, so §10 was the one daily requirement with no browser evidence behind it.
//
// Identity is source_table:listing_id off the RPC's own response, never card text (§41.9:
// text-shaped keys collided across 150 genuinely distinct مكتب cards on a previous run). Nothing
// here is clicked through to a source platform, so the journey generates ZERO source traffic (§40.6).
//
// WHAT "DONE" LOOKS LIKE. Production caps one search's browse at BROWSE_CAP (100) and then offers
// «خلّنا نحدد الطلب أكثر» instead of paging on, so a healthy الرياض run is 10 → 100 cards and ONE
// pager click — not an endless ladder. The absence of a pager at 100 is the contract, not a defect;
// what must hold is that the closing line still states the TRUE total («لقينا 21,868 … وعرضنا لك 100
// منها»), which this journey asserts (owner 2026-08-20, scripts/verify-result-cap-honesty.ts).
//
// Traps this journey is built around: §41.2 (scroll_into_view, never bare coordinates), §41.3 (card
// descriptions carry their own «عرض المزيد» — and its 25px rule no longer separates them, see
// PAGER_MIN_HEIGHT below), §41.4 (cards drip in and the pager is disabled while they do; a stable
// count of 0 is the intro typing, not a settled search), §41.5 (only p_limit > 1 requests are result
// searches — autocomplete reuses the same RPC at p_limit 1).

import { withPage, setDeal, setPeriod, pickCity, runSearch, visibleState, num,
         defect, note, sleep } from './sweep.mjs';

const countCards = (page) => page.evaluate(() => (document.body.innerText.match(/الضغط على هذا الإعلان/g) || []).length);

/** §41.4 — wait until the card count STOPS growing; a stable 0 is not settled. */
async function settle(page, { minCards = 1, tries = 40 } = {}) {
  let last = -1, stable = 0;
  for (let i = 0; i < tries; i++) {
    const n = await countCards(page);
    if (n === last && n >= minCards) { if (++stable >= 3) return n; } else { stable = 0; }
    last = n;
    await sleep(700);
  }
  return last;
}

/**
 * §41.2 + §41.3 — the real pager, not a card's own description expander.
 *
 * §41.3's "height >= 25px" no longer discriminates: measured live 2026-08-27 on a 10-card الرياض
 * screen, the five card-description expanders render at **27px** (w 211) and the real pager at
 * **38px** (w 118), so a >=25 filter returns an EXPANDER as its first hit and the pager looks
 * absent — 21,868 results with "no «عرض المزيد»". Two discriminators, both needed: height >= 30,
 * and take the LAST (bottom-most) match, since the pager always sits below every card.
 */
const PAGER_MIN_HEIGHT = 30;

async function pager(page) {
  const hit = await page.evaluate((minH) => {
    const cands = [];
    for (const e of document.querySelectorAll('div')) {
      if ((e.innerText || '').trim() !== 'عرض المزيد') continue;
      const r = e.getBoundingClientRect();
      if (r.height >= minH) cands.push({ y: r.y + window.scrollY, x: r.x + r.width / 2, h: r.height });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.y - b.y);
    return cands[cands.length - 1];
  }, PAGER_MIN_HEIGHT);
  if (!hit) return null;
  // Re-locate as a real element so Playwright dispatches a TRUSTED click (§41.2 forbids bare
  // coordinates; React listens for focusin and ignores synthetic events).
  const all = page.locator('div', { hasText: /^عرض المزيد$/ });
  const n = await all.count();
  for (let i = n - 1; i >= 0; i--) {
    const el = all.nth(i);
    const box = await el.boundingBox().catch(() => null);
    if (box && box.height >= PAGER_MIN_HEIGHT) return el;
  }
  return null;
}

export async function showMoreJourney(plan) {
  const name = `show-more:${plan.city}/${plan.type ?? 'شقة'}`;
  return withPage(false, async (page, requests) => {
    // The rows production actually served, straight off the RPC response — the identity source for
    // the duplicate check below. Hooked before the search so no result response is missed.
    const served = [];
    page.on('response', async (res) => {
      if (!res.url().includes('location_search_candidates_ar')) return;
      let req = {};
      try { req = JSON.parse(res.request().postData() || '{}'); } catch { return; }
      if ((req.p_limit ?? 0) <= 1) return;   // §41.5 — p_limit 1 is an autocomplete probe, not a search
      try {
        const body = await res.json();
        if (Array.isArray(body)) served.push(body);
      } catch { /* a non-JSON body is not evidence of anything */ }
    });

    if (plan.deal) await setDeal(page, plan.deal);
    if (plan.period) await setPeriod(page, plan.period);
    if (!await pickCity(page, plan.city)) { note(`${name}: city not offered — skipped`); return null; }
    await runSearch(page);

    const state0 = await visibleState(page);
    if (state0.zero) { note(`${name}: honest zero — not a pagination cohort, skipped`); return null; }

    // §41.5 — only p_limit > 1 is a result search; the حي option probes reuse this RPC at p_limit 1.
    const searches = () => requests.filter((r) => (r.p_limit ?? 0) > 1);
    const req0 = searches().at(-1) ?? {};
    const total0 = state0.headline;

    let n = await settle(page);
    const batches = [{ batch: 0, cards: n, headline: total0 }];

    for (let b = 1; b <= (plan.batches ?? 3); b++) {
      const btn = await pager(page);
      if (!btn) {
        // Not a failure: production caps one search's browse at BROWSE_CAP (100) and then invites the
        // user to NARROW instead of paging on (scripts/verify-result-cap-honesty.ts, owner 2026-08-20).
        // The cap is only honest if the closing line still states the TRUE total — «لقينا 21,868 …
        // وعرضنا لك 100 منها», never "found 100". That is the §40 true-total-never-page-cap rule at
        // the one screen where the two numbers are most easily confused, so assert it here.
        const closing = await page.evaluate(() => (document.body.innerText
          .match(/لقينا\s+([\d,٬]+)\s+إعلان[^\n]*?وعرضنا لك\s+([\d,٬]+)\s+منها/) || []).slice(1, 3));
        if (closing.length === 2) {
          const [claimedTotal, shown] = closing;
          if (claimedTotal !== total0) {
            defect(name, 'TRUE-TOTAL', `cap message quotes ${claimedTotal} but the search found ${total0}`);
          }
          if (claimedTotal === shown && num(total0) > num(shown)) {
            defect(name, 'TRUE-TOTAL', `cap message quotes the CAP (${shown}) as the match total`);
          }
          note(`${name}: browse cap reached after ${b - 1} «عرض المزيد» — «لقينا ${claimedTotal} … وعرضنا لك ${shown} منها» (honest)`);
        } else {
          note(`${name}: no «عرض المزيد» after batch ${b - 1} (${n} cards)`);
        }
        break;
      }
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(400);
      await btn.click({ timeout: 20000 }).catch((e) => defect(name, 'PAGER-CLICK', `batch ${b}: ${e.message}`));
      const before = n;
      n = await settle(page, { minCards: before + 1 });
      const st = await visibleState(page);

      // ── §10 assertions, every batch ──────────────────────────────────────────────────────────
      if (n <= before) {
        defect(name, 'PAGINATION', `batch ${b} added no cards (${before} → ${n}) while a pager was offered`);
      }
      if (st.headline !== total0) {
        defect(name, 'TRUE-TOTAL', `headline moved across «عرض المزيد»: ${total0} → ${st.headline}`);
      }
      for (const [k, v0] of Object.entries({ city: state0.city, deal: state0.deal, type: state0.type,
                                             district: state0.district, budget: state0.budget })) {
        if (v0 != null && st[k] !== v0) {
          defect(name, 'FILTER-PERSISTENCE', `«${k}» changed across batch ${b}: ${v0} → ${st[k]}`);
        }
      }
      if (st.entities.length) defect(name, 'RENDER', `HTML entities rendered in batch ${b}: ${st.entities.join(',')}`);
      if (st.latinInCards.length) defect(name, 'RENDER', `undefined/NaN in batch ${b}: ${st.latinInCards.join(',')}`);

      // A later batch must not re-issue a DIFFERENT search — same predicate, later offset only.
      const req = searches().at(-1) ?? {};
      for (const k of ['p_deal', 'p_rent_period', 'p_cities', 'p_districts', 'p_category', 'p_types']) {
        if (JSON.stringify(req[k]) !== JSON.stringify(req0[k])) {
          defect(name, 'REQUEST-DRIFT', `batch ${b} changed ${k}: ${JSON.stringify(req0[k])} → ${JSON.stringify(req[k])}`);
        }
      }
      batches.push({ batch: b, cards: n, headline: st.headline });
    }

    // ── duplicates, by TRUE identity (§30, §41.9: similarity is never evidence) ───────────────────
    // Identity is source_table:listing_id off the RPC's own response — not card text, which collides
    // across genuinely distinct listings from one agent/building. «عرض المزيد» reveals more of an
    // already-fetched page rather than re-querying, so the response captured at search time IS the
    // set the later batches draw from: a duplicate there would surface as a repeated card.
    const rows = served.flat();
    const keys = rows.map((r) => `${r.source_table}:${r.listing_id}`);
    const uniq = new Set(keys);
    if (keys.length && uniq.size !== keys.length) {
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      defect(name, 'DUPLICATE-IDS',
        `${keys.length - uniq.size} duplicate listing id(s) in the served set: ${[...new Set(dupes)].slice(0, 3).join(' | ')}`);
    }
    // Every card the user can now see must be backed by a served row.
    if (keys.length && n > keys.length) {
      defect(name, 'CARDS-EXCEED-SET', `${n} cards rendered from only ${keys.length} served rows`);
    }

    return { name, ok: true, batches, servedRows: keys.length, distinctIds: uniq.size, finalCards: n };
  });
}
