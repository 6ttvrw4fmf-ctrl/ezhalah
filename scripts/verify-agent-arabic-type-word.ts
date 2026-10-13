// AN ARABIC TYPE WORD FROM THE AI IS THE SAME TYPE (live 2026-10-13).
//
// A real-user chat on production: «شقة في الرياض وجدة» → «نبدأ في الرياض ولا جدة؟» → «الرياض» showed OFFICES. The AI had answered the
// follow-up with type «شقة» (the Arabic word, not the canonical «Apartment»); queryFromBackend() in src/data/agent.ts did not know it,
// filed it under its Commercial fallback, and the search ran «نوع العقار: تجاري». The battery saw the same word on single messages too
// («شقة في الخرج», «شقة في الرياض بس من عقار»). This EXECUTES the real typeFromAgent() lifted from src/data/agent.ts and pins its use.
//
//   node --experimental-strip-types scripts/verify-agent-arabic-type-word.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nAn Arabic type word from the AI is the same type\n');

const lifted = await liftSymbols(join(ROOT, 'src/data/agent.ts'), [
  { header: 'const AR_TYPE: Record<string, string> = {', endsWith: /^\};$/ },
  { header: 'export function typeFromAgent(', endsWith: /^\}$/ },
], ['typeFromAgent']);
const typeFromAgent = lifted.typeFromAgent as (t: string | null) => string | null;

type Fn = (t: string | null) => string | null;
const CASES: Array<[string | null, string | null]> = [
  ['شقة', 'Apartment'], ['الشقة', 'Apartment'], ['شقه', 'Apartment'], ['فيلا', 'Villa'], ['محل', 'Shop'], ['مكتب', 'Office'], ['استراحة', 'Rest House'],
  ['Apartment', 'Apartment'], ['Villa', 'Villa'], ['Residential Land', 'Residential Land'], ['something new', 'something new'], [null, null],
];
const mapsRight = (fn: Fn) => CASES.every(([i, o]) => fn(i) === o);
check('the Arabic word becomes the canonical type; a canonical or unknown name passes through untouched', mapsRight(typeFromAgent),
  CASES.filter(([i, o]) => typeFromAgent(i) !== o).map(([i, o]) => `${i} → ${typeFromAgent(i)} (want ${o})`).join(' | '));
mustCatch('the Arabic word passing through raw (the Commercial fallback again)', !mapsRight((t) => t));

const src = readFileSync(join(ROOT, 'src/data/agent.ts'), 'utf8');
const wired = (s: string) => /const ty = typeFromAgent\(typeof b\.type === 'string' && b\.type\.trim\(\) \? b\.type\.trim\(\) : null\);/.test(s);
check('queryFromBackend() reads the AI type through typeFromAgent() before deciding the category', wired(src));
mustCatch('queryFromBackend() reading the raw word again', !wired(src.replace('const ty = typeFromAgent(', 'const ty = (')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ an Arabic type word from the AI is the same type');
