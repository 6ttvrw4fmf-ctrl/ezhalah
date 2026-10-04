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
    const box = await welcome.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(12);
    expect(box!.y).toBeGreaterThan(200);
    const mic = await page.getByTestId('voice-mic').boundingBox();
    const send = page.getByLabel('بحث', { exact: true });
    const sendBox = await send.boundingBox();
    expect(sendBox!.x).toBeGreaterThan(mic!.x);
    await page.screenshot({ path: `/tmp/ez-welcome-${viewport.width}.png` });
    const input = page.locator('textarea, input[aria-label]').last();
    await input.fill('أبي شقة');
    await expect(welcome).toBeVisible();
    await send.click();
    await expect(welcome).toHaveCount(0);
    await expect(page.getByText('أبي شقة', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('agent-footer')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
