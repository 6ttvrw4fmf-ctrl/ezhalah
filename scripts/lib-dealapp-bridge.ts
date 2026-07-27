// Shared pure matchers for the dealapp English-district bridge (nomination + permanent tests).
// normEn mirrors SQL norm_en_district; skel adds the consonant skeleton that absorbs Arabic
// romanization variance (shamiah/shamiyah, worrod/worod). Nomination safety comes from the
// EXACTLY-ONE-distinct-Arabic-match-per-city gate, never from the skeleton alone.
export const normEn = (s: string) =>
  s.toLowerCase()
    .replace(/\s*(dist\.?|district)\s*$/g, '')
    .replace(/[-_']/g, ' ')
    .replace(/^(al|an|ash|ad|as|ar|az|at|el)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

export const skel = (s: string) =>
  normEn(s)
    .split(' ')
    .map((w) => w.replace(/^(al|el|ash|ad|as|ar|az|at|an)(?=[a-z])/, ''))
    .join('')
    .replace(/[aeiouwy]/g, '')
    .replace(/(.)\1+/g, '$1');

// Obvious non-districts — never nominated, kept NULL.
export const JUNK = /plan|subdivision|industrial|university|housing|zone/i;

// The city-scoped exactly-one gate: candidates = official [city_id, region_id, en, ar] rows of THIS
// city whose skeleton equals the form's; returns the single distinct Arabic or null (0 or >1 → null).
export function matchInCity(
  districts: Array<[number, number, string, string]>, cityId: number, form: string,
): string | null {
  if (JUNK.test(form)) return null;
  const k = skel(form);
  if (!k) return null;
  const ars = [...new Set(districts.filter((d) => d[0] === cityId && skel(d[2]) === k).map((d) => d[3]))];
  return ars.length === 1 ? ars[0] : null;
}
