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

/** ZOOMED OUT, A CELL IS A SMALL DOT (owner 2026-11-02, Zillow: «pins … don't show the price unless you zoom in»): the
 *  deal's colour, a neutral dark when the cell mixes deals; never gold (a cell is not a shared spot) and no number. */
export const MIXED_DOT = '#5B4A6B';
export function dotColor(row: Pick<PinRow, 'deal'>): string {
  return row.deal === 'mixed' ? MIXED_DOT : PIN_COLOR[row.deal] ?? MIXED_DOT;
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
/** Most pins a view SHOWS as price heads (owner 2026-11-02: «when I zoom in I start seeing so many things»): a view
 *  holding more keeps the fine dots until the user zooms closer — readable, and far lighter on a phone. */
export const PIN_SHOW_MAX = 400;

/** A fine bubble grid for a view whose exact-point read hit PIN_LIMIT (dense downtown): ~14 rows, every listing counted. */
/** THE GRID LADDER: every grid request uses one of these cell sizes, so the unfiltered grid can be PRECOMPUTED
 *  (map_grid_ar, refreshed hourly) and served in milliseconds — measured live 2026-11-02, the country view's live
 *  grid read took 2.5 s per zoom-out (owner: «it feels slow … zoom out must show a span of all»). */
export const CELL_LADDER = [2.4, 1.2, 0.6, 0.3, 0.15, 0.075, 0.04, 0.02, 0.01] as const;
/** The largest ladder cell not above `x`; the finest cell when none is. */
export function ladderCell(x: number): number {
  for (const c of CELL_LADDER) if (c <= x) return c;
  return CELL_LADDER[CELL_LADDER.length - 1];
}

export function fineCellForSpan(latitudeDelta: number): number {
  return ladderCell(latitudeDelta / 32);
}

/**
 * Whether a fine bubble grid still makes sense for this view: a bubble must be at most half the view tall, so a tap
 * on it (bubbleTapSpan: a third of the view) can zoom INTO it. At the deepest zoom MapKit allows on a phone
 * (≈ 0.0056° tall) the finest cell (0.01°) is bigger than the view and a tap changes nothing: bubbles there hide the
 * listings behind a number forever (🔧 2026-11-06: حي البوادي, 2 bubbles «218» / «1.3 ألف», 0 pins, map-pins-live red
 * every run since 2026-11-05). Such a view draws its exact points, merged into counted heads, instead.
 */
export function bubblesCanZoomIn(latitudeDelta: number): boolean {
  return fineCellForSpan(latitudeDelta) * 2 <= latitudeDelta;
}

export function cellForSpan(latitudeDelta: number): number {
  if (latitudeDelta <= 0.12) return 0;
  // ~7 dot rows across the visible height, snapped to the ladder. Measured live 2026-11-02 with /30: the country view
  // drew hundreds of overlapping «1» bubbles and buried the big counts under them.
  // DENSE dots (owner 2026-11-02: «why don't you show everything»): ~16 dot rows across the view — hundreds of small
  // dots over the country, like Zillow — every one still on the precomputed ladder, so the read stays instant.
  return ladderCell(latitudeDelta / 16);
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

/** IDENTICAL COPIES FOLD INTO ONE CARD (owner 2026-11-02: «some also have duplicates, it's a bit weird» — a Khobar
 *  off-plan project posted the same villa 12 times on one spot). Cards with the same key — the SAME site, price, area,
 *  type, title and photo — show once with «and N identical listings»; a different site, price or unit is never folded,
 *  so no source is merged away and nothing is dropped: the count says exactly how many copies the site published. */
export function foldDuplicates<T>(cards: T[], keyOf: (c: T) => string): { card: T; copies: number }[] {
  const out: { card: T; copies: number }[] = []; const at = new Map<string, number>();
  for (const c of cards) {
    const k = keyOf(c); const i = at.get(k);
    if (i === undefined) { at.set(k, out.length); out.push({ card: c, copies: 1 }); } else out[i].copies++;
  }
  return out;
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

/** PINS NEVER SIT ON EACH OTHER (owner 2026-11-05: «user cannot select what he wants … so so many duplicated listings
 *  … we need to make sure they are in the same pin close by … whenever we get a new listing»). Measured that day on a
 *  phone: a «660 ألف» head covered a «2 إعلانان» head, and two «950 ألف» heads sat on each other a few metres apart (the
 *  same land on two sites) — the one underneath could not be tapped. Heads that would touch ON SCREEN become one gold
 *  head with their count; tapping it lists every ad (the sheet reads `ids`). Recomputed on every settled view, so
 *  zooming in pulls them apart again (Zillow), and a listing that arrived a minute ago is covered at once — no batch
 *  job to wait for. Nothing is added or dropped: the merged head's n and ids are the sums of the heads it took in
 *  (MATCH FIRST — fewer heads over the same matched set). */
export const PIN_H_PX = 22;    // 11 px text + 4 px padding above and below + 1.5 px border each side
export const PIN_GAP_PX = 4;   // the least air left between two heads, so a finger lands on one
export const PIN_PAD_PX = 17;  // 7 px padding each side + 1.5 px border each side
/** A head's width when the page cannot measure text (no canvas): ~6.4 px a character at 11 px semibold. */
export function pinWidthGuess(text: string): number { return Math.ceil(text.length * 6.4) + PIN_PAD_PX; }

type Placed = { row: PinRow; x: number; y: number; w: number };
/** Two heads touch when their pills, plus the gap, overlap. Both sit centred on x, bottom on y (same height). */
export function headsTouch(a: { x: number; y: number; w: number }, b: { x: number; y: number; w: number }): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + PIN_GAP_PX && Math.abs(a.y - b.y) < PIN_H_PX + PIN_GAP_PX;
}
/** Two heads as one: the count and every id of both, at their weighted centre; deal kept only when both agree. */
export function joinPins(a: PinRow, b: PinRow): PinRow {
  const n = a.n + b.n;
  return {
    lat: (a.lat * a.n + b.lat * b.n) / n, lng: (a.lng * a.n + b.lng * b.n) / n, n,
    deal: a.deal === b.deal ? a.deal : 'mixed', type_ar: null, platforms: Math.max(a.platforms || 0, b.platforms || 0),
    ids: a.ids || b.ids ? [...(a.ids ?? []), ...(b.ids ?? [])] : null, price: null, platform: null,
  };
}
/**
 * The heads to draw for one view, none touching another. `at` places a coordinate on the screen (px), `widthOf` gives
 * a head's width for the text it will show (a merged head shows its count, so its width is re-measured). A merged head
 * is checked again against every other head, so a chain of near neighbours ends as one head, never two that touch.
 */
export function mergeOverlapping(rows: PinRow[], at: (lat: number, lng: number) => [number, number], widthOf: (r: PinRow) => number): PinRow[] {
  const place = (row: PinRow): Placed => { const [x, y] = at(row.lat, row.lng); return { row, x, y, w: widthOf(row) }; };
  const cs = rows.map(place);
  let i = 0;
  while (i < cs.length) {
    let hit = -1;
    for (let j = 0; j < cs.length; j++) if (j !== i && headsTouch(cs[i], cs[j])) { hit = j; break; }
    if (hit < 0) { i++; continue; }
    const lo = Math.min(i, hit), hi = Math.max(i, hit);
    cs[lo] = place(joinPins(cs[lo].row, cs[hi].row));
    cs.splice(hi, 1);
    i = lo;
  }
  return cs.map((c) => c.row);
}

/** WHERE THE VIEW IS (owner 2026-11-05: «you see how it says هذه المنطقة — include the name of the district»). The
 *  count pill names the district when at least PLACE_SHARE of the listings in view sit in it, else the city on the same
 *  rule, else «هذه المنطقة» — never a name most of the view is not in. A failed lookup is null: the plain wording. */
export const PLACE_SHARE = 0.6;
export type ViewPlace = { district: string | null; city: string | null; district_share: number | string | null; city_share: number | string | null };
export function viewPlaceName(p: ViewPlace | null, loc: 'ar' | 'en', latin: (s: string) => string = (s) => s): string | null {
  if (!p) return null;
  const bare = (p.district ?? '').trim().replace(/^حي\s+/, '');
  if (bare && Number(p.district_share) >= PLACE_SHARE) return loc === 'ar' ? `حي ${bare}` : latin(bare);
  const city = (p.city ?? '').trim();
  if (city && Number(p.city_share) >= PLACE_SHARE) return loc === 'ar' ? city : latin(city);
  return null;
}
/** The count pill: «7 إعلانات في حي الشراع» / «7 listings in الشراع»; «… في هذه المنطقة» / «… here» without a place. */
export const DEAL_WORD: Record<'ar' | 'en', Record<string, string>> = {
  ar: { buy: 'للبيع', rent: 'للإيجار', short: 'للإقامة القصيرة' },
  en: { buy: 'for sale', rent: 'for rent', short: 'for short stays' },
};
/**
 * The pill SAYS WHICH DEAL it counts, and an empty deal points at the others (owner 2026-11-05, a full-screen map over
 * Umluj: «0 listings here» — the map was on Buy, where Umluj has no pinned listing, while its 12 pinned listings are
 * rentals and short stays; full screen hides the deal button, so «0» read as «Ezhalah has nothing here»). With one deal
 * chosen: «12 إعلان للإيجار في أملج»; with none of it in view but others present (`others`): «لا يوجد للبيع في أملج ·
 * يوجد للإيجار». Several deals chosen: no deal word, as before.
 */
export function viewCountText(n: number, place: string | null, loc: 'ar' | 'en', deals?: readonly string[], others: readonly string[] = []): string {
  const num = n.toLocaleString('en-US');
  const one = deals && deals.length === 1 ? deals[0] : null;
  const w = DEAL_WORD[loc];
  if (n === 0 && one && others.length) {
    return loc === 'en'
      ? `None ${w[one]} ${place ? `in ${place}` : 'here'} · some ${others.map((d) => w[d]).join(' and ')}`
      : `لا يوجد ${w[one]} في ${place ?? 'هذه المنطقة'} · يوجد ${others.map((d) => w[d]).join(' و')}`;
  }
  const dealWord = one ? ` ${w[one]}` : '';
  if (loc === 'en') return `${num} ${n === 1 ? 'listing' : 'listings'}${dealWord} ${place ? `in ${place}` : 'here'}`;
  const noun = n === 2 ? 'إعلانان' : n >= 3 && n <= 10 ? 'إعلانات' : 'إعلان';
  return `${num} ${noun}${dealWord} في ${place ?? 'هذه المنطقة'}`;
}
