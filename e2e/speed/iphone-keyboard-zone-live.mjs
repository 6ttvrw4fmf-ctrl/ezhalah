// 📱 IPHONE ROBOT — KEYBOARD ZONE + TAP RULE (owner 2026-11-08 20:30 UTC: «We need to check this always… I am scared it
// happens to other things… people won't use ours anymore»). Read-only; uses the robot pass.
//
// The bug it exists for (fixed in #11362): on focus the Filter centred the input with scrollIntoView({block:'center'});
// iOS 26 Safari centres in the FULL screen, so the input sat on the keyboard's top edge and its list opened UNDER the
// keyboard. No robot saw it, because none checked WHERE a list opens on a phone.
//
// Rules, on WebKit with the iPhone 13 profile (Safari's engine, the phone's screen):
//   KEYBOARD ZONE — after every tap that opens a list, its first row must be fully visible in the TOP 55 % of the
//                   screen (an iPhone keyboard covers the bottom ~45 %), and the input itself must stay there too.
//   TAP RULE      — every tap answers within 3 s: a row, «Loading…» or an error/retry — never nothing.
// Walk: open → city box (type الخفجي) → pick the row → district box (Top districts) → pick the first row.
// Any FAIL exits 1; site-speed-live.yml bridges a red run to alert_event (P1 to the engineers) like its other steps.
import '../../scripts/lib/robotPass.mjs';
import { webkit, chromium, devices } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://ezhalah.com';
export const KEYBOARD_TOP_SHARE = 0.55;
export const TAP_ANSWER_MS = 3_000;
const SETTLE_MS = 1_200;   // the Filter scrolls 380 ms after focus, smoothly; judge where things END UP

const engine = process.env.IPHONE_ROBOT_ENGINE === 'chromium' ? chromium : webkit;
const browser = await engine.launch();
let failed = 0;
const say = (ok, label, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${detail}`); if (!ok) failed++; };

// Visible leaf texts below `topY` that were NOT on screen before the tap: the list the tap opened.
const newRowsBelow = (page, before, topY) => page.evaluate(({ before, topY }) => {
  const seen = new Set(before);
  return [...document.querySelectorAll('div,span')]
    .filter((e) => e.childElementCount === 0 && (e.textContent || '').trim().length > 0)
    .map((e) => ({ t: e.textContent.trim(), r: e.getBoundingClientRect() }))
    .filter(({ t, r }) => r.width > 0 && r.height > 0 && r.top >= topY - 1 && !seen.has(t))
    .sort((a, b) => a.r.top - b.r.top)
    .map(({ t, r }) => ({ t, top: Math.round(r.top), bottom: Math.round(r.bottom) }));
}, { before, topY });
const visibleTexts = (page) => page.evaluate(() => [...document.querySelectorAll('div,span')]
  .filter((e) => e.childElementCount === 0 && e.getBoundingClientRect().width > 0).map((e) => (e.textContent || '').trim()).filter(Boolean));

// KEYBOARD ROOM: when the iOS keyboard opens, Safari lets the page scroll further by the keyboard's height, which is how
// scrollIntoView({block:'center'}) could carry the input down to the keyboard's top edge. A headless phone has no
// keyboard and so no extra room: the first probe run (2026-11-08 21:20, production WITH the bug) passed for exactly that
// reason. Give the input's scroll container the same room (one screen of spacer) before every tap.
const addKeyboardRoom = (input) => input.evaluate((el) => {
  let sc = el.parentElement;
  while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
  const host = sc ? (sc.firstElementChild || sc) : document.body;
  if (host.querySelector(':scope > [data-ez-keyboard-room]')) return;
  const room = document.createElement('div');
  room.setAttribute('data-ez-keyboard-room', '');
  room.style.height = `${innerHeight}px`;
  host.appendChild(room);
});

async function checkListOpens(page, input, label, typed) {
  await addKeyboardRoom(input);
  const before = await visibleTexts(page);
  const t0 = Date.now();
  await input.tap();
  if (typed) await page.keyboard.type(typed);
  let rows = [];
  const box0 = await input.boundingBox();
  while (Date.now() - t0 < TAP_ANSWER_MS && rows.length === 0) {
    rows = await newRowsBelow(page, before, (box0?.y ?? 0) + (box0?.height ?? 0) / 2);
    if (!rows.length) await page.waitForTimeout(100);
  }
  const answeredMs = Date.now() - t0;
  say(rows.length > 0, `tap: ${label} answers (a row, Loading or an error)`, rows.length ? `${answeredMs} ms «${rows[0].t}»` : `nothing within ${TAP_ANSWER_MS} ms`);
  if (!rows.length) return null;
  await page.waitForTimeout(SETTLE_MS);
  const h = page.viewportSize().height; const limit = Math.round(h * KEYBOARD_TOP_SHARE);
  const box = await input.boundingBox();
  rows = await newRowsBelow(page, before, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  const first = rows[0];
  say(!!box && box.y + box.height <= limit, `keyboard zone: ${label} input stays above the keyboard`, `bottom ${Math.round((box?.y ?? 0) + (box?.height ?? 0))} px, limit ${limit} px of ${h}`);
  say(!!first && first.top >= 0 && first.bottom <= limit, `keyboard zone: ${label} first row above the keyboard`, first ? `«${first.t}» ${first.top}–${first.bottom} px, limit ${limit} px of ${h}` : 'list gone after settling');
  return first ? page.getByText(first.t, { exact: true }).first() : null;
}

try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar' });
  // THE OWNER'S SCREEN, NOT A FIRST-TIME GUEST'S (probe 2026-11-08 21:30): the cookie card (252 px) and Google's one-tap
  // sheet (144 px) shrank the Filter's scroll box to 268 px, so a centred input still sat high and the robot PASSED on the
  // buggy site. The owner was signed in: no card, no sheet, a full-height box. The card shows to every guest on every
  // visit (owner 2026-09-13), so it is answered below; the one-tap sheet is never loaded.
  await ctx.route(/accounts\.google\.com\/gsi\//, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?iphonerobot=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByText('بحث', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 });
  const necessary = page.getByText('الضروري فقط', { exact: true });
  const cardGone = await necessary.waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => necessary.tap())
    .then(() => page.getByTestId('cookie-consent').waitFor({ state: 'detached', timeout: 5_000 }))
    .then(() => true, () => false);
  say(cardGone, 'setup: the cookie card answered and gone (it shrinks the Filter box)', cardGone ? 'gone' : 'still on screen or never appeared');
  await page.waitForTimeout(2_000);

  const city = page.getByPlaceholder('اختر المدينة', { exact: true });
  const cityRow = await checkListOpens(page, city, 'city box', 'الخفجي');
  if (cityRow) {
    await page.getByText('الخفجي', { exact: true }).first().tap({ timeout: 5_000 });
    await page.waitForTimeout(800);
    const district = page.getByTestId('district-input');
    const editable = await district.isEditable().catch(() => false);
    say(editable, 'tap: picking the city row unlocks the district box', editable ? 'editable' : 'still locked');
    if (editable) {
      const row = await checkListOpens(page, district, 'district box', '');
      if (row) {
        const before = (await visibleTexts(page)).join('|');
        const t0 = Date.now(); await row.tap({ timeout: 5_000 });
        let changed = false;
        while (Date.now() - t0 < TAP_ANSWER_MS && !changed) { changed = (await visibleTexts(page)).join('|') !== before; if (!changed) await page.waitForTimeout(100); }
        say(changed, 'tap: the first district row answers when tapped', changed ? `${Date.now() - t0} ms` : `nothing within ${TAP_ANSWER_MS} ms`);
      }
    }
  }
  if (failed) await page.screenshot({ path: 'iphone-robot-fail.png' }).catch(() => {});
  await ctx.close();
} catch (e) {
  say(false, 'journey', String(e?.message || e).split('\n')[0]);
} finally {
  await browser.close();
}
console.log(failed ? `\n📱 iPhone robot: ${failed} FAIL` : '\n📱 iPhone robot: all PASS');
process.exit(failed ? 1 : 0);
