// IMAGE COVERAGE IS A RATCHET, AND ONBOARDING AN IMAGELESS PLATFORM IS A RED BUILD.
// Auto-discovered barrier (owner directive 2026-09-05: «we never want this issue again»).
//
// THE INCIDENT CLASS. alta and shmoualshmal shipped with a hardcoded-empty photo list; the owner
// found it on the live site. The follow-up fleet sweep then found platforms whose sources publish
// photos sitting at 31-77% DB coverage (mustqr 31%, souq24 32%, abralosol 43%, hajer 61%, …).
// Nothing failed anywhere, because an unphotographed row is VALID at every pipeline layer — the
// only honest detector is the coverage NUMBER itself, snapshotted daily (mon_image_coverage, cron
// 03:35 UTC) and held to a committed floor here.
//
// THE THREE RULES:
//   1. FRESHNESS — the newest snapshot must be < 48h old. A guard whose input silently stops
//      arriving is a guard that always passes; staleness is therefore a FAILURE, not a skip.
//   2. RATCHET — every platform's live coverage must be >= its floor_pct in
//      scripts/image-coverage-baseline.json. Floors are raised when a fix lands and NEVER lowered
//      to clear a red: a drop below floor means a scraper regressed or a source changed shape,
//      and both are incidents to investigate, not thresholds to adjust.
//   3. ONBOARDING GATE — a platform present in production but ABSENT from the baseline fails the
//      build. Adding a platform now requires deliberately declaring its expected image coverage
//      (or `imageless_at_source: true` with a reason, for a source that genuinely publishes no
//      photos — PRICE=SOURCE has a sibling: IMAGES=SOURCE, and an honest zero stays a zero).
//
// Baselines live in the repo so the ratchet moves through review, never through a dashboard edit.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nImage coverage: fresh snapshot, every platform at-or-above its floor, no undeclared platform\n');

type Base = { floor_pct?: number; imageless_at_source?: boolean; reason?: string };
const baseline: { platforms: Record<string, Base> } =
  JSON.parse(readFileSync(join(import.meta.dirname, 'image-coverage-baseline.json'), 'utf8'));

const { url, key } = resolvePublicSupabase();
const r = await fetch(`${url}/rest/v1/rpc/ops_image_coverage_latest`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: '{}',
});

type Row = { platform: string; active_rows: number; with_images: number; pct: number; snapshot_age_hours: number };
const rows: Row[] = r.status === 200 ? await r.json() : [];

// ── the pure predicate, exported shape for the mutation proof below ────────────────────────────
const evaluate = (snap: Row[], base: Record<string, Base>) => {
  const problems: string[] = [];
  if (!snap.length) { problems.push('EMPTY SNAPSHOT — mon_snapshot_image_coverage has never run'); return problems; }
  const age = snap[0].snapshot_age_hours;
  if (age > 48) problems.push(`snapshot is ${age}h old (>48h) — the cron is dead and this guard is blind`);
  for (const row of snap) {
    const b = base[row.platform];
    if (!b) { problems.push(`${row.platform}: ${row.active_rows} live rows but NOT in the baseline — onboarding must declare expected image coverage`); continue; }
    if (b.imageless_at_source) continue;                     // declared honest zero — reason lives in the file
    const floor = b.floor_pct ?? 0;
    if (Number(row.pct) < floor) {
      problems.push(`${row.platform}: coverage ${row.pct}% fell below its floor ${floor}% ` +
                    `(${row.with_images}/${row.active_rows}) — scraper regression or source change; investigate, never lower the floor`);
    }
  }
  return problems;
};

if (r.status !== 200) {
  check('ops_image_coverage_latest reachable', false, `HTTP ${r.status} — fails CLOSED`);
} else {
  const problems = evaluate(rows, baseline.platforms);
  check('snapshot fresh + every platform at-or-above its committed floor + none undeclared',
    problems.length === 0, problems.join('\n      '));
  check('the snapshot is evaluating the real fleet (sanity: sees >= 30 platforms)',
    rows.length >= 30, `saw ${rows.length}`);
}

// ── MUTATION PROOF — the same evaluate(), against states that must fail ─────────────────────────
console.log('\n  mutation proof — evaluate() against broken states\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++; console.error(`  FAIL  BLIND to: ${label}`);
};
const row = (p: string, pct: number, age = 1): Row =>
  ({ platform: p, active_rows: 100, with_images: pct, pct, snapshot_age_hours: age });

mustCatch('a platform dropping below its floor',
  evaluate([row('aqar', 50)], { aqar: { floor_pct: 95 } }).length > 0);
mustCatch('THE ONBOARDING GAP: a new platform not in the baseline (the alta/shmoualshmal shape)',
  evaluate([row('newplat', 0)], {}).length > 0);
mustCatch('a stale snapshot (dead cron = blind guard)',
  evaluate([row('aqar', 100, 72)], { aqar: { floor_pct: 95 } }).length > 0);
mustCatch('an EMPTY snapshot (never ran)',
  evaluate([], { aqar: { floor_pct: 95 } }).length > 0);
mustCatch('a declared imageless-at-source platform at 0% is NOT a failure (honest zero)',
  evaluate([row('quiet', 0)], { quiet: { imageless_at_source: true } }).length === 0);
mustCatch('a healthy fleet is NOT reported broken',
  evaluate([row('aqar', 100)], { aqar: { floor_pct: 95 } }).length === 0);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ image coverage holds its floors; no platform is live undeclared.\n'
    : `\n❌ ${failed} check(s) failed — image coverage regressed, or a platform launched undeclared.\n`,
);
process.exit(failed === 0 ? 0 : 1);
