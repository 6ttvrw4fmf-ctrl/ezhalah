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
         findings, skips, skip, ledgerRecord, engineAvailable, openMobileSidebar,
         THREE_CHATS, SUB, BASE } from './harness.mjs';

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
const ensureSidebar = async (page, mobile) => (mobile ? openMobileSidebar(page) : true);

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

// A journey that never executed is recorded as `skip`, never as `pass`.
for (const [k, v] of Object.entries(perJourney)) {
  const verb = v.failed ? 'fail' : v.skipped === v.runs ? 'skip' : 'pass';
  await ledgerRecord(k, verb, `${v.failed}/${v.runs} failed, ${v.skipped} skipped; engines=${engines.join('+')}`);
}
process.exit(findings.length ? 1 : 0);
