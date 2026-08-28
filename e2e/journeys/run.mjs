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
import { withPage, settle, bodyText, storedHistory, clickText, sleep, defect, note, pass,
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
  if (!(await ensureSidebar(page, mobile))) { skip(name, 'mobile sidebar drawer would not open'); return; }
  if (!(await clickText(page, 'الوكيل الذكي'))) { skip(name, 'agent tab not found'); return; }
  await sleep(3500);
  const composer = page.locator('textarea').first();
  if (!(await composer.count())) { skip(name, 'composer not found'); return; }
  await typeInto(composer, 'شقة في جدة');
  await sleep(800);
  const typed = await composer.inputValue();
  if (!typed.includes('شقة')) { skip(name, 'composer did not accept text'); return; }

  if (!(await clickText(page, 'محادثة جديدة'))) { skip(name, 'New Chat not found'); return; }
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
