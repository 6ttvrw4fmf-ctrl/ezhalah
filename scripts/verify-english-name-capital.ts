// Owner 2026-11-07: «Yusuf not yusuf … for all users that sign up / log in». Every English name on screen (sidebar,
// account menu, Smart Broker, welcome line) comes from pickName(); its English branch starts each word with a capital.
//   node --experimental-strip-types scripts/verify-english-name-capital.ts   (in `npm test`)
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const SRC = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'nameSync.ts'), 'utf8');
const lift = async (code: string) => {
  const tmp = join(mkdtempSync(join(tmpdir(), 'ezh-cap-')), 'nameSync.ts');
  writeFileSync(tmp, code);
  return (await liftSymbols(tmp, [{ header: 'export function scriptOf(' }, { header: 'export function pickName(' }, { header: 'export function sentenceName(' }],
    ['pickName', 'sentenceName'], `type Locale = 'ar' | 'en';\nconst phoneticAr = (s: string, _x?: boolean) => s;\n`)) as {
    pickName: (u: object, l: 'ar' | 'en') => string; sentenceName: (u: object, l: 'ar' | 'en') => string };
};
let failed = 0;
const check = (label: string, ok: boolean, got = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  — got «${got}»`}`); };
const capsOk = async (code: string) => {
  const N = await lift(code);
  return N.pickName({ name: 'yusuf' }, 'en') === 'Yusuf' && N.pickName({ name: 'يوسف', nameEn: 'yusuf alnashwan' }, 'en') === 'Yusuf Alnashwan';
};
const N = await lift(SRC);
const en = (u: object) => N.pickName(u, 'en');
check('a lower-case Latin name → Yusuf', en({ name: 'yusuf' }) === 'Yusuf', en({ name: 'yusuf' }));
check('the English spelling of an Arabic sign-up → Yusuf Alnashwan', en({ name: 'يوسف', nameEn: 'yusuf alnashwan' }) === 'Yusuf Alnashwan', en({ name: 'يوسف', nameEn: 'yusuf alnashwan' }));
check('the rest of a word stays as typed → McAllister', en({ name: 'mcAllister' }) === 'McAllister', en({ name: 'mcAllister' }));
check('Arabic is untouched', N.pickName({ name: 'يوسف' }, 'ar') === 'يوسف');
check('the welcome sentence gets it too', N.sentenceName({ name: 'yusuf' }, 'en') === 'Yusuf');
check('no name stays empty', en({}) === '' && en({ name: '  ' }) === '');
check('MUTATION — the English branch returning the name as typed is caught',
  !(await capsOk(SRC.replace(/\.replace\(\/\(\^\|\\s\)\(\\p\{Ll\}\)\/gu, [^\n]+\);/, ';'))));
if (failed) { console.error(`\n❌ verify-english-name-capital: ${failed} failed`); process.exit(1); }
console.log('\n✓ English names start with a capital for every user');
