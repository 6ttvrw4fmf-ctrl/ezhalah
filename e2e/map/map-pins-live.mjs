// MAP PIN ROBOT (owner 2026-11-05: «we can never have this issue … make a robot that checks these things … so so many
// duplicated listings, we need to make sure they are in the same pin close by … user cannot select what he wants»).
// Runs every hour and after each production deploy (.github/workflows/map-pins-live.yml); a red run raises an alert for
// the engineers (alert_event → GitHub issue). Read-only; uses the robot pass. One phone browser, a few map reads.
//
// On the real ezhalah.com, like a user on a phone: open the Map tab, go to street level over the densest places we
// know — the 504 m² land scheme in حي البوادي, Jeddah (~35 heads within 30 m, the same plots on several sites), and a
// street in حي الشراع — at two zoom levels each, and check what the user sees:
//   1. NO TWO PINS OVERLAP: every pair of price/count heads on screen is apart (src/lib/mapPins.ts mergeOverlapping);
//   2. EVERY PIN CAN BE TAPPED: the point at the centre of each head belongs to that head, not to one drawn over it;
//   3. THE COUNT NAMES THE DISTRICT: the pill says «… في حي …», not «في هذه المنطقة», over a view inside one district;
//   4. NOT VACUOUS: the densest view shows pins at all (a map that draws nothing would pass 1-2 trivially).
// The per-PR half is scripts/verify-map-pins-never-overlap.ts (the merge rule executed on random layouts).
import '../../scripts/lib/robotPass.mjs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://ezhalah.com';
const SPOTS = [
  { name: 'Jeddah, حي البوادي land scheme', lat: 21.61325, lng: 39.15777, spans: [0.0025, 0.006], district: 'البوادي', minPins: 5 },
  { name: 'Jeddah, حي الشراع street', lat: 21.76547, lng: 39.08574, spans: [0.003, 0.006], district: 'الشراع', minPins: 1 },
];

let failed = 0;
const say = (ok, label, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`); if (!ok) failed++; };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar' });
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.text().startsWith('DIAGBLOCK')) console.log(msg.text()); });
  await page.goto(`${BASE}/?pinwatch=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByText('بحث', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByText('الضروري فقط', { exact: true }).click({ timeout: 3_000 }).catch(() => {});
  await page.locator('[role=tab]', { hasText: 'خريطة' }).first().click();
  await page.waitForFunction(() => location.pathname === '/map' && !!window.mapkit?.maps?.length, null, { timeout: 30_000 });

  for (const spot of SPOTS) {
    for (const span of spot.spans) {
      await page.evaluate(({ lat, lng, span }) => {
        const mk = window.mapkit; const m = mk.maps[mk.maps.length - 1];
        m.setRegionAnimated(new mk.CoordinateRegion(new mk.Coordinate(lat, lng), new mk.CoordinateSpan(span, span)), false);
      }, { lat: spot.lat, lng: spot.lng, span });
      // DIAG (🔧 2026-11-06, alert 13321): what the page really holds after the move — region, annotations, DOM heads, pill.
      await page.waitForTimeout(4000);
      const diag = await page.evaluate(() => {
        const mk = window.mapkit; const m = mk?.maps?.[mk.maps.length - 1];
        const r = m?.region; const anns = m?.annotations ?? [];
        return { path: location.pathname, maps: mk?.maps?.length ?? 0, center: r ? [r.center.latitude.toFixed(5), r.center.longitude.toFixed(5)] : null,
          span: r ? [r.span.latitudeDelta.toFixed(5), r.span.longitudeDelta.toFixed(5)] : null, annotations: anns.length,
          annSample: anns.slice(0, 3).map((a) => ({ lat: a.coordinate?.latitude?.toFixed(5), lng: a.coordinate?.longitude?.toFixed(5), el: a.element?.outerHTML?.slice(0, 160) })),
          domPins: document.querySelectorAll('[data-testid=map-pin]').length, anyTestids: [...new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')))].slice(0, 40),
          pill: document.querySelector('[data-testid=map-pin-count]')?.textContent ?? null, bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400) };
      });
      console.log(`DIAG ${spot.name} span ${span}: ${JSON.stringify(diag)}`);
      await page.screenshot({ path: `diag-${spot.district}-${span}.png`, fullPage: false }).catch(() => {});
      // Settled = the set of heads has not changed for 1.5 s (the map reads, merges and draws after the move ends).
      await page.waitForFunction(() => {
        const sig = [...document.querySelectorAll('[data-testid=map-pin]')].map((e) => e.textContent).join('|') + '#' + (document.querySelector('[data-testid=map-pin-count]')?.textContent ?? '');
        const w = window; if (w.__pinSig !== sig) { w.__pinSig = sig; w.__pinAt = performance.now(); return false; }
        return performance.now() - w.__pinAt > 1500;
      }, null, { timeout: 25_000, polling: 100 }).catch(() => {});
      const seen = await page.evaluate(() => {
        const pins = [...document.querySelectorAll('[data-testid=map-pin]')].map((e) => ({ e, r: e.getBoundingClientRect(), t: e.textContent }))
          .filter(({ r }) => r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);
        const overlaps = [];
        for (let a = 0; a < pins.length; a++) for (let b = a + 1; b < pins.length; b++) {
          const A = pins[a].r, B = pins[b].r;
          const dx = Math.min(A.right, B.right) - Math.max(A.left, B.left), dy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
          if (dx > 1 && dy > 1) overlaps.push(`«${pins[a].t}» × «${pins[b].t}»`);
        }
        // Tappable = the first PIN in the painted stack at the head's centre is this head (another head drawn over it would
        // come first). The stack, not the top hit: a transparent layer above the map is not a pin covering a pin.
        const blocked = pins.filter(({ e, r }) => {
          const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const firstPin = stack.findIndex((x) => !!x.closest('[data-testid=map-pin]'));
          const bad = firstPin < 0 || stack[firstPin].closest('[data-testid=map-pin]') !== e;
          if (bad) console.log('DIAGBLOCK', JSON.stringify({ head: e.textContent, rect: [r.left | 0, r.top | 0, r.width | 0, r.height | 0], stack: stack.slice(0, 4).map((x) => ({ tag: x.tagName, testid: x.getAttribute('data-testid'), cls: x.className?.toString().slice(0, 40), text: x.textContent?.slice(0, 20), rect: (() => { const q = x.getBoundingClientRect(); return [q.left | 0, q.top | 0, q.width | 0, q.height | 0]; })() })) }));
          return bad;
        }).map(({ t }) => `«${t}»`);
        return { count: pins.length, overlaps, blocked, pill: document.querySelector('[data-testid=map-pin-count]')?.textContent ?? '' };
      });
      const where = `${spot.name} (span ${span}°)`;
      say(seen.overlaps.length === 0, `${where}: no two pins overlap (${seen.count} on screen)`, seen.overlaps.slice(0, 8).join(', '));
      say(seen.blocked.length === 0, `${where}: every pin can be tapped`, `covered: ${seen.blocked.slice(0, 8).join(', ')}`);
      if (span === spot.spans[0]) {
        say(seen.count >= spot.minPins, `${where}: the map shows pins at all (≥ ${spot.minPins})`, `${seen.count} pins`);
        say(seen.pill.includes(spot.district) && !seen.pill.includes('هذه المنطقة'), `${where}: the count names the district («${seen.pill}»)`, `expected «${spot.district}» in the pill`);
      }
    }
  }
  await ctx.close();
} catch (e) {
  console.error(`FAIL  the journey could not complete: ${e.message}`);
  failed++;
} finally {
  await browser.close();
}
if (failed) { console.error(`\n❌ map pin robot: ${failed} problem(s) — the engineers get this as an alert.`); process.exit(1); }
console.log('\nmap pin robot: no overlapping pins, every pin tappable, the count names the district');
