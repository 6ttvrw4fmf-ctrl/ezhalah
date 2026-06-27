// ─────────────────────────────────────────────────────────────────────────────
// proximity.ts — Location RELATIONSHIP intelligence (2026-06-26)
//
// Two layers, mined from real listing text (title + description + source_capture):
//   1. ENTITY    → category (hospital / university / mosque / road / sea …) + name
//   2. RELATION  → how the property relates to it (near / opposite / behind /
//                  view / time_distance / road_position / centrality / within)
//
// The agent parses BOTH from the user's message, and the engine RANKS listings by
// how strongly each listing expresses that same relationship to that same entity:
//   strong phrase + exact name  >  name only  >  category only  >  bare keyword.
//
// Phrase weights + category lexicon come from the live-DB proximity audit
// (2026-06-26): «وسط أسعار» / «عند الطلب» / «داخل العقار» are NOT location signals
// and are excluded; «على شارع عرض ٢٠» (street width) is excluded for road_position.
// ─────────────────────────────────────────────────────────────────────────────

export type Relationship =
  | 'near' | 'opposite' | 'behind' | 'time_distance'
  | 'view' | 'road_position' | 'centrality' | 'within';

// One parsed location-relationship the user expressed (or a listing exhibits).
export type ProximityIntent = {
  relationship: Relationship;
  phrase: string;     // the exact Arabic relationship phrase matched ("قريب من")
  category: string;   // normalized category key ("hospital") or '' when unknown
  categoryAr: string; // Arabic category label ("مستشفيات") or ''
  name: string;       // the specific entity text after the phrase ("الحبيب") or ''
  weight: number;     // ranking strength of this relationship (0–1)
};

// Relationship groups → Arabic trigger phrases + ranking weight. Ordered longest-
// phrase-first WITHIN each group so "بالقرب من" matches before bare "قرب". Weights:
// adjacency/opposite/view are the strongest evidence; centrality/within are weak.
const GROUPS: { rel: Relationship; weight: number; phrases: string[] }[] = [
  { rel: 'near', weight: 1.0, phrases: ['بالقرب من', 'قريبة من', 'قريب من', 'قريبه من', 'بالقرب', 'بجوار', 'يقع بجوار', 'بجانب', 'ملاصق لـ', 'ملاصق', 'جنب'] },
  { rel: 'opposite', weight: 1.0, phrases: ['مقابل', 'أمام', 'امام', 'قبالة'] },
  { rel: 'behind', weight: 0.9, phrases: ['خلف'] },
  { rel: 'time_distance', weight: 0.95, phrases: ['على بعد', 'يبعد', 'دقائق', 'دقيقة', 'دقيقتين', 'خطوات', 'مشي'] },
  { rel: 'view', weight: 1.0, phrases: ['يطل على', 'تطل على', 'مطل على', 'مطلة على', 'إطلالة على', 'اطلالة على', 'إطلالة', 'اطلالة'] },
  { rel: 'road_position', weight: 0.9, phrases: ['على طريق', 'على شارع', 'بين طريقين', 'تقاطع', 'بمحاذاة', 'محاذي لـ'] },
  { rel: 'centrality', weight: 0.8, phrases: ['في قلب', 'وسط المدينة', 'بوسط', 'في وسط'] },
  { rel: 'within', weight: 0.5, phrases: ['ضمن', 'داخل حي', 'داخل مخطط', 'داخل مجمع'] },
];

// Category lexicon: a keyword that may follow a relationship phrase → normalized
// category. Mined from the 101-category taxonomy; only the search-worthy ones.
// Order matters: more specific keys first (مجمع طبي before مجمع). Each entry maps
// to an English key + the Arabic label used in the search summary.
const CATEGORY_LEX: { kw: RegExp; key: string; ar: string }[] = [
  { kw: /مجمع طبي|مستشفى|مستوصف/, key: 'hospital', ar: 'مستشفيات' },
  { kw: /جامعة|كلية/, key: 'university', ar: 'جامعات' },
  { kw: /روضة أطفال|حضانة/, key: 'nursery', ar: 'حضانات' },
  { kw: /مدرسة|مدارس/, key: 'school', ar: 'مدارس' },
  { kw: /مسجد|جامع|الحرم/, key: 'mosque', ar: 'مساجد' },
  { kw: /مطار/, key: 'airport', ar: 'مطارات' },
  { kw: /ميناء/, key: 'port', ar: 'موانئ' },
  { kw: /قطار|سار|الحرمين/, key: 'rail', ar: 'محطات قطار' },
  { kw: /مترو|محطة/, key: 'station', ar: 'مترو ومحطات' },
  { kw: /كورنيش/, key: 'corniche', ar: 'كورنيش' },
  { kw: /البحر|بحر|شاطئ|واجهة بحرية|بحري/, key: 'sea', ar: 'بحر وواجهة بحرية' },
  { kw: /بحيرة/, key: 'lake', ar: 'بحيرات' },
  { kw: /كمباوند|كمبوند|مشروع|مخطط/, key: 'project', ar: 'مشاريع وكمباوندات' },
  { kw: /برج|أبراج/, key: 'tower', ar: 'أبراج' },
  { kw: /مول|سنتر|بلازا|مركز تجاري|مجمع تجاري|الافنيوز|الأفنيوز/, key: 'mall', ar: 'مولات ومراكز تجارية' },
  { kw: /بنده|الدانوب|لولو|كارفور|التميمي|نستو/, key: 'supermarket', ar: 'سلاسل تسوق' },
  { kw: /سوق|أسواق/, key: 'market', ar: 'أسواق' },
  { kw: /حديقة|منتزه|متنزه/, key: 'park', ar: 'حدائق ومنتزهات' },
  { kw: /ملعب|استاد|المدينة الرياضية/, key: 'stadium', ar: 'ملاعب' },
  { kw: /نادي|صالة رياضية|جيم/, key: 'gym', ar: 'نوادي رياضية' },
  { kw: /الممشى|ممشى|مشاية/, key: 'promenade', ar: 'الممشى' },
  { kw: /فندق|منتجع/, key: 'hotel', ar: 'فنادق ومنتجعات' },
  { kw: /مطعم|مطاعم|مقهى|مقاهي|كافيه/, key: 'restaurant', ar: 'مطاعم ومقاهي' },
  { kw: /بنك|مصرف|صراف/, key: 'bank', ar: 'بنوك وصرافات' },
  { kw: /صيدلية|النهدي/, key: 'pharmacy', ar: 'صيدليات' },
  { kw: /المدينة الصناعية|صناعية/, key: 'industrial', ar: 'مدن صناعية' },
  { kw: /مستودع|مخزن/, key: 'warehouse', ar: 'مستودعات' },
  { kw: /الدبلوماسي|سفارة/, key: 'diplomatic', ar: 'الحي الدبلوماسي' },
  { kw: /كافد|المركز المالي|الملك عبدالله المالي|حي الأعمال/, key: 'business', ar: 'مناطق أعمال' },
  { kw: /متحف/, key: 'museum', ar: 'متاحف' },
  { kw: /سينما/, key: 'cinema', ar: 'دور سينما' },
  { kw: /جسر|كوبري/, key: 'bridge', ar: 'جسور' },
  { kw: /دوار|ميدان/, key: 'roundabout', ar: 'ميادين ودوارات' },
  { kw: /مخرج/, key: 'highway_exit', ar: 'مخارج الطرق' },
  { kw: /نيوم|القدية|البحر الأحمر|روشن|السودة/, key: 'giga', ar: 'مشاريع رؤية كبرى' },
  { kw: /طريق|الدائري/, key: 'road', ar: 'طرق رئيسية' },
  { kw: /شارع/, key: 'street', ar: 'شوارع' },
  { kw: /جبل|طويق|مرتفعات/, key: 'mountain', ar: 'جبال' },
  { kw: /صحراء/, key: 'desert', ar: 'صحاري' },
];

// Words that look like a "name" but are filler / spec noise — never a real entity name.
const NAME_NOISE = /^(جميع\s+الخدمات|و|في|من|على|الى|إلى|عن|مع|كل|جميع|الخدمات|خدمات|الرئيسية|الرئيسي|الحيوية|عرض|رقم|بعرض|تجاري|عام|فقط|مباشرة|بالسيارة|مشي|مشيا|مشياً|دقائق|دقيقة|المرافق|اهم|أهم|بعض|معظم)$/;

const CUE_FROM_NUM = /^\s*\d+\s*(دقائق|دقيقة|دقيقتين|كيلو|كم|متر|خطوة|خطوات)?/;

// Build one big alternation of all phrases (longest first) → which group/weight.
const PHRASE_INDEX: { phrase: string; rel: Relationship; weight: number }[] =
  GROUPS.flatMap((g) => g.phrases.map((p) => ({ phrase: p, rel: g.rel, weight: g.weight })))
    .sort((a, b) => b.phrase.length - a.phrase.length);

// Phrases that EMBED their own category noun, so the category can't be read from the text after
// them (it was consumed by the phrase). «على طريق الملك فهد» → category=road, name=الملك فهد.
const IMPLIED_CAT: Record<string, { key: string; ar: string }> = {
  'على طريق': { key: 'road', ar: 'طرق رئيسية' },
  'بين طريقين': { key: 'road', ar: 'طرق رئيسية' },
  'تقاطع': { key: 'road', ar: 'طرق رئيسية' },
  'على شارع': { key: 'street', ar: 'شوارع' },
};

// Phrases grouped by relationship — so a listing scores when it expresses the SAME relationship with
// ANY of the group's words (user wrote «قريب من», listing says «بالقرب من» → still a near-match).
const REL_PHRASES: Record<Relationship, string[]> = GROUPS.reduce((acc, g) => {
  acc[g.rel] = g.phrases; return acc;
}, {} as Record<Relationship, string[]>);

function classifyCategory(after: string): { key: string; ar: string } {
  for (const c of CATEGORY_LEX) if (c.kw.test(after)) return { key: c.key, ar: c.ar };
  return { key: '', ar: '' };
}

// Pull the specific entity NAME out of the text right after the category keyword.
// "مستشفى الحبيب الطبي" → "الحبيب الطبي"; "البحر" → '' (no proper name, generic).
function extractName(after: string): string {
  // up to 3 Arabic tokens (keeping a leading «ال» for clean display), stopping at scope/conjunction words
  const m = after.match(/((?:ال)?[؀-ۿ]{2,}(?:\s+(?!في|و|أو|من|على|مع|قريب|بجوار)[؀-ۿ]{2,}){0,2})/);
  if (!m) return '';
  const name = m[1].trim();
  if (NAME_NOISE.test(name)) return '';
  return name;
}

// Parse a user message (or a listing blob) into the location-relationship intents.
// Returns one ProximityIntent per relationship-phrase occurrence that resolves to a
// known category. (A phrase with no recognizable category is dropped — we never
// invent an entity.)
export function parseProximity(text: string): ProximityIntent[] {
  if (!text) return [];
  const out: ProximityIntent[] = [];
  const seen = new Set<string>();
  for (const { phrase, rel, weight } of PHRASE_INDEX) {
    let idx = text.indexOf(phrase);
    while (idx !== -1) {
      // window of text right after the phrase (skip a leading number for time_distance)
      let after = text.slice(idx + phrase.length).replace(CUE_FROM_NUM, '').trimStart();
      after = after.replace(/^(من|عن|الى|إلى)\s+/, ''); // «دقائق من المطار» → «المطار»
      // Category: read it from the text after the phrase; if the phrase embeds its own category
      // («على طريق» consumed طريق), fall back to the implied category and treat `after` as the name.
      let cat = classifyCategory(after.slice(0, 40));
      // The NAME is the SPECIFIC entity that follows the category KEYWORD, not the keyword itself:
      // «مستشفى الحبيب» → name «الحبيب»; bare «البحر» / «مستشفى» → name «» (a category-only ask, which
      // the relation table scores via its category tier — a non-empty generic keyword here would be read
      // as a specific-landmark name and match nothing). For an IMPLIED_CAT phrase the phrase already ate
      // the category noun, so `after` IS the name and nothing is stripped. (RPC name-tier fix 2026-06-27.)
      let nameSrc = after;
      if (cat.key) {
        const ce = CATEGORY_LEX.find((c) => c.key === cat.key);
        const m = ce ? after.match(ce.kw) : null;
        if (m) nameSrc = after.slice(after.indexOf(m[0]) + m[0].length);
      } else if (IMPLIED_CAT[phrase]) {
        cat = IMPLIED_CAT[phrase];
      }
      if (cat.key) {
        const name = extractName(nameSrc.slice(0, 60));
        // road/street position is only meaningful with a NAME (else it's «شارع عرض ٢٠» width noise)
        if ((cat.key === 'street') && !name) { idx = text.indexOf(phrase, idx + phrase.length); continue; }
        const dedup = `${rel}|${cat.key}|${name}`;
        if (!seen.has(dedup)) {
          seen.add(dedup);
          out.push({ relationship: rel, phrase, category: cat.key, categoryAr: cat.ar, name, weight });
        }
      }
      idx = text.indexOf(phrase, idx + phrase.length);
    }
  }
  return out;
}

// Score how strongly a LISTING's text satisfies the user's proximity intents.
// 0 = no evidence. Higher = the listing expresses the same relationship/entity.
//   exact name + same relationship phrase  → 3 × weight  (strongest)
//   exact name (any context)               → 2 × weight
//   relationship phrase + category keyword → 1.5 × weight
//   category keyword only (bare mention)   → 0.5 × weight (weak evidence)
export function scoreListingProximity(blob: string, intents: ProximityIntent[]): number {
  if (!blob || !intents.length) return 0;
  let score = 0;
  for (const it of intents) {
    const hasName = !!it.name && blob.includes(it.name);
    // a listing satisfies the RELATIONSHIP if it uses ANY phrase from the same group (user «قريب من»
    // vs listing «بالقرب من» both = near), not only the exact phrase the user typed.
    const hasPhrase = (REL_PHRASES[it.relationship] || [it.phrase]).some((p) => blob.includes(p));
    const catEntry = CATEGORY_LEX.find((c) => c.key === it.category);
    const hasCat = catEntry ? catEntry.kw.test(blob) : false;
    if (hasName && hasPhrase) score += 3 * it.weight;
    else if (hasName) score += 2 * it.weight;
    else if (hasPhrase && hasCat) score += 1.5 * it.weight;
    else if (hasCat) score += 0.5 * it.weight;
  }
  return score;
}

// Flat keyword list (back-compat with the old extractNearbyKeywords contract): the
// names + category Arabic labels the engine should text-match. Lets the existing
// keyword filter keep working while the relationship layer drives RANKING.
export function proximityKeywords(intents: ProximityIntent[]): string[] {
  const ks = new Set<string>();
  for (const it of intents) {
    if (it.name) ks.add(it.name);
    const catEntry = CATEGORY_LEX.find((c) => c.key === it.category);
    // add the first plain Arabic form of the category (e.g. 'مسجد') as a fallback term
    if (catEntry) {
      const plain = catEntry.kw.source.split('|')[0].replace(/[^؀-ۿ ]/g, '').trim();
      if (plain) ks.add(plain);
    }
  }
  return [...ks];
}
