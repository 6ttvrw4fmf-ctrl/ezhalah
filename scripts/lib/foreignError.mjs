// Is an uncaught browser error ENTIRELY another website's code? (2026-10-29, root cause of the «built app runs» flake)
//
// React #419 failed ~6% of «built app runs» for weeks. Once the smoke recorded stacks, every frame was
// https://sanadak.sa/_next/static/... — a source site's own Next.js page, loaded while a journey opened a listing,
// crashing inside ITS React. That is not Ezhalah's code and no change to Ezhalah can fix it, yet it failed our PRs.
//
// An error is foreign only when its stack HAS frames and EVERY frame's origin differs from the app's origin. No stack,
// or any frame from our origin (or a relative/anonymous frame), keeps it an Ezhalah crash: the default stays «fail».
const FRAME_URL = /\b(https?:\/\/[^\s)]+?):\d+:\d+/g;

/** @param {string} stack  @param {string} appUrl  @returns {boolean} */
export function isForeignOnlyError(stack, appUrl) {
  let appOrigin;
  try { appOrigin = new URL(appUrl).origin; } catch { return false; }
  const urls = [...String(stack || '').matchAll(FRAME_URL)].map((m) => m[1]);
  if (urls.length === 0) return false;
  return urls.every((u) => { try { return new URL(u).origin !== appOrigin; } catch { return false; } });
}
