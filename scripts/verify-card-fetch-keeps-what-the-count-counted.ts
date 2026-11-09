// THE CARD FETCH MUST KEEP EVERY ROW THE COUNT COUNTED (🔧 2026-11-04, backlog 1276).
// The Filter's total comes from location_search_candidates_ar over the ARABIC index (s.type_ar = any(p_types)); the cards
// are then re-read from the SOURCE table with keptFiltersReq() → .in('property_type', rawTypes), i.e. the ENGLISH/raw
// stored forms. A stored English type that EN_TO_AR maps into a chip's labels but that the chip's rawTypes never name is
// counted and never drawn: wasalt 13993632 (property_type 'Compound' → type_ar مجمع) made the Filter say «1» and show
// no card on production, twice (customer-journey 41837852546). EXECUTED here against the real maps, then mutation-proven.
import { typeArForTypes, CLEAN_TO_QUERY, EN_TO_AR, ALL_CLEAN_TYPES, storedRawTypes } from '../src/data/propertyTypes.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

type Maps = { clean: string[]; labelsOf: (c: string) => string[]; rawOf: (c: string) => string[]; enToAr: Record<string, string> };
/** Every stored English type whose Arabic label the chip counts must be among the raw types the card fetch asks for. */
export function violations(m: Maps): string[] {
  const out: string[] = [];
  for (const c of m.clean) {
    const labels = new Set(m.labelsOf(c));
    const raw = new Set(m.rawOf(c));
    for (const [en, label] of Object.entries(m.enToAr)) {
      if (labels.has(label) && !raw.has(en)) out.push(`${c}: counts type_ar «${label}» but the card fetch drops stored property_type '${en}'`);
    }
  }
  return out;
}

const real: Maps = {
  clean: ALL_CLEAN_TYPES,
  labelsOf: (c) => typeArForTypes([c]) ?? [],
  rawOf: (c) => storedRawTypes(CLEAN_TO_QUERY[c]?.rawTypes ?? []),
  enToAr: EN_TO_AR,
};

console.log('\nThe card fetch keeps what the count counted\n');
const v = violations(real);
check('no chip counts a stored English type its card fetch would drop', v.length === 0, v.join(' | '));
check('Residential Building names the stored «Compound» (wasalt 13993632, aqargate 2116473)', real.rawOf('Residential Building').includes('Compound'));
check('Staff Housing names its own English stored form', real.rawOf('Staff Housing').includes('Staff Housing'));

// mutation proofs — the predicate must see the 2026-11-04 defect when it is planted again
const without = (c: string, en: string): Maps => ({ ...real, rawOf: (x) => (x === c ? real.rawOf(x).filter((r) => r !== en) : real.rawOf(x)) });
mustCatch('Compound dropped from Residential Building (the live defect)', violations(without('Residential Building', 'Compound')).some((s) => s.includes("'Compound'")));
mustCatch('Staff Housing dropped from its own chip', violations(without('Staff Housing', 'Staff Housing')).some((s) => s.includes("'Staff Housing'")));
mustCatch('a NEW English type mapped into a chip without a rawTypes entry', violations({ ...real, enToAr: { ...EN_TO_AR, 'Tower Block': 'عمارة' } }).some((s) => s.includes("'Tower Block'")));
check('(negative control) an English type whose label no chip counts is not a violation', violations({ ...real, enToAr: { 'Nowhere': 'لا يوجد' } }).length === 0);
check('(negative control) the real maps with nothing removed stay clean', violations(real).length === 0);

if (failed) { console.error(`\n❌ verify-card-fetch-keeps-what-the-count-counted: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✓ the card fetch asks for every stored type the count counted');
