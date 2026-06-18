// Bilingual display name. The app shows the user's name in the app's language: Arabic UI → the
// Arabic spelling, English UI → the Latin spelling. We keep BOTH spellings on the user and keep
// them synced — edit in one script and the other is regenerated (user request).
//
// Transliteration quality comes from the `translit` edge function (Gemini knows that
// "Al Nashwan" → "النشوان", not the phonetic "ال ناشوان"). If that call is unavailable we fall
// back to the deterministic phonetic table in arabicName.ts so display still works offline.

import { supabase } from '@/lib/supabase';
import { displayName as phoneticAr } from '@/lib/arabicName';
import type { Locale } from '@/i18n';

export type BilingualName = { name: string; nameEn?: string; nameAr?: string };

// Which script is this name written in? More Arabic letters → 'ar', else 'en'.
export function scriptOf(name: string): Locale {
  const s = name ?? '';
  const ar = (s.match(/[؀-ۿ]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  return ar > en ? 'ar' : 'en';
}

// Avatar initial — SINGLE letter only (user request): the first character of the display name.
// "Yusuf Saleh Al Nashwan" → "Y", "أحمد القحطاني" → "أ". Never multi-letter (no "YN", "YSA").
export function initialsOf(name: string): string {
  const v = (name ?? '').trim();
  if (!v) return 'U';
  return v.charAt(0).toUpperCase();
}

// Ask the backend to transliterate a name into the target script. Returns null on any failure so
// the caller can fall back. (ar→en has no good deterministic fallback, so we only retry via Gemini.)
export async function transliterateName(name: string, target: Locale): Promise<string | null> {
  const v = (name ?? '').trim();
  if (!v || !supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('translit', { body: { name: v, target } });
    const out = (data as any)?.name;
    if (error || typeof out !== 'string' || !out.trim()) return null;
    return out.trim();
  } catch {
    return null;
  }
}

// Pick the name to DISPLAY for the current app language, with graceful fallbacks.
export function pickName(
  u: { name?: string; nameEn?: string; nameAr?: string } | null | undefined,
  locale: Locale,
): string {
  if (!u) return '';
  const en = (u.nameEn || '').trim();
  const ar = (u.nameAr || '').trim();
  const base = (u.name || '').trim();
  if (locale === 'ar') {
    // Prefer a stored Arabic spelling; else phonetically transliterate the Latin one; else as-typed.
    return ar || (en ? phoneticAr(en, true) : '') || phoneticAr(base, true) || base;
  }
  // English UI: prefer the Latin spelling; if we only have Arabic, fall back to the as-typed value.
  return en || (scriptOf(base) === 'en' ? base : '') || base;
}

// Build the synced {name, nameEn, nameAr} patch from a freshly-typed value. `name` stays the value
// the user actually typed; the opposite script is generated (Gemini, with phonetic fallback for AR).
export async function buildSyncedName(typed: string): Promise<BilingualName> {
  const v = (typed ?? '').trim();
  if (!v) return { name: v };
  const sc = scriptOf(v);
  if (sc === 'ar') {
    const en = await transliterateName(v, 'en'); // no deterministic AR→EN fallback
    return { name: v, nameAr: v, ...(en ? { nameEn: en } : {}) };
  }
  // Typed in Latin: generate Arabic (Gemini, else phonetic table so it's never empty).
  const ar = (await transliterateName(v, 'ar')) || phoneticAr(v, true);
  return { name: v, nameEn: v, ...(ar ? { nameAr: ar } : {}) };
}
