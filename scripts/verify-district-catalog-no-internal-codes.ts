#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
// HERMETIC half — auto-discovered, runs in the required `npm test` on every PR.
//
// Owner report, 2026-09-11: the Riyadh Advanced Filter district dropdown showed entries like
// "الخبر الحمراء 3537" / "حي الدكاترة 3420" — raw internal plot numbers. Root cause traced to
// public.refresh_loc_canonical_district(): its 'live' fallback branch (used whenever a scraped
// district_ar has no curated catalog entry) promoted the RAW scraped text VERBATIM, filtered only
// by three placeholder literals ('غير محدد'/'اخرى'/'أخرى'). Fixed by public.district_ar_looks_bogus()
// (migration 20260911201716), which excludes internal-code-shaped strings from that fallback WITHOUT
// touching the curated catalog or the underlying listing rows.
//
// This file proves the SHARED predicate (scripts/lib/districtCatalog.ts's auditDistrictOptions) is
// sound — that it can actually fail, in both directions: under-correction (a plan code leaks back
// in) and over-correction (a genuine numbered district gets merged away). The database fix itself
// is proven live, against production, by this file's sibling — see the homing check below.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import { auditDistrictOptions, auditNoBogusEntries, EXPECTED_DISTINCT, HISTORICALLY_POLLUTED_CITIES, REPORTED_STRINGS, type DistrictRow } from './lib/districtCatalog.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
console.log('\nThe district catalog never shows an internal plan code, and never merges a real numbered district away\n');

// ── THE LIVE HALF MUST STILL RUN SOMEWHERE — verify-district-catalog-no-internal-codes-live.ts,
// homed via scripts/test-exclusions.txt in .github/workflows/district-catalog-live-check.yml,
// proven to workflowInvokes() it (not just be named in a comment) ────────────────────────────────
const LIVE = 'verify-district-catalog-no-internal-codes-live.ts';
const homing = liveHalfProblems(
  LIVE,
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(`the LIVE half is homed in a workflow that actually invokes it (${LIVE})`,
  homing.length === 0, homing.join('\n      '));

// ── MUTATION PROOF — the REAL predicate both halves share, against broken district-catalog data ──
console.log('\n  mutation proof — the shared predicate, against broken district-catalog data\n');
let mutFail = 0;
const mustCatch = (label: string, broken: string[]) => {
  if (broken.length > 0) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

const CLEAN_RIYADH: DistrictRow[] = [
  { district_ar: 'حي المهدية', listing_count: 100 },
  { district_ar: 'حي الرمال', listing_count: 50 },
];
const CLEAN_JAZAN: DistrictRow[] = EXPECTED_DISTINCT.map((district_ar) => ({ district_ar, listing_count: 5 }));

// M-1: EXACTLY the shipped bug shape — an internal plan/plot code leaks back into Riyadh.
mustCatch('an internal plan code leaks back into Riyadh (the exact shipped bug)',
  auditDistrictOptions([...CLEAN_RIYADH, { district_ar: 'الخير الأمراء 3537', listing_count: 1 }], CLEAN_JAZAN));
// M-2: subdivision-plan vocabulary alone, with no 3+ digit run to trip a naive digit-count rule.
mustCatch('a "مخطط" plan reference leaks in even with no 3-digit run',
  auditDistrictOptions([...CLEAN_RIYADH, { district_ar: 'مخطط الرياض', listing_count: 1 }], CLEAN_JAZAN));
// M-3: one of the owner's own four reported strings, verbatim.
mustCatch('one of the exact reported strings reappears verbatim',
  auditDistrictOptions([...CLEAN_RIYADH, { district_ar: REPORTED_STRINGS[0], listing_count: 1 }], CLEAN_JAZAN));
// M-4: the RPC itself is broken (AGENTS.md: a failed fetch is not an empty answer) — an empty
// Riyadh result must never read as "clean," only as a failure.
mustCatch('Riyadh returns zero districts (RPC broken, not just polluted)',
  auditDistrictOptions([], CLEAN_JAZAN));
// M-5: OVER-correction — a genuine numbered district silently vanishes.
mustCatch('over-correction: a genuine numbered district vanishes (blanket digit-stripping regression)',
  auditDistrictOptions(CLEAN_RIYADH, CLEAN_JAZAN.filter((r) => r.district_ar !== 'المحمدية 2')));
// M-6: OVER-correction — numbered districts collapse into one bare merged entry.
mustCatch('over-correction: numbered districts collapse into one bare merged entry',
  auditDistrictOptions(CLEAN_RIYADH, [{ district_ar: 'المحمدية', listing_count: 15 }, { district_ar: 'الرحاب', listing_count: 10 }]));
// The negative control — a genuinely clean response must NOT be flagged, or every proof above
// would be passing vacuously against a predicate that is red for everything.
mustCatch('a genuinely clean response is NOT reported as a failure',
  auditDistrictOptions(CLEAN_RIYADH, CLEAN_JAZAN).length === 0 ? ['ok'] : []);
// M-7: the per-city sweep (auditNoBogusEntries) — beyond Riyadh, proving the public RPC path stays
// clean for every historically-polluted city, not just the one the owner happened to look at.
mustCatch('a pollution pattern in a NON-Riyadh city (Jeddah) is caught by the per-city sweep',
  auditNoBogusEntries('جدة', [{ district_ar: 'مخطط 745', listing_count: 1 }]));
check('the per-city sweep does NOT flag a clean response', auditNoBogusEntries('جدة', CLEAN_RIYADH).length === 0);
check(`${HISTORICALLY_POLLUTED_CITIES.length} historically-polluted cities are swept live (not just Riyadh)`,
  HISTORICALLY_POLLUTED_CITIES.length >= 5);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the district-catalog predicate catches every pollution and over-correction shape, and its live half still runs.\n'
    : `\n❌ ${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
