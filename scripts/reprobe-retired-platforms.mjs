// A RETIREMENT IS A CLAIM WITH AN EXPIRY DATE. THIS IS THE ONLY THING THAT RE-CHECKS IT.
//
// WHY THIS EXISTS (owner, 2026-09-19): "a retirement without a proper excuse is a failure — if the
// site is up, turn it back on." He was right, and the gap was structural, not an oversight by one
// person: retiring a platform removes it from every active matrix, and the daily health report only
// walks the ACTIVE list. From the moment a platform is retired, NOTHING looks at it again. Every
// existing reference to RETIRED_PLATFORMS.txt is a guard that keeps a retired slug OUT
// (test_retired_platforms_guard.py); not one of them ever asks whether the reason still holds.
//
// The cost was measured: toor was retired 2026-07-06 for "host IP-blocks datacenter IPs". On
// 2026-09-19 that was simply no longer true — sitemap and detail pages return HTTP 200 from a clean
// egress. It had been false for an unknown number of weeks and nobody could have noticed, because
// nothing was watching. Two other platforms, jazwtn and awal, came back the same way and were only
// caught because a human happened to re-probe them. That is luck, not process.
//
// WHAT THIS DOES: for each retired slug, fetch its recorded home URL and report whether the site
// answers. It deliberately does NOT decide to un-retire — bringing a platform back needs a human
// (toor answers HTTP 200 and still serves one sample listing for every PropertyId, so "it responds"
// is necessary, never sufficient). The output is a prompt to LOOK, which is exactly what was absent.
//
//   node scripts/reprobe-retired-platforms.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Home URL per retired slug. Kept here rather than guessed from the slug so a probe can never
// silently test the wrong host and report a healthy stranger as the retired platform.
const HOMES = {
  toor:     'https://www.toor.ooo/sitemap_properties_1.xml',
  alnokhba: 'https://alnokhba-services.com/',
  // `deal` is api.dealapp.sa — the SAME site the active dealapp pipeline covers. Probing it would
  // always say "alive" and always be the wrong conclusion, so it is excluded by name, not omitted
  // by accident.
  // `muktamel` is not retired; it runs on its own weekly workflow.
};
const SKIP = new Set(['deal', 'muktamel']);

// RESPONDING IS NOT THE SAME AS USABLE, and for toor the difference is stated by toor itself.
// Its own pages carry a banner reading «نسخة تجريبية (المعلومات الواردة في هذا الموقع, ليست حقيقية
// وهي تستخدم لأمور التطوير التقني)» — "trial version, the information on this site is NOT REAL, it
// is used for technical development". That single sentence explains every symptom we measured: one
// sample listing repeated across 30 PropertyIds, licence 7201112446 on all of them, and a JSON-LD
// name of «الاسم». The site is a beta running on dummy data.
//
// So a plain HTTP 200 from toor must never read as "ready to wire" — it was 200 all along. The
// signal that toor went REAL is that banner DISAPPEARING. Each entry below is a disqualifier: a
// marker whose PRESENCE means the platform is still not usable no matter what the status code says.
// A second page is fetched for the check when the probe URL itself would not carry the banner (the
// sitemap is XML and never does).
const DISQUALIFIERS = {
  toor: {
    url: 'https://toor.ooo/Platform',
    marker: 'ليست حقيقية',
    means: 'toor still self-declares its data as NOT REAL (نسخة تجريبية banner). '
         + 'Wiring it would publish fabricated properties. When this banner is GONE, '
         + 'toor has gone live — re-verify six PropertyIds give six different licences, then wire it.',
  },
};


const slugs = readFileSync(join(root, 'scrapers/RETIRED_PLATFORMS.txt'), 'utf8')
  .split('\n').map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

if (slugs.length === 0) {
  console.error('✗ RETIRED_PLATFORMS.txt yielded no slugs — refusing to report a clean sweep from an empty list');
  process.exit(1);
}

const probes = slugs.filter(s => !SKIP.has(s));
let alive = 0;
console.log(`re-probing ${probes.length} retired platform(s) (skipping ${[...SKIP].join(', ')}):\n`);

for (const slug of probes) {
  const url = HOMES[slug];
  if (!url) {
    console.log(`  ?  ${slug.padEnd(12)} no home URL recorded — add one to HOMES so it can be re-probed`);
    continue;
  }
  let status = null, bytes = 0, err = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } });
    clearTimeout(t);
    status = r.status;
    bytes = (await r.arrayBuffer()).byteLength;
  } catch (e) { err = e.name === 'AbortError' ? 'timeout' : String(e.message || e).slice(0, 60); }

  const responding = status !== null && status >= 200 && status < 400 && bytes > 500;
  if (responding) {
    // Responding is necessary, never sufficient. If this slug has a disqualifier, check it.
    const dq = DISQUALIFIERS[slug];
    let stillBlocked = null, dqErr = null;
    if (dq) {
      try {
        const c2 = new AbortController();
        const t2 = setTimeout(() => c2.abort(), 25000);
        const r2 = await fetch(dq.url, { signal: c2.signal, redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } });
        clearTimeout(t2);
        stillBlocked = (await r2.text()).includes(dq.marker);
      } catch (e) { dqErr = e.name === 'AbortError' ? 'timeout' : String(e.message || e).slice(0, 50); }
    }
    if (dq && stillBlocked === true) {
      console.log(`  ·  ${slug.padEnd(12)} responding, STILL DISQUALIFIED  http=${status}`);
      console.log(`       ${dq.means}`);
    } else if (dq && stillBlocked === false) {
      alive++;
      console.log(`  ★  ${slug.padEnd(12)} RESPONDING **AND THE DISQUALIFIER IS GONE**  http=${status}`);
      console.log(`       «${dq.marker}» no longer appears on ${dq.url} — this platform may have gone live. INVESTIGATE.`);
    } else if (dq && stillBlocked === null) {
      console.log(`  ?  ${slug.padEnd(12)} responding, but the disqualifier check FAILED (${dqErr}) — treat as unknown, not clear`);
    } else {
      alive++;
      console.log(`  ●  ${slug.padEnd(12)} RESPONDING  http=${status} ${bytes}b  ${url}`);
    }
  } else {
    console.log(`  ·  ${slug.padEnd(12)} down        ${err ?? `http=${status} ${bytes}b`}  ${url}`);
  }
}

console.log('');
if (alive > 0) {
  console.log(`⚠  ${alive} retired platform(s) cleared every check we know how to run. That is not`);
  console.log('   permission to un-retire — it is a prompt to LOOK. Re-read the recorded reason,');
  console.log('   and for any listings source verify that several different listing URLs return');
  console.log('   DIFFERENT identifiers before believing the site is usable.');
} else {
  console.log('✅ every retired platform is still genuinely unreachable — the reasons on file hold.');
}
