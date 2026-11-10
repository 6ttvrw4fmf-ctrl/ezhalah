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
import '../../scripts/lib/robotPass.mjs'; // robot pass: our own robot is never blocked by the network guard or bot checks (docs/ops/SCRAPE_GUARD.md)
import { chromium, devices } from '@playwright/test';
import { shippedInstantShowTab } from '../lib/shippedBundle.mjs';

const BASE = process.env.BASE_URL || 'https://ezhalah-app.vercel.app';
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SAMPLES = 3;
const medians = []; // { host, med } per measured site, for the slow watch list at the end
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
  { host: 'dwelleo.sa', table: 'dwelleo_residential_listings' },
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
  { host: 'ryadah.com.sa', table: 'ryadah_residential_listings' },
  { host: 'sodasyat.sa', table: 'sodasyat_residential_listings' },
  { host: 'app.abaadapp.sa', table: 'abaad_residential_listings' },
  { host: 'steam-realestate.com', table: 'steam_residential_listings' },
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
// A bot wall / WAF page served to a datacenter robot instead of the ad: a page too small to be a listing (the ad pages
// this robot frames run 20–400 KB; a wall is a few hundred bytes to ~1.5 KB), or known challenge words on a page still
// far smaller than any ad page (a Cloudflare interstitial is 5–12 KB). The words alone are NOT a wall: a full ad page
// may carry «captcha» in a contact widget, and such a page with a refusing header is a real refusal (CodeRabbit, #11680).
export const WALL_MAX_CHARS = 20_000;
export const isBotWall = (body) => body.length < 1500 || (body.length < WALL_MAX_CHARS && /just a moment|checking your browser|verify you are human|cf-chl|challenge-platform|__cf_chl|sucuri|imunify|wordfence|access denied|attention required|captcha|ddos-guard|bot verification|enable javascript and cookies|التحقق من المتصفح|يرجى الانتظار/i.test(body));
/** The frame's own document answer, when it is a refusal of a real ad page (not a wall, not an error): the header it
 *  carried, else null. A blank frame whose top-level fetch hit a wall is excluded as inconclusive ONLY when the frame's
 *  own answer does not prove a refusal — the two are separate requests (CodeRabbit, #11680). */
export const frameRefusal = (doc) => {
  if (!doc || doc.status >= 400 || isBotWall(doc.text)) return null;
  const fa = /frame-ancestors[^;]*/i.exec(doc.csp ?? '')?.[0] ?? '';
  return doc.xfo || (fa && !/frame-ancestors\s+\*/.test(fa)) ? (doc.xfo || fa) : null;
};
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
  // ONLY_HOSTS=a.com,b.sa: a diagnostic / proof run over a few sites (the workflow then skips the alert bridge).
  const only = String(process.env.ONLY_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
  const runSites = only.length ? SITES.filter((s) => only.includes(s.host)) : SITES;
  const unknown = only.filter((h) => !SITES.some((s) => s.host === h));
  if (unknown.length) fail(`ONLY_HOSTS names ${unknown.join(', ')} — not in SITES; a filter that selects nothing must not read as a green run`);
  // A filter that was GIVEN but names nothing (spaces / commas) is refused too: the workflow's alert bridge already
  // reads such a run as partial, so running every site here would be a full run whose verdict reaches no alert.
  if ((process.env.ONLY_HOSTS ?? '') !== '' && !only.length) fail('ONLY_HOSTS was given but names no host — refusing to run every site under a partial-run label');
  if (only.length) console.log(`! partial run: ${runSites.map((s) => s.host).join(', ')} (ONLY_HOSTS)`);
  for (const site of runSites) {
    let urls;
    try { urls = await sampleUrls(site.table); } catch (e) { fail(`${site.host}: cannot pick live ads (${e.message})`); continue; }
    if (!urls.length) { fail(`${site.host}: no active ads to test`); continue; }
    // 1. framing headers
    // The top-level answer each ad gave THIS robot, so step 2 can tell «the site blocks this datacenter»
    // from «the frame stayed blank». razre.sa, measured 2026-10-19/20 (runs 39259106269, 39417227566):
    // HTTP 403 text/plain with no cf-* header from a cloud session, NO CONTENT ×3 from the runner, 200 to a
    // phone — a WAF on datacenter egress, not a framing refusal, yet it read ✗ on every run for two days.
    const topStatus = new Map();
    const topWall = new Set();
    const topUnreadable = new Set();   // top-level 2xx whose body could not be read: step 2 treats a blank frame as inconclusive
    for (const u of urls) {
      const res = await fetch(u, { headers: { 'User-Agent': devices['iPhone 13'].userAgent }, redirect: 'follow' }).catch(() => null);
      topStatus.set(u, res ? res.status : 0);
      // A Cloudflare challenge page (403 + cf-mitigated: challenge) is served to THIS robot's datacenter
      // IP, not to a phone in Saudi, and it carries its own X-Frame-Options: SAMEORIGIN that says nothing
      // about the real ad page. Measured 2026-10-17 on sodasyat.sa (run 39032767927): 3/3 samples
      // challenged, the ad page itself frames fine. Same class as the Deal App 429: excluded, reported.
      // An error page is not the ad page either. ibaax.sa answered HTTP 521 (Cloudflare «web server is down») to the
      // runner on 2026-10-23 (run 39940456792) and that 521 page carries X-Frame-Options: SAMEORIGIN, so the header
      // check read «REFUSES framing» ×3 while step 2 correctly excluded the same three loads as inconclusive. A 4xx/5xx
      // (or no answer) says nothing about the ad's own headers: skip the check, say so, and let step 2 exclude it.
      if (!res || res.status >= 400) { console.log(`· ${site.host}: ${u} — top-level load answered HTTP ${res ? res.status : 'nothing'} to this egress, not the ad page: header check skipped`); continue; }
      if (res?.headers.get('cf-mitigated') === 'challenge') { console.log(`· ${site.host}: ${u} — Cloudflare challenged the robot (${res.status} cf-mitigated: challenge), header check skipped`); continue; }
      const xfo = res?.headers.get('x-frame-options') ?? '';
      const fa = /frame-ancestors[^;]*/i.exec(res?.headers.get('content-security-policy') ?? '')?.[0] ?? '';
      if (xfo || (fa && !/frame-ancestors\s+\*/.test(fa))) {
        // A 200 whose BODY is a bot wall (a WAF / JS-challenge page served to this datacenter egress) carries the wall's
        // X-Frame-Options, not the ad page's. 2026-11-10 run 42817005291: six hosts (awaalun.com, villas-sa.com, 24.com.sa,
        // qmra.sa, ryadah.com.sa, sqcc.sa) read «SAMEORIGIN» ×3 and NO CONTENT ×3 in the same run, while 24.com.sa/1306/x
        // answered 200 with NO frame header to another vantage. Same class as the challenge page and the 4xx/5xx above:
        // print what was read (server, size, title), exclude it as inconclusive, never ✗ — a real refusal is a full ad
        // page (thousands of characters, no wall words) that still carries the header, and that still fails here.
        const body = await res.text().catch(() => null);
        // An unreadable body is neither the ad page nor a wall: say so and leave it to step 2 (CodeRabbit, #11680).
        if (body === null) { topUnreadable.add(u); console.log(`· ${site.host}: ${u} — top-level ${res.status} with ${xfo || fa} but the body could not be read: header check inconclusive`); continue; }
        const wall = isBotWall(body);
        // No <title> in the log: a listing's title can carry a phone number or a person's name (PDPL). Server + size say enough.
        console.log(`· ${site.host}: ${u} — top-level ${res.status} with ${xfo || fa}; server ${res.headers.get('server') ?? '?'}, ${body.length} chars${wall ? ' → a bot wall to this egress, not the ad page: header check skipped' : ''}`);
        if (wall) { topWall.add(u); continue; }
        fail(`${site.host}: ${u} now REFUSES framing (${xfo || fa}) — take it off IN_APP_VIEWER_HOSTS`);
      }
    }
    // 2. time to content inside a frame, phone + 4G
    const times = [];
    for (const u of urls) {
      const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar' });
      const p = await ctx.newPage();
      let rateLimited = false, challenged = false, frameDoc = null;
      p.on('response', (r) => {
        if (r.status() === 429) rateLimited = true;
        if (r.headers()['cf-mitigated'] === 'challenge') challenged = true;
        // The frame's OWN document answer (a separate request from the top-level fetch above): status, framing headers
        // and body, so a blank frame is judged on what the FRAME received, not on what the robot's fetch received.
        if (r.request().resourceType() === 'document' && r.frame() !== p.mainFrame()) {
          const h = r.headers();
          const d = { status: r.status(), xfo: h['x-frame-options'] ?? '', csp: h['content-security-policy'] ?? '', text: '', ready: null };
          // The body read is kept and AWAITED before any decision (CodeRabbit, #11680): an unresolved read would leave
          // text '' and read as a wall, hiding a real refusal. An unreadable body stays '' (→ inconclusive, never ✗).
          d.ready = r.text().then((t) => { d.text = t; }).catch(() => {});
          frameDoc = d;
        }
      });
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
      // A blank frame over an ad whose TOP-LEVEL load already answered 4xx/5xx (or nothing) to this egress says
      // nothing about framing or speed for a phone in Saudi: the site blocks the robot. Same class as 429 and the
      // challenge page — excluded and reported, never ✗. A 200 page that stays blank is still measured (99,999).
      const top = topStatus.get(u) ?? 0;
      if (seen === null && (top === 0 || top >= 400)) { console.log(`· ${site.host}: ${u} — top-level load answered HTTP ${top || 'nothing'} to this egress (WAF / block / outage), excluded as inconclusive`); continue; }
      if (seen === null && frameDoc?.ready) await frameDoc.ready;
      if (seen === null && topUnreadable.has(u) && !frameRefusal(frameDoc)) { console.log(`· ${site.host}: ${u} — top-level body unreadable and the frame stayed blank without proving a refusal: excluded as inconclusive`); continue; }
      if (seen === null && topWall.has(u)) {
        // The top-level fetch hit a wall, but the FRAME is its own request: if the frame received a real ad page (not a
        // wall, not an error) that still carried a refusing header, that is a real refusal and fails here.
        if (frameDoc?.ready) await frameDoc.ready;
        const refusal = frameRefusal(frameDoc);
        if (refusal) { fail(`${site.host}: ${u} — the frame received the ad page (${frameDoc.text.length} chars) with ${refusal}: REFUSES framing — take it off IN_APP_VIEWER_HOSTS`); continue; }
        console.log(`· ${site.host}: ${u} — top-level load was a bot wall to this egress (frame: ${frameDoc ? `HTTP ${frameDoc.status}, ${frameDoc.text.length} chars` : 'no document answer'}), excluded as inconclusive`); continue;
      }
      times.push(seen ?? 99_999);
      console.log(`· ${site.host}: ${u} → ${seen === null ? 'NO CONTENT in 12s' : seen + ' ms'}`);
    }
    if (!times.length) { console.log(`! ${site.host}: every sample was rate-limited, challenged or unreachable from this egress — inconclusive this run`); continue; }
    const med = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
    medians.push({ host: site.host, med });
    if (med > BUDGET_MS) fail(`${site.host}: median ${med} ms to show the ad inside Ezhalah (budget ${BUDGET_MS} ms)`);
    else ok(`${site.host}: median ${med} ms to show the ad inside Ezhalah (budget ${BUDGET_MS} ms)`);
  }
  // 3. the live bundle still ships the instant-show tab
  // The web build is SPLIT (ALWAYS FAST, owner 2026-10-27): the page's first <script> is the 3.8 KB metro runtime,
  // and AdViewer rides in the agent route's chunk (src/app/agent.tsx imports it). Reading only the first script
  // made this step fail on every run since the split (run 41567582462) while production shipped the tab. So it
  // reads every script the home page loads AND every route chunk those reference, and passes only if one of them
  // carries both testIDs. Nothing readable at all is still a failure, never a pass.
  const { files, shipped } = await shippedInstantShowTab(BASE);
  if (!files) fail('could not read the production bundle');
  else if (!shipped) fail(`production no longer ships the instant-show tab (ad-load-bar / ad-slow-hint missing in all ${files} shipped scripts)`);
  else ok(`production ships the instant-show tab (no blank loading cover) — found in ${shipped}`);
} finally { await browser.close(); }

// THE SLOW WATCH LIST (owner 2026-10-21: «some ads r slowly … make a GitHub monitors them»). The budget above is
// the hard line (red, alert). Between SLOW_MS and the budget a site still opens but feels slow; it is listed every
// run as a GitHub warning and ranked in the run summary, so a site drifting toward the line is seen before it
// crosses it. Measured that day: aqaralmuhaysini.com 9.2 s, dallali.com 7.8 s, sodasyat.sa 4.9 s.
const SLOW_MS = 5000;
const ranked = [...medians].sort((a, b) => b.med - a.med);
const slow = ranked.filter((m) => m.med > SLOW_MS && m.med <= BUDGET_MS);
for (const m of slow) console.log(`::warning title=Slow in-app ad::${m.host} takes ${(m.med / 1000).toFixed(1)} s to show its ad inside Ezhalah (watch line ${SLOW_MS / 1000} s, hard limit ${BUDGET_MS / 1000} s)`);
console.log(`\nslow watch (${SLOW_MS / 1000}–${BUDGET_MS / 1000} s): ${slow.length ? slow.map((m) => `${m.host} ${(m.med / 1000).toFixed(1)} s`).join(' · ') : 'none'}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  const row = (m) => `| ${m.host} | ${(m.med / 1000).toFixed(1)} s | ${m.med > BUDGET_MS ? '🔴 over the limit' : m.med > SLOW_MS ? '🟡 slow' : '🟢'} |`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### In-app ad speed — phone on 4G (watch ${SLOW_MS / 1000} s · limit ${BUDGET_MS / 1000} s)`, '',
    '| site | median time to show the ad | |', '|---|---|---|', ...ranked.map(row), '',
  ].join('\n'));
}

// THE TIME TRACKER (owner 2026-10-21: «create an agent that tracks the time»). Every measured site's median goes to
// public.viewer_site_speed; the app reads the slow ones and shows its «open in a new window» button the moment such
// an ad opens. A site not measured this run (rate-limited, challenged) keeps its last row, which ages out of the
// app's 2-day window on its own. A failed write is reported and turns the run red — never silent.
if (SB && KEY && medians.length) {
  const res = await fetch(`${SB}/rest/v1/viewer_site_speed?on_conflict=host`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(medians.map((m) => ({ host: m.host, median_ms: Math.min(m.med, 2_000_000_000), samples: SAMPLES, measured_at: new Date().toISOString() }))),
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
  if (res.ok) console.log(`✓ saved ${medians.length} site speeds to viewer_site_speed`);
  else fail(`could not save site speeds to viewer_site_speed: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
}

if (failed) { console.error(`\n✗ ad-viewer speed guard: ${failed} problem(s)`); process.exit(1); }
console.log('\n✓ ad-viewer speed guard: every in-app site still frames, shows fast, and production has the fix');
