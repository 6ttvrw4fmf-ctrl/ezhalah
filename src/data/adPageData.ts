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
  price_total?: unknown; area_m2?: unknown; license_number?: string | null; platform?: string | null; bedrooms?: unknown;
};
const AD_ROW_SELECT = 'latitude,longitude,type_ar,deal_ar,city_ar,district_ar,price_total,area_m2,license_number,platform,source_table,listing_id,bedrooms';

const num = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;

/** The pin WE may draw from a source row: both coordinates, or nothing. */
export function mapPoint(row: { latitude?: unknown; longitude?: unknown } | null | undefined): GeoPoint | null {
  if (!row) return null;
  const lat = num(row.latitude), lng = num(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // A 0 on either axis (the classic unset default) is caught here too: 0 has no decimals.
  // A point rounded to 2 decimals or fewer on either axis (±1 km at best) is an AREA, not a property's pin
  // (mapping audit 2026-10-21, the same rule as shared_default_pins() in 20261021114821). The database strips
  // such points from every table that keeps its pin in additional_info; wasalt keeps it in ar_data, where
  // that strip cannot reach, and served 443497 at exactly 25,49. The page therefore refuses it too, and the
  // ad falls back to its district / city border.
  if (isCoarse(lat) || isCoarse(lng)) return null;
  return { lat, lng };
}

/** At most 2 decimals: 24, 24.5, 24.47 → coarse; 24.471 → a real coordinate. */
export const isCoarse = (v: number): boolean => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

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
// A type the source never stated gets NO block: comparing it to «عقار سكني» or «تجاري» would be our guess.
// That is «غير معروف», and «أرض» — Other Land, a plot whose source states no usage at all (Aqar's
// «نوع العقار» absent and the seller silent; 4,040 Aqar plots on 2026-10-10, owner: no specific type).
export function pricesBlockEligible(row: AdRow | null | undefined): boolean {
  return !!row && String(row.platform ?? '').trim().toLowerCase() === 'aqar' && String(row.deal_ar ?? '').trim() === 'بيع'
    && !['', 'غير معروف', 'أرض'].includes(String(row.type_ar ?? '').trim());
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

// THE DISTRICT BORDER (owner 2026-10-17: «use the same Google map and … show the entire district
// exactly, all around the boundaries», then, shown both, «I like the one with the boundaries»). When the
// source published NO pin for an ad (both coordinates missing), the ad page asks the SAME free Google
// embed for the district by NAME — «حي X، City» — and Google itself fits the view to the district and
// draws its own dashed border around it. Free (the keyless embed, or the Embed API place mode with the
// owner's key — both $0, unlimited). Never a pin: Ezhalah's label reads «الموقع التقريبي» and the note
// says the site published no exact location. Where Google holds no border for a name it still centres
// on that district. Nothing here touches the pin path: mapPoint() is unchanged and a pin still needs
// BOTH published coordinates.
export type DistrictPlace = { query: string; district: string; city: string };
// + Wasalt (owner 2026-10-19: «map Wasalt like Aqar»). Its pin comes from the Arabic detail page; an ad
// whose page is not fetched yet (or truly has no pin) shows the district/city border meanwhile.
export const DISTRICT_MAP_PLATFORMS: readonly string[] = [
  'aqar', 'aqarmonthly', 'wasalt',
  // Owner 2026-10-19 («check; if they don't have a pin, do the district/city border»): the ten largest
  // native-preview sites. Ksaaqar and Mustqr publish no pin (3 ads each checked live; mustqr's API
  // restricts lat/lng); the other eight publish one that the scraper reads partly (arkaan, alshawaf)
  // or not yet (sakan, abralosol, nofodh, bossbih, aqalemhajer, reinvest) — the border bridges until it does.
  'sakan', 'abralosol', 'nofodh', 'arkaan', 'bossbih', 'ksaaqar', 'mustqr', 'aqalemhajer', 'alshawaf', 'reinvest',
  // Owner 2026-10-20 («we want more, not 4 — check all not inside the app»): EVERY remaining preview site
  // whose ads can lack a pin (47 sites, 12,653 pin-less ads measured that day). Sites that open inside the
  // app (IN_APP_VIEWER_HOSTS) show the source page itself and are not here. The border bridges until a
  // site's pin is read; a site whose page carries a pin is handled one by one, biggest first.
  'haraj', 'muktamel', 'ialqarawi', 'aqarcity', 'rightcompound', 'sirdab', 'therc', 'sokok',
  'raghdan', 'alsaedan', 'goldendeal', 'nufouth', 'akariyoun', 'sukna', 'aldarim', 'aqargate',
  'shomou', 'abwbna', 'aqaratikom', 'thousand', 'alobid', 'jazwtn', 'aljassim', 'manafe',
  'opensooq', 'justsa', 'senan', 'bahadhabab', 'erapulse', 'maqam', 'jawher', 'm3tmd',
  'azure', 'holoul', 'superoffice', 'alhoshan', 'arsh', 'flow', 'nowaisiry', 'hasaad',
  'almuteb', 'nawafeth', 'wadod', 'october', 'hazim', 'eydah', 'eightfloor',
  'razre',   // 2026-10-21: refuses framing now, so its ad opens on Ezhalah's page — 94 ads, all with a district, no pin
  'ibaax',   // 2026-10-22: refuses framing now (SAMEORIGIN), its ad opens on Ezhalah's page — 150 ads, all with a district, no pin
];
/** The place an Aqar ad's own link names, e.g. sa.aqar.fm/شارع-الصليحى-212-الفرعاء-منطقة-عسير-6836489 →
 *  «شارع الصليحى 212 الفرعاء منطقة عسير، السعودية». Only sa.aqar.fm; the trailing ad number is dropped; a
 *  link that names nothing but the country («المملكة-العربية-السعودية-…») names no place → null. */
export function aqarTownFromUrl(adUrl: string | null | undefined): string | null {
  let u: URL;
  try { u = new URL(String(adUrl ?? '')); } catch { return null; }
  if (u.hostname.replace(/^www\./, '').toLowerCase() !== 'sa.aqar.fm') return null;
  let seg = '';
  try { seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? ''); } catch { return null; }
  const words = seg.replace(/-\d+$/, '').split('-').map((w) => w.trim()).filter(Boolean);
  const text = words.join(' ').replace(/\s*المملكة العربية السعودية\s*/g, ' ').trim();
  if (!text || !/[؀-ۿ]/.test(text)) return null;
  return `${text}، السعودية`;
}
/** The district to show for an ad with no pin, from the ad's own row. Pure, exported for the barrier. */
export function districtPlace(row: AdRow | null | undefined, adUrl?: string | null): DistrictPlace | null {
  // Aqar (buy + rent) and Aqar Monthly only for now (owner 2026-10-17: «just do aqar now», then «do the
  // location thing for Aqar Monthly and rent, same style, just don't include the Ministry of Justice»);
  // other sites keep no map without a pin. The ministry block stays Aqar-sale-only (pricesBlockEligible).
  if (!DISTRICT_MAP_PLATFORMS.includes(String(row?.platform ?? '').trim().toLowerCase())) return null;
  const district = String(row?.district_ar ?? '').trim(), city = String(row?.city_ar ?? '').trim();
  // No city in our index (a small town outside the city list, owner 2026-10-17: «town fallback … if we have
  // the pin perfect, if not we do this boundaries»): the town as the SOURCE wrote it in the ad's own
  // address — the last segment of its sa.aqar.fm link — never a guess of ours.
  if (!city || city === 'غير معروف') { const town = aqarTownFromUrl(adUrl); return town ? { query: town, district: '', city: town } : null; }
  // No district written (owner 2026-10-17: «those with no district, we show the city»): the whole city,
  // Google's own city border around it — still labelled approximate, never a pin.
  if (!district || district === 'غير معروف') return { query: city, district: '', city };
  const named = /^حي\s/.test(district) ? district : `حي ${district}`;
  return { query: `${named}، ${city}`, district: named, city };
}
export const districtEmbedUrl = (d: DistrictPlace, hl: string = 'ar'): string => {
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_EMBED_KEY;
  const q = encodeURIComponent(d.query);
  return key
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${q}&maptype=satellite&language=${hl}`
    : `https://maps.google.com/maps?q=${q}&t=h&hl=${hl}&output=embed`;
};

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
export type AskingPrices = { houses: number; ads: number; sites: number; p10: number; median: number; p90: number; mean: number; medianPpm: number | null; meanPpm: number | null; each: House[] };
// A sale price under 100k or over 500M SAR is a typo or a per-metre figure in the wrong column, not a house.
// The ministry page the sold numbers come from: it embeds the public Power BI report «البورصة العقارية» (resource key in
// scrapers/moj/sales.py). Its response headers (X-Frame-Options SAMEORIGIN + CSP frame-ancestors: itself and Microsoft domains only)
// forbid showing it inside another site, so the link opens a NEW TAB — never an iframe (verified 2026-10-16).
export const MOJ_SOURCE_URL = 'https://moj.gov.sa/ar/OpenData/PowerBIReport/Pages/BIReportRealestate.aspx';
export const PRICE_MIN = 100_000;
export const PRICE_MAX = 500_000_000;
const MIN_HOUSES = 10;

const percentile = (sorted: number[], q: number): number => {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Each house once (licence + type + area; else platform + type + price + area — the lowest figure a house
 *  is listed at), down sites out, junk prices out; null under MIN_HOUSES. Pure, so the barrier executes it. */
export function askingPriceStats(rows: PriceRow[], downSlugs: Set<string>): AskingPrices | null {
  const best = new Map<string, { price: number; area: number }>();
  // What the numbers are made of, shown to the reader: the ADS that passed the filters (live site, sane price), the
  // distinct WEBSITES they came from, and — after the dedupe below — the houses. «1,433 ads from 38 sites → 1,160 houses».
  let ads = 0;
  const sites = new Set<string>();
  for (const r of rows) {
    const platform = String(r.platform ?? '').trim().toLowerCase();
    if (!platform || downSlugs.has(platform)) continue;
    const price = num(r.price_total);
    if (!Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) continue;
    ads++;
    sites.add(platform);
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
    houses: best.size, ads, sites: sites.size,
    p10: percentile(prices, 0.1), median: percentile(prices, 0.5), p90: percentile(prices, 0.9), mean: mean(prices),
    medianPpm: ppm.length ? percentile(ppm, 0.5) : null, meanPpm: ppm.length ? mean(ppm) : null,
    each: [...best.values()],
  };
}

/** A product tile equals the formula it DISPLAYS: the shown (rounded) per-m² figure × the shown area, to the
 *  nearest 1,000 — a reader who multiplies the two printed numbers gets our number (4,449 × 275 = 1,223,475
 *  → 1,223,000; the unrounded 4,449.37 would have printed 1,224,000). */
export function tileFromShown(ppm: number, area: number): number {
  return Math.round((Math.round(ppm) * Math.round(area)) / 1000) * 1000;
}

/** This ad against the DEDUPED same-type houses that have a per-m² price: exact counts dearer / cheaper per m²
 *  (an equal price per m² counts in neither), and the 10-glyph picture k = round(10·dearer/n) clamped so that
 *  a picture never shows 0 while some house is dearer, nor 10 while some house is cheaper (owner: «0 أغلى»
 *  printed for 36 of 1,493 was false). Null without an ad m² price or without houses. */
export type DearerSplit = { n: number; dearer: number; cheaper: number; k: number };
export function dearerSplit(each: House[], adPpm: number): DearerSplit | null {
  if (!Number.isFinite(adPpm) || adPpm <= 0) return null;
  const ppms = each.filter((h) => h.area > 0).map((h) => h.price / h.area);
  if (!ppms.length) return null;
  const n = ppms.length;
  const dearer = ppms.filter((p) => p > adPpm).length;
  const cheaper = ppms.filter((p) => p < adPpm).length;
  const raw = Math.round((10 * dearer) / n);
  const k = Math.min(cheaper > 0 ? 9 : 10, Math.max(dearer > 0 ? 1 : 0, raw));
  return { n, dearer, cheaper, k };
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
export type MojRow = { moj_region?: string | null; moj_area?: string | null; fetched_at?: string | null; deals?: unknown; avg_deal?: unknown; avg_ppm?: unknown; p10_deal?: unknown; p90_deal?: unknown; window_from?: string | null; window_to?: string | null; source_refreshed_at?: string | null };
export type MojFacts = { path: string | null; updatedAt: string | null; deals: number; avgDeal: number; avgPpm: number; p10: number | null; p90: number | null; from: string; to: string };
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
  // Where to find these sales in the ministry's own report: its hierarchical filter is Region / City / District, and the
  // ministry's area value reads «city/district» (الرياض/الملقا). The public report cannot be opened pre-filtered (Power BI
  // «publish to web» ignores URL filters — tested 2026-10-16), so the reader is told the exact picks instead.
  const region = String(row.moj_region ?? '').trim();
  const [city, district] = String(row.moj_area ?? '').split('/').map((x) => x.trim());
  const path = region && city && district ? `${region} / ${city} / ${district}` : null;
  // When WE last re-read the ministry (the weekly job's fetched_at) — the card says «updated weekly · last update …»
  // from this stored stamp, never from the clock.
  const updatedAt = /^\d{4}-\d{2}-\d{2}/.test(String(row.fetched_at ?? '')) ? String(row.fetched_at).slice(0, 10) : null;
  return { path, updatedAt, deals, avgDeal, avgPpm, p10: spread ? p10 : null, p90: spread ? p90 : null, from, to };
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
      supabase.from('moj_district_sales').select('moj_region,moj_area,fetched_at,deals,avg_deal,avg_ppm,p10_deal,p90_deal,window_from,window_to,source_refreshed_at')
        .eq('city_ar', row.city_ar).eq('district_ar', row.district_ar).eq('property_class', cls).limit(1),
    ).then(({ data, error }) => {
      if (error) { mojCache.delete(key); return null; }
      return mojFacts(data?.[0]);
    });
    mojCache.set(key, p);
  }
  return p;
}

// ── the ministry's deals, one row each (owner 2026-10-16: «the exact same transactions») ────────────────────────────
// The public report cannot be opened pre-filtered, so the page lists the deals themselves from public.moj_district_deals
// (filled by the same weekly job as the aggregates): the ministry's own date, m², price and per-deal m² price, unaltered.
export type MojDeal = { ref: string; date: string; area: number; price: number; ppm: number };
const MOJ_DEALS_LIMIT = 500;
/** The stored deals as the sheet lists them: newest first, and ONLY rows whose every value is present — the m² price is
 *  the ministry's own column, never price ÷ area recomputed here. Pure, so the barrier executes it. */
export function mojDealRows(data: unknown): MojDeal[] {
  if (!Array.isArray(data)) return [];
  const out: MojDeal[] = [];
  for (const r of data as Record<string, unknown>[]) {
    const date = String(r?.deal_date ?? '').slice(0, 10), ref = String(r?.deal_ref ?? '').trim();
    const area = num(r?.area_m2), price = num(r?.price), ppm = num(r?.ppm);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !ref || !Number.isFinite(area) || !(area > 0) || !Number.isFinite(price) || !Number.isFinite(ppm)) continue;
    out.push({ ref, date, area, price, ppm });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.ref < b.ref ? 1 : a.ref > b.ref ? -1 : 0));
}
const dealsCache = new Map<string, Promise<MojDeal[]>>();
/** One bounded read of moj_district_deals for this ad's city · district · class; a failed read is [] and forgotten. */
export function fetchMojDeals(row: AdRow | null, cls: MojClass = 'سكني'): Promise<MojDeal[]> {
  if (!supabase || !row?.city_ar || !row.district_ar) return Promise.resolve([]);
  const key = `${row.city_ar}|${row.district_ar}|${cls}`;
  let p = dealsCache.get(key);
  if (!p) {
    p = boundedRpc<Record<string, unknown>[]>(
      supabase.from('moj_district_deals').select('deal_ref,deal_date,area_m2,price,ppm')
        .eq('city_ar', row.city_ar).eq('district_ar', row.district_ar).eq('property_class', cls)
        .order('deal_date', { ascending: false }).limit(MOJ_DEALS_LIMIT),
    ).then(({ data, error }) => {
      if (error) { dealsCache.delete(key); return []; }
      return mojDealRows(data);
    });
    dealsCache.set(key, p);
  }
  return p;
}

// ── the same ad on other sites ───────────────────────────────────────────────────────────────────
/** The other sites' index rows for this ad: isSameAd, on the SAME live-platform set as the asking stats and
 *  the search (a hidden / down / dormant site neither appears nor counts), one row per platform, index order. */
export function sameAdSiblings(own: AdRow, rows: AdRow[], downSlugs: Set<string>): AdRow[] {
  const seen = new Set<string>();
  const out: AdRow[] = [];
  for (const r of rows) {
    const platform = String(r.platform ?? '').trim().toLowerCase();
    if (!platform || downSlugs.has(platform)) continue;
    if (!isSameAd(own, r) || !r.source_table || seen.has(platform)) continue;
    seen.add(platform);
    out.push(r);
  }
  return out;
}
const sameCache = new Map<string, Promise<Listing[]>>();
/** The OTHER live sites' real cards for this ad (licence + area agree): one per platform, in index order. */
export function fetchSameAd(row: AdRow | null): Promise<Listing[]> {
  const lic = String(row?.license_number ?? '').trim();
  const area = num(row?.area_m2);
  if (!supabase || !row || !lic || !(area > 0)) return Promise.resolve([]);
  const key = `${lic}|${area}|${row.platform ?? ''}`;
  let p = sameCache.get(key);
  if (!p) {
    const own = row;
    p = (async () => {
      await loadHiddenPlatformNames();   // the registry's down list, once per session (bounded inside)
      const { data, error } = await boundedRpc<AdRow[]>(
        supabase!.from('search_listings_ar').select('source_table,listing_id,platform,license_number,area_m2,price_total')
          .eq('license_number', lic).eq('area_m2', area).eq('production_ready', true).limit(50),
      );
      if (error) { sameCache.delete(key); return []; }
      // The predicate is re-run on the client: the row IS what the page shows.
      const byTable = new Map<string, number[]>();
      for (const r of sameAdSiblings(own, data ?? [], downPlatformSlugs())) {
        byTable.set(r.source_table as string, [...(byTable.get(r.source_table as string) ?? []), Number(r.listing_id)]);
      }
      const cards = await Promise.all([...byTable].map(([t, ids]) => fetchListingCards(t, ids)));
      return cards.flat();
    })();
    sameCache.set(key, p);
  }
  return p;
}

// ── the closely similar listings (owner 2026-10-16: «not all of them, just the ones very closely alike») ───────────
// The «Listed now» half gets its own sheet: the SALE ads in this district that are close to this one — the same
// property type, the area within ±20%, the same bedroom count when both ads state one — each property once, nearest
// first, every row a real ad on its own site at its own published price. Numbers only; no ranking by anything but closeness.
export type SimilarRow = { source_table?: string; listing_id?: number | string; platform?: string | null; license_number?: string | null; type_ar?: string | null; area_m2?: unknown; price_total?: unknown; bedrooms?: unknown };
export type SimilarCard = { card: Listing; price: number; area: number; ppm: number; beds: number | null };
export const SIMILAR_AREA_BAND = 0.2;
export const SIMILAR_LIMIT = 30;
export function similarRows(rows: SimilarRow[], ad: AdRow, downSlugs: Set<string>): (SimilarRow & { price: number; area: number; ppm: number; beds: number | null })[] {
  const adArea = num(ad.area_m2), adPrice = num(ad.price_total);
  const adType = String(ad.type_ar ?? '').trim();
  if (!(adArea > 0) || !adType) return [];
  const adBeds = num(ad.bedrooms);
  const adPpm = adPrice > 0 ? adPrice / adArea : NaN;
  const lo = adArea * (1 - SIMILAR_AREA_BAND), hi = adArea * (1 + SIMILAR_AREA_BAND);
  const best = new Map<string, SimilarRow & { price: number; area: number; ppm: number; beds: number | null }>();
  for (const r of rows) {
    const platform = String(r.platform ?? '').trim().toLowerCase();
    if (!platform || downSlugs.has(platform) || !r.source_table) continue;
    if (String(r.source_table) === String(ad.source_table ?? '') && String(r.listing_id) === String(ad.listing_id ?? '')) continue;   // never itself
    if (String(r.type_ar ?? '').trim() !== adType) continue;
    const area = num(r.area_m2), price = num(r.price_total);
    if (!(area >= lo && area <= hi) || !Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) continue;
    const beds = num(r.bedrooms);
    const bedsKnown = Number.isFinite(beds) && beds > 0, adBedsKnown = Number.isFinite(adBeds) && adBeds > 0;
    if (bedsKnown && adBedsKnown && beds !== adBeds) continue;
    const lic = String(r.license_number ?? '').trim();
    const key = lic ? `${lic}|${adType}|${area}` : `${platform}|${adType}|${price}|${area}`;
    const cur = best.get(key);
    if (!cur || price < cur.price) best.set(key, { ...r, price, area, ppm: price / area, beds: bedsKnown ? beds : null });
  }
  const closeness = (x: { area: number; ppm: number }) => [Math.abs(x.area - adArea), Number.isFinite(adPpm) ? Math.abs(x.ppm - adPpm) : 0] as const;
  return [...best.values()]
    .sort((a, b) => { const [a1, a2] = closeness(a), [b1, b2] = closeness(b); return a1 - b1 || a2 - b2; })
    .slice(0, SIMILAR_LIMIT);
}
const similarCache = new Map<string, Promise<SimilarCard[]>>();
/** The real cards of the closely similar listings, nearest first; a failed read is [] and forgotten. */
export function fetchSimilarListings(row: AdRow | null): Promise<SimilarCard[]> {
  const area = num(row?.area_m2);
  if (!supabase || !row || row.deal_ar !== 'بيع' || !row.type_ar || !row.city_ar || !row.district_ar || !(area > 0)) return Promise.resolve([]);
  const key = `${row.source_table}|${row.listing_id}`;
  let p = similarCache.get(key);
  if (!p) {
    const ad = row;
    p = (async () => {
      await loadHiddenPlatformNames();
      const { data, error } = await boundedRpc<SimilarRow[]>(
        supabase!.from('search_listings_ar').select('source_table,listing_id,platform,license_number,type_ar,area_m2,price_total,bedrooms')
          .eq('city_ar', ad.city_ar as string).eq('district_ar', ad.district_ar as string).eq('deal_ar', 'بيع').eq('type_ar', String(ad.type_ar).trim())
          .eq('production_ready', true).gte('area_m2', Math.floor(area * (1 - SIMILAR_AREA_BAND))).lte('area_m2', Math.ceil(area * (1 + SIMILAR_AREA_BAND)))
          .not('price_total', 'is', null).limit(600),
      );
      if (error) { similarCache.delete(key); return []; }
      const picked = similarRows(data ?? [], ad, downPlatformSlugs());
      const byTable = new Map<string, number[]>();
      for (const r of picked) byTable.set(r.source_table as string, [...(byTable.get(r.source_table as string) ?? []), Number(r.listing_id)]);
      const cards = (await Promise.all([...byTable].map(([t, ids]) => fetchListingCards(t, ids)))).flat();
      const byKey = new Map(cards.map((c) => [`${(c as Listing & { sourceTable?: string }).sourceTable}|${c.id}`, c]));
      // the sheet keeps the closeness order and prints the INDEX row's own figures beside the card
      return picked.flatMap((r) => { const c = byKey.get(`${r.source_table}|${r.listing_id}`); return c ? [{ card: c, price: r.price, area: r.area, ppm: r.ppm, beds: r.beds }] : []; });
    })();
    similarCache.set(key, p);
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
        // ORDERED paging, or the pages overlap: Postgres returns an unordered scan in any order it likes,
        // so page 2 repeats rows of page 1 and skips others — measured 2026-10-10 on الرمال residential:
        // 5,706 rows read for 3,192 houses, against 3,728 with a stable order. One key, every page.
        const { data, error } = await boundedRpc<PriceRow[]>(
          client.from('search_listings_ar').select('platform,license_number,area_m2,price_total,type_ar')
            .in('type_ar', [...scope.types]).eq('deal_ar', 'بيع').eq('city_ar', row.city_ar as string).eq('district_ar', row.district_ar as string).eq('production_ready', true)
            .not('price_total', 'is', null).order('source_table').order('listing_id').range(page * PAGE, page * PAGE + PAGE - 1),
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
