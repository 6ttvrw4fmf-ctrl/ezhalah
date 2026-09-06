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
// WHAT "DONE" LOOKS LIKE (owner 2026-08-29, supersedes the 2026-08-20 lifetime cap). Paging
// CONTINUES in clean 100-batches for as long as matches remain: a healthy الرياض run is 10 → 100 →
// 200 → 300 across this journey's budgeted clicks, with the pager still offered whenever more
// matches genuinely exist. A pager may legitimately be ABSENT only when everything matching is on
// screen — and then the closing line must state the true matched total with the honest shown count
// («عرضت لك أول 100 من أصل 21,868 إعلان مطابق» mid-browse, «عرضت لك جميع الإعلانات …» at the end),
// never a batch size standing in for the total (scripts/verify-result-cap-honesty.ts).
//
// Traps this journey is built around: §41.2 (scroll_into_view, never bare coordinates), §41.3 (card
// descriptions carry their own «عرض المزيد» — and its 25px rule no longer separates them, see
// PAGER_MIN_HEIGHT below), §41.4 (cards drip in and the pager is disabled while they do; a stable
// count of 0 is the intro typing, not a settled search), §41.5 (only p_limit > 1 requests are result
// searches — autocomplete reuses the same RPC at p_limit 1).

import { withPage, setDeal, setPeriod, pickCity, runSearch, visibleState, num,
         defect, note, sleep, lastCount, tapByText } from './sweep.mjs';
import { commitOneAfAnswer } from './journeys.mjs';

// The AF params REQUEST-DRIFT must also watch once a predicate is committed — every certified AF
// field's RPC param name (src/data/advancedFilters.ts). A page carrying a DIFFERENT AF param set
// than the page before it silently dropped or invented a predicate mid-browse.
const AF_PARAMS = [
  'p_amenities', 'p_bath_min', 'p_furnished', 'p_street_width_min', 'p_rating_min', 'p_reviews_min',
  'p_unit_subtypes', 'p_age_min', 'p_age_max', 'p_directions',
];

// SCOPE questions (src/data/advancedFilters.ts SCOPE_QUESTIONS) share the AF card UI and round
// machinery with the 9 certified predicate questions, but narrow via p_types/p_types2, not any
// AF_PARAMS field — R13.1 draws this exact line (scope tiers are not certified AF predicates). The
// AF-not-carried check below only means something for a CERTIFIED predicate answer; a scope answer
// legitimately carries nothing in AF_PARAMS and must not be flagged.
const SCOPE_QUESTION_TITLES = ['أي نوع من العقارات تبحث عنه؟', 'أي نوع عقار تحديدًا؟'];

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
    // Only needed to reach a group/type narrow enough to genuinely offer AF (plan.af) — a bare
    // city+deal search rarely has a useful AF question. Same tapByText journeys.mjs's normalFilter
    // and advancedFilter use; unused (and a no-op) when plan.group/typeLabel are absent, so every
    // existing showMoreJourney caller is unaffected.
    if (plan.group) { await tapByText(page, plan.group); await sleep(1200); }
    if (plan.typeLabel) { await tapByText(page, plan.typeLabel); await sleep(1000); }
    await runSearch(page);

    // AF-SCOPED PAGINATION (owner PERMANENT, 2026-09-04): "the app's actual Load More UI, under an
    // active AF state, must preserve the exact eligible set — no duplicates, no skips, and the
    // committed predicate must not silently change mid-browse." Reuses the exact AF-answering UI path
    // journeys.mjs's advancedFilter drives (commitOneAfAnswer) so this is the SAME real predicate a
    // user commits, not a hand-built request. Everything below this block — settle, pager, the
    // duplicate/skip/drift checks — is the identical pagination machinery every showMoreJourney run
    // already proves; only the starting state (AF-narrowed instead of a bare search) and the widened
    // REQUEST-DRIFT key list (AF_PARAMS) differ.
    let afTitle = null;
    let afIsScope = false;
    if (plan.af) {
      const before = lastCount(await page.evaluate(() => document.body.innerText));
      // `served` is passed through so commitOneAfAnswer clears it at the exact instant it clears
      // `requests` — right before the AF-narrowed search's own request fires. Clearing it any later
      // (e.g. after this call returns) is too late: «عرض المزيد» reveals more of an ALREADY-fetched
      // response rather than re-querying (see the duplicate-check comment below), so the narrowed
      // search's own response — the only evidence this journey's pagination can be checked against —
      // fires DURING commitOneAfAnswer's «متابعة» click, not after it.
      const answer = await commitOneAfAnswer(page, name, requests, before, served);
      if (!answer) { note(`${name}: no AF predicate could be committed — skipped`); return null; }
      afTitle = answer.title;
      afIsScope = SCOPE_QUESTION_TITLES.includes(afTitle);
    }

    const state0 = await visibleState(page);
    if (state0.zero) { note(`${name}: honest zero — not a pagination cohort, skipped`); return null; }

    // §41.5 — only p_limit > 1 is a result search; the حي option probes reuse this RPC at p_limit 1.
    const searches = () => requests.filter((r) => (r.p_limit ?? 0) > 1);
    const req0 = searches().at(-1) ?? {};
    const total0 = state0.headline;
    if (plan.af) {
      if (afIsScope) {
        // A scope question (group/type) narrows via p_types/p_types2, not AF_PARAMS — R13.1 draws
        // this line. That narrowing is already watched by the base REQUEST-DRIFT keys (p_types is in
        // both branches below); nothing here is a certified-predicate claim to verify.
        note(`${name}: AF-scoped pagination cohort — «${afTitle}» is a SCOPE question, not a certified predicate (allowed)`);
      } else {
        const activeAf = AF_PARAMS.filter((k) => req0[k] != null && !(Array.isArray(req0[k]) && req0[k].length === 0));
        if (!activeAf.length) {
          defect(name, 'AF-NOT-CARRIED', `committed AF answer «${afTitle}» but the post-answer search carries no AF param (${JSON.stringify(req0)})`);
        } else {
          note(`${name}: AF-scoped pagination cohort — «${afTitle}», carrying ${activeAf.join(',')}`);
        }
      }
    }

    let n = await settle(page);
    const batches = [{ batch: 0, cards: n, headline: total0 }];

    for (let b = 1; b <= (plan.batches ?? 3); b++) {
      const btn = await pager(page);
      if (!btn) {
        // Read the closing line and the AF-card state in ONE evaluate, so both describe the same
        // instant as the pager probe above.
        //
        // THE CLOSING LINE IS READ **LAST-FIRST**, MATCHING `visibleState.headline` (2026-09-05).
        // It used to be read with `.match()` — the FIRST «من أصل|لقينا N إعلان» in the whole
        // document — while `headline` is `[...matchAll].pop()`, the LAST. This is a CHAT: the
        // transcript keeps every earlier search's closing line, so the two readings land on
        // different messages the moment a journey runs a second search. Every AF-scoped pagination
        // run does exactly that by construction (search, then the AF-narrowed search), so this
        // journey reported a TRUE-TOTAL defect on every single AF run since it was added on
        // 2026-09-04. Measured 2026-09-05 on الرياض/بيع/فيلا: the document held ["11,254","5,970"],
        // the harness compared 11,254 against a headline of 5,970 and called production wrong —
        // while 11,254 was the villa search's own true total and 5,970 the same search plus
        // p_street_width_min 20, both confirmed exactly against the RPC. §40.7's cardinal sin:
        // an oracle accusing the product for its own imprecision.
        const st = await page.evaluate(() => {
          const txt = document.body.innerText;
          return {
            closing: ([...txt.matchAll(/(?:من أصل|لقينا)\s+([\d,٬]+)\s+إعلان/g)].pop() || [])[1] ?? null,
            // The Advanced Filter interview deliberately hides the whole actions row while it is
            // open (owner 2026-08-21): the AF card is an absolute overlay and buttons underneath it
            // are unreachable. That is intended product behaviour, not a missing pager.
            afOpen: !!document.querySelector('[data-testid="af-card"]'),
            // …but ONLY while it still has a question to ask (owner rule 2026-09-05). An AF card
            // sitting open with NO question is not narrowing and not browsing — it is a stuck
            // interview holding the pager hostage, which is the removed lifetime cap wearing the
            // interview's clothes. So the stand-down is conditioned on a real question being on
            // screen, not on the card merely existing.
            afAsking: !!document.querySelector('[data-testid="af-question-title"]')
              && !!document.querySelector('[data-testid="af-confirm"]'),
            loadMoreButtons: document.querySelectorAll('[data-testid="results-load-more"]').length,
            // Does the visible closing sentence still ASK the user to load more?
            promisesMore: /تبي أعرض لك المزيد/.test(txt),
          };
        });

        if (st.afAsking) {
          // The pager is intentionally absent here — so assert the contract that still applies
          // instead of accusing, and assert it for real: the sentence must not offer a button the
          // interview has removed. This is the defect this journey actually found on 2026-09-05
          // («عرضت لك أول 10 من أصل 5,970 … تبي أعرض لك المزيد؟» with zero results-load-more
          // elements in the document), fixed in src/data/resultCount.ts + agent.tsx.
          if (st.promisesMore && st.loadMoreButtons === 0) {
            defect(name, 'PROMISE-WITHOUT-BUTTON',
              `the closing line offers «عرض المزيد» while the Advanced Filter interview is asking a question and zero «عرض المزيد» buttons are rendered (${n} cards, search found ${total0})`);
          } else {
            note(`${name}: Advanced Filter interview is asking — actions row correctly hidden (owner 2026-08-21/2026-09-05) and the closing line offers nothing it cannot deliver`);
          }
        } else if (st.afOpen && num(total0) > n) {
          // An AF card with NO question on it, while matches remain unreached. The interview is not
          // narrowing (nothing to answer) and the user cannot browse (row withheld) — a dead end that
          // the old `afOpen` stand-down would have swallowed silently. `loading` and `mining` are
          // both transient and latch to closed, so seeing this settled is a real defect, not a race:
          // settle() has already waited for the card count to stop moving before we get here.
          defect(name, 'AF-HOLDS-PAGER-WITH-NO-QUESTION',
            `an Advanced Filter card is open with no question on it while ${n} of ${total0} matches are shown and no «عرض المزيد» is offered — the interview is holding browsing without narrowing`);
        } else if (num(total0) > n) {
          // CONTINUATION CONTRACT (owner 2026-08-29): with no AF interview open, the pager may be
          // absent ONLY when everything matching is already on screen. Anything else is the exact
          // lifetime ceiling the owner removed.
          defect(name, 'PAGER-MISSING', `no «عرض المزيد» at ${n} cards while the search found ${total0} — the removed lifetime cap is back`);
        } else {
          note(`${name}: all ${n} matching cards on screen — pager legitimately absent`);
        }

        // The closing line must state the search's TRUE total, never a batch size — compared
        // against the headline read the SAME way, off the SAME message.
        if (st.closing && st.closing !== total0 && num(st.closing) > 0 && num(total0) > 0 && num(st.closing) !== n) {
          defect(name, 'TRUE-TOTAL', `closing message quotes ${st.closing} but the search found ${total0}`);
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
      // AF_PARAMS join the watch list whenever this journey is AF-scoped: a certified AF answer is
      // exactly as much "the committed predicate" as p_deal/p_cities always were, and must survive
      // every «عرض المزيد» click identically — never silently dropped, never invented mid-browse.
      const req = searches().at(-1) ?? {};
      const driftKeys = plan.af
        ? ['p_deal', 'p_rent_period', 'p_cities', 'p_districts', 'p_category', 'p_types', 'p_types2', ...AF_PARAMS]
        : ['p_deal', 'p_rent_period', 'p_cities', 'p_districts', 'p_category', 'p_types'];
      for (const k of driftKeys) {
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
