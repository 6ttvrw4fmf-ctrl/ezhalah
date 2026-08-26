// THE OUTBOUND TYPE EXPANSION MUST BE TOTAL — every rawType reaches `p_types` (2026-08-23)
//
//   node --experimental-strip-types scripts/verify-type-ar-expansion-total.ts   (wired into `npm test`)
//
// WHAT THIS GUARDS, AND WHY IT IS NOT ALREADY GUARDED
// ---------------------------------------------------
// `typeArForTypes()` turns the user's clean-type selection into the Arabic labels that become the
// `p_types` RPC parameter (via cohortTypesAr(), src/data/remote.ts) — the single scoping parameter
// shared by listing search, per-option counts, district counts and the AF scope counts. If a
// rawType listed in CLEAN_TO_QUERY does not resolve to a label in that expansion, every listing
// stored under it becomes silently unreachable by its own type search while still being counted in
// any broader scope. That is an UNDER-COUNT with no error and no log line.
//
// scripts/verify-taxonomy.ts already pins the INBOUND direction exhaustively (LAYER 1.B runs
// normalizeType() over every known raw × {res,com}) and pins TS↔generated-SQL map equality. Neither
// asserts that the OUTBOUND expansion is TOTAL. This closes that gap.
//
// PROVENANCE: opened as a suspected latent bug — «قصر (Palace) is missing from Villa's expansion».
// Investigation proved there is NO bug, and the assertions below encode why, so the same misreading
// cannot later be "fixed" into a real one:
//   • Scrapers translate the source's «قصر» to the ENGLISH rawType 'Palace' before storing; «قصر» is
//     never a stored type_ar (0 rows, and it appears nowhere in the taxonomy except comments).
//   • BOTH sides then fold Palace into فيلا — client EN_TO_AR['Palace']='فيلا' and the database's
//     type_label_ar('Palace')='فيلا', the table sync_search_listings_ar joins to build type_ar.
//     Verified live 2026-08-23: the two maps are byte-identical, 40/40 entries, zero divergence.
//   • So a Palace listing is stored as فيلا and IS found by a Villa search. Adding «قصر» to the
//     expansion would be dead weight that contradicts the database contract — the OPPOSITE of a fix.
// The Palace assertion below therefore pins the fold rather than the folklore.
import { CLEAN_TO_QUERY, EN_TO_AR, typeArForTypes } from '../src/data/propertyTypes.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};

// Arabic rawTypes are stored verbatim; Latin rawTypes must go through EN_TO_AR (the client mirror of
// the DB's type_label_ar). NFC because type_ar is NFC-normalized at sync while raw tables are never
// rewritten — the known شقّة/شقَّة byte-variant is a real, documented case, not a hypothetical.
const isArabic = (s: string) => /[؀-ۿ]/.test(s);
const nfc = (s: string) => s.normalize('NFC');
const expectedLabel = (raw: string): string | undefined =>
  isArabic(raw) ? raw : (EN_TO_AR as Record<string, string>)[raw];

// ── 1. TOTALITY: every rawType of every clean type reaches that type's own expansion ─────────────
const cleanTypes = Object.keys(CLEAN_TO_QUERY);
let pairs = 0;
const gaps: string[] = [];
for (const clean of cleanTypes) {
  const expansion = (typeArForTypes([clean]) ?? []).map(nfc);
  for (const raw of CLEAN_TO_QUERY[clean].rawTypes) {
    pairs++;
    const want = expectedLabel(raw);
    if (!want) { gaps.push(`«${clean}» rawType «${raw}» has NO EN_TO_AR entry — contributes nothing to p_types`); continue; }
    if (!expansion.includes(nfc(want))) gaps.push(`«${clean}» rawType «${raw}» → «${want}» absent from ${JSON.stringify(expansion)}`);
  }
}
check(`every rawType resolves into its clean type's expansion (${pairs} pairs, ${cleanTypes.length} clean types)`,
  gaps.length === 0, gaps.slice(0, 8).join('\n        '));

// ── 2. NO CLEAN TYPE EXPANDS TO NOTHING — an empty p_types silently widens the search ────────────
const empties = cleanTypes.filter((c) => !(typeArForTypes([c]) ?? []).length);
check('no clean type expands to an EMPTY label set', empties.length === 0, `empty: ${JSON.stringify(empties)}`);

// ── 3. THE LOCKED FOLDS (owner rule): قصر/Palace and بيت/House are searched as فيلا ──────────────
// Pinned so the investigation above cannot be re-litigated into a regression.
const villa = (typeArForTypes(['Villa']) ?? []).map(nfc);
check('Palace folds into فيلا, and فيلا is in Villa\'s expansion (so a Palace listing IS found)',
  EN_TO_AR['Palace'] === 'فيلا' && villa.includes('فيلا'), `EN_TO_AR.Palace=${EN_TO_AR['Palace']} villa=${JSON.stringify(villa)}`);
check('House folds to بيت and بيت is in Villa\'s expansion',
  EN_TO_AR['House'] === 'بيت' && villa.includes('بيت'), `villa=${JSON.stringify(villa)}`);
check('«قصر» is NOT a label we search for — it is the SOURCE word, translated to \'Palace\' before storage',
  !villa.includes('قصر'), `villa=${JSON.stringify(villa)} — if قصر appears here, re-read this file's header before "fixing" it`);
check('Duplex is NOT folded into Villa (it is a distinct sibling type)',
  EN_TO_AR['Duplex'] === 'دوبلكس' && !villa.includes('دوبلكس'));

// ── 4. MUTATION PROOF — assertion 1 must actually FAIL when the invariant breaks ─────────────────
// Simulates the exact regression this exists for: a rawType added to CLEAN_TO_QUERY whose EN_TO_AR
// entry is missing, so it contributes nothing to p_types and its listings go quietly unreachable.
{
  const detects = (raw: string, expansion: string[]) => {
    const want = expectedLabel(raw);
    return !want || !expansion.map(nfc).includes(nfc(want));
  };
  check('MUTATION: an unmapped rawType is DETECTED (blind barrier would pass it)',
    detects('Mansion', villa) === true);
  check('CONTROL: a correctly-mapped rawType is NOT flagged',
    detects('Palace', villa) === false && detects('House', villa) === false);
}

console.log(failed ? `\n${failed} FAILED` : `\nAll type-expansion assertions passed (${pairs} rawType pairs total)`);
process.exit(failed ? 1 : 0);
