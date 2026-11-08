// SIGNED-IN SIDEBAR + SAVED-CHAT SPEED (owner 2026-11-08, iPhone Safari on a VPN: «takes sooooo long for it to load
// and pop. Didn't we say we have a robot that checks and fixes it?»). The site speed watch measured a GUEST only —
// opening, the map, a search, a tap — and was BLIND to the two taps a signed-in visitor makes most:
//   ☰          the sidebar («محادثة جديدة» + «الأخيرة», the saved chats)
//   a row      a saved chat from «الأخيرة», until the conversation is on screen
// This robot measures both, on the same mid-range phone the guest watch uses, twice: on 4G and on a VPN-like line
// (+300 ms RTT), against the owner's budgets: sidebar ≤ 1 s, saved chat ≤ 3 s. It stops at the conversation: a seeded chat
// holds no transcript, so what follows is a fresh search (the guest watch's own step), not the saved chat's paint.
//
// SIGNED-IN STATE IS SEEDED CLIENT-SIDE, exactly as e2e/journeys/harness.mjs does (a local Supabase session object +
// `history:<sub>` in localStorage): no backend account, no secret, the same code path the app runs for a returning
// visitor whose chats are on the device. The server calls those seeds trigger answer 401/403 at once, so what is
// measured is OUR side — the sidebar's mount and paint, the /agent route's download, the chat's first paint — not
// Supabase's auth latency (the owner's own 11:24 UTC open spent 845 ms in /auth/v1/token on top of everything here).
// Any step over its budget, or any step that cannot complete, fails the run (never a silent pass).
import '../../scripts/lib/robotPass.mjs';
import { chromium, devices } from '@playwright/test';
import { seedInitScript, THREE_CHATS, SUB } from '../journeys/harness.mjs';

const BASE = process.env.BASE_URL || 'https://ezhalah.com';
export const BUDGET = { sidebarMs: 1_000, historyChatMs: 3_000 };
// The same phone and CPU as site-speed-live.mjs; the second line adds the round trip a VPN costs (owner's report).
export const LINES = [
  { name: '4G', latency: 150, downloadThroughput: 1_500_000, uploadThroughput: 375_000 },
  { name: 'VPN', latency: 450, downloadThroughput: 1_500_000, uploadThroughput: 375_000 },
];
const FIRST_CHAT = 'عقارات الرياض'; // THREE_CHATS()[0].title — the newest row under «الأخيرة»

const session = () => ({
  access_token: 'x.y.z', token_type: 'bearer', refresh_token: 'r', expires_in: 604800,
  expires_at: Math.floor(Date.now() / 1000) + 604800,
  user: { id: 'qa-user', aud: 'authenticated', email: SUB,
          app_metadata: { provider: 'google' }, user_metadata: { name: 'QA', full_name: 'QA' } },
});

const results = {};
let failed = 0;
const say = (ok, label, value, budget) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${value} ms (budget ${budget} ms)`); if (!ok) failed++; };

const browser = await chromium.launch();
try {
  for (const line of LINES) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar' });
    await ctx.addInitScript(seedInitScript, [session(), THREE_CHATS(), SUB, true]);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: line.latency, downloadThroughput: line.downloadThroughput, uploadThroughput: line.uploadThroughput });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const until = async (fn, arg) => page.waitForFunction(fn, arg, { timeout: 45_000, polling: 25 });

    await page.goto(`${BASE}/?speedwatch=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText('بحث', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.getByText('الضروري فقط', { exact: true }).click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(2_000); // a reader's pause: the page settles, the stored session is adopted

    // 1. ☰ → the sidebar with the saved chats on screen. The hamburger is the one top-bar control that keeps the consent
    //    card up (data-consent-keep) and carries the 44 px tap floor (data-tap44) — src/app/index.tsx.
    let t = Date.now();
    // The control itself, never a blind tap at a coordinate (verify-live-clicks-are-witnessed): a missing hamburger
    // fails the run and says so.
    await page.locator('[data-tap44][data-consent-keep]').first().click({ timeout: 10_000 });
    await until((title) => {
      const marker = document.querySelector('[data-testid="sidebar-search-btn"]');
      const open = !!marker && marker.getBoundingClientRect().width > 0;
      const row = [...document.querySelectorAll('*')].some((e) => e.childElementCount === 0 && (e.textContent ?? '').trim() === title && e.getBoundingClientRect().width > 0);
      return open && row;
    }, FIRST_CHAT);
    results[`sidebarMs_${line.name}`] = Date.now() - t;
    say(results[`sidebarMs_${line.name}`] <= BUDGET.sidebarMs, `${line.name} · sidebar: ☰ until «الأخيرة» rows are on screen`, results[`sidebarMs_${line.name}`], BUDGET.sidebarMs);

    // 2. A saved chat → its conversation on screen (the /agent route, the request bubble that names the city).
    await page.waitForTimeout(800);
    t = Date.now();
    await page.getByText(FIRST_CHAT, { exact: true }).first().click({ timeout: 10_000 });
    await until(() => location.pathname === '/agent'
      && !document.querySelector('[data-testid="sidebar-search-btn"]')
      && [...document.querySelectorAll('*')].some((e) => e.childElementCount === 0 && /الرياض/.test(e.textContent ?? '') && e.getBoundingClientRect().width > 0));
    results[`historyChatMs_${line.name}`] = Date.now() - t;
    say(results[`historyChatMs_${line.name}`] <= BUDGET.historyChatMs, `${line.name} · saved chat: row tap until the conversation is on screen`, results[`historyChatMs_${line.name}`], BUDGET.historyChatMs);

    await ctx.close();
  }
} catch (e) {
  failed++;
  console.error(`FAIL  the journey could not complete: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
}
console.log(`measured: ${JSON.stringify(results)}`);
if (failed) { console.error(`\n❌ signed-in sidebar speed watch: ${failed} problem(s) — the engineers get this as an alert.`); process.exit(1); }
console.log('\n✅ signed-in sidebar speed watch: the sidebar and a saved chat open within budget on 4G and on a VPN line.');
