// Rotating HOME hero headline (owner rule, 2026-09-23): "create a rotation whenever someone opens
// the website — instead of «تدور على عقار وتبي تشوف كل المعروض في مكان واحد؟ إزهله» he sees one of
// the 5, it changes". Same baked-pool shape as filterGreetingRotation.ts / resultsFoundRotation.ts.
//
// WHY THE PICK IS CLIENT-SIDE AND INDEX 0 IS THE SSR DEFAULT. app.json sets web output: 'static', so
// index.html is rendered ONCE at build time. A module-scope random pick would therefore be frozen
// into that file and every visitor would see the SAME tagline until the next deploy — the opposite
// of what was asked — and a random pick inside useState() would disagree with the pre-rendered HTML
// and trip a hydration text mismatch. So the render starts at index 0 (what the static HTML holds)
// and the real pick happens in a mount effect. It is invisible: the hero title starts at opacity 0
// (titleAnim = 0) and only rises in at +230 ms, so the swap lands before anything is on screen.
//
// WHY localStorage AND NOT Math.random(). "Rotation" means the next visit shows the NEXT line; a
// random pick repeats the same tagline one visit in five. The cursor is per-browser, survives a
// reload, and is a per-viewer convenience — a blocked/absent store just means the visitor starts at
// the top of the list again, never a crash and never a blank headline.
//
// The five lines are the owner's own, verbatim, with two orthographic corrections carried back to
// them in the same message: «كل الإعلانات العقارات» → «كل الإعلانات العقارية» (noun/adjective
// agreement) and «إبحث» → «ابحث» (hamzat wasl). Each key below is the ENGLISH source string, so the
// existing i18n dictionary supplies the Arabic exactly as every other string on the screen does.

export const HERO_TAGLINE_KEYS = [
  'One site to search every Saudi real-estate platform and website.',
  'Every property listing in the Kingdom, in one place',
  'The complete property site for every listing in the Kingdom, from every platform',
  'One site for every property you are looking for in the Kingdom, from every platform',
  'Search one site for the property you want across every real-estate platform and website, easily.',
] as const;

const CURSOR_KEY = 'ezhalah.heroTagline';

/**
 * The index to show for THIS visit, advancing one step per open. Pure of React, safe to call from a
 * mount effect. Never throws: a private window, a cleared store or a browser that refuses access
 * falls back to the first line rather than losing the headline.
 */
export function nextHeroTaglineIndex(): number {
  const n = HERO_TAGLINE_KEYS.length;
  try {
    const raw = globalThis?.localStorage?.getItem(CURSOR_KEY);
    const last = Number.parseInt(raw ?? '', 10);
    const next = Number.isInteger(last) ? (((last + 1) % n) + n) % n : 0;
    globalThis?.localStorage?.setItem(CURSOR_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

// Test-only: the pool itself, so a barrier can assert its exact size and its Arabic wording.
export const __testing = { CURSOR_KEY };
