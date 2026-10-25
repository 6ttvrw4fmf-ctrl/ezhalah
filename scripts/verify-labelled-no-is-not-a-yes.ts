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
console.log('\nA labelled «لا» is a NO, and so is «لا تأتي … مفروشة»\n');

// [phrase, column, expected] — true / false / null (null = the ad did not answer: NULL, never a guess). Every
// phrase is verbatim (or a verbatim fragment) from a stored ad, 2026-10-24/25.
const CASES: [string, string, boolean | null][] = [
  ['- عدد الحمامات: 5 - مفروشة: لا - للا بيع: نعم', 'furnished', false],
  ['- **مفروش:** لا **المرافق:** - الكهرباء', 'furnished', false],
  ['- المفروشات: غير مفروش - السعر: 3,500,000 ريال سعودي', 'furnished', false],
  ['- الحمامات: 0 - مؤثثة: غير مؤثثة - السعر: 58,000 ريال سعودي سنويًا', 'furnished', false],
  ['مفروشة: لا (غير مفروشة)', 'furnished', false],
  ['- **مفروشة**: هذه الشقة غير مفروشة، مما يتيح لك المرونة', 'furnished', false],
  ['مفروشة: نعم', 'furnished', true],
  ['شقة مفروشة بالكامل', 'furnished', true],
  ['مفروش: غير مذكور', 'furnished', null],
  // multi-word labels: the vehicle qualifier or one «و» co-subject, never any other word (2026-10-25)
  ['- موقف سيارات ومساحة خارجية: غير موضحة في البيانات', 'parking', null],
  ['مواقف السيارات: غير متوفرة المياه: متوفرة', 'parking', false],
  ['موقف السيارات: غير محدد', 'parking', null],
  ['مطبخ ملاحظة: بدون مصعد', 'kitchen', true],
  ['موقف خاص الحقوق: لا يوجد', 'parking', true],
  ['موقف خاص: لا تفوت', 'parking', true],
  // free-sentence negatives (muhaysini, tuba, aqar, gathern), and the «nearby» outcome still unknown
  ['لا تأتي هذه الشقة مفروشة، مما يمنحك الحرية في تصميمها', 'furnished', false],
  ['حالة عدم المفروشات تتيح حرية كاملة في تصميم', 'furnished', false],
  ['غير مناسب لكبار السن لعدم وجود مصعد', 'elevator', false],
  ['قريب من عدم وجود مصعد', 'elevator', null],
  // a label answered «unknown» settles the fact: the next spelling («المطبخ») must not read the «بدون» of «مكيفات»
  ['الدور: الثاني التكييف: بدون مكيفات المطبخ: غير راكب الإيجار: 42', 'kitchen', null],
];
const answers = (src?: string) =>
  (pyCall(ROOT, MOD, 'amenities_from_text', CASES.map(([p]) => [p]), src) as Record<string, boolean>[])
    .map((d, i) => (d[CASES[i][1]] === undefined ? null : d[CASES[i][1]]));
const allRight = (got: (boolean | null)[]) => got.every((g, i) => g === CASES[i][2]);

const real = answers();
CASES.forEach(([p, col, want], i) => check(`«${p}» → ${col} = ${want}`, real[i] === want, `got ${real[i]}`));

// Each mutant must apply (an anchor that drifted is a red, not a silent pass) and must be caught.
const mutant = (from: string, to: string) => {
  const m = SRC.replace(from, to);
  if (m === SRC) { check(`ANCHOR DRIFTED: ${from}`, false); return null; }
  return answers(m);
};
const m1 = mutant('lab = None if negated else _LABEL_RE.match(t, m.end())', 'lab = None');
mustCatch('the reader ignoring the value after the label (the 2026-10-24 defect)', m1 !== null && !allRight(m1));
const m2 = mutant('r"(?:لا|لايوجد|لاتوجد|بدون|no|none|not|', 'r"(?:لايوجد|لاتوجد|بدون|no|none|not|');
mustCatch('a bare «لا» no longer counting as the answer', m2 !== null && !allRight(m2));
const m3 = mutant('if (said := _amenities_in_clause(v).get(col)) is not None:', 'if (said := True) is not None:');
mustCatch('«مفروشة: هذه الشقة غير مفروشة» read from the label instead of the restatement', m3 !== null && !allRight(m3));
const m4 = mutant('or bool(_ABSENT_BEFORE_RE.search(t[max(0, m.start() - 40):m.start()])))', 'or False)');
mustCatch('«لا تأتي … مفروشة» / «عدم وجود مصعد» read as yes again', m4 !== null && !allRight(m4));
const m5 = mutant('(?:\\s+(?:ال|لل|ل)?(?:سيار|مركب)\\w*)?(?P<co>', '(?P<co>');
mustCatch('«موقف سيارات ومساحة خارجية: غير موضحة» read as parking = yes again', m5 !== null && !allRight(m5));
const m6 = mutant('(?P<co>\\s+و\\w+(?:\\s+(?!ملاحظ)\\w+)?)?', '(?P<co>(?:\\s+\\w+){1,3})?');
mustCatch('a label widened to any words («مطبخ ملاحظة: بدون مصعد» → no kitchen)', m6 !== null && !allRight(m6));
const m7 = mutant('            if col in out or col in settled:', '            if col in out:');
mustCatch('a settled «unknown» label overridden by the next spelling (kitchen = no from «بدون مكيفات»)', m7 !== null && !allRight(m7));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ a labelled «لا» is a NO');
