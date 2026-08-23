// The aqarmonthly district←city suffix guard must keep ALL THREE of the backfill's rules, forever.
//
// What went wrong, and why this file exists. The 2026-07-21 backfill (20260721104637) cleaned every
// corrupted district_ar. The parser guard that was supposed to keep it clean shipped with only ONE
// of that migration's three rules: it compared RAW tokens against the FULL city name. So every
// re-scrape re-glued the city onto the district, and by 2026-08-22 there were 38 dirty rows again —
// 31 of them rows the backfill had already fixed. The guard caught 0 of the 38.
//
// The lesson this barrier encodes: a data backfill and the parser guard that protects it are ONE
// algorithm. When they drift, the cleanup silently rots and nothing tells you. So the rules are
// pinned here on BOTH sides — the Python guard and the canonical SQL function must each carry all
// three, and the SQL mirror must stay committed alongside the applied migration.
//
// Rules (order matters — full name before first token, or a 1-word city would strip twice):
//   1. NORMALISED comparison (norm_ar: أإآٱ→ا, ة→ه, ى→ي, tatweel/bidi stripped)  ← missed 37/38
//   2. the city's FIRST token alone, for an abbreviated official two-word city    ← missed 22/38
//   3. a trailing امارة/منطقة admin marker
// Invariants that keep this from ever inventing location precision:
//   * trailing tokens only (a LEADING city token inside the district survives)
//   * at least two tokens always remain
//   * NEITHER resolver turns «منطقة X» into city X (audit 2026-08-10 fixed to_catalog;
//     resolve() still had the hole until 2026-08-23)
//
//   node --experimental-strip-types scripts/verify-aqarmonthly-district-suffix-guard.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
// Strip comments so prose describing a rule can never stand in for the rule itself.
const pyCode = read('scrapers/common/arabic_location.py').replace(/^\s*#.*$/gm, '').replace(/"""[\s\S]*?"""/g, '');

const migName = readdirSync(join(root, 'supabase/migrations'))
  .find((f) => f.endsWith('_aqarmonthly_district_suffix_canonical_guard.sql'));
const sql = migName ? read(join('supabase/migrations', migName)) : '';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\naqarmonthly district←city suffix — parser guard / backfill parity\n');

// ── the guard exists as ONE reusable function, not inlined in resolve_slug ──────────────────────
check('the guard is a named function resolve_slug delegates to (so it is testable at all)',
  /def strip_city_suffix\(/.test(pyCode) && /district_ar = strip_city_suffix\(district_ar, city_ar_val\)/.test(pyCode));

// ── rule 1: normalised comparison ───────────────────────────────────────────────────────────────
check('RULE 1 — the guard compares NORMALISED tokens, never raw ones',
  /dist_norm = \[norm_ar\(t\) for t in dist_tokens\]/.test(pyCode)
  && /city_norm = norm_ar\(city_ar\)\.split\(\)/.test(pyCode)
  && !/dist_tokens\[-len\(city_tokens\):\] == city_tokens/.test(pyCode));
check('RULE 1 — it reuses the module’s own norm_ar (one normaliser, not a second copy)',
  /def norm_ar\(/.test(pyCode) && (pyCode.match(/norm_ar\(/g) ?? []).length >= 3);

// ── rule 2: the abbreviated official city ───────────────────────────────────────────────────────
check('RULE 2 — the city’s FIRST token alone is stripped',
  /dist_norm\[-1\] == city_norm\[0\]/.test(pyCode));

// ── rule 3: admin markers ───────────────────────────────────────────────────────────────────────
check('RULE 3 — a trailing امارة/منطقة marker is stripped, in normalised form',
  /_ADMIN_SUFFIX_TOKENS = \("اماره", "منطقه"\)/.test(pyCode)
  && /dist_norm\[-1\] in _ADMIN_SUFFIX_TOKENS/.test(pyCode));

// ── ordering: full name must be tried BEFORE the first token ────────────────────────────────────
check('rule ORDER is full-city → first-token → marker',
  pyCode.indexOf('dist_norm[-cn:] == city_norm') < pyCode.indexOf('dist_norm[-1] == city_norm[0]')
  && pyCode.indexOf('dist_norm[-1] == city_norm[0]') < pyCode.indexOf('dist_norm[-1] in _ADMIN_SUFFIX_TOKENS'));

// ── anti-fabrication invariants ─────────────────────────────────────────────────────────────────
check('at least two tokens always survive (a short real district is never hollowed out)',
  /while len\(dist_tokens\) > 2:/.test(pyCode));
check('only TRAILING tokens are removed — the guard never rebuilds or renames the district',
  /dist_tokens\[:-cn\]/.test(pyCode) && /dist_tokens\[:-1\]/.test(pyCode)
  && !/dist_tokens\[1:\]/.test(pyCode) && !/dist_tokens\.insert\(/.test(pyCode));
check('a blank district or an unresolved city is returned untouched (no invented value)',
  /if not district_ar or not city_ar:\s*\n\s*return district_ar/.test(pyCode));
// BOTH resolvers, not just the audited one. to_catalog() was fixed on 2026-08-10; resolve() — the
// function this module tells new scrapers to use, and the one scrapers/gathern/run.py calls — kept
// the identical hole and returned city_id=3/confidence="city" for «منطقة الرياض» until 2026-08-23.
// A rule enforced on one of two twins is not enforced.
check('EXACT-LOCATION-ONLY — no resolver strips «منطقة X» and retries it as a CITY',
  /if n\.startswith\("محافظه "\):/.test(pyCode)
  && !/for pre in \("محافظه ", "منطقه "\)/.test(pyCode));
check('EXACT-LOCATION-ONLY — resolve() keeps the city retry and the region lookup on SEPARATE strings',
  /city_stripped = n\[len\("محافظه "\):\] if n\.startswith\("محافظه "\) else n/.test(pyCode)
  && /region_stripped = n\[len\("منطقه "\):\] if n\.startswith\("منطقه "\) else city_stripped/.test(pyCode)
  && /_pick_candidate\(city_stripped, hint\)/.test(pyCode)
  && !/_pick_candidate\(region_stripped/.test(pyCode));

// ── the SQL mirror must stay committed next to the applied migration ────────────────────────────
check('the canonical SQL rule is committed (migration mirror rule)', !!migName);
check('SQL carries the SAME three rules', /dist_norm\[n-cn\+1:n\] = city_norm/.test(sql)
  && /dist_norm\[n\] = city_norm\[1\]/.test(sql)
  && /dist_norm\[n\] in \('اماره','منطقه'\)/.test(sql)
  && /public\.normalize_ar/.test(sql));
check('SQL keeps the same two-token floor', /exit when n <= 2;/.test(sql));
check('a standing detector watches for re-scrape re-corruption, and is on the roster',
  /create or replace function public\.mon_detect_aqarmonthly_district_city_suffix/.test(sql)
  && /mon_run_all_detectors/.test(sql) && /mon_raise\('P2','aqarmonthly_district_city_suffix'/.test(sql));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const mut = (src: string, from: string, to: string) => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing: ${from}`);
  return src.replace(from, to);
};

mustCatch('reverting to RAW token comparison (the original 0/38 bug)',
  !/dist_norm = \[norm_ar\(t\) for t in dist_tokens\]/.test(
    mut(pyCode, 'dist_norm = [norm_ar(t) for t in dist_tokens]', 'dist_norm = list(dist_tokens)')));
mustCatch('deleting the first-token rule (22/38 rows would rot again)',
  !/dist_norm\[-1\] == city_norm\[0\]/.test(
    mut(pyCode, 'dist_norm[-1] == city_norm[0]', 'False')));
mustCatch('deleting the admin-marker rule',
  !/dist_norm\[-1\] in _ADMIN_SUFFIX_TOKENS/.test(
    mut(pyCode, 'dist_norm[-1] in _ADMIN_SUFFIX_TOKENS', 'False')));
mustCatch('dropping the two-token floor (would hollow out real districts)',
  !/while len\(dist_tokens\) > 2:/.test(
    mut(pyCode, 'while len(dist_tokens) > 2:', 'while len(dist_tokens) > 0:')));
mustCatch('re-enabling «منطقة X» → city X in to_catalog (invented precision)',
  /for pre in \("محافظه ", "منطقه "\)/.test(
    mut(pyCode, 'if n.startswith("محافظه "):', 'for pre in ("محافظه ", "منطقه "):')));
mustCatch('resolve() feeding the REGION-stripped label back into the city lookup',
  /_pick_candidate\(region_stripped/.test(
    mut(pyCode, '_pick_candidate(city_stripped, hint)', '_pick_candidate(region_stripped, hint)')));
mustCatch('inlining the guard back into resolve_slug (untestable again)',
  !/district_ar = strip_city_suffix\(district_ar, city_ar_val\)/.test(
    mut(pyCode, 'district_ar = strip_city_suffix(district_ar, city_ar_val)', 'pass')));
mustCatch('the SQL mirror losing the normalised comparison',
  !/public\.normalize_ar/.test(sql.replaceAll('public.normalize_ar', 'x')));
mustCatch('the detector being dropped from the roster wiring',
  !/mon_run_all_detectors/.test(sql.replaceAll('mon_run_all_detectors', 'x')));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ all three suffix rules held on both sides; exact-location-only intact\n');
