#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
// HERMETIC half — auto-discovered, runs in the required `npm test` on every PR.
//
// Owner report, 2026-09-11: the Riyadh Advanced Filter district dropdown showed entries like
// "الخبر الحمراء 3537" / "حي الدكاترة 3420" — raw internal plot numbers. Root cause traced to
// public.refresh_loc_canonical_district(): its 'live' fallback branch (used whenever a scraped
// district_ar has no curated catalog entry) promoted the RAW scraped text VERBATIM, filtered only
// by three placeholder literals ('غير محدد'/'اخرى'/'أخرى'). Fixed by public.district_ar_looks_bogus()
// (migration 20260911201716).
//
// Owner decision 2026-09-14 («in our district catalog, make sure there are no numbers… we just
// match it with ours, and then in their property card, if they kept a number, we include that
// number»): migration 20260914204035 folds a number (either end) inside norm_district_tok(), so
// المحمدية 1/2/3 and المحمدية are ONE picker row «المحمدية» carrying all their listings. The full
// reasoning — and why this file's positive control is now the INVERSE of what it asserted before —
// is in scripts/lib/districtCatalog.ts's header. Read it before "fixing" a failure here.
//
// This file proves the SHARED predicate (scripts/lib/districtCatalog.ts's auditDistrictOptions) is
// sound — that it can actually fail, in both directions: under-correction (a code or a number leaks
// into the list) and over-correction (the fold DELETED the numbered siblings instead of merging
// them, stranding their listings — exactly what 20260913201221 had to revert). The database fix
// itself is proven live, against production, by this file's sibling — see the homing check below.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import { auditDistrictOptions, auditNoBogusEntries, FOLDED_CONTROL, HISTORICALLY_POLLUTED_CITIES, REPORTED_STRINGS, type DistrictRow } from './lib/districtCatalog.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
console.log('\nThe district catalog never shows a number, and never strands the listings it folds\n');

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
// جازان after the fold: one row per real place, none of them numbered, المحمدية carrying the
// combined count of the three numbered siblings plus the bare spelling.
const CLEAN_JAZAN: DistrictRow[] = [
  { district_ar: FOLDED_CONTROL.name, listing_count: 240 },
  { district_ar: 'الرحاب', listing_count: 229 },
  { district_ar: 'القدس', listing_count: 60 },
];

// M-1: EXACTLY the shipped bug shape — an internal plan/plot code leaks back into Riyadh.
mustCatch('an internal plan code leaks back into Riyadh (the exact shipped bug)',
  auditDistrictOptions([...CLEAN_RIYADH, { district_ar: 'الخير الأمراء 3537', listing_count: 1 }], CLEAN_JAZAN));
// M-2: subdivision-plan vocabulary alone, with no digit left to trip the number rule.
mustCatch('a "مخطط" plan reference leaks in even with no digit at all',
  auditDistrictOptions([...CLEAN_RIYADH, { district_ar: 'مخطط ج', listing_count: 1 }], CLEAN_JAZAN));
// M-3: one of the owner's own four reported strings, verbatim.
mustCatch('one of the exact reported strings reappears verbatim',
  auditDistrictOptions([...CLEAN_RIYADH, { district_ar: REPORTED_STRINGS[0], listing_count: 1 }], CLEAN_JAZAN));
// M-4: the RPC itself is broken (AGENTS.md: a failed fetch is not an empty answer) — an empty
// Riyadh result must never read as "clean," only as a failure.
mustCatch('Riyadh returns zero districts (RPC broken, not just polluted)',
  auditDistrictOptions([], CLEAN_JAZAN));
// M-5: THE OVER-CORRECTION THAT WAS REVERTED ON 2026-09-13 — the numbered siblings were removed
// rather than folded, so the place is simply gone and its listings are unreachable by district.
mustCatch('over-correction: the folded name is missing entirely (deleted, not merged)',
  auditDistrictOptions(CLEAN_RIYADH, CLEAN_JAZAN.filter((r) => r.district_ar !== FOLDED_CONTROL.name)));
// M-6: the subtler half of the same failure — the name survives, but only the bare spelling's own
// listings came with it, so the three numbered siblings' listings were silently dropped.
mustCatch('over-correction: the folded name kept only one member\'s listings (siblings stranded)',
  auditDistrictOptions(CLEAN_RIYADH, [{ district_ar: FOLDED_CONTROL.name, listing_count: 28 }, ...CLEAN_JAZAN.slice(1)]));
// M-7: UNDER-correction — the fold stopped folding and a numbered sibling is its own row again.
mustCatch('under-correction: a numbered sibling is back as its own picker row',
  auditDistrictOptions(CLEAN_RIYADH, [...CLEAN_JAZAN, { district_ar: FOLDED_CONTROL.absorbed[0], listing_count: 30 }]));
// M-8: a failed جازان fetch must read as a failure, never as a clean fold.
mustCatch('جازان returns zero districts (the positive control could not be evaluated)',
  auditDistrictOptions(CLEAN_RIYADH, []));
// The negative control — a genuinely clean response must NOT be flagged, or every proof above
// would be passing vacuously against a predicate that is red for everything.
mustCatch('a genuinely clean response is NOT reported as a failure',
  auditDistrictOptions(CLEAN_RIYADH, CLEAN_JAZAN).length === 0 ? ['ok'] : []);
// M-9: the per-city sweep (auditNoBogusEntries) — beyond Riyadh, proving the public RPC path stays
// clean for every historically-polluted city, not just the one the owner happened to look at.
mustCatch('a pollution pattern in a NON-Riyadh city (Jeddah) is caught by the per-city sweep',
  auditNoBogusEntries('جدة', [{ district_ar: 'مخطط 745', listing_count: 1 }]));
// M-10: the owner's rule is ANY number, not just a plot-code-shaped one — a single trailing digit
// on an otherwise real name must fail, which the pre-2026-09-14 «[0-9]{3,}» rule would have passed.
mustCatch('a single-digit suffix on a real name is caught (owner rule 2026-09-14: never a number)',
  auditNoBogusEntries('جدة', [{ district_ar: 'الصفا 2', listing_count: 40 }]));
check('the per-city sweep does NOT flag a clean response', auditNoBogusEntries('جدة', CLEAN_RIYADH).length === 0);
check(`${HISTORICALLY_POLLUTED_CITIES.length} historically-polluted cities are swept live (not just Riyadh)`,
  HISTORICALLY_POLLUTED_CITIES.length >= 5);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the district-catalog predicate catches every number, every code, and both halves of a bad fold — and its live half still runs.\n'
    : `\n❌ ${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
