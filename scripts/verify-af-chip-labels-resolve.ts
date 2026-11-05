// Every Advanced Filter chip token has the Arabic label the customer reads (🔬 2026-11-05, backlog 1321).
// Hermetic: reads src/lib/afChips.ts and src/i18n.tsx from disk only. The live card-truth check compares the label on
// screen with chipArabicLabel(); a chip with no Arabic would make that check abort (as it did on 2026-11-05 for 150
// tokens) or, worse, render an English key to an Arabic customer.
import { arabicDictionary, chipArabicLabel, unlabelledChips } from './lib/afChipLabels.ts';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) fails++;
};

const missing = unlabelledChips();
check('every CHIP_DEFS token resolves to an Arabic label in src/i18n.tsx', missing.length === 0, missing.join(', '));
check('the escaped-quote keys resolve («Kids\' pool»)', chipArabicLabel('kids_pool') === 'مسبح أطفال',
  String(chipArabicLabel('kids_pool')));
check('women_majlis reads «مجلس نساء»', chipArabicLabel('women_majlis') === 'مجلس نساء', String(chipArabicLabel('women_majlis')));

// mutation proofs: the predicate must catch a chip with no translation, and a translation that is not Arabic
const dict = arabicDictionary(`const ar = { 'Kitchen': 'المطبخ', "Women's majlis": 'مجلس نساء', 'Pool': 'Pool' };`);
const defs = { kitchen: { labelKey: 'Kitchen' }, women_majlis: { labelKey: "Women's majlis" },
  pool: { labelKey: 'Pool' }, sauna: { labelKey: 'Sauna' } };
// mustCatch(label, defsMutant): the predicate must name the mutant chip as unlabelled
const mustCatch = (name: string, mutant: Record<string, { labelKey: string }>, token: string) => {
  const caught = unlabelledChips(dict, mutant);
  check(`mutation caught: ${name}`, caught.includes(token), caught.join(','));
};
mustCatch('a chip with no dictionary entry', defs, 'sauna');
mustCatch('a dictionary value that is not Arabic', defs, 'pool');
const clean = unlabelledChips(dict, defs);
check('translated chips are not flagged', !clean.includes('kitchen') && !clean.includes('women_majlis'), clean.join(','));

if (fails) { console.error(`\n✗ ${fails} check(s) FAILED`); process.exit(1); }
console.log('\n✓ every Advanced Filter chip has its Arabic label');
