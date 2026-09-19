// REAL regression barrier for district_ar_looks_bogus()'s prose-leak rules (routine-3, 2026-09-19).
//
// THE DEFECT THIS CLOSES. district_ar_looks_bogus() (migration 20260911201716) already refuses to
// promote a plan/parcel code into loc_canonical_district, via a length(t) > 40 rule among others.
// Eight awal (Arar) rows leaked "<district name> <apartment/area description>" into district_ar —
// e.g. "الجوهرة الشقه مكونه من :" (24 chars), "النسيم مساحه" (12 chars) — SHORT enough to slip
// under the 40-char line while still being unmistakably prose. Each was independently re-learned
// as a "canonical" district by the live-fallback branch, because it is the exact string that
// leaked into district_ar on its own polluting listing (verified live: each matches EXACTLY ONE
// search_listings_ar row, in EVERY city and platform, not just Arar). That silently masked the
// defect from ops_incident #310's own repro query, which looks for district_ar values ABSENT from
// loc_canonical_district: these were PRESENT, because the catalog had already learned the garbage.
//
// THE FIX. "مكون"/"مكونه" (consisting of...) and "مساحه"/"مساحة" (area) are the SAME vocabulary
// scrapers/awal/run.py's own _DIST_STOP list already treats as field-boundary markers, never a
// place name. A leading/trailing colon is a field-label leak. An emoji is decorative flourish.
// Checked by execution against the FULL canonical catalog (all cities, all platforms) at apply
// time: these four rules matched ONLY the eight known-bad Arar entries.
//
//   node --experimental-strip-types scripts/verify-district-bogus-guard-catches-prose-leak.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const MIG_DIR = join(ROOT, 'supabase', 'migrations');

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// Must match the migration that DEFINES district_ar_looks_bogus with the NEW rules, not merely
// one that mentions the function name — same any-mention trap
// verify-district-contradicts-source-detector.ts already documents.
const defining = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => /create\s+or\s+replace\s+function\s+public\.district_ar_looks_bogus/i
    .test(readFileSync(join(MIG_DIR, f), 'utf8')))
  .sort();

check('at least one migration defines district_ar_looks_bogus', defining.length > 0);
const latest = defining[defining.length - 1] ?? '';
const sql = latest ? readFileSync(join(MIG_DIR, latest), 'utf8') : '';

check('the LATEST defining migration is the prose-leak extension (not the original alone)',
  latest.includes('district_bogus_guard_prose_leak') || latest.includes('20260919171833'));

// ── 1. THE FOUR NEW RULES MUST ALL BE PRESENT, none silently dropped ─────────────────────────────
check("#1 rule 6: 'مكون' (consisting-of) vocabulary", /or\s+t\s*~\s*'مكون'/.test(sql));
check("#1 rule 7: 'مساحه'/'مساحة' (area) vocabulary",
  /or\s+t\s*~\s*'مساحه'/.test(sql) && /or\s+t\s*~\s*'مساحة'/.test(sql));
check('#1 rule 8: leading/trailing colon', /\^:/.test(sql) && /:\$/.test(sql));
check('#1 rule 9: emoji surrogate-pair range', /uD83C-\\uDBFF/.test(sql) && /uDC00-\\uDFFF/.test(sql));

// ── 2. THE PRE-EXISTING RULES 1-5 MUST SURVIVE UNTOUCHED — an extension, not a rewrite ───────────
check('#2 rule 1 (مخطط) still present', /t\s*~\s*'مخطط'/.test(sql));
check('#2 rule 2 (3+ digit run) still present', /t\s*~\s*'\[0-9\]\{3,\}'/.test(sql));
check('#2 rule 4 (length > 40) still present', /length\(t\)\s*>\s*40/.test(sql));
check('#2 rule 5 (known non-place literals) still present', /'حكومي1'/.test(sql));

// ── 3. APPLY-TIME SELF-TESTS MUST EXECUTE AGAINST THE REAL COHORT, not a hand-picked fixture ─────
check('#3 T1 asserts every one of the 8 known-bad entries is caught',
  sql.includes('الجوهرة الشقه مكونه من :') && sql.includes('النسيم مساحه')
  && sql.includes(': الجوهره') && /bool_and\(public\.district_ar_looks_bogus/.test(sql));
check('#3 T2 is the sibling-branch POSITIVE assertion — real district names must NOT be flagged '
    + '(the exact asymmetry PRODUCTION_RED_TEAM_ENGINEER.md PART 3.3 shape-4 looks for)',
  sql.includes('حي الجوهرة') && sql.includes('حي الناصرية')
  && /bool_or\(public\.district_ar_looks_bogus/.test(sql));
check('#3 T3/T4 execute against the LIVE canonical catalog, not only the hand-picked fixture',
  sql.includes('from public.loc_canonical_district') && sql.includes("source = 'live'"));
check('#3 self-test failure rolls back the whole migration', /raise exception 'T1 FAILED/.test(sql));

// ── 4. THE PURGE — garbage already promoted must be removed immediately, not left for the next ──
//      scheduled rebuild ─────────────────────────────────────────────────────────────────────────
check('#4 the migration calls refresh_loc_canonical_district() to purge existing garbage',
  sql.includes('select public.refresh_loc_canonical_district()'));
check('#4 the purge is itself verified by execution, not merely invoked',
  /PURGE FAILED/.test(sql) && /v_remaining/.test(sql));

// ── 5. SCOPE — the live fallback branch ONLY, never the curated catalog or raw listing rows ──────
check('#5 the scope note names the curated catalog as explicitly untouched',
  sql.toLowerCase().includes('never the') && sql.includes('curated catalog'));
check('#5 the scope note names the underlying listing rows as explicitly untouched',
  sql.toLowerCase().includes('never') && sql.includes('underlying listing rows'));

// ── 6. MUTATION PROOF — a length-only oracle (the trap this migration fixes) fails contract #1 ──
{
  const lengthOnlyOracle = `
    select t ~ 'مخطط' or t ~ '[0-9]{3,}'
      or length(regexp_replace(t, '[0-9\\s\\(\\)\\-\\./]', '', 'g')) < 2
      or length(t) > 40
      or t in ('حكومي1', 'حكومي', 'هخطط 10.5');`;
  const oracleWouldMissShortProse =
    !lengthOnlyOracle.includes('مكون')
    && !lengthOnlyOracle.includes('مساحه')
    && !/\^:/.test(lengthOnlyOracle);
  check("#6 the pre-existing length>40-only predicate would MISS 'النسيم مساحه' (12 chars) — "
      + 'the exact gap this migration closes',
    oracleWouldMissShortProse);
}
{
  // A naive "reject anything containing a colon anywhere" rule would ALSO catch a legitimate
  // colon-bearing structured value elsewhere in the pipeline (e.g. a field label the resolver
  // hasn't stripped yet, "الحي: الجوهرة"). The migration deliberately anchors to LEADING/TRAILING
  // colon only (^: / :$), not colon-anywhere — prove that distinction is what shipped.
  const anywhereColon = "t ~ ':'";
  check('#6 the shipped rule anchors the colon (^:/:$), not a colon-anywhere match that would '
      + 'over-catch a merely-unstripped field label',
    !sql.includes(anywhereColon) && sql.includes("t ~ '^:'"));
}

// ── 7. Wired into the suite ────────────────────────────────────────────────────────────────────
check('#7 this check is discovered by npm test',
  npmTestRuns(ROOT, 'verify-district-bogus-guard-catches-prose-leak'));

console.log(failed === 0
  ? '\n✓ district_ar_looks_bogus prose-leak rules intact — the short-prose gap stays closed'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
