// THE PURE HALF OF THE MAP PINS (owner 2026-11-02: «display all property pins … Buy, Rent, Short stays … one golden
// pin with the number when several listings share the exact same coordinates … always show the price as the head
// of the pin»). No imports, so scripts/verify-map-pins-every-listing.ts can EXECUTE every rule here under plain Node.
// The fetch lives in src/data/mapPins.ts; the drawing in src/components/AppleMap.web.tsx.

export type PinDeal = 'buy' | 'rent' | 'short' | 'mixed';
/** One row of map_pins_ar(): an exact point (p_cell = 0) or a count cell (p_cell > 0). */
export type PinRow = {
  lat: number; lng: number; n: number; deal: PinDeal; type_ar: string | null; platforms: number;
  ids: { t: string; i: number }[] | null; price: number | string | null; platform: string | null;
};
export type PinFilter = {
  deals: ('buy' | 'rent' | 'short')[];
  category?: 'residential' | 'commercial' | null;
  types?: string[] | null;          // Arabic type_ar labels, as the index stores them
  beds?: number[] | null;
  areaMin?: number | null; areaMax?: number | null;
  priceMin?: number | null; priceMax?: number | null;
  /** GeoJSON polygon drawn by the user («رسم» → «تطبيق»): only pins strictly inside it. */
  poly?: { type: 'Polygon'; coordinates: number[][][] } | null;
};

/** COLOUR-BLIND-SAFE DEAL COLOURS (owner 2026-11-02): blue Buy and orange Rent are the one pair every kind of colour
 *  blindness tells apart, dark teal for the small Short-stays group, gold for a shared spot. Gold beats the deal colour. */
export const PIN_COLOR: Record<PinDeal, string> = { buy: '#185FA5', rent: '#D85A30', short: '#0F6E56', mixed: '#BA7517' };
export const GOLD = PIN_COLOR.mixed;

/** A shared spot (several listings on identical coordinates) is gold whatever the deals are. */
export function pinColor(row: Pick<PinRow, 'n' | 'deal'>): string {
  return row.n > 1 ? GOLD : PIN_COLOR[row.deal] ?? GOLD;
}

/** STAY-LENGTH PLATFORMS SHOW NO PRICE (the standing Gathern / Aqar Monthly rule, src/lib/listingDisplay.ts). Kept as
 *  the same test, by platform slug, so the pin never prints a figure the card would not. */
export const isStayLengthPlatform = (platform: string | null | undefined): boolean => /gathern|aqarmonthly|aqar\s*monthly/i.test(platform || '');

/** Short money for a pin head: 650 ألف · 1.2 مليون · 45 ألف/سنة (ar), 650K · 1.2M · 45K/yr (en). Below 1,000 the
 *  figure itself. Integers only on the head — it is a label, the card carries the exact price. */
export function shortMoney(value: number, loc: 'ar' | 'en'): string {
  const v = Math.abs(value);
  const one = (x: number) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10).toLocaleString('en-US');
  if (v >= 1_000_000) return loc === 'ar' ? `${one(v / 1_000_000)} مليون` : `${one(v / 1_000_000)}M`;
  if (v >= 1_000) return loc === 'ar' ? `${one(v / 1_000)} ألف` : `${one(v / 1_000)}K`;
  return Math.round(v).toLocaleString('en-US');
}

/** THE HEAD OF THE PIN (owner: «always show the price … if it's merged … the number»): a shared spot shows its count;
 *  a Short-stays listing shows the pool's name (no price by rule); a priced listing its price, a rent per year;
 *  an unpriced listing «السعر عند الطلب», never a blank head. */
export function pinHead(row: Pick<PinRow, 'n' | 'deal' | 'price' | 'platform'>, loc: 'ar' | 'en'): string {
  if (row.n > 1) return loc === 'ar' ? `${row.n} ${row.n === 2 ? 'إعلانان' : row.n <= 10 ? 'إعلانات' : 'إعلان'}` : `${row.n} listings`;
  if (row.deal === 'short' || isStayLengthPlatform(row.platform)) return loc === 'ar' ? 'إقامة قصيرة' : 'Short stay';
  const p = typeof row.price === 'string' ? Number(row.price) : row.price;
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return loc === 'ar' ? 'السعر عند الطلب' : 'Price on request';
  const money = shortMoney(p, loc);
  return row.deal === 'rent' ? (loc === 'ar' ? `${money}/سنة` : `${money}/yr`) : money;
}

/** ZOOM → WHAT TO ASK FOR. From about city zoom inward (a view under ~0.12° ≈ 13 km tall) the map asks for exact
 *  points; wider views ask for count cells sized so the screen holds ~30 columns of bubbles, which is how 424,000
 *  pins stay a few hundred rows whatever the view. 0 = exact points. */
/** Most rows one exact-point read returns. A view holding more would show a PARTIAL set of pins — never allowed. */
export const PIN_LIMIT = 3000;

/** A fine bubble grid for a view whose exact-point read hit PIN_LIMIT (dense downtown): ~14 rows, every listing counted. */
export function fineCellForSpan(latitudeDelta: number): number {
  return Math.max(0.002, latitudeDelta / 14);
}

export function cellForSpan(latitudeDelta: number): number {
  if (latitudeDelta <= 0.12) return 0;
  // ~7 bubble rows across the visible height, so bubbles stay apart and readable. Measured live 2026-11-02 with
  // /30: the country view drew hundreds of overlapping «1» bubbles and buried the big counts under them.
  return Math.max(0.01, latitudeDelta / 7);
}

/** The visible rectangle padded by a fifth on every side, so a small pan does not show an empty strip before the
 *  next answer arrives. Clamped to the Kingdom's neighbourhood. */
export function paddedBox(center: { latitude: number; longitude: number }, span: { latitudeDelta: number; longitudeDelta: number }) {
  const pad = 0.2;
  const dy = span.latitudeDelta * (0.5 + pad), dx = span.longitudeDelta * (0.5 + pad);
  return {
    s: Math.max(-90, center.latitude - dy), n: Math.min(90, center.latitude + dy),
    w: Math.max(-180, center.longitude - dx), e: Math.min(180, center.longitude + dx),
  };
}

/** Count bubble text: 12,400 → «12.4 ألف» / «12.4K», under 1,000 the number. */
export function bubbleText(n: number, loc: 'ar' | 'en'): string {
  return n >= 1_000 ? shortMoney(n, loc) : String(n);
}

/** The RPC arguments for one view + filter. Every unset filter is null = not narrowed. */
export function rpcArgs(box: { s: number; w: number; n: number; e: number }, cell: number, f: PinFilter, limit = 3000) {
  return {
    p_s: box.s, p_w: box.w, p_n: box.n, p_e: box.e,
    p_cell: cell,
    p_deals: f.deals.length === 3 ? null : f.deals,
    p_poly: f.poly ?? null,
    p_limit: limit,
    p_category: f.category ?? null,
    p_types: f.types && f.types.length ? f.types : null,
    p_beds: f.beds && f.beds.length ? f.beds : null,
    p_area_min: f.areaMin ?? null, p_area_max: f.areaMax ?? null,
    p_price_min: f.priceMin ?? null, p_price_max: f.priceMax ?? null,
  };
}

/** Pure: the RPC's `{ data, error }` → rows, or 'unknown' when the fetch failed (A FAILED FETCH IS NOT AN EMPTY ANSWER:
 *  an empty map after an error must never read as «no listings here»). */
export function pinsFrom(result: { data: unknown; error: unknown }): PinRow[] | 'unknown' {
  if (result.error || !Array.isArray(result.data)) return 'unknown';
  return (result.data as PinRow[]).filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number' && typeof r.n === 'number');
}

/** THE SHEET'S IDS, grouped by table in the RPC's order (newest first). A malformed entry is skipped, never thrown on. */
export function idsByTable(row: { ids: { t: string; i: number }[] | null }): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const k of row.ids ?? []) {
    if (!k || typeof k.t !== 'string' || typeof k.i !== 'number') continue;
    const a = m.get(k.t) ?? []; a.push(k.i); m.set(k.t, a);
  }
  return m;
}

/** Cards back from several tables, put back in the RPC's order; a card the RPC did not name sorts last. */
export function orderLike<T extends { sourceTable?: string; id: number }>(row: { ids: { t: string; i: number }[] | null }, cards: T[]): T[] {
  const rank = new Map<string, number>();
  (row.ids ?? []).forEach((k, i) => { if (k) rank.set(`${k.t}#${k.i}`, i); });
  return [...cards].sort((a, b) => (rank.get(`${a.sourceTable}#${a.id}`) ?? 1e9) - (rank.get(`${b.sourceTable}#${b.id}`) ?? 1e9));
}

/** A drawn overlay's points → a closed GeoJSON polygon ([lng, lat] rings), or null when too small to be an area. */
export function polygonOf(points: unknown[]): PinFilter['poly'] {
  // MapKit's PolygonOverlay.points is RINGS — [[Coordinate, …]] — even when the overlay was built from a flat list
  // (measured live 2026-11-02: a drawn boundary applied to nothing because the ring never flattened → null → no
  // polygon). The outer ring is the boundary; a flat list is taken as is.
  const outer = (Array.isArray(points[0]) ? points[0] : points) as { latitude: number; longitude: number }[];
  const ring = outer.filter((p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)).map((p) => [p.longitude, p.latitude]);
  if (ring.length < 3) return null;
  const [x0, y0] = ring[0]; const [xn, yn] = ring[ring.length - 1];
  if (x0 !== xn || y0 !== yn) ring.push([x0, y0]);
  return { type: 'Polygon', coordinates: [ring] };
}
