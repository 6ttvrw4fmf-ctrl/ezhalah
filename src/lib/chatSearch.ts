// Sidebar chat search — pure logic, so the barrier can EXECUTE the rules instead of pattern-matching
// them (owner 2026-08-24: Arabic-only chat search + ChatGPT-style in-sidebar search mode).
//
// Two hard rules live here:
//   1. ARABIC-ONLY INPUT. Latin letters never become part of a search query — they are stripped at
//      the input boundary, calmly (no error state, no red warning; the sidebar shows one quiet hint
//      instead). Arabic script, Arabic-Indic digits (٠-٩ / ۰-۹), spaces and harmless punctuation
//      survive. `hadLatin` tells the UI a strip happened so it can show the hint once, not per key.
//   2. READ-ONLY DISCOVERY. Filtering takes the history array and returns a SUBSET of the same
//      objects — same ids, same references. It never re-orders beyond the caller's order, never
//      clones-and-mutates, and has no side effects, so search can never create, rename, duplicate
//      or lose a conversation. Opening a result goes through the exact same openHistory row path
//      as a normal sidebar row (asserted by scripts/verify-sidebar-chat-search.ts).
//
// Matching mirrors how users type: the query is tokenised, EVERY token must appear somewhere in the
// row's searchable text (title + auto label), and comparison is normalised the same way the rest of
// Ezhalah normalises Arabic (أإآٱ→ا, ة→ه, ى→ي, tatweel stripped) so «فيلا أبها» finds «فيلا ابها».

// Arabic script blocks (base + supplement + extended + presentation forms) and Arabic-Indic digits.
const ARABIC_OK = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
// Harmless non-letter input that may ride along inside a query.
const NEUTRAL_OK = /[\s0-9٠-٩۰-۹.,،؛:؟!()\-_'"«»]/;

export type SanitizedSearch = { text: string; hadLatin: boolean };

/** Keep Arabic + neutral characters; drop everything else (Latin letters included). */
export function sanitizeArabicSearch(raw: string): SanitizedSearch {
  let text = '';
  let hadLatin = false;
  for (const ch of raw ?? '') {
    if (ARABIC_OK.test(ch) || NEUTRAL_OK.test(ch)) text += ch;
    else hadLatin = true;
  }
  text = text.replace(/\s+/g, ' ').replace(/^\s+/, '');
  return { text, hadLatin };
}

/** Same folding the rest of the app uses for Arabic comparison (mirrors normalize_ar/norm_ar). */
export function normalizeArabic(s: string): string {
  let out = (s ?? '').toLowerCase();
  for (const a of 'أإآٱ') out = out.split(a).join('ا');
  out = out.split('ة').join('ه').split('ى').join('ي').split('ـ').join('');
  return out.replace(/\s+/g, ' ').trim();
}

// Arabic LETTERS only — excludes the block's digits (٠-٩), punctuation (،؛؟) and diacritics, so a
// query of bare punctuation or digits does not start filtering the list.
const ARABIC_LETTER = /[ء-يٱ-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** A query only counts as a query once it carries at least one Arabic LETTER after sanitising —
 *  punctuation or digits alone must not filter the list (and `hi` sanitises to nothing at all). */
export function isSearchableQuery(text: string): boolean {
  return ARABIC_LETTER.test(text);
}

/** Every substantive query token must appear in the haystack (AND semantics → typing more narrows
 *  further). Tokens with no letter or digit (stray punctuation) are ignored, never demanded. */
export function matchesChat(haystack: string, query: string): boolean {
  const hay = normalizeArabic(haystack);
  const tokens = normalizeArabic(query).split(' ')
    .filter((tk) => ARABIC_LETTER.test(tk) || /[0-9٠-٩۰-۹]/.test(tk));
  if (!tokens.length) return false;
  return tokens.every((tk) => hay.includes(tk));
}

/** Filter history rows by their searchable text. Pure: returns the SAME item references, in the
 *  caller's order, with zero writes — search is read-only discovery of existing conversations. */
export function filterChats<T>(items: readonly T[], searchText: (item: T) => string, query: string): T[] {
  if (!isSearchableQuery(query)) return [...items];
  return items.filter((it) => matchesChat(searchText(it), query));
}
