// 🆕 New Listings Engineer — pure helpers for customer-journey.mjs (no browser, no network).
// Kept separate so the matching / request-parsing logic has a hermetic self-check:
//   node e2e/engineers/journey-lib.mjs        ← runs the asserts below, exits 0 when sound.

/** URL equality the way full-chain.mjs compares: scheme-normalised, no fragment, no trailing /. */
export const normUrl = (u) =>
  String(u || '').split('#')[0].replace(/\/+$/, '').replace(/^http:/, 'https:');

/** The main search of a بحث press: page 0 of a real page size. index.tsx also fires one
 *  p_limit:1 count probe per visible district, and those can land AFTER the main search —
 *  select by SHAPE, never by recency (the 2026-09-28 '419' failure trusted the wrong signal). */
export const isMainSearch = (body) =>
  (body?.p_offset ?? 0) === 0 && Number(body?.p_limit ?? 0) > 1;

// Advanced Filter amenity chips (src/data/advancedFilters.ts AMENITIES_QUESTION) → the
// search_listings_ar column each p_amenities token asserts. Order = preference when picking
// what to answer for a listing.
export const AMENITY_TOKEN_COLUMN = {
  elevator: 'elevator', kitchen: 'kitchen', parking: 'parking',
  ac: 'air_conditioner', private_entrance: 'private_entrance',
  maid_room: 'maid_room', driver_room: 'driver_room',
  balcony: 'balcony', pool: 'pool', garden: 'garden', gym: 'gym',
  laundry_room: 'laundry_room', optical_fibers: 'optical_fibers',
};

/** The 1–2 Advanced Filter answers this listing is KNOWN (in the DB) to satisfy.
 *  Amenity chips need the column true; the furnished question (Rent-only cohort) needs
 *  furnished === true. Tri-state law: NULL is unknown and never a target. */
export const afTargetsFor = (row, max = 2) => {
  const t = [];
  for (const [token, col] of Object.entries(AMENITY_TOKEN_COLUMN)) {
    if (row[col] === true) t.push({ kind: 'amenity', token });
  }
  if (row.deal_ar === 'إيجار' && row.furnished === true) t.push({ kind: 'furnished' });
  return t.slice(0, max);
};

/** Did the captured search body carry every answered predicate? (p_amenities is the bag the
 *  amenity chips write into; the furnished QUESTION lands on p_furnished — src/data/remote.ts.) */
export const carriedOnRequest = (body, answered) => {
  const bag = Array.isArray(body?.p_amenities) ? body.p_amenities : [];
  const missing = answered.filter((t) =>
    t.kind === 'amenity' ? !bag.includes(t.token) : body?.p_furnished !== true);
  return { carried: answered.length > 0 && missing.length === 0, missing };
};

// Filter-home UI labels per search_listings_ar.type_ar — MIRRORS src/data/propertyTypes.ts
// (HIERARCHY + CLEAN_TO_TYPE_AR) and src/i18n.tsx (Arabic labels). A type outside this table
// makes the journey UNKNOWN rather than guessing a tap.
const G = {
  apt: 'الشقق والسكن المشترك', villa: 'الفلل والبيوت', vac: 'الاستراحات والريف',
  rplot: 'الأراضي السكنية', retail: 'التجزئة والمكاتب', ind: 'الصناعة واللوجستيات',
  cbld: 'المباني والمرافق', cplot: 'الأراضي',
};
export const TYPE_UI = {
  'شقة': { cat: 'سكني', group: G.apt, tap: 'شقة' },
  'دور': { cat: 'سكني', group: G.apt, tap: 'دور' },
  'استوديو': { cat: 'سكني', group: G.apt, tap: 'استوديو' },
  'غرفة': { cat: 'سكني', group: G.apt, tap: 'غرفة' },
  'عمارة سكنية': { cat: 'سكني', group: G.apt, tap: 'عمارة سكنية' },
  'عمارة': { cat: 'سكني', group: G.apt, tap: 'عمارة سكنية' },
  'مجمع': { cat: 'سكني', group: G.apt, tap: 'عمارة سكنية' },
  'فيلا': { cat: 'سكني', group: G.villa, tap: 'فيلا' },
  'بيت': { cat: 'سكني', group: G.villa, tap: 'فيلا' },
  'دوبلكس': { cat: 'سكني', group: G.villa, tap: 'دوبلكس' },
  'استراحة': { cat: 'سكني', group: G.vac, tap: 'استراحة' },
  'شاليه': { cat: 'سكني', group: G.vac, tap: 'شاليه' },
  'مخيم': { cat: 'سكني', group: G.vac, tap: 'مخيم' },
  'مزرعة': { cat: 'سكني', group: G.vac, tap: 'مزرعة' },
  'أرض زراعية': { cat: 'سكني', group: G.vac, tap: 'أرض زراعية' },
  'أرض سكنية': { cat: 'سكني', group: G.rplot, tap: 'أرض سكنية' },
  'مكتب': { cat: 'تجاري', group: G.retail, tap: 'مكتب' },
  'محل': { cat: 'تجاري', group: G.retail, tap: 'محل' },
  'معرض': { cat: 'تجاري', group: G.retail, tap: 'معرض' },
  'مستودع': { cat: 'تجاري', group: G.ind, tap: 'مستودع' },
  'ورشة': { cat: 'تجاري', group: G.ind, tap: 'ورشة' },
  'مصنع': { cat: 'تجاري', group: G.ind, tap: 'مصنع' },
  'مبنى تجاري': { cat: 'تجاري', group: G.cbld, tap: 'مبنى تجاري' },
  'فندق': { cat: 'تجاري', group: G.cbld, tap: 'فندق' },
  'محطة وقود': { cat: 'تجاري', group: G.cbld, tap: 'محطة وقود' },
  'سكن عمال': { cat: 'تجاري', group: G.cbld, tap: 'سكن عمال' },
  'أرض تجارية': { cat: 'تجاري', group: G.cplot, tap: 'أرض تجارية' },
  'أرض صناعية': { cat: 'تجاري', group: G.cplot, tap: 'أرض صناعية' },
};
export const typeUi = (typeAr) => TYPE_UI[String(typeAr || '').normalize('NFC')] ?? null;

/** Stay-length-priced platforms show «اضغط للاطلاع…», never a figure (owner 2026-10-02) —
 *  a customer cannot use a price range to find them, so the journey must not set one. */
export const STAY_LENGTH_PRICED = new Set(['gathern', 'aqarmonthly']);

/** The price a customer would budget around, or null when none applies. PRICE = SOURCE:
 *  the range is built AROUND the stored value, never written over it. */
export const priceOf = (row) => {
  if (STAY_LENGTH_PRICED.has(String(row.platform || '').toLowerCase())) return null;
  const p = row.deal_ar === 'إيجار'
    ? (row.rent_period_ar === 'شهري' ? row.price_total ?? row.price_annual : row.price_annual ?? row.price_total)
    : row.price_total ?? row.price_total_effective;
  return Number.isFinite(Number(p)) && Number(p) > 0 ? Number(p) : null;
};

/** A customer-shaped range around a known value (wide enough to survive rounding). */
export const rangeAround = (v, pct = 0.25) =>
  Number.isFinite(v) && v > 0 ? { min: Math.max(0, Math.floor(v * (1 - pct))), max: Math.ceil(v * (1 + pct)) } : null;

/** Spread N picks across platforms, round-robin, preserving each platform's own order. */
export const pickSpread = (rows, n) => {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.platform)) by.set(r.platform, []);
    by.get(r.platform).push(r);
  }
  const buckets = [...by.values()];
  const out = [];
  for (let i = 0; out.length < n; i++) {
    const had = out.length;
    for (const b of buckets) if (b.length > i && out.length < n) out.push(b[i]);
    if (out.length === had) break;
  }
  return out;
};

export const idKey = (r) => `${r.source_table}:${r.listing_id}`;

// ── hermetic self-check ─────────────────────────────────────────────────────────────────────
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const assert = (await import('node:assert')).strict;
  assert.equal(normUrl('http://x.sa/a/#frag'), 'https://x.sa/a');
  assert.equal(normUrl('https://x.sa/a'), normUrl('http://x.sa/a/'));
  assert.ok(isMainSearch({ p_offset: 0, p_limit: 24 }));
  assert.ok(!isMainSearch({ p_offset: 0, p_limit: 1 }), 'district count probe is not the main search');
  assert.ok(!isMainSearch({ p_offset: 24, p_limit: 24 }), 'page 2 is not the main search');
  const row = { deal_ar: 'إيجار', furnished: true, elevator: true, kitchen: null, parking: false };
  assert.deepEqual(afTargetsFor(row), [{ kind: 'amenity', token: 'elevator' }, { kind: 'furnished' }],
    'NULL is unknown and false is no — neither is a target');
  assert.ok(carriedOnRequest({ p_amenities: ['elevator'], p_furnished: true },
    afTargetsFor(row)).carried);
  assert.ok(!carriedOnRequest({ p_amenities: [] }, [{ kind: 'amenity', token: 'elevator' }]).carried);
  assert.ok(!carriedOnRequest({}, []).carried, 'zero answers can never count as carried');
  assert.equal(typeUi('شقة').group, 'الشقق والسكن المشترك');
  assert.equal(typeUi('نوع غريب'), null);
  assert.equal(priceOf({ platform: 'gathern', deal_ar: 'إيجار', price_total: 500 }), null,
    'stay-length-priced platforms have no customer-visible price');
  assert.equal(priceOf({ platform: 'aqar', deal_ar: 'بيع', price_total: 100000 }), 100000);
  assert.deepEqual(rangeAround(100, 0.25), { min: 75, max: 125 });
  const picked = pickSpread([
    { platform: 'a', listing_id: 1 }, { platform: 'a', listing_id: 2 },
    { platform: 'b', listing_id: 3 }, { platform: 'c', listing_id: 4 },
  ], 3);
  assert.deepEqual(picked.map((r) => r.platform).sort(), ['a', 'b', 'c'], 'spread across platforms first');
  console.log('journey-lib self-check: OK');
}
