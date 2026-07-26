// Automated guard — aqar price_per_meter must stay SOURCE-PUBLISHED, 2026-07-26.
//
// THE BUG THIS PINS
// aqar pages print «سعر المتر» in their structured «تفاصيل الإعلان» spec row.
// scrapers/aqar/enrich_residential.py:141 parse_price_per_meter() extracts it and
// scrapers/common/db.py upserts it — and then the BEFORE INSERT OR UPDATE trigger
// public.trg_aqar_parse() overwrote the column with round(price_total / area_m2), and set it to
// NULL outright whenever there was no total (and on every Rent row). Measured on live ACTIVE rows
// before the fix: 42,758 values the source never printed, 3,479 that contradicted what it did
// print, and 1,077 published rates discarded to NULL. Deriving into a source-named column is
// itself the fidelity violation (CLAUDE.md: never modify/estimate/infer/round listing data).
//
// WHY A MIGRATION-TEXT TEST
// trg_aqar_parse, backfill_aqar_res and mon_detect_price_fidelity lived ONLY in the live database
// (no committed definition anywhere) until migration 20260726120000. That is precisely how the
// derivation survived unnoticed: there was no repo baseline to review or diff. This verifier
// replays the migration directory the way Postgres would — last definition of each object wins —
// and fails if the winning body assigns price_per_meter at all. A future edit that pastes a stale
// body back (the documented "RPC full-body-replace" hazard) therefore breaks the build.
//
// Deliberately OFFLINE (reads only the repo's own migration files, no DB, no network) to match the
// other 24 verifiers chained in `npm test`. The live-data counterpart is the ppm_source_dropped
// monitor added to public.mon_detect_price_fidelity() in the same migration (cron jobid 42).
//
// Run: node --experimental-strip-types scripts/verify-aqar-trigger-preserves-source-ppm.ts
// Exits non-zero on any failure so it can gate CI.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');

// Migrations apply in filename order, so the LAST file defining an object owns its live body.
const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

/**
 * Extract the body of the last `CREATE OR REPLACE FUNCTION|PROCEDURE <name>` across all
 * migrations, sliced from the header to the closing `$function$;` / `$procedure$;` tag.
 */
function lastDefinitionOf(name: string): { file: string; body: string } | null {
  let found: { file: string; body: string } | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    const header = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+(?:FUNCTION|PROCEDURE)\\s+(?:public\\.)?${name}\\s*\\(`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = header.exec(sql)) !== null) {
      const rest = sql.slice(m.index);
      // Body is dollar-quoted; take through the matching closing tag, else to the end of file.
      const close = rest.match(/\$(function|procedure)\$\s*;/i);
      found = { file: f, body: close ? rest.slice(0, close.index! + close[0].length) : rest };
    }
  }
  return found;
}

/** Strip `--` line comments so a comment *mentioning* price_per_meter is not a false positive. */
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

// ── 1. the objects are under version control at all (closes the live-only-drift hole) ──────────
const trigger = lastDefinitionOf('trg_aqar_parse');
ok('trg_aqar_parse has a committed migration definition', trigger !== null,
   'no migration defines it — the live body is unreviewable');

const backfill = lastDefinitionOf('backfill_aqar_res');
ok('backfill_aqar_res has a committed migration definition', backfill !== null,
   'no migration defines it — an operator-run procedure can silently re-derive');

// ── 2. neither winning body may ASSIGN price_per_meter ─────────────────────────────────────────
// Any assignment can only overwrite the source-published value with arithmetic or NULL. Matches
// both PL/pgSQL `NEW.price_per_meter :=` and the SQL `price_per_meter =` UPDATE-SET form.
const ASSIGNS_PPM = /(?:NEW\s*\.\s*)?price_per_meter\s*(?::=|=[^=])/i;

for (const [label, def] of [['trg_aqar_parse', trigger], ['backfill_aqar_res', backfill]] as const) {
  if (!def) continue;
  const code = stripComments(def.body);
  ok(`${label} does not assign price_per_meter (source-published, never derived)`,
     !ASSIGNS_PPM.test(code),
     `${def.file} assigns it: ${(code.match(ASSIGNS_PPM) ?? [''])[0].trim()}`);

  // The specific shape that caused the incident, called out separately for a clearer failure.
  ok(`${label} never divides a price by area_m2`,
     !/round\s*\([^)]*\/\s*(?:NEW\s*\.\s*|t\s*\.\s*)?area_m2/i.test(code),
     `${def.file} still contains a round(price/area_m2) derivation`);
}

// ── 3. the re-extraction helper must read TEXT, never compute from price/area ───────────────────
const extractor = lastDefinitionOf('aqar_published_ppm');
ok('aqar_published_ppm (backfill re-extractor) is committed', extractor !== null);
if (extractor) {
  const code = stripComments(extractor.body);
  ok('aqar_published_ppm reads the published «سعر المتر» token from captured page text',
     code.includes('سعر') && /regexp_match/i.test(code));
  ok('aqar_published_ppm never references price_total / price_annual / area_m2',
     !/price_total|price_annual|area_m2/i.test(code),
     'the re-extractor must not derive — it may only re-read what the source printed');
}

// ── 4. the fidelity monitor that catches a live regression must exist ──────────────────────────
const monitor = lastDefinitionOf('mon_detect_price_fidelity');
ok('mon_detect_price_fidelity is committed', monitor !== null);
if (monitor) {
  const code = stripComments(monitor.body);
  ok('mon_detect_price_fidelity raises ppm_source_dropped when a published rate is stored NULL',
     code.includes('ppm_source_dropped') && /price_per_meter\s+is\s+null/i.test(code),
     'the source-vs-stored check is missing; price_fidelity() alone is structurally blind to it '
     + '(it diffs two projections of the same raw row)');
}

console.log(failed === 0
  ? '\n✓ aqar price_per_meter source-fidelity guards verified'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
