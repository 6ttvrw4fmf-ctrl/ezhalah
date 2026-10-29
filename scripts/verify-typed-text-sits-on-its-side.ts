// TYPED TEXT SITS ON ITS OWN LANGUAGE'S SIDE (owner 2026-10-29: «when user types … in the filter in English it types it
// in the wrong side»). EXECUTED: typedDir() on English, Arabic, mixed, numbers and empty text; and the Filter's city and
// district fields pass what was typed through it, after the field's own (interface-language) side so it wins.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { typedDir, TYPED_LTR, TYPED_RTL } from '../src/lib/typedDir.ts';

const root = join(import.meta.dirname, '..');
let fail = 0;
const check = (label: string, ok: boolean, detail = '') => { if (ok) console.log(`  PASS  ${label}`); else { fail++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); } };

console.log('\nTyped text sits on its own language\'s side\n');
check('English → left', typedDir('Riyadh') === TYPED_LTR);
check('Arabic → right', typedDir('الرياض') === TYPED_RTL);
check('Arabic with an English word → right (Arabic leads)', typedDir('حي Al Malqa') === TYPED_RTL);
check('numbers only, or nothing → the field keeps its own side', typedDir('123') === null && typedDir('') === null && typedDir(null) === null);

const home = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
const wired = (src: string) => /ref=\{cityRef\}[\s\S]{0,200}?style=\{\[s\.flInput, x\.flInput, typedDir\(query\.location\)\]\}/.test(src)
  && /ref=\{districtRef\}[\s\S]{0,200}?style=\{\[s\.flInput, x\.flInput, typedDir\(districtText\)\]\}/.test(src)
  && src.includes("import { typedDir } from '@/lib/typedDir';");
check('the Filter\'s city and district fields follow what was typed (after the interface side, so it wins)', wired(home));
check('(mutation) catches the city field back on the interface side only', !wired(home.replace('typedDir(query.location)]', ']')));
check('(mutation) catches the side applied BEFORE the interface side (which would override it)', !wired(home.replace('[s.flInput, x.flInput, typedDir(districtText)]', '[typedDir(districtText), s.flInput, x.flInput]')));

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ typed-text-sits-on-its-side: English left, Arabic right, in both interface languages');
