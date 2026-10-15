// Chapter 1: the model proposes a COMPLETE location state; the catalog authorizes it.
// No database IDs from the model are accepted. Districts remain an OR-set in SearchQuery.
import { listCities } from "./questionExamples.ts";
import { isFreshRequest } from "./locationAmbiguity.ts";
export const LOCATION_CHAPTER_MARKER = "EZHALAH LOCATION INTERPRETATION — CHAPTER 1";
export const LOCATION_PLAN_SCHEMA = `\nCHAPTER 1 OUTPUT EXTENSION (overrides the earlier exact-key list): also return location_plan: {status:"ready"|"clarify"|"unsupported"|"none",cities:string[],districts:string[],region:string,scope:"CITY"|"REGION"|"NATIONWIDE"}. Explicit region or nationwide requests are supported: REGION requires a canonical Saudi region, NATIONWIDE requires explicit all-Saudi intent. Never expand a city implicitly. Preserve the confirmed scope on unrelated refinements. For REGION/NATIONWIDE use cities:[] and districts:[]; clarify before preserving city-specific districts across a scope change. This is the COMPLETE intended location after this turn, not a patch. Use canonical Arabic name proposals, never IDs. Retain confirmed city/districts for unrelated property changes; add, replace, remove, clear or reset only as requested. cities contains ALL requested cities, never silently pick one. districts contains ALL remaining selected districts, [] means no district restrictions. Ambiguous add-versus-replace or unresolved mandatory locations => clarify; put the focused question in reply. Unsupported foreign/proximity/landmark requests => unsupported, explain briefly and request a city/district; never silently search the whole city. Non-search conversation => none. For a valid city with no districts, ready is correct. For a district-only request without a confirmed city, propose status ready with cities:[] and the district names; the backend will infer a city only if the full catalog yields a unique combination. Directional areas require a supplied validated mapping; without one, use unsupported. A ready plan is only a proposal: the backend will validate it before searching. You have no catalog tools: propose names for validation; do not claim you already validated them. If status is clarify or unsupported, preserve confirmed state and do not claim a search will run. This module replaces older location-wide-search, landmark and first-city fallback instructions; unrelated policies remain in force.`;

type Row = Record<string, unknown>;
export type LocationPlanContext = { text?: string; previous?: Row | null; pendingQuestion?: string; landmarkHint?: string; landmarkAliases?: (name: string) => Promise<string[] | null> };
export type LocationPlanResult =
  | { status: "none" }
  | { status: "blocked"; reply: string; failed?: boolean }
  | { status: "ready"; location: string; regionPin: string; districts: string[]; scope?: "CITY" | "REGION" | "NATIONWIDE"; notice?: string };
const norm = (s: string) => s.trim().replace(/^حي\s+|^منطقة\s+/u, "").replace(/[أإآ]/g, "ا").replace(/[\u064B-\u065Fـ]/g, "").replace(/\s+/g, " ");
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 30 && v.every(x => typeof x === "string" && x.trim().length > 0 && x.length <= 120);
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object" && !Array.isArray(x)) : [];
const foldText = (s: string) => s.trim().replace(/[أإآ]/g, "ا").replace(/[\u064B-\u065Fـ]/g, "").replace(/\s+/g, " ").toLowerCase().replace(/ة/g, "ه").replace(/ى/g, "ي");
export const startsNewLocationSearch = (text: string) => /بحث\s*جديد|ابدا\s*من\s*جديد|\bnew search\b|\bstart over\b/iu.test(foldText(text));
const OPERATION = /(?<![\p{L}])و?(?:أضف|اضف|ضيف|زد|زيد|كمان|بعد|مع|بدل|بدال|خل(?:ها|يها|يه|ه|ي)?|غير|غيّر|احذف|شيل|ازل|أزل|امسح|فقط|بس)(?![\p{L}])|\b(?:add|also|too|and|replace|instead|change|switch|make|remove|delete|clear|only)\b/iu;

const REMOVAL = /(?:احذف|شيل|ازل|أزل|امسح|بدل|بدال|خلها|خلي|غير|غيّر|فقط|بس)|\b(?:replace|instead|remove|delete|clear|only|change|switch)\b/iu;

// Official names from src/data/sa-locations.json; the regression test pins this mirror.
export const REGION_NAMES = [["Riyadh", "منطقة الرياض"], ["Makkah", "منطقة مكة المكرمة"], ["Madinah", "منطقة المدينة المنورة"], ["Qassim", "منطقة القصيم"], ["Eastern Province", "المنطقة الشرقية"], ["Asir", "منطقة عسير"], ["Tabuk", "منطقة تبوك"], ["Hail", "منطقة حائل"], ["Northern Borders", "منطقة الحدود الشمالية"], ["Jazan", "منطقة جازان"], ["Najran", "منطقة نجران"], ["Bahah", "منطقة الباحة"], ["Jawf", "منطقة الجوف"]] as const;
function explicitRegionOnly(text: string, cities: string[], districts: string[]): boolean {
  let remaining = foldText(text);
  const phrases = REGION_NAMES.flatMap(([en, ar]) => [ar, `${en} region`, `region of ${en}`,
    ...(en.includes("Province") ? [en] : []),
    ...(ar === "منطقة مكة المكرمة" ? ["منطقة مكة"] : []),
    ...(ar === "منطقة المدينة المنورة" ? ["منطقة المدينة"] : []),
  ]).map(foldText).sort((a,b) => b.length-a.length);
  let found = false;
  for (const phrase of phrases) {
    if (remaining.includes(phrase)) { found = true; remaining = remaining.split(phrase).join(" "); }
  }
  if (!found) return false;
  const namedCity = cities.some(city => [city,listCities([city],true)].some(n => remaining.includes(foldText(n))));
  const namedDistrict = districts.some(d => remaining.includes(foldText(norm(d)))) ||
    (districts.length > 0 && /(?:حي\s|\bdistrict\b|\bneighbou?rhood\b)/iu.test(remaining));
  return !namedCity && !namedDistrict;
}

// Capability checks use the request itself, not the model's promise that it understood it.
export function unsupportedLocationRequirement(text: string, cityNames: string[]): boolean {
  const t = foldText(text);
  const proximity = /قريب(?:ه)?\s*(?:من|ل|مني|عند)|بالقرب|بجوار|بجانب|على\s*بعد|مساف[هة]|يبعد|تبعد|حول\s*موقع|موقعي|كيلومتر|\b(?:near|nearby|radius|distance|kilomet\w*|km|next to|close to|around me)\b|\bwithin\s+[\d.]+\s*(?:m|miles?|minutes?)\b/iu.test(t);
  const namedRoad = /(?:على|في)\s+(?:شارع|طريق)\s+[\p{L}]|\b(?:on|along)\s+(?:the\s+)?[\p{L} ]+\s+(?:road|street)\b/iu.test(t);
  const directional = cityNames.some(city => {
    const names = [foldText(city), foldText(listCities([city], true))];
    return names.some(name => name && ["شمال", "جنوب", "شرق", "غرب", "north", "south", "east", "west"].some(d =>
      t.includes(`${d} ${name}`) || t.includes(`${d} of ${name}`) || t.includes(`${d} مدينة ${name}`)));
  });
  return proximity || namedRoad || directional;
}

async function validatePlan(
  value: unknown,
  classify: (name: string) => Promise<Row | null>,
  en: boolean,
  modelReply = "",
  context: LocationPlanContext = {},
): Promise<LocationPlanResult> {
  const blocked = (ar: string, english: string): LocationPlanResult => ({ status: "blocked", reply: en ? english : ar });
  if (!value || typeof value !== "object" || Array.isArray(value)) return blocked("اكتب المدينة والحي اللي تقصده عشان أحدد موقع البحث. 📍", "Please specify the city and district so I can identify the search location. 📍");
  const p = { ...(value as Row) };
  const text = context.text ?? "";
  if (startsNewLocationSearch(text) && context.previous) {
    const prior = context.previous;
    if (strings(p.cities) && typeof prior.location === "string") {
      p.cities = p.cities.filter(city => norm(city) !== norm(String(prior.location)) ||
        [city, listCities([city], true)].some(name => foldText(text).includes(foldText(name))));
    }
    const inherited = strings(prior.districts) ? prior.districts : [];
    if (strings(p.districts)) p.districts = p.districts.filter(d => !inherited.some(old => norm(old) === norm(d)) || foldText(text).includes(foldText(d)));
    if (strings(p.cities) && !p.cities.length && p.scope !== "REGION") p.region = "";
  }
  const previous = startsNewLocationSearch(text) ? null : context.previous;
  const previousDistricts = strings(previous?.districts) ? previous.districts : typeof previous?.districtPin === "string" ? [previous.districtPin] : [];
  const citiesForGuard = strings(p.cities) ? p.cities : [];
  const contextualRegion = /كل\s*المنطقه|المنطقه\s*(?:كامله|كلها)|\b(?:whole|entire) region\b/iu.test(foldText(text)) && typeof previous?.regionPin === "string";
  const regionOnly = contextualRegion || explicitRegionOnly(text, citiesForGuard, strings(p.districts) ? p.districts : []);
  const nationwide = /كل\s*السعود|جميع\s*انحاء\s*المملك|المملكه\s*العربيه\s*السعوديه\s*بالكامل|اي\s*مدينه\s*بالسعود|\b(?:nationwide|across Saudi Arabia|anywhere in Saudi Arabia|all of Saudi Arabia)\b/iu.test(foldText(text));
  const scope = nationwide ? "NATIONWIDE" : regionOnly ? "REGION" : p.scope;
  if (scope === "REGION" || scope === "NATIONWIDE") {
    const explicit = scope === "REGION" ? regionOnly : nationwide;
    // An explicit canonical scope is validated below; a model clarification is not a veto.
    if (p.status !== "ready" && !explicit) return blocked("أي منطقة داخل السعودية تقصد؟ 📍", "Please clarify the Saudi search scope. 📍");
    if (!explicit && previous?.geographicScope !== scope) return blocked("حدد نطاق البحث المطلوب. 📍", "Please specify the geographic scope. 📍");
    if (citiesForGuard.some(city => [city, listCities([city], true)].some(name => foldText(text).includes(foldText(name)))) && !regionOnly) return blocked("تقصد المدينة المحددة أو النطاق كامل؟ 📍", "Do you mean the named city or the entire scope? 📍");
    if (citiesForGuard.length || !strings(p.districts) || p.districts.length) return blocked("تبي البحث في النطاق كامل أو في مدينة وأحياء محددة؟ 📍", "Should I search the entire scope or specific city districts? 📍");
    if (unsupportedLocationRequirement(text, citiesForGuard)) return blocked("تحديد القرب غير متاح حالياً. حدد منطقة أو مدينة. 📍", "Proximity filtering is unavailable. Please specify a region or city. 📍");
    const namedRegions = REGION_NAMES.filter(([en, ar]) => [ar, `${en} region`, `region of ${en}`, ...(en === "Eastern Province" ? [en] : [])].some(name => foldText(text).includes(foldText(name))));
    if (namedRegions.length > 1) return blocked("أي منطقة تقصد من المناطق المذكورة؟ 📍", "Which of those regions should I search? 📍");
    const region = REGION_NAMES.find(([en, ar]) => norm(String(p.region ?? "")) === norm(ar) || norm(String(p.region ?? "")) === norm(ar.replace(/^منطقة\s+/, "")) || String(p.region ?? "").toLowerCase() === en.toLowerCase())
      ?? (namedRegions.length === 1 ? namedRegions[0] : undefined);
    if (scope === "REGION" && (!region || (explicit && !(contextualRegion && norm(String(previous?.regionPin)) === norm(region[1])) && ![region[1], `${region[0]} region`, `region of ${region[0]}`, ...(region[0] === "Eastern Province" ? [region[0]] : [])].some(name => foldText(text).includes(foldText(name)))))) return blocked("أي منطقة داخل السعودية تقصد؟ 📍", "Which Saudi region do you mean? 📍");
    return { status: "ready", scope, location: scope === "REGION" ? region![1] : "السعودية", regionPin: scope === "REGION" ? region![1] : "", districts: [], notice: previousDistricts.length ? (en ? "Cleared the previous city districts for the requested wider scope." : "شلت أحياء المدينة السابقة للبحث في النطاق المطلوب.") : undefined };
  }
  if (unsupportedLocationRequirement(text, citiesForGuard)) {
    return blocked("تحديد القرب أو النطاق الجغرافي غير متاح حالياً. أي مدينة وحي تبي نبحث فيه؟ 📍", "Proximity and geographic area filtering aren't available yet. Which city and district should I search? 📍");
  }
  if (p.status === "none") return startsNewLocationSearch(text)
    ? blocked("أي مدينة تبي نبدأ فيها البحث الجديد؟ 📍", "Which city should the new search start in? 📍")
    : { status: "none" };
  if (p.status === "clarify" || p.status === "unsupported") {
    return { status: "blocked", reply: /[?؟]/u.test(modelReply) ? modelReply.trim() : (en ? "Which Saudi city and district do you mean? 📍" : "أي مدينة وحي داخل السعودية تقصد؟ 📍") };
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
    const cityChanged = typeof previous?.location === "string" && norm(previous.location) !== norm(String(chosen.city_ar));
    const explicitCityChange = cityChanged && !isFreshRequest(text, String(chosen.city_ar)) &&
      ([String(chosen.city_ar), listCities([String(chosen.city_ar)], true)].some(name => foldText(text).includes(foldText(name))) || /غير.*مدين|change.*city|switch.*city/iu.test(text));
    const pendingDistrictQuestion = /أي\s*حي|اي\s*حي|which\s*district|which\s*neighbou?rhood/iu.test(context.pendingQuestion ?? "");
    const addsUnstatedDistrict = p.districts.some(d => !previousDistricts.some(old => norm(old) === norm(d)));
    if (!cityChanged && previousDistricts.length && addsUnstatedDistrict && !OPERATION.test(text) && !pendingDistrictQuestion && !isFreshRequest(text, String(chosen.city_ar))) {
      return blocked("تبي أضيف الحي للأحياء الحالية أو أستبدلها فيه؟ 📍", "Should I add this district to your current selection or replace it? 📍");
    }
    // A city-only change carries prior districts through validation, even if the model dropped them.
    const requested = explicitCityChange ? [...new Set([...p.districts, ...previousDistricts])] : p.districts;
    const districts: string[] = [];
    const removed: string[] = [];
    // Sequential bounded lookups reuse the existing classifier's timeout/retry contract.
    for (const name of [...new Set(requested)]) {
      const d = await classify(name);
      if (!d) throw new Error("district lookup unavailable");
      if (!["district", "twin_district"].includes(String(d.kind))) return blocked(`ما قدرت أحدد الحي «${name}»، تقدر توضح اسمه؟ 📍`, `I couldn't identify the district “${name}”. Could you clarify its name? 📍`);
      // all_cities includes zero-inventory catalog matches; never use the inventory shortlist alone.
      const matches = rows(d.all_cities ?? d.cities).filter(c => String(c.city_id) === String(chosen.city_id));
      if (!matches.length && explicitCityChange && previousDistricts.some(old => norm(old) === norm(name)) && !foldText(text).includes(foldText(name))) {
        removed.push(name); continue;
      }
      if (!matches.length) return blocked(`ما قدرت أطابق الحي «${name}» مع ${chosen.city_ar}. أي مدينة وحي تقصد؟ 📍`, `I couldn't match “${name}” to ${chosen.city_ar}. Which city and district do you mean? 📍`);
      const canonical = String(matches[0].district_ar ?? d.name ?? "").trim();
      if (!canonical) throw new Error("missing district identity");
      if (!districts.some(x => norm(x) === norm(canonical))) districts.push(canonical);
    }
    // The landmark index also contains administrative districts. Its category is not
    // authority: resolve the matched alias against the location catalog before rejecting it.
    for (const hint of (context.landmarkHint ?? "").split(" | ").filter(Boolean)) {
      const alias = hint.split(" = ")[0].trim();
      const aliases = [alias];
      if (/[a-z]/iu.test(alias) && context.landmarkAliases) {
        const canonicalName = hint.match(/ = (.+) \([^)]*\), /u)?.[1];
        if (canonicalName) {
          const recognized = await context.landmarkAliases(canonicalName);
          if (!recognized) throw new Error("landmark aliases unavailable");
          aliases.push(...recognized.slice(0, 10));
        }
      }
      let authorized = false;
      for (const candidate of aliases) {
        const place = await classify(candidate);
        if (!place) throw new Error("landmark alias lookup unavailable");
        const isChosenCity = ["city", "region_or_city", "twin_city"].includes(String(place.kind)) &&
          [...rows(place.cities), ...rows(place.regions)].some(c => String(c.city_id) === String(chosen.city_id));
        const isChosenDistrict = ["district", "twin_district"].includes(String(place.kind)) &&
          rows(place.all_cities ?? place.cities).some(c => String(c.city_id) === String(chosen.city_id) &&
            districts.some(d => norm(d) === norm(String(c.district_ar ?? place.name ?? ""))));
        // A removal/replacement names the OLD district too. Authorize that reference
        // only against confirmed previous state and its catalog parent, never as a new filter.
        const isRemovedDistrict = REMOVAL.test(text) && ["district", "twin_district"].includes(String(place.kind)) &&
          rows(place.all_cities ?? place.cities).some(c => norm(String(c.city_ar)) === norm(String(previous?.location ?? "")) &&
            previousDistricts.some(d => norm(d) === norm(String(c.district_ar ?? place.name ?? ""))) &&
            !districts.some(d => norm(d) === norm(String(c.district_ar ?? place.name ?? ""))));
        const isPreviousCity = explicitCityChange && REMOVAL.test(text) &&
          ["city", "region_or_city", "twin_city"].includes(String(place.kind)) &&
          [...rows(place.cities), ...rows(place.regions)].some(c => norm(String(c.city_ar)) === norm(String(previous?.location ?? "")));
        if (isChosenCity || isChosenDistrict || isRemovedDistrict || isPreviousCity) { authorized = true; break; }
      }
      if (!authorized) return blocked("حدد المدينة والحي؛ البحث بمعلم جغرافي غير متاح حالياً. 📍", "Please specify the city and district; landmark filtering isn't available yet. 📍");
    }
    const notice = removed.length ? (en
      ? `Removed ${removed.join(", ")} because they do not belong to ${chosen.city_ar}.`
      : `شلت ${removed.join("، ")} لأنها ما تتبع ${chosen.city_ar}.`) : undefined;
    return { status: "ready", location: String(chosen.city_ar), regionPin: String(chosen.region_ar), districts, notice };
  } catch {
    return { status: "blocked", failed: true, reply: en ? "I couldn't verify the location because of a temporary connection problem. Please try again." : "تعذر التحقق من الموقع بسبب مشكلة اتصال مؤقتة. جرب مرة ثانية." };
  }
}

// Bound the entire validation, not just each RPC. Stop scheduling more lookups after timeout.
export async function validateLocationPlan(value: unknown, classify: (name: string) => Promise<Row | null>, en: boolean, modelReply = "", timeoutMs = 20000, context: LocationPlanContext = {}): Promise<LocationPlanResult> {
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
      }, en, modelReply, context),
      new Promise<LocationPlanResult>(resolve => { timer = setTimeout(() => { expired = true; resolve(timedOut); }, timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
