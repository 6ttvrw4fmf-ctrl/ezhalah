#!/usr/bin/env -S node --import tsx
// ─────────────────────────────────────────────────────────────────────────────────────────
// TAXONOMY COVERAGE TRIPWIRE — OFFLINE (search-correctness invariant #1, build-time half)
//
// Runs before every production build (`npm run verify` → vercel.json buildCommand). Deterministic and
// fully OFFLINE — no DB, no network — so it can only fail on the CODE being deployed, never on live-data
// drift or a Supabase blip. (The LIVE half — "does today's data contain an unmapped type_ar?" — is NOT a
// property of a deploy; it's checked continuously by the daily cron alarm detect_novel_property_types(),
// which is the right place. See docs/ARCHITECTURE.md §19.1.)
//
// WHAT THIS GUARDS (both are about the code, so blocking the deploy is correct):
//   A. MAP INTEGRITY — every clean type resolves to ≥1 Arabic label; every type_ar maps to exactly ONE
//      clean type except the documented «عمارة»/Building ambiguity (resolved by source-table kind).
//   B. SNAPSHOT SYNC — the committed sql/known_type_ar.generated.sql (the DB allowlist the cron alarm uses)
//      exactly equals what the current map produces. So editing propertyTypes.ts without regenerating —
//      which would let the DB alarm's allowlist drift from what the app can actually reach — fails the
//      build with a clear "run npm run verify:emit-sql and re-apply the seed" message.
//
// Regenerate the snapshot with:  npm run verify:emit-sql   (then re-apply the seed to the DB).
// [[filter-candidate-cap-underreturn-2026-07-08]]
// ─────────────────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLEAN_TO_TYPE_AR, ALL_CLEAN_TYPES, CLEAN_MACRO } from '../src/data/propertyTypes';

const SEED_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../sql/known_type_ar.generated.sql');

const fail = (msg: string): never => {
  console.error(`\n❌ TAXONOMY TRIPWIRE FAILED: ${msg}\n   Deployment blocked until fixed.`);
  process.exit(1);
};

// «Service Facilities» is a FILTER-ONLY grouping box, not a leaf/DB clean type — it re-exposes the 5
// facility types that already exist as their own clean types. Counting it would falsely make those 5
// labels look multi-mapped, so it's excluded from the "exactly one clean type" measurement.
const GROUPING_PSEUDO_TYPES = new Set(['Service Facilities']);

// The ONLY label allowed to map to >1 clean type: «عمارة» (Building) — residential on most platforms,
// commercial on a few — resolved deterministically by source-table kind in normalizeType(). Any OTHER
// multi-mapping is an accidental collision that makes macro/table routing nondeterministic → fail.
const ALLOWED_MULTI_MAP: Record<string, string[]> = {
  'عمارة': ['Commercial Building', 'Residential Building'],
};

// The canonical covered set (leaf clean types only) + reverse map, from the single source of truth.
function build(): { covered: Set<string>; rev: Map<string, string[]> } {
  const rev = new Map<string, string[]>();
  for (const clean of Object.keys(CLEAN_TO_TYPE_AR)) {
    if (GROUPING_PSEUDO_TYPES.has(clean)) continue;
    for (const label of CLEAN_TO_TYPE_AR[clean]) {
      const arr = rev.get(label) ?? [];
      if (!arr.includes(clean)) arr.push(clean);
      rev.set(label, arr);
    }
  }
  return { covered: new Set(rev.keys()), rev };
}

// Which macro category a type_ar label belongs to, from its owning clean type(s): 'Residential',
// 'Commercial', or 'both' (only «عمارة»/Building — resolved by source-table kind at read time).
// Powers the DB-side trust check "Residential/Commercial search covers ALL its types" — same single
// source of truth (CLEAN_MACRO), never hand-maintained.
function macroFor(cleans: string[]): string {
  const macros = new Set(cleans.map((c) => CLEAN_MACRO[c]).filter(Boolean));
  return macros.size === 1 ? [...macros][0] : 'both';
}

// ── CHECK A: static map integrity ──────────────────────────────────────────────────────────
function checkStatic(rev: Map<string, string[]>): void {
  const empties = ALL_CLEAN_TYPES.filter((c) => !(CLEAN_TO_TYPE_AR[c]?.length));
  if (empties.length) fail(`clean type(s) with no Arabic type_ar label (unqueryable): ${empties.join(', ')}`);

  const offenders: string[] = [];
  for (const [label, cleans] of rev) {
    if (cleans.length === 1) continue;
    const allowed = ALLOWED_MULTI_MAP[label];
    const ok = allowed && [...cleans].sort().join('|') === [...allowed].sort().join('|');
    if (!ok) offenders.push(`«${label}» → {${cleans.join(', ')}}`);
  }
  if (offenders.length)
    fail(`type_ar label(s) map to >1 clean type without a documented resolver (ambiguous macro/table routing):\n   ${offenders.join('\n   ')}`);

  console.log(`✓ static: ${ALL_CLEAN_TYPES.length} clean types, ${rev.size} distinct type_ar labels, each maps to exactly one clean type (allowed ambiguity: «عمارة»)`);
}

// ── CHECK B: committed snapshot == current map ───────────────────────────────────────────────
// Parse (label, macro) pairs out of the generated seed and compare to what the map produces now.
function parseSeedPairs(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of sql.matchAll(/\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/g))
    out.set(m[1].replace(/''/g, "'"), m[2].replace(/''/g, "'"));
  return out;
}

function checkSnapshot(rev: Map<string, string[]>): void {
  if (!existsSync(SEED_PATH))
    fail(`missing sql/known_type_ar.generated.sql — run \`npm run verify:emit-sql\` and commit it (the DB alarm's allowlist).`);
  const seed = parseSeedPairs(readFileSync(SEED_PATH, 'utf8'));
  const problems: string[] = [];
  for (const [label, cleans] of rev) {
    const want = macroFor(cleans);
    if (!seed.has(label)) problems.push(`+ map added, snapshot missing: «${label}»`);
    else if (seed.get(label) !== want) problems.push(`≠ macro drift: «${label}» snapshot=${seed.get(label)} map=${want}`);
  }
  for (const label of seed.keys())
    if (!rev.has(label)) problems.push(`- map dropped, snapshot stale: «${label}»`);
  if (problems.length)
    fail(
      `sql/known_type_ar.generated.sql is out of sync with propertyTypes.ts — the DB allowlist would drift.\n   ` +
        problems.join('\n   ') +
        `\n   FIX: run \`npm run verify:emit-sql\`, commit the file, and re-apply it to the DB.`,
    );
  console.log(`✓ snapshot: sql/known_type_ar.generated.sql matches the map exactly (${seed.size} labels incl. macro)`);
}

// ── SQL allowlist generator (--emit-sql) ─────────────────────────────────────────────────────
function emitSql(rev: Map<string, string[]>): void {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const values = [...rev.keys()].sort()
    .map((l) => `  (${q(l)}, ${q(macroFor(rev.get(l)!))})`).join(',\n');
  const sql = `-- GENERATED by ezhalah-app/scripts/verify-taxonomy.ts --emit-sql — DO NOT EDIT BY HAND.
-- Source of truth: ezhalah-app/src/data/propertyTypes.ts (CLEAN_TO_TYPE_AR + CLEAN_MACRO). Regenerate
-- after any change to the clean-type map, then re-apply so detect_novel_property_types() (pg_cron
-- jobid 33) and the trust checks stay in sync with what the app can actually reach.
-- macro = which category owns the label: Residential | Commercial | both («عمارة» only — resolved by
-- source-table kind at read time). ${rev.size} covered type_ar labels.
create table if not exists public.known_type_ar (type_ar text primary key, macro text);
alter table public.known_type_ar add column if not exists macro text;  -- upgrade path from 1-col shape
-- Full re-sync: the generated set is authoritative.
truncate public.known_type_ar;
insert into public.known_type_ar (type_ar, macro) values
${values};
notify pgrst, 'reload schema';
`;
  writeFileSync(SEED_PATH, sql, 'utf8');
  console.log(`✓ emitted ${rev.size}-label allowlist (with macro) → ${SEED_PATH}`);
}

function main() {
  const { rev } = build();
  if (process.argv.includes('--emit-sql')) { emitSql(rev); return; }
  checkStatic(rev);
  checkSnapshot(rev);
  console.log('\n✅ Taxonomy tripwire passed (offline) — map is internally consistent and the DB allowlist snapshot is in sync.');
}

main();
