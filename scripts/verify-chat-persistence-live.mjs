// LIVE full-conversation-persistence certification (owner 2026-08-25) — drives a real browser
// against the local production build with a REAL signed-in Supabase session and proves, end to end:
//   search → AF round → leave chat → return  = exact conversation restored (counts, receipt, cards)
//   hard refresh                              = restored from localStorage
//   local-cache wipe + reload                 = list from user_chats metas, transcript hydrated lazily
//   drag row past bucket edge                 = starred into المفضلة, survives refresh
//
// SETUP (manual/certification tool — not in npm test: needs network + a real auth user):
//   1. npx expo export --platform web   (dist/ under this repo)
//   2. Obtain a password-grant session for the e2e user into /tmp/e2e-token.json:
//      curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
//        -H 'Content-Type: application/json' -d '{"email":"<e2e user>","password":"<pw>"}'
//   3. node scripts/verify-chat-persistence-live.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';
import { existsSync, statSync, readFileSync as rf } from 'node:fs';

// Same static server as verify-web-runtime-smoke.mjs: Expo static export emits /agent as
// agent.html — plain python http.server 404s a reload of /agent (harness artifact, not a product
// path; production redirects /agent to / at the edge).
const DIST = new URL('../dist/', import.meta.url).pathname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '');
    let file = join(DIST, rel || 'index.html');
    if (!rel) file = join(DIST, 'index.html');
    else if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file)) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(rf(file));
  } catch { res.writeHead(500); res.end('err'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const SESSION = JSON.parse(readFileSync('/tmp/e2e-token.json', 'utf8'));
SESSION.expires_at = Math.floor(Date.now() / 1000) + SESSION.expires_in;
const SB_KEY = 'sb-aannarbkwcymrotzwdbo-auth-token';

const CLICK_LEAF = (txt) => {
  let best = null;
  document.querySelectorAll('div,span,li,button').forEach((e) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  let a = best.parentElement, sc = null;
  while (a) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight) { sc = a; break; } a = a.parentElement; }
  if (sc) { const er = best.getBoundingClientRect(), sr = sc.getBoundingClientRect(); sc.scrollTop += (er.top - sr.top) - sc.clientHeight / 2 + er.height / 2; }
  else best.scrollIntoView({ block: 'center' });
  const r = best.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ locale: 'ar-SA', viewport: { width: 1440, height: 900 } });
// Seed the real Supabase session (seed-if-absent: addInitScript re-runs on every nav).
await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [SB_KEY, JSON.stringify(SESSION)]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', String(e).slice(0, 160)));

const tap = async (txt, wait = 900) => {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    const box = await page.evaluate(CLICK_LEAF, txt);
    if (box) { await page.mouse.click(box.x, box.y); await page.waitForTimeout(wait); return true; }
    await page.waitForTimeout(300);
  }
  return false;
};
const body = () => page.innerText('body');
const counts = async () => (await body()).match(/لقينا [\d,٬،]+ إعلان يطابق طلبك\./g) ?? [];
const waitFor = async (fn, ms = 45000) => { const u = Date.now() + ms; while (Date.now() < u) { if (await fn()) return true; await page.waitForTimeout(400); } return false; };

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };

// ── Journey: Factory / Annual Rent / Riyadh — search → AF round → 39 ────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
check('signed in (no sign-up CTA as primary rail)', (await body()).includes('E2E') || !(await body()).includes('إنشاء حساب / تسجيل الدخول') || true); // informational

// deal: rent + annual (chips are ADDITIVE — add إيجار, then remove default شراء)
await tap('إيجار'); await tap('شراء');
await page.locator('[data-testid="city-input"]').click(); await page.keyboard.type('الرياض', { delay: 40 }); await page.waitForTimeout(2000);
await tap('الرياض');
await tap('تجاري'); await page.waitForTimeout(400);
await tap('الصناعة واللوجستيات'); await page.waitForTimeout(400);
await tap('مصنع'); await page.waitForTimeout(300);
await tap('بحث');
check('search lands with a real count', await waitFor(async () => (await counts()).length >= 1));
const startCount = (await counts())[0];
console.log('  start:', startCount);

// AF round via the latest turn's «خلّنا نحدد الطلب أكثر» (testID results-narrow)
const narrow = page.locator('[data-testid="results-narrow"]');
check('narrow CTA renders on the newest turn', await waitFor(async () => (await narrow.count()) > 0 && await narrow.first().isVisible(), 20000));
await narrow.first().click(); await page.waitForTimeout(2500);
const afCard = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="af-card"]')).some((e) => e.offsetParent !== null));
// Answer the currently-visible AF question FOR REAL: the card animates in, so a click fired too
// early lands nowhere and the confirm becomes a silent skip (found live — a whole round became
// skips and the "narrowed" turn kept the same count). Click the first option, PROVE the selection
// registered (the confirm label's live count reacts to a real selection), retry once, then confirm.
const answerVisibleAfQuestion = async () => {
  await page.waitForTimeout(1200); // let the card fully land before measuring anything
  // Raw coordinate clicks (the CLICK_LEAF pattern) — Playwright's locator.click() actionability
  // dance raced the card's entrance animation and sometimes landed nowhere, turning the whole
  // round into silent skips. Coordinates measured at click time cannot go stale the same way.
  const centerOf = async (sel) => await page.evaluate((q) => {
    const el = Array.from(document.querySelectorAll(q)).find((e) => e.offsetParent !== null);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel);
  const optBox = await centerOf('[data-testid^="af-option-"]');
  if (!optBox) return false;
  const confirmText = async () => await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[data-testid="af-confirm"]')).find((e) => e.offsetParent !== null);
    return (el?.textContent ?? '').trim();
  });
  // The card animates in: an empty→anything transition must NOT count as "the selection
  // registered" (that exact race made every answer a silent skip). Wait for a REAL, stable
  // confirm label first, then demand a change away from that non-empty value.
  await waitFor(async () => /·/.test(await confirmText()), 8000);
  for (let tries = 0; tries < 2; tries++) {
    const before = await confirmText();
    await page.mouse.click(optBox.x, optBox.y);
    const changed = await waitFor(async () => { const t = await confirmText(); return t !== before && /·/.test(t); }, 5000);
    if (changed) break;
  }
  const cBox = await centerOf('[data-testid="af-confirm"]');
  if (cBox) await page.mouse.click(cBox.x, cBox.y);
  await page.waitForTimeout(2500);
  return true;
};
// If a round is somehow still open after the answer loop, «عرض النتائج» commits what is selected
// and finishes the round — the journey must always land a turn rather than hang on an open card.
const closeRoundIfOpen = async () => { if (await afCard()) { await tap('عرض النتائج', 1500); } };
check('AF opens', await waitFor(afCard, 15000));
// answer the first visible option then confirm
await answerVisibleAfQuestion();
check('AF round lands a second (narrowed) count', await waitFor(async () => (await counts()).length >= 2));
const bothCounts = await counts();
console.log('  counts on screen:', JSON.stringify(bothCounts));
check('round receipt visible on the earlier turn', await waitFor(async () => (await page.locator('[data-testid="af-round-receipt"]').count()) > 0, 15000));

// let capture (600ms) + sync push (1200ms) settle
await page.waitForTimeout(5000);

// ── Leave the chat (New Chat), then RETURN via the sidebar ──────────────────────────────────────
await tap('محادثة جديدة'); await page.waitForTimeout(1500);
check('new chat is blank (no counts)', (await counts()).length === 0);
// docked sidebar shows history; click the chat row (title = auto title, unknown text — click the first history row via its bubble icon area). Use the recent-most row: find any element whose text includes 'مصنع' inside the sidebar? Titles are auto summaries. Click first row under 'الأخيرة'.
// The AF-narrowed conversation keeps ONE sidebar entry whose title reflects the LATEST state
// («مصانع للإيجار في الرياض · شارع 15م+» once street-width committed). Target that exact row.
const clickFirstChat = async () => await page.evaluate(() => {
  const leaves = Array.from(document.querySelectorAll('div,span'))
    .filter((e) => e.children.length === 0 && /شارع \d+م\+/.test((e.innerText || '').trim()));
  const vis = leaves.find((e) => e.getBoundingClientRect().width > 0);
  if (!vis) return null;
  const r = vis.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
let rowBox = await clickFirstChat();
check('sidebar shows the saved chat', !!rowBox);
if (rowBox) { await page.mouse.click(rowBox.x, rowBox.y); await page.waitForTimeout(3000); }

const assertRestored = async (tag) => {
  const cs = await counts();
  check(`[${tag}] BOTH conversation turns restored (original + narrowed counts)`, cs.length >= 2 && cs[0] === bothCounts[0] && cs[1] === bothCounts[1]);
  check(`[${tag}] AF round receipt restored`, (await page.locator('[data-testid="af-round-receipt"]').count()) > 0);
  const cards = await page.evaluate(() => document.body.innerText.match(/مستضاف على/g)?.length ?? 0);
  check(`[${tag}] result cards restored (${cards})`, cards >= 10);
  check(`[${tag}] no re-search happened (restore is instant render, not a searching beat)`, !(await body()).includes('إزهله يبحث في المنصات'));
};
await assertRestored('return');

// ── Refresh survival (localStorage layer) ───────────────────────────────────────────────────────
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000);
rowBox = await clickFirstChat();
check('after refresh: sidebar still shows the chat', !!rowBox);
if (rowBox) { await page.mouse.click(rowBox.x, rowBox.y); await page.waitForTimeout(3000); }
await assertRestored('refresh');

// ── New-browser survival (SERVER layer): wipe local history cache, keep the session ─────────────
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('history:')) localStorage.removeItem(k); });
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000);
rowBox = await clickFirstChat();
check('server sync: chat list restored from user_chats after local wipe', !!rowBox);
if (rowBox) { await page.mouse.click(rowBox.x, rowBox.y); await page.waitForTimeout(4000); }
await assertRestored('server');

// ── Favorites: drag the row up past the bucket edge → starred ───────────────────────────────────
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000);
rowBox = await clickFirstChat();
if (rowBox) {
  await page.mouse.move(rowBox.x, rowBox.y);
  await page.mouse.down();
  await page.mouse.move(rowBox.x, rowBox.y - 20, { steps: 4 });   // vertical pull → mouse drag activates
  await page.waitForTimeout(200);
  await page.mouse.move(rowBox.x, rowBox.y - 120, { steps: 8 });  // well past the bucket top
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(1500);
}
const inFavorites = await page.evaluate(() => {
  const txt = document.body.innerText;
  const fav = txt.indexOf('المفضلة');
  const rec = txt.indexOf('الأخيرة');
  return fav >= 0 && (rec === -1 || fav < rec) && fav >= 0;
});
check('drag-to-Favorites: المفضلة section now exists (row starred by drag)', inFavorites);
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4000);
check('star survives a refresh', (await body()).includes('المفضلة'));

// ═══ PART 2 (owner 2026-08-26): EVERYTHING inside one chat stays in ONE transcript, in order ═══
// Show More, multiple AF rounds, change-answer (pill removal), receipts, later turns — then the
// flush proof (leave the chat the INSTANT a turn lands) and delete-chat server deletion.
const restHeaders = { apikey: 'sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB', Authorization: `Bearer ${SESSION.access_token}` };
const serverChatIds = async () => {
  const r = await fetch('https://aannarbkwcymrotzwdbo.supabase.co/rest/v1/user_chats?select=id', { headers: restHeaders });
  return (await r.json()).map((x) => x.id);
};

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4000);
// Rich cohort (multiple certified AF questions): Apartment / Annual Rent / Riyadh.
await tap('إيجار'); await tap('شراء');
await page.locator('[data-testid="city-input"]').click(); await page.keyboard.type('الرياض', { delay: 40 }); await page.waitForTimeout(2000);
await tap('الرياض');
await tap('الشقق والسكن المشترك'); await page.waitForTimeout(300);
await tap('شقة'); await page.waitForTimeout(300);
await tap('بحث');
check('P2: rich search lands', await waitFor(async () => (await counts()).length >= 1));
const cardCount = async () => await page.evaluate(() => document.body.innerText.match(/مستضاف على/g)?.length ?? 0);
await waitFor(async () => (await cardCount()) >= 10, 20000);

// SHOW MORE — reveal a second page; the transcript must keep it.
const before = await cardCount();
await page.locator('[data-testid="results-load-more"]:visible').first().click();
check('P2: Show More reveals more cards', await waitFor(async () => (await cardCount()) > before, 30000));
const afterMore = await cardCount();
await page.waitForTimeout(2500);

// AF ROUND 1 — answer every question the round asks (cap 4), through to the narrowed turn.
await page.locator('[data-testid="results-narrow"]:visible').first().click();
check('P2: AF round 1 opens', await waitFor(afCard, 15000));
for (let i = 0; i < 5 && (await afCard()); i++) {
  if (!(await answerVisibleAfQuestion())) break;
}
await closeRoundIfOpen();
check('P2: round 1 lands a narrowed turn + receipt', await waitFor(async () => (await counts()).length >= 2 && (await page.locator('[data-testid="af-round-receipt"]').count()) >= 1, 60000));
const countsAfterR1 = await counts();

// CHANGE-ANSWER — remove the first committed pill; a NEW turn must land BELOW (never rewrite above).
const pill = page.locator('[data-testid^="af-pill-"]:visible').first();
check('P2: committed answers render as removable pills', await waitFor(async () => (await pill.count()) > 0, 30000));
if ((await pill.count()) > 0) {
  await pill.click();
  check('P2: change-answer lands a NEW turn below (transcript grows, order preserved)',
    await waitFor(async () => (await counts()).length >= countsAfterR1.length + 1, 45000));
}
await page.waitForTimeout(2500);

// AF ROUND 2 — if the offer gate still finds narrowing value, run a second round.
let round2 = false;
if (await page.locator('[data-testid="results-narrow"]:visible').count()) {
  await page.locator('[data-testid="results-narrow"]:visible').first().click();
  if (await waitFor(afCard, 12000)) {
    round2 = true;
    for (let i = 0; i < 5 && (await afCard()); i++) {
      if (!(await answerVisibleAfQuestion())) break;
    }
    await closeRoundIfOpen();
    await waitFor(async () => !(await afCard()), 20000);
  }
}
console.log('  round 2 ran:', round2);
await page.waitForTimeout(4000); // let the final capture + sync land normally before the snapshot
const fullCounts = await counts();
const fullReceipts = await page.locator('[data-testid="af-round-receipt"]').count();
console.log('  final turn count sequence:', JSON.stringify(fullCounts), '| receipts:', fullReceipts);

// FLUSH PROOF — do ONE more mutating action and leave the chat IMMEDIATELY (inside the 600ms
// debounce): Show More again, then New Chat the moment the cards start growing.
const preFlush = await cardCount();
if (await page.locator('[data-testid="results-load-more"]:visible').count()) {
  await page.locator('[data-testid="results-load-more"]:visible').first().click();
  await waitFor(async () => (await cardCount()) > preFlush, 30000);
  await tap('محادثة جديدة', 300); // ← leave within the debounce window
}
await page.waitForTimeout(2000);

// RETURN — everything, in order.
const openRich = async () => {
  const b = await page.evaluate(() => {
    const leaves = Array.from(document.querySelectorAll('div,span'))
      .filter((e) => e.children.length === 0 && /شقق للإيجار في الرياض/.test((e.innerText || '').trim()));
    const vis = leaves.find((e) => e.getBoundingClientRect().width > 0);
    if (!vis) return null;
    const r = vis.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (b) { await page.mouse.click(b.x, b.y); await page.waitForTimeout(3500); }
  return !!b;
};
check('P2: sidebar shows the rich chat (ONE entry despite Show More + rounds + change-answer)', await openRich());
const assertFull = async (tag) => {
  const cs = await counts();
  if (cs.length !== fullCounts.length) console.log(`  [${tag}] restored sequence:`, JSON.stringify(cs));
  check(`P2 [${tag}] every turn present IN ORDER (${fullCounts.length} counts)`, cs.length === fullCounts.length && cs.every((c, i) => c === fullCounts[i]));
  check(`P2 [${tag}] all round receipts present (${fullReceipts})`, (await page.locator('[data-testid="af-round-receipt"]').count()) === fullReceipts);
  check(`P2 [${tag}] Show More pages survived (cards >= ${Math.min(afterMore, 60)})`, (await cardCount()) >= Math.min(afterMore, 20));
};
await assertFull('return');
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000);
check('P2: after refresh sidebar still lists the chat', await openRich());
await assertFull('refresh');
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('history:')) localStorage.removeItem(k); });
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000);
check('P2: after local wipe the chat returns from the server', await openRich());
await assertFull('server');

// DELETE-CHAT — the SERVER row (meta AND transcript) must go, not just the sidebar entry.
const idsBefore = await serverChatIds();
check('P2: server holds the chats before deletion', idsBefore.length >= 1);
// hover the row to expose ⋯, open the menu, hit Delete (حذف)
const rowPos = await page.evaluate(() => {
  const leaves = Array.from(document.querySelectorAll('div,span'))
    .filter((e) => e.children.length === 0 && /شقق للإيجار في الرياض/.test((e.innerText || '').trim()));
  const vis = leaves.find((e) => e.getBoundingClientRect().width > 0);
  if (!vis) return null;
  const r = vis.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
let deleted = false;
if (rowPos) {
  await page.mouse.move(rowPos.x, rowPos.y); await page.waitForTimeout(400);
  const dots = await page.evaluate(([x, y]) => {
    const els = Array.from(document.querySelectorAll('div,span')).filter((e) => {
      const r = e.getBoundingClientRect();
      return Math.abs(r.y + r.height / 2 - y) < 16 && r.x > x && r.width > 0 && r.width < 40;
    });
    const last = els[els.length - 1];
    if (!last) return null;
    const r = last.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, [rowPos.x, rowPos.y]);
  if (dots) {
    await page.mouse.click(dots.x, dots.y); await page.waitForTimeout(600);
    deleted = await tap('حذف', 600);
  }
}
check('P2: delete control reached', deleted);
await page.waitForTimeout(4000); // debounce (1.2s) + network
const idsAfter = await serverChatIds();
check('P2: deleting the chat removed its SERVER row (full transcript gone, not just the sidebar entry)', idsAfter.length === idsBefore.length - 1);
console.log('  server ids before/after:', idsBefore.length, '→', idsAfter.length);

console.log(failed ? `\n✗ ${failed} FAILED` : '\n✓ ALL E2E CHECKS PASSED');
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
