// THE FIRST SCREEN SHOWS THE WHOLE MARKET, NOT THE BIGGEST PLATFORM.
//
// Owner PERMANENT rule 2026-09-02, extending the supreme 2026-08-05 rule. Priority, in order:
//   1. MATCH            — absolute; diversity may never add, widen, or invent a row
//   2. PLATFORM DIVERSITY — cover every platform that has a genuine match
//   3. PHOTO PREFERENCE — prefer a real photo, target ≤3 no-photo cards WHEN alternatives exist
//   4. everything else  — closeness, rotation
//
//   initial_visible_count = min(genuine matches, max(10, distinct matching platforms))
//
// WHAT WAS ACTUALLY WRONG (measured on production 2026-09-02). Both ordering layers were already
// correct — the RPC's div_rank is a per-platform row_number(), and the client's interleaveRanked
// round-robins with `platform` as the OUTERMOST key — so the first K rows already were one listing
// from each of K platforms. The client then sliced that at a hardcoded `FIRST_PAGE = 10`:
//   فلل للبيع في الرياض        13 matching platforms → 3 erased from the first screen
//   الرياض / كل السكني         18 matching platforms → 8 erased
//   كل السكني للبيع (المملكة)  33 matching platforms → 23 erased
// A correct 33-platform ordering was being truncated to look like a 10-platform site.
//
// This file EXECUTES the real functions — never a copy (repo rule: "NEVER test a copy of production
// code"). The SQL half is read through rpcReplay, the same replay the RNPL guard uses, so it checks
// the body that is actually DEPLOYED rather than a hopeful comment.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { distinctPlatformCount, orderByScope, interleaveRanked } from '../src/lib/platformDiversity.ts';
import { initialReveal } from '../src/lib/initialReveal.ts';
import { replayFunction, codeOnly } from './lib/rpcReplay.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};
const rowsFor = (platforms: string[]) =>
  platforms.map((p, i) => ({ l: { cleanType: 't' }, platform: p, city: 'c', region: 'r', district: 'd', rank: i, source_table: `${p}_t` }));

// ── 1. THE COUNT RULE, EXECUTED ───────────────────────────────────────────────────────────────
// initial_visible_count = min(matches, max(10, distinct matching platforms)).
// STOP_AT is the canonical small-final-set cutoff (25) already honoured by initialReveal.
{
  const FLOOR = 10, STOP_AT = 25;
  const rows = (n: number, plat: (i: number) => string) => Array.from({ length: n }, (_, i) => ({ source: plat(i) }));
  const reveal = (n: number, platforms: number, honestTotal: number | null = null) =>
    initialReveal({ fetched: n, honestTotal, firstPage: FLOOR, stopAt: STOP_AT, platforms });

  const cases: Array<[string, number, number]> = [
    ['7 matches, 3 platforms → all 7 (never invent rows)', reveal(7, 3), 7],
    ['exactly 10 matches from 10 platforms → 10', reveal(10, 10), 10],
    ['500 matches but only 2 platforms → the floor, 10', reveal(500, 2), 10],
    ['500 matches, 13 platforms → 13', reveal(500, 13), 13],
    ['500 matches, 15 platforms → 15', reveal(500, 15), 15],
    ['500 matches, 29 platforms → 29', reveal(500, 29), 29],
    ["500 matches, 33 platforms → 33 (today's real broadest)", reveal(500, 33), 33],
    ['500 matches, 42 platforms → 42 (future, no edit needed)', reveal(500, 42), 42],
    ['zero matches → 0', reveal(0, 0), 0],
    ['never exceeds what was actually fetched', reveal(12, 33), 12],
  ];
  for (const [name, got, want] of cases) check(got === want, name, `got ${got}, want ${want}`);

  // The floor must never behave as a ceiling — the defect this rule exists to kill.
  check(reveal(500, 33) > FLOOR, 'the floor is NOT a cap: 33 platforms yields more than 10');
  // A pre-existing guarantee that must survive: a small FINAL set still renders in full.
  check(reveal(13, 4, 13) === 13, 'small final set (<= stopAt) still renders in full, platforms or not');

  // The platform term is COUNTED from the rows, never configured.
  check(distinctPlatformCount(rows(500, (i) => `p${i % 33}`)) === 33, 'distinctPlatformCount counts 33 from the data');
  check(distinctPlatformCount([{ source: 'a' }, { source: '' }, { source: '  ' }, { source: null }]) === 1,
    'a blank/unknown source does not invent a platform');
  check(distinctPlatformCount(null) === 0, 'null-safe');
}

// ── 2. COVERAGE: EVERY MATCHING PLATFORM IS IN THE FIRST BATCH ────────────────────────────────
// The batch size is only half the rule; the ORDER has to put one of each up front.
{
  for (const n of [2, 5, 13, 18, 29, 33, 42]) {
    // One huge platform + many small ones — the exact shape the owner called out (Aqar 5,000 vs a
    // platform with 1). Inventory size must not decide who is visible.
    const rows = [
      ...Array.from({ length: 400 }, (_, i) => ({ l: { cleanType: 't' }, platform: 'huge', city: 'c', region: 'r', district: 'd', rank: i, source_table: 'huge_t' })),
      ...rowsFor(Array.from({ length: n - 1 }, (_, i) => `small${i}`)),
    ];
    // EVERY scope, not just one: the diversity key list is per-scope, so a barrier that exercises a
    // single scope lets `platform` be dropped from the others unnoticed. (A mutation removing it from
    // the country scope survived until this loop existed.)
    for (const scope of ['country', 'region', 'city', 'district'] as const) {
    const ordered = orderByScope(rows as never, scope);
    const batch = initialReveal({ fetched: ordered.length, honestTotal: null, firstPage: 10, stopAt: 25, platforms: distinctPlatformCount(ordered.map((r) => ({ source: r.platform }))) });
    const covered = new Set(ordered.slice(0, batch).map((r) => r.platform));
    check(covered.size === n, `${n} matching platforms / ${scope} → all ${n} represented in the first batch`,
      `covered ${covered.size} of ${n}`);
    // The precise rule: NO platform may repeat until EVERY matching platform has had its turn.
    // (With few platforms the batch is still the floor of 10, so the big platform correctly fills
    // the leftover slots — «distribute those 10 reasonably across those two platforms».)
    const seq = ordered.map((r) => r.platform);
    const firstRepeatAt = seq.findIndex((p, i) => seq.indexOf(p) < i);
    const distinctBeforeRepeat = new Set(seq.slice(0, firstRepeatAt === -1 ? seq.length : firstRepeatAt)).size;
    check(distinctBeforeRepeat === n,
      `${n} platforms / ${scope}: no platform repeats until all ${n} are represented`,
      `only ${distinctBeforeRepeat} distinct before the first repeat`);
    check(ordered.slice(0, Math.min(batch, n)).filter((r) => r.platform === 'huge').length === 1,
      `${n} platforms / ${scope}: the 400-listing platform takes ONE slot in the coverage window`);
    }
  }
  // A platform with a single matching listing must still appear.
  const rows = [...Array.from({ length: 300 }, (_, i) => ({ l: { cleanType: 't' }, platform: 'aqar', city: 'c', region: 'r', district: 'd', rank: i, source_table: 'aqar_t' })),
                { l: { cleanType: 't' }, platform: 'lonely', city: 'c', region: 'r', district: 'd', rank: 999, source_table: 'lonely_t' }];
  const ordered = orderByScope(rows as never, 'city');
  const batch = initialReveal({ fetched: ordered.length, honestTotal: null, firstPage: 10, stopAt: 25, platforms: distinctPlatformCount(ordered.map((r) => ({ source: r.platform }))) });
  check(ordered.slice(0, batch).some((r) => r.platform === 'lonely'),
    'a platform whose ONLY match is the oldest row is still represented');
}

// ── 3. MATCH IS ABSOLUTE: diversity may not add, drop, or duplicate a row ─────────────────────
// Ordering is a permutation. That single property forbids fake diversity, dropped eligible rows,
// and pagination duplicates/skips all at once — nothing can enter that was not already eligible.
{
  const rows = rowsFor(['a', 'a', 'b', 'c', 'c', 'c', 'd', 'e', 'e']);
  const ordered = interleaveRanked(rows as never, ['platform', 'district']);
  check(ordered.length === rows.length, 'diversity returns exactly as many rows as it received');
  const key = (r: { source_table: string; rank: number }) => `${r.source_table}#${r.rank}`;
  const before = rows.map(key).sort().join('|');
  const after = ordered.map(key).sort().join('|');
  check(before === after, 'diversity is a PERMUTATION — no row invented, dropped or duplicated');
  check(new Set(ordered.map(key)).size === ordered.length, 'no duplicate rows after ordering');
  // Pagination: the initial batch is a strict PREFIX of the same ordering, so page 2 continues
  // rather than reshuffling. A batch that were not a prefix could repeat or skip listings.
  const batch = initialReveal({ fetched: ordered.length, honestTotal: null, firstPage: 10, stopAt: 25, platforms: distinctPlatformCount(ordered.map((r) => ({ source: r.platform }))) });
  check(ordered.slice(0, batch).every((r, i) => key(r) === key(ordered[i])),
    'the initial batch is a PREFIX of the full ordering — pagination cannot duplicate or skip');
}

// ── 4. NOTHING IS HARDCODED ───────────────────────────────────────────────────────────────────
{
  const lib = stripComments(read('src/lib/platformDiversity.ts'));
  const screen = stripComments(read('src/app/agent.tsx'));
  const reveal = stripComments(read('src/lib/initialReveal.ts'));
  check(!/return Math\.min\(firstPage, fetched\);/.test(reveal),
    'the fixed `min(firstPage, fetched)` cap is gone — firstPage is a floor now');
  check(/Math\.max\(firstPage, platforms\)/.test(reveal),
    'initialReveal widens the floor to the matching-platform count');
  check(/platforms: distinctPlatformCount\(/.test(screen),
    'the screen passes the DERIVED platform count into initialReveal');
  check(!/Math\.min\(\s*10\s*,/.test(screen), 'no literal `Math.min(10, …)` cap on the results screen');
  // No platform allowlist / name test / fixed count in the ranking path.
  for (const name of ['aqar', 'wasalt', 'dealapp', 'sanadak', 'therc']) {
    check(!new RegExp(`['"\`]${name}['"\`]`, 'i').test(lib),
      `platformDiversity.ts names no platform ("${name}") — diversity is derived, never listed`);
  }
  check(!/\b(?:29|30|33|42)\b/.test(lib.replace(/INITIAL_BATCH_FLOOR[^\n]*/g, '')),
    'no fixed platform count baked into the diversity lib');
  // The count must come from the DATA, not a constant: it reads the rows it was handed.
  check(/new Set<string>\(\)/.test(lib) && /for \(const r of rows \?\? \[\]\)/.test(lib),
    'the platform count is COUNTED from the eligible rows, so a new scraper needs no code edit');
}

// ── 5. PHOTO IS THIRD — never above match, never above platform coverage ──────────────────────
// Checked against the DEPLOYED body via replay, not against a comment.
{
  const replayed = replayFunction(join(root, 'supabase/migrations'), 'location_search_candidates_ar');
  // Some migrations rewrite a SET of functions through a loop variable (`p.proname = fn`), which no
  // static replay can resolve — legitimately uninterpretable, not a defect. Requiring zero here would
  // make this barrier hostage to unrelated migrations. What actually matters is narrower and
  // checkable: the replayed body must exist, and nothing this replay could not read may touch the
  // ordering asserted below. If a future dynamic migration DOES touch it, this fails — which is
  // exactly the moment someone needs to look.
  check((replayed.body ?? '').length > 0, 'the results RPC replays to a body to assert against');
  const migDir = join(root, 'supabase/migrations');
  const opaqueTouchingOrder = replayed.unresolved
    .map((u) => u.replace(/ \(.*$/, ''))
    .filter((f) => {
      const t = readFileSync(join(migDir, f), 'utf8');
      return /has_photo/i.test(t) || /partition\s+by/i.test(t);
    });
  check(opaqueTouchingOrder.length === 0,
    'no migration the replay cannot read touches the photo / per-platform-partition ordering',
    opaqueTouchingOrder.join('; '));
  const body = codeOnly(replayed.body ?? '');
  check(/partition\s+by[^)]*platform/i.test(body),
    'div_rank partitions BY PLATFORM — one row per platform before any platform repeats');
  // Tri-state, and in the right order: confirmed photo (0) → UNKNOWN (1) → confirmed no photo (2).
  // UNKNOWN must not be demoted to "confirmed no photo".
  // EVERY photo-ordering expression must be tri-state, not just one of them: a partial demotion
  // (one expression flipped to treat UNKNOWN as no-photo) is exactly the silent half-regression
  // this rule forbids, and an "at least one matches" assertion would sail straight past it.
  const photoTrue = (body.match(/has_photo\s+is\s+true\s+then\s+0/gi) ?? []).length;
  const photoNull = (body.match(/has_photo\s+is\s+null\s+then\s+1/gi) ?? []).length;
  check(photoTrue > 0 && photoNull === photoTrue,
    'EVERY photo ordering is TRI-STATE: true→0, UNKNOWN→1, false→2 (unknown is never confirmed-no-photo)',
    `${photoTrue} true-branches vs ${photoNull} unknown-branches`);
  // The decisive ordering fact: photo is applied INSIDE the per-platform partition. If photo were
  // ranked before div_rank, a photo-rich platform could take several head slots and push a
  // photo-poor but genuinely matching platform off the first screen — photo outranking diversity.
  const divIdx = body.search(/div_rank/i);
  const partIdx = body.search(/partition\s+by[^)]*platform/i);
  check(partIdx !== -1 && divIdx !== -1 && partIdx < body.length,
    'the per-platform partition exists in the deployed body');
  const orderInside = /partition\s+by[^)]*platform[^)]*order\s+by\s*\(?\s*case\s+when\s+m?\.?has_photo/i.test(body);
  check(orderInside,
    'photo preference sits INSIDE the per-platform partition — it orders WITHIN a platform, it cannot evict one');
}

console.log(failed === 0
  ? '\n✅ verify-initial-batch-covers-platforms: all checks passed.'
  : `\n❌ verify-initial-batch-covers-platforms: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
