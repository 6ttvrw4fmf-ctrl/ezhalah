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
// 3. THE SAME AD ON OTHER SITES. Two index rows are the same ad when they share the advertiser's licence
//    number AND the exact area, on different platforms (owner 2026-10-10; test pair: aqar 13462300 ↔
//    wasalt 7392441, 1,100,000 vs 1,250,000 — the price is NOT part of the key, each site's own price
//    is exactly what the row shows).
// 4. THE MINISTRY'S ACTUAL SALES. public.moj_district_sales (filled weekly) — the ministry's own numbers,
//    shown unaltered: the period comes from the row's window_from / window_to, never from the clock, and
//    avg_ppm is their mean of per-deal m² prices, never recomputed from totals.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { hiddenPlatformNames, loadHiddenPlatformNames } from '@/data/loaderActivePlatforms';
import { pickerSourceSlugs } from '@/data/platformPickerProfiles';
import { fetchListingCards } from '@/data/remote';
import { CLEAN_MACRO, CLEAN_TO_TYPE_AR } from '@/data/propertyTypes';
import type { Listing } from '@/data/listings';

export type GeoPoint = { lat: number; lng: number };

/** The ad's own search_listings_ar row, as PostgREST hands it over (numerics arrive as strings). */
export type AdRow = {
  source_table?: string; listing_id?: number | string;
  latitude?: unknown; longitude?: unknown;
  type_ar?: string | null; deal_ar?: string | null; city_ar?: string | null; district_ar?: string | null;
  price_total?: unknown; area_m2?: unknown; license_number?: string | null; platform?: string | null;
};
const AD_ROW_SELECT = 'latitude,longitude,type_ar,deal_ar,city_ar,district_ar,price_total,area_m2,license_number,platform,source_table,listing_id';

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

/** The map embed: Google's official Maps Embed API (satellite) when the owner's key is set in the build
 *  (EXPO_PUBLIC_GOOGLE_MAPS_EMBED_KEY — never logged, never hardcoded), else today's keyless embed with
 *  satellite + labels (t=h). z=14 shows the surrounding landmarks on the first screen; the full-screen
 *  view opens one step closer (15). Always both coordinates: the caller holds a mapPoint(). */
export const mapEmbedUrl = (p: GeoPoint, hl: string = 'ar', z: 14 | 15 = 14): string => {
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_EMBED_KEY;
  return key
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${p.lat},${p.lng}&zoom=${z}&maptype=satellite&language=${hl}`
    : `https://maps.google.com/maps?q=${p.lat},${p.lng}&z=${z}&t=h&hl=${hl}&output=embed`;
};

// THE PRICES BLOCK SHIPS FOR AQAR SALE ADS ONLY for now (owner 2026-10-10, update 22): platform «aqar» and
// deal «بيع», every property type. A rent ad or any other platform renders no block at all.
export function pricesBlockEligible(row: AdRow | null | undefined): boolean {
  return !!row && String(row.platform ?? '').trim().toLowerCase() === 'aqar' && String(row.deal_ar ?? '').trim() === 'بيع';
}

// The words follow the type (owner: never «فلل» on a non-villa). Arabic counts 3–10 with the plural and
// everything else with the singular; a type the map does not know keeps its own singular.
const TYPE_PLURAL_AR: Record<string, string> = {
  'فيلا': 'فلل', 'شقة': 'شقق', 'دور': 'أدوار', 'عمارة': 'عمارات', 'عمارة سكنية': 'عمارات سكنية', 'عمارة تجارية': 'عمارات تجارية',
  'أرض': 'أراضي', 'أرض سكنية': 'أراضي سكنية', 'أرض تجارية': 'أراضي تجارية', 'أرض زراعية': 'أراضي زراعية', 'أرض صناعية': 'أراضي صناعية',
  'محل': 'محلات', 'مكتب': 'مكاتب', 'مستودع': 'مستودعات', 'استراحة': 'استراحات', 'شاليه': 'شاليهات', 'غرفة': 'غرف', 'بيت': 'بيوت',
  'مزرعة': 'مزارع', 'ملحق': 'ملاحق', 'دوبلكس': 'دوبلكسات', 'مجمع': 'مجمعات', 'صالة': 'صالات', 'معرض': 'معارض', 'مصنع': 'مصانع',
  'فندق': 'فنادق', 'مخطط': 'مخططات', 'مبنى': 'مبانٍ', 'تاون هاوس': 'تاون هاوس', 'بنتهاوس': 'بنتهاوس', 'ستوديو': 'ستوديوهات',
};
export const typePluralAr = (typeAr: string): string => TYPE_PLURAL_AR[typeAr.trim()] ?? typeAr.trim();
export const typeWordAr = (n: number, typeAr: string): string => (n >= 3 && n <= 10 ? typePluralAr(typeAr) : typeAr.trim());

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
export type PriceRow = { platform?: string | null; license_number?: string | null; area_m2?: unknown; price_total?: unknown; type_ar?: string | null };
export type House = { price: number; area: number };
// mean / meanPpm are what the split card prints (owner update 23: like for like with the ministry's
// means); median / medianPpm stay for any surface that wants them. meanPpm = mean of per-house price ÷ area.
export type AskingPrices = { houses: number; p10: number; median: number; p90: number; mean: number; medianPpm: number | null; meanPpm: number | null; each: House[] };
// A sale price under 100k or over 500M SAR is a typo or a per-metre figure in the wrong column, not a house.
const PRICE_MIN = 100_000;
const PRICE_MAX = 500_000_000;
const MIN_HOUSES = 10;

const percentile = (sorted: number[], q: number): number => {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Each house once (licence + type + area; else platform + type + price + area — the lowest figure a house
 *  is listed at), down sites out, junk prices out; null under MIN_HOUSES. Pure, so the barrier executes it. */
export function askingPriceStats(rows: PriceRow[], downSlugs: Set<string>): AskingPrices | null {
  const best = new Map<string, { price: number; area: number }>();
  for (const r of rows) {
    const platform = String(r.platform ?? '').trim().toLowerCase();
    if (!platform || downSlugs.has(platform)) continue;
    const price = num(r.price_total);
    if (!Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) continue;
    const area = num(r.area_m2);
    const lic = String(r.license_number ?? '').trim();
    const type = String(r.type_ar ?? '').trim();
    const key = lic ? `${lic}|${type}|${area}` : `${platform}|${type}|${price}|${area}`;
    const cur = best.get(key);
    if (!cur || price < cur.price) best.set(key, { price, area });
  }
  if (best.size < MIN_HOUSES) return null;
  const prices = [...best.values()].map((h) => h.price).sort((a, b) => a - b);
  const ppm = [...best.values()].filter((h) => h.area > 0).map((h) => h.price / h.area).sort((a, b) => a - b);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    houses: best.size,
    p10: percentile(prices, 0.1), median: percentile(prices, 0.5), p90: percentile(prices, 0.9), mean: mean(prices),
    medianPpm: ppm.length ? percentile(ppm, 0.5) : null, meanPpm: ppm.length ? mean(ppm) : null,
    each: [...best.values()],
  };
}

/** Of every 10 houses in the DEDUPED set, how many cost more per m² than this ad (0–10); null without an ad m² price. */
export function dearerTenths(each: House[], adPpm: number): number | null {
  if (!Number.isFinite(adPpm) || adPpm <= 0) return null;
  const ppms = each.filter((h) => h.area > 0).map((h) => h.price / h.area);
  if (!ppms.length) return null;
  return Math.round((10 * ppms.filter((p) => p > adPpm).length) / ppms.length);
}

/** Same ad, other site: the licence number and the exact area agree, the platform differs. Price is not compared. */
export function isSameAd(own: AdRow, other: AdRow): boolean {
  const lic = String(own.license_number ?? '').trim();
  if (!lic || lic !== String(other.license_number ?? '').trim()) return false;
  const a = num(own.area_m2), b = num(other.area_m2);
  if (!Number.isFinite(a) || !(a > 0) || a !== b) return false;
  const p = String(own.platform ?? '').trim(), q = String(other.platform ?? '').trim();
  return !!p && !!q && p !== q;
}

// ── the ministry's actual sales ──────────────────────────────────────────────────────────────────
export type MojRow = { deals?: unknown; avg_deal?: unknown; avg_ppm?: unknown; p10_deal?: unknown; p90_deal?: unknown; window_from?: string | null; window_to?: string | null; source_refreshed_at?: string | null };
export type MojFacts = { deals: number; avgDeal: number; avgPpm: number; p10: number | null; p90: number | null; from: string; to: string };
const MOJ_MIN_DEALS = 10;

/** The ministry's numbers as the card shows them — unaltered; the period from the ROW's own two dates. Null under 10 deals. */
export function mojFacts(row: MojRow | null | undefined): MojFacts | null {
  if (!row) return null;
  const deals = num(row.deals), avgDeal = num(row.avg_deal), avgPpm = num(row.avg_ppm);
  const from = String(row.window_from ?? '').slice(0, 10), to = String(row.window_to ?? '').slice(0, 10);
  if (!Number.isFinite(deals) || deals < MOJ_MIN_DEALS || !Number.isFinite(avgDeal) || !Number.isFinite(avgPpm)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  // The ministry's own per-deal spread, when the job has filled it; a half-filled pair is no spread.
  const p10 = num(row.p10_deal), p90 = num(row.p90_deal);
  const spread = Number.isFinite(p10) && Number.isFinite(p90) && p10 > 0 && p90 >= p10;
  return { deals, avgDeal, avgPpm, p10: spread ? p10 : null, p90: spread ? p90 : null, from, to };
}

const mojCache = new Map<string, Promise<MojFacts | null>>();
export type MojClass = 'سكني' | 'تجاري';
/** One bounded read of moj_district_sales for this ad's city · district · class (سكني for residential types, تجاري for commercial). */
export function fetchMojSales(row: AdRow | null, cls: MojClass = 'سكني'): Promise<MojFacts | null> {
  if (!supabase || !row?.city_ar || !row.district_ar) return Promise.resolve(null);
  const key = `${row.city_ar}|${row.district_ar}|${cls}`;
  let p = mojCache.get(key);
  if (!p) {
    p = boundedRpc<MojRow[]>(
      supabase.from('moj_district_sales').select('deals,avg_deal,avg_ppm,p10_deal,p90_deal,window_from,window_to,source_refreshed_at')
        .eq('city_ar', row.city_ar).eq('district_ar', row.district_ar).eq('property_class', cls).limit(1),
    ).then(({ data, error }) => {
      if (error) { mojCache.delete(key); return null; }
      return mojFacts(data?.[0]);
    });
    mojCache.set(key, p);
  }
  return p;
}

// ── the same ad on other sites ───────────────────────────────────────────────────────────────────
const sameCache = new Map<string, Promise<Listing[]>>();
/** The OTHER sites' real cards for this ad (licence + area agree): one per platform, in index order. */
export function fetchSameAd(row: AdRow | null): Promise<Listing[]> {
  const lic = String(row?.license_number ?? '').trim();
  const area = num(row?.area_m2);
  if (!supabase || !row || !lic || !(area > 0)) return Promise.resolve([]);
  const key = `${lic}|${area}|${row.platform ?? ''}`;
  let p = sameCache.get(key);
  if (!p) {
    const own = row;
    p = (async () => {
      const { data, error } = await boundedRpc<AdRow[]>(
        supabase!.from('search_listings_ar').select('source_table,listing_id,platform,license_number,area_m2,price_total')
          .eq('license_number', lic).eq('area_m2', area).limit(50),
      );
      if (error) { sameCache.delete(key); return []; }
      // The predicate is re-run on the client: the row IS what the page shows. One row per platform.
      const seen = new Set<string>();
      const byTable = new Map<string, number[]>();
      for (const r of data ?? []) {
        if (!isSameAd(own, r) || !r.source_table || seen.has(String(r.platform))) continue;
        seen.add(String(r.platform));
        byTable.set(r.source_table, [...(byTable.get(r.source_table) ?? []), Number(r.listing_id)]);
      }
      const cards = await Promise.all([...byTable].map(([t, ids]) => fetchListingCards(t, ids)));
      return cards.flat();
    })();
    sameCache.set(key, p);
  }
  return p;
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
const MAX_PAGES = 8;     // ponytail: 8,000 rows covers every district today (الرمال residential = 5,821 rows); an RPC later
const pricesCache = new Map<string, Promise<AskingPrices | null>>();

// THE GROUPS THE SPLIT CARD COMPARES (owner update 24: «we follow what is in البيع الفعلي»). Our half uses
// the SAME group as the ministry's: a residential ad → every residential sale listing in the district —
// the owner's own list, which reproduces his numbers exactly (الرمال 2026-10-10: 3,728 / 2.11M / 7,815 /
// 0.67–2.6M); a commercial ad → the taxonomy's commercial types (CLEAN_MACRO) minus that list.
export const RESIDENTIAL_GROUP_AR: readonly string[] = ['فيلا', 'شقة', 'دور', 'أرض سكنية', 'تاون هاوس', 'عمارة', 'ملحق علوي'];
export const COMMERCIAL_GROUP_AR: readonly string[] = [...new Set(
  Object.keys(CLEAN_MACRO).filter((c) => CLEAN_MACRO[c] === 'Commercial').flatMap((c) => CLEAN_TO_TYPE_AR[c] ?? []),
)].filter((t) => !RESIDENTIAL_GROUP_AR.includes(t));
export type MacroGroup = 'Residential' | 'Commercial';
export const groupTypesAr = (g: MacroGroup): readonly string[] => (g === 'Commercial' ? COMMERCIAL_GROUP_AR : RESIDENTIAL_GROUP_AR);

/** The deduped stats of one scope: either this ad's own type (card 3) or its whole macro group (the split
 *  card's right half) — same deal · city · district, bounded page by page, then the pure stats. SALE only
 *  (price_total); a rent box would need price_annual and its own junk band — not built. */
function fetchScopeStats(row: AdRow, scope: { types: readonly string[]; key: string }): Promise<AskingPrices | null> {
  if (!supabase) return Promise.resolve(null);
  const key = `${scope.key}|${row.city_ar}|${row.district_ar}`;
  let p = pricesCache.get(key);
  if (!p) {
    const client = supabase;
    p = (async () => {
      await loadHiddenPlatformNames();   // the registry's down list, once per session (bounded inside)
      const rows: PriceRow[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error } = await boundedRpc<PriceRow[]>(
          client.from('search_listings_ar').select('platform,license_number,area_m2,price_total,type_ar')
            .in('type_ar', [...scope.types]).eq('deal_ar', 'بيع').eq('city_ar', row.city_ar as string).eq('district_ar', row.district_ar as string)
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
/** Card 3's set: this ad's OWN type only (villas against villas). */
export function fetchAskingPrices(row: AdRow | null): Promise<AskingPrices | null> {
  if (!row || row.deal_ar !== 'بيع' || !row.type_ar || !row.city_ar || !row.district_ar) return Promise.resolve(null);
  return fetchScopeStats(row, { types: [row.type_ar], key: `type:${row.type_ar}` });
}
/** The split card's set: the whole macro group the ministry's half is built on — never filtered to the ad's type. */
export function fetchGroupPrices(row: AdRow | null, group: MacroGroup): Promise<AskingPrices | null> {
  if (!row || row.deal_ar !== 'بيع' || !row.city_ar || !row.district_ar) return Promise.resolve(null);
  return fetchScopeStats(row, { types: groupTypesAr(group), key: `group:${group}` });
}
