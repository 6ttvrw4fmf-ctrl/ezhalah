// Shared example-prompt library used by BOTH the home onboarding grid and the AI Agent's empty
// state. Keeping a single source of truth means a new prompt added here shows up in both places,
// and the rotation logic stays consistent. Two language pools — Arabic UI shows Arabic, English
// UI shows English, never mixed. Sampled randomly on every component mount so a returning user
// sees a FRESH set on each visit / refresh / chat re-open. (user request: "always refresh whenever
// a user leaves or joins — same when user clicks on the Ezhalah AI Agent — create a rotation.")

export const EN_POOL: string[] = [
  // Residential
  'Family villa in North Riyadh', 'Apartment in Al Narjis', 'Villa in Al Yasmin', 'Apartment in Al Malqa',
  'Villa in Al Arid', 'Family apartment in Khobar', 'Apartment in North Jeddah', 'Villa in Al Hamra',
  'Apartment in Al Rawdah', 'Villa in Hittin',
  // Budget
  'What can SAR 500,000 buy me?', 'What can SAR 800,000 buy me in Jeddah?', 'Properties under SAR 1 million',
  'Apartments under SAR 60,000 per year', 'Villas under SAR 2 million', 'Land under SAR 700,000',
  // Landmark
  'Apartment near KAFD', 'Villa near Boulevard Riyadh City', 'Apartment near Ithra', 'Property near King Saud University',
  'Apartment near Princess Nourah University', 'Property near KFUPM', 'Villa near Soudah', 'Land near NEOM',
  'Property near Marid Castle', 'Apartment near Art Street Abha',
  // Lifestyle
  'Villa with a pool', 'Home near international schools', 'Beachfront property in Al Khobar', 'Sea view apartment in Jeddah',
  'Chalet for weekend escapes', 'Farm near Abha', 'Family villa with a large garden', 'Home close to parks and walking areas',
  // Commercial
  'Office in Riyadh', 'Office near KAFD', 'Shop for rent in Jeddah', 'Warehouse in Dammam Industrial City',
  'Commercial land in Jeddah', 'Showroom in Riyadh', 'Office near King Abdullah Road', 'Retail space in Khobar',
  // Student
  'Student apartment near KFUPM', 'Student apartment near King Saud University', 'Student apartment near Princess Nourah University',
  'Student apartment near Imam University', 'Student apartment near Jazan University',
  // Community & projects
  'Villa in Sedra', 'Property in Al Fursan', 'Apartment in Khuzam Riyadh', 'Property near ROSHN communities',
  'Villa near Qiddiya', 'Home in Shams Ar Riyadh',
];

export const AR_POOL: string[] = [
  'شقة بالقرب من كافد', 'فيلا في حي النرجس بالرياض', 'شقة عائلية في الخبر', 'أرض تجارية في جدة',
  'فيلا مع مسبح في شمال الرياض', 'شقة بإطلالة بحرية في جدة', 'شقة طلابية قرب جامعة الملك فهد',
  'مكتب بالقرب من جامعة الملك سعود', 'دور للإيجار في حي الملقا', 'مزرعة للبيع قرب أبها',
  'شاليه قريب من الرياض للويكند', 'محل للإيجار في جدة', 'أرض بالقرب من نيوم', 'فيلا بالقرب من السودة',
  'شقة قرب إثراء', 'مستودع في المدينة الصناعية بالدمام', 'عقار قرب واجهة الرياض', 'شقة بالقرب من بوليفارد الرياض',
  'أرض سكنية في شمال الرياض', 'فيلا عائلية في الياسمين', 'شقة في الروضة', 'فيلا في حطين', 'أرض في الرمال',
  'شقة في الصحافة', 'فيلا في المحمدية بجدة', 'شقة قرب جامعة الأميرة نورة', 'فيلا قرب مطار الملك خالد',
  'أرض قرب مشروع القدية', 'شقة بالقرب من جامعة جازان', 'عقار قرب قلعة مارد', 'فيلا في الخبر مع حديقة',
  'مكتب في حي العليا بالرياض', 'عقار قريب من مستشفى الملك فيصل التخصصي', 'أرض بالقرب من مشروع روشن',
  'فيلا في سدرة', 'عقار في الفرسان', 'شقة في شمال جدة', 'مزرعة في عسير', 'استراحة للبيع قرب الرياض',
];

// Fisher–Yates shuffle → first n. Math.random() is fine here — fresh combination every mount.
export function sampleExamples(pool: string[], n: number): string[] {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// In-memory cache of the dynamic (DB-driven) prompt ideas — fetched ONCE per session and reused by
// every component that asks. We pair it with a Set of subscribers so React components mounted while
// the fetch is still in flight re-render as soon as the answer lands. (Don't want to spam Supabase
// with a query per home-screen mount.)
import { useEffect, useState } from 'react';
import { fetchPromptIdeas, type PromptIdea } from './remote';

let dynamicCache: PromptIdea[] | null = null;
let dynamicPromise: Promise<PromptIdea[] | null> | null = null;
const subs = new Set<(v: PromptIdea[]) => void>();

function ensureDynamic(): Promise<PromptIdea[] | null> {
  if (dynamicCache) return Promise.resolve(dynamicCache);
  if (dynamicPromise) return dynamicPromise;
  dynamicPromise = fetchPromptIdeas().then((ideas) => {
    if (ideas && ideas.length) {
      dynamicCache = ideas;
      for (const cb of subs) cb(ideas);
    }
    return ideas;
  });
  return dynamicPromise;
}

// React hook: returns a fresh random N prompts for the given UI language. Pulls EXCLUSIVELY from
// the live DB once the fetch lands, so every chip is guaranteed to refer to a real listing the
// search will find. Falls back to the curated static pool ONLY for the first paint while the DB
// request is in flight — once the dynamic ideas land, the next mount uses 100% real inventory.
// (user-reported: chip said "Villa in Khobar with a garden" but we haven't scraped Khobar yet →
// search returned 0. Fix: never show a chip we can't fulfill.)
export function useExamplePrompts(locale: 'en' | 'ar', n: number): string[] {
  const [, force] = useState(0);
  useEffect(() => {
    let alive = true;
    const cb = () => { if (alive) force((v) => v + 1); };
    subs.add(cb);
    void ensureDynamic();
    return () => { alive = false; subs.delete(cb); };
  }, []);
  const dyn = (dynamicCache ?? []).map((i) => (locale === 'ar' ? i.ar : i.en));
  const want = Math.min(n, 12);
  if (dyn.length >= want) return sampleExamples(dyn, want);
  // First paint before the DB fetch returns — show the static curated pool just so the grid isn't
  // empty for the first ~300 ms. Subsequent mounts hit the cache and return 100% live data.
  const stat = locale === 'ar' ? AR_POOL : EN_POOL;
  return sampleExamples(stat, want);
}

// Lightweight icon picker: scans the prompt for a topic keyword (Arabic or English) and returns the
// matching Ionicons name. Used by the home onboarding grid so each rotated example gets a visually
// relevant icon without us hand-mapping every prompt. Falls back to home-outline for anything that
// doesn't match.
export function iconForPrompt(text: string): string {
  const t = text.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => t.includes(n) || text.includes(n));
  if (has('villa', 'فيلا')) return 'home-outline';
  if (has('apartment', 'flat', 'شقة', 'دور', 'floor')) return 'business-outline';
  if (has('shop', 'retail', 'محل', 'متجر')) return 'storefront-outline';
  if (has('office', 'showroom', 'مكتب', 'معرض')) return 'briefcase-outline';
  if (has('warehouse', 'factory', 'مستودع', 'مصنع')) return 'cube-outline';
  if (has('land', 'plot', 'أرض', 'أراضي')) return 'map-outline';
  if (has('farm', 'مزرعة')) return 'leaf-outline';
  if (has('chalet', 'rest house', 'شاليه', 'استراحة')) return 'umbrella-outline';
  if (has('pool', 'مسبح')) return 'water-outline';
  if (has('beach', 'sea', 'بحري', 'إطلالة بحرية')) return 'boat-outline';
  if (has('student', 'university', 'طلابية', 'جامعة')) return 'school-outline';
  if (has('garden', 'park', 'حديقة')) return 'flower-outline';
  if (has('sar', 'ريال', 'budget', 'million', '٫', 'مليون')) return 'pricetag-outline';
  return 'home-outline';
}
