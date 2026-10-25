// «مفروشة: لا» IS A NO, NEVER A YES (facts test 2026-10-24, run facts-test-2026-10-24).
// The shared prose reader (scrapers/common/normalize.py amenities_from_text) only looked for a negator BEFORE a token, so a
// LABELLED answer — «مفروشة: لا», «**مفروش:** لا», «المفروشات: غير مفروش», «مؤثثة: غير مؤثثة» — read furnished = YES.
// muhaysini's generated «أبرز ملامح العقار» list served ~1,060 active ads that way. The phrases below are verbatim from
// production rows (MHS15558, MHS29186, MHS15924, MHS17681, MHS21015). EXECUTED against the real function, then against
// mutated copies of normalize.py: each mutant puts one half of the old defect back and must turn this check red.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';

const ROOT = join(import.meta.dirname, '..');
const MOD = 'scrapers.common.normalize';
const SRC = readFileSync(join(ROOT, 'scrapers/common/normalize.py'), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nA labelled «لا» is a NO\n');

// [phrase, expected furnished] — true / false / null (null = the ad did not answer: NULL, never a guess)
const CASES: [string, boolean | null][] = [
  ['- عدد الحمامات: 5 - مفروشة: لا - للا بيع: نعم', false],
  ['- **مفروش:** لا **المرافق:** - الكهرباء', false],
  ['- المفروشات: غير مفروش - السعر: 3,500,000 ريال سعودي', false],
  ['- الحمامات: 0 - مؤثثة: غير مؤثثة - السعر: 58,000 ريال سعودي سنويًا', false],
  ['مفروشة: لا (غير مفروشة)', false],
  ['- **مفروشة**: هذه الشقة غير مفروشة، مما يتيح لك المرونة', false],
  ['مفروشة: نعم', true],
  ['شقة مفروشة بالكامل', true],
  ['مفروش: غير مذكور', null],
];
const furnished = (src?: string) =>
  (pyCall(ROOT, MOD, 'amenities_from_text', CASES.map(([p]) => [p]), src) as Record<string, boolean>[])
    .map((d) => (d.furnished === undefined ? null : d.furnished));
const allRight = (got: (boolean | null)[]) => got.every((g, i) => g === CASES[i][1]);

const real = furnished();
CASES.forEach(([p, want], i) => check(`«${p}» → ${want}`, real[i] === want, `got ${real[i]}`));

// Each mutant must apply (an anchor that drifted is a red, not a silent pass) and must be caught.
const mutant = (from: string, to: string) => {
  const m = SRC.replace(from, to);
  if (m === SRC) { check(`ANCHOR DRIFTED: ${from}`, false); return null; }
  return furnished(m);
};
const m1 = mutant('lab = None if negated else _LABEL_RE.match(t, m.end())', 'lab = None');
mustCatch('the reader ignoring the value after the label (the 2026-10-24 defect)', m1 !== null && !allRight(m1));
const m2 = mutant('r"(?:لا|لايوجد|لاتوجد|بدون|no|none|not)(?!\\w)"', 'r"(?:لايوجد|لاتوجد|بدون|no|none|not)(?!\\w)"');
mustCatch('a bare «لا» no longer counting as the answer', m2 !== null && !allRight(m2));
const m3 = mutant('if (said := _amenities_in_clause(v).get(col)) is not None:', 'if (said := True) is not None:');
mustCatch('«مفروشة: هذه الشقة غير مفروشة» read from the label instead of the restatement', m3 !== null && !allRight(m3));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ a labelled «لا» is a NO');
