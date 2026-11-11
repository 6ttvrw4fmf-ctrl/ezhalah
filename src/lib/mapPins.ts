// THE PURE HALF OF THE MAP PINS (owner 2026-11-02: «display all property pins … Buy, Rent, Short stays … one golden
// pin with the number when several listings share the exact same coordinates … always show the price as the head
// of the pin»). No imports, so scripts/verify-map-pins-every-listing.ts can EXECUTE every rule here under plain Node.
// The fetch lives in src/data/mapPins.ts; the drawing in src/components/AppleMap.web.tsx.

export type PinDeal = 'buy' | 'rent' | 'short' | 'mixed';
/** One row of map_pins_ar(): an exact point (p_cell = 0) or a count cell (p_cell > 0). */
export type PinRow = {
  lat: number; lng: number; n: number; deal: PinDeal; type_ar: string | null; platforms: number;
  ids: { t: string; i: number }[] | null; price: number | string | null; platform: string | null;
  /** The spot's highest real price and how many of its ads show none (map_pins_ar, owner 2026-11-10). */
  price_max?: number | string | null; unpriced?: number | null;
  /** How many of the spot's ads the SITE published in the last 3 days (short stays excepted): the «إعلان جديد» tag. */
  fresh?: number | null;
  /** Set on a DISTRICT MARKER (src/lib/mapNoPin.ts): these listings have no exact location and sit at the district's
   *  centre — the sheet titles them by district and prints no head price. */
  noPin?: { city: string; district: string };
  /** Screen px this head is DRAWN away from its own spot so it sits beside a neighbour, never on it (placeApart). */
  shift?: [number, number];
};
export type PinFilter = {
  deals: ('buy' | 'rent' | 'short')[];
  category?: 'residential' | 'commercial' | null;
  types?: string[] | null;          // Arabic type_ar labels, as the index stores them
  /** THE FILTER'S OWN SCOPE (owner 2026-11-10: «this filter is like the one we have but it shows the result in the
   *  map»): the table sets, second type list and category gate the Filter home sends for the same choice, built by
   *  mapTypeScope() in src/data/remote.ts. Set → `category` is not sent; the server applies the Filter's own rule. */
  scope?: { tables: string[] | null; tables2: string[] | null; types2: string[] | null; macro: 'Residential' | 'Commercial' | null } | null;
  beds?: number[] | null;
  areaMin?: number | null; areaMax?: number | null;
  priceMin?: number | null; priceMax?: number | null;
  /** «الأثاث» (owner 2026-11-10): true = furnished, false = unfurnished, null = all. Ads that do not say show only under all. */
  furnished?: boolean | null;
  /** «نُشر خلال» (owner 2026-11-11): published within N days by the site's own date; null = any time. */
  postedWithinDays?: number | null;
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

/** A FIGURE THIS LOW IS A PLACEHOLDER, NOT A PRICE (owner 2026-11-10: «yeah ok do that»): on the pin a sale under
 *  10,000 or a yearly rent under 1,000 reads as «السعر عند الطلب» — sites print 1 or 100 for «call me». Display only:
 *  the card still shows the site's own figure. map_pins_ar applies the same floor. */
export const PIN_PRICE_FLOOR = { buy: 10_000, rent: 1_000 } as const;
export function pinPrice(v: number | string | null | undefined, deal: string | null | undefined): number | null {
  const p = typeof v === 'string' ? Number(v) : v;
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return null;
  return p >= (deal === 'rent' ? PIN_PRICE_FLOOR.rent : PIN_PRICE_FLOOR.buy) ? p : null;
}

/** THE PRICE RULE OF A PIN (owner 2026-11-10: «we don't say 2 instead we just put the price … lowest price wins …
 *  price on request = price listed if there is»). Never a count:
 *    · one price and nothing else at the spot          → «750 ألف»
 *    · anything else there (another price, or an ad with no price) → «من 750 ألف» — the lowest real price
 *    · no real price at all                            → «السعر عند الطلب»
 *  A rent is per year («/سنة»). Every ad stays in the sheet, priced or not. */
export function priceHead(min: number | null, max: number | null, unpriced: number, deal: string | null | undefined, loc: 'ar' | 'en'): string {
  if (min === null) return loc === 'ar' ? 'السعر عند الطلب' : 'Price on request';
  const money = shortMoney(min, loc) + (deal === 'rent' ? (loc === 'ar' ? '/سنة' : '/yr') : '');
  const from = unpriced > 0 || (max !== null && max > min);
  return from ? (loc === 'ar' ? `من ${money}` : `from ${money}`) : money;
}

/** THE HEAD OF THE PIN: a Short-stays spot shows the pool's name (no price by rule); every other spot its price by
 *  priceHead(). Only a zoomed-out bubble mixing buy and rent (never an exact spot — map_pins_ar splits those by deal)
 *  falls back to its count. */
export function pinHead(row: Pick<PinRow, 'n' | 'deal' | 'price' | 'platform' | 'price_max' | 'unpriced'>, loc: 'ar' | 'en'): string {
  if (row.deal === 'short' || isStayLengthPlatform(row.platform)) return loc === 'ar' ? 'إقامة قصيرة' : 'Short stay';
  if (row.deal === 'mixed' && row.n > 1) return loc === 'ar' ? `${row.n} ${row.n === 2 ? 'إعلانان' : row.n <= 10 ? 'إعلانات' : 'إعلان'}` : `${row.n} listings`;
  const f = priceFacts(row);
  return priceHead(f.min, f.max, f.unpriced, row.deal, loc);
}

/** «إعلان جديد» — A NEW AD AT THIS SPOT (owner 2026-11-11, Zillow's «New»): a spot holding an ad its SITE published in the
 *  last 3 days (map_pins_ar's `fresh`, by the site's own posting date — never the day Ezhalah found it) shows a small tag
 *  above its price. Short stays never get it. The word is «إعلان جديد», never «جديد» alone: «جديد» in the Filter means a
 *  newly BUILT property. */
export const FRESH_DAYS = 3;
export function isFreshHead(row: Pick<PinRow, 'fresh' | 'deal'>): boolean {
  return Number(row.fresh ?? 0) > 0 && row.deal !== 'short';
}
export const freshTag = (loc: 'ar' | 'en'): string => (loc === 'ar' ? 'إعلان جديد' : 'New listing');

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
    ...(f.furnished != null ? { p_furnished: f.furnished } : {}),
    ...(f.postedWithinDays != null ? { p_posted_within_days: f.postedWithinDays } : {}),
    ...(f.scope ? { p_tables: f.scope.tables, p_tables2: f.scope.tables2, p_types2: f.scope.types2, p_macro: f.scope.macro } : {}),
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

/** THE SAME PROPERTY IS ONE CARD THAT NAMES EVERY SITE (owner 2026-11-10, the final pin rule). Cards under one pin are
 *  the same property only with PROOF — never because they look alike:
 *    1. the same government advertising licence and the same deal; or
 *    2. the same site with the deal, price, size, type, rooms AND a known floor all matching (a site's own repost) —
 *       two flats whose floor nobody published are two flats (measured 2026-11-10, wasalt حي بدر: plots 475 and 476,
 *       every other field equal); or
 *    3. a WHOLE property (villa, land, building … — it stands on its own ground) of the same type and the same size at
 *       this pin, on any site. A unit (flat, room, office, shop …) shares its building with look-alikes, so two flats
 *       are never the same by rule 3 — only by rule 1 or 2.
 *  TWO DIFFERENT LICENCES ARE NEVER FOLDED BY RULE 2 OR 3: the licences say the ads may be two properties (twin villas,
 *  two units), and unknown is not «the same». Rule 1 runs first, so each group knows its licence before 2 and 3 look.
 *  Nothing is dropped: the group keeps every ad — the cheapest leads, the rest are named under it with their prices.
 *  A card with no facts (the index read failed) is never grouped. */
export type FoldFacts = { site: string; lic?: string | null; dealAr?: string | null; typeAr?: string | null; area?: number | null; price?: number | null; beds?: number | null; floor?: number | null };
export const UNIT_TYPES_AR = ['شقة', 'استوديو', 'دور', 'غرفة', 'مكتب', 'محل', 'ملحق علوي', 'مكاتب مشتركة', 'كشك', 'غير معروف', 'مركز أعمال', 'مواقف', 'تخزين ذاتي', 'مخازن سحابية'];
export function foldSameProperty<T>(cards: T[], factsOf: (c: T) => FoldFacts): { main: T; others: T[] }[] {
  const parent = cards.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const facts = cards.map(factsOf);
  const licOf = facts.map((f) => (f.lic && /^[0-9]{6,}$/.test(f.lic) ? f.lic : ''));
  const lics = licOf.map((l) => new Set(l ? [l] : []));                 // per group root: the licences it holds
  const join = (i: number, j: number, proven: boolean): boolean => {
    const a = find(i), b = find(j);
    if (a === b) return true;
    if (!proven && lics[a].size && lics[b].size && [...lics[a]].some((l) => !lics[b].has(l))) return false;   // two licences → not proven the same
    parent[a] = b; for (const l of lics[a]) lics[b].add(l);
    return true;
  };
  const pass = (keyOf: (f: FoldFacts, i: number) => string | null, proven: boolean) => {
    const seen = new Map<string, number[]>();
    facts.forEach((f, i) => {
      const k = keyOf(f, i); if (k === null) return;
      const before = seen.get(k) ?? [];
      if (!before.some((j) => join(i, j, proven))) seen.set(k, [...before, i]);   // joins the first group it may join, else stands as a new one
    });
  };
  const base = (f: FoldFacts) => (f.dealAr && f.typeAr && typeof f.area === 'number' && f.area > 0 ? `${f.dealAr}|${f.typeAr}|${f.area}` : null);
  pass((f, i) => (f.dealAr && licOf[i] ? `${licOf[i]}|${f.dealAr}` : null), true);
  pass((f) => (base(f) && f.site && typeof f.price === 'number' && f.price > 0 && typeof f.floor === 'number' ? `${f.site}|${base(f)}|${f.price}|${f.beds ?? ''}|${f.floor}` : null), false);
  pass((f) => (base(f) && !UNIT_TYPES_AR.includes(f.typeAr as string) ? base(f) : null), false);
  const groups = new Map<number, number[]>();
  cards.forEach((_, i) => { const r = find(i); const g = groups.get(r); if (g) g.push(i); else groups.set(r, [i]); });
  const priced = (i: number) => (typeof facts[i].price === 'number' && (facts[i].price as number) > 0 ? (facts[i].price as number) : Infinity);
  // Groups stay in the order their first card arrived; inside a group the cheapest leads (ties keep the arrival order).
  return [...groups.values()].sort((a, b) => a[0] - b[0]).map((g) => {
    const byPrice = [...g].sort((a, b) => priced(a) - priced(b) || a - b);
    return { main: cards[byPrice[0]], others: byPrice.slice(1).map((i) => cards[i]) };
  });
}

/** THE SHEET SAYS WHAT A BUILDING HOLDS (owner 2026-11-10: «12 شقة للإيجار من 40,000»): only when EVERY ad of the pin
 *  is loaded and they all share one type and one deal — otherwise null and the plain count stays. `from` is the lowest
 *  price, or null when any ad has none to show (then the line carries no price rather than a partial one). */
export function sameKindSummary(n: number, facts: (FoldFacts & { showsPrice: boolean })[]): { typeAr: string; dealAr: string; from: number | null } | null {
  if (n < 2 || facts.length !== n) return null;
  const typeAr = facts[0].typeAr || '', dealAr = facts[0].dealAr || '';
  if (!typeAr || !dealAr || typeAr === 'غير معروف' || facts.some((f) => f.typeAr !== typeAr || f.dealAr !== dealAr)) return null;
  const all = facts.every((f) => f.showsPrice && typeof f.price === 'number' && f.price > 0);
  return { typeAr, dealAr, from: all ? Math.min(...facts.map((f) => f.price as number)) : null };
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

/** ONE PIN = ONE PLACE; NEIGHBOURS SIT SIDE BY SIDE (owner 2026-11-10: «the pins only go together if they are the same
 *  listings … just because they're close … if not, you put them beside each other. That's the rule. Just don't make
 *  them on top of each other where a user can't click»). This replaces the 2026-11-05 rule that JOINED every pair of
 *  heads that would touch into one gold count: two different places a few metres apart read as one «N إعلانات» head.
 *  Kept from that rule (owner 2026-11-05: «user cannot select what he wants»): no two heads ever touch on screen.
 *  A head whose own spot is taken is drawn in the nearest free place beside its neighbours, at most PIN_MAX_SHIFT_PX
 *  away, and keeps its own price and its own ad list; only where a pile leaves no room that close does a head join its
 *  nearest neighbour as a counted head (zooming in gives them room again). Listings on the SAME coordinates arrive
 *  as one row from map_pins_ar and stay one head. Recomputed on every settled view; nothing is added or dropped —
 *  every id is on exactly one head (MATCH FIRST). */
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
/** A head's price facts: its lowest and highest real price and how many of its ads show none (pinPrice's floor). */
export function priceFacts(r: Pick<PinRow, 'n' | 'deal' | 'price' | 'price_max' | 'unpriced'>): { min: number | null; max: number | null; unpriced: number } {
  const min = pinPrice(r.price, r.deal);
  if (r.n <= 1) return { min, max: min, unpriced: min === null ? 1 : 0 };
  return { min, max: pinPrice(r.price_max, r.deal) ?? min, unpriced: Number(r.unpriced ?? 0) };
}
/** Two heads as one: every id of both at their weighted centre, deal kept only when both agree — and, under the price
 *  rule, the LOWEST real price of both, the highest, and their no-price ads added up (CodeRabbit #11777: a joined head
 *  used to drop its price and read «السعر عند الطلب» over priced ads). */
export function joinPins(a: PinRow, b: PinRow): PinRow {
  const n = a.n + b.n;
  const fa = priceFacts(a), fb = priceFacts(b);
  const lo = [fa.min, fb.min].filter((x): x is number => x !== null);
  const hi = [fa.max, fb.max].filter((x): x is number => x !== null);
  // A head joining buy AND rent shows its count (pinHead), so it carries no price: a sale figure and a rent are never
  // one number, and a later join must not re-read a rent through the sale floor.
  if (a.deal !== b.deal) return {
    lat: (a.lat * a.n + b.lat * b.n) / n, lng: (a.lng * a.n + b.lng * b.n) / n, n,
    deal: 'mixed', type_ar: null, platforms: Math.max(a.platforms || 0, b.platforms || 0),
    ids: a.ids || b.ids ? [...(a.ids ?? []), ...(b.ids ?? [])] : null, price: null, platform: null, price_max: null, unpriced: 0,
  };
  return {
    lat: (a.lat * a.n + b.lat * b.n) / n, lng: (a.lng * a.n + b.lng * b.n) / n, n,
    deal: a.deal === b.deal ? a.deal : 'mixed', type_ar: null, platforms: Math.max(a.platforms || 0, b.platforms || 0),
    ids: a.ids || b.ids ? [...(a.ids ?? []), ...(b.ids ?? [])] : null,
    price: lo.length ? Math.min(...lo) : null, platform: null,
    price_max: hi.length ? Math.max(...hi) : null, unpriced: fa.unpriced + fb.unpriced,
  };
}
/** How far a head may be drawn from its own spot to sit beside a neighbour. A head is ~60 px wide, so «beside» needs
 *  one head across (65 px on the lattice); 84 px also reaches two rows down in the side columns — about 17 places
 *  around one spot. At 52 px a head could only go above or below, never beside (measured by the barrier). */
export const PIN_MAX_SHIFT_PX = 84;
/** The places tried around a head's own spot, nearest first (a 13 px lattice: half a head's height plus its air). */
const SHIFT_STEP_PX = (PIN_H_PX + PIN_GAP_PX) / 2;
function shiftsWithin(max: number): [number, number][] {
  const out: [number, number][] = []; const k = Math.floor(max / SHIFT_STEP_PX);
  for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) {
    const dx = i * SHIFT_STEP_PX, dy = j * SHIFT_STEP_PX;
    if (Math.hypot(dx, dy) <= max) out.push([dx, dy]);
  }
  // Nearest first; on a tie beside (same height) before above/below, then a fixed order so a redraw lands the same.
  return out.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || Math.abs(a[1]) - Math.abs(b[1]) || a[1] - b[1] || a[0] - b[0]);
}
/**
 * The heads to draw for one view, none touching another. `at` places a coordinate on the screen (px), `widthOf` gives
 * a head's width for the text it will show (a joined head shows the lowest price of both, so its width is re-measured). A row comes
 * back unchanged when it sits on its own spot, with `shift` when it is drawn beside it, or joined (joinPins) when no
 * place within `maxShift` was free. Shared spots are placed first so they keep their own place; the rest in a fixed
 * order, so a pan does not reshuffle who moved.
 */
export function placeApart(rows: PinRow[], at: (lat: number, lng: number) => [number, number], widthOf: (r: PinRow) => number, maxShift: number = PIN_MAX_SHIFT_PX): PinRow[] {
  type Head = Placed & { x0: number; y0: number; cells: string[] };
  const shifts = shiftsWithin(maxShift);
  // A grid of what is already placed, so a head is checked against its neighbours only (a deepest-zoom view can read
  // 3,000 points).
  const CELL = 64; const grid = new Map<string, Head[]>();
  const cellsOf = (c: { x: number; y: number; w: number }): string[] => {
    const out: string[] = [];
    const x1 = Math.floor((c.x - c.w / 2 - PIN_GAP_PX) / CELL), x2 = Math.floor((c.x + c.w / 2 + PIN_GAP_PX) / CELL);
    const y1 = Math.floor((c.y - PIN_H_PX - PIN_GAP_PX) / CELL), y2 = Math.floor((c.y + PIN_H_PX + PIN_GAP_PX) / CELL);
    for (let gx = x1; gx <= x2; gx++) for (let gy = y1; gy <= y2; gy++) out.push(`${gx},${gy}`);
    return out;
  };
  const isFree = (c: { x: number; y: number; w: number }): boolean => {
    for (const k of cellsOf(c)) for (const h of grid.get(k) ?? []) if (headsTouch(c, h)) return false;
    return true;
  };
  const all = new Set<Head>();
  const put = (h: Head) => { h.cells = cellsOf(h); for (const k of h.cells) { const g = grid.get(k); if (g) g.push(h); else grid.set(k, [h]); } all.add(h); };
  const take = (h: Head) => { for (const k of h.cells) { const g = grid.get(k); if (g) g.splice(g.indexOf(h), 1); } all.delete(h); };
  const start = (row: PinRow): Head => { const [x0, y0] = at(row.lat, row.lng); return { row, x: x0, y: y0, x0, y0, w: widthOf(row), cells: [] }; };

  const order = [...rows].sort((a, b) => b.n - a.n || b.lat - a.lat || a.lng - b.lng);
  for (const row of order) {
    let cur = start(row);
    for (;;) {
      const s = shifts.find(([dx, dy]) => isFree({ x: cur.x0 + dx, y: cur.y0 + dy, w: cur.w }));
      if (s) { cur.x = cur.x0 + s[0]; cur.y = cur.y0 + s[1]; put(cur); break; }
      // No room beside its neighbours this close: join the nearest head, then place the joined head again.
      let near: Head | null = null; let best = Infinity;
      for (const h of all) { const d = Math.hypot(h.x0 - cur.x0, h.y0 - cur.y0); if (d < best) { best = d; near = h; } }
      if (!near) { put(cur); break; }   // nothing placed yet: its own spot is free by definition
      take(near);
      cur = start(joinPins(near.row, cur.row));
    }
  }
  return [...all].map((h) => (h.x === h.x0 && h.y === h.y0 ? h.row : { ...h.row, shift: [h.x - h.x0, h.y - h.y0] as [number, number] }));
}

/** MapKit draws a custom annotation's element with its bottom centre at (the coordinate's point − anchorOffset) —
 *  measured on ezhalah.com/map 2026-11-10: an offset of (50, −30) drew the element 50 px LEFT and 30 px BELOW. The
 *  unshifted head keeps the (0, −6) it has always had; a shifted head subtracts its shift. */
export const PIN_ANCHOR_Y = -6;
export function pinAnchorOffset(shift?: [number, number]): [number, number] {
  return shift ? [-shift[0], PIN_ANCHOR_Y - shift[1]] : [0, PIN_ANCHOR_Y];
}
/** Where a shifted head's CENTRE is drawn relative to its ad's own spot (screen px, y down), or null when the head is
 *  not shifted or still covers its own spot — then there is nothing to point at. The map draws a line from the spot to
 *  here as a MapKit OVERLAY: on the map itself, under every head. (A line inside the head's own element was painted over
 *  its neighbours' text — the spot of a moved head lies under another head by definition; measured live 2026-11-10.) */
export function pinStemTo(shift: [number, number] | undefined, halfWidth: number): [number, number] | null {
  if (!shift) return null;
  // The ad's spot relative to the head's bottom centre: the head sits `shift` away and −PIN_ANCHOR_Y lower.
  const tx = -shift[0], ty = PIN_ANCHOR_Y - shift[1];
  if (ty <= 0 && ty >= -PIN_H_PX && Math.abs(tx) <= halfWidth) return null;   // the head still covers its own spot
  return [shift[0], shift[1] - PIN_ANCHOR_Y - PIN_H_PX / 2];
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

