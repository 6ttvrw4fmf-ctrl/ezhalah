// THE MAP CARD (owner 2026-11-12/13 — docs/ARCHITECTURE.md «THE MAP BOX AND ITS CARD»). Tapping the box opens one card
// for exactly the box's ads: a table (أمس · أسبوع · شهر · 3 أشهر · أحياء قريبة), each nearby district's asking price per
// metre, «نظرة سريعة» (8 numbers, each with the neighbours' value) and the line that prices are asking prices.
// The numbers come from map_view_card_ar() (migrations 20261113085736, 20261113085947). This file only decides what each
// cell SAYS — import-free, so scripts/verify-map-card.ts executes it:
//   • a failed read is null → the card says it could not load, never a «0»;
//   • a window whose log does not yet cover it reads «قريبا», a price from fewer than 10 ads reads «إعلانات قليلة»;
//   • every price says «المعروض» and names its ONE type; a guest's read is {locked} and carries no number.

export type CardWindow = { new: number | null; gone: number | null; cuts: number | null; ppm: number | null; ppmN: number };
export type CardTopType = { type: string; pct: number } | null;
export type CardTopRooms = { rooms: number; pct: number } | null;
export type CardSide = {
  medianPrice: number | null; medianArea: number | null; priceLow: number | null; priceHigh: number | null;
  stayDays: number | null; topType: CardTopType; topRooms: CardTopRooms; medianAge: number | null;
};
/** too few removals in the view yet: the whole city's number, NAMED («86 يوما في الرياض») — owner 2026-11-13 «ok ok» */
export type StayCity = { city: string; days: number } | null;
/** The residential-sale card's extra numbers (owner 2026-11-14), each of the ONE price type, from ≥ 10 ads. */
export type SaleExtra = { nPriced: number | null; ppmAll: number | null; roomsShare: Record<number, number> | null };
export type RoomPrice = { rooms: number; n: number; price: number };
export type WeekPoint = { start: string; n: number; ppm: number | null };
export type MapCard = CardSide & SaleExtra & {
  any: number;
  byRooms: RoomPrice[];
  priceTypes: string[];
  siteList: string[];
  weeks: WeekPoint[];
  priceType: string | null;
  districtAr: string | null;
  cityAr: string | null;
  sites: number;
  stayCity: StayCity;
  table: { y: CardWindow; w: CardWindow; m: CardWindow; q: CardWindow };
  updatedAt: string | null;
  nb: (CardSide & SaleExtra & { names: string[]; nDistricts: number; month: CardWindow | null; byDistrict: { district: string; ppm: number | null }[] }) | null;
};

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function win(v: unknown): CardWindow | null {
  const o = obj(v);
  if (!o) return null;
  return { new: int(o.new), gone: int(o.gone), cuts: int(o.cuts), ppm: pos(o.ppm), ppmN: int(o.ppm_n) ?? 0 };
}
function shares(v: unknown): Record<number, number> | null {
  const o = obj(v);
  if (!o) return null;
  const out: Record<number, number> = {};
  for (const [k, x] of Object.entries(o)) { const r = Number(k); const p = int(x); if (Number.isInteger(r) && r > 0 && p !== null && p <= 100) out[r] = p; }
  return out;
}
function extra(o: Record<string, unknown>): SaleExtra {
  return { nPriced: int(o.n_priced), ppmAll: pos(o.ppm_all), roomsShare: shares(o.rooms_share) };
}
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
function side(o: Record<string, unknown>): CardSide {
  const tt = obj(o.top_type); const tr = obj(o.top_rooms);
  return {
    medianPrice: pos(o.median_price), medianArea: pos(o.median_area), priceLow: pos(o.price_low), priceHigh: pos(o.price_high),
    stayDays: int(o.stay_days),
    topType: tt && typeof tt.type === 'string' && int(tt.pct) !== null ? { type: tt.type, pct: int(tt.pct) as number } : null,
    topRooms: tr && int(tr.rooms) && int(tr.pct) !== null ? { rooms: int(tr.rooms) as number, pct: int(tr.pct) as number } : null,
    medianAge: int(o.median_age),
  };
}

/** The RPC's `{ data, error }` → the card; 'locked' for a guest; null when the read failed or the shape is wrong. */
export function parseMapCard(result: { data: unknown; error: unknown }): MapCard | 'locked' | null {
  if (result.error) return null;
  const d = obj(result.data);
  if (!d) return null;
  if (d.locked === true) return 'locked';
  const any = int(d.any);
  const t = obj(d.table);
  const y = win(t?.y); const w = win(t?.w); const m = win(t?.m); const q = win(t?.q);
  if (any === null || !y || !w || !m || !q) return null;
  const n = obj(d.nb);
  const names = n && Array.isArray(n.names) ? n.names.filter((x): x is string => typeof x === 'string') : [];
  const byDistrict = n && Array.isArray(n.by_district)
    ? n.by_district.map((x) => obj(x)).filter((x): x is Record<string, unknown> => !!x && typeof x.district === 'string')
        .map((x) => ({ district: x.district as string, ppm: pos(x.ppm) }))
    : [];
  return {
    ...side(d), ...extra(d), any, priceType: typeof d.price_type === 'string' ? d.price_type : null,
    districtAr: typeof d.district_ar === 'string' ? d.district_ar : null, cityAr: typeof d.city_ar === 'string' ? d.city_ar : null,
    sites: int(d.sites) ?? 0, table: { y, w, m, q },
    byRooms: (Array.isArray(d.by_rooms) ? d.by_rooms : []).map((x) => obj(x)).filter((x): x is Record<string, unknown> => !!x)
      .map((x) => ({ rooms: int(x.rooms) ?? 0, n: int(x.n) ?? 0, price: pos(x.price) ?? 0 })).filter((x) => x.rooms > 0 && x.n >= 10 && x.price > 0),
    priceTypes: strs(d.price_types), siteList: strs(d.site_list),
    weeks: (Array.isArray(d.weeks) ? d.weeks : []).map((x) => obj(x)).filter((x): x is Record<string, unknown> => !!x && typeof x.start === 'string')
      .map((x) => ({ start: x.start as string, n: int(x.n) ?? 0, ppm: pos(x.ppm) })),
    stayCity: (() => { const sc = obj(d.stay_city); return sc && typeof sc.city === 'string' && int(sc.days) !== null ? { city: sc.city, days: int(sc.days) as number } : null; })(), updatedAt: typeof d.updated_at === 'string' ? d.updated_at : null,
    nb: n && names.length ? { ...side(n), ...extra(n), names, nDistricts: Math.max(1, int(n.n_districts) ?? 1), month: win(n.month), byDistrict } : null,
  };
}

const num = (x: number) => Math.round(x).toLocaleString('en-US');
export const SOON = { ar: 'قريبا', en: 'soon' } as const;
export const FEW = { ar: 'إعلانات قليلة', en: 'too few ads' } as const;
/** Under this difference from the neighbours a cell is plain, not red or green. */
export const CARD_SAME_PCT = 5;
export type Tone = 'up' | 'down' | 'plain';
/** `near`: too few ads here, so the cell shows the NEARBY districts' month price, labelled «قريبة» (owner 2026-11-13:
 *  «focus on the nearby if little ads») — never passed off as this area's own. */
export type Cell = { text: string; tone: Tone; near?: boolean; nearPeriod?: 'month' };
/** A price cell with no figure here and none nearby. */
export const NONE = '—';
// the fallback is ALWAYS the neighbours' last-month price, whatever column it sits in, and its tag says so (CodeRabbit #12180)
export const NEAR = { ar: 'قريبة · شهر', en: 'nearby · month' } as const;

export const tone = (mine: number | null, theirs: number | null): Tone => {
  if (mine === null || theirs === null || theirs === 0) return 'plain';
  const pct = ((mine - theirs) / theirs) * 100;
  return Math.abs(pct) < CARD_SAME_PCT ? 'plain' : pct > 0 ? 'up' : 'down';
};

export const COLUMNS = { ar: ['أمس', 'أسبوع', 'شهر', '3 أشهر', 'أحياء قريبة'], en: ['Yesterday', 'Week', 'Month', '3 months', 'Nearby'] } as const;
export type RowKey = 'new' | 'gone' | 'ppm' | 'cuts';
const ROW_LABEL: Record<RowKey, { ar: string; en: string }> = {
  new: { ar: 'إعلانات جديدة', en: 'New ads' },
  gone: { ar: 'إعلانات اختفت', en: 'Ads gone' },
  ppm: { ar: 'سعر المتر المعروض', en: 'Asking price / m²' },
  cuts: { ar: 'خفضوا السعر', en: 'Price cuts' },
};

/** One table row: four windows and the neighbours' month (a count is the per-district average, so a big district is
 *  not compared unfairly). The «أحياء قريبة» cell is red above the area's own month, green below. */
export function cardRow(c: MapCard, key: RowKey, loc: 'ar' | 'en'): { label: string; cells: Cell[] } {
  const value = (wd: CardWindow): Cell => {
    if (key === 'ppm') {
      if (wd.ppm !== null) return { text: num(wd.ppm), tone: 'plain' };
      const nbPpm = c.nb?.month?.ppm ?? null;
      return nbPpm !== null ? { text: num(nbPpm), tone: 'plain', near: true, nearPeriod: 'month' } : { text: NONE, tone: 'plain' };
    }
    const v = wd[key];
    return v !== null ? { text: num(v), tone: 'plain' } : { text: SOON[loc], tone: 'plain' };
  };
  const cells = [value(c.table.y), value(c.table.w), value(c.table.m), value(c.table.q)];
  const nm = c.nb?.month ?? null;
  let nbCell: Cell = { text: '—', tone: 'plain' };
  if (c.nb && nm) {
    if (key === 'ppm') {
      nbCell = nm.ppm !== null ? { text: num(nm.ppm), tone: 'plain' } : { text: NONE, tone: 'plain' };
      if (nm.ppm !== null) cells[2] = { ...cells[2], tone: tone(c.table.m.ppm, nm.ppm) };
    } else {
      const v = nm[key];
      if (v === null || c.table.m[key] === null) nbCell = { text: v === null ? SOON[loc] : num(v / c.nb.nDistricts), tone: 'plain' };
      else { const avg = v / c.nb.nDistricts; nbCell = { text: num(avg), tone: 'plain' }; cells[2] = { ...cells[2], tone: tone(c.table.m[key], avg) }; }
    }
  }
  const label = key === 'ppm' && c.priceType ? `${ROW_LABEL.ppm[loc]} (${typeLabel(c.priceType, loc)})` : ROW_LABEL[key][loc];
  return { label, cells: [...cells, nbCell] };
}

const TYPE_PLURAL: Record<string, { ar: string; en: string }> = {
  'شقة': { ar: 'الشقق', en: 'apartments' }, 'فيلا': { ar: 'الفلل', en: 'villas' }, 'أرض سكنية': { ar: 'الأراضي السكنية', en: 'residential land' },
  'دور': { ar: 'الأدوار', en: 'floors' }, 'عمارة': { ar: 'العمائر', en: 'buildings' }, 'أرض': { ar: 'الأراضي', en: 'land' },
  'أرض تجارية': { ar: 'الأراضي التجارية', en: 'commercial land' }, 'استراحة': { ar: 'الاستراحات', en: 'rest houses' },
  'مزرعة': { ar: 'المزارع', en: 'farms' }, 'محل': { ar: 'المحلات', en: 'shops' }, 'مكتب': { ar: 'المكاتب', en: 'offices' },
  'مستودع': { ar: 'المستودعات', en: 'warehouses' }, 'معرض': { ar: 'المعارض', en: 'showrooms' },
};
export const typeLabel = (t: string, loc: 'ar' | 'en'): string => TYPE_PLURAL[t]?.[loc] ?? t;
const TYPE_SINGULAR_EN: Record<string, string> = {
  'شقة': 'Apartment', 'فيلا': 'Villa', 'أرض سكنية': 'Residential land', 'دور': 'Floor', 'عمارة': 'Building', 'أرض': 'Land',
  'أرض تجارية': 'Commercial land', 'استراحة': 'Rest house', 'مزرعة': 'Farm', 'محل': 'Shop', 'مكتب': 'Office', 'مستودع': 'Warehouse', 'معرض': 'Showroom',
};
/** the English card never prints an Arabic type name (review of #12119) */
export const typeSingularEn = (t: string): string => TYPE_SINGULAR_EN[t] ?? TYPE_PLURAL[t]?.en ?? 'Other';

// Arabic counted nouns: 1 · 2 · 3–10 · 11+
const counted = (n: number, f: [string, string, string, string]) => (n === 1 ? f[0] : n === 2 ? f[1] : n <= 10 ? `${n} ${f[2]}` : `${num(n)} ${f[3]}`);
export const daysAr = (n: number) => counted(n, ['يوم واحد', 'يومان', 'أيام', 'يوما']);
export const yearsAr = (n: number) => (n === 0 ? 'جديد' : counted(n, ['سنة واحدة', 'سنتان', 'سنوات', 'سنة']));
export const roomsAr = (n: number) => counted(n, ['غرفة واحدة', 'غرفتان', 'غرف', 'غرفة']);
export const sitesAr = (n: number) => counted(n, ['موقع واحد', 'موقعان', 'مواقع', 'موقعا']);

/** «1.4 مليون» — the card's money, a median or a range end. */
export function money(v: number, loc: 'ar' | 'en'): string {
  const one = (x: number) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10).toLocaleString('en-US');
  if (v >= 1_000_000) return loc === 'ar' ? `${one(v / 1_000_000)} مليون` : `${one(v / 1_000_000)}M`;
  if (v >= 1_000) return loc === 'ar' ? `${one(v / 1_000)} ألف` : `${one(v / 1_000)}K`;
  return num(v);
}

export type QuickItem = { label: string; value: string; nearby: string | null };
/** «نظرة سريعة»: 8 numbers, each but the last with the neighbours' value in grey. */
export function quickLook(c: MapCard, loc: 'ar' | 'en'): QuickItem[] {
  const ar = loc === 'ar';
  const few = FEW[loc];
  const nbLine = (v: string | null) => (c.nb && v !== null ? (ar ? `أحياء قريبة ${v}` : `nearby ${v}`) : null);
  const price = (s: CardSide) => (s.medianPrice !== null ? money(s.medianPrice, loc) : null);
  const area = (s: CardSide) => (s.medianArea !== null ? (ar ? `${num(s.medianArea)} م²` : `${num(s.medianArea)} m²`) : null);
  const stay = (s: CardSide) => (s.stayDays !== null ? (ar ? daysAr(s.stayDays) : `${s.stayDays} days`) : null);
  const range = (s: CardSide) => (s.priceLow !== null && s.priceHigh !== null ? `${money(s.priceLow, loc)} – ${money(s.priceHigh, loc)}` : null);
  const ttype = (s: CardSide) => (s.topType ? `${ar ? s.topType.type : typeSingularEn(s.topType.type)} ${s.topType.pct}%` : null);
  const rooms = (s: CardSide) => (s.topRooms ? (ar ? `${roomsAr(s.topRooms.rooms)} (${s.topRooms.pct}%)` : `${s.topRooms.rooms} rooms (${s.topRooms.pct}%)`) : null);
  const age = (s: CardSide) => (s.medianAge !== null ? (ar ? yearsAr(s.medianAge) : s.medianAge === 0 ? 'new' : `${s.medianAge} years`) : null);
  const nb = c.nb;
  return [
    { label: ar ? 'متوسط السعر المعروض' : 'Typical asking price', value: price(c) ?? few, nearby: nbLine(nb ? price(nb) : null) },
    { label: ar ? 'متوسط المساحة' : 'Typical size', value: area(c) ?? few, nearby: nbLine(nb ? area(nb) : null) },
    { label: ar ? 'مدة بقاء الإعلان' : 'How long ads stay up',
      value: stay(c) ?? (c.stayCity ? (ar ? `${daysAr(c.stayCity.days)} في ${c.stayCity.city}` : `${c.stayCity.days} days in ${c.stayCity.city}`) : SOON[loc]),
      nearby: nbLine(nb ? stay(nb) : null) },
    { label: ar ? 'نطاق الأسعار المعروضة' : 'Asking price range', value: range(c) ?? few, nearby: nbLine(nb ? range(nb) : null) },
    { label: ar ? 'النوع الأكثر' : 'Most common type', value: ttype(c) ?? few, nearby: nbLine(nb ? ttype(nb) : null) },
    { label: ar ? 'عدد الغرف الأكثر' : 'Most common rooms', value: rooms(c) ?? few, nearby: nbLine(nb ? rooms(nb) : null) },
    { label: ar ? 'متوسط عمر العقار' : 'Typical property age', value: age(c) ?? few, nearby: nbLine(nb ? age(nb) : null) },
    { label: ar ? 'مواقع تعرض إعلانات هنا' : 'Sites listing here', value: ar ? sitesAr(c.sites) : `${c.sites}`, nearby: null },
  ];
}

/** «سعر المتر المعروض حي حي»: each nearby district by name, nearest first. */
export function nearbyPrices(c: MapCard, loc: 'ar' | 'en'): { name: string; text: string }[] {
  // a nearby district with too few ads is left out, not shown as «إعلانات قليلة» (owner 2026-11-13: a cleaner card)
  void loc;
  return (c.nb?.byDistrict ?? []).filter((d) => d.ppm !== null).map((d) => ({ name: d.district.replace(/^حي\s+/, ''), text: num(d.ppm as number) }));
}

export const CARD_NOTE = { ar: 'الأسعار هي أسعار العرض في الإعلانات، وليست أسعار البيع النهائية', en: 'Prices are the asking prices in the ads, not final sale prices' } as const;

/** The row's windows after «أمس» have no history yet (the removal log / price diary is young): the card shows ONE line,
 *  «باقي المدد تتوفر قريبا», instead of «قريبا» in every box (owner 2026-11-13: «12 قريبا looks vibe coded»). */
export const restIsSoon = (cells: Cell[], loc: 'ar' | 'en'): boolean =>
  cells.length === 5 && cells.slice(1).every((x) => x.text === SOON[loc] || x.text === NONE) && cells.slice(1, 4).every((x) => x.text === SOON[loc]);
export const REST_SOON = { ar: 'باقي المدد تتوفر قريبا', en: 'Longer periods coming soon' } as const;
export const LEGEND = {
  near: { ar: '«قريبة · شهر» = إعلانات قليلة هنا، فنعرض سعر الأحياء القريبة لآخر شهر', en: '«nearby · month» = too few ads here, so the nearby districts\' last-month price is shown' },
  up: { ar: 'أعلى من الأحياء القريبة', en: 'above nearby districts' },
  down: { ar: 'أقل', en: 'below' },
} as const;

/** What the user picked, for the pills under the card's title (owner 2026-11-13: «I selected some things in the filter,
 *  why doesn't it show»). Only what the card really counts: «نُشر خلال» is not applied to the card, so it is never shown. */
export type ChipFilter = {
  category?: 'residential' | 'commercial' | null; types?: string[] | null; scope?: { types2: string[] | null } | null;
  beds?: number[] | null; areaMin?: number | null; areaMax?: number | null; priceMin?: number | null; priceMax?: number | null;
  furnished?: boolean | null; poly?: unknown; postedWithinDays?: number | null;
};
export function filterChips(f: ChipFilter | null | undefined, loc: 'ar' | 'en'): string[] {
  if (!f) return [];
  const ar = loc === 'ar';
  const out: string[] = [];
  const types = [...new Set([...(f.types ?? []), ...(f.scope?.types2 ?? [])])];
  if (types.length) out.push(types.map((t) => (ar ? t : typeSingularEn(t))).join(ar ? '، ' : ', '));
  else if (f.category) out.push(ar ? (f.category === 'residential' ? 'سكني' : 'تجاري') : (f.category === 'residential' ? 'Residential' : 'Commercial'));
  const beds = [...new Set(f.beds ?? [])].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  if (beds.length) out.push(ar ? `${beds.join('، ')} غرف` : `${beds.join(', ')} rooms`);
  const range = (lo: number | null | undefined, hi: number | null | undefined, fmt: (v: number) => string) =>
    lo != null && hi != null ? `${fmt(lo)} – ${fmt(hi)}` : lo != null ? (ar ? `من ${fmt(lo)}` : `from ${fmt(lo)}`) : hi != null ? (ar ? `حتى ${fmt(hi)}` : `up to ${fmt(hi)}`) : null;
  const price = range(f.priceMin, f.priceMax, (v) => money(v, loc));
  if (price) out.push(price);
  const area = range(f.areaMin, f.areaMax, (v) => (ar ? `${num(v)} م²` : `${num(v)} m²`));
  if (area) out.push(area);
  if (f.furnished === true) out.push(ar ? 'مفروش' : 'Furnished');
  if (f.furnished === false) out.push(ar ? 'غير مفروش' : 'Unfurnished');
  if (f.poly) out.push(ar ? 'منطقة مرسومة' : 'Drawn area');
  return out;
}


// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE RESIDENTIAL-SALE CARD (owner 2026-11-14 — the picture agreed in chat; docs/ARCHITECTURE.md «THE MAP BOX AND ITS
// CARD»). The title is the user's own choice read out («فلل للبيع · 5 غرف · من 250 إلى 400 م²»); every number follows
// EVERY filter; the comparison is the nearby districts under the SAME filters; words are neutral (أعلى · أقل · متقارب,
// never أرخص / فرصة / صفقة); every price says «المعروض»; one disclaimer sentence sits at the top; Arabic reads from the
// right (a range is «من … إلى …», never a dash that flips).

/** The new card is for a residential SALE only (owner: «we are focusing on buy residential right now»). */
export function isSaleCard(f: { deals: readonly string[]; category?: string | null; scope?: { macro?: string | null } | null } | null | undefined): boolean {
  return !!f && f.deals.length === 1 && f.deals[0] === 'buy' && f.category !== 'commercial' && f.scope?.macro !== 'Commercial';
}

export const DISCLAIMER = {
  ar: 'هذه أرقام محسوبة آليا من أسعار معروضة في إعلانات منشورة وقد لا تكون دقيقة، وليست أسعار بيع ولا تقييما عقاريا ولا نصيحة. تحقق دائما من المعلن، ولا تتحمل إزهله أي مسؤولية عن أي قرار يبنى عليها.',
  en: 'These figures are calculated automatically from displayed prices in published ads and may not be accurate. They are not sale prices, a property valuation or advice. Always check with the advertiser; Ezhalah accepts no responsibility for any decision based on them.',
} as const;
/** Words the card must never say (owner 2026-11-14: «we can get sued»). Executed against every sentence by the guard. */
export const BANNED_WORDS = ['أرخص', 'رخيص', 'فرصة', 'صفقة', 'استثمار جيد', 'سعر السوق', 'القيمة السوقية', 'cheap', 'bargain', 'deal', 'opportunity', 'market value', 'worth'];

// «الفلل» → «فلل», «الأراضي السكنية» → «أراضي سكنية»
const indefinite = (label: string) => label.split(' ').map((w) => (w.startsWith('ال') ? w.slice(2) : w)).join(' ');
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const roomsWithAr = (n: number) => (n === 1 ? 'بغرفة واحدة' : n === 2 ? 'بغرفتين' : `بـ${n} غرف`);
const countedAds = (n: number) => counted(n, ['إعلان واحد', 'إعلانان', 'إعلانات', 'إعلانا']);

/** The title: the type and the user's choices, as one line («فلل للبيع · 5 غرف · من 250 إلى 400 م²»). */
export function saleTitle(type: string | null, f: ChipFilter | null | undefined, loc: 'ar' | 'en'): string {
  const ar = loc === 'ar';
  const head = type ? (ar ? `${indefinite(typeLabel(type, 'ar'))} للبيع` : `${cap(typeLabel(type, 'en'))} for sale`) : (ar ? 'عقارات للبيع' : 'Properties for sale');
  const parts = [head];
  if (f) {
    const beds = [...new Set(f.beds ?? [])].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
    if (beds.length === 1) parts.push(ar ? roomsAr(beds[0]) : `${beds[0]} ${beds[0] === 1 ? 'room' : 'rooms'}`);
    else if (beds.length) parts.push(ar ? `${beds.join('، ')} غرف` : `${beds.join(', ')} rooms`);
    const range = (lo: number | null | undefined, hi: number | null | undefined, fmt: (v: number) => string, unitAr = '', unitEn = '') =>
      lo != null && hi != null ? (ar ? `من ${fmt(lo)} إلى ${fmt(hi)}${unitAr}` : `${fmt(lo)}–${fmt(hi)}${unitEn}`)
      : lo != null ? (ar ? `من ${fmt(lo)}${unitAr}` : `from ${fmt(lo)}${unitEn}`)
      : hi != null ? (ar ? `حتى ${fmt(hi)}${unitAr}` : `up to ${fmt(hi)}${unitEn}`) : null;
    const area = range(f.areaMin, f.areaMax, num, ' م²', ' m²');
    if (area) parts.push(area);
    const price = range(f.priceMin, f.priceMax, (v) => money(v, loc), ar ? ' ريال' : '', ar ? '' : ' SAR');
    if (price) parts.push(price);
    if (f.furnished === true) parts.push(ar ? 'مفروشة' : 'furnished');
    if (f.furnished === false) parts.push(ar ? 'غير مفروشة' : 'unfurnished');
    if (f.postedWithinDays != null) parts.push(ar ? `نشرت خلال ${daysAr(f.postedWithinDays)}` : `posted in the last ${f.postedWithinDays} ${f.postedWithinDays === 1 ? 'day' : 'days'}`);
    if (f.poly) parts.push(ar ? 'منطقة مرسومة' : 'drawn area');
  }
  return parts.join(' · ');
}

/** Under the title: the place, what the prices are, and how many sites. */
export function saleSubtitle(c: MapCard, fallbackPlace: string, loc: 'ar' | 'en', translit: (s: string) => string = (x) => x): string {
  const ar = loc === 'ar';
  const district = c.districtAr ? (ar ? c.districtAr : translit(c.districtAr.replace(/^حي\s+/, ''))) : null;
  const city = c.cityAr ? (ar ? c.cityAr : translit(c.cityAr)) : null;
  const place = district && city ? `${district}${ar ? '، ' : ', '}${city}` : city ?? fallbackPlace;
  return ar ? `${place} · الأسعار المعروضة في الإعلانات · من ${sitesAr(c.sites)}` : `${place} · Displayed prices from ads · from ${c.sites} ${c.sites === 1 ? 'website' : 'websites'}`;
}

/** Percent difference from the neighbours, rounded; null when either side is missing. */
export const pctVs = (mine: number | null, theirs: number | null): number | null =>
  mine === null || theirs === null || theirs <= 0 ? null : Math.round(((mine - theirs) / theirs) * 100);

/** The one sentence: the displayed price per metre here, and how it compares (neutral words; under 5% = «قريب»). */
export function saleSentence(c: MapCard, filtered: boolean, loc: 'ar' | 'en'): string | null {
  if (c.ppmAll === null || !c.priceType) return null;
  const ar = loc === 'ar';
  const about = num(Math.round(c.ppmAll / 100) * 100);
  const these = ar ? (filtered ? `لهذه ${typeLabel(c.priceType, 'ar')}` : forTypeAr(typeLabel(c.priceType, 'ar'))) : (filtered ? `these ${typeLabel(c.priceType, 'en')}` : typeLabel(c.priceType, 'en'));
  const head = ar ? `سعر المتر المعروض ${these} هنا حوالي ${about} ريال` : `The displayed price per m² for ${these} here is about ${about} SAR`;
  const pct = c.nb ? pctVs(c.ppmAll, c.nb.ppmAll) : null;
  const same = ar ? (filtered ? ' بنفس الفلاتر' : '') : (filtered ? ' with the same filters' : '');
  if (pct === null) return `${head}.`;
  if (Math.abs(pct) < CARD_SAME_PCT) return ar ? `${head}، وقريب من الأحياء القريبة${same}.` : `${head}, close to nearby districts${same}.`;
  return ar ? `${head}، و${pct > 0 ? 'أعلى' : 'أقل'} من الأحياء القريبة بحوالي ${Math.abs(pct)} بالمئة${same}.`
            : `${head}, about ${Math.abs(pct)}% ${pct > 0 ? 'higher' : 'lower'} than nearby districts${same}.`;
}
const forTypeAr = (label: string) => (label.startsWith('ال') ? `لل${label.slice(2)}` : `لـ${label}`);

/** The three big numbers. A number from too few ads says so. */
export function saleNumbers(c: MapCard, loc: 'ar' | 'en'): { value: string; label: string }[] {
  const ar = loc === 'ar';
  return [
    { value: c.medianPrice !== null ? money(c.medianPrice, loc) : FEW[loc], label: ar ? 'السعر المعروض المعتاد' : 'Typical displayed price' },
    { value: c.ppmAll !== null ? num(c.ppmAll) : FEW[loc], label: ar ? 'سعر المتر المعروض' : 'Displayed price / m²' },
    { value: c.table.m.new !== null ? num(c.table.m.new) : SOON[loc], label: ar ? 'جديد هذا الشهر' : 'New this month' },
  ];
}

/** «مقارنة بالأحياء القريبة (بنفس الفلاتر)»: only measured facts, both sides present, neutral words. The rooms line is
 *  left out when the user picked the rooms (it would read 100% against 100%). */
export function saleDiffs(c: MapCard, bedsPicked: boolean, loc: 'ar' | 'en'): string[] {
  const nb = c.nb;
  if (!nb || !c.priceType) return [];
  const ar = loc === 'ar';
  const out: string[] = [];
  const pct = pctVs(c.ppmAll, nb.ppmAll);
  if (pct !== null && c.ppmAll !== null && nb.ppmAll !== null) {
    const how = pct === 0 ? (ar ? 'تقريبا نفس المستوى' : 'about the same') : ar ? `${pct > 0 ? 'أعلى' : 'أقل'} بحوالي ${Math.abs(pct)} بالمئة` : `about ${Math.abs(pct)}% ${pct > 0 ? 'higher' : 'lower'}`;
    out.push(ar ? `سعر المتر المعروض ${num(c.ppmAll)} هنا مقابل ${num(nb.ppmAll)}، ${how}` : `Displayed price per m²: ${num(c.ppmAll)} here vs ${num(nb.ppmAll)} (${how})`);
  }
  const ap = pctVs(c.medianArea, nb.medianArea);
  if (ap !== null && c.medianArea !== null && nb.medianArea !== null) {
    const a = num(c.medianArea); const b = num(nb.medianArea);
    if (Math.abs(ap) < CARD_SAME_PCT) out.push(ar ? `المساحة متقاربة، ${a} م² هنا مقابل ${b} م²` : `Similar size (${a} m² here vs ${b} m²)`);
    else out.push(ar ? `${typeLabel(c.priceType, 'ar')} المعروضة هنا ${ap > 0 ? 'أكبر' : 'أصغر'} بالمتوسط، ${a} م² مقابل ${b} م²` : `${cap(typeLabel(c.priceType, 'en'))} listed here are ${ap > 0 ? 'larger' : 'smaller'} on average (${a} m² vs ${b} m²)`);
  }
  if (!bedsPicked && c.topRooms && nb.roomsShare) {
    const r = c.topRooms.rooms; const here = c.topRooms.pct; const there = nb.roomsShare[r] ?? 0;
    const d = here - there;
    const t = typeLabel(c.priceType, loc);
    if (Math.abs(d) < CARD_SAME_PCT) out.push(ar ? `نسبة ${t} ${roomsWithAr(r)} متقاربة، ${here}% مقابل ${there}%` : `A similar share of ${r}-room ${t} (${here}% vs ${there}%)`);
    else out.push(ar ? `${t} ${roomsWithAr(r)} ${d > 0 ? 'أكثر' : 'أقل'} هنا، ${here}% من الإعلانات مقابل ${there}%` : `${d > 0 ? 'More' : 'Fewer'} ${r}-room ${t} here (${here}% of ads vs ${there}%)`);
  }
  if (c.nPriced !== null && nb.nPriced !== null) {
    const avg = nb.nPriced / nb.nDistricts;
    const cp = pctVs(c.nPriced, avg);
    if (cp !== null) {
      const a = num(c.nPriced); const b = num(avg);
      if (Math.abs(cp) < CARD_SAME_PCT) out.push(ar ? `عدد الإعلانات متقارب، ${a} هنا مقابل حوالي ${b} لكل حي قريب` : `A similar number of ads (${a} here vs about ${b} per nearby district)`);
      else out.push(ar ? `عدد الإعلانات هنا ${cp > 0 ? 'أكثر' : 'أقل'}، ${a} مقابل حوالي ${b} لكل حي قريب` : `${cp > 0 ? 'More' : 'Fewer'} ads here (${a} vs about ${b} per nearby district)`);
    }
  }
  return out;
}

/** «السعر المعروض حسب عدد الغرف» — hidden when the user picked the rooms. */
export function saleRooms(c: MapCard, bedsPicked: boolean, loc: 'ar' | 'en'): { label: string; value: string }[] {
  if (bedsPicked) return [];
  return c.byRooms.map((r) => ({ label: loc === 'ar' ? roomsAr(r.rooms) : `${r.rooms} ${r.rooms === 1 ? 'room' : 'rooms'}`, value: loc === 'ar' ? `حوالي ${money(r.price, 'ar')}` : `about ${money(r.price, 'en')}` }));
}

/** «عرض تفاصيل أكثر»: a row is shown only when its number exists (a log too young to cover a window shows nothing). */
export function saleDetails(c: MapCard, loc: 'ar' | 'en'): { label: string; value: string }[] {
  const ar = loc === 'ar';
  const ads = (n: number) => (ar ? countedAds(n) : `${num(n)} ${n === 1 ? 'ad' : 'ads'}`);
  const out: { label: string; value: string }[] = [];
  if (c.table.w.new !== null) out.push({ label: ar ? 'جديد هذا الأسبوع' : 'New this week', value: ads(c.table.w.new) });
  const longest = (k: 'gone' | 'cuts') => (c.table.m[k] !== null ? ['m', c.table.m[k]] : c.table.w[k] !== null ? ['w', c.table.w[k]] : c.table.y[k] !== null ? ['y', c.table.y[k]] : null) as ['m' | 'w' | 'y', number] | null;
  const when = { m: { ar: 'هذا الشهر', en: 'this month' }, w: { ar: 'هذا الأسبوع', en: 'this week' }, y: { ar: 'أمس', en: 'yesterday' } } as const;
  const g = longest('gone');
  if (g) out.push({ label: ar ? `اختفت ${when[g[0]].ar}` : `Gone ${when[g[0]].en}`, value: ads(g[1]) });
  const k = longest('cuts');
  if (k) out.push({ label: ar ? `خفضت سعرها ${when[k[0]].ar}` : `Lowered their price ${when[k[0]].en}`, value: ads(k[1]) });
  if (c.medianArea !== null) out.push({ label: ar ? 'المساحة المعتادة' : 'Typical size', value: ar ? `${num(c.medianArea)} م²` : `${num(c.medianArea)} m²` });
  if (c.priceLow !== null && c.priceHigh !== null) out.push({ label: ar ? 'نطاق الأسعار المعروضة' : 'Displayed price range', value: ar ? `من ${money(c.priceLow, 'ar')} إلى ${money(c.priceHigh, 'ar')}` : `${money(c.priceLow, 'en')} – ${money(c.priceHigh, 'en')}` });
  if (c.stayDays !== null) out.push({ label: ar ? 'مدة بقاء الإعلان' : 'How long ads stay up', value: ar ? daysAr(c.stayDays) : `${c.stayDays} days` });
  else if (c.stayCity) out.push({ label: ar ? 'مدة بقاء الإعلان' : 'How long ads stay up', value: ar ? `${daysAr(c.stayCity.days)} في ${c.stayCity.city}` : `${c.stayCity.days} days in ${c.stayCity.city}` });
  return out;
}

/** The weekly graph: the latest run of finished weeks that each have a price (≥ 10 ads), at least 3, at most 8. */
export function saleWeeks(c: MapCard): WeekPoint[] | null {
  const run: WeekPoint[] = [];
  for (let i = c.weeks.length - 1; i >= 0 && run.length < 8; i--) { const w = c.weeks[i]; if (w.ppm === null || w.n < 10) break; run.unshift(w); }
  return run.length >= 3 ? run : null;
}

/** The logos: the sites with the most ads first, at most 6; the rest are counted («و3 مواقع أخرى»). */
export function saleSites(c: MapCard, loc: 'ar' | 'en'): { shown: string[]; more: string | null } {
  const shown = c.siteList.slice(0, 6);
  const rest = c.siteList.length - shown.length;
  return { shown, more: rest > 0 ? (loc === 'ar' ? (rest === 1 ? 'وموقع آخر' : rest === 2 ? 'وموقعان آخران' : `و${sitesAr(rest)} أخرى`) : `and ${rest} more`) : null };
}
