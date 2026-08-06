// Automated guard — wasalt price_total must never hold the per-square-metre RATE, 2026-08-06.
//
// THE BUG THIS PINS
// scrapers/wasalt/run.py:330 writes `price_total` from the SEARCH-LIST payload's `salePrice`. For
// land ads that wasalt prices by the square metre, that slot carries the per-METRE rate, not the
// total. The listing's OWN detail payload publishes the two as distinct fields:
//     ar_data.propertyInfo.salePrice              = the total          (5,100,000)
//     ar_data.propertyInfo.averageSalePricePerSqm = the per-metre rate (7,500)
// and 7,500 x 680 m2 = 5,100,000 exactly. So listing 445386 — a 5.1M SAR Riyadh plot — was stored
// AND SERVED at "7,500 SAR", and matched every "Buy under 10,000" price filter. 27 active,
// production_ready rows were affected when this was measured.
//
// WHY THIS GUARD EXISTS AT ALL (it already came back once)
// Migration 20260804193711 repaired 22 rows of exactly this class on 2026-08-04 19:37. Every one
// was silently reverted inside 24 hours: the next list-crawl re-asserted the per-metre rate,
// because the repair changed rows without closing the WRITE PATH. A data-only repair of a
// scraper-introduced error has a one-crawl half-life. 20260806063329 therefore moved the fix into
// public.wasalt_preserve_detail(), the BEFORE UPDATE trigger that is the only place the incoming
// list value and the stored detail payload both exist.
//
// This verifier replays the migration directory the way Postgres would — last definition of each
// object wins — and fails if the winning body loses the price guard. The documented hazard here is
// a future edit that pastes a stale trigger body back (that is precisely how PR#289 reverted two
// dealapp fidelity fixes on 2026-08-04, and how 20260803194308 dropped a detector). Losing the
// additional_info half is checked too, so neither half can be silently dropped by the other.
//
// Deliberately OFFLINE (reads only the repo's own migration files, no DB, no network) to match the
// other verifiers chained in `npm test`. The live-data counterpart is mon_detect_price_source_
// mismatch(), wired into mon_run_all_detectors by 20260806063544 — it had been orphaned, which is
// why the 08-04 revert went unnoticed for 36 hours.
//
// Run: node --experimental-strip-types scripts/verify-wasalt-price-total-never-ppm.ts
// Exits non-zero on any failure so it can gate CI.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

/** Body of the LAST `CREATE OR REPLACE FUNCTION <name>` across all migrations (filename order). */
function lastDefinitionOf(name: string): { file: string; body: string } | null {
  let found: { file: string; body: string } | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    const header = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = header.exec(sql)) !== null) {
      const rest = sql.slice(m.index);
      const close = rest.match(/\$function\$\s*;/i);
      found = { file: f, body: close ? rest.slice(0, close.index! + close[0].length) : rest };
    }
  }
  return found;
}

console.log('wasalt-price-total-never-ppm: the list-crawl must not overwrite a source-published total\n');

const trg = lastDefinitionOf('wasalt_preserve_detail');
ok('wasalt_preserve_detail() has a committed definition', trg !== null,
  'no CREATE OR REPLACE FUNCTION wasalt_preserve_detail found in supabase/migrations');

if (trg) {
  const body = trg.body;
  const squashed = body.replace(/\s+/g, ' ');
  console.log(`  winning definition: ${trg.file}\n`);

  // 1. The guard must assign price_total from the SOURCE's own field.
  ok('assigns NEW.price_total from the source payload',
    /NEW\.price_total\s*:=\s*src(::numeric)?(::bigint)?/i.test(squashed),
    'the trigger no longer restores the source-published total');

  // 2. It must read salePrice out of the stored detail payload, not invent a value.
  ok("reads ar_data->'propertyInfo'->>'salePrice' as the total",
    /'propertyInfo'\s*->>\s*'salePrice'/i.test(squashed),
    "the source-of-truth field reference is gone");

  // 3. It must never COMPUTE a price. A derived price is itself the fidelity violation
  //    (AGENTS.md: never modify/estimate/round listing data; honest NULL beats a guess).
  const computesPrice =
    /NEW\.price_total\s*:=[^;]*(area_m2|\*|\/)/i.test(squashed) &&
    !/NEW\.price_total\s*:=\s*src/i.test(squashed);
  ok('never derives price_total by arithmetic', !computesPrice,
    'price_total is being computed rather than read from the source field');

  // 4. Directional: only the UNDERSTATING clobber is the proven class. Rewriting in the other
  //    direction would silently "correct" the 9-row cohort whose direction is unproven, and any
  //    genuinely source-published high price — which the owner rule says to PRESERVE.
  ok('only repairs the understating direction (src >= incoming * 10)',
    /src::numeric\s*>=\s*NEW\.price_total::numeric\s*\*\s*10/i.test(squashed),
    'the >=10x directional condition is missing or was widened');

  // 5. The half this trigger already had must survive any future rebuild of the other half.
  ok('still preserves the richer additional_info panel',
    /NEW\.additional_info\s*:=\s*OLD\.additional_info/i.test(squashed) &&
      /detail_enriched/i.test(squashed),
    'the original detail-preservation behaviour was dropped while editing the price guard');
}

// 6. The live-data counterpart must stay reachable from the detector runner. It was orphaned for
//    36 hours, which is exactly why the 2026-08-04 revert of this same class went unnoticed.
const runnerDefs = files
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .filter((sql) => /mon_run_all_detectors/i.test(sql));
ok('a migration wires mon_detect_price_source_mismatch into the detector runner',
  runnerDefs.some((sql) => /mon_detect_price_source_mismatch/i.test(sql)),
  'the price-vs-source detector is orphaned again — nothing would catch a re-revert');

console.log(
  failed === 0
    ? '\n✅ wasalt price_total keeps the source-published total; the write path stays closed.'
    : `\n❌ ${failed} check(s) failed — a wasalt land plot can be served at its per-metre rate again.`,
);
process.exit(failed === 0 ? 0 : 1);
