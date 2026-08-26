// LIVE: the AI-agent flow's «خلّنا نحدد الطلب أكثر» must never be offered and then render nothing.
//
// The sibling scripts/verify-af-live-truth.ts reaches Advanced Filter through the FILTER flow only.
// On 2026-08-26 that was the difference between green and the truth: the identical cohort
// (Rent-Annual/Apartment/Riyadh, chip 10,670) opened AF from the Filter flow and rendered NOTHING
// from the agent flow, on the same deployed bundle — so the live check stayed green while the
// feature was unreachable for anyone who arrived through the chat. This closes that gap by driving
// the entry path the user actually took.
//
// The rule itself is pure and mutation-proven offline in scripts/verify-af-offer-agreement.ts
// (in `npm test`); this file only OBSERVES production and hands the observation to it.
//
//   node --experimental-strip-types scripts/verify-af-agent-cta-live.ts
//   (run from .github/workflows/af-live-truth-check.yml — deliberately NOT in `npm test`, same
//    precedent as every other live check here: `npm test` is hermetic and runs in seconds.)

import { chromium } from 'playwright';
import { judgeAfCta, type AfCtaObservation } from './lib/afOfferAgreement.ts';

const BASE = 'https://ezhalah-app.vercel.app';

// Journeys are ARABIC free text plus the answers the agent's disambiguation needs — exactly what a
// real user types. A city that is also a region needs «مدينة …»; «تقصد المدينة كاملة…» needs
// «المدينة كاملة» (harness notes, docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md).
const JOURNEYS: Array<{ name: string; say: string[]; mobile?: boolean }> = [
  { name: 'agent · Riyadh · Rent-Annual · apartments',
    say: ['ابغى شقة للإيجار السنوي في الرياض', 'مدينة الرياض', 'المدينة كاملة'] },
  { name: 'agent · Riyadh · Buy · villas',
    say: ['ابغى فيلا للبيع في الرياض', 'مدينة الرياض', 'المدينة كاملة'] },
  { name: 'agent · Jeddah · Buy · apartments (non-Riyadh)',
    say: ['ابغى شقة للبيع في جدة', 'المدينة كاملة'] },
  { name: 'agent · Riyadh · Rent-Annual · apartments (MOBILE)',
    say: ['ابغى شقة للإيجار السنوي في الرياض', 'مدينة الرياض', 'المدينة كاملة'], mobile: true },
];

const failures: string[] = [];
const report: string[] = [];

// The agent disables the composer while it is working, so a bare fill+Enter silently no-ops. Wait
// for the message to ECHO into the transcript, then for the working indicators to clear.
const IDLE = ['يفكر', 'يبحث'];

async function settle(page: import('playwright').Page, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const body = await page.innerText('body').catch(() => '');
    if (!IDLE.some((w) => body.includes(w))) { await page.waitForTimeout(1200); return; }
    await page.waitForTimeout(1000);
  }
}

async function say(page: import('playwright').Page, text: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ta = page.locator('textarea, input[type=text]').first();
    await ta.click();
    await ta.fill(text);
    await page.keyboard.press('Enter');
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(500);
      if ((await page.innerText('body').catch(() => '')).includes(text)) {
        await page.waitForTimeout(1200);
        await settle(page);
        return;
      }
    }
  }
  throw new Error(`message never landed in the transcript: ${text}`);
}

const run = async () => {
  const browser = await chromium.launch();
  for (const j of JOURNEYS) {
    const ctx = await browser.newContext(
      j.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
    const page = await ctx.newPage();
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.waitForTimeout(2500);
      await page.click('text=الوكيل الذكي', { timeout: 30_000 });
      await page.waitForTimeout(1500);
      for (const m of j.say) await say(page, m);
      await page.waitForTimeout(6000);

      const cta = page.locator('[data-testid="results-narrow"]');
      const ctaOffered = (await cta.count()) > 0;
      let cardEverAppeared = false;
      let loadingEverAppeared = false;

      if (ctaOffered) {
        await cta.last().click();
        // Sample across the whole window: a card that opens and then closes itself is NOT a pass,
        // and the actions row hiding at any point proves ageFlow was set (the round did start).
        for (let i = 0; i < 60; i++) {          // 60 × 500ms = 30s
          await page.waitForTimeout(500);
          if ((await cta.count()) === 0) loadingEverAppeared = true;
          if ((await page.locator('[data-testid="af-card"]').count()) > 0) { cardEverAppeared = true; break; }
        }
      }

      const o: AfCtaObservation = { ctaOffered, cardEverAppeared, loadingEverAppeared, journey: j.name };
      const verdict = judgeAfCta(o);
      if (verdict.ok) {
        report.push(`PASS  ${j.name} — ${verdict.reason}`);
      } else {
        failures.push(verdict.diagnosis);
        report.push(`FAIL  ${j.name} — ${verdict.reason}`);
      }
    } catch (e) {
      // A harness failure is reported as a failure, never swallowed into a pass.
      failures.push(`${j.name}: harness error — ${(e as Error).message}`);
      report.push(`ERROR ${j.name}`);
    } finally {
      await ctx.close();
    }
  }
  await browser.close();
};

await run();

for (const line of report) console.log(line);
if (failures.length) {
  console.error('\n✗ verify-af-agent-cta-live FAILED\n');
  for (const f of failures) console.error(`   • ${f}\n`);
  process.exit(1);
}
console.log(`\n✓ AF agent-flow CTA agreement holds across ${JOURNEYS.length} live journeys.`);
