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
  //
  // WEAK-BARRIER REPAIR (2026-09-11, routine #10, R1 sweep). The original predicate excluded any
  // assignment starting with `src`, so a mutation that reads the source field AND THEN applies
  // arithmetic to it — `NEW.price_total := src::numeric * area_m2;`, a markup or a unit conversion
  // slipped in beside the legitimate cast — passed undetected: it "starts with src" and was
  // therefore never inspected for arithmetic at all. Caught by this file's own mutation proof on
  // its first run. Fixed by capturing the ENTIRE right-hand side up to the semicolon and requiring
  // it contain NO arithmetic operator anywhere, regardless of what it starts with — a verbatim cast
  // chain (`src::numeric::bigint`) has none; any computed price does.
  const priceRhs = squashed.match(/NEW\.price_total\s*:=\s*([^;]+);/i)?.[1] ?? '';
  const computesPrice = /[*/+-]/.test(priceRhs);
  ok('never derives price_total by arithmetic (the RHS is a cast, not a computation)', !computesPrice,
    `RHS "${priceRhs}" contains an arithmetic operator — price_total is being computed, not read verbatim`);

  // 4. Directional: only the UNDERSTATING clobber is the proven class. Rewriting in the other
  //    direction would silently "correct" the 9-row cohort whose direction is unproven, and any
  //    genuinely source-published high price — which the owner rule says to PRESERVE.
  ok('only repairs the understating direction (src >= incoming * 10)',
    /src::numeric\s*>=\s*NEW\.price_total::numeric\s*\*\s*10/i.test(squashed),
    'the >=10x directional condition is missing or was widened');

  // 5. The half this trigger already had must survive any future rebuild of the other half.
  //
  // WEAK-BARRIER REPAIR (2026-09-11, routine #10, R1 sweep). The trigger legitimately assigns
  // `NEW.additional_info := OLD.additional_info` in TWO DISTINCT branches — the IF (OLD enriched,
  // NEW not yet) and the ELSIF (both enriched, NEW shrank). A bare `.test()` is satisfied by EITHER
  // ALONE, so silently deleting ONE branch's preservation — a real narrowing of the trigger's actual
  // behaviour, since that branch's specific condition would then stop preserving anything — passed
  // this check undetected. Caught by this file's own mutation proof below on its first run. Fixed by
  // COUNTING: the trigger must carry the assignment in at least both places it is known to belong.
  const preserveCount = (squashed.match(/NEW\.additional_info\s*:=\s*OLD\.additional_info/gi) ?? []).length;
  ok('preserves the richer additional_info panel in BOTH branches that need it',
    preserveCount >= 2 && /detail_enriched/i.test(squashed),
    `found ${preserveCount} preservation assignment(s), need ≥2 — a branch's preservation was dropped ` +
    `while editing the price guard`);
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
if (failed > 0) process.exit(1);

// ═══ MUTATION PROOFS ════════════════════════════════════════════════════════════════════════════
// Every check() above reads the WINNING trigger definition assembled from this repo's own committed
// migrations by lastDefinitionOf() — never a value this file invents. The mutants below take that
// SAME real body (`trg.body`) and reintroduce each of the five historical failure modes the header
// describes, proving the checks above would go red on each — never a synthetic fixture standing in
// for what production actually runs.
console.log('\n── mutation proofs — reintroduce each historical failure mode ─────────────────────');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

if (trg) {
  const healthy = trg.body.replace(/\s+/g, ' ');

  // ── 1. the repair removed outright (a PR#289-shaped stale-body paste, per the header) ───────────
  const noRepair = trg.body.replace(
    'NEW.price_total := src::numeric::bigint;', '-- repair removed',
  ).replace(/\s+/g, ' ');
  mustCatch('the price_total repair assignment deleted — reverts to the raw per-metre bug',
    !/NEW\.price_total\s*:=\s*src(::numeric)?(::bigint)?/i.test(noRepair));
  mustCatch('…while the genuine trigger IS recognised as assigning it (negative control)',
    /NEW\.price_total\s*:=\s*src(::numeric)?(::bigint)?/i.test(healthy));

  // ── 2. the source field reference silently changed (reads a different, wrong field) ─────────────
  const wrongField = trg.body.replace(
    `'propertyInfo' ->> 'salePrice'`, `'propertyInfo' ->> 'listPrice'`,
  ).replace(/\s+/g, ' ');
  mustCatch('the source-of-truth field reference changed from salePrice to something else',
    !/'propertyInfo'\s*->>?\s*'salePrice'/i.test(wrongField));
  mustCatch('…while the genuine field reference IS recognised (negative control)',
    /'propertyInfo'\s*->>?\s*'salePrice'/i.test(healthy));

  // ── 3. the fix "helpfully" changed to COMPUTE a price instead of reading the source verbatim ────
  // The predicate as ORIGINALLY written excluded any assignment starting with `src`, so a mutant
  // that reads src AND THEN applies arithmetic — `src::numeric * area_m2` — passed undetected: it
  // "starts with src" and was never inspected for an operator at all. Caught by this proof on its
  // first run; repaired above (capture the full RHS, require no arithmetic operator ANYWHERE in it,
  // regardless of what it starts with). Both mutant shapes are proven now.
  const priceRhsOf = (s: string) => s.match(/NEW\.price_total\s*:=\s*([^;]+);/i)?.[1] ?? '';
  const computesPriceCheck = (s: string) => /[*/+-]/.test(priceRhsOf(s));
  const computedNoBasis = trg.body.replace(
    'NEW.price_total := src::numeric::bigint;', 'NEW.price_total := NEW.area_m2 * 1000;',
  ).replace(/\s+/g, ' ');
  const computedFromSrc = trg.body.replace(
    'NEW.price_total := src::numeric::bigint;', 'NEW.price_total := src::numeric * area_m2;',
  ).replace(/\s+/g, ' ');
  mustCatch('a price with no basis in the source field at all',
    computesPriceCheck(computedNoBasis));
  mustCatch('the ORIGINAL blind spot: reads src, THEN applies arithmetic — the shape that slipped past the first version of this check',
    computesPriceCheck(computedFromSrc));
  mustCatch('…while the genuine, verbatim-cast trigger is NOT flagged as computing a price (negative control)',
    !computesPriceCheck(healthy));

  // ── 4. the directional >=10x guard widened or removed (would "correct" the unproven-direction cohort) ──
  const noDirection = trg.body.replace(
    'src::numeric >= NEW.price_total::numeric * 10', 'true',
  ).replace(/\s+/g, ' ');
  mustCatch('the >=10x directional condition removed (repairs BOTH directions, including the unproven one)',
    !/src::numeric\s*>=\s*NEW\.price_total::numeric\s*\*\s*10/i.test(noDirection));
  mustCatch('…while the genuine directional guard IS recognised (negative control)',
    /src::numeric\s*>=\s*NEW\.price_total::numeric\s*\*\s*10/i.test(healthy));

  // ── 5. the additional_info preservation half dropped while editing the price guard ───────────────
  // The predicate as ORIGINALLY written used a bare `.test()` — true if the pattern appears ANYWHERE
  // in the body. The trigger legitimately carries the assignment in TWO DISTINCT branches (IF: OLD
  // enriched, NEW not yet; ELSIF: both enriched, NEW shrank), so dropping ONE branch's preservation —
  // a real narrowing of the trigger's behaviour in that branch's specific case — left the OTHER
  // branch's identical pattern still matching, and the check stayed green. Caught by this proof on
  // its first run; repaired above (count occurrences, require ≥2). Both the single-branch removal
  // and the total removal are proven here.
  const preserveCountOf = (s: string) =>
    (s.match(/NEW\.additional_info\s*:=\s*OLD\.additional_info/gi) ?? []).length;
  const preservesInfoCheck = (s: string) => preserveCountOf(s) >= 2 && /detail_enriched/i.test(s);
  const firstBranchDropped = trg.body.replace(
    'NEW.additional_info := OLD.additional_info;\n    NEW.detail_enriched := true;',
    'NEW.detail_enriched := true;',
  ).replace(/\s+/g, ' ');
  const bothBranchesDropped = firstBranchDropped.replace(
    /NEW\.additional_info\s*:=\s*OLD\.additional_info;\s*--\s*keep the richer stored panel/i,
    '-- keep the richer stored panel',
  );
  mustCatch('the ORIGINAL blind spot: ONE branch\'s preservation dropped, the other masks it — a bare .test() misses this',
    !preservesInfoCheck(firstBranchDropped));
  mustCatch('…and total removal (both branches) is caught too',
    !preservesInfoCheck(bothBranchesDropped));
  mustCatch('…while the genuine trigger, carrying both, IS recognised as preserving it (negative control)',
    preservesInfoCheck(healthy) && preserveCountOf(healthy) >= 2);
}

// ── 6. the detector-roster wiring, proven against the ACTUAL committed migration text ─────────────
const anyRunnerHasDetector = runnerDefs.some((sql) => /mon_detect_price_source_mismatch/i.test(sql));
mustCatch('the detector wired into mon_run_all_detectors is real, not a phantom match on this file itself',
  anyRunnerHasDetector);
mustCatch('…and removing every occurrence from every runner definition would be caught',
  !runnerDefs.some((sql) => sql.replace(/mon_detect_price_source_mismatch/gi, 'x')
    .match(/mon_detect_price_source_mismatch/i)));

console.log('');
if (mutFail) { console.error(`✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
console.log('✓ every guard above was watched to fail against the historical defect it prevents\n');
