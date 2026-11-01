// READ ALOUD NEVER SPEAKS AN EMOJI (owner 2026-10-10: the voice read «✅» after «تم البحث وطلع لنا 9,515 نتيجة»).
// Executes the shipped stripEmoji() (lifted from src/lib/readAloud.ts — that module imports expo-speech, which
// plain Node cannot load) and proves buildUnits routes every segment through it.
//
//   node --experimental-strip-types scripts/verify-read-aloud-skips-emoji.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/lib/readAloud.ts', import.meta.url), 'utf8');
const body = /export function stripEmoji\(text: string\): string \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
check('stripEmoji is present', !!body);
const strip = new Function('text', body) as (t: string) => string;
const removesAll = (fn: (t: string) => string) =>
  !/✅|🏡|💚|🇸🇦/u.test(fn('تم البحث وطلع لنا 9,515 نتيجة ✅ 🏡 هلا 💚 🇸🇦'));
const keepsWords = (fn: (t: string) => string) => fn('طلع لنا 9,515 نتيجة #1 ✅').includes('طلع لنا 9,515 نتيجة #1');
check('every emoji is removed (✅ 🏡 💚 and a flag)', removesAll(strip));
check('Arabic words, digits, commas and # are kept', keepsWords(strip));
check('buildUnits speaks the emoji-free text', /const trimmed = stripEmoji\(seg\.text\)\.trim\(\);/.test(src));
mustCatch('an identity strip (the 2026-10-10 bug)', !removesAll((t) => t));
mustCatch('a strip that eats digits too', !keepsWords((t) => t.replace(/[\p{Extended_Pictographic}\d]/gu, '')));
console.log(failed ? `\n✗ ${failed} FAILED` : '\n✓ read aloud never speaks an emoji');
process.exit(failed ? 1 : 0);
