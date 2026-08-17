// The Normal Filter applies some filters ON THE USER'S BEHALF: picking a نوع can silently set a
// value the user never chose. Today there is exactly one — نوع=غرفة locks «غرف النوم» to 1 (owner
// rule 2026-07-06: a room is a single room).
//
// WHY THIS TEST EXISTS
// An auto-applied default is invisible to the person searching, so when it disagrees with the app's
// own count surface the product contradicts itself on one screen. That is exactly what happens
// today: top_cities_by_deal_ar takes no bedrooms argument, so the trending panel promised الرياض
// 1,172 غرفة while the search — carrying the auto-applied p_beds_exact=[1] — returned 1. It was
// found BY HAND twice (Search & Matching QA runs 2026-08-14 and 2026-08-17) because nothing watched
// for it.
//
// The watcher is now mon_detect_filter_default_suppresses_inventory(), and it is only as truthful as
// the rule list it reads: public.ops_filter_autoapply_rule. That table is a MIRROR of the client, so
// it can rot silently — a future auto-applied default added to src/app/index.tsx and not mirrored
// would be invisible to the detector, which would then report "clean" while suppressing inventory.
//
// So this test pins BOTH directions, offline, against the real source files:
//   1. every auto-apply site in src/app/index.tsx is present in the SQL mirror, and
//   2. every rule in the SQL mirror still exists in src/app/index.tsx.
// Whichever side someone edits, the other must be edited in the same change or `npm test` fails.
//
//   node --experimental-strip-types scripts/verify-filter-autoapply-mirror.ts   (wired into `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (!ok) { failed++; if (detail) console.error(`  ${detail}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const ROOT = join(import.meta.dirname, '..');
const ui = readFileSync(join(ROOT, 'src/app/index.tsx'), 'utf8');

// The migration that creates + seeds the mirror. Found by content, not by filename, so renaming or
// superseding it in a later migration keeps this test honest instead of silently passing on a stale file.
const MIG_DIR = join(ROOT, 'supabase/migrations');
const migrations = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const seeding = migrations
  .map((f) => ({ f, sql: readFileSync(join(MIG_DIR, f), 'utf8') }))
  .filter(({ sql }) => sql.includes('insert into public.ops_filter_autoapply_rule'));

check('a committed migration seeds public.ops_filter_autoapply_rule', seeding.length > 0,
  'no migration in supabase/migrations/ inserts into ops_filter_autoapply_rule — the detector would read an empty rule list and report clean');

// Latest seeding migration wins (a later one may supersede an earlier rule set).
const mirrorSql = seeding.length ? seeding[seeding.length - 1].sql : '';

check('the detector that consumes the mirror is committed too',
  migrations.some((f) => readFileSync(join(MIG_DIR, f), 'utf8')
    .includes('create or replace function public.mon_detect_filter_default_suppresses_inventory')),
  'mon_detect_filter_default_suppresses_inventory() is not in git — production would have a detector nobody can review');

check('the detector is wired into the mon_run_all_detectors roster',
  migrations.some((f) => {
    const sql = readFileSync(join(MIG_DIR, f), 'utf8');
    return sql.includes('mon_run_all_detectors')
        && sql.includes("'mon_detect_filter_default_suppresses_inventory'");
  }),
  'a detector outside the roster is decoration — mon_detect_orphaned_detectors() would fire on it');

// ── Direction 1: every auto-apply site in the client is mirrored ────────────────────────────────
// Each entry: how the client applies it, and the (type_ar, field, op, value) the SQL mirror must carry.
type Site = { name: string; uiPattern: RegExp; typeAr: string; field: string; op: string; value: number };
const SITES: Site[] = [
  {
    // src/app/index.tsx: `contextBedsList: nowRoomOnly ? ['1'] : …`
    name: 'نوع=غرفة (Room) locks غرف النوم to 1',
    uiPattern: /nowRoomOnly\s*\?\s*\[\s*'1'\s*\]/,
    typeAr: 'غرفة', field: 'bedrooms', op: '=', value: 1,
  },
];

for (const s of SITES) {
  check(`client still applies: ${s.name}`, s.uiPattern.test(ui),
    `src/app/index.tsx no longer matches ${s.uiPattern} — if the default was removed, drop its row from ` +
    `ops_filter_autoapply_rule (and this SITES entry) in the same change; the detector must not watch a rule that no longer exists`);
  const row = new RegExp(
    `'${s.typeAr}'\\s*,\\s*'${s.field}'\\s*,\\s*'${s.op}'\\s*,\\s*${s.value}\\b`,
  );
  check(`mirrored in SQL: ${s.name}`, row.test(mirrorSql),
    `no (${s.typeAr}, ${s.field}, ${s.op}, ${s.value}) row in the seeding migration — ` +
    `mon_detect_filter_default_suppresses_inventory() cannot see this default, so it would never alert on it`);
}

// ── Direction 2: every mirrored rule still exists in the client ─────────────────────────────────
// Parse the type_ar of each seeded rule and require a SITES entry (which direction 1 has already
// tied to a live code site). This is what stops the mirror from accumulating rules for defaults the
// client dropped — a detector watching a dead rule reports on behaviour no user can reach.
const seededTypes = [...mirrorSql.matchAll(/\(\s*'[a-z_]+'\s*,\s*'([^']+)'\s*,\s*'(bedrooms)'/g)].map((m) => m[1]);
check('the seeding migration declares at least one rule', seededTypes.length > 0);
for (const t of seededTypes) {
  check(`SQL rule for نوع=${t} is claimed by a known client site`,
    SITES.some((s) => s.typeAr === t),
    `ops_filter_autoapply_rule carries a rule for '${t}' with no matching entry in this test's SITES list — ` +
    `either the client default was removed (delete the row) or a new one was added (add it here so both directions stay pinned)`);
}

console.log(failed === 0
  ? '\nAll filter auto-apply mirror checks passed.'
  : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
