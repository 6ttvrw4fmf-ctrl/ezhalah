// Barrier: A WEIRD NUMBER THE SOURCE PUBLISHED IS NOT A PARSE ARTIFACT.
// Senior Production Engineer, 2026-08-26. Offline, deterministic, wired into `npm test`.
//
// WHAT THIS PROTECTS. mon_detect_field_integrity()'s bedrooms check flags "parse-artifact repair
// candidates". For 15 days it flagged 22 sanadak rows that were nothing of the kind: sanadak.sa
// publishes «... 23000 غرفة 10 حمام» in its OWN title and its OWN URL slug, and Ezhalah stored
// 23000 — exact capture. 53/53 active suspect rows on that table were corroborated by both.
// The data was right; the barrier was wrong, and a permanent false P2 makes every real one
// cheaper to ignore.
//
// bedrooms_source_corroborated() draws the line per row: a parse artifact appears in our column
// and NOWHERE in the source's own text; a source-published count appears in both.
//
// THE DANGEROUS FAILURE IS THE OTHER DIRECTION — a corroboration rule so loose it excuses real
// artifacts. The digit boundary is what stops that: a title mentioning "1700" must NOT corroborate
// a stored 700. §2 pins it, and §3 proves the rule still keeps the genuine wasalt suspects.
//
// NON-DRIFTING BY CONSTRUCTION: §2/§3 do not re-implement the predicate. They EXTRACT the two
// regex templates from the migration SQL and execute those, so editing the SQL changes what this
// test runs. A hand-copied JS port would silently pass while production diverged.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  ok   ${label}`);
  else { failures++; console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`); }
}

console.log('verify-bedrooms-source-corroboration');

// ---------------------------------------------------------------------------
// §1 — the function and the detector guard must both exist in committed SQL.
// ---------------------------------------------------------------------------
const sqlFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

const defFile = sqlFiles.filter((f) =>
  readFileSync(join(MIGRATIONS, f), 'utf8').includes('function public.bedrooms_source_corroborated'),
).pop();

check('§1 a migration defines bedrooms_source_corroborated()', !!defFile, `searched ${MIGRATIONS}`);
if (!defFile) { console.error('\nverify-bedrooms-source-corroboration: FAILED'); process.exit(1); }
console.log(`  ..   newest definition: ${defFile}`);

const sql = readFileSync(join(MIGRATIONS, defFile), 'utf8');

check(
  '§1 the detector predicate actually calls it (guard is wired, not just defined)',
  /not\s+public\.bedrooms_source_corroborated\(title,\s*listing_url,\s*bedrooms\)/.test(sql),
  'the helper exists but mon_detect_field_integrity never consults it — the false positive returns',
);
check(
  '§1 the needle-edit refuses on a non-unique anchor',
  /refusing to needle-edit/.test(sql) && /v_hits\s*<>\s*1/.test(sql),
  'without the uniqueness assertion this migration could rewrite the wrong predicate',
);
check(
  '§1 the needle-edit is idempotent (re-running is a no-op)',
  /position\('bedrooms_source_corroborated' in v_def\)\s*>\s*0/.test(sql),
);

// ---------------------------------------------------------------------------
// §2 — execute the REAL regex templates from the SQL. This is the anti-drift core.
// ---------------------------------------------------------------------------
// Matches:  '(^|[^0-9])' || p_bedrooms::text || '\s*(غرفة|...)'
const tmpl = [...sql.matchAll(/~\*\s*\('([^']*)'\s*\|\|\s*p_bedrooms::text\s*\|\|\s*'([^']*)'\)/g)]
  .map(([, pre, post]) => ({ pre, post }));

check('§2 extracted exactly two regex templates (title + url) from the SQL', tmpl.length === 2,
  `found ${tmpl.length}`);

if (tmpl.length === 2) {
  const [titleT, urlT] = tmpl;
  // POSIX ~* -> JS 'i'. \s and the alternation groups are identical in both engines.
  const corroborated = (title: string, url: string, beds: number): boolean =>
    new RegExp(titleT.pre + beds + titleT.post, 'i').test(title ?? '') ||
    new RegExp(urlT.pre + beds + urlT.post, 'i').test(url ?? '');

  const CASES: Array<[string, string, string, number, boolean]> = [
    // [label, title, url, bedrooms, expected]
    ['sanadak Arabic title (the real row)',
      'مكتب للإيجار في الرياض الروضة 23000 غرفة 10 حمام', '', 23000, true],
    ['sanadak URL slug alone',
      '', 'https://sanadak.sa/property-details/مكتب-للإيجار-في-الرياض-الروضة-23000-غرفة-10-حمام-7201073599', 23000, true],
    ['wasalt latin title, case-insensitive (the real row)',
      'Apartment with 29800 Bedrooms', '', 29800, true],
    ['wasalt latin, singular form',
      'Floor 503 SQM with 80 Bedroom', '', 80, true],
    ['DIGIT BOUNDARY: a title saying 1700 must NOT corroborate a stored 700',
      'Villa with 1700 غرفة', '', 700, false],
    ['DIGIT BOUNDARY: 23000 in title must NOT corroborate a stored 3000',
      'مكتب 23000 غرفة', '', 3000, false],
    ['the genuine wasalt suspect WST5874630 stays uncorroborated',
      'Villa 217 SQM Facing North on 24m Width Street',
      'https://wasalt.sa/en/property/villa-217-sqm-facing-north-on-24m-width-street-5874630', 700, false],
    ['the genuine wasalt suspect WST5882708 stays uncorroborated',
      'Villa 750 SQM Facing West on 16m Width Street',
      'https://wasalt.sa/en/property/villa-750-sqm-facing-west-on-16m-width-street-5882708', 74, false],
    ['a bare number with no bedroom word does NOT corroborate',
      'Building 896 SQM Facing East', '', 896, false],
    ['area in the title must not corroborate a bedroom count',
      'Villa 750 SQM Facing West', '', 750, false],
  ];

  for (const [label, title, url, beds, expected] of CASES) {
    check(`§2 ${label}`, corroborated(title, url, beds) === expected,
      `expected ${expected}, got ${!expected}`);
  }
}

// ---------------------------------------------------------------------------
// §3 — the recorded measurement. If a future edit makes this a blanket waiver, the numbers move.
// ---------------------------------------------------------------------------
check(
  '§3 the migration records the measured before/after on BOTH tables',
  /22 flagged -> 0/.test(sql) && /8 flagged -> 2/.test(sql),
  'the discriminating effect (sanadak 22->0, wasalt 8->2) is the evidence this is not a silencer',
);
check(
  '§3 the surviving wasalt suspects are named, not quietly dropped',
  /WST5874630/.test(sql) && /WST5882708/.test(sql),
);

if (failures > 0) {
  console.error(`\nverify-bedrooms-source-corroboration: ${failures} FAILED`);
  process.exit(1);
}
console.log('verify-bedrooms-source-corroboration: all checks passed');
