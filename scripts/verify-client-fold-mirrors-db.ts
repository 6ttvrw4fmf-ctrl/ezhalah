// The CLIENT folds (locations.ts norm, chatSearch normalizeArabic, translitPlace normAr) must
// mirror the DB's norm_district_tok for match-time comparisons — owner 2026-09-12: "user types
// with different spelling; our job is to match". Same fold as the picker, the search RPC, the
// resolver, the EN bridge and the agent edge arNorm.
//
// Match-only (never touches displayed text). foldArabicVariants (src/lib/arabicText.ts) is
// deliberately EXCLUDED: it is length-preserving by contract (cutPlaceName), and adding non-1:1
// folds there would break city-never-rescoped-to-district.
//
//   node --experimental-strip-types scripts/verify-client-fold-mirrors-db.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}`);
  if (!ok) failed++;
};

console.log('\nclient folds mirror the DB district token — user spelling matches our catalog\n');

const FOLDS: Array<[string, string]> = [
  ['src/data/locations.ts',  'norm (locations)'],
  ['src/lib/chatSearch.ts',  'normalizeArabic (chat)'],
  ['src/lib/translitPlace.ts','normAr (landmark)'],
];
for (const [rel, label] of FOLDS) {
  const src = readFileSync(join(root, rel), 'utf8');
  check(`${label}: ئ→ي`,             /\.replace\(\/ئ\/g, ?['"]ي['"]\)|split\(['"]ئ['"]\)\.join\(['"]ي['"]\)/.test(src));
  check(`${label}: ء dropped`,        /\.replace\(\/ء\/g, ?['"]{2}\)|split\(['"]ء['"]\)\.join\(['"]{2}\)/.test(src));
  check(`${label}: Arabic-Indic digits ٠-٩ → 0-9`, /\[٠-٩\]/.test(src));
}
// District-match path only (owner 2026-09-14, migration 20260914204035): our list never shows a
// number, so «المحمدية 1/2/3» is one entry «المحمدية» — and a user typing the number they read off
// a card must still match it. chatSearch normalises CONVERSATION TITLES and translitPlace matches a
// listing's RAW text against the static catalog json; neither is the district token, so neither
// folds digits — asserted here so the asymmetry is deliberate, not drift.
{
  const loc = readFileSync(join(root, 'src/data/locations.ts'), 'utf8');
  check('norm (locations): trailing number folded (المحمدية 2 → المحمدية)', /\.replace\(\/\[0-9\]\+\$\/, ?['"]{2}\)/.test(loc));
  check('norm (locations): LEADING number folded too (1النرجس → النرجس)', /\.replace\(\/\^\[0-9\]\+\/, ?['"]{2}\)/.test(loc));
  for (const [rel, label] of [['src/lib/chatSearch.ts', 'normalizeArabic (chat)'], ['src/lib/translitPlace.ts', 'normAr (landmark)']] as const) {
    check(`${label}: does NOT fold digits (not the district token)`,
      !/\.replace\(\/\[0-9\]\+\$\/, ?['"]{2}\)/.test(readFileSync(join(root, rel), 'utf8')));
  }
}

// EXECUTE a faithful replica of the client fold on the exact user-vs-catalog pairs the DB
// unifies — the replica MUST include every line the shape-check above pinned, so a live drift
// on any of them would still fail the shape-check first. Match-only: display never routed here.
const clientNorm = (s: string) =>
  s.toLowerCase()
   .replace(/[ً-ٟ]/g, '')
   .replace(/ـ/g, '')
   .replace(/[أإآٱ]/g, 'ا')
   .replace(/ة/g, 'ه')
   .replace(/[ىي]/g, 'ي')
   .replace(/ئ/g, 'ي')
   .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
   .replace(/ء/g, '')
   .replace(/[^\p{L}\p{N}]/gu, '')
   .replace(/^[0-9]+/, '')
   .replace(/[0-9]+$/, '');

const eqPairs: Array<[string, string, string]> = [
  ['الصفاء', 'الصفا', 'ء drop'],
  ['شرايع المجاهدين', 'شرائع المجاهدين', 'ئ→ي'],
  ['الزهراء1', 'الزهراء ١', 'digit script'],
  ['المحمدية 2', 'المحمدية', 'trailing number folded away'],
  ['البصر1', 'البصر 1', 'missing space + trailing number'],
  ['1النرجس', 'النرجس', 'number in FRONT — real production data, city 67'],
];
for (const [a, b, why] of eqPairs) {
  const na = clientNorm(a), nb = clientNorm(b);
  check(`fold unifies «${a}» ≡ «${b}» (${why}) → «${na}»`, na === nb);
}

// Discrimination — must NOT over-merge
check('fold discriminates «النرجس» ≠ «الياسمين»', clientNorm('النرجس') !== clientNorm('الياسمين'));
check('fold discriminates «مصيف الاول» ≠ «مصيف 1» (word-numerals owner-held)',
  clientNorm('مصيف الاول') !== clientNorm('مصيف 1'));

// ── MUTATION: revert each fold line, matching must go red ────────────────────────────────────
const mustCatch = (label: string, caught: boolean) => check(`MUTATION ${label}`, caught);
const removeLine = (src: string, re: RegExp): string => src.replace(re, '');
for (const [rel, label] of FOLDS) {
  const src = readFileSync(join(root, rel), 'utf8');
  const noHamza = removeLine(src, /\.replace\(\/ء\/g, ?['"]{2}\)|split\(['"]ء['"]\)\.join\(['"]{2}\)/);
  mustCatch(`${label}: dropping the ء line`,
    !/\.replace\(\/ء\/g, ?['"]{2}\)|split\(['"]ء['"]\)\.join\(['"]{2}\)/.test(noHamza));
}

console.log(failed
  ? `\n✗ verify-client-fold-mirrors-db: ${failed} check(s) failed.\n`
  : '\n✅ verify-client-fold-mirrors-db: every client match-time fold mirrors the DB.\n');
process.exit(failed ? 1 : 0);
