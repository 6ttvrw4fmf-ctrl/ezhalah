// WARM THE PLATFORM LOGOS BEFORE THE SEARCH NEEDS THEM (owner 2026-10-25: «logos take time to show»).
//
// The search loader draws up to ~148 platform pills; each pill's logo is a bundled PNG (12.5 MB in all, some 480 KB) that the browser
// only started to download when the pill was first drawn, i.e. AFTER «بحث» was pressed. On a phone the names appeared and the logos
// arrived seconds later. This downloads them quietly beforehand, a few at a time (never competing with the app's own requests), so the
// loader finds them in the browser's cache. It changes no logo, no layout and no timing of the loader itself.
//
// Rules: web only; one run per page load; skipped on data-saver and 2G; 3 downloads in flight; a failed logo never stops the rest;
// the loader's own roster first (that is what the first search draws), then the rest of the picker's.
import { Image as RNImage, Platform } from 'react-native';
import { PLATFORM_META } from '@/data/loaderPlatforms';
import { PLATFORM_PICKER_PROFILES } from '@/data/platformPickerProfiles';
import { shouldSkipWarm, warmQueue } from '@/lib/warmQueue';

/** The bundled logo assets, the loader's roster first, each once. */
export function logoAssetsInOrder(): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const a of [...PLATFORM_META.map((p) => p.logo), ...Object.values(PLATFORM_PICKER_PROFILES).map((p) => p.logo)]) {
    if (typeof a === 'number' && !seen.has(a)) { seen.add(a); out.push(a); }
  }
  return out;
}

let started = false;
const loadOne = (uri: string) => new Promise<void>((resolve) => {
  const img = new window.Image();
  img.decoding = 'async';
  img.onload = () => resolve();
  img.onerror = () => resolve();
  img.src = uri;
});

/** Idempotent. Call at idle after load, and again (free) when the visitor touches the search box. */
export function warmPlatformLogos(): void {
  if (started || Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return;
  if (shouldSkipWarm((navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection)) return;
  started = true;
  const uris = logoAssetsInOrder().map((a) => RNImage.resolveAssetSource(a)?.uri).filter((u): u is string => !!u);
  void warmQueue(uris, loadOne);
}
