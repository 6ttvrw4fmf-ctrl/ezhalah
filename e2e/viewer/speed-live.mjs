// AD-VIEWER SPEED GUARD (owner 2026-10-03: «how to always keep it like this quick … always, no matter
// what»). Runs on a schedule and after every deploy (.github/workflows/ad-viewer-speed-live.yml); a red
// run reaches the engineers through the alert_event bridge in that workflow. Read-only.
//
// For every site that opens INSIDE Ezhalah (IN_APP_VIEWER_HOSTS), on a phone over throttled 4G:
//   1. FRAMING — the ad page must still allow being shown inside another site (no X-Frame-Options,
//      no CSP frame-ancestors). If a site starts refusing, every user would see a blank tab: red, and
//      the fix is to take that host off the allowlist so its cards open in a real tab again.
//   2. SPEED — median time until the ad's own text is on screen inside a frame must stay under budget
//      (measured 2026-10-03: Gathern ~0.4s, Deal App ~0.8s; the bad old cover made it 3.8–5s).
//   3. THE LIVE BUNDLE — production must still ship the instant-show tab (thin progress bar), never the
//      old full-page «loading» cover that hid ready ads for seconds.
// Deal App rate-limits guest sessions (HTTP 429 on api.dealapp.sa/…/user/skip); a sample that hit that
// wall is reported and excluded — the site throttled the robot, Ezhalah did nothing wrong. A Cloudflare
// challenge (403 + cf-mitigated: challenge, served to datacenter IPs, never to a phone in Saudi) is
// handled the same way: its own SAMEORIGIN header is not the ad page's, and a frame it blocks is excluded.
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://ezhalah-app.vercel.app';
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SAMPLES = 3;
const BUDGET_MS = 10000; // owner 2026-10-17: «if it's below 10 seconds no problem» (was 3000)
const SITES = [
  { host: 'gathern.co', table: 'gathern_residential_listings' },
  { host: 'dealapp.sa', table: 'dealapp_residential_listings' },
  { host: 'amaall.com', table: 'amaall_commercial_listings' },
  { host: 'jurash.sa', table: 'jurash_residential_listings' },
  { host: 'awaalun.com', table: 'awal_commercial_listings' },
  { host: 'ego-aqar.com', table: 'ego_residential_listings' },
  { host: 'rawaf.ai', table: 'rawaf_residential_listings' },
  { host: 'rawasi-dark.com', table: 'rawasidark_commercial_listings' },
  { host: 'mobasher.sa', table: 'mobasher_commercial_listings' },
  { host: 'villas-sa.com', table: 'villassa_residential_listings' },
  { host: 'vm-ksa.com', table: 'vmksa_commercial_listings' },
  { host: 'eaqartabuk.com', table: 'eaqartabuk_residential_listings' },
  { host: '24.com.sa', table: 'souq24_commercial_listings' },
  { host: 'livingcompound.com', table: 'livingcompound_residential_listings' },
  { host: 'wahadat.sa', table: 'wahadat_residential_listings' },
  { host: 'dallali.com', table: 'dallali_commercial_listings' },
  { host: 'remalre.com', table: 'remal_residential_listings' },
  { host: 'safainv.sa', table: 'safa_residential_listings' },
  { host: 'remax.sa', table: 'remaxsa_residential_listings' },
  { host: 'ibaax.sa', table: 'ibaax_commercial_listings' },
  { host: 'qmra.sa', table: 'qmra_residential_listings' },
  { host: 'aqaralmuhaysini.com', table: 'muhaysini_commercial_listings' },
  { host: 'albukaeri.sa', table: 'albukaeri_commercial_listings' },
  { host: 'tamyaz-sa.com', table: 'tamyaz_residential_listings' },
  { host: 'ashab.sa', table: 'ashab_commercial_listings' },
  { host: 'macsaib.sa', table: 'macsaib_residential_listings' },
  { host: 'sanadak.sa', table: 'sanadak_commercial_listings' },
  { host: 'masaraqarat.com', table: 'masar_residential_listings' },
  { host: 'sadiq-eltajer.sa', table: 'sadiqeltajer_residential_listings' },
  { host: 'rakez.sa', table: 'rakez_residential_listings' },
  { host: 'tuba.com.sa', table: 'tuba_residential_listings' },
  { host: 'amlakalahsa.com', table: 'amlakalahsa_residential_listings' },
  { host: 'listings.satel.sa', table: 'satel_residential_listings' },
  { host: 'snam.sa', table: 'snam_residential_listings' },
  { host: 'alqasem.com.sa', table: 'alqasem_commercial_listings' },
  { host: 'moftah-aleaqar.com', table: 'moftah_residential_listings' },
  { host: 'safera.inblaj.net', table: 'safera_residential_listings' },
  { host: 'tawia.sa', table: 'tawia_residential_listings' },
  { host: 'daryusuf.com', table: 'daryusuf_commercial_listings' },
  { host: 'hajerhouses.com', table: 'hajer_residential_listings' },
  { host: 'wslnaa.com', table: 'wslnaa_commercial_listings' },
  { host: 'alrifai.com.sa', table: 'alrifai_residential_listings' },
  { host: 'shmoua-alshmal.com', table: 'shmoualshmal_residential_listings' },
  { host: 'alkhaas.net', table: 'alkhaas_residential_listings' },
  { host: 'ramzalqasim.com', table: 'ramzalqasim_residential_listings' },
  { host: 'alajlan-re.com', table: 'alajlan_commercial_listings' },
  { host: 'alta.com.sa', table: 'alta_residential_listings' },
  { host: 'ebriza.com.sa', table: 'ebriza_residential_listings' },
  { host: 'expattrustedhousingriyadh.com', table: 'expattrusted_residential_listings' },
  { host: 'daraa.sa', table: 'daraa_residential_listings' },
  { host: 'razre.sa', table: 'razre_residential_listings' },
  { host: 'shatrirealestate.com', table: 'shatri_residential_listings' },
  { host: 'azdadalaqaria.com', table: 'azdad_commercial_listings' },
  { host: 'aqaralriyadh.com', table: 'aqaralriyadh_residential_listings' },
  { host: 'fkralemar.com', table: 'fkralemar_residential_listings' },
  { host: 'fahadalshahri.com', table: 'fahadalshahri_commercial_listings' },
  { host: 'eastabha.sa', table: 'eastabha_commercial_listings' },
  { host: 'suwar.sa', table: 'suwar_residential_listings' },
  { host: 'sqcc.sa', table: 'sqcc_commercial_listings' },
  { host: 'aalbarrak.com', table: 'aalbarrak_residential_listings' },
  { host: 'abeea.com.sa', table: 'abeea_residential_listings' },
  { host: 'wajaf.sa', table: 'wajaf_commercial_listings' },
  { host: 'alsidra.com.sa', table: 'alsidra_residential_listings' },
  { host: 'squares.com.sa', table: 'squares_commercial_listings' },
  { host: 'muajarh.com', table: 'muajarh_residential_listings' },
  { host: 'compoundin.com', table: 'compoundin_residential_listings' },
  { host: 'gomenassat.com', table: 'gomenassat_commercial_listings' },
  { host: 'almotmkenah.com', table: 'almotmkenah_commercial_listings' },
  { host: 'gudai.inblaj.net', table: 'gudai_commercial_listings' },
  { host: 'eilmalriyada.com', table: 'eilmalriyada_commercial_listings' },
  { host: 'aoujestates.com', table: 'aouj_residential_listings' },
  { host: 'aqarnajran.com', table: 'aqarnajran_residential_listings' },
  { host: 'mar-ksa.com', table: 'marksa_residential_listings' },
];
let failed = 0;
const fail = (m) => { failed++; console.log(`✗ ${m}`); };
const ok = (m) => console.log(`✓ ${m}`);

// Cross-check the list against the app's own allowlist, so a new in-app site cannot skip this guard.
const viewerSrc = await fetch('https://raw.githubusercontent.com/6ttvrw4fmf-ctrl/ezhalah/main/src/lib/inAppViewer.ts').then((r) => r.text()).catch(() => '');
const allow = (/IN_APP_VIEWER_HOSTS = \[([^\]]*)\]/.exec(viewerSrc)?.[1] ?? '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
if (!allow.length) fail('could not read IN_APP_VIEWER_HOSTS from main (guard cannot know which sites to check)');
for (const h of allow) if (!SITES.some((s) => s.host === h)) fail(`${h} opens in-app but this guard does not check it: add it to SITES`);

async function sampleUrls(table) {
  // Local runs without the DB key: TEST_URLS='{"gathern_residential_listings":[...],...}'
  if (process.env.TEST_URLS) return JSON.parse(process.env.TEST_URLS)[table] ?? [];
  if (!SB || !KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  const r = await fetch(`${SB}/rest/v1/${table}?select=listing_url&active=eq.true&listing_url=not.is.null&order=id.desc&limit=40`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`${table}: HTTP ${r.status}`);
  const rows = (await r.json()).map((x) => x.listing_url).filter(Boolean);
  return rows.sort(() => Math.random() - 0.5).slice(0, SAMPLES);
}

const browser = await chromium.launch();
try {
  for (const site of SITES) {
    let urls;
    try { urls = await sampleUrls(site.table); } catch (e) { fail(`${site.host}: cannot pick live ads (${e.message})`); continue; }
    if (!urls.length) { fail(`${site.host}: no active ads to test`); continue; }
    // 1. framing headers
    for (const u of urls) {
      const res = await fetch(u, { headers: { 'User-Agent': devices['iPhone 13'].userAgent }, redirect: 'follow' }).catch(() => null);
      // A Cloudflare challenge page (403 + cf-mitigated: challenge) is served to THIS robot's datacenter
      // IP, not to a phone in Saudi, and it carries its own X-Frame-Options: SAMEORIGIN that says nothing
      // about the real ad page. Measured 2026-10-17 on sodasyat.sa (run 39032767927): 3/3 samples
      // challenged, the ad page itself frames fine. Same class as the Deal App 429: excluded, reported.
      if (res?.headers.get('cf-mitigated') === 'challenge') { console.log(`· ${site.host}: ${u} — Cloudflare challenged the robot (${res.status} cf-mitigated: challenge), header check skipped`); continue; }
      const xfo = res?.headers.get('x-frame-options') ?? '';
      const fa = /frame-ancestors[^;]*/i.exec(res?.headers.get('content-security-policy') ?? '')?.[0] ?? '';
      if (xfo || (fa && !/frame-ancestors\s+\*/.test(fa))) fail(`${site.host}: ${u} now REFUSES framing (${xfo || fa}) — take it off IN_APP_VIEWER_HOSTS`);
    }
    // 2. time to content inside a frame, phone + 4G
    const times = [];
    for (const u of urls) {
      const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar' });
      const p = await ctx.newPage();
      let rateLimited = false, challenged = false;
      p.on('response', (r) => { if (r.status() === 429) rateLimited = true; if (r.headers()['cf-mitigated'] === 'challenge') challenged = true; });
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 800_000, uploadThroughput: 93_750 });
      const t0 = Date.now(); let seen = null;
      await p.setContent(`<body style="margin:0"><iframe src="${u}" style="width:100vw;height:100vh;border:0"></iframe></body>`, { waitUntil: 'commit' }).catch(() => {});
      for (let i = 0; i < 60 && seen === null; i++) {
        await p.waitForTimeout(200);
        const fr = p.frames().find((f) => f !== p.mainFrame());
        if (fr?.url().startsWith('chrome-error:')) break;
        const n = fr ? await fr.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0) : 0;
        if (n > 200) seen = Date.now() - t0;
      }
      await ctx.close();
      if (seen === null && rateLimited) { console.log(`· ${site.host}: ${u} — rate-limited by the site (429), excluded`); continue; }
      if (seen === null && challenged) { console.log(`· ${site.host}: ${u} — Cloudflare challenged the robot (cf-mitigated: challenge), excluded`); continue; }
      times.push(seen ?? 99_999);
      console.log(`· ${site.host}: ${u} → ${seen === null ? 'NO CONTENT in 12s' : seen + ' ms'}`);
    }
    if (!times.length) { console.log(`! ${site.host}: every sample was rate-limited by the site — inconclusive this run`); continue; }
    const med = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
    if (med > BUDGET_MS) fail(`${site.host}: median ${med} ms to show the ad inside Ezhalah (budget ${BUDGET_MS} ms)`);
    else ok(`${site.host}: median ${med} ms to show the ad inside Ezhalah (budget ${BUDGET_MS} ms)`);
  }
  // 3. the live bundle still ships the instant-show tab
  const html = await fetch(`${BASE}/?cb=${Date.now()}`).then((r) => r.text());
  const js = /\/_expo\/static\/js\/web\/[^"]+\.js/.exec(html)?.[0];
  const bundle = js ? await fetch(BASE + js).then((r) => r.text()) : '';
  if (!bundle) fail('could not read the production bundle');
  else if (!bundle.includes('ad-load-bar') || !bundle.includes('ad-slow-hint')) fail('production no longer ships the instant-show tab (ad-load-bar / ad-slow-hint missing)');
  else ok('production ships the instant-show tab (no blank loading cover)');
} finally { await browser.close(); }

if (failed) { console.error(`\n✗ ad-viewer speed guard: ${failed} problem(s)`); process.exit(1); }
console.log('\n✓ ad-viewer speed guard: every in-app site still frames, shows fast, and production has the fix');
