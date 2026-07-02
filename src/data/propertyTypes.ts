// ─────────────────────────────────────────────────────────────────────────────────────────────
// PROPERTY TYPE NORMALIZATION — the single source of truth for Ezhalah's clean type system.
//
// The scraped data is messy: 30+ raw `property_type` strings spread across platforms, with Arabic
// leaks ("ستوديو", "محطة بنزين"), cross-table mislabels (Commercial Land sitting in residential
// tables), and a generic "Building" that is residential on most platforms but commercial on others.
//
// This module maps every raw type → exactly ONE of two macro categories (Residential / Commercial)
// and ONE clean type, and exposes the user-facing hierarchy (macro → subcategory group → clean type).
//
// THREE fields per listing (kept in `Listing`): raw_property_type (debug/traceability only),
// clean_property_type (shown on cards + used by the filter), macro_category (Residential/Commercial).
//
// IMPORTANT: macro_category is NOT the same as which physical table a row lives in. A "Commercial
// Land" row physically sits in a residential table (that's how Aqar scrapes land) but its macro is
// Commercial. So normalization takes the source TABLE KIND ('res'|'com') as a hint, not as the
// answer. (user spec 2026-06: "Add Residential Building; read-time deterministic mapping".)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type Macro = 'Residential' | 'Commercial';
export type SourceKind = 'res' | 'com';

// The user-facing hierarchy: macro → subcategory groups → clean types. The filter renders exactly
// this. A subcategory GROUP is a soft AI intent (broad); a clean TYPE is a hard exact filter.
export type SubGroup = { group: string; types: string[] };
export const HIERARCHY: Record<Macro, SubGroup[]> = {
  Residential: [
    { group: 'Apartments & Co-living', types: ['Apartment', 'Floor', 'Studio', 'Room', 'Residential Building'] },
    { group: 'Villas & Houses',        types: ['Villa', 'House', 'Duplex', 'Palace'] },
    { group: 'Vacation & Rural',       types: ['Rest House', 'Chalet', 'Camp', 'Farm'] },
    { group: 'Residential Plots',      types: ['Residential Land'] },
  ],
  Commercial: [
    { group: 'Retail & Workspace',                types: ['Office', 'Shop', 'Showroom', 'Bank'] },
    { group: 'Industrial & Logistics',            types: ['Warehouse', 'Workshop', 'Factory', 'Telecom Tower'] },
    { group: 'Commercial Buildings & Facilities', types: ['Commercial Building', 'Hotel', 'Specialized Facilities', 'Gas Station', 'Staff Housing'] },
    { group: 'Commercial & Industrial Plots',     types: ['Commercial Land', 'Industrial Land'] },
  ],
};

// Flat clean-type → macro lookup (derived from HIERARCHY, the single source).
export const CLEAN_MACRO: Record<string, Macro> = (() => {
  const m: Record<string, Macro> = {};
  for (const macro of ['Residential', 'Commercial'] as Macro[])
    for (const g of HIERARCHY[macro]) for (const t of g.types) m[t] = macro;
  return m;
})();

export const ALL_CLEAN_TYPES: string[] = Object.keys(CLEAN_MACRO);
export const groupsFor = (macro: Macro): SubGroup[] => HIERARCHY[macro];
export const groupMembers = (group: string): string[] => {
  for (const macro of ['Residential', 'Commercial'] as Macro[])
    for (const g of HIERARCHY[macro]) if (g.group === group) return g.types;
  return [];
};
export const isCleanType = (s: string): boolean => s in CLEAN_MACRO;
export const isGroup = (s: string): boolean => groupMembers(s).length > 0;

// ── raw → clean mapping ─────────────────────────────────────────────────────────────────────
// Exact raw strings that map to a clean type regardless of source table. Order doesn't matter;
// the Building / kind-dependent cases are handled in normalizeType() before this table.
const RAW_TO_CLEAN: Record<string, string> = {
  // Residential dwellings (pass-through)
  'Apartment': 'Apartment', 'Floor': 'Floor', 'Room': 'Room',
  'Villa': 'Villa', 'House': 'House', 'Duplex': 'Duplex', 'Palace': 'Palace',
  'Rest House': 'Rest House', 'Chalet': 'Chalet', 'Camp': 'Camp',
  // Studio (incl. Arabic leaks)
  'Studio': 'Studio', 'ستوديو': 'Studio', 'شقَّة صغيرة (استوديو)': 'Studio',
  // Serviced-apartment building → Apartment
  'مبنى شقق مخدومة': 'Apartment',
  // Farm + agriculture → Farm (Residential, anywhere)
  'Farm': 'Farm', 'Agriculture Plot': 'Farm',
  // Land family
  'Residential Land': 'Residential Land', 'Land': 'Residential Land',
  'Commercial Land': 'Commercial Land', 'Industrial Land': 'Industrial Land',
  // Commercial — retail & workspace
  'Office': 'Office', 'Showroom': 'Showroom', 'Bank': 'Bank',
  'Shop': 'Shop', 'Kiosk': 'Shop',
  // Commercial — industrial & logistics
  'Warehouse': 'Warehouse', 'Workshop': 'Workshop', 'Factory': 'Factory', 'Telecom Tower': 'Telecom Tower',
  // Commercial — buildings & facilities
  'Commercial Building': 'Commercial Building', 'Hotel': 'Hotel',
  'School': 'Specialized Facilities', 'مدرسة': 'Specialized Facilities', 'Health Center': 'Specialized Facilities',
  'Hall': 'Specialized Facilities', 'Parking': 'Specialized Facilities', 'Cinema': 'Specialized Facilities',
  'Gas Station': 'Gas Station', 'Station': 'Gas Station', 'محطة بنزين': 'Gas Station',
  'سكن عمال': 'Staff Housing',
};

// Normalize ONE raw type into {macro, clean}. `kind` = the table the row came from (res/com),
// used ONLY for the ambiguous "Building" case. Everything else is table-independent.
export function normalizeType(rawType: string | null | undefined, kind: SourceKind): { macro: Macro; clean: string } {
  const raw = (rawType ?? '').trim();
  // "Building" is the one genuinely ambiguous raw type: residential on most platforms (عمائر سكنية),
  // commercial on a few. Resolve by source table. (Protects ~8.7k residential buildings.)
  if (raw === 'Building') {
    return kind === 'com'
      ? { macro: 'Commercial', clean: 'Commercial Building' }
      : { macro: 'Residential', clean: 'Residential Building' };
  }
  const clean = RAW_TO_CLEAN[raw];
  if (clean) return { macro: CLEAN_MACRO[clean], clean };
  // Unknown raw type → keep closest macro from the source table, clean = Unknown (still filterable
  // out, never shown as a raw platform label). (user spec: closest macro when type unclear.)
  return { macro: kind === 'com' ? 'Commercial' : 'Residential', clean: 'Unknown' };
}

// ── reverse: clean type → which raw types to query, in which table kinds ──────────────────────
// The DB stores RAW property_type. To fetch a selected clean type we must query the raw strings it
// came from, in the table kind(s) where they physically live. `kinds` tells the fetch layer whether
// to read residential tables, commercial tables, or both. (Commercial Land lives in RES tables;
// Residential Land can appear in COM tables; Farm/Hotel/Gas Station/Warehouse span both.)
export type CleanQuery = { rawTypes: string[]; kinds: SourceKind[] };
const BOTH: SourceKind[] = ['res', 'com'];
export const CLEAN_TO_QUERY: Record<string, CleanQuery> = {
  // Residential — Apartments & Co-living
  'Apartment':           { rawTypes: ['Apartment', 'مبنى شقق مخدومة'], kinds: ['res'] },
  'Floor':               { rawTypes: ['Floor'], kinds: ['res'] },
  'Studio':              { rawTypes: ['Studio', 'ستوديو', 'شقَّة صغيرة (استوديو)'], kinds: ['res'] },
  'Room':                { rawTypes: ['Room'], kinds: ['res'] },
  'Residential Building':{ rawTypes: ['Building'], kinds: ['res'] },
  // Residential — Villas & Houses
  'Villa':               { rawTypes: ['Villa'], kinds: ['res'] },
  'House':               { rawTypes: ['House'], kinds: ['res'] },
  'Duplex':              { rawTypes: ['Duplex'], kinds: ['res'] },
  'Palace':              { rawTypes: ['Palace'], kinds: ['res'] },
  // Residential — Vacation & Rural (Rest House/Farm appear in com tables too → both)
  'Rest House':          { rawTypes: ['Rest House'], kinds: BOTH },
  'Chalet':              { rawTypes: ['Chalet'], kinds: ['res'] },
  'Camp':                { rawTypes: ['Camp'], kinds: ['res'] },
  'Farm':                { rawTypes: ['Farm', 'Agriculture Plot'], kinds: BOTH },
  // Residential — Plots (Residential Land + generic Land; appears in com tables too → both)
  'Residential Land':    { rawTypes: ['Residential Land', 'Land'], kinds: BOTH },
  // Commercial — Retail & Workspace
  'Office':              { rawTypes: ['Office'], kinds: ['com'] },
  'Shop':                { rawTypes: ['Shop', 'Kiosk'], kinds: ['com'] },
  'Showroom':            { rawTypes: ['Showroom'], kinds: ['com'] },
  'Bank':                { rawTypes: ['Bank'], kinds: ['com'] },
  // Commercial — Industrial & Logistics (Warehouse appears in res too → both)
  'Warehouse':           { rawTypes: ['Warehouse'], kinds: BOTH },
  'Workshop':            { rawTypes: ['Workshop'], kinds: ['com'] },
  'Factory':             { rawTypes: ['Factory'], kinds: ['com'] },
  'Telecom Tower':       { rawTypes: ['Telecom Tower'], kinds: ['com'] },
  // Commercial — Buildings & Facilities
  'Commercial Building': { rawTypes: ['Commercial Building', 'Building'], kinds: ['com'] },
  'Hotel':               { rawTypes: ['Hotel'], kinds: BOTH },
  'Specialized Facilities': { rawTypes: ['School', 'مدرسة', 'Health Center', 'Hall', 'Parking', 'Cinema'], kinds: ['com'] },
  'Gas Station':         { rawTypes: ['Gas Station', 'Station', 'محطة بنزين'], kinds: BOTH },
  'Staff Housing':       { rawTypes: ['سكن عمال'], kinds: BOTH },
  // Commercial — Plots (physically in RES tables on Aqar → both)
  'Commercial Land':     { rawTypes: ['Commercial Land'], kinds: BOTH },
  'Industrial Land':     { rawTypes: ['Industrial Land'], kinds: BOTH },
};

// Resolve a filter selection (one clean type, or a subcategory group) to the raw types + table kinds
// to query. A GROUP expands to the union of its members (the "soft/broad" behaviour). Returns null
// when the selection isn't recognized (→ caller queries everything in the macro).
export function queryForSelection(sel: string | null | undefined): CleanQuery | null {
  if (!sel) return null;
  if (isCleanType(sel)) return CLEAN_TO_QUERY[sel] ?? null;
  if (isGroup(sel)) {
    const raws = new Set<string>();
    const kinds = new Set<SourceKind>();
    for (const t of groupMembers(sel)) {
      const q = CLEAN_TO_QUERY[t];
      if (!q) continue;
      q.rawTypes.forEach((r) => raws.add(r));
      q.kinds.forEach((k) => kinds.add(k));
    }
    return { rawTypes: [...raws], kinds: [...kinds] };
  }
  return null;
}

// Multi-select within a group: union several clean types' raw-type queries → OR across them. Returns
// the combined raw property_types + table kinds to read, or null when none resolve. (multi-type filter.)
export function queryForTypes(types: string[]): CleanQuery | null {
  const raws = new Set<string>();
  const kinds = new Set<SourceKind>();
  for (const ty of types) {
    const q = queryForSelection(ty);
    if (!q) continue;
    q.rawTypes.forEach((r) => raws.add(r));
    q.kinds.forEach((k) => kinds.add(k));
  }
  return raws.size ? { rawTypes: [...raws], kinds: [...kinds] } : null;
}
