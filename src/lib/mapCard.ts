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
export type MapCard = CardSide & {
  any: number;
  priceType: string | null;
  districtAr: string | null;
  cityAr: string | null;
  sites: number;
  stayCity: StayCity;
  table: { y: CardWindow; w: CardWindow; m: CardWindow; q: CardWindow };
  updatedAt: string | null;
  nb: (CardSide & { names: string[]; nDistricts: number; month: CardWindow | null; byDistrict: { district: string; ppm: number | null }[] }) | null;
};

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function win(v: unknown): CardWindow | null {
  const o = obj(v);
  if (!o) return null;
  return { new: int(o.new), gone: int(o.gone), cuts: int(o.cuts), ppm: pos(o.ppm), ppmN: int(o.ppm_n) ?? 0 };
}
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
    ...side(d), any, priceType: typeof d.price_type === 'string' ? d.price_type : null,
    districtAr: typeof d.district_ar === 'string' ? d.district_ar : null, cityAr: typeof d.city_ar === 'string' ? d.city_ar : null,
    sites: int(d.sites) ?? 0, table: { y, w, m, q },
    stayCity: (() => { const sc = obj(d.stay_city); return sc && typeof sc.city === 'string' && int(sc.days) !== null ? { city: sc.city, days: int(sc.days) as number } : null; })(), updatedAt: typeof d.updated_at === 'string' ? d.updated_at : null,
    nb: n && names.length ? { ...side(n), names, nDistricts: Math.max(1, int(n.n_districts) ?? 1), month: win(n.month), byDistrict } : null,
  };
}

const num = (x: number) => Math.round(x).toLocaleString('en-US');
export const SOON = { ar: 'قريبا', en: 'soon' } as const;
export const FEW = { ar: 'إعلانات قليلة', en: 'too few ads' } as const;
/** Under this difference from the neighbours a cell is plain, not red or green. */
export const CARD_SAME_PCT = 5;
export type Tone = 'up' | 'down' | 'plain';
export type Cell = { text: string; tone: Tone };

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
    if (key === 'ppm') return wd.ppm !== null ? { text: num(wd.ppm), tone: 'plain' } : { text: FEW[loc], tone: 'plain' };
    const v = wd[key];
    return v !== null ? { text: num(v), tone: 'plain' } : { text: SOON[loc], tone: 'plain' };
  };
  const cells = [value(c.table.y), value(c.table.w), value(c.table.m), value(c.table.q)];
  const nm = c.nb?.month ?? null;
  let nbCell: Cell = { text: '—', tone: 'plain' };
  if (c.nb && nm) {
    if (key === 'ppm') {
      nbCell = nm.ppm !== null ? { text: num(nm.ppm), tone: 'plain' } : { text: FEW[loc], tone: 'plain' };
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
  return (c.nb?.byDistrict ?? []).map((d) => ({ name: d.district.replace(/^حي\s+/, ''), text: d.ppm !== null ? num(d.ppm) : FEW[loc] }));
}

export const CARD_NOTE = { ar: 'الأسعار هي أسعار العرض في الإعلانات، وليست أسعار البيع النهائية', en: 'Prices are the asking prices in the ads, not final sale prices' } as const;
