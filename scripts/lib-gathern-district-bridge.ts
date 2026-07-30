// Shared pure matchers for the gathern Arabic-district catalog bridge (nomination + permanent tests).
// Unlike dealapp (English → Arabic), gathern's additional_info.district_ar is ALREADY Arabic — the gap
// is that the free-text spelling isn't in loc_catalog_district for that city. Evidence = the OFFICIAL
// sa-locations.json lists the same Arabic district for the SAME city (format-independent proof, per
// the similarity-is-not-evidence rule). Seeds use the EXACT gathern spelling because the resolver
// (resolve_district_ar) keys off norm_district_tok of the RAW input — seeding the official spelling
// would miss punctuated/variant raw forms like «نعمان.».

// JS mirror of SQL normalize_ar(): lower/trim, أإآٱ→ا, ة→ه, ى→ي, drop tatweel+RTL marks, collapse ws.
export const normAr = (s: string) =>
  s.trim().toLowerCase()
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[ـ‎‏‌‍‪‫‬‭‮]/g, '')
    .replace(/\s+/g, ' ');

// JS mirror of SQL norm_district_tok(): normalize_ar then strip leading «حي » then leading «ال».
export const tokAr = (s: string) => normAr(s).replace(/^حي\s+/, '').replace(/^ال/, '');

// Nomination-side match key ONLY (never used for seeding): tokAr + strip punctuation so «نعمان.»
// matches official «نعمان». The seeded spelling stays the exact raw form.
export const matchKeyAr = (s: string) =>
  tokAr(s).replace(/[.,،؛:;!؟?()\/\\-]/g, ' ').replace(/\s+/g, ' ').trim();

// The city-scoped exactly-one gate: candidates = official [city_id, region_id, en, ar] rows of THIS
// city whose Arabic match-key equals the form's; returns the single distinct official Arabic or null.
export function matchArInCity(
  districts: Array<[number, number, string, string]>, cityId: number, formAr: string,
): string | null {
  const k = matchKeyAr(formAr);
  if (!k) return null;
  const ars = [...new Set(districts.filter((d) => d[0] === cityId && matchKeyAr(d[3]) === k).map((d) => d[3]))];
  return ars.length === 1 ? ars[0] : null;
}
