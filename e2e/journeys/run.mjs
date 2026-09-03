// ═══════════════════════════════════════════════════════════════════════════════════════════════
// JOURNEY & PERSISTENCE SWEEP (routine #6) — drives PRODUCTION like a person clicking around.
//
//   node e2e/journeys/run.mjs                 # everything
//   JOURNEY_ONLY=arabic-hint node …           # one journey while developing
//   JOURNEY_N=3 node …                        # repetitions per journey (PART 11.4: N>=2 to file)
//
// EXIT CODE: non-zero when any journey found a DEFECT. Never read it through a pipe (§41.12
// corollary: `… | tail` reports tail's status) — redirect to a file and read $?.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { withPage, settle, bodyText, storedHistory, clickText, clickReason, sleep, defect, note, pass,
         findings, skips, skip, ledgerRecord, registerJourneys, engineAvailable, openMobileSidebar,
         closeMobileSidebar, THREE_CHATS, SUB, BASE } from './harness.mjs';

const ONLY = process.env.JOURNEY_ONLY || '';
const N = Number(process.env.JOURNEY_N || 2);

// ── shared helpers ──────────────────────────────────────────────────────────────────────────────

/** Type like a person: one key at a time, through React's real event path. */
const typeInto = async (loc, text) => { await loc.click(); await loc.pressSequentially(text, { delay: 60 }); };

/** Is this text VISIBLE, not merely present in innerText? A CSS-faded toast stays in innerText
 *  (agent.tsx's «شكراً على ملاحظتك» does exactly that), so presence is never the oracle. */
const visible = async (page, text) => {
  const loc = page.getByText(text, { exact: false }).first();
  if (!(await loc.count())) return false;
  return await loc.isVisible().catch(() => false);
};

/** At 375px the sidebar is an UNMOUNTED drawer, not a hidden one — every sidebar journey silently
 *  "skipped" on mobile until this existed, so half the mandate reported success by never looking. */
// `guestOk` is passed through for the journeys that run signed-OUT: the default open-oracle is
// `sidebar-search-btn`, which Sidebar.tsx renders only in its `user ? (…)` branch, so a guest
// journey keyed on it would skip forever while looking like coverage.
const ensureSidebar = async (page, mobile, opts = {}) => (mobile ? openMobileSidebar(page, opts) : true);

const openSidebarSearch = async (page) => {
  const btn = page.locator('[data-testid="sidebar-search-btn"]');
  if (!(await btn.count())) return null;
  await btn.first().click();
  await sleep(900);
  const input = page.locator('[data-testid="sidebar-search-input"]');
  return (await input.count()) ? input.first() : null;
};

const ARABIC_HINT = 'اكتب بالعربي للبحث في محادثاتك';

// ═══ JOURNEYS ═══════════════════════════════════════════════════════════════════════════════════
const JOURNEYS = {};

/** J1 — cold open, guest, both viewports. The floor: it loads, it has no page errors, and on
 *  mobile it does not overflow horizontally (PART 5 shape 11). */
JOURNEYS['cold-open'] = async (mobile) => withPage({ mobile }, async (page, bag) => {
  const name = `cold-open:${mobile ? 'mobile375' : 'desktop1440'}`;
  const text = await bodyText(page);
  if (text.length < 200) defect(name, 'blank page', `body innerText is ${text.length} chars`);
  else pass(name, `rendered (${text.length} chars)`);
  if (!text.includes('بحث')) defect(name, 'missing primary control', '«بحث» not rendered on Filter home');
  if (bag.pageErrors.length) defect(name, 'page error on cold open', bag.pageErrors.join(' | '));
  if (mobile) {
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    if (ov.sw > ov.cw + 1) defect(name, 'horizontal overflow', `scrollWidth ${ov.sw} > clientWidth ${ov.cw}`);
    else pass(name, `no horizontal overflow (${ov.sw}/${ov.cw})`);
  }
});

/** J2 — THE ARABIC-ONLY HINT LIFECYCLE.
 *  chatSearch.ts states the contract: "`hadLatin` tells the UI a strip happened so it can show the
 *  hint ONCE, not per key." So: Latin → hint appears (correct, and must never silently search);
 *  then a real Arabic query → the hint's job is done and it must go, because the list is now
 *  actively filtering on that query. A corrective hint that outlives the correction is a false
 *  error state sitting on top of a working one. */
JOURNEYS['arabic-hint'] = async (mobile) => withPage({ mobile, signedIn: true, history: THREE_CHATS() }, async (page) => {
  const name = `arabic-hint:${mobile ? 'mobile375' : 'desktop1440'}`;
  if (!(await ensureSidebar(page, mobile))) { skip(name, 'mobile sidebar drawer would not open'); return; }
  const input = await openSidebarSearch(page);
  if (!input) { skip(name, 'sidebar search unavailable'); return; }

  await typeInto(input, 'villa');
  await sleep(1000);
  const hintAfterLatin = await visible(page, ARABIC_HINT);
  const valAfterLatin = await input.inputValue();
  const rowsAfterLatin = await page.getByText('عقارات الرياض', { exact: true }).count();
  if (!hintAfterLatin) defect(name, 'Latin input not flagged', 'hint did not appear for «villa»');
  else pass(name, 'Latin input shows the Arabic-only hint');
  if (valAfterLatin !== '') defect(name, 'Latin not stripped', `field kept «${valAfterLatin}»`);
  if (rowsAfterLatin === 0) defect(name, 'Latin silently searched', 'list filtered on a Latin query');
  else pass(name, 'Latin query never filters the list');

  // The correction: the user switches keyboard and types a real Arabic query. The field is already
  // empty (Latin was stripped), so this is the ordinary path — no pass through a cleared field.
  await typeInto(input, 'فلل');
  await sleep(1200);
  const hintAfterArabic = await visible(page, ARABIC_HINT);
  const filtered = await page.getByText('فلل جدة', { exact: true }).count();
  const others = await page.getByText('عقارات الرياض', { exact: true }).count();
  if (filtered === 0 || others !== 0) {
    defect(name, 'Arabic query did not filter', `«فلل جدة»=${filtered}, «عقارات الرياض»=${others}`);
  } else {
    pass(name, 'Arabic query filters the list correctly');
  }
  if (hintAfterArabic) {
    defect(name, 'stale hint outlives the correction',
      'the «type in Arabic» hint is STILL shown while a valid Arabic query is actively filtering');
  } else {
    pass(name, 'hint clears once a real Arabic query is supplied');
  }
});

/** J3 — search is READ-ONLY DISCOVERY (PART 5 shape 5). Opening/searching must never add, drop,
 *  rename or reorder a stored chat. The oracle is the app's OWN persisted history, before/after. */
JOURNEYS['search-readonly'] = async (mobile) => withPage({ mobile, signedIn: true, history: THREE_CHATS() }, async (page) => {
  const name = `search-readonly:${mobile ? 'mobile375' : 'desktop1440'}`;
  if (!(await ensureSidebar(page, mobile))) { skip(name, 'mobile sidebar drawer would not open'); return; }
  const before = await storedHistory(page);
  const input = await openSidebarSearch(page);
  if (!input) { skip(name, 'sidebar search unavailable'); return; }
  await typeInto(input, 'فلل');
  await sleep(1200);
  await typeInto(input, ' جدة');
  await sleep(1200);
  const after = await storedHistory(page);
  const ids = (h) => (h || []).map((x) => x.id).join(',');
  if (ids(before) !== ids(after)) {
    defect(name, 'search mutated history', `before [${ids(before)}] → after [${ids(after)}]`);
  } else if ((after || []).length !== 3) {
    defect(name, 'history row count changed', `expected 3, got ${(after || []).length}`);
  } else {
    pass(name, 'search created/lost/reordered nothing (3 rows, same ids)');
  }
});

/** J4 — opening a saved chat opens THAT chat, exactly once, creating no duplicate (PART 5 shape 4).
 *  Asserted on persisted history, not on a screenful of text. */
JOURNEYS['open-saved-chat'] = async (mobile) => withPage({ mobile, signedIn: true, history: THREE_CHATS() }, async (page, bag) => {
  const name = `open-saved-chat:${mobile ? 'mobile375' : 'desktop1440'}`;
  if (!(await ensureSidebar(page, mobile))) { skip(name, 'mobile sidebar drawer would not open'); return; }
  const before = await storedHistory(page);
  const ok = await clickText(page, 'فلل جدة');
  if (!ok) { skip(name, 'row not found'); return; }
  await sleep(3500);
  const after = await storedHistory(page);
  if ((after || []).length !== (before || []).length) {
    defect(name, 'opening a chat changed the row count',
      `${(before || []).length} → ${(after || []).length} (duplicate or lost chat)`);
  } else {
    pass(name, `opened without duplicating (${(after || []).length} rows)`);
  }
  if (bag.pageErrors.length) defect(name, 'page error while opening a saved chat', bag.pageErrors.join(' | '));
});

/** J5 — NEW CHAT must start genuinely blank (PART 5 shape 1). Type into the agent composer, then
 *  hit «محادثة جديدة»: no inherited text may survive into the fresh chat. */
JOURNEYS['new-chat-blank'] = async (mobile) => withPage({ mobile, signedIn: true, history: THREE_CHATS() }, async (page, bag) => {
  const name = `new-chat-blank:${mobile ? 'mobile375' : 'desktop1440'}`;
  // ORDER MATTERS ON MOBILE. This used to open the drawer FIRST, and at 375px the open drawer
  // covers the whole screen — so the tap on «الوكيل الذكي» was intercepted and the agent screen
  // never opened. With the old swallow-the-failure clickText that read as a success, and the
  // journey skipped two runs running on the downstream symptom («composer not found»). The
  // sidebar is not needed until «محادثة جديدة», so it is opened THERE, not here.
  if (!(await clickText(page, 'الوكيل الذكي'))) { skip(name, `agent tab: ${clickReason()}`); return; }
  await sleep(3500);
  const composer = page.locator('textarea').first();
  if (!(await composer.count())) { skip(name, 'composer not found'); return; }
  await typeInto(composer, 'شقة في جدة');
  await sleep(800);
  const typed = await composer.inputValue();
  if (!typed.includes('شقة')) { skip(name, 'composer did not accept text'); return; }

  if (!(await ensureSidebar(page, mobile))) { skip(name, 'mobile sidebar drawer would not open'); return; }
  if (!(await clickText(page, 'محادثة جديدة'))) { skip(name, `New Chat: ${clickReason()}`); return; }
  await sleep(3000);
  const after = page.locator('textarea').first();
  const leftOver = (await after.count()) ? await after.inputValue() : '';
  if (leftOver.trim()) {
    defect(name, 'New Chat inherited composer text', `blank chat still holds «${leftOver}»`);
  } else {
    pass(name, 'New Chat starts blank');
  }
  if (bag.pageErrors.length) defect(name, 'page error on New Chat', bag.pageErrors.join(' | '));
});

/** J6 — a rapid double-click on «بحث» must run the search ONCE (PART 5 shape 7).
 *
 *  THE ORACLE IS A MEASURED BASELINE, NOT A MAGIC NUMBER. The obvious oracle — "more than one
 *  search RPC means it fired twice" — is wrong here, and on the first attempt it filed a confident
 *  4/4 product bug that did not exist: ONE «بحث» press legitimately issues SIX distinct
 *  `location_search_candidates_ar` calls. Measured on production 2026-08-28: single click -> 6,
 *  double click -> 6, identical. "Fired twice" therefore means "sent more than a single click
 *  would have", so a single click in its own fresh context IS the oracle — measured every run
 *  rather than hard-coded, because that call count is routine #4's to change freely and a constant
 *  here would rot into a false alarm the day they do. */
const primeSearch = async (page) => {
  await clickText(page, 'شراء');
  await sleep(600);
  const city = page.locator('[data-testid="city-input"]');
  if (!(await city.count())) return false;
  await city.first().click();
  await sleep(2500);
  await typeInto(city.first(), 'الرياض');
  await sleep(2500);
  await clickText(page, 'الرياض', { exact: true, nth: 0 });
  await sleep(1500);
  return (await page.getByText('بحث', { exact: true }).last().count()) > 0;
};

JOURNEYS['double-click-search'] = async (mobile) => {
  const name = `double-click-search:${mobile ? 'mobile375' : 'desktop1440'}`;
  const press = (clicks) => withPage({ mobile }, async (page, bag) => {
    if (!(await primeSearch(page))) return null;
    const from = bag.rpc.length;
    await page.getByText('بحث', { exact: true }).last()
      .click({ clickCount: clicks, delay: 40 }).catch(() => {});
    await sleep(10_000);
    return bag.rpc.slice(from).filter((r) => r.name === 'location_search_candidates_ar').length;
  });

  const single = await press(1);
  const double = await press(2);
  if (single === null || double === null) { skip(name, 'search could not be primed'); return; }
  if (single === 0) { defect(name, 'dead control', '«بحث» single click fired no search at all'); return; }
  if (double > single) {
    defect(name, 'double-click fired the search twice',
      `single click -> ${single} search RPCs, double click -> ${double}`);
  } else {
    pass(name, `double-click ran one search (single ${single} / double ${double} RPCs)`);
  }
};

/** J7 — browser Back after a real search must land somewhere usable (PART 5 shape 9).
 *
 *  BACK IS ONLY MEANINGFUL ONCE THE APP HAS PUSHED AN ENTRY. The first version of this journey
 *  pressed Back straight after switching to «الوكيل الذكي» and filed a 4/4 "Back stranded the user
 *  at about:blank". Both halves of that were wrong: tab switching pushes NO history entry BY OWNER
 *  RULE (the live sweep's permanent watch `tab-switch-no-junk-history`), and `about:blank` is the
 *  fresh Playwright context's own initial page — a real visitor arrives with their own history and
 *  simply leaves the site, which is correct. So the journey now performs a real search (which does
 *  push), and any Back that leaves the app origin is reported as leaving, never as stranding.
 */
JOURNEYS['back-after-search'] = async (mobile) => withPage({ mobile }, async (page, bag) => {
  const name = `back-after-search:${mobile ? 'mobile375' : 'desktop1440'}`;
  if (!(await primeSearch(page))) { skip(name, 'search could not be primed'); return; }
  const beforeUrl = page.url();
  await page.getByText('بحث', { exact: true }).last().click().catch(() => {});
  await sleep(10_000);
  const afterUrl = page.url();
  if (afterUrl === beforeUrl) {
    note(`${name}: the search pushed no history entry (${afterUrl}) — Back is not applicable here`);
    return;
  }

  await page.goBack({ waitUntil: 'load' }).catch(() => {});
  await settle(page);
  const url = page.url();
  if (!url.startsWith(BASE)) {
    note(`${name}: Back left the app origin (${url}) — a fresh context has no prior in-app entry`);
    return;
  }
  const text = await bodyText(page);
  if (text.length < 200) defect(name, 'Back stranded the user', `body is ${text.length} chars at ${url}`);
  else if (!text.includes('بحث')) defect(name, 'Back landed off-route', `no Filter home controls at ${url}`);
  else pass(name, `Back returned to a usable screen (${url})`);
  if (bag.pageErrors.length) defect(name, 'page error on Back', bag.pageErrors.join(' | '));
});

/** J8 — voice: FEATURE DETECTION and the control's presence. PART 10: this is engine evidence on
 *  Chromium only — it says nothing about a real iPhone's microphone or audio session. */
JOURNEYS['voice-control'] = async (mobile) => withPage({ mobile }, async (page, bag) => {
  const name = `voice-control:${mobile ? 'mobile375' : 'desktop1440'}`;
  await clickText(page, 'الوكيل الذكي');
  await sleep(3500);
  const supported = await page.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  const mic = page.locator('[data-testid="voice-mic"]');
  const micCount = await mic.count();
  note(`${name}: SpeechRecognition supported=${supported}, mic control rendered=${micCount}`);
  if (micCount) {
    await mic.first().click().catch(() => {});
    await sleep(2500);
    if (bag.pageErrors.length) defect(name, 'mic tap threw', bag.pageErrors.join(' | '));
    else pass(name, 'mic tap did not throw');
  }
});

/** Open a sidebar row's ⋯ menu (rename / add-to-favourites / delete).
 *  The affordance carries no testID, so it is located from the ROW's own rect — hover the row,
 *  then click just inside its trailing edge, in CSS pixel space (PART 9.2 (4)). */
/**
 * Open a history row's ⋯ menu.
 *
 * THE ⋯ IS FOUND STRUCTURALLY, NOT BY A PIXEL OFFSET. This used to click
 * `label.x + label.width + 20` — "the sidebar panel's trailing edge sits ~20px right of the title's
 * own box in this layout" — which is true for a row in الأخيرة and FALSE for a row in المفضلة.
 * A starred row renders `{c.starred && <Ionicons name="star" .../>}` (Sidebar.tsx) between the
 * label and the ⋯, so the offset lands on the gold star instead of the menu button. Measured on
 * production 2026-08-30, desktop1440, starred row «فلل جدة»:
 *
 *     label box      x=47  w=175   →  offset locator clicks x=242
 *     the gold star  x=232 w=13    →  242 is INSIDE the star
 *     the real ⋯     x=253 w=32    →  centre x=269
 *
 * The cost was silent and exactly the shape PART 9.4 warns about: the menu simply never opened on
 * a starred row, so PART 1's "Favorites: add, REMOVE" clause was untestable and no journey had
 * ever unstarred anything. It did not fail loudly — `sidebar-row-actions` stars a row and stops,
 * so nothing ever asked for the menu a second time and the gap read as coverage.
 *
 * The row host is the ancestor with exactly two element children whose SECOND child does not
 * contain the label — child[0] is the label Pressable (which owns the chat icon, the text, and the
 * star), child[1] is `s.dots`. That holds for both buckets regardless of how many icons sit inside
 * the label, so it cannot rot the same way. The click is the element's own getBoundingClientRect
 * centre in CSS pixel space (PART 9.2 (4)), never a position eyeballed off a screenshot.
 */
const dotsCentre = (page, title) => page.evaluate((t) => {
  const lab = [...document.querySelectorAll('*')]
    .find((e) => e.children.length === 0 && (e.textContent || '').trim() === t);
  if (!lab) return null;
  let n = lab;
  for (let i = 0; i < 8 && n?.parentElement; i++) {
    n = n.parentElement;
    if (n.children.length === 2 && !n.children[1].contains(lab)
        && getComputedStyle(n.children[1]).cursor === 'pointer') {
      const r = n.children[1].getBoundingClientRect();
      if (r.width > 0 && r.width < 60) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
  }
  return null;
}, title);

const openRowMenu = async (page, title) => {
  const row = page.getByText(title, { exact: true }).first();
  if (!(await row.count())) return false;
  await row.hover().catch(() => {});
  await sleep(700);
  const dots = await dotsCentre(page, title);
  if (!dots) return false;
  await page.mouse.click(dots.x, dots.y).catch(() => {});
  await sleep(1200);
  return (await page.getByText('حذف', { exact: true }).count()) > 0;
};

/** J12 — SIDEBAR ROW ACTIONS: favourite and delete, each asserted on the app's OWN persisted
 *  history and each re-checked after a reload (PART 5 shapes 3 and 8). A sidebar action that looks
 *  right on screen and does not survive a refresh is the bug this exists to catch — store.tsx
 *  writes localStorage SYNCHRONOUSLY for exactly that reason, so the reload is the real assertion. */
JOURNEYS['sidebar-row-actions'] = async (mobile) => withPage({ mobile, signedIn: true, history: THREE_CHATS() }, async (page, bag) => {
  const name = `sidebar-row-actions:${mobile ? 'mobile375' : 'desktop1440'}`;
  if (!(await ensureSidebar(page, mobile))) { skip(name, 'mobile sidebar drawer would not open'); return; }
  const ids = (h) => (h || []).map((x) => x.id).join(',');

  // ── favourite ────────────────────────────────────────────────────────────────────────────────
  if (!(await openRowMenu(page, 'فلل جدة'))) { skip(name, 'row ⋯ menu would not open'); return; }
  if (!(await clickText(page, 'أضف إلى المفضلة'))) { skip(name, 'favourite action not in the menu'); return; }
  await sleep(1800);
  const favd = await storedHistory(page);
  const flagged = (favd || []).filter((x) => x.starred || x.favorite || x.pinned).map((x) => x.id);
  if (flagged.length !== 1 || flagged[0] !== 'h2') {
    defect(name, 'favourite did not land on exactly the chosen chat', `flagged=[${flagged.join(',')}], expected [h2]`);
  } else if (ids(favd) !== 'h1,h2,h3' && (favd || []).length !== 3) {
    defect(name, 'favourite changed the chat set', `ids now [${ids(favd)}]`);
  } else {
    pass(name, 'favourite applied to exactly one chat, none lost');
  }

  // ── it must survive a reload ──────────────────────────────────────────────────────────────────
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  const afterReload = await storedHistory(page);
  const stillFlagged = (afterReload || []).filter((x) => x.starred || x.favorite || x.pinned).map((x) => x.id);
  if (stillFlagged.join(',') !== flagged.join(',')) {
    defect(name, 'favourite did not survive a refresh', `[${flagged.join(',')}] → [${stillFlagged.join(',')}]`);
  } else if (flagged.length) {
    pass(name, 'favourite survived a refresh');
  }

  // ── UNFAVOURITE — the other half of PART 1's "Favorites: add, remove" ─────────────────────────
  // Never covered before 2026-08-30: openRowMenu's old pixel offset landed on the gold star of a
  // STARRED row, so the menu could not be reopened once a row had been favourited and the remove
  // path was unreachable. A one-way favourite is a trap — the row is pinned to المفضلة forever —
  // so both directions are asserted here, and the removal is re-checked after a reload because
  // "unstarred in memory, still starred on disk" comes back on the next visit.
  if (!(await ensureSidebar(page, mobile))) { skip(name, 'sidebar closed before unfavourite'); return; }
  if (!(await openRowMenu(page, 'فلل جدة'))) { skip(name, 'row ⋯ menu would not open on a STARRED row'); return; }
  if (!(await clickText(page, 'أزل من المفضلة'))) {
    defect(name, 'a starred row offers no way to unfavourite it', `«أزل من المفضلة» absent from the ⋯ menu: ${clickReason()}`);
    return;
  }
  await sleep(1800);
  const unfav = await storedHistory(page);
  const stillStarred = (unfav || []).filter((x) => x.starred || x.favorite || x.pinned).map((x) => x.id);
  if (stillStarred.length) {
    defect(name, 'unfavourite did not clear the star', `still flagged [${stillStarred.join(',')}]`);
  } else if ((unfav || []).length !== 3) {
    defect(name, 'unfavourite changed the chat set', `ids now [${ids(unfav)}], expected 3 chats`);
  } else {
    pass(name, 'unfavourite cleared the star and kept every chat');
  }

  await page.reload({ waitUntil: 'load' });
  await settle(page);
  const unfavReload = await storedHistory(page);
  const resurrected = (unfavReload || []).filter((x) => x.starred || x.favorite || x.pinned).map((x) => x.id);
  if (resurrected.length) {
    defect(name, 'the favourite came back after a refresh', `[${resurrected.join(',')}] starred again — unfavourite did not reach disk`);
  } else {
    pass(name, 'unfavourite survived a refresh');
  }

  // ── delete ────────────────────────────────────────────────────────────────────────────────────
  if (!(await ensureSidebar(page, mobile))) { skip(name, 'sidebar closed after reload'); return; }
  if (!(await openRowMenu(page, 'شقق الخبر'))) { skip(name, 'row ⋯ menu would not reopen'); return; }
  if (!(await clickText(page, 'حذف'))) { skip(name, `delete action: ${clickReason()}`); return; }
  await sleep(2000);

  // ── THE CONFIRMATION GATE IS PART OF THE GUARANTEE, NOT AN OBSTACLE TO IT ─────────────────────
  // «حذف» opens a dialog (PR #1200, deployed 2026-08-28 23:42 UTC) and only «حذف نهائي» inside it
  // deletes. This step used to be a best-effort second exact-«حذف» click with the comment "a
  // confirm step is legitimate; take it if it is offered" — which matched the ROW MENU's label,
  // not the dialog's «حذف نهائي», so once the gate shipped the journey stopped completing any
  // deletion and reported «delete did not remove the chat» 4/4 (desktop and mobile, 2026-08-29).
  // The product was right and the oracle was stale: the same journey passed 0/2 against the
  // 22:41 bundle one hour before the gate landed, and a single «حذف» provably deletes nothing
  // while «حذف نهائي» is on screen (2/2, fresh contexts).
  //
  // That is the PART 9 harm in its most expensive form: a red journey accusing a SAFETY GATE of
  // being a bug, pressuring the next author to delete the confirmation to get the suite green.
  // So the gate is now asserted rather than tolerated — the dialog must appear, the chat must
  // still be there while it is open, and إلغاء must leave it there too.
  const dialog = page.locator('[data-testid="chat-delete-confirm-dialog"]');
  if (!(await dialog.count())) {
    defect(name, 'delete fired with no confirmation dialog', 'a destructive action must be gated by «حذف نهائي» (PR #1200)');
    return;
  }
  const midDialog = await storedHistory(page);
  if (!(midDialog || []).some((x) => x.id === 'h3')) {
    defect(name, 'the chat was deleted merely by OPENING the confirmation', `ids already [${ids(midDialog)}] with the dialog still open`);
    return;
  }
  // إلغاء must be a real escape hatch, not a differently-worded delete.
  const cancel = page.locator('[data-testid="chat-delete-cancel"]');
  if (await cancel.count()) {
    await cancel.first().click({ timeout: 15_000 }).catch(() => {});
    await sleep(1500);
    const afterCancel = await storedHistory(page);
    if (!(afterCancel || []).some((x) => x.id === 'h3')) {
      defect(name, 'إلغاء deleted the chat', `ids [${ids(afterCancel)}] after cancelling the delete dialog`);
      return;
    }
    pass(name, 'إلغاء left the chat intact');
    // reopen the dialog to carry out the real deletion
    if (!(await openRowMenu(page, 'شقق الخبر'))) { skip(name, 'row ⋯ menu would not reopen after cancel'); return; }
    if (!(await clickText(page, 'حذف'))) { skip(name, `delete action after cancel: ${clickReason()}`); return; }
    await sleep(1800);
  }
  const confirm = page.locator('[data-testid="chat-delete-confirm"]');
  if (!(await confirm.count())) { skip(name, '«حذف نهائي» not present in the confirmation dialog'); return; }
  await confirm.first().click({ timeout: 15_000 }).catch(() => {});
  await sleep(2000);
  const deleted = await storedHistory(page);
  if ((deleted || []).some((x) => x.id === 'h3')) {
    defect(name, 'delete did not remove the chat', `ids still [${ids(deleted)}]`);
  } else if (!(deleted || []).some((x) => x.id === 'h1') || !(deleted || []).some((x) => x.id === 'h2')) {
    defect(name, 'delete removed the WRONG chats', `ids now [${ids(deleted)}], expected h1 and h2 to remain`);
  } else {
    pass(name, `delete removed exactly the chosen chat (ids now [${ids(deleted)}])`);
  }

  await page.reload({ waitUntil: 'load' });
  await settle(page);
  const afterDeleteReload = await storedHistory(page);
  if ((afterDeleteReload || []).some((x) => x.id === 'h3')) {
    defect(name, 'deleted chat came back after a refresh', `ids [${ids(afterDeleteReload)}]`);
  } else {
    pass(name, 'delete survived a refresh');
  }
  if (bag.pageErrors.length) defect(name, 'page error during row actions', bag.pageErrors.join(' | '));
});

/** Locate the rename TextInput. It carries no testID, and RN-web renders it as a plain <input>
 *  alongside the sidebar search field and the Filter home's city box — so it is identified by the
 *  one thing that is unambiguously true of it: `beginRename` seeds `draft` with the row's current
 *  title, so the editing input is the one whose VALUE is that title. */
const renameInputFor = async (page, currentTitle) => {
  const inputs = page.locator('input');
  for (let i = 0, n = await inputs.count(); i < n; i++) {
    if ((await inputs.nth(i).inputValue().catch(() => null)) === currentTitle) return inputs.nth(i);
  }
  return null;
};

/** J13 — SIDEBAR RENAME (PART 3 item 3, PART 5 shape 3), in a real browser for the first time.
 *
 *  WHY THIS WAS MISSING AND WORTH ADDING. PART 3 item 3 lists rename in the sidebar sweep and
 *  PART 5 shape 3 names it explicitly, but `sidebar-row-actions` covers star, unstar and delete
 *  only. The sole rename barrier, `scripts/verify-sidebar-rename-isolation.ts`, is a STATIC source
 *  pin — it never opens a browser, so it cannot see the two things that actually go wrong here.
 *
 *  Both assertions come from rules the product states about ITSELF:
 *
 *  1. ESCAPE CANCELS, AND THE BLUR IT CAUSES MUST NOT SAVE. Sidebar.tsx: "blur saves, Escape
 *     cancels and restores. `cancelledRef` is what makes Escape survive the blur that follows it —
 *     [otherwise the blur would save] the very text Escape was meant to discard." That is a race
 *     between two handlers on one element; a static pin cannot execute it, and getting it wrong
 *     silently saves a title the user explicitly abandoned.
 *  2. A RENAME MUST NOT REORDER THE SIDEBAR. store.tsx deliberately does not bump `ts` on rename:
 *     "bumping it would silently reorder the sidebar on a rename." So the ID ORDER is asserted, not
 *     just the set — a rename that quietly floats a chat to the top loses the user's place in a
 *     list they navigate by position.
 */
JOURNEYS['sidebar-rename'] = async (mobile) => withPage({ mobile, signedIn: true, history: THREE_CHATS() }, async (page, bag) => {
  const name = `sidebar-rename:${mobile ? 'mobile375' : 'desktop1440'}`;
  const ORIGINAL = 'فلل جدة';
  const RENAMED = 'شاليهات أبها';
  const ids = (h) => (h || []).map((x) => x.id).join(',');
  const titleOf = (h, id) => ((h || []).find((x) => x.id === id) || {}).title;

  if (!(await ensureSidebar(page, mobile))) { skip(name, 'mobile sidebar drawer would not open'); return; }
  const before = await storedHistory(page);

  // ── ESCAPE MUST CANCEL ───────────────────────────────────────────────────────────────────────
  if (!(await openRowMenu(page, ORIGINAL))) { skip(name, 'row ⋯ menu would not open'); return; }
  if (!(await clickText(page, 'إعادة تسمية'))) { skip(name, `rename action: ${clickReason()}`); return; }
  await sleep(1200);
  const escInput = await renameInputFor(page, ORIGINAL);
  if (!escInput) { skip(name, `no rename input carrying «${ORIGINAL}» appeared`); return; }
  await escInput.fill('اسم مهجور');
  await escInput.press('Escape');
  await sleep(1500);
  const afterEsc = await storedHistory(page);
  if (titleOf(afterEsc, 'h2') !== ORIGINAL) {
    defect(name, 'Escape saved the abandoned title instead of discarding it',
      `«${ORIGINAL}» → «${titleOf(afterEsc, 'h2')}» — the blur that Escape itself triggers committed the draft `
      + `(Sidebar.tsx keeps cancelledRef precisely to stop this)`);
    return;
  }
  pass(name, 'Escape cancelled the rename and the blur it caused saved nothing');

  // ── ENTER MUST COMMIT, TO EXACTLY ONE CHAT, WITHOUT REORDERING ───────────────────────────────
  if (!(await openRowMenu(page, ORIGINAL))) { skip(name, 'row ⋯ menu would not reopen after Escape'); return; }
  if (!(await clickText(page, 'إعادة تسمية'))) { skip(name, `rename action second time: ${clickReason()}`); return; }
  await sleep(1200);
  const input = await renameInputFor(page, ORIGINAL);
  if (!input) { skip(name, 'rename input did not reappear'); return; }
  await input.fill(RENAMED);
  await input.press('Enter');
  await sleep(1800);

  const after = await storedHistory(page);
  if (titleOf(after, 'h2') !== RENAMED) {
    defect(name, 'rename did not take', `h2 title is «${titleOf(after, 'h2')}», expected «${RENAMED}»`);
  } else if (titleOf(after, 'h1') !== titleOf(before, 'h1') || titleOf(after, 'h3') !== titleOf(before, 'h3')) {
    defect(name, 'rename changed a chat it was not applied to',
      `h1 «${titleOf(before, 'h1')}»→«${titleOf(after, 'h1')}», h3 «${titleOf(before, 'h3')}»→«${titleOf(after, 'h3')}»`);
  } else if (ids(after) !== ids(before)) {
    // store.tsx does NOT bump `ts` on rename, for exactly this reason.
    defect(name, 'rename reordered the sidebar', `order [${ids(before)}] → [${ids(after)}] — a rename must not move the row`);
  } else {
    pass(name, `rename applied to exactly h2, order preserved [${ids(after)}]`);
  }

  // ── AND IT MUST REACH DISK ───────────────────────────────────────────────────────────────────
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  const reloaded = await storedHistory(page);
  if (titleOf(reloaded, 'h2') !== RENAMED) {
    defect(name, 'the rename did not survive a refresh',
      `h2 is «${titleOf(reloaded, 'h2')}» after reload, expected «${RENAMED}» — renamed in memory only`);
  } else if (ids(reloaded) !== ids(before)) {
    defect(name, 'the reload reordered the renamed sidebar', `order [${ids(before)}] → [${ids(reloaded)}]`);
  } else {
    pass(name, 'the rename survived a refresh with the order intact');
  }
  if (bag.pageErrors.length) defect(name, 'page error during rename', bag.pageErrors.join(' | '));
});

/** J9–J11 — THE ADVERSARIAL SET (PART 4). A fixed checklist only ever catches bugs someone already
 *  imagined, so these do the things the UI assumes nobody does: repeat an action it treats as
 *  once-only, interrupt a flow halfway, and leave the tab alone long enough for the browser to
 *  suspend it. All three were clean on 2026-08-28; they stay because the next regression in this
 *  class will not announce itself in the checklist journeys either. */

/** J9 — the same saved chat opened twice in quick succession must open it, never fork a copy. */
JOURNEYS['adv-double-open'] = async (mobile) => withPage({ mobile, signedIn: true, history: THREE_CHATS() }, async (page, bag) => {
  const name = `adv-double-open:${mobile ? 'mobile375' : 'desktop1440'}`;
  if (!(await ensureSidebar(page, mobile))) { skip(name, 'mobile sidebar drawer would not open'); return; }
  const before = await storedHistory(page);
  const row = page.getByText('فلل جدة', { exact: true }).first();
  if (!(await row.count())) { skip(name, 'saved chat row not found'); return; }
  await row.click().catch(() => {});
  await sleep(400);
  await page.getByText('فلل جدة', { exact: true }).first().click().catch(() => {});
  await sleep(5000);
  const after = await storedHistory(page);
  if ((after || []).length !== (before || []).length) {
    defect(name, 'repeat open forked the chat', `${(before || []).length} → ${(after || []).length} rows`);
  } else {
    pass(name, `repeat open created no duplicate (${(after || []).length} rows)`);
  }
  if (bag.pageErrors.length) defect(name, 'page error on repeat open', bag.pageErrors.join(' | '));
});

/** J10 — New Chat pressed WHILE a restore is still landing must produce a genuinely blank chat,
 *  not a half-restored one. This is PART 5 shape 1 attacked at its race rather than its happy path. */
JOURNEYS['adv-newchat-mid-restore'] = async (mobile) => withPage({ mobile, signedIn: true, history: THREE_CHATS() }, async (page, bag) => {
  const name = `adv-newchat-mid-restore:${mobile ? 'mobile375' : 'desktop1440'}`;
  if (!(await ensureSidebar(page, mobile))) { skip(name, 'mobile sidebar drawer would not open'); return; }
  if (!(await clickText(page, 'فلل جدة'))) { skip(name, 'saved chat row not found'); return; }
  await sleep(700);                                   // interrupt mid-restore, deliberately
  if (!(await ensureSidebar(page, mobile))) { skip(name, 'sidebar closed after open'); return; }
  if (!(await clickText(page, 'محادثة جديدة'))) { skip(name, 'New Chat not found'); return; }
  await sleep(5000);
  const t = await bodyText(page);
  const ta = page.locator('textarea').first();
  const composer = (await ta.count()) ? await ta.inputValue() : '';
  const leaked = t.includes('أبحث عن') && ['جدة', 'الرياض', 'الخبر'].some((c) => t.includes(c));
  if (leaked) defect(name, 'interrupted restore leaked into the new chat', 'a restored search bubble is on the blank chat');
  else if (composer.trim()) defect(name, 'New Chat inherited composer text', `holds «${composer}»`);
  else pass(name, 'New Chat is blank even when it interrupts a restore');
  if (bag.pageErrors.length) defect(name, 'page error on interrupted restore', bag.pageErrors.join(' | '));
});

/** J11 — a backgrounded tab suspends rAF. React Native Web drives Animated off rAF, so anything
 *  gated on an animation callback simply never completes — the exact shape of the real production
 *  bug in PR #341 (pressing «بحث» did nothing with rAF frozen). Background it for real, come back,
 *  and require a working screen. PART 9.2 (3): this is a product risk, not only a harness artifact. */
JOURNEYS['adv-background-tab'] = async (mobile) => withPage({ mobile, signedIn: true, history: THREE_CHATS() }, async (page, bag, ctx) => {
  const name = `adv-background-tab:${mobile ? 'mobile375' : 'desktop1440'}`;
  const other = await ctx.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await sleep(45_000);
  await page.bringToFront();
  await sleep(3500);
  const t = await bodyText(page);
  if (t.length < 200) defect(name, 'backgrounded tab came back blank', `body is ${t.length} chars`);
  else if (!t.includes('بحث')) defect(name, 'controls missing after backgrounding', 'no «بحث» on return');
  else pass(name, `survived 45s backgrounded (${t.length} chars, controls present)`);
  if (bag.pageErrors.length) defect(name, 'page error after backgrounding', bag.pageErrors.join(' | '));
  await other.close().catch(() => {});
});

/** J16 — PART 1's Favorites clause IN FULL: "add, remove, and the favorited state surviving
 *  NAVIGATION and refresh." `sidebar-row-actions` proves add, remove, and the refresh half. The
 *  navigation half had no committed journey — it was covered once, on 2026-08-30, by an ad-hoc
 *  script that was never committed and died with its container, leaving a ledger row asserting
 *  coverage that nothing could reproduce (see verify-journey-ledger-reachable.ts).
 *
 *  REFRESH AND NAVIGATION FAIL DIFFERENTLY, which is why one does not stand in for the other. A
 *  refresh re-reads localStorage from scratch, so it proves the write REACHED DISK. Navigation
 *  keeps the same JS context alive and re-mounts the sidebar against the in-memory store, so it
 *  proves the star survives a REMOUNT — a star written to disk but dropped from context state comes
 *  back on reload and vanishes on navigation, and only this half sees that.
 *
 *  The trip is the real mode toggle (تصفية ↔ الوكيل الذكي), both halves of which router.replace()
 *  by owner rule (index.tsx, defect fix 2026-08-23) — so this journey also walks the exact path
 *  J17 asserts costs no history. */
JOURNEYS['adv-favorite-survives-navigation'] = async (mobile) => withPage({ mobile, signedIn: true, history: THREE_CHATS() }, async (page, bag) => {
  const name = `adv-favorite-survives-navigation:${mobile ? 'mobile375' : 'desktop1440'}`;
  const starredIds = async () => ((await storedHistory(page)) || [])
    .filter((x) => x.starred || x.favorite || x.pinned).map((x) => x.id).join(',');

  if (!(await ensureSidebar(page, mobile))) { skip(name, 'mobile sidebar drawer would not open'); return; }
  if (!(await openRowMenu(page, 'فلل جدة'))) { skip(name, 'row ⋯ menu would not open'); return; }
  if (!(await clickText(page, 'أضف إلى المفضلة'))) { skip(name, 'favourite action not in the menu'); return; }
  await sleep(1800);
  // Whether the star LANDS is sidebar-row-actions' assertion, not this one's. If it did not land
  // there is nothing here to navigate away from, so this skips rather than filing a second, noisier
  // copy of a defect another journey already owns.
  const before = await starredIds();
  if (before !== 'h2') { skip(name, `favourite did not land (flagged [${before}]) — sidebar-row-actions owns that assertion`); return; }

  // At 375px the drawer covers the ModeSwitch (panel w=307.5 of 375, «الوكيل الذكي» at x=217), so
  // the tap would be intercepted. Close it the way a person does — the exposed backdrop strip.
  if (mobile && !(await closeMobileSidebar(page))) { skip(name, 'mobile drawer would not close'); return; }
  if (!(await clickText(page, 'الوكيل الذكي'))) { skip(name, `mode switch to agent: ${clickReason()}`); return; }
  await sleep(3500);
  if (!(await clickText(page, 'تصفية'))) { skip(name, `mode switch back to filter: ${clickReason()}`); return; }
  await sleep(3500);

  const after = await starredIds();
  if (after !== before) {
    defect(name, 'the favourite did not survive navigation',
      `starred [${before}] before the تصفية↔الوكيل الذكي round trip, [${after}] after — the star was dropped by a screen change, not by a refresh`);
    return;
  }
  pass(name, `favourite survived a mode-switch round trip (still [${after}])`);

  // ON DISK IS NOT ON SCREEN. A star the store still holds but the remounted sidebar no longer
  // renders is the same bug to the user, so the row is required back in المفضلة visually too.
  if (!(await ensureSidebar(page, mobile))) { skip(name, 'sidebar would not reopen after navigation'); return; }
  const starHeader = await page.getByText('المفضلة', { exact: true }).count();
  const row = await page.getByText('فلل جدة', { exact: true }).count();
  if (!row) defect(name, 'the favourited chat vanished from the sidebar after navigation', '«فلل جدة» is not rendered at all');
  else if (!starHeader) defect(name, 'the favourited chat is no longer in المفضلة after navigation', 'the row is present but the Starred bucket is gone');
  else pass(name, 'the row is still rendered under المفضلة after navigation');
  if (bag.pageErrors.length) defect(name, 'page error during the favourite navigation trip', bag.pageErrors.join(' | '));
});

/** J17 — THE MODE TOGGLE COSTS NO HISTORY, from the user's side (PART 5 shape 9).
 *
 *  Owner rule (src/app/index.tsx, defect fix 2026-08-23): the Filter/Agent pill is a MODE TOGGLE
 *  between two peer screens, so BOTH halves router.replace(). Pushing on the way out while
 *  replacing on the way back left the pushed /agent slot holding a duplicate '/', so every round
 *  trip added a junk history entry and leaked another mounted Filter screen — "the Back button then
 *  just re-showed the same page N times before leaving the site."
 *
 *  TWO BARRIERS ALREADY TOUCH THIS RULE, AND NEITHER EXECUTES IT AT 375px (PART 5: check for an
 *  existing barrier before adding one, and a journey barrier is "a real-browser barrier, never a
 *  unit test standing in for the click"):
 *    · scripts/verify-mode-switch-costs-no-history.ts — a STATIC source pin (readFileSync only, no
 *      browser): it proves both halves still SAY router.replace. It cannot see what a real Back
 *      does, and it would stay green if the toggle broke anywhere between the source and the user.
 *    · routine #4's live sweep watch `tab-switch-no-junk-history` — a real browser, but desktop
 *      only (`withPage(false, …)`) and oracled on history.length.
 *  This is the third leg: the SYMPTOM half that is mine (PART 2 — I test what the user feels,
 *  #4/#7 test the mechanism), that ONE Back after three round trips actually leaves instead of
 *  re-showing the same screen, driven on production at BOTH viewports.
 *
 *  The oracle is history GROWTH plus where a single Back lands, never `about:blank` on its own: a
 *  fresh Playwright context starts there, so leaving the app origin is CORRECT and is reported as
 *  leaving, never as stranding (the trap J7 was rewritten for). */
JOURNEYS['adv-modeswitch-back-push-vs-replace'] = async (mobile) => withPage({ mobile }, async (page, bag) => {
  const name = `adv-modeswitch-back-push-vs-replace:${mobile ? 'mobile375' : 'desktop1440'}`;
  const depth = () => page.evaluate(() => history.length);
  const h0 = await depth();

  const ROUND_TRIPS = 3;
  for (let i = 0; i < ROUND_TRIPS; i++) {
    if (!(await clickText(page, 'الوكيل الذكي'))) { skip(name, `mode switch to agent on trip ${i + 1}: ${clickReason()}`); return; }
    await sleep(2600);
    if (!(await clickText(page, 'تصفية'))) { skip(name, `mode switch back to filter on trip ${i + 1}: ${clickReason()}`); return; }
    await sleep(2600);
  }
  const h1 = await depth();
  // Both halves replace, so N round trips must cost nothing. One entry of slack absorbs the app's
  // own param-rewriting on the first mount; three round trips costing three entries cannot.
  if (h1 - h0 > 1) {
    defect(name, 'the mode toggle pushes junk history',
      `${ROUND_TRIPS} تصفية↔الوكيل الذكي round trips added ${h1 - h0} history entries (owner rule: both halves router.replace, so this must be 0)`);
  } else {
    pass(name, `${ROUND_TRIPS} round trips added ${h1 - h0} history entries`);
  }

  // Only ONE Filter form may be mounted — the leak half of the same 2026-08-23 defect.
  const forms = await page.locator('[data-testid="city-input"]').count();
  if (forms > 1) defect(name, 'the mode toggle leaks mounted screens', `${forms} Filter forms mounted at once after ${ROUND_TRIPS} round trips`);
  else pass(name, `exactly ${forms} Filter form mounted after ${ROUND_TRIPS} round trips`);

  // THE SYMPTOM: one Back must not re-show the app for a fourth time.
  await page.goBack({ waitUntil: 'load' }).catch(() => {});
  await sleep(2500);
  const url = page.url();
  if (!url.startsWith(BASE)) {
    pass(name, `one Back left the site (${url}) — the toggle left nothing to unwind`);
  } else {
    // Still on the app: legitimate ONLY if the toggle cost no history (h1-h0 <= 1), in which case
    // this is the app's own single entry unwinding. If it pushed, this is the reported symptom.
    await settle(page);
    const text = await bodyText(page);
    if (h1 - h0 > 1) {
      defect(name, 'Back re-shows the same screen instead of leaving',
        `after ${ROUND_TRIPS} round trips one Back is still on ${url} with ${h1 - h0} entries left to unwind`);
    } else if (text.length < 200) {
      defect(name, 'Back stranded the user', `body is ${text.length} chars at ${url}`);
    } else {
      pass(name, `one Back landed on a usable in-app screen (${url})`);
    }
  }
  if (bag.pageErrors.length) defect(name, 'page error during the mode-switch round trips', bag.pageErrors.join(' | '));
});

// ── appearance: the auth gate, in a REAL browser ────────────────────────────────────────────────
// scripts/verify-appearance-lifecycle.ts already owns this rule, but it executes the pure resolver
// and STRING-PINS the provider/boot wiring. PART 5 is explicit that a barrier for a journey bug is
// a real-browser barrier, "never a unit test standing in for the click" — and the two layers that
// actually decide what a returning visitor SEES (the pre-hydration boot script in +html.tsx and
// the post-mount provider effect in theme.tsx) are precisely the halves a string-pin cannot run.
// These two journeys close that gap against production.
const THEME_KEY = 'appearance';
const themeState = (page) => page.evaluate((k) => ({
  attr: document.documentElement.getAttribute('data-theme'),
  stored: (() => { try { return localStorage.getItem(k); } catch { return 'ERR'; } })(),
}), THEME_KEY);

/** J14 — THE LEAK RULE, EXECUTED. A guest carrying a stored `appearance: 'dark'` — a user who chose
 *  Dark before the 2026-08-28 auth-gating landed and never signed in, or any other route to a stale
 *  key — must see a LIGHT app (owner 2026-08-28: appearance is an authenticated-user asset).
 *
 *  Both layers are asserted, because either one alone can be wrong in a way the other hides: the
 *  boot script decides the FIRST paint (a wrong answer here is a visible dark flash even if the
 *  provider corrects it), and the provider's effect decides every frame after auth settles (a wrong
 *  answer here is a permanently dark logged-out app). The key is seeded and the page RELOADED, so
 *  the boot script sees it exactly as it would for a returning visitor. */
JOURNEYS['appearance-guest-light'] = async (mobile) => withPage({ mobile }, async (page, bag) => {
  const name = `appearance-guest-light:${mobile ? 'mobile375' : 'desktop1440'}`;
  await page.evaluate((k) => localStorage.setItem(k, 'dark'), THEME_KEY);
  await page.reload({ waitUntil: 'load' });
  const boot = await themeState(page);              // first paint, before the provider can correct
  await settle(page);
  await sleep(2500);                                // let auth settle and the provider effect run
  const after = await themeState(page);
  if (boot.attr !== 'light') {
    defect(name, 'a guest gets a DARK first paint', `boot data-theme=${boot.attr} with stored «${boot.stored}» — the +html.tsx boot script should pin light for a visitor with no sb-*-auth-token`);
  } else if (after.attr !== 'light') {
    defect(name, 'the provider darkens a logged-out app', `data-theme went ${boot.attr} → ${after.attr} after auth settled`);
  } else {
    pass(name, `guest stayed light at both layers with stored «${after.stored}»`);
  }
  if (bag.pageErrors.length) defect(name, 'page error on the guest appearance path', bag.pageErrors.join(' | '));
});

/** J15 — إلغاء MUST NOT TOUCH THE THEME. The owner rule (theme.tsx, 2026-08-28) is that only a
 *  COMPLETED sign-out or a server-confirmed deletion resets appearance — "merely OPENING a
 *  confirmation popup — or cancelling it — never touches the theme."
 *
 *  The failure this guards is a one-line mistake with a loud symptom: wire resetThemeForSignOut()
 *  to the dialog opening (or to onClose, which Cancel shares) and a signed-in dark user who opens
 *  «تسجيل الخروج», thinks better of it and taps إلغاء is dumped into a light app with their stored
 *  preference erased — still signed in, having changed nothing. Dark is set through the REAL
 *  control here, not by writing localStorage, so the journey also proves the appearance pane works. */
JOURNEYS['appearance-cancel-keeps-dark'] = async (mobile) => withPage({ mobile, signedIn: true }, async (page, bag) => {
  const name = `appearance-cancel-keeps-dark:${mobile ? 'mobile375' : 'desktop1440'}`;
  const openMenu = async () => {
    if (!(await ensureSidebar(page, mobile))) return false;
    const trig = page.locator('[data-testid="account-menu-trigger"]');
    if (!(await trig.count())) return false;
    await trig.first().click({ timeout: 15_000 }).catch(() => {});
    await sleep(1200);
    return (await page.locator('[data-testid="account-menu"]').count()) > 0;
  };
  const tap = async (tid) => {
    const l = page.locator(`[data-testid="${tid}"]`);
    if (!(await l.count())) return false;
    try { await l.first().click({ timeout: 15_000 }); return true; } catch { return false; }
  };

  if (!(await openMenu())) { skip(name, 'account menu would not open'); return; }
  if (!(await tap('account-menu-appearance'))) { skip(name, 'appearance row not in the menu'); return; }
  await sleep(900);
  if (!(await tap('appearance-dark'))) { skip(name, 'dark option not in the appearance pane'); return; }
  await sleep(1800);
  const dark = await themeState(page);
  if (dark.attr !== 'dark' || dark.stored !== 'dark') {
    defect(name, 'choosing Dark did not take effect', `data-theme=${dark.attr}, stored=«${dark.stored}» — expected both dark`);
    return;                                          // nothing left to cancel-test meaningfully
  }
  pass(name, 'the appearance control applied and persisted Dark');

  // Back to the menu ROOT, then into the sign-out confirmation. The menu is a stack, not a set of
  // independent popups: after choosing Dark it is still showing the appearance pane, where
  // «تسجيل الخروج» does not exist. Re-tapping the trigger does not help either — it reopens on the
  // same pane. Walking back the way a person would (account-menu-back) is both the honest journey
  // and the one that works; guessing at a reopen skipped this journey 4/4 on its first outing.
  if (!(await tap('account-menu-back'))) { skip(name, 'back affordance not in the appearance pane'); return; }
  await sleep(900);
  if (!(await tap('account-menu-signout'))) { skip(name, 'sign-out row not in the menu root'); return; }
  await sleep(900);
  const opened = await themeState(page);
  if (opened.attr !== 'dark' || opened.stored !== 'dark') {
    defect(name, 'merely OPENING the sign-out popup reset the theme', `data-theme=${opened.attr}, stored=«${opened.stored}» — the owner rule resets only on a COMPLETED sign-out`);
  }
  if (!(await tap('logout-popup-cancel'))) { skip(name, 'إلغاء not found on the sign-out popup'); return; }
  await sleep(2000);
  const cancelled = await themeState(page);
  if (cancelled.attr !== 'dark') {
    defect(name, 'إلغاء dumped a still-signed-in user into a light app', `data-theme=${cancelled.attr} after cancel (was dark)`);
  } else if (cancelled.stored !== 'dark') {
    defect(name, 'إلغاء erased the stored appearance', `stored=«${cancelled.stored}» after cancel — the preference must survive a cancelled sign-out`);
  } else {
    pass(name, 'إلغاء left both the theme and the stored preference untouched');
  }
  if (bag.pageErrors.length) defect(name, 'page error on the cancel path', bag.pageErrors.join(' | '));
});

/** J19 — SIGN-OUT LEAVES NO TRACE OF THE PREVIOUS USER (PART 3 item 1; PART 5 shapes 1, 7 and 8).
 *
 *  WHY THIS EXISTS. PART 3 item 1 mandates that "sign-in, sign-out, and account deletion each leave
 *  the UI consistent with what actually happened server-side", and until this journey the COMPLETED
 *  sign-out path had zero real-browser coverage: `appearance-cancel-keeps-dark` deliberately taps
 *  «إلغاء» and never confirms, so every assertion in this file stopped at the popup. The one place a
 *  stale-state leak would be worst — a freshly logged-out guest looking at the previous account's
 *  chat titles — was the one place nothing looked.
 *
 *  THE CONTRACT, BOTH DIRECTIONS. store.tsx's signOut() is explicit that the two buckets are treated
 *  OPPOSITELY, and asserting only one half would let a future "cleanup" silently break the other:
 *    · the per-user key (`history:<sub>`) is KEPT on purpose — "a later re-login restores it";
 *    · the GUEST bucket and the LEGACY shared key are WIPED synchronously, so the freshly logged-out
 *      guest cannot inherit the prior signed-in user's chats.
 *  So this journey fails both if a chat leaks into the guest view AND if the re-login restore data
 *  is destroyed. A barrier that only checked for leakage would score a total wipe as a pass.
 *
 *  WHY THE DOUBLE TAP. onLogout() guards itself with `loggingOut` and then defers the real work by
 *  1200 ms (`setTimeout(() => { signOut(); router.replace('/'); })`). That is exactly PART 5 shape 7
 *  with a wide-open window: a second tap during the beat must not queue a second signOut/replace.
 *
 *  WHY THE RELOAD. setHistory([]) clears MEMORY; the guest-bucket removal is what has to hold across
 *  a reload. Judging the leak before a reload would pass on an in-memory-only clear (PART 5 shape 8),
 *  which is the same class as the sidebar journeys' post-reload re-checks above.
 *
 *  NOT A DUPLICATE of `scripts/verify-account-deletion.ts`. That barrier asserts this same wipe by
 *  REGEX-MATCHING store.tsx's source text for the literal `removeKeysSync([...historyKey('guest')])`
 *  — it proves the line is written, never that the browser ends up without the chats. Renaming the
 *  key, reordering the call after an early return, or an exception thrown before it all keep that
 *  check green. This is the real-browser half PART 5 asks for. */
JOURNEYS['signout-leaves-no-trace'] = async (mobile) => withPage({ mobile, signedIn: true, history: THREE_CHATS() }, async (page, bag) => {
  const name = `signout-leaves-no-trace:${mobile ? 'mobile375' : 'desktop1440'}`;
  const TITLES = ['عقارات الرياض', 'فلل جدة', 'شقق الخبر'];
  // Raw, per-key reads. storedHistory() only ever looks at `history:<SUB>`, and this journey's whole
  // point is the RELATIONSHIP between three different keys — plus the difference between a key that
  // is ABSENT and one that holds an empty array, which a JSON.parse fallback of `[]` would erase.
  const rawKeys = () => page.evaluate((sub) => ({
    mine: localStorage.getItem('history:' + sub),
    guest: localStorage.getItem('history:guest'),
    legacy: localStorage.getItem('history'),
  }), SUB);
  const countOf = (raw) => { try { return raw === null ? null : JSON.parse(raw).length; } catch { return 'unparseable'; } };
  const tap = async (tid) => {
    const l = page.locator(`[data-testid="${tid}"]`);
    if (!(await l.count())) return false;
    try { await l.first().click({ timeout: 15_000 }); return true; } catch { return false; }
  };
  // `guestOk` matters ONLY on the post-sign-out call, and it is the difference between this journey
  // testing something and testing nothing on mobile: openMobileSidebar()'s default open-oracle is
  // `sidebar-search-btn`, which Sidebar.tsx renders only inside its `user ? (…)` branch — so once we
  // are logged out it can never report the drawer open, and every mobile assertion below would skip
  // forever while looking like coverage. See the harness note on GUEST_SIDEBAR_CTA.
  const signedInChromePresent = async ({ guestOk = false } = {}) => {
    const opened = mobile ? await openMobileSidebar(page, { guestOk }) : true;
    if (!opened) return null;                                // null = could not look, ≠ absent
    return (await page.locator('[data-testid="account-menu-trigger"]').count()) > 0;
  };

  // ── precondition: we really are signed in, with the three seeded chats on screen ───────────────
  if ((await signedInChromePresent()) !== true) { skip(name, 'seeded session did not render signed-in chrome'); return; }
  const seeded = await rawKeys();
  if (countOf(seeded.mine) !== 3) { skip(name, `seeded history did not land (history:${SUB} = ${countOf(seeded.mine)})`); return; }
  const bodyBefore = await bodyText(page);
  const shownBefore = TITLES.filter((t) => bodyBefore.includes(t));
  if (!shownBefore.length) { skip(name, 'no seeded chat title rendered in the sidebar to begin with'); return; }
  pass(name, `signed in with ${shownBefore.length}/3 seeded chat titles on screen`);

  // ── sign out, and hammer the confirm the way an impatient person does ─────────────────────────
  const trig = page.locator('[data-testid="account-menu-trigger"]');
  await trig.first().click({ timeout: 15_000 }).catch(() => {});
  await sleep(1200);
  if (!(await page.locator('[data-testid="account-menu"]').count())) { skip(name, 'account menu would not open'); return; }
  if (!(await tap('account-menu-signout'))) { skip(name, 'sign-out row not in the menu root'); return; }
  await sleep(900);
  if (!(await page.locator('[data-testid="logout-popup"]').count())) { skip(name, 'sign-out confirmation did not open'); return; }
  if (!(await tap('account-menu-signout-confirm'))) { skip(name, 'confirm button not on the sign-out popup'); return; }
  // Second tap INSIDE the 1200 ms beat — the `loggingOut` guard is what must absorb it. A real
  // Locator click, not a dispatched event (PART 9.2 (4)); it is allowed to miss if the popup has
  // already gone, which is itself fine — what must not happen is a second signOut/replace landing.
  await tap('account-menu-signout-confirm');
  await sleep(4000);

  // ── the UI must agree that we are logged out ──────────────────────────────────────────────────
  const chromeAfter = await signedInChromePresent({ guestOk: true });
  if (chromeAfter === null) skip(`${name}/chrome`, 'sidebar would not open to check post-sign-out chrome');
  else if (chromeAfter) defect(name, 'still signed in after confirming sign-out', 'account-menu-trigger is still rendered — the sidebar is showing signed-in chrome to a signed-out visitor');
  else pass(name, 'signed-in chrome is gone after sign-out');

  // ── and no chat of the previous account may be on screen ──────────────────────────────────────
  // Only judgeable if the sidebar is actually on screen: on mobile a closed drawer would show no
  // chat titles for a reason that has nothing to do with the leak, i.e. a free pass.
  if (chromeAfter === null) {
    skip(`${name}/leak`, 'sidebar would not open — cannot judge the on-screen leak');
  } else {
    const bodyAfter = await bodyText(page);
    const leaked = TITLES.filter((t) => bodyAfter.includes(t));
    if (leaked.length) defect(name, "previous account's chats are visible to the logged-out guest", `still on screen: ${leaked.join(' · ')}`);
    else pass(name, 'no previous-account chat title is on screen');
  }

  // ── storage, both directions, AFTER a reload (memory-only clears must not pass) ────────────────
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  const after = await rawKeys();
  const guestN = countOf(after.guest);
  const legacyN = countOf(after.legacy);
  if (guestN) defect(name, 'the guest bucket inherited the previous account\'s chats', `history:guest holds ${guestN} entr${guestN === 1 ? 'y' : 'ies'} after sign-out + reload — signOut() wipes this key precisely so a guest cannot see them`);
  else pass(name, `guest bucket clean after reload (history:guest = ${after.guest === null ? 'absent' : `${guestN} entries`})`);
  if (legacyN) defect(name, 'the legacy shared history key survived sign-out', `history holds ${legacyN} — signOut() purges it so it cannot leak across accounts`);

  // The OTHER direction: destroying this is a different bug with the same green test if unasserted.
  if (countOf(after.mine) !== 3) {
    defect(name, 'sign-out destroyed the account\'s own saved history', `history:${SUB} = ${after.mine === null ? 'absent' : countOf(after.mine)} after sign-out, expected 3 — store.tsx keeps it on purpose so a later re-login restores it`);
  } else pass(name, 'the account\'s own saved history survived for re-login restore');

  // On mobile the sidebar is an UNMOUNTED drawer, so reading body text without reopening it would
  // find no chat titles for the trivial reason that no sidebar is on screen — a guaranteed pass that
  // proves nothing. Reopen (as a guest) before judging, and skip rather than pass if it will not.
  const reopened = mobile ? await openMobileSidebar(page, { guestOk: true }) : true;
  if (!reopened) {
    skip(`${name}/reload-leak`, 'drawer would not reopen after reload — cannot judge the on-screen leak');
  } else {
    const bodyReloaded = await bodyText(page);
    const leaked2 = TITLES.filter((t) => bodyReloaded.includes(t));
    if (leaked2.length) defect(name, "previous account's chats came back after a reload", `on screen after reload: ${leaked2.join(' · ')}`);
    else pass(name, 'still no previous-account chat title after a reload');
  }

  if (bag.pageErrors.length) defect(name, 'page error on the sign-out path', bag.pageErrors.join(' | '));
});

/** J20 — GOOGLE ONE TAP MUST NOT SIT ON TOP OF THE APP'S OWN CONTROLS (PART 5 shapes 6 and 11).
 *
 *  THE BUG THIS BARRIERS (measured live 2026-09-01, production, 3/3 fresh contexts). One Tap's
 *  LEGACY prompt — GIS's path whenever FedCM is unavailable or fails, which is every iOS Safari
 *  visitor — renders on a phone as a bottom sheet: `#credential_picker_iframe`, `position: fixed`,
 *  `z-index: 9999`, `pointer-events: auto`, across the bottom 144 px. The app laid its own content
 *  out underneath it, so for a logged-out visitor on a phone «بحث» (y 583–602 in a 664 px viewport,
 *  at MAXIMUM scroll — it could not be scrolled clear) and the Agent composer (y 553–575) were both
 *  hit-tested to Google's iframe. Real taps went to the iframe; `cancel_on_tap_outside: false` meant
 *  tapping did not even dismiss it, so both controls stayed dead until the visitor found the ✕.
 *
 *  WHY IT NEEDED A JOURNEY AND NOT ONLY A UNIT TEST. The geometry is proven offline in
 *  `scripts/verify-bottom-prompt-inset.ts`; only a real browser can prove that the element the
 *  BROWSER hands the tap to is the control. So the oracle here is `elementFromPoint` at the
 *  control's own centre, plus a real click — never a coordinate, never a dispatched event (PART
 *  9.2 (4)).
 *
 *  WHY IT IS A GUEST CONTEXT. harness.mjs blocks GIS for SEEDED-signed-in contexts only, because a
 *  fake token makes the app correctly prompt a "signed-out" visitor who is not real. Guests are
 *  left untouched on purpose — "blocking it everywhere would hide the real thing", and this is
 *  precisely the real thing it would have hidden.
 *
 *  NO PROMPT ⇒ SKIP, NEVER PASS. Google suppresses One Tap for its own reasons (cooldown, no
 *  Google session, FedCM taking over, egress blocked). A run that never saw the sheet has not
 *  proved the app clears it, and recording that as a pass is how this barrier would go dark. */
JOURNEYS['onetap-clear-of-controls'] = async (mobile) => {
  const name = `onetap-clear-of-controls:${mobile ? 'mobile375' : 'desktop1440'}`;

  // Wait for the sheet to ARRIVE and finish GROWING: it is inserted ~1.3s after load at height 0 and
  // animates up to 144px. Measuring once at load reads 0 and would judge a covered control clear.
  const waitForSheet = async (page) => {
    for (let i = 0; i < 40; i++) {
      const r = await page.evaluate(() => {
        const f = document.querySelector('#credential_picker_iframe');
        if (!f) return null;
        const q = f.getBoundingClientRect();
        return q.height > 0 ? { top: Math.round(q.top), bottom: Math.round(q.bottom), h: Math.round(q.height) } : null;
      });
      if (r) return r;
      await sleep(500);
    }
    return null;
  };

  // What does the BROWSER hand a tap at this control's centre to? The control, or the iframe?
  //
  // The sheet's rect is re-read HERE, in the same evaluate as the control — never reused from
  // waitForSheet(). That earlier reading is the FIRST non-zero one, taken mid-slide-in, and it goes
  // stale as Google finishes animating: reporting it alongside a later control position produced the
  // self-contradictory pass line «(587-606) is clear of the prompt (558-812)». The verdict was always
  // sound (elementFromPoint + a real click decide it), but a message whose numbers disagree with its
  // own conclusion is how a future reader talks themselves out of a real finding.
  const winnerAt = (page, sel) => page.evaluate((s) => {
    const el = s === 'cta'
      ? [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === 'بحث')
      : document.querySelector('textarea');
    const f = document.querySelector('#credential_picker_iframe');
    const q = f && f.getBoundingClientRect();
    const sheetNow = q && q.height > 0 ? `${Math.round(q.top)}-${Math.round(q.bottom)}` : 'gone';
    if (!el) return { missing: true, sheetNow };
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), sheetNow,
             winner: t ? `${t.tagName}${t.id ? '#' + t.id : ''}` : null,
             isSelf: !!t && (t === el || t.contains(el) || el.contains(t)) };
  }, sel);

  await withPage({ mobile }, async (page, bag) => {
    const sheet = await waitForSheet(page);
    if (!sheet) { skip(name, 'Google never showed the One Tap prompt this run — nothing to clear'); return; }
    // Desktop renders the prompt in a corner, not docked to the bottom; there is nothing to reserve.
    if (sheet.bottom < 660 && !mobile) { pass(name, `desktop prompt is not bottom-docked (${sheet.top}-${sheet.bottom})`); return; }

    // Scroll the filter form as far as a person can — the worst case, where «بحث» comes to rest.
    await page.evaluate(() => {
      const cta = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === 'بحث');
      let p = cta?.parentElement, sc = null;
      while (p) { if (p.scrollHeight > p.clientHeight + 4) { sc = p; break; } p = p.parentElement; }
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
    await sleep(1200);

    const cta = await winnerAt(page, 'cta');
    if (cta.missing) { skip(name, '«بحث» not rendered'); return; }
    if (!cta.isSelf) {
      defect(name, 'the One Tap prompt is covering «بحث»',
        `sheet now ${cta.sheetNow}; «بحث» ${cta.top}-${cta.bottom}; a tap at its centre goes to ${cta.winner}`);
    } else {
      // Not just the hit test — a REAL click must land (PART 9.2 (4)).
      let err = null;
      await page.getByText('بحث', { exact: true }).first().click({ timeout: 10_000 })
        .catch((e) => { err = String(e).split('\n')[0]; });
      if (err) defect(name, '«بحث» hit-tests clear but a real click still does not land', err);
      else pass(name, `«بحث» (${cta.top}-${cta.bottom}) is clear of the prompt (now ${cta.sheetNow}) and clickable`);
    }
    if (bag.pageErrors.length) defect(name, 'page error while the prompt was up', bag.pageErrors.join(' | '));
  });

  // The same class on the OTHER busy screen: the Agent composer is bottom-anchored, so padding the
  // scroll form would not have saved it — which is why the inset is applied at the app ROOT.
  // Reached by TAPPING the pill, the way a person gets there — not by deep-linking to /agent, which
  // renders no composer for a guest and made this half skip on its own downstream symptom.
  await withPage({ mobile }, async (page) => {
    if (!(await clickText(page, 'الوكيل الذكي'))) { skip(`${name}/composer`, `agent tab: ${clickReason()}`); return; }
    await sleep(3500);
    const sheet = await waitForSheet(page);
    if (!sheet) { skip(`${name}/composer`, 'Google never showed the One Tap prompt this run'); return; }
    if (sheet.bottom < 660 && !mobile) { pass(`${name}/composer`, 'desktop prompt is not bottom-docked'); return; }
    const comp = await winnerAt(page, 'composer');
    if (comp.missing) { skip(`${name}/composer`, 'no composer on this screen'); return; }
    if (!comp.isSelf) {
      defect(`${name}/composer`, 'the One Tap prompt is covering the AI Agent composer',
        `sheet now ${comp.sheetNow}; composer ${comp.top}-${comp.bottom}; a tap at its centre goes to ${comp.winner}`);
    } else {
      pass(`${name}/composer`, `composer (${comp.top}-${comp.bottom}) is clear of the prompt (now ${comp.sheetNow})`);
    }
  });
};

// ── «تواصل مع الدعم»: shared plumbing ───────────────────────────────────────────────────────────
// The form landed 2026-09-02 inside InfoModal's dialog and had never been driven by a journey.
const SUP = {
  link: 'المساعدة/تواصل معنا',
  subject: 'وش موضوع رسالتك؟',
  message: 'اكتب لنا التفاصيل.',
  email: 'name@example.com',
  send: 'إرسال',
  retry: 'حاول مرة أخرى',
  connErr: 'تأكد من الاتصال',
  waitErr: 'انتظر ساعة تقريباً',
};
const DRAFT = {
  subject: 'مشكلة في البحث',
  message: 'البحث عن شقق في الرياض ما يعطيني نتائج صحيحة، جربت أكثر من مرة والنتيجة نفسها.',
  email: 'someone@example.com',
};

/** Open «تواصل مع الدعم» the way a person does: sidebar → the Support row → the dialog's form. */
const openSupport = async (page, mobile) => {
  // Signed-OUT journeys: the drawer's open-oracle must accept the guest branch's own marker.
  if (!(await ensureSidebar(page, mobile, { guestOk: true }))) return 'the mobile drawer would not open';
  const link = page.getByText(SUP.link, { exact: true }).first();
  if (!(await link.count())) return `«${SUP.link}» is not in the sidebar`;
  try { await link.click({ timeout: 15_000 }); } catch (e) { return String(e).split('\n')[0]; }
  await sleep(1500);
  return (await page.getByPlaceholder(SUP.subject).count()) ? null : 'the support dialog opened without the form';
};

const readSupportDraft = async (page) => {
  const val = async (ph) => {
    const l = page.getByPlaceholder(ph).first();
    return (await l.count()) ? await l.inputValue() : null;
  };
  return { subject: await val(SUP.subject), message: await val(SUP.message), email: await val(SUP.email) };
};

/** The dialog animates out, and reopening mid-exit lands the click on a leaving overlay. Wait on the
 *  real condition — the form is gone — not on a bigger timeout (PART 11.2 rule 3). */
const waitSupportClosed = async (page, budget = 8000) => {
  const until = Date.now() + budget;
  while (Date.now() < until) {
    if (!(await page.getByPlaceholder(SUP.subject).count())) { await sleep(500); return true; }
    await sleep(250);
  }
  return false;
};

const fillSupportDraft = async (page) => {
  await page.getByPlaceholder(SUP.subject).first().fill(DRAFT.subject);
  await page.getByPlaceholder(SUP.message).first().fill(DRAFT.message);
  await page.getByPlaceholder(SUP.email).first().fill(DRAFT.email);
  await sleep(400);
};

/** J20 — A TYPED PROBLEM REPORT SURVIVES AN ACCIDENTAL DISMISSAL.
 *
 *  The form's own design note: "losing someone's typed problem report is the one outcome this form
 *  must never produce." That was honoured on the failed-SEND path and nowhere else — the dialog's
 *  backdrop is a full-viewport Pressable that closes on tap, and closing UNMOUNTS the form with all
 *  its local state. Measured 2/2 against production on 2026-09-03: 126 characters typed, one click
 *  at x=12, reopen → every field empty. The X button did the same.
 *
 *  This is the real-browser half of the barrier (PART 5: never a unit test standing in for the
 *  click). `scripts/verify-support-message-contract.ts` executes the cache; this proves the CLICK
 *  a person actually makes no longer destroys their message. */
JOURNEYS['support-draft-survives-dismiss'] = async (mobile) => withPage({ mobile }, async (page, bag) => {
  const name = `support-draft-survives-dismiss:${mobile ? 'mobile375' : 'desktop1440'}`;
  const why = await openSupport(page, mobile);
  if (why) { skip(name, why); return; }
  await fillSupportDraft(page);
  const before = await readSupportDraft(page);
  if (before.message !== DRAFT.message) { skip(name, `the draft would not type (message is ${before.message?.length ?? 'absent'} chars)`); return; }

  // The backdrop: a click just outside the card, the stray tap this exists for. Not a synthetic
  // event — a real mouse click at a coordinate that is deliberately OUTSIDE any control.
  await page.mouse.click(12, mobile ? 400 : 500);
  if (!(await waitSupportClosed(page))) {
    // Not a defect on its own — but then this journey is not testing what it claims to.
    skip(name, 'the backdrop tap did not close the dialog, so the dismissal path was never exercised');
    return;
  }
  const why2 = await openSupport(page, mobile);
  if (why2) { skip(name, `could not reopen after dismissal: ${why2}`); return; }
  const after = await readSupportDraft(page);
  if (after.message !== DRAFT.message || after.subject !== DRAFT.subject) {
    defect(name, 'a backdrop tap destroyed the typed support message',
      `typed ${DRAFT.message.length} chars + subject «${DRAFT.subject}»; after reopening: message=${after.message?.length ?? 'absent'} chars, subject=«${after.subject}»`);
  } else {
    pass(name, `the draft survived a backdrop dismissal (${after.message.length} chars, subject and email intact)`);
  }
  if (after.email !== DRAFT.email) defect(name, 'the reply address was lost on dismissal', `expected «${DRAFT.email}», got «${after.email}»`);

  // And the X, which is the deliberate close — same guarantee, different control. Addressed by
  // testID, NOT by `getByLabel('إغلاق')`: AuthModal raises itself for signed-out visitors with the
  // same accessibility label, so on desktop `.first()` picked ITS × sitting behind this dialog —
  // pointer-blocked, click times out, and the whole × check skipped 2/2 while reading as coverage.
  const x = page.locator('[data-testid="info-modal-close"]').first();
  if (await x.count()) {
    await x.click({ timeout: 10_000 }).catch(() => {});
    if (!(await waitSupportClosed(page))) { skip(`${name}/x`, 'the X did not close the dialog'); return; }
    const why3 = await openSupport(page, mobile);
    if (why3) { skip(`${name}/x`, `could not reopen after the X: ${why3}`); return; }
    const afterX = await readSupportDraft(page);
    if (afterX.message !== DRAFT.message) {
      defect(`${name}/x`, 'closing with the X destroyed the typed support message',
        `after reopening: ${afterX.message?.length ?? 'absent'} chars`);
    } else pass(`${name}/x`, 'the draft also survived the X');
  } else skip(`${name}/x`, 'no close control found on the dialog');

  if (bag.pageErrors.length) defect(name, 'page error on the support-form path', bag.pageErrors.join(' | '));
});

/** J21 — THE ERROR STATE MUST NAME THE RIGHT FAILURE.
 *
 *  `sendSupportMessage` has always distinguished a 429 rate limit from a dead connection; the form
 *  discarded the reason and rendered "check your connection and try again" for both. That sends
 *  someone to fix a network that works, and offers a retry that cannot succeed until the hour rolls
 *  over — PART 5 shape 12, an error state whose recovery path does not work.
 *
 *  THE CLICK IS REAL; ONLY THE SERVER'S ANSWER IS SIMULATED, and deliberately so. Producing a
 *  genuine 429 means posting six real messages into a live support inbox, per run, per viewport —
 *  writing junk into production data to observe a client-side state, which the hard safety rails
 *  forbid. Everything under test here is the app's own code path: a real Playwright click, the real
 *  `sendSupportMessage`, the real state machine, the real copy. */
JOURNEYS['support-error-copy'] = async (mobile) => withPage({ mobile }, async (page, bag) => {
  const name = `support-error-copy:${mobile ? 'mobile375' : 'desktop1440'}`;
  const answers = { status: 429, body: JSON.stringify({ error: 'rate_limited' }) };
  await page.route(/functions\/v1\/support-message/, (route) =>
    route.fulfill({ status: answers.status, contentType: 'application/json', body: answers.body }));

  const why = await openSupport(page, mobile);
  if (why) { skip(name, why); return; }
  await fillSupportDraft(page);

  // The Send control RENAMES ITSELF once a send has failed — `state === 'error' ? t('Try again')`
  // — so a second press must look for «حاول مرة أخرى», not «إرسال». Keying only on «إرسال» made the
  // second press a silent no-op: the form still showed the FIRST failure's copy, and the journey
  // filed «a real failure lost its connection copy» 4/4 against a perfectly correct app. PART 11.2
  // rule 2 in a new costume — a control that is not there is not a control that was pressed.
  const press = async () => {
    for (const label of [SUP.send, SUP.retry]) {
      const btn = page.getByText(label, { exact: true }).first();
      if (!(await btn.count())) continue;
      await btn.click({ timeout: 10_000 }).catch(() => {});
      await sleep(3500);
      return true;
    }
    return false;
  };
  if (!(await press())) { skip(name, `neither «${SUP.send}» nor «${SUP.retry}» is on the form`); return; }

  let body = await bodyText(page);
  if (body.includes(SUP.connErr)) {
    defect(name, 'a rate-limited send is reported as a connection problem',
      'the server answered 429 rate_limited and the form said «تأكد من الاتصال وحاول مرة أخرى» — the network is fine, and the retry it offers cannot succeed for another hour');
  } else if (body.includes(SUP.waitErr)) {
    pass(name, 'a 429 says WAIT, not "check your connection"');
  } else {
    defect(name, 'a failed send produced no error state at all', 'neither the rate-limit nor the connection message rendered after a 429');
  }
  const kept = await readSupportDraft(page);
  if (kept.message !== DRAFT.message) defect(name, 'a failed send ate the draft', `message is ${kept.message?.length ?? 'absent'} chars after the failure`);
  else pass(name, 'the draft is still on screen after the failure');

  // The other direction — a real transport failure must still get the connection copy, or the fix
  // has simply moved the wrong message onto a different case.
  answers.status = 500;
  answers.body = JSON.stringify({ error: 'boom' });
  if (!(await press())) { skip(`${name}/500`, 'the retry control was not on the form after the first failure'); return; }
  body = await bodyText(page);
  if (body.includes(SUP.connErr)) pass(name, 'a genuine server failure still says "check your connection"');
  else defect(name, 'a real failure lost its connection copy', `neither message matched after a 500; body has «${body.slice(0, 120)}»`);

  if (bag.pageErrors.length) defect(name, 'page error on the support error path', bag.pageErrors.join(' | '));
});

// ═══ RUNNER ═════════════════════════════════════════════════════════════════════════════════════
const t0 = Date.now();
console.log(`JOURNEY SWEEP — ${new Date().toISOString()}`);
const engines = ['chromium', 'webkit', 'firefox'].filter(engineAvailable);
console.log(`ENGINES AVAILABLE: ${engines.join(', ')}`);
for (const e of ['webkit', 'firefox']) {
  if (!engineAvailable(e)) note(`COVERAGE LIMIT: ${e} is not installed in this container and PART 11.1 forbids \`playwright install\` — NOT tested this run.`);
}

let ran = 0;
const perJourney = {};
for (const [key, fn] of Object.entries(JOURNEYS)) {
  if (ONLY && key !== ONLY) continue;
  for (const mobile of [false, true]) {
    for (let i = 1; i <= N; i++) {
      const before = findings.length;
      const skipsBefore = skips.length;
      console.log(`\n▶ ${key} [${mobile ? 'mobile' : 'desktop'}] run ${i}/${N}`);
      try { await fn(mobile); } catch (e) { defect(key, 'journey threw', String(e).slice(0, 220)); }
      ran++;
      const k = `${key}:${mobile ? 'mobile' : 'desktop'}`;
      perJourney[k] = perJourney[k] || { runs: 0, failed: 0, skipped: 0 };
      perJourney[k].runs++;
      if (findings.length > before) perJourney[k].failed++;
      else if (skips.length > skipsBefore) perJourney[k].skipped++;
    }
  }
}

console.log(`\n${'═'.repeat(90)}`);
console.log(`JOURNEYS RUN: ${ran} in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`REPRODUCTION RATIOS (failed/runs):`);
for (const [k, v] of Object.entries(perJourney)) console.log(`  ${v.failed}/${v.runs}  ${k}`);
console.log(`SKIPPED (never executed — not a pass): ${skips.length}`);
for (const sk of skips) console.log(`  · [${sk.journey}] ${sk.why}`);
console.log(`DEFECTS: ${findings.length}`);
for (const f of findings) console.log(`  · [${f.journey}] ${f.what}: ${f.detail}`);

// Declare what this runner OWNS before writing a single row. ledgerRecord() refuses any key not in
// this set, so a probe script that never registers cannot mint permanent coverage for itself — see
// harness.mjs's registerJourneys() header for the three orphan rows that made this necessary.
console.log(`LEDGER KEYS OWNED BY THIS RUNNER: ${registerJourneys(Object.keys(JOURNEYS))}`);

// A journey that never executed is recorded as `skip`, never as `pass`.
for (const [k, v] of Object.entries(perJourney)) {
  const verb = v.failed ? 'fail' : v.skipped === v.runs ? 'skip' : 'pass';
  await ledgerRecord(k, verb, `${v.failed}/${v.runs} failed, ${v.skipped} skipped; engines=${engines.join('+')}`);
}
process.exit(findings.length ? 1 : 0);
