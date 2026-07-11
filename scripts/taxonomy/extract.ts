#!/usr/bin/env -S node --import tsx
// ─────────────────────────────────────────────────────────────────────────────────────────
// ONE-TIME source builder (NOT part of the build gate; kept for reproducibility / re-derivation).
//
// Assembles the canonical `src/data/taxonomy.source.json` FROM the artifacts that exist today, by
// reflection, so the source is grounded in the EXACT deployed values with zero transcription drift.
// After this has run once and the source is committed, the generator (gen.ts) and the gate
// (verify-taxonomy.ts) read ONLY the JSON — never the current artifacts — so the round-trip they
// prove is a real regeneration, and this file is only re-run if the taxonomy is deliberately changed.
//
// Run with:  npx tsx scripts/taxonomy/extract.ts    (then review the diff and commit the JSON).
// ─────────────────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInternalMaps } from './readInternal';
import { readNormalizePyMaps } from './readNormalizePy';
import {
  HIERARCHY, CLEAN_MACRO, CLEAN_TO_QUERY, ALL_CLEAN_TYPES, SERVICE_FACILITY_TYPES,
  type Macro,
} from '../../src/data/propertyTypes';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../src/data/taxonomy.source.json');

const { RAW_TO_CLEAN, EN_TO_AR } = readInternalMaps();

// Python maps, statically parsed from normalize.py in pure TypeScript (no python3, no child_process,
// no scraper code executed). residential_set is sorted here so the emitted source is deterministic.
const pyRaw = readNormalizePyMaps();
const py = { ...pyRaw, residential_set: [...pyRaw.residential_set].sort() };
const pyResidential: string[] = py.residential_set;

// Which HIERARCHY (macro, group) a leaf clean type sits in (null for facility subtypes, which live
// under the derived «Service Facilities» box, not a HIERARCHY group).
function hierarchyOf(clean: string): { macro: Macro; group: string } | null {
  for (const macro of ['Residential', 'Commercial'] as Macro[])
    for (const g of HIERARCHY[macro]) if (g.types.includes(clean)) return { macro, group: g.group };
  return null;
}

// Python's category for an English type == the Residential/Commercial branch of category_for_type.
const pyCategory = (t: string): 'Residential' | 'Commercial' =>
  pyResidential.includes(t) ? 'Residential' : (py.category_default as 'Commercial');

const cleanTypes = ALL_CLEAN_TYPES.map((clean) => {
  const macro = CLEAN_MACRO[clean];
  const q = CLEAN_TO_QUERY[clean];
  // Per-layer override: recorded ONLY when Python's category_for_type disagrees with the canonical
  // macro for this exact English name (preserves the Farm/مزرعة technical debt losslessly).
  const override = pyCategory(clean) !== macro ? pyCategory(clean) : null;
  return {
    clean,
    macro,
    hierarchy: hierarchyOf(clean),
    serviceFacility: SERVICE_FACILITY_TYPES.includes(clean),
    query: { rawTypes: q.rawTypes, kinds: q.kinds, ...(q.extraTables ? { extraTables: q.extraTables } : {}) },
    pythonCategoryOverride: override,
  };
});

const source = {
  $comment:
    'CANONICAL TAXONOMY SOURCE (Stage 1). Single source that GENERATES the TS maps in ' +
    'src/data/propertyTypes.ts, the Python maps in scrapers/common/normalize.py, and the DB seeds ' +
    '(type_label_ar, known_property_types, known_type_ar). Regenerate artifacts with ' +
    'scripts/taxonomy/gen.ts; the offline build gate (scripts/verify-taxonomy.ts) fails the build on ' +
    'any drift. Per-layer overrides preserve current cross-layer disagreements EXACTLY (see ' +
    'pythonCategoryOverride). Rebuild this file with `npx tsx scripts/taxonomy/extract.ts`.',
  $schemaVersion: 1,
  // EN token -> canonical Arabic label. IS the TS EN_TO_AR and the DB type_label_ar, verbatim.
  labels: EN_TO_AR,
  // The one genuinely ambiguous raw string, resolved by source-table kind at read time.
  buildingAmbiguous: { raw: 'Building', res: 'Residential Building', com: 'Commercial Building', labelAr: EN_TO_AR['Building'] },
  serviceFacilityOrder: SERVICE_FACILITY_TYPES,
  cleanTypes,
  // Python-layer vocabularies (Arabic spelling variants + Aqar slugs + the historical residential
  // allowlist). First-class source data — a genuinely different vocabulary from the TS raw aliases,
  // held here ONCE and generated into normalize.py. Order preserved for stable emission.
  python: {
    typeMapAr: Object.entries(py.TYPE_MAP_AR),
    slugToType: Object.entries(py.SLUG_TO_TYPE),
    residentialSet: py.residential_set,
    categoryDefault: py.category_default,
  },
};

writeFileSync(OUT, JSON.stringify(source, null, 2) + '\n', 'utf8');
console.log(`✓ wrote ${OUT}`);
console.log(`  cleanTypes=${cleanTypes.length} labels=${Object.keys(EN_TO_AR).length} ` +
  `rawToClean-keys=${Object.keys(RAW_TO_CLEAN).length} pythonOverrides=${cleanTypes.filter((c) => c.pythonCategoryOverride).map((c) => c.clean).join(',') || 'none'}`);
