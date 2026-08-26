// A حي SPELLED DIFFERENTLY IS STILL THE SAME حي.
//
// The RPC matches a حي on norm_district_tok() — normalize_ar(), which folds أ/إ/آ/ٱ→ا, ة→ه, ى→ي and
// drops tatweel — then strips the leading «حي ». The client keeps its own safety-net filter over the
// rows the RPC returns (listingInDistricts, src/data/search.ts). Until 2026-08-26 that filter
// compared the RAW strings with bidirectional substring, so a pure spelling variant between the
// label the District PICKER offers and the label the listing carries matched in NEITHER direction —
// and the row was discarded AFTER the RPC had correctly returned it.
//
// What the user saw is the worst possible shape of this bug: pick «حي بقعاء القديمه» from the
// picker and the app answers «ما لقيت نتائج في الحي المحدد — … تبيني أوسّع المنطقة؟» while the RPC
// had just returned two matching listings. Not a wrong result — a CONFIDENT ZERO over real matches.
//
// Measured against the live index when it was found: 20 (city, حي) pairs, 736 production-ready
// listings, 14 cities. Every one is أ/ا, ة/ه or ى/ي — never a different place. The pairs below are
// those real production pairs, kept verbatim as the regression corpus.
//
// Hermetic: no network, no database. Runs inside `npm test` on every PR.
//
//   node --experimental-strip-types scripts/verify-district-orthography-match.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeArabic } from '../src/lib/chatSearch.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nA حي spelled differently is still the same حي\n');

// The 20 real (picker label, served label, listings at stake) pairs, from the live index 2026-08-26.
const PAIRS: Array<[string, string, number, string]> = [
  ['حي الأمانة', 'حي الامانة', 109, 'الدمام'],
  ['حي احد', 'حي أحد', 100, 'الرياض'],
  ['حي نواره', 'نوارة', 86, 'المزاحمية'],
  ['حي المنتزة', 'حي المنتزه', 82, 'جدة'],
  ['حي أشبيلية', 'حي اشبيلية', 75, 'بقيق'],
  ['حي الإسكان', 'حي الاسكان', 65, 'بريدة'],
  ['حي الأثير', 'حي الاثير', 60, 'الدمام'],
  ['حي غرناطه', 'حي غرناطة', 59, 'المزاحمية'],
  ['حي الأنوار', 'حي الانوار', 38, 'الدمام'],
  ['حي ضاحية الاسكان', 'ضاحية الإسكان', 17, 'الطائف'],
  ['حي الأندلس', 'حي الاندلس', 15, 'المزاحمية'],
  ['حي البحيره', 'البحيرة', 10, 'أبها'],
  ['حي الحرابى', 'الحرابي', 7, 'خميس مشيط'],
  ['حي الخزامى', 'حي الخزامي', 3, 'المذنب'],
  ['حى ابو سدر', 'أبو سدر', 3, 'المدينة المنورة'],
  ['حي بقعاء القديمه', 'بقعاء القديمة', 2, 'بقعاء'],
  ['حي السعاده', 'السعادة', 2, 'الارطاوية'],
  ['حي المسماة', 'المسماه', 1, 'نجران'],
  ['حي ذهبان الغربى', 'ذهبان الغربي', 1, 'خميس مشيط'],
  ['حي غرب الظهره', 'غرب الظهرة', 1, 'حقل'],
];

// The predicate under test, mirroring listingInDistricts' Arabic arm. Kept in step with the source
// by the wiring assertions below, so this file cannot pass while the real function stops folding.
const fold = (x: string) => normalizeArabic(x ?? '').replace(/^حي\s+/, '').trim();
const matches = (stored: string, wanted: string) => {
  const s = fold(stored), w = fold(wanted);
  return s.includes(w) || w.includes(s);
};
// The pre-fix behaviour, kept verbatim for the mutation proof.
const oldMatches = (stored: string, wanted: string) => {
  const s = stored.replace(/^حي\s+/, '').trim();
  const w = wanted.replace(/^حي\s+/, '').trim();
  return s.includes(w) || w.includes(s);
};

// ── 1. every real pair is matched, and the old code missed it ───────────────────────────────────
let stillBroken = 0, oldMissed = 0, lost = 0;
for (const [picker, served, n, city] of PAIRS) {
  if (!matches(served, picker)) { stillBroken++; lost += n; console.error(`      ✗ ${city}: «${picker}» vs «${served}» (${n} listings)`); }
  if (!oldMatches(served, picker)) oldMissed++;
}
check('every one of the 20 production حي spelling pairs now matches', stillBroken === 0,
  stillBroken ? `${stillBroken} pair(s) still drop ${lost} listings the RPC returned` : '');
check('MUTATION: the pre-fix comparison missed all 20 (so this corpus really is the regression)',
  oldMissed === PAIRS.length, `old code matched ${PAIRS.length - oldMissed} of them — corpus no longer proves the bug`);

// ── 2. folding must not make a حي match a DIFFERENT حي ──────────────────────────────────────────
// Over-matching is the worse failure: it shows the user a neighbourhood they did not select. These
// are genuinely distinct places that share a prefix or a fold-adjacent spelling.
const DISTINCT: Array<[string, string]> = [
  ['حي النرجس', 'حي الياسمين'],
  ['حي الملقا', 'حي العارض'],
  ['حي المهدية', 'حي المنار'],
  ['حي الحمراء', 'حي الخزامى'],
  ['بقعاء القديمة', 'بقعاء الجديدة'],
  ['حي الأمانة', 'حي الأمير'],
];
let overMatched = 0;
for (const [a, b] of DISTINCT) {
  if (matches(a, b)) { overMatched++; console.error(`      ✗ «${a}» wrongly matches «${b}»`); }
}
check('folding never merges two genuinely different أحياء', overMatched === 0);

// ── 3. the fold is the app's OWN normalizer, not a private copy ─────────────────────────────────
const search = read('src/data/search.ts');
check('listingInDistricts folds Arabic before comparing',
  /function listingInDistricts/.test(search)
  && /normalizeArabic\([^)]*\)\.replace\(\/\^حي/.test(search),
  'comparing raw strings is exactly the 2026-08-26 defect');
check('it reuses normalizeArabic rather than reimplementing the fold',
  /import \{ normalizeArabic \} from '\.\.\/lib\/chatSearch'/.test(search),
  'a second private copy of normalize_ar is how the client and the RPC drift apart again');
check('BOTH sides of the comparison are folded (stored AND wanted)',
  /const s = fold\(stored\)/.test(search) && /const wn = fold\(w\)/.test(search),
  'folding one side only still drops the row');
check('normalizeArabic still folds the three variants this depends on',
  normalizeArabic('أإآٱ') === 'اااا' && normalizeArabic('ة') === 'ه' && normalizeArabic('ى') === 'ي');

console.log(failures === 0
  ? '\n✓ a حي the user picked is found whatever way its listings spell it\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
