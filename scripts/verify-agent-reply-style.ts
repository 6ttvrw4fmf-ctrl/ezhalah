// EVERY AGENT REPLY IS SHORT, ENDS WITH ONE EMOJI, AND NEVER OPENS WITH «أبشر» (owner 2026-10-11).
//
// Owner: «every answer should be like I have ADHD · put an emoji at the end», and the rulebook (chapter 11) retired
// «أبشر». Measured on DeepSeek V4.1 Flash (52 messages × 2): before the rule 0% of replies ended with an emoji and 76%
// were two sentences or fewer; after, 97% end with exactly one emoji and 92% are two sentences or fewer. The model still
// opened with «أبشر» in ~4 replies in 10, so that part is also enforced by code (dropAbshirOpener, EXECUTED here).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { windowBetween } from './lib/sourceWindow.ts';
import { dropAbshirOpener } from '../supabase/functions/agent/postModel.ts';

const ROOT = join(import.meta.dirname, '..');
const index = readFileSync(join(ROOT, 'supabase/functions/agent/index.ts'), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nAgent replies: short, one emoji at the end, no «أبشر» opener\n');

// 1. the opener rule, EXECUTED
const cases: [string, string][] = [
  ['أبشر، أدور لك شقة في الرياض 🏡', 'أدور لك شقة في الرياض 🏡'],
  ['ارحب! أبشر، أدور لك فيلا في جدة 🏡', 'ارحب! أدور لك فيلا في جدة 🏡'],
  ['أبشر! جاري البحث 🏡', 'جاري البحث 🏡'],
  ['أبشرك، طلعت لك نتائج 🏡', 'أبشرك، طلعت لك نتائج 🏡'],          // a different word: untouched
  ['أدور لك شقة، أبشر بالخير 🏡', 'أدور لك شقة، أبشر بالخير 🏡'],    // not an opener: untouched
  ['أبشر', 'أبشر'],                                                   // never an empty reply
  ['', ''],
];
const bad = cases.filter(([i, o]) => dropAbshirOpener(i) !== o);
check('«أبشر» is removed only as an opener, «أبشرك» and a mid-sentence use stay, and a reply is never emptied', bad.length === 0, bad.map(([i]) => i).join(' | '));
const post = readFileSync(join(ROOT, 'supabase/functions/agent/postModel.ts'), 'utf8');
const fn = windowBetween(post, 'export function dropAbshirOpener', '\n}\n', 'postModel.ts');
const run = (src: string, s: string) => new Function('s', `${(src + '\n}').replace('export function dropAbshirOpener(s: string): string', 'function f(s)').replace(/: string/g, '').replace(/ as string/g, '')}\nreturn f(s);`)(s);
mustCatch('an opener rule with no word boundary (it would turn «أبشرك…» into «ك…»)',
  run(fn.replace('أبشر(?![\\p{L}])', 'أبشر'), 'أبشرك، طلعت لك نتائج 🏡') !== 'أبشرك، طلعت لك نتائج 🏡');
mustCatch('an opener rule that can empty the reply', run(fn.replace('if (!rest) return text;', ''), 'أبشر') !== 'أبشر');

// 2. the prompt carries the format rule, and the code applies the opener rule to every Arabic reply
const hint = windowBetween(index, 'const JSON_SHAPE_HINT = `', '`;', 'index.ts');
const rule = (src: string) => /REPLY FORMAT \(STRICT[^)]*\)[^"]*"reply" is AT MOST TWO short sentences/.test(src) && /End the reply with exactly ONE emoji/.test(src) && /Never open with «أبشر»/.test(src);
check('the closing part of the prompt says: at most two short sentences, exactly one emoji at the end, never «أبشر»', rule(hint));
mustCatch('the format rule being deleted', !rule(hint.replace('REPLY FORMAT', 'NOTE')));
mustCatch('the emoji line being weakened', !rule(hint.replace('End the reply with exactly ONE emoji', 'You may add an emoji')));
const lead = windowBetween(index, 'const lead = (s: string) => {', '      return body;', 'index.ts');
const wired = (src: string) => /body = dropAbshirOpener\(body\);/.test(src) && /import \{[^}]*dropAbshirOpener[^}]*\} from "\.\/postModel\.ts";/.test(index);
check('every Arabic reply goes through dropAbshirOpener', wired(lead));
mustCatch('the call being removed from lead()', !wired(lead.replace('body = dropAbshirOpener(body);', '')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ agent replies: short, one emoji, no «أبشر» opener');
