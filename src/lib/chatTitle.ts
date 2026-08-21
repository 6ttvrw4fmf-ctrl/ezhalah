import type { SearchQuery } from '@/data/search';

// SIDEBAR TITLES (owner decision 2026-08-21).
//
// "Sidebar titles are display metadata. Auto-generate a concise useful summary like ChatGPT, let
// signed-in users rename inline by double-click, and never let renaming alter the underlying
// chat/search."
//
// Two rules shape everything here:
//
//   1. A TITLE IS NOT AN IDENTITY. Saved-search de-duplication is savedSearchIdentity.ts's job and
//      stays completely separate — two entries may legitimately carry the same title (the user can
//      even rename them alike), and renaming must never touch the query. This module returns a
//      STRING and nothing else; it reads the query and never mutates it.
//   2. CONCISE BEATS COMPLETE. The point is telling two saved searches apart at a glance, not
//      restating the filter. So: type + deal + place, then at most MAX_DETAILS distinguishing
//      chips, most-useful first. `شقق للإيجار في الرياض · مفروش · حمامين`, never a dump of all 41
//      fields.
//
// Zero runtime dependencies (only a compile-time type import) so scripts/verify-chat-title.ts can
// EXECUTE the real generator rather than grep for it — same design as searchDefaults.ts and
// savedSearchIdentity.ts.
//
// No model call. The owner's rule: "Use existing free/local logic if possible. Do not add a paid
// model call just to generate sidebar titles." Everything below is local string work.

export type TitleSource = 'auto' | 'manual';

/** How many ` · ` chips may follow the base phrase. Three is where a sidebar row stops being scannable. */
export const MAX_DETAILS = 3;

// ── vocabulary ──────────────────────────────────────────────────────────────────────────────────
// Deliberately a SMALL, self-contained table rather than a reach into i18n: it keeps this module
// zero-dep and executable by a plain Node test. Only title-specific words live here.

/** Clean type → the plural a title wants («شقق», not «شقة»). Arabic plurals are irregular. */
const TYPE_PLURAL_AR: Record<string, string> = {
  Apartment: 'شقق', Studio: 'استوديوهات', Room: 'غرف', Floor: 'أدوار', Duplex: 'دوبلكسات',
  Villa: 'فلل', House: 'بيوت', Palace: 'قصور', Compound: 'مجمعات',
  'Residential Building': 'عمارات سكنية', Building: 'عمارات', 'Commercial Building': 'مبانٍ تجارية',
  'Rest House': 'استراحات', Chalet: 'شاليهات', Camp: 'مخيمات', Farm: 'مزارع',
  'Agriculture Plot': 'أراضٍ زراعية', 'Residential Land': 'أراضٍ سكنية',
  'Commercial Land': 'أراضٍ تجارية', 'Industrial Land': 'أراضٍ صناعية', Land: 'أراضٍ',
  Office: 'مكاتب', Shop: 'محلات', Showroom: 'معارض', Kiosk: 'أكشاك',
  Warehouse: 'مستودعات', Factory: 'مصانع', Hall: 'صالات', Cinema: 'سينمات',
  Hotel: 'فنادق', 'Gas Station': 'محطات وقود', Station: 'محطات', 'Staff Housing': 'سكن عمال',
  Bank: 'بنوك', School: 'مدارس', 'Health Center': 'مراكز صحية', Parking: 'مواقف',
  'Telecom Tower': 'أبراج اتصالات', 'Service Facilities': 'مرافق خدمية',
  'Specialized Facilities': 'مرافق متخصصة',
};
const TYPE_PLURAL_EN: Record<string, string> = {
  Apartment: 'Apartments', Studio: 'Studios', Room: 'Rooms', Floor: 'Floors', Duplex: 'Duplexes',
  Villa: 'Villas', House: 'Houses', Palace: 'Palaces', Compound: 'Compounds',
  'Residential Building': 'Residential buildings', Building: 'Buildings',
  'Commercial Building': 'Commercial buildings', 'Rest House': 'Rest houses', Chalet: 'Chalets',
  Camp: 'Camps', Farm: 'Farms', 'Agriculture Plot': 'Agricultural land',
  'Residential Land': 'Residential land', 'Commercial Land': 'Commercial land',
  'Industrial Land': 'Industrial land', Land: 'Land', Office: 'Offices', Shop: 'Shops',
  Showroom: 'Showrooms', Kiosk: 'Kiosks', Warehouse: 'Warehouses', Factory: 'Factories',
  Hall: 'Halls', Cinema: 'Cinemas', Hotel: 'Hotels', 'Gas Station': 'Gas stations',
  Station: 'Stations', 'Staff Housing': 'Staff housing', Bank: 'Banks', School: 'Schools',
  'Health Center': 'Health centers', Parking: 'Parking', 'Telecom Tower': 'Telecom towers',
  'Service Facilities': 'Service facilities', 'Specialized Facilities': 'Specialized facilities',
};

/** Group → plural, for a search that picked a group but no specific نوع. */
const GROUP_PLURAL_AR: Record<string, string> = {
  'Apartments & Shared Housing': 'شقق وسكن مشترك', 'Villas & Houses': 'فلل وبيوت',
  'Rest Houses & Countryside': 'استراحات ومزارع', 'Residential Lands': 'أراضٍ سكنية',
  'Retail & Offices': 'محلات ومكاتب', 'Industry & Logistics': 'مستودعات وورش',
  'Buildings & Facilities': 'مبانٍ ومرافق', 'Commercial & Industrial Lands': 'أراضٍ تجارية وصناعية',
};

const AMENITY_AR: Record<string, string> = {
  elevator: 'مصعد', parking: 'موقف', kitchen: 'مطبخ', air_conditioner: 'مكيف',
  maid_room: 'غرفة خادمة', driver_room: 'غرفة سائق', private_entrance: 'مدخل خاص',
  rnpl: 'تقسيط', car_entrance: 'مدخل سيارة', optical_fibers: 'ألياف بصرية',
  electricity: 'كهرباء', water_supply: 'ماء', sanitation: 'صرف صحي',
  pool: 'مسبح', gym: 'نادي', garden: 'حديقة', balcony: 'شرفة', laundry_room: 'غرفة غسيل',
};
const AMENITY_EN: Record<string, string> = {
  elevator: 'Elevator', parking: 'Parking', kitchen: 'Kitchen', air_conditioner: 'A/C',
  maid_room: 'Maid room', driver_room: 'Driver room', private_entrance: 'Private entrance',
  rnpl: 'Instalments', car_entrance: 'Car entrance', optical_fibers: 'Fiber',
  electricity: 'Electricity', water_supply: 'Water', sanitation: 'Sanitation',
  pool: 'Pool', gym: 'Gym', garden: 'Garden', balcony: 'Balcony', laundry_room: 'Laundry',
};

const ar = (loc: string) => loc !== 'en';

// Arabic counted nouns don't take a plain number the way English does: 2 has a dual form and 3–10
// take the plural. Getting this wrong is what makes an auto-title read like a machine wrote it.
function countedAr(n: number, one: string, two: string, few: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  return `${n} ${few}`;
}

// ── the pieces ──────────────────────────────────────────────────────────────────────────────────

function whatPhrase(q: SearchQuery, loc: string): string {
  const A = ar(loc);
  const sel = (q.types && q.types.length ? q.types : (q.type ? [q.type] : [])).filter(Boolean) as string[];
  if (sel.length === 1) {
    const k = sel[0];
    return (A ? TYPE_PLURAL_AR[k] : TYPE_PLURAL_EN[k]) ?? k;
  }
  if (sel.length > 1) {
    // Two or more types: name the first and count the rest, so the title stays one line.
    const first = (A ? TYPE_PLURAL_AR[sel[0]] : TYPE_PLURAL_EN[sel[0]]) ?? sel[0];
    return A ? `${first} +${sel.length - 1}` : `${first} +${sel.length - 1}`;
  }
  // Groups are multi-select (owner 2026-08-20): name the first and count the rest, the same way this
  // function already handles several types, so the title stays one line.
  const groups = q.typeGroups ?? [];
  if (groups.length) {
    const g = A ? GROUP_PLURAL_AR[groups[0]] : groups[0];
    if (g) return groups.length > 1 ? `${g} +${groups.length - 1}` : g;
  }
  if (q.category === 'Commercial') return A ? 'عقارات تجارية' : 'Commercial property';
  if (q.category === 'Residential') return A ? 'عقارات سكنية' : 'Residential property';
  return A ? 'عقارات' : 'Property';
}

function dealPhrase(q: SearchQuery, loc: string): string {
  const A = ar(loc);
  if (q.bothDeals) return A ? 'للإيجار أو البيع' : 'to rent or buy';
  if (q.deal === 'Buy') return A ? 'للبيع' : 'for sale';
  return A ? 'للإيجار' : 'for rent';
}

function placePhrase(q: SearchQuery, loc: string): string {
  const A = ar(loc);
  const city = (q.location || '').trim();
  const dist = (q.districtLabel || '').trim();
  const many = q.districts && q.districts.length > 1;
  if (dist && city) return many ? (A ? `${city}` : city) : `${dist}، ${city}`;
  if (city) return city;
  return A ? 'السعودية' : 'Saudi Arabia';
}

/**
 * The distinguishing chips, most-useful-first. Only what actually tells two saved searches apart —
 * the base phrase already carries type/deal/place, so nothing here repeats them.
 *
 * ANNUAL RENT IS THE DEFAULT and is deliberately omitted: including it on every rent title would
 * add noise to the common case while adding nothing. «شهري» and «شهري وسنوي» ARE shown, because
 * those are the ones that differ from what the user gets by default.
 */
export function titleDetails(q: SearchQuery, loc = 'ar'): string[] {
  const A = ar(loc);
  const out: string[] = [];
  const push = (s?: string | null) => { if (s && !out.includes(s)) out.push(s); };

  if (q.deal === 'Rent' && !q.bothDeals) {
    if (q.rentPeriod === 'monthly') push(A ? 'شهري' : 'Monthly');
    else if (q.rentPeriod === 'both') push(A ? 'شهري وسنوي' : 'Monthly or yearly');
  }
  if (q.districts && q.districts.length > 1) {
    push(A ? `${q.districts.length} أحياء` : `${q.districts.length} districts`);
  }
  const beds = (q.contextBedsList && q.contextBedsList.length ? q.contextBedsList : null);
  if (beds && beds.length === 1) {
    const n = parseInt(String(beds[0]), 10);
    if (Number.isFinite(n)) push(A ? countedAr(n, 'غرفة', 'غرفتين', 'غرف') : `${n} bed`);
  } else if (beds && beds.length > 1) {
    push(A ? `${beds.length} خيارات غرف` : `${beds.length} bed options`);
  }
  if (q.furnishedPref === true) push(A ? 'مفروش' : 'Furnished');
  else if (q.furnishedPref === false) push(A ? 'غير مفروش' : 'Unfurnished');

  if (typeof q.bathMin === 'number' && q.bathMin > 0) {
    push(A ? countedAr(q.bathMin, 'حمام', 'حمامين', 'حمامات') : `${q.bathMin}+ baths`);
  }
  for (const key of (q.amenities ?? [])) {
    push(A ? (AMENITY_AR[key] ?? key) : (AMENITY_EN[key] ?? key));
  }
  if (q.isNewConstruction === true) push(A ? 'جديد' : 'New');
  else if (typeof q.ageMax === 'number') push(A ? `أقل من ${q.ageMax} سنوات` : `Under ${q.ageMax} yrs`);
  if (typeof q.ratingMin === 'number') push(A ? `تقييم ${q.ratingMin}+` : `${q.ratingMin}+ rating`);
  for (const d of (q.directions ?? [])) push(d);
  if (typeof q.streetWidthMin === 'number') push(A ? `شارع ${q.streetWidthMin}م+` : `${q.streetWidthMin}m+ street`);
  for (const st of (q.unitSubtypes ?? [])) push(st);

  return out;
}

/**
 * A concise sidebar title for a Filter / Advanced Filter search.
 * `شقق للإيجار في الرياض` · `فلل للبيع في جدة` · `شقق للإيجار في الرياض · مفروش · حمامين`
 */
export function autoTitleForQuery(q: SearchQuery, loc = 'ar'): string {
  const A = ar(loc);
  const base = A
    ? `${whatPhrase(q, loc)} ${dealPhrase(q, loc)} في ${placePhrase(q, loc)}`
    : `${whatPhrase(q, loc)} ${dealPhrase(q, loc)} in ${placePhrase(q, loc)}`;
  const details = titleDetails(q, loc).slice(0, MAX_DETAILS);
  return details.length ? `${base} · ${details.join(' · ')}` : base;
}

// ── free-text prompts ───────────────────────────────────────────────────────────────────────────

/** Opening intent verbs — «ابي شقة…» is a request, not part of the subject. */
const LEAD_NOISE_AR = [
  'ابي', 'أبي', 'ابغى', 'أبغى', 'أبغي', 'ابغي', 'اريد', 'أريد', 'ودي', 'أدور', 'ادور',
  'دور لي على', 'دورلي على', 'ابحث عن', 'أبحث عن', 'ابحث', 'أبحث', 'عايز', 'محتاج',
  'ممكن', 'لو سمحت', 'من فضلك', 'السلام عليكم', 'مرحبا', 'هلا',
];
const LEAD_NOISE_EN = ['i want', 'i need', 'looking for', 'find me', 'show me', 'search for', 'i am looking for', "i'm looking for", 'please'];

/**
 * `\b` is an ASCII word boundary: between two Arabic letters JS sees non-word/non-word and reports NO
 * boundary, so every `\b`-anchored Arabic pattern silently never matches. These two separator classes
 * are the Arabic-safe replacement — a real space/punctuation or the string edge.
 */
const SEP_AFTER = '(?=[\\s,،.؟?!]|$)';
const SEP_BEFORE = '(?:^|(?<=[\\s,،.؟?!]))';

/** Trailing clauses that are budget/size qualifiers — useful in the search, noise in a title. */
const TAIL_CLAUSE_AR = new RegExp(
  `\\s*(?:و?(?:تكون|يكون|بحيث)\\s*)?(?:تحت|اقل من|أقل من|بحدود|في حدود|ما يتجاوز|لا يتجاوز|ب?ميزانية|السعر|بسعر|حدود)${SEP_AFTER}[\\s\\S]*$`,
);
const TAIL_CLAUSE_EN = /\s*(?:under|below|less than|up to|budget|around)\b[\s\S]*$/i;

/** Small normalizations that make a title read like a person wrote it. */
const TIGHTEN_AR: Array<[RegExp, string]> = [
  [new RegExp(`${SEP_BEFORE}(?:قريبة?|بالقرب)\\s+من${SEP_AFTER}`, 'g'), 'قرب'],
  [new RegExp(`${SEP_BEFORE}(?:تكون|يكون)${SEP_AFTER}`, 'g'), ''],
];

const MAX_PROMPT_WORDS = 7;
const MAX_PROMPT_CHARS = 46;

/**
 * A short, ChatGPT-like title for a free-text request.
 * «ابي شقة بالرياض قريبة من المترو وتكون تحت 5000 بالشهر» → «شقة بالرياض قرب المترو»
 *
 * Local rules only — no model call (owner rule). It trims the asking, drops the budget clause, and
 * keeps the subject. If the rules strip too much it falls back to a plain word-capped truncation,
 * so a title is never empty and never an entire paragraph.
 */
export function autoTitleForPrompt(text: string, loc = 'ar'): string {
  const A = ar(loc);
  const raw = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  let s = raw;

  // 1. strip the leading ask, repeatedly («لو سمحت ابي شقة…»)
  const leads = A ? LEAD_NOISE_AR : LEAD_NOISE_EN;
  for (let i = 0; i < 3; i++) {
    const before = s;
    for (const lead of leads) {
      const re = new RegExp(`^${lead}(?:[\\s,،]+|$)`, A ? '' : 'i');
      if (re.test(s)) { s = s.replace(re, '').trim(); break; }
    }
    if (s === before) break;
  }
  // 2. drop a trailing budget/size clause
  s = s.replace(A ? TAIL_CLAUSE_AR : TAIL_CLAUSE_EN, '').trim();
  // 3. tighten common phrasings
  if (A) for (const [re, to] of TIGHTEN_AR) s = s.replace(re, to);
  s = s.replace(/\s+/g, ' ').replace(/[،,.؟?!]+$/, '').trim();

  // 4. cap length — words first, then hard characters
  let words = s.split(' ').filter(Boolean);
  if (words.length > MAX_PROMPT_WORDS) words = words.slice(0, MAX_PROMPT_WORDS);
  s = words.join(' ');
  if (s.length > MAX_PROMPT_CHARS) s = s.slice(0, MAX_PROMPT_CHARS).replace(/\s+\S*$/, '').trim();

  // 5. never return nothing — the rules removed everything only if the prompt WAS only an ask
  if (!s) {
    const fallback = raw.split(' ').slice(0, MAX_PROMPT_WORDS).join(' ');
    return fallback.length > MAX_PROMPT_CHARS ? fallback.slice(0, MAX_PROMPT_CHARS).trim() : fallback;
  }
  return s;
}

/**
 * What the sidebar should display for an entry, and the ONLY place that precedence is decided:
 * a manual title always wins, then a stored title, then the legacy `label`, then a freshly
 * generated one. Callers never re-derive this.
 */
export function displayTitle(
  item: { title?: string; titleSource?: TitleSource; label?: string; query?: SearchQuery },
  loc = 'ar',
): string {
  const t = (item.title ?? '').trim();
  if (t) return t;
  const legacy = (item.label ?? '').trim();
  if (legacy) return legacy;
  return item.query ? autoTitleForQuery(item.query, loc) : '';
}

/**
 * May an automatic re-title overwrite what is stored? Only when the user has not named it.
 * This is the whole of owner rule 4 — "Once title_source = manual, preserve it unless the user
 * renames again" — in one place, so no call site can get it subtly wrong.
 */
export function canAutoRetitle(item: { titleSource?: TitleSource }): boolean {
  return item.titleSource !== 'manual';
}
