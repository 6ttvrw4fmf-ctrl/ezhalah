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

/** Client fold — MIRRORS the DB's norm_district_tok (owner 2026-09-12: "user types with different
 *  spelling, our job is to match"): ء drop, ئ→ي, Arabic-Indic digits ٠-٩→0-9, plus the
 *  pre-existing alef/ta-marbuta/alef-maqsura/tatweel folds. Match-only — display text is never
 *  routed through this. Keep in step with src/data/locations.ts `norm` and the edge's arNorm. */
export function normalizeArabic(s: string): string {
  let out = (s ?? '').toLowerCase();
  for (const a of 'أإآٱ') out = out.split(a).join('ا');
  out = out.split('ة').join('ه').split('ى').join('ي').split('ئ').join('ي').split('ـ').join('').split('ء').join('');
  out = out.replace(/[ً-ٟ]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
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

/**
 * Does the sidebar still show the Arabic-only hint after this keystroke?
 *
 * Rule 1 above promises the hint appears "ONCE, not per key" — a calm nudge, not an error state.
 * The first implementation latched it on the strip and cleared it only when the field went EMPTY,
 * which quietly made "once" mean "for the rest of the search session": typing `villa` strips to an
 * empty field, so the user's very next act — switching keyboard and typing a real Arabic query —
 * never passes through an empty-text change, and the nudge stayed on screen while the list was
 * already filtering correctly on that query. A correction that outlives what it corrects reads as
 * "this is still wrong" over a screen where nothing is (found by journey `arabic-hint`, 2/2 fresh
 * contexts on production, 2026-08-28).
 *
 * So the hint is tied to the CONDITION rather than latched by the event: it is shown while the
 * user has not yet supplied a usable Arabic query, and it goes the moment they have.
 *
 * The three inputs are deliberately distinct, and the order matters:
 *   - `hadLatin`  a strip happened on THIS keystroke → say so, even if Arabic came with it
 *                 (`villaف` both strips and searches; the nudge is still the honest response).
 *   - empty text  nothing to correct.
 *   - searchable  a real Arabic query is now filtering the list → the nudge's job is done.
 *   - otherwise   digits/punctuation alone: not yet a query, so neither raise nor clear — hold
 *                 whatever the previous keystroke decided.
 */
export function arabicHintAfterInput(shown: boolean, { text, hadLatin }: SanitizedSearch): boolean {
  if (hadLatin) return true;
  if (!text) return false;
  if (isSearchableQuery(text)) return false;
  return shown;
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

/** One run of displayed text, `bold` when it matched a query token — for rendering «bold the
 *  matching text» in search results (owner request 2026-09-11) as a run of `<Text>` spans.
 *  Concatenating every `text` reconstructs the ORIGINAL title exactly (never the normalized one) —
 *  this only decides which slices to bold, it never changes what's on screen. */
export type BoldSpan = { text: string; bold: boolean };

/** normalizeArabic's four letter-folds (أإآٱ→ا, ة→ه, ى→ي) are 1-for-1 substitutions, so the
 *  normalized string stays the same LENGTH and INDEX-ALIGNED with the original — only tatweel
 *  stripping and whitespace collapsing break that alignment, and titles (generated or renamed)
 *  essentially never carry either. Folding just those four keeps every index usable against the
 *  original string; title/label text outside that rare case gets no bold run rather than a
 *  mis-aligned one (fails closed to "no highlight", never to a wrong highlight). */
function foldLengthPreserving(s: string): string {
  let out = s.toLowerCase();
  for (const a of 'أإآٱ') out = out.split(a).join('ا');
  return out.split('ة').join('ه').split('ى').join('ي');
}

/** Split `title` into bold/non-bold runs for every query token that appears in it, using the SAME
 *  tokenising and normalization matchesChat() uses (a token bolds only when it's actually part of
 *  why this row matched). Pure, read-only, never reorders or drops characters. */
export function boldSpans(title: string, query: string): BoldSpan[] {
  if (!title) return [];
  const foldedTitle = foldLengthPreserving(title);
  const tokens = normalizeArabic(query).split(' ')
    .filter((tk) => ARABIC_LETTER.test(tk) || /[0-9٠-٩۰-۹]/.test(tk))
    .map(foldLengthPreserving)
    .filter((tk, i, arr) => tk && arr.indexOf(tk) === i) // dedupe, keep first-seen order
    .sort((a, b) => b.length - a.length); // longest token wins an overlapping span
  if (!tokens.length || foldedTitle.length !== title.length) return [{ text: title, bold: false }];
  const mask = new Array(title.length).fill(false);
  for (const tk of tokens) {
    let from = 0;
    for (;;) {
      const at = foldedTitle.indexOf(tk, from);
      if (at === -1) break;
      for (let i = at; i < at + tk.length; i++) mask[i] = true;
      from = at + tk.length;
    }
  }
  const spans: BoldSpan[] = [];
  let i = 0;
  while (i < title.length) {
    const bold = mask[i];
    let j = i;
    while (j < title.length && mask[j] === bold) j++;
    spans.push({ text: title.slice(i, j), bold });
    i = j;
  }
  return spans;
}

/** Filter history rows by their searchable text. Pure: returns the SAME item references, in the
 *  caller's order, with zero writes — search is read-only discovery of existing conversations. */
export function filterChats<T>(items: readonly T[], searchText: (item: T) => string, query: string): T[] {
  if (!isSearchableQuery(query)) return [...items];
  return items.filter((it) => matchesChat(searchText(it), query));
}
