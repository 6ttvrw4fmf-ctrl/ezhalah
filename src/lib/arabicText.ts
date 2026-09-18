// Pure helpers for detecting Arabic script and choosing a safe placeholder when resolved text isn't
// Arabic. Zero-dependency ON PURPOSE so it is unit-testable without the React Native / Expo runtime
// (mirrors src/lib/inputHygiene.ts's design).

/** True if the string contains at least one Arabic-script character (the Arabic Unicode block ء-ي). */
export function hasArabicChar(s: string): boolean {
  return /[ء-ي]/.test(s);
}

/**
 * In the Arabic locale, a resolved place/label that still contains NO Arabic character after
 * translation/catalog lookup means nothing really matched (a raw scraped or typed English name, an
 * out-of-catalog district, an ambiguous-match echo, etc.). Returning that raw text would leak English
 * into an otherwise-Arabic summary, so this returns `placeholder` instead.
 *
 * No-op for an empty string (callers already guard those separately) and no-op for any non-Arabic
 * locale (an English place name there is correct, not a leak).
 */
export function arabicOrPlaceholder(text: string, locale: string, placeholder: string): string {
  if (!text) return text;
  if (locale !== 'ar') return text;
  return hasArabicChar(text) ? text : placeholder;
}

/**
 * The mirror of arabicOrPlaceholder, for the ENGLISH locale (owner, 2026-09-11 — "just a
 * translation of what is in Arabic... for the bio, let's remove it"). A listing's own free-text
 * prose (the ad description/title) is scraped Arabic and is NEVER machine-translated — showing it
 * raw on an English screen mixes languages mid-card. Rather than translate it or leave it in
 * Arabic, this hides it outright: returns null so the caller's existing `x ? <Text>… : null`
 * gating drops the element, exactly like a listing that never had one.
 *
 * No-op in the Arabic locale and for text that ISN'T Arabic prose (nothing to hide there).
 */
export function hideArabicProseInEnglish(text: string | null, locale: string): string | null {
  if (!text) return text;
  if (locale !== 'en') return text;
  return hasArabicChar(text) ? null : text;
}

/** True if the string contains at least one Latin letter (a-z/A-Z). */
export function hasLatinLetter(s: string): boolean {
  return /[a-zA-Z]/.test(s);
}

/**
 * Like arabicOrPlaceholder, but for FREE-TEXT attribute values (street address, "other
 * obligations", ad source, plan/land numbers, …) rather than a place/type LABEL. A label with no
 * Arabic character means nothing matched (always a leak); free-text is different — a plan number
 * ("REGA-4471") or land number has no Arabic AND no Latin letters either, and is legitimate raw
 * source content that must pass through unchanged (never invent/never rewrite raw values). Only
 * text with an actual Latin LETTER and no Arabic character is a real English-word leak (e.g. a
 * scraped English street address on an otherwise-Arabic card) and gets replaced.
 */
export function arabicOrPlaceholderForFreeText(text: string, locale: string, placeholder: string): string {
  if (!text) return text;
  if (locale !== 'ar') return text;
  if (hasArabicChar(text)) return text;
  return hasLatinLetter(text) ? placeholder : text;
}

/**
 * Fold the Arabic letter variants that are the SAME letter typed differently: أ/إ/آ/ٱ → ا, ة → ه,
 * ى/ي → ي. Exactly the folding `norm()` in src/data/locations.ts applies when it builds its search
 * keys — which is why «أبها» finds the catalog's «ابها» — but 1:1 and LENGTH-PRESERVING, so the
 * result can be index-aligned with its input. Latin text passes through untouched.
 */
export function foldArabicVariants(s: string): string {
  return s.replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىي]/g, 'ي');
}

/**
 * Subtract a PLACE NAME from a text, ignoring those same alef/ta-marbuta/ya spelling variants.
 * Returns `text` unchanged when the place isn't in it, and always removes exactly `place.length`
 * characters of the ORIGINAL text (foldArabicVariants is length-preserving, so the fold-space index
 * is also the real index) — never a folded rewrite of what the user or a source actually wrote.
 *
 * WHY IT EXISTS: src/data/locations.ts decides "the typed location is JUST a city, so there is no
 * district to look up" by subtracting the matched city's name from the district probe and checking
 * that nothing is left. A plain String.replace() made that test blind to spelling: the catalog
 * spells Abha «ابها» while users and the AI agent write «أبها», nothing was subtracted, the whole
 * city name survived as a "district probe", word-matched the live district «روابي أبها» — and the
 * CITY of Abha was silently re-scoped to one neighbourhood (0 results where 15 exist, 22 where 770
 * exist). 27 city spellings across the Kingdom resolved to a district that way.
 * (defect abha-city-rescope, 2026-08-23; barrier scripts/verify-city-never-rescoped-to-district.ts.)
 */
export function cutPlaceName(text: string, place: string): string {
  if (!text || !place) return text;
  const i = foldArabicVariants(text).indexOf(foldArabicVariants(place));
  return i < 0 ? text : text.slice(0, i) + text.slice(i + place.length);
}

/**
 * The LABEL to show for an "additional information" row on a result card.
 *
 * WHY IT EXISTS (live production defect, 2026-09-18, Normal-Filter QA run). `additional_info` rows
 * carry BOTH a `key` and a `label`, and the two platforms that populate the field disagree about
 * which one is human-readable:
 *
 *   therc  → {"key":"السعر كما نشر", "label":"Price as published"}   ← Arabic name is the KEY
 *   wasalt → {"key":"propertyMainType", "label":"Property usage"}     ← key is a machine name
 *
 * The card rendered `t(label)` and fell straight back to ATTRIBUTE_UNRESOLVED_AR when that produced
 * no Arabic. For therc that is self-contradictory: the app told the user «بيان غير محدد» ("statement
 * unspecified") about a field whose Arabic name the source had published, in the very same object.
 * Measured live: all 438 therc listings carrying the field (429 residential + 9 commercial), three
 * of their four rows each — «رقم المرجع», «تاريخ النشر», «السعر كما نشر» — i.e. ~1.3k placeholder
 * cells served in place of names we already had. («الحي» escaped only because "District" happens to
 * have an AR{} entry.)
 *
 * The order is deliberate and never invents a name:
 *   1. a translated label that IS Arabic wins — the dictionary is still the primary source;
 *   2. otherwise the source's own `key`, but ONLY when it is genuinely an Arabic display string
 *      (Arabic characters present AND no Latin letter), so wasalt's `propertyMainType` can never be
 *      promoted into the UI — the English-leak this whole family of helpers exists to prevent;
 *   3. otherwise the honest placeholder, exactly as before.
 *
 * No-op outside the Arabic locale, where an English label is correct rather than a leak.
 */
export function attrDisplayLabel(
  translatedLabel: string, rawKey: string, locale: string, placeholder: string,
): string {
  if (locale !== 'ar') return translatedLabel;
  if (translatedLabel && hasArabicChar(translatedLabel)) return translatedLabel;
  const k = String(rawKey ?? '').trim();
  if (k && hasArabicChar(k) && !hasLatinLetter(k)) return k;
  return placeholder;
}

/** The rent-period words a source appends to a published price, and their Arabic equivalents. */
const AR_PERIOD_WORD: Record<string, string> = {
  yearly: 'سنوياً', annually: 'سنوياً', annual: 'سنوياً',
  monthly: 'شهرياً', weekly: 'أسبوعياً', daily: 'يومياً',
};

/**
 * Translate a trailing «/ yearly»-style rent-period word inside an otherwise-Arabic attribute value.
 *
 * WHY IT EXISTS (same run). therc publishes its price-as-published string as
 * `"5,000 ر.س \n / yearly"` — mixed script. Because it contains «ر.س» it carries an Arabic
 * character, so `arabicOrPlaceholderForFreeText` correctly passes it through as real source content,
 * and the English word rode along onto an otherwise-Arabic card. 245 therc listings today.
 *
 * This is display-layer translation of a CLOSED enum — the same thing arAttrValue already does for
 * `age` ("new" → «جديد») and `facade` — not a rewrite of the value: the number, the currency and the
 * separator are untouched, and a trailing word that is NOT a known period word is left exactly as it
 * was rather than guessed at. Stored data is never modified.
 */
export function translateTrailingPeriodWord(text: string, locale: string): string {
  if (!text || locale !== 'ar') return text;
  return text.replace(/\/\s*([A-Za-z]+)\s*$/, (m, w: string) => {
    const ar = AR_PERIOD_WORD[w.toLowerCase()];
    return ar ? `/ ${ar}` : m;
  });
}
