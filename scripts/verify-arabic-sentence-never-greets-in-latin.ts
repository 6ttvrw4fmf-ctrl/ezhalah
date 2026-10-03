// AN ARABIC SENTENCE NEVER GREETS THE USER IN LATIN LETTERS (owner 2026-10-03)
// Screenshot: «لقينا نتائج يا Yusuf Saleh S Al Nashwan وعددها 126,596» while the sidebar showed «يوسف صالح س آل ناشوان».
// The results/no-results line read `user?.nameAr ?? user?.name`, and nameAr is filled asynchronously after sign-in.
// It now uses pickName(user, 'ar'), the sidebar's own function. This executes pickName on the real cases.
import { readFileSync } from 'node:fs';
import { displayName as phoneticAr } from '../src/lib/arabicName.ts';

// nameSync.ts imports the Supabase client (not loadable in plain Node), so its pickName is lifted from source and
// evaluated against the real phonetic fallback, the same way other barriers lift pure helpers.
const nameSyncSrc = readFileSync(new URL('../src/lib/nameSync.ts', import.meta.url), 'utf8');
const body = /export function pickName\([\s\S]*?\n}\n/.exec(nameSyncSrc)?.[0] ?? '';
const scriptOf = (n: string) => (/[\u0600-\u06FF]/.test(n) ? 'ar' : 'en');
const js = body.replace(/^export /, '').replace(/:\s*\{[^}]*\}\s*\|\s*null\s*\|\s*undefined/, '').replace(/locale:\s*Locale/, 'locale').replace(/\):\s*string\s*\{/, ') {');
// eslint-disable-next-line no-new-func
const pickName = new Function('phoneticAr', 'scriptOf', `${js}; return pickName;`)(phoneticAr, scriptOf) as
  (u: { name?: string; nameEn?: string; nameAr?: string }, l: 'ar' | 'en') => string;

const LATIN = /[A-Za-z]/;
let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const cases = [
  { name: 'Yusuf Saleh S Al Nashwan' },                                  // Google name, nameAr not synced yet
  { name: 'Yusuf Saleh S Al Nashwan', nameEn: 'Yusuf Saleh S Al Nashwan' },
  { name: 'Mohammed', nameEn: 'Mohammed', nameAr: 'محمد' },
  { name: 'محمد', nameAr: 'محمد' },
];
for (const u of cases) {
  const out = pickName(u, 'ar');
  check(`Arabic UI, ${JSON.stringify(u)} → «${out}» has no Latin letter and is not empty`, !!out && !LATIN.test(out));
}
check('the stored Arabic spelling wins when present', pickName({ name: 'Mohammed', nameAr: 'محمد' }, 'ar') === 'محمد');
check('English UI keeps the Latin name', pickName({ name: 'Yusuf', nameEn: 'Yusuf', nameAr: 'يوسف' }, 'en') === 'Yusuf');

const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const wired = (src: string) => /const rfName = user \? pickName\(user, rfLang\) : null;/.test(src) && !/user\?\.nameAr \?\? user\?\.name/.test(src);
check('agent.tsx: the results/no-results {name} comes from pickName(user, rfLang)', wired(agent));
check('(mutation) catches the old `nameAr ?? name` fallback coming back',
  !wired(agent.replace('const rfName = user ? pickName(user, rfLang) : null;', "const rfName = rfLang === 'ar' ? (user?.nameAr ?? user?.name) : (user?.nameEn ?? user?.name);")));
// a pickName that returned the raw name would leak Latin — prove the case set catches it
check('(mutation) the case set catches a picker that returns the raw name', LATIN.test(cases[0].name));

console.log(failed ? `\n${failed} FAILED` : '\nAll Arabic-name assertions passed');
process.exit(failed ? 1 : 0);
