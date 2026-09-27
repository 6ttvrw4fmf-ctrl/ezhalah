// NO e2e SUITE MAY RESTATE THE ZERO-STATE VOCABULARY BY HAND.
//
//   node --experimental-strip-types scripts/verify-zero-vocabulary-is-derived-not-restated.ts  (npm test)
//
// WHY, measured three times in two days. The app's catch-all no-results sentence became an 80-template
// ROTATION on 2026-09-26 (src/data/noResultsRotation.ts, owner rule). Every harness that had written
// the zero wording out by hand instantly stopped recognising an honest zero — and, because "the
// product said nothing about having no results" is an ACCUSATION, each one blamed production for
// being dishonest while production was behaving exactly as specified.
//
//   2026-09-27, PR #4890   e2e/live-sweep/  — two copies. The settle clock timed out on ثادق and the
//                          sweep went RED on a healthy honest zero.
//   2026-09-27, this file  e2e/guardian/    — the THIRD copy, `['ما فيه نتائج','ما لقيت','ما لقينا']`.
//                          guardian-journeys.yml run 36313435466: FAIL 2/2 (desktop + mobile) while
//                          the other 14 journeys passed, and it FILED ops_incident #852 and #853
//                          against the product. Production had answered «ما طلع لنا تطابق في بحث
//                          العقار، جرّب توسّع نطاق البحث وإزهله 😢» — an honest zero whose opening
//                          phrase no entry in that list contains.
//
// #4890 wrote down the right lesson — «derive the predicate from the shipped pool, never restate it»
// — and repaired the two copies in front of it. Nothing in the repo connected them to the third, one
// directory over, so the lesson did not travel. That is the AGENTS.md PART 1.11 shape: the fix read
// as coverage of the class. This file is the class.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { zeroRendered, shippedNoResultsTemplates } from '../e2e/lib/resultsSentence.mjs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertions above are blind to the defect this file exists to catch');

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('§1  THE DERIVED PREDICATE, EXECUTED against the sentences production really serves');

// The exact sentence that took the live sweep and the guardian suite red, both on 2026-09-27.
const PROD_ZERO = 'ما طلع لنا تطابق في بحث العقار، جرّب توسّع نطاق البحث وإزهله 😢';
// The sibling that the hand-written lists DID catch — it must not regress.
const PROD_ZERO_OLD_FAMILY = 'ما لقينا تطابق لطلب بحثك، جرب توسع نطاق البحث';
// A district-scoped honest zero (the «ما لقيت» family sweep.mjs records at :697).
const PROD_ZERO_DISTRICT = 'ما لقيت نتائج في الحي المحدد — لكن فيه خيارات في أحياء ثانية بنفس المدينة.';
// A RESULTS screen. Widening the zero predicate until this matches would silently convert every
// successful search into "the product said there is nothing", which is the opposite failure.
const PROD_RESULTS = 'لقينا 1,240 إعلان';

check('1.1  the shipped zero pool parses completely (80 templates, 40 ar + 40 en)',
  shippedNoResultsTemplates().length === 80, `got ${shippedNoResultsTemplates().length}`);
check('1.2  the production sentence that took both suites red IS recognised',
  zeroRendered(PROD_ZERO));
check('1.3  the older family the hand-written lists caught is still recognised (no regression)',
  zeroRendered(PROD_ZERO_OLD_FAMILY) && zeroRendered(PROD_ZERO_DISTRICT));
check('1.4  a RESULTS screen is NOT read as a zero (the predicate did not widen into a lie)',
  !zeroRendered(PROD_RESULTS));
check('1.5  every shipped template is recognised, with its placeholders filled as a user sees them',
  shippedNoResultsTemplates().every((t) =>
    zeroRendered(String(t.template).replace(/\{[a-zA-Z_]+\}/g, 'سالم'))),
  'a template in the shipped pool is not matched by the predicate built from that same pool');

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n§1b MUTATION PROOF — the pre-fix hand-written list is watched FAILING');
// This is the whole point: the defect is not hypothetical, and §1 must be able to see it.
const PRE_FIX_LIST = ['ما فيه نتائج', 'ما لقيت', 'ما لقينا'];
const preFix = (text: string) => PRE_FIX_LIST.some((p) => text.includes(p));
mustCatch("the guardian's pre-fix hand-written list, on the real production sentence",
  preFix(PROD_ZERO) === false && zeroRendered(PROD_ZERO) === true);
mustCatch('the pre-2026-09-27 live-sweep ZERO_RE, on the same sentence',
  /ما لقينا|ما لقيت|ما فيه نتائج|ما فيه إعلانات/.test(PROD_ZERO) === false && zeroRendered(PROD_ZERO));
// A predicate that says "everything is a zero" would pass §1.2/1.3 and is a worse lie than the bug.
mustCatch('a predicate so wide it calls a results screen a zero',
  zeroRendered(PROD_RESULTS) === false);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n§2  THE CLASS — no suite may carry its own copy of the vocabulary');
// Discovered BY SHAPE over e2e/, not from a list anyone has to remember to extend: any Arabic string
// literal that is recognisably a zero-state phrase, in a file that is not the one place allowed to
// hold them. A fourth copy added tomorrow is RED until someone either derives it or states why.
const DERIVED_HOME = 'e2e/lib/resultsSentence.mjs';
// The phrase FRAGMENTS a hand-written zero list is built from. Deliberately the openings, because
// that is what every one of the three copies actually contained.
const ZERO_FRAGMENT = /['"`][^'"`]*(ما لقينا|ما لقيت|ما فيه نتائج|ما فيه إعلانات|ما طلع لنا|لا توجد نتائج|لا توجد إعلانات)/;

// Files that legitimately mention a zero phrase for a reason other than deciding zero-ness. Each
// entry is a STATEMENT, and §2b fails if one becomes stale — so this cannot rot into a graveyard.
const ACCOUNTED: Record<string, string> = {
  'e2e/lib/resultsSentence.mjs':
    'the one derived home: ZERO_RE (the MSA family the rotation does not own) plus the pool parser',
  'e2e/live-sweep/sweep.mjs':
    'SETTLED_RE and its header quote production sentences as DOCUMENTATION of why the clock is '
    + 'derived; the live clock itself comes from settledSource() (PR #4890)',
};

const walk = (d: string, out: string[] = []): string[] => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|ts|js)$/.test(p)) out.push(p);
  }
  return out;
};

const offenders: string[] = [];
for (const f of walk('e2e')) {
  const norm = f.split(/[\\/]/).join('/');
  if (norm in ACCOUNTED) continue;
  // Comment lines are excluded: this repo documents these sentences at length, and a corpus built
  // from raw text would flag every file that merely EXPLAINS the hazard — the mistake
  // verify-e2e-targets-still-exist-in-the-product.ts records.
  const code = readFileSync(f, 'utf8').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  if (ZERO_FRAGMENT.test(code)) offenders.push(norm);
}
check('2.1  no e2e suite restates the zero vocabulary in code',
  offenders.length === 0,
  offenders.length
    ? `RESTATED IN: ${offenders.join(', ')}\n        `
      + `Import { zeroRendered } from '${DERIVED_HOME}' instead. The app's zero sentence is an `
      + '80-template rotation the owner may extend at any time; a hand-written copy stops matching '
      + 'silently and then ACCUSES the product of dishonesty (ops_incident #852, #853). If a literal '
      + 'here is genuinely not deciding zero-ness, add it to ACCOUNTED saying what it is for.'
    : '');

const stale = Object.keys(ACCOUNTED).filter((f) => {
  try { return !ZERO_FRAGMENT.test(readFileSync(f, 'utf8')); } catch { return true; }
});
check('2.2  no stale ACCOUNTED entry (shrink-only: a file that stopped holding one must leave)',
  stale.length === 0, stale.length ? `stale: ${stale.join(', ')}` : '');

// And the suite that was red must actually be wired to the derived predicate, not merely cleaned of
// literals — deleting the list without importing the pool would pass §2.1 and assert nothing.
const guardian = readFileSync('e2e/guardian/journeys.mjs', 'utf8');
check('2.3  the guardian suite DELEGATES to the derived predicate',
  /from '\.\.\/lib\/resultsSentence\.mjs'/.test(guardian) && /zeroRendered/.test(guardian),
  'e2e/guardian/journeys.mjs must import zeroRendered rather than test for phrases itself');

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
