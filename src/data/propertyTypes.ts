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
    { group: 'Villas & Houses',        types: ['Villa', 'House', 'Duplex'] }, // قصر/Palace folds into Villa (locked rule; 0 raw Palace listings) — not a separate option
    { group: 'Vacation & Rural',       types: ['Rest House', 'Chalet', 'Camp', 'Farm'] },
    { group: 'Residential Plots',      types: ['Residential Land'] },
  ],
  Commercial: [
    { group: 'Retail & Workspace',                types: ['Office', 'Shop', 'Showroom'] },
    { group: 'Industrial & Logistics',            types: ['Warehouse', 'Workshop', 'Factory'] },
    { group: 'Commercial Buildings & Facilities', types: ['Commercial Building', 'Hotel', 'Gas Station', 'Staff Housing', 'Service Facilities'] }, // + مرافق خدمية box gathers the 5 facility types (owner 2026-07-07). 'Specialized Facilities' retired 2026-07-07 (Hall/Cinema → Commercial Building).
    // 'Facilities' group RETIRED 2026-07-07: its 5 types (Bank/School/Health Center/Telecom Tower/Parking) are now
    // gathered under the single 'Service Facilities' (مرافق خدمية) box above. They stay DISTINCT clean types
    // internally (SERVICE_FACILITY_TYPES / SUBGROUPS below) — DB never merged, cards show raw. [[filter-mapping-decisions-2026-07-06]]
    { group: 'Commercial & Industrial Plots',     types: ['Commercial Land', 'Industrial Land'] },
  ],
};

// 'Service Facilities' (مرافق خدمية) is a FILTER-ONLY grouping box (owner 2026-07-07, permanent): ONE box,
// inside the 'Commercial Buildings & Facilities' group, that gathers the 5 facility types below and returns a
// MIX of all five. The five stay DISTINCT clean types internally — the DB is NEVER merged and property cards
// ALWAYS show the raw scraped type; they're just not shown as separate boxes. Selecting a specific one (agent
// path / future UI) stays STRICT. 'Service Facilities' is never a card/DB value — grouping only.
export const SERVICE_FACILITY_TYPES = ['Bank', 'School', 'Health Center', 'Telecom Tower', 'Parking'];
export const SUBGROUPS: Record<string, string[]> = { 'Service Facilities': SERVICE_FACILITY_TYPES };

// Verified type_ar labels (as stored in search_listings_ar) for the facility types. Used to type-SCOPE
// the candidate RPC so these RARE types are never crowded out of a broad (country-wide) candidate set —
// the main location RPC is type-agnostic + per-platform-capped, so ~10 facility rows would otherwise be
// buried under thousands of newer common listings and return 0. (bug fix 2026-07-07)
export const FACILITY_TYPE_AR: Record<string, string> = {
  'Bank': 'بنك', 'School': 'مدرسة', 'Health Center': 'مركز صحي', 'Telecom Tower': 'برج اتصالات', 'Parking': 'مواقف',
};

// Flat clean-type → macro lookup (derived from HIERARCHY, the single source).
export const CLEAN_MACRO: Record<string, Macro> = (() => {
  const m: Record<string, Macro> = {};
  for (const macro of ['Residential', 'Commercial'] as Macro[])
    for (const g of HIERARCHY[macro]) for (const t of g.types) m[t] = macro;
  // Facility sub-types are gathered under the 'Service Facilities' box (not HIERARCHY boxes) but remain valid
  // COMMERCIAL clean types for normalizeType + strict query + the AI agent. (owner 2026-07-07)
  for (const t of SERVICE_FACILITY_TYPES) m[t] = 'Commercial';
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
//
// UNICODE BYTE-VARIANTS (2026-07-09): raw Arabic can arrive with combining marks in NON-canonical
// order — aqargate #2032796 stores «شقَّة صغيرة (استوديو)» with shadda(U+0651) BEFORE fatha(U+064E),
// while our literal is NFC (fatha first). Same visible text, different bytes → byte-exact matching
// (this table + keptFiltersReq's .in('property_type', …)) misses it. Raw tables are NEVER rewritten
// (aggregator fidelity), so known variants are enumerated here explicitly; the search surface itself
// (type_ar) is NFC-normalized at sync (migration 20260709_type_ar_nfc_normalization). Future variants
// are caught by the novel-type alarm (raw pass — allowlist is NFC, variant ≠ byte-wise → alert).
const STUDIO_AR_SHADDA_FIRST = '\u0634\u0642\u0651\u064E\u0629 \u0635\u063A\u064A\u0631\u0629 (\u0627\u0633\u062A\u0648\u062F\u064A\u0648)'; // «شقّة صغيرة (استوديو)» with shadda(0651) BEFORE fatha(064E) — written as \u escapes so the non-NFC byte order can never be silently re-normalized by an editor/formatter
const RAW_TO_CLEAN: Record<string, string> = {
  // Residential dwellings (pass-through)
  'Apartment': 'Apartment', 'Floor': 'Floor', 'Room': 'Room',
  'Villa': 'Villa', 'House': 'House', 'Duplex': 'Duplex', 'Palace': 'Villa', // قصر folds into فيلا (displayed + searched as Villa)
  'Rest House': 'Rest House', 'Chalet': 'Chalet', 'Camp': 'Camp',
  // Studio (incl. Arabic leaks + the known non-NFC byte-variant, see STUDIO_AR_SHADDA_FIRST above)
  'Studio': 'Studio', 'ستوديو': 'Studio', 'شقَّة صغيرة (استوديو)': 'Studio', [STUDIO_AR_SHADDA_FIRST]: 'Studio',
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
  // المرافق group (owner 2026-07-06): each facility is its OWN strict type (was folded into Specialized
  // Facilities). Card value unchanged — filter mapping only. [[filter-mapping-decisions-2026-07-06]]
  'School': 'School', 'مدرسة': 'School',
  'Health Center': 'Health Center', 'مركز صحي': 'Health Center',
  'Parking': 'Parking', 'مواقف': 'Parking',
  'بنك': 'Bank', 'برج اتصالات': 'Telecom Tower',
  'Hall': 'Commercial Building', 'Cinema': 'Commercial Building', // قاعة/سينما → Commercial Building (Specialized Facilities retired 2026-07-07; card still shows raw Hall/Cinema)
  'Gas Station': 'Gas Station', 'Station': 'Gas Station', 'محطة بنزين': 'Gas Station',
  'سكن عمال': 'Staff Housing',
  // Long-tail dealapp raw types → existing clean types (owner-approved 2026-07-06; each verified against
  // the live listing — the card still shows the ORIGINAL scraped value). [[property-card-and-type-mapping-rule]]
  'تاون هاوس': 'Villa',               // titled فيلا, 4br + garage + majlis
  'ملحق علوي': 'Apartment',           // روف / rooftop apartment, titled شقة
  'مجمع سكني': 'Residential Building', // residential compound
  'مكاتب مشتركة': 'Office',            // shared / co-working offices, titled مكتب
  'مخازن سحابية': 'Warehouse',         // cloud / self-storage, titled مستودع
  'درايف ثرو': 'Shop',                // drive-thru kiosk (كشك)
  'حوش': 'Residential Land',           // walled yard / plot, titled ارض
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
// extraTables: EXTRA raw tables to scan for this clean type beyond its kinds (used when one platform
// misfiles a type into the other kind's table — reaches those rows without widening kinds for everyone).
export type CleanQuery = { rawTypes: string[]; kinds: SourceKind[]; extraTables?: string[] };
const BOTH: SourceKind[] = ['res', 'com'];
export const CLEAN_TO_QUERY: Record<string, CleanQuery> = {
  // Residential — Apartments & Co-living
  'Apartment':           { rawTypes: ['Apartment', 'مبنى شقق مخدومة', 'ملحق علوي'], kinds: ['res'] },
  'Floor':               { rawTypes: ['Floor'], kinds: ['res'] },
  'Studio':              { rawTypes: ['Studio', 'ستوديو', 'شقَّة صغيرة (استوديو)', STUDIO_AR_SHADDA_FIRST], kinds: ['res'] },
  'Room':                { rawTypes: ['Room'], kinds: ['res'] },
  'Residential Building':{ rawTypes: ['Building', 'مجمع سكني'], kinds: ['res'] },
  // Residential — Villas & Houses
  'Villa':               { rawTypes: ['Villa', 'Palace', 'تاون هاوس'], kinds: ['res'] }, // فيلا search includes raw قصر + تاون هاوس
  'House':               { rawTypes: ['House'], kinds: ['res'] },
  'Duplex':              { rawTypes: ['Duplex'], kinds: ['res'] },
  // Residential — Vacation & Rural (Rest House/Farm appear in com tables too → both)
  'Rest House':          { rawTypes: ['Rest House'], kinds: BOTH },
  'Chalet':              { rawTypes: ['Chalet'], kinds: ['res'] },
  'Camp':                { rawTypes: ['Camp'], kinds: ['res'] },
  'Farm':                { rawTypes: ['Farm', 'Agriculture Plot'], kinds: BOTH },
  // Residential — Plots (Residential Land + generic Land; appears in com tables too → both)
  'Residential Land':    { rawTypes: ['Residential Land', 'Land', 'حوش'], kinds: BOTH },
  // Commercial — Retail & Workspace
  'Office':              { rawTypes: ['Office', 'مكاتب مشتركة'], kinds: ['com'], extraTables: ['dealapp_residential_listings'] }, // مكاتب مشتركة = an office dealapp misfiled into its RES table; extraTables reaches it via مكتب WITHOUT widening kinds (which would dilute every office search)
  'Shop':                { rawTypes: ['Shop', 'Kiosk', 'درايف ثرو'], kinds: ['com'] },
  'Showroom':            { rawTypes: ['Showroom'], kinds: ['com'] },
  'Bank':                { rawTypes: ['Bank', 'بنك'], kinds: BOTH },
  // Commercial — Industrial & Logistics (Warehouse appears in res too → both)
  'Warehouse':           { rawTypes: ['Warehouse', 'مخازن سحابية'], kinds: BOTH },
  'Workshop':            { rawTypes: ['Workshop'], kinds: ['com'] },
  'Factory':             { rawTypes: ['Factory'], kinds: ['com'] },
  'Telecom Tower':       { rawTypes: ['Telecom Tower', 'برج اتصالات'], kinds: BOTH },
  // Commercial — Buildings & Facilities
  'Commercial Building': { rawTypes: ['Commercial Building', 'Building', 'Hall', 'Cinema'], kinds: ['com'] }, // Hall/Cinema folded in (Specialized Facilities retired 2026-07-07)
  'Hotel':               { rawTypes: ['Hotel'], kinds: BOTH },
  // Commercial — Facilities (المرافق) — owner 2026-07-06. kinds BOTH so misfiled rows are reachable
  // (مدرسة ×1 sits in dealapp_residential; the rest are in commercial tables).
  'School':              { rawTypes: ['School', 'مدرسة'], kinds: BOTH },
  'Health Center':       { rawTypes: ['Health Center', 'مركز صحي'], kinds: BOTH },
  'Parking':             { rawTypes: ['Parking', 'مواقف'], kinds: BOTH },
  // ('Service Facilities' is DERIVED from SERVICE_FACILITY_TYPES right after this object — single source of truth.)
  'Gas Station':         { rawTypes: ['Gas Station', 'Station', 'محطة بنزين'], kinds: BOTH },
  'Staff Housing':       { rawTypes: ['سكن عمال'], kinds: BOTH },
  // Commercial — Plots (physically in RES tables on Aqar → both)
  'Commercial Land':     { rawTypes: ['Commercial Land'], kinds: BOTH },
  'Industrial Land':     { rawTypes: ['Industrial Land'], kinds: BOTH },
};

// «مرافق خدمية» (Service Facilities) = EXACTLY these 5 facility types, nothing else, EVER (owner 2026-07-07,
// PERMANENT). Derived from SERVICE_FACILITY_TYPES so the fetch (rawTypes) and the match (SUBGROUPS) share ONE
// source of truth — they can never drift or include a non-facility type. Membership changes ONLY by a
// deliberate edit to SERVICE_FACILITY_TYPES, never automatically: a new facility-related raw type is flagged
// for owner approval by the novel-type alarm (cron jobid 33), never auto-added here. (Keep FACILITY_TYPE_AR in sync.)
CLEAN_TO_QUERY['Service Facilities'] = {
  rawTypes: SERVICE_FACILITY_TYPES.flatMap((t) => CLEAN_TO_QUERY[t]?.rawTypes ?? []),
  kinds: BOTH,
};

// ── clean type → Arabic type_ar (for FILTER-FIRST search) ─────────────────────────────────────
// EN→AR mirrors the DB table `type_label_ar`. search_listings_ar.type_ar = coalesce(type_label_ar.ar,
// property_type), so a raw English type becomes its Arabic label and an Arabic "leak" stays itself.
// (owner 2026-07-08: the search RPC must filter the FULL dataset by type BEFORE any cap — it matches
// s.type_ar = any(p_types), so the client must pass the ARABIC labels, never the English rawTypes.)
const EN_TO_AR: Record<string, string> = {
  'Agriculture Plot': 'أرض زراعية', 'Apartment': 'شقة', 'Bank': 'بنك', 'Building': 'عمارة', 'Camp': 'مخيم',
  'Chalet': 'شاليه', 'Cinema': 'سينما', 'Commercial Building': 'مبنى تجاري', 'Commercial Land': 'أرض تجارية',
  'Duplex': 'دوبلكس', 'Factory': 'مصنع', 'Farm': 'مزرعة', 'Floor': 'دور', 'Gas Station': 'محطة وقود', 'Hall': 'صالة',
  'Health Center': 'مركز صحي', 'Hotel': 'فندق', 'House': 'بيت', 'Industrial Land': 'أرض صناعية', 'Kiosk': 'كشك',
  'Land': 'أرض', 'Office': 'مكتب', 'Palace': 'فيلا', 'Parking': 'مواقف', 'Residential Building': 'عمارة سكنية',
  'Residential Land': 'أرض سكنية', 'Rest House': 'استراحة', 'Room': 'غرفة', 'School': 'مدرسة', 'Shop': 'محل',
  'Showroom': 'معرض', 'Specialized Facilities': 'منشآت متخصصة', 'Staff Housing': 'سكن عمال', 'Station': 'محطة',
  'Studio': 'استوديو', 'Telecom Tower': 'برج اتصالات', 'Villa': 'فيلا', 'Warehouse': 'مستودع', 'Workshop': 'ورشة',
};

// DERIVED from CLEAN_TO_QUERY (the single source for a clean type's raw strings) + EN_TO_AR — so adding a
// raw type to CLEAN_TO_QUERY (the existing process) automatically flows here; nothing is hand-maintained
// in parallel. ENFORCED at build time by scripts/verify-taxonomy.ts (a deploy-blocking tripwire, run via
// `npm run verify`): it asserts every live search_listings_ar.type_ar is covered by exactly one clean
// type (except the documented «عمارة»/Building ambiguity, resolved by source-table kind) and fails the
// build on any orphan. That same script generates sql/known_type_ar.generated.sql — the DB allowlist the
// novel-type alarm (detect_novel_property_types(), pg_cron jobid 33) uses to catch drift BETWEEN deploys.
// [[filter-candidate-cap-underreturn-2026-07-08]]
export const CLEAN_TO_TYPE_AR: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const clean of Object.keys(CLEAN_TO_QUERY)) {
    const s = new Set<string>();
    // NFC-normalize every emitted label: the search surface (search_listings_ar.type_ar) is canonical
    // NFC (normalized at sync, migration 20260709_type_ar_nfc_normalization), so p_types must be NFC
    // too — byte-variant rawTypes (e.g. STUDIO_AR_SHADDA_FIRST) collapse into the one canonical label.
    for (const raw of CLEAN_TO_QUERY[clean].rawTypes) s.add((EN_TO_AR[raw] ?? raw).normalize('NFC'));
    m[clean] = [...s];
  }
  return m;
})();

// The Arabic type_ar[] to pass as the RPC's p_types for a single filter selection (a clean type, a
// HIERARCHY group, or the «Service Facilities» subgroup). Mirrors queryForSelection but returns the
// Arabic labels the index is filtered on. null = the selection isn't a type constraint (broad macro).
export function typeArForSelection(sel: string | null | undefined): string[] | null {
  if (!sel) return null;
  const cleans: string[] = isCleanType(sel) ? [sel]
    : isGroup(sel) ? groupMembers(sel)
    : SUBGROUPS[sel] ? SUBGROUPS[sel]
    : [];
  const s = new Set<string>();
  for (const c of cleans) (CLEAN_TO_TYPE_AR[c] ?? []).forEach((a) => s.add(a));
  return s.size ? [...s] : null;
}

// Arabic type_ar[] for a multi-type selection (OR across the selected clean types/groups). null = none.
export function typeArForTypes(types: string[]): string[] | null {
  const s = new Set<string>();
  for (const t of types) (typeArForSelection(t) ?? []).forEach((a) => s.add(a));
  return s.size ? [...s] : null;
}

// Resolve a filter selection (one clean type, or a subcategory group) to the raw types + table kinds
// to query. A GROUP expands to the union of its members (the "soft/broad" behaviour). Returns null
// when the selection isn't recognized (→ caller queries everything in the macro).
export function queryForSelection(sel: string | null | undefined): CleanQuery | null {
  if (!sel) return null;
  if (isCleanType(sel)) return CLEAN_TO_QUERY[sel] ?? null;
  if (isGroup(sel)) {
    const raws = new Set<string>();
    const kinds = new Set<SourceKind>();
    const extra = new Set<string>();
    for (const t of groupMembers(sel)) {
      const q = CLEAN_TO_QUERY[t];
      if (!q) continue;
      q.rawTypes.forEach((r) => raws.add(r));
      q.kinds.forEach((k) => kinds.add(k));
      q.extraTables?.forEach((tb) => extra.add(tb));
    }
    return { rawTypes: [...raws], kinds: [...kinds], ...(extra.size ? { extraTables: [...extra] } : {}) };
  }
  return null;
}

// Multi-select within a group: union several clean types' raw-type queries → OR across them. Returns
// the combined raw property_types + table kinds to read, or null when none resolve. (multi-type filter.)
export function queryForTypes(types: string[]): CleanQuery | null {
  const raws = new Set<string>();
  const kinds = new Set<SourceKind>();
  const extra = new Set<string>();
  for (const ty of types) {
    const q = queryForSelection(ty);
    if (!q) continue;
    q.rawTypes.forEach((r) => raws.add(r));
    q.kinds.forEach((k) => kinds.add(k));
    q.extraTables?.forEach((tb) => extra.add(tb));
  }
  return raws.size ? { rawTypes: [...raws], kinds: [...kinds], ...(extra.size ? { extraTables: [...extra] } : {}) } : null;
}
