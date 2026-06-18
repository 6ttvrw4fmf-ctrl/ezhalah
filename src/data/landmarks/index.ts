// ─────────────────────────────────────────────────────────────────────────────
// Landmark Intelligence Layer — recognition of how people ACTUALLY search ("near
// PNU", "near KAFD") instead of by district name.
//
// The 6,518-record catalog now lives in SUPABASE (table `landmarks`), NOT in the app
// bundle. We fetch it ONCE per session, build the in-memory recognition index, and run
// the same longest-alias scan. This keeps the data out of the shipped JS (smaller, faster
// app) and lets it be updated in the DB without an app redeploy. (user request.)
//
// SCOPE: recognition only — landmark → { name, category, city, region }. No geocoding.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '@/lib/supabase';

// Recognition core — the only fields the matcher reads.
export type Landmark = {
  landmark_name: string;
  aliases: string[];
  category: string;
  region: string;
  city: string;
};

// What a successful recognition returns — the search SIGNAL (name + category + city).
export type LandmarkHit = {
  matchedText: string; // the alias/name the user actually typed
  name: string;        // canonical landmark name
  category: string;
  city: string;
  region: string;
};

// Fold spelling/transliteration noise so "Al-Olaya", "olaya", "العليا " all key the same.
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[ً-ْ]/g, '') // strip Arabic diacritics
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .replace(/\b(al|el|the)\s+/g, '') // drop leading articles
    .trim();

let ALL_LANDMARKS: Landmark[] = [];
let INDEX: Map<string, Landmark> | null = null;
let KEYS_BY_LEN: string[] | null = null;
let loadPromise: Promise<void> | null = null;

function buildIndex() {
  const m = new Map<string, Landmark>();
  for (const lm of ALL_LANDMARKS) {
    for (const raw of [lm.landmark_name, ...(lm.aliases ?? [])]) {
      const k = norm(raw);
      if (k && !m.has(k)) m.set(k, lm);
    }
  }
  INDEX = m;
  KEYS_BY_LEN = [...m.keys()].sort((a, b) => b.length - a.length);
}

// Fetch every landmark from Supabase (PostgREST caps at 1000 rows/request, so paginate),
// then build the index. Cached for the session; a no-op once loaded. Call it before any
// recognition — the agent does `await ensureLandmarks()` right before landmarkHint().
export async function ensureLandmarks(): Promise<void> {
  if (INDEX) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!supabase) { buildIndex(); return; } // no backend → empty index (recognition degrades gracefully)
    const page = 1000;
    const rows: Landmark[] = [];
    for (let from = 0; ; from += page) {
      const { data, error } = await supabase
        .from('landmarks')
        .select('landmark_name, aliases, category, region, city')
        .range(from, from + page - 1);
      if (error || !data || data.length === 0) break;
      rows.push(...(data as Landmark[]));
      if (data.length < page) break;
    }
    ALL_LANDMARKS = rows;
    buildIndex();
  })();
  return loadPromise;
}

const toHit = (lm: Landmark, matchedText: string): LandmarkHit => ({
  matchedText,
  name: lm.landmark_name,
  category: lm.category,
  city: lm.city,
  region: lm.region,
});

// Exact alias/name lookup (after normalization). Returns the landmark or null. Empty until loaded.
export function lookupLandmark(text: string): LandmarkHit | null {
  if (!INDEX) return null;
  const lm = INDEX.get(norm(text));
  return lm ? toHit(lm, text) : null;
}

// Scan a free-text message and return any landmarks referenced (longest alias first, no overlaps).
// Returns [] until ensureLandmarks() has resolved.
export function findLandmarks(message: string, limit = 3): LandmarkHit[] {
  if (!INDEX || !KEYS_BY_LEN) return [];
  const hay = ' ' + norm(message) + ' ';
  const hits: LandmarkHit[] = [];
  const used: Array<[number, number]> = [];
  for (const key of KEYS_BY_LEN) {
    if (key.length < 2) continue;
    const idx = hay.indexOf(' ' + key + ' ');
    if (idx === -1) continue;
    const start = idx;
    const end = idx + key.length + 2;
    if (used.some(([s, e]) => start < e && end > s)) continue; // no overlapping matches
    used.push([start, end]);
    hits.push(toHit(INDEX.get(key)!, key));
    if (hits.length >= limit) break;
  }
  return hits;
}

// Compact, model-friendly recognition hint — e.g. "PNU = Princess Nourah … (University), Riyadh".
// Empty if none found (or not yet loaded).
export function landmarkHint(message: string): string {
  const hits = findLandmarks(message);
  if (!hits.length) return '';
  return hits.map((h) => `${h.matchedText} = ${h.name} (${h.category}), ${h.city}`).join(' | ');
}
