// REPEAT-VISIT ROTATION MUST NOT DESTROY PLATFORM DIVERSITY
// ==========================================================
// Owner PERMANENT rule 2026-07-13 (Rule 2): "Never let one platform unnecessarily take over the results
// while other qualifying platforms are available." Owner rule 2026-06-27: a RETURNING visitor searching
// the same filters should see DIFFERENT high-quality listings (the visitOffset rotation in runSearch).
//
// THE BUG THIS PINS (found live by the Search & Matching QA routine, 2026-08-16)
// -----------------------------------------------------------------------------
// The platform round-robin produced upstream (orderByScope / the RPC's div_rank ORDER BY) necessarily
// DEGENERATES into a single-platform tail: once the smaller platforms are exhausted, every remaining
// position belongs to whichever platform still has rows. Live production, مستودع/بيع/الرياض:
// aqar 55, wasalt 10, aldarim 2, dealapp 2 (69 eligible) → positions ~20-69 are 100% aqar.
//
// runSearch then rotated a 25-window by (visitOffset * 25) % POOL over that list. For a returning
// visitor the window landed INSIDE the single-platform tail, so the first page rendered 100% one
// platform while FOUR platforms had real matches. Live-reproduced on production the same session:
//   visit 1 (off=0)  → 4 platforms   visit 2 (off=25) → 1 platform
//   visit 3 (off=50) → 1 platform    visit 4 (off=6)  → 4 platforms
// Count parity and reachability were never affected (69 of 69 rendered, all platforms, after
// «عرض المزيد») — this was purely a FIRST-PAGE ORDERING defect, which is exactly what Rule 2 governs.
//
// THE FIX: rotate as before (the returning visitor still gets different listings), then re-interleave
// ONLY the rotated window by platform (rediversifyByPlatform). Nothing is filtered, added or removed.
//
// This file asserts the PROPERTY, not the implementation: for a realistically skewed platform mix, no
// rotation offset may yield a first page that is single-platform when several platforms have matches.
// It fails against the pre-fix rotation (asserted explicitly below, so the test can never silently pass
// on code that reintroduces the bug).
//
//   node --experimental-strip-types scripts/verify-visit-rotation-preserves-diversity.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { rediversifyByPlatform } from '../src/lib/platformDiversity.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
}

type Row = { id: number; source: string };

// Build the upstream platform round-robin exactly as orderByScope produces it: each platform's #1, then
// each #2, … densest platform first — which is what creates the single-platform tail.
function roundRobin(counts: Record<string, number>): Row[] {
  const lists = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => Array.from({ length: n }, (_, i) => ({ id: 0, source: p })));
  const out: Row[] = [];
  for (let i = 0; out.length < Object.values(counts).reduce((a, b) => a + b, 0); i++) {
    let progressed = false;
    for (const g of lists) { if (i < g.length) { out.push(g[i]); progressed = true; } }
    if (!progressed) break;
  }
  return out.map((r, i) => ({ ...r, id: i }));
}

// The exact production live case that exposed the bug.
const WAREHOUSE = { aqar: 55, wasalt: 10, aldarim: 2, dealapp: 2 };
// A second degenerate shape: one dominant platform + a short thin tail, so the round-robin collapses to
// a single platform well inside the 100-row rotation pool (which is what makes the window land in it).
// NB a shape whose smaller platforms survive PAST position 100 (e.g. aqar 400 / wasalt 30) never exposed
// the bug — the window stays in the mixed zone — which is exactly why the live مستودع case, with only 69
// eligible rows, is the honest reproduction and is pinned first.
const SKEWED = { aqar: 80, wasalt: 6, dealapp: 3, aldarim: 2 };

const OLD = (rows: Row[], off: number, POOL: number) =>
  [...rows.slice(off, POOL), ...rows.slice(0, off), ...rows.slice(POOL)];
const NEW = (rows: Row[], off: number, POOL: number) =>
  [...rediversifyByPlatform([...rows.slice(off, POOL), ...rows.slice(0, off)], (l) => l.source), ...rows.slice(POOL)];

function firstPagePlatforms(rows: Row[], n = 10): number {
  return new Set(rows.slice(0, n).map((r) => r.source)).size;
}

// ── 1. The fix restores the mix at EVERY rotation offset ─────────────────────────────────────────────
for (const [label, counts] of [['مستودع/بيع/الرياض (live)', WAREHOUSE], ["skewed 80/6/3/2", SKEWED]] as const) {
  const rows = roundRobin(counts as Record<string, number>);
  const total = rows.length;
  const POOL = Math.min(total, 100);
  const nPlat = Object.keys(counts).length;

  let oldWorst = 99, newWorst = 99, oldBadOffsets = 0;
  for (let visit = 1; visit <= 12; visit++) {
    const off = (visit * 25) % POOL;
    if (off === 0) continue;
    const o = firstPagePlatforms(OLD(rows, off, POOL));
    const n = firstPagePlatforms(NEW(rows, off, POOL));
    oldWorst = Math.min(oldWorst, o);
    newWorst = Math.min(newWorst, n);
    if (o < 2) oldBadOffsets++;
  }
  check(`${label}: fixed rotation never yields a single-platform first page`,
    newWorst >= 2, `worst first page had ${newWorst} platform(s) across 12 visits (${nPlat} platforms have matches)`);
  check(`${label}: the pre-fix rotation DID break (test is not vacuous)`,
    oldBadOffsets > 0 && oldWorst < 2, `old rotation worst=${oldWorst}, single-platform offsets=${oldBadOffsets}`);
}

// ── 2. Rotation still does its job: a returning visitor sees DIFFERENT listings ──────────────────────
{
  const rows = roundRobin(WAREHOUSE);
  const POOL = Math.min(rows.length, 100);
  const first = NEW(rows, 0, POOL).slice(0, 25).map((r) => r.id).join(',');
  const second = NEW(rows, 25, POOL).slice(0, 25).map((r) => r.id).join(',');
  check('rotation still varies the listings a returning visitor sees', first !== second);
}

// ── 3. Nothing is added, dropped or duplicated by the re-interleave ──────────────────────────────────
{
  const rows = roundRobin(SKEWED);
  const POOL = Math.min(rows.length, 100);
  const out = NEW(rows, 50, POOL);
  const ids = out.map((r) => r.id);
  check('re-interleave preserves the exact multiset of listings',
    ids.length === rows.length && new Set(ids).size === rows.length,
    `${ids.length} rows, ${new Set(ids).size} unique (expected ${rows.length})`);
  const perPlatform = (list: Row[]) => {
    const m: Record<string, number> = {};
    for (const r of list) m[r.source] = (m[r.source] ?? 0) + 1;
    return JSON.stringify(Object.entries(m).sort());
  };
  check('re-interleave preserves each platform\'s row count exactly', perPlatform(out) === perPlatform(rows));
}

// ── 4. Single-platform results stay untouched (one platform matching is CORRECT, never manufactured) ─
{
  const solo = roundRobin({ aqar: 60 });
  const out = rediversifyByPlatform(solo, (l) => l.source);
  check('a genuinely single-platform result set is passed through unchanged',
    out.length === solo.length && out.every((r, i) => r.id === solo[i].id));
}

// ── 5. The call site is actually wired (a helper nobody calls protects nothing) ───────────────────────
{
  const src = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');
  check('runSearch imports rediversifyByPlatform', /import\s*\{[^}]*rediversifyByPlatform[^}]*\}\s*from\s*'@\/lib\/platformDiversity'/.test(src));
  const rot = src.slice(src.indexOf('const off = (opts.visitOffset * 25) % POOL;'));
  check('the visitOffset rotation re-interleaves by platform',
    /rediversifyByPlatform\(\s*rotated\s*,\s*\(l\)\s*=>\s*l\.source\s*\)/.test(rot.slice(0, 600)),
    'the rotated window must be passed through rediversifyByPlatform before it is displayed');
}

console.log(failures === 0
  ? '\n✅ repeat-visit rotation preserves platform diversity'
  : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
