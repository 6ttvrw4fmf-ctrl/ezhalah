import { test, expect } from '@playwright/test';

// No paid model calls: this exercises the real composer/turn lifecycle with a
// deterministic agent reply. Production searches are verified separately.
for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`static welcome and first turn at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/functions/v1/agent', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ kind: 'message', reply: 'وش المدينة اللي تبي تبحث فيها؟' }),
    }));
    await page.goto('/?fresh=welcome', { waitUntil: 'domcontentloaded' });
    await page.getByText('الوسيط الذكي', { exact: true }).click();
    const welcome = page.getByTestId('intro-greeting');
    await expect(welcome).toContainText('وش العقار اللي في بالك؟');
    await expect(welcome).toContainText('قل لنا مواصفاته، وإزهله.');
    // The greeting slides into place after it appears (measured 2026-10-05 at 390px: y 207 on first paint,
    // 333 once settled), so a single read races the animation (CI read 198.5 and failed). Measure the
    // SETTLED layout: the box must hold still for consecutive frames before any position is asserted.
    const settled = async (loc: ReturnType<typeof page.getByTestId>) => {
      let prev = await loc.boundingBox();
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(100);
        const cur = await loc.boundingBox();
        if (prev && cur && Math.abs(cur.x - prev.x) < 0.5 && Math.abs(cur.y - prev.y) < 0.5) return cur;
        prev = cur;
      }
      throw new Error('layout never settled within 6 s');
    };
    const box = await settled(welcome);
    expect(box).not.toBeNull();
    const footer = await settled(page.getByTestId('agent-footer'));
    // Desktop reserves room for the existing sidebar; center within the chat.
    expect(Math.abs(box!.x + box!.width / 2 - (footer!.x + footer!.width / 2))).toBeLessThan(12);
    expect(box!.y).toBeGreaterThan(200);
    const mic = await page.getByTestId('voice-mic').boundingBox();
    // The send arrow beside the mic. Since #6099 the composer also shows a «بحث» text button on its own
    // row (testID initial-chat-search) with the same accessible name, so the label alone matches two.
    const send = page.locator('[aria-label="بحث"]:not([data-testid="initial-chat-search"])');
    await expect(send).toHaveCount(1);
    const sendBox = await send.boundingBox();
    expect(sendBox!.x).toBeGreaterThan(mic!.x);
    await page.screenshot({ path: `/tmp/ez-welcome-${viewport.width}.png` });
    const input = page.locator('textarea, input[aria-label]').last();
    const query = 'أبي شقة'; // user input, not a product control label
    await input.fill(query);
    await expect(welcome).toBeVisible();
    await send.click();
    await expect(welcome).toHaveCount(0);
    await expect(page.getByText(query, { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('agent-footer')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
