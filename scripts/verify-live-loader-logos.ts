// POST-DEPLOY: the search loader's logos reach a phone on slow mobile data (owner, 2026-10-25:
// «make sure this never happens again»).
//
// The owner's iPhone showed every loader tile as a name and an empty frame. Every repo-side check was
// green and a local build drew every logo: the failure was DELIVERY — the served Cache-Control — which
// only exists once a build is live. So this runs in deploy-frontend.yml after the deploy, in a real
// Chromium throttled to slow mobile data, and FAILS the deploy when:
//   • the home page did not prefetch the logos before any search,
//   • a logo is not served `immutable` with a long max-age, or
//   • a second visit asks the network for any logo again.
// It opens the home page only, twice, in one browser — no searches, so it adds no search load.
//
//   node --experimental-strip-types scripts/verify-live-loader-logos.ts [url]      (default: https://ezhalah-app.vercel.app)
import './lib/robotPass.mjs';
import { chromium } from 'playwright';
import { LOGO_PATH, MIN_PREFETCHED_LOGOS, logoDeliveryProblems } from './lib/loaderLogoDelivery.mjs';
import { gotoLive } from './lib/liveNav.ts';

// Self-proof before touching production: the verdict must still fail on the defect it exists for, so a
// green run below cannot come from a predicate that went blind.
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) { console.error(`FAIL  verdict is BLIND to: ${label}`); process.exit(1); }
};
const IMM = 'public, max-age=31536000, immutable';
const fake = Array.from({ length: 140 }, (_, i) => ({ url: `https://x/assets/platform-logos/p${i}.png`, status: 200, cacheControl: IMM }));
mustCatch('2026-10-25 production: max-age=0 logos, no prefetch',
  logoDeliveryProblems(fake.slice(0, 11).map((r) => ({ ...r, cacheControl: 'public, max-age=0, must-revalidate' })), []).length >= 2);

const URL = process.argv[2] || process.env.LOADER_LOGOS_CHECK_URL || 'https://ezhalah-app.vercel.app';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
// Slow mobile data, like the owner's phone: ~1.6 Mbit/s down, 150 ms latency.
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 90_000 });

type Seen = { url: string; status: number; cacheControl: string; fromCache: boolean };
let sink: Seen[] = [];
// A memory-cache hit reports requestServedFromCache first; remember it so the response counts as kept.
const servedFromCache = new Set<string>();
cdp.on('Network.requestServedFromCache', (e: { requestId: string }) => servedFromCache.add(e.requestId));
cdp.on('Network.responseReceived', (e: any) => {
  if (!LOGO_PATH.test(e.response.url)) return;
  const h = Object.fromEntries(Object.entries(e.response.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  sink.push({ url: e.response.url, status: e.response.status, cacheControl: h['cache-control'] || '',
    fromCache: servedFromCache.has(e.requestId) || !!(e.response.fromDiskCache || e.response.fromMemoryCache || e.response.fromPrefetchCache) });
});

console.log(`\nPost-deploy loader-logo gate → ${URL} (390px phone, slow mobile data)\n`);
let first: Seen[] = [], repeat: Seen[] = [];
try {
  await gotoLive(page, URL, { timeout: 90_000 });
  // The prefetch starts 2.5 s after load; wait until the logos have arrived (or 90 s on slow data).
  const deadline = Date.now() + 90_000;
  let last = -1, stableSince = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const n = new Set(sink.map((r) => r.url)).size;
    if (n !== last) { last = n; stableSince = Date.now(); }
    if (n >= MIN_PREFETCHED_LOGOS && Date.now() - stableSince > 5000) break;
  }
  first = sink; sink = [];
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
  // Long enough for the 2.5 s prefetch to fire again and ask for every logo (from cache, if kept).
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  repeat = sink;
} catch (e) {
  console.error(`FAIL  could not load ${URL}: ${(e as Error).message}`);
  process.exitCode = 1;
}
await browser.close();

const firstUnique = new Set(first.map((r) => r.url)).size;
console.log(`  first visit : ${firstUnique} logos received before any search`);
console.log(`  second visit: ${repeat.filter((r) => !r.fromCache).length} logos fetched from the network again`);
const problems = (process.exitCode ? ['the page did not load'] : logoDeliveryProblems(first, repeat));
for (const p of problems) console.error(`FAIL  ${p}`);
if (problems.length) {
  console.error('\n❌ live loader logos: phones on mobile data will see empty logo frames in the search loader.');
  process.exit(1);
}
console.log('\n✅ live loader logos: prefetched before the first search, cached for a year, not re-downloaded.');
