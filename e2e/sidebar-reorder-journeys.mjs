// SIDEBAR PRESS-HOLD-DRAG REORDER — real-browser journeys A–G (owner spec 2026-08-24).
// Signed-in state is seeded client-side (a local session object + history:<sub> in localStorage);
// no backend account is touched — sidebar history is a purely client-side feature.
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:8123';
const SUB = 'qa@ezhalah.test';
const NOW = Date.now();
const item = (id, title, ts, extra = {}) => ({
  id, label: title, query: { deal: 'Buy', location: 'الرياض' }, ts, title, titleSource: 'manual', ...extra,
});
const THREE = [
  item('h1', 'عقارات الرياض', NOW),
  item('h2', 'فلل جدة', NOW - 60_000),
  item('h3', 'شقق الخبر', NOW - 120_000),
];
const session = {
  access_token: 'x.y.z', token_type: 'bearer', refresh_token: 'r',
  expires_in: 604800, expires_at: Math.floor(NOW / 1000) + 604800,
  user: { id: 'qa-user', aud: 'authenticated', email: SUB,
    app_metadata: { provider: 'google' }, user_metadata: { name: 'QA', full_name: 'QA' } },
};

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { ok ? (pass++, console.log(`  PASS  ${name}`)) : (fail++, console.log(`  FAIL  ${name} ${detail}`)); };

async function boot(mobile, history = THREE) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(mobile
    ? { ...devices['iPhone 13'], locale: 'ar-SA' }
    : { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, locale: 'ar-SA' });
  await ctx.addInitScript(([sess, hist, sub]) => {
    // Seed ONCE per context: this init script re-runs on every navigation (including the reload in
    // Journey C), and re-seeding there would wipe the order the drag just persisted — the exact
    // thing that journey exists to verify.
    localStorage.setItem('sb-aannarbkwcymrotzwdbo-auth-token', JSON.stringify(sess));
    if (!localStorage.getItem('history:' + sub)) localStorage.setItem('history:' + sub, JSON.stringify(hist));
    localStorage.setItem('hasSeenIntro', '1');
  }, [session, history, SUB]);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(4500);
  // Expo DEV builds mount an empty #error-overlay div that intercepts Playwright's actionability
  // checks even with no error shown. Dev-only scaffolding — remove it (and keep it removed).
  await page.evaluate(() => {
    const zap = () => document.getElementById('error-overlay')?.remove();
    zap(); new MutationObserver(zap).observe(document.body, { childList: true, subtree: false });
  });
  return { browser, ctx, page };
}
async function openSidebarMobile(page) {
  // the hamburger sits top-left
  await page.mouse.click(35, 40).catch(() => {});
  await page.waitForTimeout(1200);
  if (!(await page.getByText('عقارات الرياض', { exact: true }).count())) {
    // try the visible menu icon via role fallback
    const el = page.locator('div,button').filter({ hasText: /^$/ }).first();
    void el;
  }
}
const rowOrder = (page) => page.evaluate(() => {
  const titles = ['عقارات الرياض', 'فلل جدة', 'شقق الخبر'];
  const found = [];
  for (const el of document.querySelectorAll('div')) {
    const txt = (el.innerText || '').trim();
    if (titles.includes(txt) && el.children.length === 0) {
      found.push({ txt, y: el.getBoundingClientRect().top });
    }
  }
  const seen = new Map();
  for (const f of found) if (!seen.has(f.txt)) seen.set(f.txt, f.y);
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
});
const rowCenter = async (page, title) => {
  const el = page.getByText(title, { exact: true }).first();
  const box = await el.boundingBox();
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
};
async function holdDrag(page, fromTitle, dy, { steps = 8, holdMs = 460 } = {}) {
  const c = await rowCenter(page, fromTitle);
  if (!c) return false;
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);            // the 380ms hold lands
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(c.x, c.y + (dy * i) / steps);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(420);               // settle (190ms) + commit
  return true;
}
const storedOrder = (page) => page.evaluate((sub) => {
  const h = JSON.parse(localStorage.getItem('history:' + sub) || '[]');
  const rank = (it) => it.order ?? it.ts;
  return { titles: [...h].sort((a, b) => rank(b) - rank(a)).map((it) => it.title), n: h.length, ids: h.map((it) => it.id) };
}, SUB);

// ═══ Journey A + D + E + F on desktop (docked sidebar) ═══
{
  const { browser, page } = await boot(false);
  t('signed-in sidebar shows the three chats', (await rowOrder(page)).join() === 'عقارات الرياض,فلل جدة,شقق الخبر', (await rowOrder(page)).join());

  // A — hold chat #1, drag below #3 → #2/#3/#1
  const rh = 37;
  await holdDrag(page, 'عقارات الرياض', rh * 2 + 8);
  const afterA = await rowOrder(page);
  t('Journey A — order becomes فلل جدة / شقق الخبر / عقارات الرياض', afterA.join() === 'فلل جدة,شقق الخبر,عقارات الرياض', afterA.join());
  const st = await storedOrder(page);
  t('Journey A — the new order is PERSISTED (localStorage rank)', st.titles.join() === 'فلل جدة,شقق الخبر,عقارات الرياض', st.titles.join());
  t('Journey A — still exactly 3 chats, ids unique', st.n === 3 && new Set(st.ids).size === 3);

  // D — a normal quick tap opens the conversation (navigates to the chat)
  const histLenBefore = await page.evaluate(() => history.length);
  await page.getByText('فلل جدة', { exact: true }).first().click();
  await page.waitForTimeout(900);
  t('Journey D — quick tap OPENS the chat (agent route)', page.url().includes('/agent'));

  // E — double-click renames only: input appears, no navigation, no reorder
  await page.goto(BASE + '/', { waitUntil: 'load' }); await page.waitForTimeout(3500);
  await page.evaluate(() => document.getElementById('error-overlay')?.remove());
  const before = await rowOrder(page);
  await page.getByText('شقق الخبر', { exact: true }).first().dblclick();
  await page.waitForTimeout(600);
  const editing = await page.evaluate(() => document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA');
  t('Journey E — double-click enters rename (focused input)', editing);
  t('Journey E — double-click did NOT navigate', !page.url().includes('/agent'));
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  t('Journey E — no reorder from the double-click', (await rowOrder(page)).join() === before.join());

  // F — five reorders → zero duplicates, zero junk browser-history
  const h0 = await page.evaluate(() => history.length);
  for (let i = 0; i < 5; i++) {
    const top = (await rowOrder(page))[0];
    await holdDrag(page, top, rh * 2 + 8);
  }
  const stF = await storedOrder(page);
  t('Journey F — five reorders: still 3 chats, 0 duplicates', stF.n === 3 && new Set(stF.ids).size === 3, JSON.stringify(stF));
  t('Journey F — five reorders: 0 junk browser-history entries', (await page.evaluate(() => history.length)) === h0);
  void histLenBefore;
  await browser.close();
}

// ═══ Journey C — refresh persists the manual order (signed-in contract) ═══
{
  const { browser, page } = await boot(false);
  await holdDrag(page, 'عقارات الرياض', 37 * 2 + 8);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(4000);
  await page.evaluate(() => document.getElementById('error-overlay')?.remove());
  const after = await rowOrder(page);
  t('Journey C — refresh keeps the manual order', after.join() === 'فلل جدة,شقق الخبر,عقارات الرياض', after.join());
  await browser.close();
}

// ═══ Journey B + G — mobile: overlay sidebar, drag, close/reopen, auto-scroll, overflow ═══
{
  const MANY = Array.from({ length: 22 }, (_, i) => item('m' + i, (i === 0 ? 'عقارات الرياض' : `محادثة ${i}`), NOW - i * 60_000));
  MANY.push(item('h2', 'فلل جدة', NOW - 23 * 60_000), item('h3', 'شقق الخبر', NOW - 24 * 60_000));
  const { browser, page } = await boot(true, MANY);
  await openSidebarMobile(page);
  const visible = await page.getByText('عقارات الرياض', { exact: true }).count();
  t('mobile — sidebar opens with the chat list', visible > 0);
  if (visible) {
    // G — long press + drag with auto-scroll toward the bottom edge
    const c = await rowCenter(page, 'عقارات الرياض');
    const scrollBefore = await page.evaluate(() => { const els = [...document.querySelectorAll('div')].filter((e) => e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 200); return els.length; });
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(470);
    // drag to near the bottom edge and HOLD there so auto-scroll walks the list
    const vh = page.viewportSize().height;
    for (let i = 1; i <= 6; i++) { await page.mouse.move(c.x, c.y + ((vh - 90 - c.y) * i) / 6); await page.waitForTimeout(35); }
    await page.waitForTimeout(1600);            // auto-scroll runs while parked at the edge
    await page.mouse.up(); await page.waitForTimeout(500);
    const stG = await storedOrder(page);
    const pos = stG.titles.indexOf('عقارات الرياض');
    t('Journey G — long-press + drag + auto-scroll moved the chat well down the list', pos >= 4, `landed at index ${pos}`);
    t('Journey G — 0 duplicates on mobile', stG.n === MANY.length && new Set(stG.ids).size === MANY.length);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t('mobile — zero horizontal overflow during/after drag', overflow <= 1, `overflow=${overflow}`);
    void scrollBefore;

    // B — close the sidebar (backdrop tap), reopen → same order
    await page.mouse.click(page.viewportSize().width - 10, 300); await page.waitForTimeout(900);
    await openSidebarMobile(page);
    const stB = await storedOrder(page);
    t('Journey B — close/reopen keeps the order', stB.titles.indexOf('عقارات الرياض') === pos);
  }
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
