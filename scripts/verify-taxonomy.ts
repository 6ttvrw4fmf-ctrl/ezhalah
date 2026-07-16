#!/usr/bin/env -S node --import tsx
// ─────────────────────────────────────────────────────────────────────────────────────────
// TAXONOMY BUILD GATE — OFFLINE, DETERMINISTIC, NETWORK-FREE.
// Runs before every production build (`npm run verify` → vercel.json buildCommand → also in
// scripts/safe-deploy.sh preflight). No DB, no network, so it can only fail on the CODE being
// deployed, never on live-data drift or a Supabase blip. Exits non-zero on ANY drift.
//
// It enforces two independent properties:
//
//   LAYER 0 — MAP INTEGRITY (a property of the current propertyTypes.ts, from before Stage 1):
//     A. every clean type resolves to ≥1 Arabic label; every type_ar maps to exactly ONE clean type
//        except the documented «عمارة»/Building ambiguity (resolved by source-table kind).
//     B. the committed sql/known_type_ar.generated.sql (the DB allowlist the daily cron alarm uses)
//        equals what the current map produces — so editing the map without regenerating the seed fails.
//
//   LAYER 1 — SINGLE SOURCE (Stage 1): src/data/taxonomy.source.json REGENERATES every artifact, and
//     the generated form is asserted BYTE/VALUE-identical to what is deployed today:
//        TS   : RAW_TO_CLEAN, CLEAN_MACRO, CLEAN_TO_QUERY, EN_TO_AR, CLEAN_TO_TYPE_AR  (value-identity)
//        TS   : normalizeType() over every known raw × {res,com}                        (behaviour-identity)
//        DB   : sql/{known_type_ar,type_label_ar,known_property_types}.generated.sql    (BYTE-identity vs committed)
//        PY   : TYPE_MAP_AR / SLUG_TO_TYPE / residential_set statically parsed from normalize.py  (value-identity)
//               — pure TypeScript, NO external interpreter / subprocess; fails CLOSED on parse error or drift.
//        + a cross-layer disagreement audit that must be PRESERVED (not resolved) — see §F.
//     The DB check compares against the COMMITTED generated .sql snapshots (never a live query), so the
//     build stays fully offline. Those snapshots were byte-generated to match the current live rows,
//     verified read-only once at authoring time.
//
// Stage 1 is ADDITIVE: no runtime file changes. The gate READS the current artifacts and asserts
// equality — it never rewrites them. `--emit-sql` regenerates the three committed seed snapshots from
// the source (owner applies them to the DB LATER; nothing is applied by this script).
//
// Regenerate seeds:   npm run verify:emit-sql
// Rebuild the source: npx tsx scripts/taxonomy/extract.ts
// ─────────────────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLEAN_TO_TYPE_AR, ALL_CLEAN_TYPES, CLEAN_MACRO, CLEAN_TO_QUERY, normalizeType,
} from '../src/data/propertyTypes';
import { readInternalMaps } from './taxonomy/readInternal';
import { readNormalizePyMaps } from './taxonomy/readNormalizePy';
import {
  loadSource, genRawToClean, genCleanMacro, genCleanToQuery, genEnToAr, genCleanToTypeAr,
  genAllSeedSql, genPythonMaps, SQL_DIR,
} from './taxonomy/gen';

const KNOWN_TYPE_AR_SEED = resolve(SQL_DIR, 'known_type_ar.generated.sql');

let failures = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => { console.error(`  ✗ FAIL: ${m}`); failures++; };

// NFC-normalize deeply so byte-variant Arabic (e.g. the shadda studio key) compares by canonical form.
const nfc = (x: any): any => typeof x === 'string' ? x.normalize('NFC')
  : Array.isArray(x) ? x.map(nfc)
  : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k.normalize('NFC'), nfc(v)])) : x;
const canon = (x: any): string => JSON.stringify(nfc(x));

function eqMap(name: string, gen: Record<string, any>, truth: Record<string, any>): void {
  const G = nfc(gen), T = nfc(truth);
  const diffs: string[] = [];
  for (const k of new Set([...Object.keys(G), ...Object.keys(T)])) {
    if (!(k in G)) diffs.push(`    missing in generated: «${k}»`);
    else if (!(k in T)) diffs.push(`    extra in generated:   «${k}»`);
    else if (canon(G[k]) !== canon(T[k])) diffs.push(`    «${k}»: gen=${canon(G[k])} deployed=${canon(T[k])}`);
  }
  if (diffs.length) bad(`${name} — ${diffs.length} key(s) differ:\n${diffs.join('\n')}`);
  else ok(`${name}: ${Object.keys(T).length} keys value-identical to deployed`);
}

// ── LAYER 0: current-map integrity (independent of the source) ────────────────────────────────
const GROUPING_PSEUDO_TYPES = new Set(['Service Facilities']);
const ALLOWED_MULTI_MAP: Record<string, string[]> = { 'عمارة': ['Commercial Building', 'Residential Building'] };

function buildRev(): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const clean of Object.keys(CLEAN_TO_TYPE_AR)) {
    if (GROUPING_PSEUDO_TYPES.has(clean)) continue;
    for (const label of CLEAN_TO_TYPE_AR[clean]) {
      const arr = rev.get(label) ?? [];
      if (!arr.includes(clean)) arr.push(clean);
      rev.set(label, arr);
    }
  }
  return rev;
}
const macroFor = (cleans: string[]): string => {
  const macros = new Set(cleans.map((c) => CLEAN_MACRO[c]).filter(Boolean));
  return macros.size === 1 ? [...macros][0] : 'both';
};

function checkStatic(rev: Map<string, string[]>): void {
  const empties = ALL_CLEAN_TYPES.filter((c) => !(CLEAN_TO_TYPE_AR[c]?.length));
  if (empties.length) bad(`clean type(s) with no Arabic type_ar label (unqueryable): ${empties.join(', ')}`);
  const offenders: string[] = [];
  for (const [label, cleans] of rev) {
    if (cleans.length === 1) continue;
    const allowed = ALLOWED_MULTI_MAP[label];
    const okMulti = allowed && [...cleans].sort().join('|') === [...allowed].sort().join('|');
    if (!okMulti) offenders.push(`«${label}» → {${cleans.join(', ')}}`);
  }
  if (offenders.length)
    bad(`type_ar label(s) map to >1 clean type without a documented resolver:\n   ${offenders.join('\n   ')}`);
  if (!empties.length && !offenders.length)
    ok(`static: ${ALL_CLEAN_TYPES.length} clean types, ${rev.size} distinct type_ar labels, each maps to exactly one clean type (allowed ambiguity: «عمارة»)`);
}

function parseSeedPairs(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of sql.matchAll(/\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/g))
    out.set(m[1].replace(/''/g, "'"), m[2].replace(/''/g, "'"));
  return out;
}

function checkSnapshot(rev: Map<string, string[]>): void {
  if (!existsSync(KNOWN_TYPE_AR_SEED)) {
    bad(`missing sql/known_type_ar.generated.sql — run \`npm run verify:emit-sql\` and commit it.`);
    return;
  }
  const seed = parseSeedPairs(readFileSync(KNOWN_TYPE_AR_SEED, 'utf8'));
  const problems: string[] = [];
  for (const [label, cleans] of rev) {
    const want = macroFor(cleans);
    if (!seed.has(label)) problems.push(`+ map added, snapshot missing: «${label}»`);
    else if (seed.get(label) !== want) problems.push(`≠ macro drift: «${label}» snapshot=${seed.get(label)} map=${want}`);
  }
  for (const label of seed.keys()) if (!rev.has(label)) problems.push(`- map dropped, snapshot stale: «${label}»`);
  if (problems.length)
    bad(`sql/known_type_ar.generated.sql out of sync with propertyTypes.ts (DB allowlist would drift):\n   ` +
      problems.join('\n   ') + `\n   FIX: run \`npm run verify:emit-sql\`, commit, and re-apply to the DB.`);
  else ok(`snapshot: sql/known_type_ar.generated.sql matches the map exactly (${seed.size} labels incl. macro)`);
}

// ── --emit-sql: regenerate the three committed seed snapshots FROM THE SOURCE ──────────────────
function emitSeeds(): void {
  const seeds = genAllSeedSql(loadSource());
  for (const [name, sql] of Object.entries(seeds)) {
    const path = resolve(SQL_DIR, name);
    writeFileSync(path, sql, 'utf8');
    console.log(`✓ emitted sql/${name} (${sql.length} bytes)`);
  }
  console.log('\nSeeds regenerated from src/data/taxonomy.source.json. Review, commit, then the OWNER applies them to the DB.');
}

function main(): void {
  if (process.argv.includes('--emit-sql')) { emitSeeds(); return; }

  const s = loadSource();
  const { RAW_TO_CLEAN, EN_TO_AR } = readInternalMaps();

  console.log('=== LAYER 0. Current-map integrity (src/data/propertyTypes.ts) ===');
  const rev = buildRev();
  checkStatic(rev);
  checkSnapshot(rev);

  console.log('\n=== LAYER 1.A  TS maps: generated-from-source == deployed propertyTypes.ts ===');
  eqMap('RAW_TO_CLEAN', genRawToClean(s), RAW_TO_CLEAN);
  eqMap('CLEAN_MACRO', genCleanMacro(s), CLEAN_MACRO as any);
  eqMap('CLEAN_TO_QUERY', genCleanToQuery(s), CLEAN_TO_QUERY as any);
  eqMap('EN_TO_AR', genEnToAr(s), EN_TO_AR);
  eqMap('CLEAN_TO_TYPE_AR', genCleanToTypeAr(s), CLEAN_TO_TYPE_AR as any);

  console.log('\n=== LAYER 1.B  TS behaviour: normalizeType() over every known raw × {res,com} ===');
  {
    const raws = new Set<string>([s.buildingAmbiguous.raw]);
    for (const e of s.cleanTypes) for (const r of e.query.rawTypes) raws.add(r);
    const genRTC = genRawToClean(s), genMacro = genCleanMacro(s), b = s.buildingAmbiguous;
    let mismatch = 0; const ex: string[] = [];
    for (const r of raws) for (const kind of ['res', 'com'] as const) {
      const deployed = normalizeType(r, kind);
      let clean: string, macro: string;
      if (r === b.raw) { clean = kind === 'com' ? b.com : b.res; macro = kind === 'com' ? 'Commercial' : 'Residential'; }
      else { clean = genRTC[r]; macro = genMacro[clean]; }
      if (clean !== deployed.clean || macro !== deployed.macro) {
        mismatch++; if (ex.length < 8) ex.push(`    «${r}»/${kind}: gen={${macro},${clean}} deployed={${deployed.macro},${deployed.clean}}`);
      }
    }
    if (mismatch) bad(`normalizeType diverged on ${mismatch} (raw,kind) pair(s):\n${ex.join('\n')}`);
    else ok(`normalizeType identical for all ${raws.size} raws × 2 kinds = ${raws.size * 2} cases`);
  }

  console.log('\n=== LAYER 1.C  DB seeds: generated-from-source == committed sql/*.generated.sql (BYTE) ===');
  for (const [name, gsql] of Object.entries(genAllSeedSql(s))) {
    const path = resolve(SQL_DIR, name);
    if (!existsSync(path)) { bad(`sql/${name} missing — run \`npm run verify:emit-sql\` and commit it.`); continue; }
    const committed = readFileSync(path, 'utf8');
    if (gsql === committed) ok(`sql/${name}: byte-identical (${gsql.length} bytes)`);
    else {
      const g = gsql.split('\n'), c = committed.split('\n'); const diffs: string[] = [];
      for (let i = 0; i < Math.max(g.length, c.length); i++)
        if (g[i] !== c[i]) { diffs.push(`    L${i + 1}: gen=${JSON.stringify(g[i])} committed=${JSON.stringify(c[i])}`); if (diffs.length >= 10) break; }
      bad(`sql/${name} byte diff (run \`npm run verify:emit-sql\`):\n${diffs.join('\n')}`);
    }
  }

  console.log('\n=== LAYER 1.D  Python maps: generated-from-source == scrapers/common/normalize.py (hermetic pure-TS static parse — no external interpreter) ===');
  {
    const gen = genPythonMaps(s);
    let py: ReturnType<typeof readNormalizePyMaps> | null = null;
    try {
      py = readNormalizePyMaps();
    } catch (e: any) {
      // Parse failure (malformed literal, missing/renamed map, unterminated string, …) FAILS CLOSED.
      // There is no interpreter fallback and no graceful-degrade path — a broken read blocks the build.
      bad(`normalize.py static parse failed (fail-closed, no skip): ${e?.message ?? e}`);
    }
    if (py) {
      // Self-check: the KNOWN shapes of normalize.py. Asserting the exact counts BEFORE any value
      // comparison means a parser bug that silently drops entries — or a deleted/renamed map — can
      // never pass unnoticed.
      const counts: [string, number, number][] = [
        // 27 → 35 on 2026-07-16 (fix/normalize-unification): 8 Arabic aliases promoted verbatim from
        // the eastabha/mustqr private maps into TYPE_MAP_AR (+ taxonomy.source.json python.typeMapAr).
        ['TYPE_MAP_AR', Object.keys(py.TYPE_MAP_AR).length, 35],
        ['SLUG_TO_TYPE', Object.keys(py.SLUG_TO_TYPE).length, 26],
        ['residential_set', py.residential_set.length, 10],
      ];
      let countOk = true;
      for (const [n, got, want] of counts)
        if (got !== want) { bad(`normalize.py ${n}: parsed ${got} entries, expected ${want} (parser bug or map drift)`); countOk = false; }
      if (countOk) ok('normalize.py shapes self-check: TYPE_MAP_AR(35), SLUG_TO_TYPE(26), residential_set(10) — parsed statically, zero external interpreter');

      // Value-equality vs the source-generated Python maps (NFC-normalized, order-independent).
      eqMap('normalize.py TYPE_MAP_AR', gen.TYPE_MAP_AR, py.TYPE_MAP_AR);
      eqMap('normalize.py SLUG_TO_TYPE', gen.SLUG_TO_TYPE, py.SLUG_TO_TYPE);

      const genSet = [...gen.residential_set].map((x) => x.normalize('NFC')).sort();
      const pySet = [...py.residential_set].map((x) => x.normalize('NFC')).sort();
      if (canon(genSet) !== canon(pySet)) bad(`normalize.py residential_set drift: gen=${canon(genSet)} normalize.py=${canon(pySet)}`);
      else ok(`normalize.py residential_set: ${pySet.length} members value-identical to source`);

      if (gen.category_default.normalize('NFC') !== py.category_default.normalize('NFC'))
        bad(`normalize.py category_default drift: gen=«${gen.category_default}» normalize.py=«${py.category_default}»`);
      else ok(`normalize.py category_default: «${py.category_default}» identical to source`);
    }
  }

  console.log('\n=== LAYER 1.F  Cross-layer disagreement audit (must be PRESERVED, not resolved) ===');
  {
    const pyResidential = new Set(s.python.residentialSet);
    const pyCat = (t: string) => pyResidential.has(t) ? 'Residential' : s.python.categoryDefault;
    const pyEmits = new Set<string>([...s.python.typeMapAr.map(([, en]) => en), ...s.python.slugToType.map(([, en]) => en)]);
    const rows: string[] = [];
    for (const e of s.cleanTypes) {
      if (pyCat(e.clean) === e.macro) continue;
      const preserved = e.pythonCategoryOverride === pyCat(e.clean);
      const scope = pyEmits.has(e.clean) ? 'ACTIVE ' : 'latent ';
      rows.push(`    ${scope}«${e.clean}» (${s.labels[e.clean] ?? '—'}): TS/DB=${e.macro}  Python=${pyCat(e.clean)}  ` +
        `override=${e.pythonCategoryOverride ?? 'none'}  ${preserved ? 'PRESERVED ✓' : 'NOT PRESERVED ✗'}`);
      if (!preserved) bad(`disagreement on «${e.clean}» not captured by pythonCategoryOverride`);
    }
    const bPy = pyResidential.has(s.buildingAmbiguous.raw) ? 'Residential' : s.python.categoryDefault;
    rows.push(`    «Building» (raw, ${s.buildingAmbiguous.labelAr}): Python=${bPy} (always)  ` +
      `TS=kind-resolved → ${s.buildingAmbiguous.res}/${s.buildingAmbiguous.com}  [documented ambiguity]`);
    console.log(rows.join('\n'));
    if (!failures) ok('all cross-layer disagreements are recorded and reproduced unchanged');
  }

  console.log(`\n${'='.repeat(74)}`);
  if (failures === 0) {
    console.log('✅ TAXONOMY GATE PASSED — one source (taxonomy.source.json) regenerates the TS maps,');
    console.log('   normalize.py maps, and all 3 DB seeds with ZERO drift; the deployed map is consistent.');
  } else {
    console.error(`❌ TAXONOMY GATE FAILED — ${failures} artifact(s) drifted (see above). Deployment blocked.`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
