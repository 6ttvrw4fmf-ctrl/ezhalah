// Regression guard — wasalt must not map amenities its vocabulary cannot express, and the
// manufactured-negative barrier must stay strict everywhere it has not been given evidence.
// Senior audit run #10, 2026-08-11.
//
// THE BUG THIS PINS
// -----------------
// scrapers/wasalt/run.py maps feature-grid booleans out of wasalt's curated `featureAmenities`
// list. Its rule — list absent -> None, list present -> True/False — is right, but only for a
// keyword the vocabulary is CAPABLE of containing. Measured over the whole wasalt corpus
// (62,745 rows, active + inactive, all time):
//
//     parking  2,258 true / 11,023 false     elevator          0 true / 203 false
//     maid       1,285 / 11,996              air_conditioner   0 / 203
//     laundry      828 / 12,453              private_entrance  0 / 203
//     driver       739 / 12,542              optical_fibers    0 / 203
//     balcony      658 / 12,623              water_supply      0 / 203
//     kitchen       80 / 13,201              electricity       0 / 203
//                                            sanitation        0 / 203
//
// Two populations. The six on the left are read — even `kitchen`, the rarest, says yes 80 times.
// The seven on the right were NEVER true once in 62,745 rows: for them `false` did not mean "the
// property lacks it", it meant "this vocabulary cannot express it". The field-level safety barrier
// caught exactly that signature on 2026-08-11 and turned `npm test` red on every open PR.
//
// Water and electricity are not lost by dropping them here — wasalt states those explicitly in its
// additionalAttributes panel, captured tri-state as separate_water_meter/separate_electricity_meter.
//
// AND THE OTHER HALF: the barrier could not tell a source-published negative from a manufactured
// one. aldarim really does publish is_ac_installed = 0 on every listing that states it, so that
// pair can never reach a `true` and would keep CI red forever while the data is correct. The
// exemption added for it must stay NARROW — per (platform, column), evidence-bearing — or the
// barrier stops protecting everything else.
//
// Deliberately OFFLINE (reads only the repo's own files — no DB, no network).
//   node --experimental-strip-types scripts/verify-wasalt-amenity-vocabulary.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};

console.log('verify-wasalt-amenity-vocabulary: absence of a keyword wasalt never uses is not a "no".\n');

// ── 1. wasalt: the seven unreadable amenities must not be mapped from featureAmenities ──────────
const wasalt = readFileSync(join(import.meta.dirname, '..', 'scrapers', 'wasalt', 'run.py'), 'utf8');
const code = wasalt.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

const UNREADABLE = [
  'elevator', 'air_conditioner', 'private_entrance', 'optical_fibers',
  'water_supply', 'electricity', 'sanitation',
];
for (const col of UNREADABLE) {
  // `"<col>": has(...)` is the exact shape that manufactured the negative.
  const mapped = new RegExp(`["']${col}["']\\s*:\\s*has\\(`).test(code);
  ok(`wasalt does NOT map ${col} from featureAmenities`, !mapped);
}

// ── 2. …but the six the vocabulary demonstrably DOES use must stay mapped ───────────────────────
// Dropping these would throw away real source data — the opposite failure, and just as bad.
for (const col of ['parking', 'kitchen', 'maid_room', 'driver_room', 'laundry_room', 'balcony_terrace']) {
  ok(`wasalt still maps ${col} (vocabulary proven to use it)`,
    new RegExp(`["']${col}["']\\s*:\\s*has\\(`).test(code));
}

// ── 3. the tri-state rule itself must survive: an ABSENT list is still unknown ──────────────────
ok('wasalt has() still returns None when featureAmenities is absent (list-absent -> unknown)',
  /_has_amenity_list\s+else\s+None/.test(code));

// ── 4. the barrier exemption must be narrow, evidence-bearing, and consulted ─────────────────────
const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const allSql = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).join('\n');

ok('ops_source_published_negative allowlist is committed',
  /create\s+table\s+if\s+not\s+exists\s+public\.ops_source_published_negative/i.test(allSql));
ok('the allowlist requires evidence (NOT NULL column)',
  /evidence\s+text\s+not\s+null/i.test(allSql));

// Last definition of the detector wins, same replay principle as the other verifiers.
let detector = '';
const re = /create\s+or\s+replace\s+function\s+public\.detect_manufactured_negatives\b[\s\S]*?\$function\$([\s\S]*?)\$function\$/gi;
let m: RegExpExecArray | null;
while ((m = re.exec(allSql)) !== null) detector = m[1];
ok('detect_manufactured_negatives is defined in a committed migration', detector.length > 0);

if (detector) {
  const body = detector.replace(/--.*$/gm, '');
  ok('the detector consults the allowlist', /ops_source_published_negative/.test(body));
  // The exemption must be keyed on BOTH platform and column. A skip keyed on platform alone would
  // silently exempt every future column on that platform.
  ok('the exemption is scoped to (platform, col), not a whole platform',
    /x\.platform\s*=\s*p/.test(body) && /x\.col\s*=\s*c/.test(body));
  // The core predicate must survive — this is what still catches every unlisted pair.
  ok('the false-with-zero-true predicate still fires for unlisted pairs',
    /v_true\s*=\s*0\s+and\s+v_false\s*>\s*0/.test(body));
  ok('the detector still emits platform/col/n_false for a real finding',
    /platform\s*:=\s*p;\s*col\s*:=\s*c;\s*n_false\s*:=\s*v_false/.test(body));
}

// ── 5. every allowlist row seeded in the repo must carry real evidence, not a placeholder ───────
const seeds = [...allSql.matchAll(
  /insert\s+into\s+public\.ops_source_published_negative[\s\S]*?values([\s\S]*?);/gi)];
ok('at least one allowlist entry is seeded with evidence', seeds.length > 0);
for (const s of seeds) {
  const text = s[1];
  // A bare "n/a"/"TODO" justification is how an allowlist quietly becomes a blanket off-switch.
  ok('allowlist evidence is substantive (no TODO/n-a placeholder)',
    !/['"]\s*(todo|tbd|n\/a|none|-)\s*['"]/i.test(text));
  ok('allowlist evidence is long enough to state a measurement',
    text.replace(/\s+/g, ' ').length > 200, `${text.replace(/\s+/g, ' ').length} chars`);
}

console.log(
  failed === 0
    ? '\n✓ wasalt maps only what its vocabulary can express; the barrier stays strict elsewhere'
    : `\n✗ ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
