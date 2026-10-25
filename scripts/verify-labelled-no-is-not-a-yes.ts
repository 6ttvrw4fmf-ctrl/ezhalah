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
  // a negation belongs to the word it is TIED to: the next spelling («المطبخ») must not read the «بدون» of «مكيفات»
  // (dwelleo 13130133), and the haraj shapes where «غير» / «بدون» owned the word before (stored ads, 2026-10-25)
  ['الدور: الثاني التكييف: بدون مكيفات المطبخ: غير راكب الإيجار: 42', 'kitchen', null],
  ['حي المنار ✅ المكونات 🏠 (3) غرف وصاله 🏠 مطبخ غير راكب 🏠 مكيفات اسبلت راكبة', 'air_conditioner', true],
  ['شركة 100 العقارية شقق غير مؤثثة مطبخ راكب مكيفات راكبه', 'kitchen', true],
  ['غرفتين مطبخ دورتين مياه بدون صاله مكيفات راكبه', 'air_conditioner', true],
  ['غير متوفر مصعد', 'elevator', false],
  ['ملاحظة: العقار غير مجهز بالمكيفات', 'air_conditioner', false],
  ['#لايوجد (مدخل سياره)', 'car_entrance', false],
  ['مساحة خارجية (لا يوجد) موقف سيارات خاص (امام المبنى)', 'parking', true],
  ['المطبخ غير راكب المكيفات غير راكبة', 'air_conditioner', null],
  // «غير راكب / مركب» after the fixture = NOT installed: unknown, never a yes — the kitchen too («prepared only», like
  // «مصعد مؤسس»; coordinator for the owner, 2026-10-25). «صغير راكب» is a small FITTED kitchen. Stored ads, 2026-10-25:
  // haraj 18897950, dealapp 9111947 / 16156580 / 16156677 / 18172220 / 18171902, abaad 13214802 / 13214808, therc 12405530.
  ['حي المنار ✅ المكونات 🏠 (3) غرف وصاله 🏠 مطبخ غير راكب 🏠 مكيفات اسبلت راكبة', 'kitchen', null],
  ['والاكهرباء مستقله مطبخ غير راكب مكيفات راكبه', 'kitchen', null],
  ['والاكهرباء مستقله مطبخ غير راكب مكيفات راكبه', 'air_conditioner', true],
  ['صالة - مطبخ مقفل غير راكب غرفة غسيل', 'kitchen', null],
  ['3 غرف نوم صالة واسعة مطبخ (غير راكب) دورتا مياه', 'kitchen', null],
  ['يوجد مصعد 📍المطبخ والمكيفات غير راكبة 📍', 'kitchen', null],
  ['السخانات: مخفية بالكامل. المكيفات والمطبخ: غير راكبة 💡 الخدمات', 'air_conditioner', null],
  ['وتعمل بشكل ممتاز مصمم مصعد ولكن غير راكب السعر', 'elevator', null],
  ['- غرفة كبيرة 6x4 . - مطبخ صغير راكب . - غرفة 3', 'kitchen', true],
  ['• غرفتين نوم • دواليب مطبخ صغير راكب • ⁠مكيفات راكبة', 'kitchen', true],
  ['شقة مكونة من : -غرفتين -صالة -مطبخ ( الدولاب غير راكب ) -دورتي مياه', 'kitchen', null],
  ['-صاله . -مطبخ كبير مغلق غير راكب. -غرفتين نوم', 'kitchen', null],
  ['غرفة سائق مطبخ ( يوجد مطبخ صغير راكب ) صالتين مجلس', 'kitchen', true],
  // a plain mention elsewhere may not turn «غير راكب» back into a yes (muhaysini 17578176, 17578177)
  ['صالة - مطبخ مستقل - دورتين مياه المطبخ غير راكب - المكيفات غير راكبة', 'kitchen', null],
  ['بخ+3دوره مياة (المكيفات راكبه+المطبخ غير راكب)', 'air_conditioner', true],
  // another fixture's word is not a describing word: its «غير راكب» is its own (dealapp 18563443, muhaysini 17578178 / 17434418)
  ['دورتين مياة مطبخ دور رابع متوفر مصعد تكيفات شباك غير راكبه عداد كهرباء', 'elevator', true],
  ['دورتين مياه حاليا راكب مكيفات شباك مطبخ غير راكب مدخلين', 'air_conditioner', true],
  ['مطبخ ودورتين مياه بدون مكيفات مطبخ غير راكب مدخلين', 'air_conditioner', false],
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
const m7 = mutant('                negated = (_negated_before(before)', '                negated = (any(r.search(before) for r in _NEGATOR_RES)');
mustCatch('a negator not tied to the token («مطبخ غير راكب 🏠 مكيفات راكبة» → AC = no)', m7 !== null && !allRight(m7));
const m8 = mutant('_NOT_INSTALLED_COLS = ("air_conditioner", "elevator", "kitchen")', '_NOT_INSTALLED_COLS = ("air_conditioner", "elevator")');
mustCatch('«مطبخ غير راكب» served as kitchen = yes again', m8 !== null && !allRight(m8));
const m9 = mutant('[^\\w\\n]+غير\\s+', '.*?غير\\s+');
mustCatch('«مطبخ صغير راكب» (a small fitted kitchen) read as not installed', m9 !== null && !allRight(m9));
const m10 = mutant('\\w+)){{0,2}}', '\\w+)){{0}}');
mustCatch('a co-subject or describing word dropped («المكيفات والمطبخ: غير راكبة» → AC = yes)', m10 !== null && !allRight(m10));
const m11 = mutant('    t = _norm_ar(str(raw or "")).lower()\n    for col in _NOT_INSTALLED_COLS:', '    return\n    for col in _NOT_INSTALLED_COLS:');
mustCatch('«مطبخ مستقل … المطبخ غير راكب» served as yes (a plain mention outvoting «not installed»)', m11 !== null && !allRight(m11));
const m12 = mutant('|(?!(?:ال)?(?:{_FIXTURE_WORD}))\\w+', '|\\w+');
mustCatch('another fixture\'s word read as a describing word («متوفر مصعد تكيفات شباك غير راكبه» → no lift)', m12 !== null && !allRight(m12));

// dwelleo: the site's own furnishing_status vs the ad's own words. Agreement keeps the status; a contradiction is
// unknown, written as the AUTHORITATIVE_NULL sentinel so the upsert clears a stale yes (dwelleo 13130631: status
// «furnished», text «مفروشة: لا»).
const DW = readFileSync(join(ROOT, 'scrapers/dwelleo/run.py'), 'utf8');
const DW_CASES: [Record<string, unknown>, string, unknown][] = [
  [{ furnishing_status: 'furnished' }, 'غرف النوم: 3 دورات المياه: 3 مفروشة: لا مميزات إضافية', 'AUTHORITATIVE_NULL'],
  [{ furnishing_status: 'unfurnished' }, 'شقة مفروشة غرفتين وصالة للإيجار', 'AUTHORITATIVE_NULL'],
  [{ furnishing_status: 'furnished' }, 'شقة مفروشة بالكامل', true],
  [{ furnishing_status: 'unfurnished' }, 'العقار غير مفروش', false],
  [{ furnishing_status: 'furnished' }, 'شقة واسعة', true],
  // dwelleo 18970: status + tag chip «مفروش» say yes, the ad's own words say «مفروشة: لا» — the chip must not outvote them
  [{ furnishing_status: 'furnished', amenities: [{ name: 'مصعد' }, { name: 'مفروش' }] } as any, 'المساحة: 120 م² مفروشة: لا', 'AUTHORITATIVE_NULL'],
  [{ amenities: [{ name: 'مفروش' }] } as any, 'شقة مفروشة', true],
];
const dwelleo = (src?: string) =>
  (pyCall(ROOT, 'scrapers.dwelleo.run', '_amenities', DW_CASES.map(([r, d]) => [r, d]), src) as Record<string, unknown>[])
    .map((o) => o.furnished);
const dw = dwelleo();
DW_CASES.forEach(([r, d, want], i) => check(`dwelleo ${r.furnishing_status} + «${d}» → ${want}`, dw[i] === want, `got ${dw[i]}`));
const DW_FROM = 'out["furnished"] = stated.pop() if len(stated) == 1 else db.AUTHORITATIVE_NULL';
const dwm = DW.includes(DW_FROM)
  ? dwelleo(DW.replace(DW_FROM, 'out["furnished"] = _FURNISHED.get(rec.get("furnishing_status"), chips.get("furnished", prose.get("furnished")))'))
  : null;
if (!dwm) check(`ANCHOR DRIFTED: ${DW_FROM}`, false);
mustCatch('dwelleo\'s furnishing_status overriding the ad\'s own «مفروشة: لا» (served as yes)', dwm !== null && dwm.some((g, i) => g !== DW_CASES[i][2]));

// The prose-only reader every yes-or-nothing site moved to (owner 2026-10-24): yes / an explicit no tied to the
// token / unknown, and a column the site publishes structurally (skip) is never read from prose at all.
const PROSE: [string, string[], Record<string, boolean>][] = [
  ['لا يوجد مصعد', [], { elevator: false }],
  ['يتوفر مصعد', [], { elevator: true }],
  ['تأسيس مصعد', [], {}],
  ['قريب من مواقف عامة', [], {}],
  ['لا يوجد مصعد، شقة مفروشة', ['elevator', 'furnished'], {}],
];
const prose = (src?: string) =>
  (pyCall(ROOT, MOD, 'prose_amenities', PROSE.map(([t, skip]) => [t, skip]), src) as Record<string, boolean>[]);
const same = (a: Record<string, boolean>, b: Record<string, boolean>) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());
const pr = prose();
PROSE.forEach(([t, skip, want], i) => check(`prose_amenities(«${t}», skip=[${skip}]) → ${JSON.stringify(want)}`, same(pr[i], want), JSON.stringify(pr[i])));
const P_FROM = 'return {k: v for k, v in amenities_from_lines(raw).items() if k not in skip}';
const pm1 = SRC.includes(P_FROM) ? prose(SRC.replace(P_FROM, 'return {k: True for k, v in amenities_from_lines(raw).items() if v is True and k not in skip}')) : null;
const pm2 = SRC.includes(P_FROM) ? prose(SRC.replace(P_FROM, 'return dict(amenities_from_lines(raw))')) : null;
if (!pm1) check(`ANCHOR DRIFTED: ${P_FROM}`, false);
mustCatch('the yes-only reader back (a stated «لا يوجد مصعد» never stored as no)', pm1 !== null && pm1.some((g, i) => !same(g, PROSE[i][2])));
mustCatch('prose reading a column the site publishes structurally (skip ignored)', pm2 !== null && pm2.some((g, i) => !same(g, PROSE[i][2])));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ a labelled «لا» is a NO');
