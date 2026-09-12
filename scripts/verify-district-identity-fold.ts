// DISTRICT IDENTITY FOLD (owner decision 2026-09-12): one real district = ONE search identity per
// city. Spelling twins — trailing/medial ء (صفا/الصفاء 3,036 rows in جدة, حمرا/حمراء 2,710 in
// الخبر), ئ/ي (شرائع/شرايع), Arabic-Indic vs glued ASCII digits (الزهراء ١/الزهراء1), and
// tashkeel-in-token (حي الصقًار matched 0 live rows, ever) — must all fold to one token INSIDE
// norm_district_tok, so the picker, the search filter, resolve_district_ar and the EN bridge agree.
// The old state kept a picker-only 'ء$' patch: a second copy of identity that left every deeper
// layer split (and made the EN bridge call one district "ambiguous" and refuse to translate it).
//
// SCOPE GUARD (the owner's own rule): identity is region → city → district. normalize_ar must stay
// un-folded — 11 different Saudi towns are named الروضة across 5 regions, so a folded CITY match
// would merge genuinely different places. The fold may exist only inside the district token, which
// is always evaluated under a city_id.
//
// This guard is hermetic (no network): it pins the committed repair recipe — the fold components,
// the mandatory REINDEX (an expression index over an IMMUTABLE fn does not self-invalidate), every
// dependent rebuild, and the lock-refusal abort on the label backfill. The LIVE half of the barrier
// is mon_detect_district_identity_split (companion migration), which executes the real fn on the
// twin spellings on the detector roster schedule — this file pins that the companion actually
// ships that way.
//
//   node --experimental-strip-types scripts/verify-district-identity-fold.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

console.log('\ndistrict spelling twins fold to ONE identity per city, with a live detector watching\n');

const MIG_DIR = join(root, 'supabase/migrations');
const migrations = readdirSync(MIG_DIR);
const REPAIR = '20260912172542_district_identity_fold_one_place_one_token.sql';
const COMPANION = '20260912172705_district_identity_fold_gets_a_detector.sql';

check('the fold migration is committed', migrations.includes(REPAIR), `${REPAIR} not found`);
check('the detector companion is committed', migrations.includes(COMPANION), `${COMPANION} not found`);

const sql = migrations.includes(REPAIR) ? readFileSync(join(MIG_DIR, REPAIR), 'utf8') : '';
const det = migrations.includes(COMPANION) ? readFileSync(join(MIG_DIR, COMPANION), 'utf8') : '';

// ── the fold itself: every component, verbatim, in the committed fn body ──────────────────────────
const foldComponents = (s: string) => ({
  tashkeel: s.includes("'[ًٌٍَُِّْٰ]', '', 'g'"),
  hamzaDigits: s.includes("'ئ٠١٢٣٤٥٦٧٨٩', 'ي0123456789'"),
  dropHamza: s.includes("'ء',''"),
  glueSplit: s.includes("'([ء-ي])([0-9])', '\\1 \\2', 'g'"),
  prefix: s.includes("'^(حي\\s+)+', ''") && s.includes("'^ال', ''"),
});
{
  const c = foldComponents(sql);
  check('tashkeel is stripped from the token', c.tashkeel);
  check('ئ→ي and Arabic-Indic digits →ASCII are translated', c.hamzaDigits);
  check('ء is dropped (صفا/صفاء, حمرا/حمراء become one token)', c.dropHamza);
  check('a glued letter-digit boundary is split (الزهراء1 ≡ الزهراء ١)', c.glueSplit);
  check('the حي/ال prefix strip survives from the pre-fold definition', c.prefix);
}

check('normalize_ar itself is NOT redefined here (city identity stays city_id-scoped — '
    + '11 towns named الروضة in 5 regions must never merge)',
  !/create\s+or\s+replace\s+function\s+public\.normalize_ar/i.test(sql),
  'this migration touches the SHARED city normalizer — that is out of the approved scope');

// ── the dependent rebuilds: a body-only fn change leaves every stored surface silently stale ──────
check('the expression index is REINDEXed in the SAME migration',
  /reindex index public\.idx_slar_district_tok;/i.test(sql));
check('loc_catalog_district is deduped AND its stored norm re-derived',
  /delete from public\.loc_catalog_district/.test(sql)
  && /set district_norm = public\.norm_district_tok\(district_ar\)/.test(sql));
check('the canonical match-truth table is fully rebuilt',
  /select public\.refresh_loc_canonical_district\(\);/.test(sql));
check('display canon: stale pre-fold keys are purged BEFORE its refresh (its upsert never removes them)',
  /delete from public\.loc_display_district_canon\s*\n\s*where district_norm is distinct from public\.norm_district_tok\(display_ar\);/.test(sql)
  && /select public\.refresh_loc_display_district_canon\(\);/.test(sql));
check('the EN bridge is rebuilt (n_distinct collapses — un-blocks refused translations)',
  /select public\.refresh_bridge_en_district\(\);/.test(sql));
check('the label backfill ABORTS when search_index_writer_lock refuses (an empty return must not '
    + 'silently pass — the sync_search_listings_ar trap, 2026-09-11 audit)',
  /backfill_location_display_labels returned nothing/.test(sql));

// ── the migration proves itself in-transaction ────────────────────────────────────────────────────
check('in-migration proof: picker row == independent recount for jeddah صفا, single match value',
  /jeddah صفا picker proof failed/.test(sql) && /v_cnt <> v_expected/.test(sql));
check('in-migration proof: discrimination (word-numeral twins مصيف الاول/مصيف 1 stay DISTINCT — owner-held)',
  sql.includes("norm_district_tok('مصيف الاول') = public.norm_district_tok('مصيف 1')"));
check('in-migration proof: resolver depth (resolve_district_ar unifies both spellings)',
  /resolve_district_ar still splits the spellings/.test(sql));

// ── the standing live half: the companion detector ────────────────────────────────────────────────
check('companion defines mon_detect_district_identity_split',
  /create or replace function public\.mon_detect_district_identity_split\(\)/.test(det));
check('detector limb A EXECUTES the real fn on the twin spellings (a comment is not a code path; '
    + '0 collisions is exactly what a LOST fold reports, so the fn probe is the load-bearing limb)',
  det.includes("norm_district_tok('الصفاء')") && det.includes("norm_district_tok('حي الصفا')"));
check('detector also fires on OVER-merge (مصيف الاول vs مصيف 1 must stay distinct)',
  det.includes("norm_district_tok('مصيف الاول') is not distinct from public.norm_district_tok('مصيف 1')"));
check('detector is roster-wired by needle-edit on a unique anchor (never a wholesale rewrite)',
  /mon_detect_remal_native_location_regressed/.test(det) && /refusing blind edit/.test(det));
check('companion runs the detector GREEN in the same migration',
  /raised % on freshly-repaired state/.test(det));

// ── the AGENT hears the fold too (owner 2026-09-12: «people can say it in both ways … that
// shouldn't stop them») ───────────────────────────────────────────────────────────────────────────
const AGENT_MIG = '20260912181017_loc_classify_speaks_the_folded_district_token.sql';
check('the loc_classify fold migration is committed', migrations.includes(AGENT_MIG), `${AGENT_MIG} not found`);
const cls = migrations.includes(AGENT_MIG) ? readFileSync(join(MIG_DIR, AGENT_MIG), 'utf8') : '';
const clsFolded = (s: string) =>
  (s.match(/public\.norm_district_tok\(d\.district_ar\)/g) ?? []).length >= 1
  && (s.match(/public\.norm_district_tok\(v\.district_ar\)/g) ?? []).length >= 1;
check('loc_classify matches district CANDIDATES and INVENTORY via norm_district_tok (no private copy)',
  clsFolded(cls));
check('loc_classify city arm still speaks normalize_ar (city identity stays city_id-scoped)',
  cls.includes('normalize_ar(c.city_ar) = tok_norm'));
check('the migration proves the three spellings see ONE city set, in-transaction',
  /identity is still split/.test(cls) && cls.includes("loc_classify('صفا')"));

const agentSrc = readFileSync(join(root, 'supabase/functions/agent/index.ts'), 'utf8');
const arNormFolded = (s: string) => {
  const m = s.match(/function arNorm\(s: string\): string \{[\s\S]*?\n\}/);
  const body = m ? m[0] : '';
  return body.includes('.replace(/ئ/g, "ي")') && body.includes('.replace(/ء/g, "")')
    && body.includes('٠١٢٣٤٥٦٧٨٩');
};
check('the agent edge arNorm folds like the district token (answers spelled «الاحسا»/«صفاء»/«شرايع» '
    + 'still match their candidate instead of re-asking)',
  arNormFolded(agentSrc));

// ── MUTATION PROOF — each pinned property must actually be able to fail ───────────────────────────
const mustCatch = (label: string, checkPassesOnBrokenInput: boolean) => {
  check(`MUTATION ${label} — the check catches it`, checkPassesOnBrokenInput === false,
    'the check passed on the deliberately broken shape, so it cannot catch a regression');
};

// (a) the pre-fold fn body (what a well-meaning "simplification" would revert to): every fold
// component check must go red on it.
const PRE_FOLD_BODY = `
create or replace function public.norm_district_tok(t text)
returns text language sql immutable as $function$
  select regexp_replace(regexp_replace(public.normalize_ar(coalesce(t,'')), '^(حي\\s+)+', ''), '^ال', '');
$function$;
reindex index public.idx_slar_district_tok;
`;
{
  const c = foldComponents(PRE_FOLD_BODY);
  mustCatch('the pre-fold body has no tashkeel strip', c.tashkeel);
  mustCatch('the pre-fold body has no ئ/digit translate', c.hamzaDigits);
  mustCatch('the pre-fold body keeps ء (صفا and صفاء stay two identities)', c.dropHamza);
  mustCatch('the pre-fold body never splits glued digits', c.glueSplit);
}

// (b) a body-only fix with the REINDEX stripped out must fail the REINDEX check.
const NO_REINDEX = sql.replace(/reindex index public\.idx_slar_district_tok;/i, '');
mustCatch('stripping the REINDEX from the committed recipe',
  /reindex index public\.idx_slar_district_tok;/i.test(NO_REINDEX));

// (c) softening the backfill's lock-refusal abort into a silent return must fail its check.
const SILENT_BACKFILL = sql.replace(/backfill_location_display_labels returned nothing[^']*/, 'ok then return');
mustCatch('softening the lock-refusal abort into a silent pass',
  /backfill_location_display_labels returned nothing/.test(SILENT_BACKFILL));

// (d) a companion whose detector only counts rows (drops the fn-execution limb) must fail limb A's
// check — that mutant goes blind exactly when the fold is lost.
const COUNT_ONLY_DETECTOR = det.replace(/norm_district_tok\('الصفاء'\)/g, "'صفا'");
mustCatch('a detector that stops executing the real fn on the twin spellings',
  COUNT_ONLY_DETECTOR.includes("norm_district_tok('الصفاء')"));

// (e) a loc_classify reverted to its pre-fold district arms (normalize_ar comparisons) must fail
// the clsFolded pin — this is the exact "third private copy" shape the fix removed.
const PRE_FOLD_CLASSIFY = cls
  .replace(/public\.norm_district_tok\(d\.district_ar\)/g, 'normalize_ar(d.district_ar)')
  .replace(/public\.norm_district_tok\(v\.district_ar\)/g, "normalize_ar(coalesce(v.district_ar,''))");
mustCatch('loc_classify reverting its district arms to the city normalizer',
  clsFolded(PRE_FOLD_CLASSIFY));

// (f) an agent edge whose arNorm loses the fold lines must fail the arNorm pin.
const PRE_FOLD_ARNORM = agentSrc
  .replace('.replace(/ئ/g, "ي")\n', '')
  .replace('.replace(/ء/g, "")\n', '');
mustCatch('the agent edge arNorm losing its ء/ئ fold lines',
  arNormFolded(PRE_FOLD_ARNORM));

console.log(failed
  ? `\n✗ verify-district-identity-fold: ${failed} check(s) failed.\n`
  : '\n✅ verify-district-identity-fold: one place = one token per city, recipe pinned, detector watching.\n');
process.exit(failed ? 1 : 0);
