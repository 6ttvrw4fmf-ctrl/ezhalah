// ─────────────────────────────────────────────────────────────────────────────────────────
// GENERATOR: canonical source (src/data/taxonomy.source.json) -> every downstream taxonomy artifact.
//
// Pure function of the JSON source. Imports NOTHING from propertyTypes.ts / normalize.py, so the
// offline gate (scripts/verify-taxonomy.ts) is a genuine regeneration, not a copy. Emits:
//   • the in-memory TS map shapes  (RAW_TO_CLEAN, CLEAN_MACRO, CLEAN_TO_QUERY, EN_TO_AR, CLEAN_TO_TYPE_AR)
//   • the Python map shapes         (TYPE_MAP_AR, SLUG_TO_TYPE, residential_set, category_default)
//   • the three DB seed .sql files  (known_type_ar, type_label_ar, known_property_types)
//
// Stage 1 is ADDITIVE: today these generated shapes are ASSERTED equal to the deployed artifacts;
// the runtime files are NOT yet switched to import them (that is the deferred Stage-1b PR).
// ─────────────────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCE_PATH = resolve(HERE, '../../src/data/taxonomy.source.json');
export const SQL_DIR = resolve(HERE, '../../sql');

export type Macro = 'Residential' | 'Commercial';
export type Kind = 'res' | 'com';
export interface CleanEntry {
  clean: string; macro: Macro;
  hierarchy: { macro: Macro; group: string } | null;
  serviceFacility: boolean;
  query: { rawTypes: string[]; kinds: Kind[]; extraTables?: string[] };
  pythonCategoryOverride: Macro | null;
}
export interface Source {
  labels: Record<string, string>;
  buildingAmbiguous: { raw: string; res: string; com: string; labelAr: string };
  serviceFacilityOrder: string[];
  cleanTypes: CleanEntry[];
  python: { typeMapAr: [string, string][]; slugToType: [string, string][]; residentialSet: string[]; categoryDefault: string };
}

export function loadSource(): Source {
  return JSON.parse(readFileSync(SOURCE_PATH, 'utf8')) as Source;
}

// ── TS layer ────────────────────────────────────────────────────────────────────────────────
export function genRawToClean(s: Source): Record<string, string> {
  // RAW_TO_CLEAN = every query rawType (except the kind-resolved «Building») -> its clean type.
  const out: Record<string, string> = {};
  for (const e of s.cleanTypes)
    for (const r of e.query.rawTypes)
      if (r !== s.buildingAmbiguous.raw) out[r] = e.clean;
  return out;
}
export function genCleanMacro(s: Source): Record<string, Macro> {
  const out: Record<string, Macro> = {};
  for (const e of s.cleanTypes) out[e.clean] = e.macro;
  return out;
}
export function genCleanToQuery(s: Source): Record<string, CleanEntry['query']> {
  const out: Record<string, CleanEntry['query']> = {};
  for (const e of s.cleanTypes) out[e.clean] = e.query;
  // «Service Facilities» derived box (mirrors propertyTypes.ts exactly).
  const byClean = Object.fromEntries(s.cleanTypes.map((e) => [e.clean, e]));
  out['Service Facilities'] = {
    rawTypes: s.serviceFacilityOrder.flatMap((t) => byClean[t]?.query.rawTypes ?? []),
    kinds: ['res', 'com'],
  };
  return out;
}
export function genEnToAr(s: Source): Record<string, string> {
  return s.labels;
}
// CLEAN_TO_TYPE_AR — the SAME derivation propertyTypes.ts performs (EN_TO_AR ?? raw, NFC, dedup).
export function genCleanToTypeAr(s: Source): Record<string, string[]> {
  const q = genCleanToQuery(s);
  const labels = s.labels;
  const out: Record<string, string[]> = {};
  for (const clean of Object.keys(q)) {
    const set = new Set<string>();
    for (const raw of q[clean].rawTypes) set.add((labels[raw] ?? raw).normalize('NFC'));
    out[clean] = [...set];
  }
  return out;
}

// ── DB layer (row shapes) ─────────────────────────────────────────────────────────────────────
export function genTypeLabelAr(s: Source): { en: string; ar: string }[] {
  return Object.entries(s.labels).map(([en, ar]) => ({ en, ar }))
    .sort((a, b) => (a.en < b.en ? -1 : a.en > b.en ? 1 : a.ar < b.ar ? -1 : 1));
}
export function genKnownPropertyTypes(s: Source): string[] {
  // NFC-dedup of every raw alias (RAW_TO_CLEAN keys) plus the ambiguous «Building».
  const set = new Set<string>();
  for (const e of s.cleanTypes) for (const r of e.query.rawTypes) if (r !== s.buildingAmbiguous.raw) set.add(r.normalize('NFC'));
  set.add(s.buildingAmbiguous.raw.normalize('NFC'));
  return [...set];
}
// known_type_ar: every distinct type_ar label -> owning macro (Residential/Commercial/both).
// Built from CLEAN_TO_TYPE_AR reversed, exactly like the coverage tripwire, so «عمارة» becomes 'both'.
export function genKnownTypeAr(s: Source): { type_ar: string; macro: string }[] {
  const cleanToAr = genCleanToTypeAr(s);
  const macroByClean = genCleanMacro(s);
  const GROUPING = new Set(['Service Facilities']);
  const rev = new Map<string, Set<string>>();
  for (const clean of Object.keys(cleanToAr)) {
    if (GROUPING.has(clean)) continue;
    for (const label of cleanToAr[clean]) {
      const set = rev.get(label) ?? new Set<string>();
      set.add(clean);
      rev.set(label, set);
    }
  }
  const rows: { type_ar: string; macro: string }[] = [];
  for (const [label, cleans] of rev) {
    const macros = new Set([...cleans].map((c) => macroByClean[c]).filter(Boolean));
    rows.push({ type_ar: label, macro: macros.size === 1 ? [...macros][0] : 'both' });
  }
  return rows.sort((a, b) => (a.type_ar < b.type_ar ? -1 : 1));
}

// ── DB layer (serialized seed .sql, byte-checked by the gate) ──────────────────────────────────
const sq = (str: string) => `'${str.replace(/'/g, "''")}'`;

// sql/known_type_ar.generated.sql — the DB allowlist detect_novel_property_types() (pg_cron jobid 33)
// + the Residential/Commercial trust checks read. Header/format are kept IDENTICAL to the historical
// `verify-taxonomy.ts --emit-sql` output so this stays byte-for-byte equal to the committed seed.
export function genKnownTypeArSql(s: Source): string {
  const rows = genKnownTypeAr(s);
  const values = rows.map((r) => `  (${sq(r.type_ar)}, ${sq(r.macro)})`).join(',\n');
  return `-- GENERATED by ezhalah-app/scripts/verify-taxonomy.ts --emit-sql — DO NOT EDIT BY HAND.
-- Source of truth: ezhalah-app/src/data/propertyTypes.ts (CLEAN_TO_TYPE_AR + CLEAN_MACRO). Regenerate
-- after any change to the clean-type map, then re-apply so detect_novel_property_types() (pg_cron
-- jobid 33) and the trust checks stay in sync with what the app can actually reach.
-- macro = which category owns the label: Residential | Commercial | both («عمارة» only — resolved by
-- source-table kind at read time). ${rows.length} covered type_ar labels.
create table if not exists public.known_type_ar (type_ar text primary key, macro text);
alter table public.known_type_ar add column if not exists macro text;  -- upgrade path from 1-col shape
-- Full re-sync: the generated set is authoritative.
truncate public.known_type_ar;
insert into public.known_type_ar (type_ar, macro) values
${values};
notify pgrst, 'reload schema';
`;
}

// sql/type_label_ar.generated.sql — the canonical EN->AR display-label map. Full authoritative
// re-sync (truncate + insert), rows ordered by (en, ar) for a stable, deterministic byte form.
export function genTypeLabelArSql(s: Source): string {
  const rows = genTypeLabelAr(s);
  const values = rows.map((r) => `  (${sq(r.en)}, ${sq(r.ar)})`).join(',\n');
  return `-- GENERATED by ezhalah-app/scripts/verify-taxonomy.ts --emit-sql — DO NOT EDIT BY HAND.
-- Source of truth: ezhalah-app/src/data/taxonomy.source.json (labels: EN token -> canonical Arabic
-- label; identical to propertyTypes.ts EN_TO_AR). Regenerate with \`npm run verify:emit-sql\`, then
-- re-apply so the Arabic display label the app resolves for each English type stays in sync with the DB.
-- Full re-sync: the generated set is authoritative. ${rows.length} canonical EN->AR type labels.
create table if not exists public.type_label_ar (en text primary key, ar text not null);
truncate public.type_label_ar;
insert into public.type_label_ar (en, ar) values
${values};
notify pgrst, 'reload schema';
`;
}

// sql/known_property_types.generated.sql — the discovery allowlist detect_novel_property_types()
// (pg_cron jobid 33) diffs live data against. APPEND-ONLY: ON CONFLICT DO NOTHING preserves each
// existing row's added_at / note, so applying the seed never resets discovery history. Rows sorted
// for a stable, deterministic byte form (the DB is a set — order is cosmetic).
export function genKnownPropertyTypesSql(s: Source): string {
  const rows = [...genKnownPropertyTypes(s)].sort();
  const values = rows.map((r) => `  (${sq(r)})`).join(',\n');
  return `-- GENERATED by ezhalah-app/scripts/verify-taxonomy.ts --emit-sql — DO NOT EDIT BY HAND.
-- Source of truth: ezhalah-app/src/data/taxonomy.source.json (every raw alias in cleanTypes[].query.rawTypes
-- plus the ambiguous «Building» raw; identical to the propertyTypes.ts RAW_TO_CLEAN key set + «Building»).
-- This is the discovery allowlist detect_novel_property_types() (pg_cron jobid 33) diffs live data
-- against; a raw type absent here is flagged as novel. APPEND-ONLY: existing rows' added_at / note are
-- preserved (ON CONFLICT DO NOTHING), so applying this never resets discovery history. ${rows.length} known raw aliases.
create table if not exists public.known_property_types (
  raw_type text primary key,
  added_at timestamptz not null default now(),
  note text
);
insert into public.known_property_types (raw_type) values
${values}
on conflict (raw_type) do nothing;
notify pgrst, 'reload schema';
`;
}

// The three committed seed snapshots, keyed by their file basename in sql/.
export function genAllSeedSql(s: Source): Record<string, string> {
  return {
    'known_type_ar.generated.sql': genKnownTypeArSql(s),
    'type_label_ar.generated.sql': genTypeLabelArSql(s),
    'known_property_types.generated.sql': genKnownPropertyTypesSql(s),
  };
}

// ── Python layer ──────────────────────────────────────────────────────────────────────────────
// Emit the SAME data structures normalize.py hardcodes, so the gate can value-compare them (order-
// independent, NFC) against what readNormalizePy.ts parses STATICALLY out of normalize.py — pure TS,
// no external interpreter. residentialSet is the Python-layer allowlist.
export function genPythonMaps(s: Source): { TYPE_MAP_AR: Record<string, string>; SLUG_TO_TYPE: Record<string, string>; residential_set: string[]; category_default: string } {
  return {
    TYPE_MAP_AR: Object.fromEntries(s.python.typeMapAr),
    SLUG_TO_TYPE: Object.fromEntries(s.python.slugToType),
    residential_set: s.python.residentialSet,
    category_default: s.python.categoryDefault,
  };
}
