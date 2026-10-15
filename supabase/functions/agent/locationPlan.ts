// Chapter 1: the model proposes a COMPLETE location state; the catalog authorizes it.
// No database IDs from the model are accepted. Districts remain an OR-set in SearchQuery.
export const LOCATION_CHAPTER_MARKER = "EZHALAH LOCATION INTERPRETATION — CHAPTER 1";
export const LOCATION_PLAN_SCHEMA = `\nCHAPTER 1 OUTPUT EXTENSION (overrides the earlier exact-key list): also return location_plan: {status:"ready"|"clarify"|"unsupported"|"none",cities:string[],districts:string[],region:string}. This is the COMPLETE intended location after this turn, not a patch. Use canonical Arabic name proposals, never IDs. Retain confirmed city/districts for unrelated property changes; add, replace, remove, clear or reset only as requested. cities contains ALL requested cities, never silently pick one. districts contains ALL remaining selected districts, [] means no district restrictions. Ambiguous add-versus-replace or unresolved mandatory locations => clarify; put the focused question in reply. Unsupported foreign/proximity/landmark requests => unsupported, explain briefly and request a city/district; never silently search the whole city. Non-search conversation => none. For a valid city with no districts, ready is correct. For a district-only request without a confirmed city, propose status ready with cities:[] and the district names; the backend will infer a city only if the full catalog yields a unique combination. Directional areas require a supplied validated mapping; without one, use unsupported. A ready plan is only a proposal: the backend will validate it before searching. You have no catalog tools: propose names for validation; do not claim you already validated them. If status is clarify or unsupported, preserve confirmed state and do not claim a search will run. This module replaces older location-wide-search, landmark and first-city fallback instructions; unrelated policies remain in force.`;

type Row = Record<string, unknown>;
export type LocationPlanResult =
  | { status: "none" }
  | { status: "blocked"; reply: string; failed?: boolean }
  | { status: "ready"; location: string; regionPin: string; districts: string[] };
const norm = (s: string) => s.trim().replace(/^حي\s+|^منطقة\s+/u, "").replace(/[أإآ]/g, "ا").replace(/[\u064B-\u065Fـ]/g, "").replace(/\s+/g, " ");
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 30 && v.every(x => typeof x === "string" && x.trim().length > 0 && x.length <= 120);
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object" && !Array.isArray(x)) : [];

async function validatePlan(
  value: unknown,
  classify: (name: string) => Promise<Row | null>,
  en: boolean,
  modelReply = "",
): Promise<LocationPlanResult> {
  const blocked = (ar: string, english: string): LocationPlanResult => ({ status: "blocked", reply: en ? english : ar });
  if (!value || typeof value !== "object" || Array.isArray(value)) return blocked("اكتب المدينة والحي اللي تقصده عشان أحدد موقع البحث. 📍", "Please specify the city and district so I can identify the search location. 📍");
  const p = value as Row;
  if (p.status === "none") return { status: "none" };
  if (p.status === "clarify" || p.status === "unsupported") {
    return { status: "blocked", reply: modelReply.trim() || (en ? "Which Saudi city and district do you mean? 📍" : "أي مدينة وحي داخل السعودية تقصد؟ 📍") };
  }
  if (p.status !== "ready" || !strings(p.cities) || !strings(p.districts) || (typeof p.region !== "string" || p.region.length > 120)) return blocked("ما قدرت أحدد موقع البحث، اكتب المدينة والحي. 📍", "I couldn't identify the search location. Please specify the city and district. 📍");
  if (p.cities.some(name => /^(?:ال)?منطقة\s/u.test(name.trim()))) return blocked("أي مدينة داخل هالمنطقة تقصد؟ 📍", "Which city within this region do you mean? 📍");
  const cities = [...new Set(p.cities.map(norm))];
  if (cities.length > 1 || (cities.length === 0 && p.districts.length === 0)) return blocked("البحث يكون بمدينة وحدة. أي مدينة تبي نبدأ فيها؟ 📍", "I search one city at a time. Which city should we start with? 📍");
  try {
    let cityName = p.cities[0];
    let requestedRegion = p.region;
    if (!cities.length) {
      let possible: Row[] | null = null;
      for (const name of p.districts) {
        const district = await classify(name);
        if (!district) throw new Error("district lookup unavailable");
        const parents = ["district", "twin_district"].includes(String(district.kind)) ? rows(district.all_cities ?? district.cities) : [];
        possible = possible === null ? parents : possible.filter(c => parents.some(p => String(p.city_id) === String(c.city_id)));
      }
      const inRegion = (possible ?? []).filter(c => c.city_id != null && typeof c.city_ar === "string" && typeof c.region_ar === "string" && (!requestedRegion.trim() || norm(String(c.region_ar)) === norm(requestedRegion)));
      const distinct = [...new Map(inRegion.map(c => [String(c.city_id), c])).values()];
      if (distinct.length !== 1) return blocked("أي مدينة تقصد لهالأحياء؟ 📍", "Which city do you mean for these districts? 📍");
      cityName = String(distinct[0].city_ar);
      requestedRegion = String(distinct[0].region_ar);
    }
    const city = await classify(cityName);
    if (!city) throw new Error("location lookup unavailable");
    if (!["city", "region_or_city", "twin_city"].includes(String(city.kind))) return blocked("حدد مدينة داخل السعودية للبحث، واذكر المنطقة إذا كان الاسم مشترك. 📍", "Please specify a Saudi city, and its region if the city name is shared. 📍");
    let candidates = [...rows(city.cities), ...rows(city.regions)].filter(c => c.city_id != null && typeof c.city_ar === "string" && typeof c.region_ar === "string");
    candidates = [...new Map(candidates.map(c => [`${c.city_id}:${c.region_ar}`, c])).values()];
    if (requestedRegion.trim()) candidates = candidates.filter(c => norm(String(c.region_ar)) === norm(requestedRegion));
    if (candidates.length !== 1) return blocked("أي منطقة تقصد لهالمدينة؟ 📍", "Which region do you mean for this city? 📍");
    const chosen = candidates[0];
    const districts: string[] = [];
    // Sequential bounded lookups reuse the existing classifier's timeout/retry contract.
    for (const name of [...new Set(p.districts)]) {
      const d = await classify(name);
      if (!d) throw new Error("district lookup unavailable");
      if (!["district", "twin_district"].includes(String(d.kind))) return blocked(`ما قدرت أحدد الحي «${name}»، تقدر توضح اسمه؟ 📍`, `I couldn't identify the district “${name}”. Could you clarify its name? 📍`);
      // all_cities includes zero-inventory catalog matches; never use the inventory shortlist alone.
      const matches = rows(d.all_cities ?? d.cities).filter(c => String(c.city_id) === String(chosen.city_id));
      if (!matches.length) return blocked(`ما قدرت أطابق الحي «${name}» مع ${chosen.city_ar}. أي مدينة وحي تقصد؟ 📍`, `I couldn't match “${name}” to ${chosen.city_ar}. Which city and district do you mean? 📍`);
      const canonical = String(matches[0].district_ar ?? d.name ?? "").trim();
      if (!canonical) throw new Error("missing district identity");
      if (!districts.some(x => norm(x) === norm(canonical))) districts.push(canonical);
    }
    return { status: "ready", location: String(chosen.city_ar), regionPin: String(chosen.region_ar), districts };
  } catch {
    return { status: "blocked", failed: true, reply: en ? "I couldn't verify the location because of a temporary connection problem. Please try again." : "تعذر التحقق من الموقع بسبب مشكلة اتصال مؤقتة. جرب مرة ثانية." };
  }
}

// Bound the entire validation, not just each RPC. Stop scheduling more lookups after timeout.
export async function validateLocationPlan(value: unknown, classify: (name: string) => Promise<Row | null>, en: boolean, modelReply = "", timeoutMs = 20000): Promise<LocationPlanResult> {
  let expired = false;
  const cache = new Map<string, Row | null>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: LocationPlanResult = { status: "blocked", failed: true, reply: en ? "Location verification timed out. Please try again." : "انتهت مهلة التحقق من الموقع. جرب مرة ثانية." };
  try {
    return await Promise.race([
      validatePlan(value, async name => {
        if (expired) throw new Error("expired");
        if (cache.has(name)) return cache.get(name)!;
        const result = await classify(name);
        cache.set(name, result);
        if (expired) throw new Error("expired");
        return result;
      }, en, modelReply),
      new Promise<LocationPlanResult>(resolve => { timer = setTimeout(() => { expired = true; resolve(timedOut); }, timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
