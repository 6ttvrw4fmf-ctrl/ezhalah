// WHAT THE IN-APP AD PAGE MAY READ BEYOND THE CARD (owner 2026-10-10).
//
// 1. THE PIN. A map is drawn ONLY from the two coordinates the SOURCE published for that very ad —
//    search_listings_ar.latitude / longitude, read by (source_table, listing_id). Never a district
//    centroid, never a geocoded address, never one half of a pair: a pin we did not get from the
//    source is a guess, and the label on the map says «as published by {site}». 27% of listings carry
//    a pair today (wasalt 67%, aqar 0% — aqar's own pins come in a later step).
// 2. ASKING PRICES AROUND THIS AD. For the same type · deal · city · district, every live site's rows,
//    each HOUSE counted once (licence number + area; else platform + price + area), junk prices
//    skipped, and only the numbers: p10 · median · p90 · median per m². No judgement word, ever —
//    «أرقام فقط، والقرار لك». Hidden when fewer than 10 houses match. Truth check 2026-10-10, الرمال
//    villas for sale: 1,545 houses from 2,151 rows, p10 1.19M, median 1.95M, p90 2.9M, 6,498/m².
// Every read is bounded (boundedRpc) and cached per ad for the session. A read that failed is NOT an
// empty answer: null here means «nothing to show» — never an invented pin or a made-up number — and
// the failure is forgotten so the next open retries.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { hiddenPlatformNames, loadHiddenPlatformNames } from '@/data/loaderActivePlatforms';
import { pickerSourceSlugs } from '@/data/platformPickerProfiles';
import type { Listing } from '@/data/listings';

export type GeoPoint = { lat: number; lng: number };

/** The ad's own search_listings_ar row, as PostgREST hands it over (numerics arrive as strings). */
export type AdRow = {
  latitude?: unknown; longitude?: unknown;
  type_ar?: string | null; deal_ar?: string | null; city_ar?: string | null; district_ar?: string | null;
  price_total?: unknown; area_m2?: unknown; license_number?: string | null; platform?: string | null;
};
const AD_ROW_SELECT = 'latitude,longitude,type_ar,deal_ar,city_ar,district_ar,price_total,area_m2,license_number,platform';

const num = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;

/** The pin WE may draw from a source row: both coordinates, or nothing. */
export function mapPoint(row: { latitude?: unknown; longitude?: unknown } | null | undefined): GeoPoint | null {
  if (!row) return null;
  const lat = num(row.latitude), lng = num(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // ponytail: a 0 on either axis is the classic unset default, not a Saudi address — treated as silent.
  if (lat === 0 || lng === 0) return null;
  return { lat, lng };
}

/** Google's keyless embed: satellite with labels (t=h), the app's language. z=14 shows the surrounding
 *  landmarks on the first screen; the full-screen view opens one step closer (15). */
export const mapEmbedUrl = (p: GeoPoint, hl: string = 'ar', z: 14 | 15 = 14) =>
  `https://maps.google.com/maps?q=${p.lat},${p.lng}&z=${z}&t=h&hl=${hl}&output=embed`;

export type AdPage = { geo: GeoPoint | null; row: AdRow | null };
const EMPTY_PAGE: AdPage = { geo: null, row: null };
const pageCache = new Map<string, Promise<AdPage>>();

/** The opened ad's own index row → its pin and the keys the asking-price box needs. One bounded read. */
export function fetchAdPage(l: Pick<Listing, 'id' | 'sourceTable'>): Promise<AdPage> {
  if (!supabase || !l.sourceTable) return Promise.resolve(EMPTY_PAGE);
  const key = `${l.sourceTable}:${l.id}`;
  let p = pageCache.get(key);
  if (!p) {
    p = boundedRpc<AdRow[]>(
      supabase.from('search_listings_ar').select(AD_ROW_SELECT).eq('source_table', l.sourceTable).eq('listing_id', l.id).limit(1),
    ).then(({ data, error }) => {
      if (error) { pageCache.delete(key); return EMPTY_PAGE; }
      const own = data?.[0] ?? null;
      const geo = mapPoint(own);
      return { geo, row: own };
    });
    pageCache.set(key, p);
  }
  return p;
}

// ── asking prices ───────────────────────────────────────────────────────────────────────────────
export type PriceRow = { platform?: string | null; license_number?: string | null; area_m2?: unknown; price_total?: unknown };
export type AskingPrices = { houses: number; p10: number; median: number; p90: number; medianPpm: number | null };
// A sale price under 100k or over 500M SAR is a typo or a per-metre figure in the wrong column, not a house.
const PRICE_MIN = 100_000;
const PRICE_MAX = 500_000_000;
const MIN_HOUSES = 10;

const percentile = (sorted: number[], q: number): number => {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Each house once (licence + area; else platform + price + area — the lowest figure a house is listed at),
 *  down sites out, junk prices out; null under MIN_HOUSES. Pure, so the barrier executes it. */
export function askingPriceStats(rows: PriceRow[], downSlugs: Set<string>): AskingPrices | null {
  const best = new Map<string, { price: number; area: number }>();
  for (const r of rows) {
    const platform = String(r.platform ?? '').trim().toLowerCase();
    if (!platform || downSlugs.has(platform)) continue;
    const price = num(r.price_total);
    if (!Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) continue;
    const area = num(r.area_m2);
    const lic = String(r.license_number ?? '').trim();
    const key = lic ? `${lic}|${area}` : `${platform}|${price}|${area}`;
    const cur = best.get(key);
    if (!cur || price < cur.price) best.set(key, { price, area });
  }
  if (best.size < MIN_HOUSES) return null;
  const prices = [...best.values()].map((h) => h.price).sort((a, b) => a - b);
  const ppm = [...best.values()].filter((h) => h.area > 0).map((h) => h.price / h.area).sort((a, b) => a - b);
  return {
    houses: best.size,
    p10: percentile(prices, 0.1), median: percentile(prices, 0.5), p90: percentile(prices, 0.9),
    medianPpm: ppm.length ? percentile(ppm, 0.5) : null,
  };
}

/** The platform slugs of the sites the registry marks down — unknown names are simply not mapped. */
function downPlatformSlugs(): Set<string> {
  const out = new Set<string>();
  for (const name of hiddenPlatformNames() ?? []) {
    try { for (const slug of pickerSourceSlugs([name])) out.add(slug.toLowerCase()); } catch { /* a name the snapshot does not know */ }
  }
  return out;
}

const PAGE = 1000;       // PostgREST's default max-rows
const MAX_PAGES = 3;     // ponytail: 3,000 rows covers every district today (الرمال villas = 2,151)
const pricesCache = new Map<string, Promise<AskingPrices | null>>();

/** Every row of the same type · deal · city · district, bounded page by page, then the pure stats. SALE only
 *  (price_total); a rent box would need price_annual and its own junk band — not built. */
export function fetchAskingPrices(row: AdRow | null): Promise<AskingPrices | null> {
  if (!supabase || !row || row.deal_ar !== 'بيع' || !row.type_ar || !row.city_ar || !row.district_ar) return Promise.resolve(null);
  const key = `${row.type_ar}|${row.city_ar}|${row.district_ar}`;
  let p = pricesCache.get(key);
  if (!p) {
    const client = supabase;
    p = (async () => {
      await loadHiddenPlatformNames();   // the registry's down list, once per session (bounded inside)
      const rows: PriceRow[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error } = await boundedRpc<PriceRow[]>(
          client.from('search_listings_ar').select('platform,license_number,area_m2,price_total')
            .eq('type_ar', row.type_ar).eq('deal_ar', 'بيع').eq('city_ar', row.city_ar).eq('district_ar', row.district_ar)
            .not('price_total', 'is', null).range(page * PAGE, page * PAGE + PAGE - 1),
        );
        if (error) { pricesCache.delete(key); return null; }
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      return askingPriceStats(rows, downPlatformSlugs());
    })();
    pricesCache.set(key, p);
  }
  return p;
}
