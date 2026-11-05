// THE MAIN FILTER'S «الأثاث» ROW (owner 2026-11-05: «put it in the main filter … the number depending on the district
// and city they choose … in case the user doesn't select it show it again in the advanced filter»).
//
// What this pins, by EXECUTING the code where it can and reading the source where it cannot:
//   1. WHERE it shows: yearly rent homes only — exactly where the furnished question is certified (cohortAllows), so the
//      row and the filter question can never disagree about which scopes have a furnished answer. Not Buy, not short
//      stays, not commercial.
//   2. The row asks the gate LAZILY (import('@/lib/afCohorts')) — a static import would put the whole cohort table in the
//      home page's first download (ALWAYS FAST: web entry ≤ 1,100 KB brotli).
//   3. Its counts are the scope's own (fetchApartmentGuidedCounts over the current query) with furniture left OPEN, so
//      «الكل / مفروشة / غير مفروشة» always show three real numbers; a failed count shows NO number, never a 0.
//   4. A hidden row clears furnishedPref (no invisible filter), and the restore allowlist carries it (a visible control).
//   5. The filter question asks only when the row was left on «الكل» (furnishedPref == null) — never twice.
//   6. One wording everywhere: «مفروشة / غير مفروشة»; the three icons exist and stay small.
//
//   node --experimental-strip-types scripts/verify-main-filter-furniture.ts   (in `npm test`)
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cohortAllows } from '../src/lib/afCohorts.ts';
import { sanitizeForFilterRestore, HOME_DEFAULT_QUERY } from '../src/lib/searchDefaults.ts';
import type { SearchQuery } from '../src/data/search.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
  if (!ok) failures++;
};

// ── 1. where it shows (executed) ─────────────────────────────────────────────────────────────────────
const base = { ...HOME_DEFAULT_QUERY(), location: 'الرياض' } as SearchQuery;
const Q = (q: Partial<SearchQuery>) => ({ ...base, ...q }) as SearchQuery;
const yearly = (types: string[]) => Q({ deal: 'Rent', rentPeriod: 'annual', category: 'Residential', types });
for (const t of ['Apartment', 'Floor', 'Room', 'Studio', 'Villa', 'Duplex', 'Residential Building']) {
  check(`yearly rent → ${t}: the furnished answer is offered`, cohortAllows(yearly([t]), 'furnished'));
}
check('yearly rent → the «Apartments & Co-living» box (no type): offered',
  cohortAllows(Q({ deal: 'Rent', rentPeriod: 'annual', category: 'Residential', typeGroups: ['Apartments & Co-living'] }), 'furnished'));
check('Buy → Apartment: NOT offered', !cohortAllows(Q({ deal: 'Buy', category: 'Residential', types: ['Apartment'] }), 'furnished'));
check('short stays → Apartment: NOT offered (Gathern / Aqar Monthly)',
  !cohortAllows(Q({ deal: 'Rent', rentPeriod: 'monthly', category: 'Residential', types: ['Apartment'] }), 'furnished'));

// ── 2–4. the row in the main filter (source) ─────────────────────────────────────────────────────────
const home = read('src/app/index.tsx');
const rowGate = /const furnCanAsk = query\.deal === 'Rent' && !query\.dealCombined && validRentPeriod\(query\.rentPeriod\) === 'annual' && query\.category === 'Residential';/;
check('the row is gated on yearly rent + residential before anything is fetched', rowGate.test(home));
check('the row asks cohortAllows(…, \'furnished\') through a LAZY import',
  /await import\('@\/lib\/afCohorts'\)/.test(home) && /cohortAllows\(furnBase, 'furnished'\)/.test(home));
check('index.tsx never imports afCohorts statically (first-download weight)', !/^import[^\n]*afCohorts/m.test(home));
check('counts are the scope\'s own with furniture left open (furnBase = query minus furnishedPref)',
  /const furnBase = \{ \.\.\.query, furnishedPref: null \};/.test(home) && /fetchApartmentGuidedCounts\(furnBase\)/.test(home));
check('a failed count shows the choices WITHOUT numbers (never a 0)',
  /c && !isProbeFailure\(c\)[\s\S]{0,140}: \{\}\);/.test(home) && /if \(live\) setFurnRow\(\{\}\);/.test(home)
  && /n == null \? null :/.test(home));
check('a hidden row clears furnishedPref (no invisible filter)',
  /if \(furnRow === null && query\.furnishedPref != null\) setQuery\(\(q\) => \(\{ \.\.\.q, furnishedPref: null \}\)\);/.test(home));
check('the three choices write furnishedPref null / true / false',
  /\['any', null, 'Furniture: all'[\s\S]{0,120}\['yes', true, 'Furniture: furnished'[\s\S]{0,120}\['no', false, 'Furniture: unfurnished'/.test(home)
  && /setQuery\(\(q\) => \(\{ \.\.\.q, furnishedPref: pref, furnishedIn: null \}\)\)/.test(home));
check('the row sits right under the bedroom chips, above the area range',
  home.indexOf("t('Bedrooms')") < home.indexOf("testID=\"filter-furniture\"") && home.indexOf("testID=\"filter-furniture\"") < home.indexOf("t('Area (m²)')"));
const restored = sanitizeForFilterRestore({ ...base, deal: 'Rent', rentPeriod: 'annual', types: ['Apartment'], furnishedPref: false } as SearchQuery);
check('the restore allowlist carries furnishedPref (a visible control now)', restored.furnishedPref === false, JSON.stringify(restored.furnishedPref));

// ── 5. the filter question only when the row was left on «الكل» ──────────────────────────────────────
const af = read('src/data/advancedFilters.ts');
const furnQ = af.slice(af.indexOf('const FURNISHED_QUESTION'), af.indexOf('const FURNISHED_QUESTION') + 1600);
check('the furnished question is skipped when the main filter already answered it',
  /eligibility: \(q\) => cohortAllows\(q, 'furnished'\) && q\.furnishedPref == null/.test(furnQ));

// ── 6. one wording, small icons ──────────────────────────────────────────────────────────────────────
const i18n = read('src/i18n.tsx');
for (const [k, ar] of [['Furniture: furnished', 'مفروشة'], ['Furniture: unfurnished', 'غير مفروشة'], ['Furniture: all', 'الكل'], ['Furnished or unfurnished?', 'مفروشة أو غير مفروشة؟']]) {
  check(`«${ar}» is the Arabic of '${k}'`, new RegExp(`'${k.replace(/[?]/g, '\\?')}':\\s*'${ar.replace(/[?]/g, '\\?')}'`).test(i18n));
}
check('the furnished question and the row use the SAME labels',
  /labelKey: 'Furniture: furnished'/.test(furnQ) && /labelKey: 'Furniture: unfurnished'/.test(furnQ));
for (const f of ['furn-any', 'furn-yes', 'furn-no']) {
  const size = statSync(join(root, 'assets/icons', `${f}.png`)).size;
  check(`assets/icons/${f}.png exists and is small (${size} B ≤ 12 KB)`, size > 0 && size <= 12_000);
}

// ── mutation proofs: the source checks above must FAIL on the defect they name ───────────────────────
const mutants: Array<[string, string, RegExp]> = [
  ['the question asks twice', furnQ.replace(' && q.furnishedPref == null', ''), /eligibility: \(q\) => cohortAllows\(q, 'furnished'\) && q\.furnishedPref == null/],
  ['the row counts with the user\'s own furniture pick', home.replace('fetchApartmentGuidedCounts(furnBase)', 'fetchApartmentGuidedCounts(query)'), /fetchApartmentGuidedCounts\(furnBase\)/],
  ['a hidden row keeps its filter', home.replace('if (furnRow === null && query.furnishedPref != null)', 'if (false)'), /if \(furnRow === null && query\.furnishedPref != null\)/],
];
for (const [name, src, rx] of mutants) check(`(mutation) caught: ${name}`, !rx.test(src));

console.log(failures === 0 ? '\n✅ the main filter\'s «الأثاث» row: yearly homes only, live scope counts, asked once.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
