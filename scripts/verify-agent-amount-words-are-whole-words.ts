// A SPELLED-OUT AMOUNT MUST BE A WHOLE WORD (found live 2026-10-11 by the owner's real-user test).
//
// «ابغى شقة قريبة من الافنيوز» (the Avenues mall) came back from PRODUCTION with price 1,000: arabicWordAmounts() matched
// «الاف» (= ألف, a thousand) INSIDE the mall's name, and a price filter the user never asked for rode along into the next
// turn. Same for «الألفية» (الف) and «مليونير» (مليون). The AI never said a price (0 of 8 tries, old and new instructions):
// the defect was our own code. Rule: a unit starts a word (optionally after ONE attached particle: بـ لـ وـ فـ, as in
// «بالف ريال», «بمليون ونص») and does not run on into more letters.
//
// Same file also pins two cosmetic live findings: the size note «(150 م²)» goes BEFORE the closing emoji, and a stray
// dash left by removing an Arabic opener from an English reply is removed with it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { arabicWordAmounts, insertBeforeTrailingEmoji, dropAbshirOpener } from '../supabase/functions/agent/postModel.ts';
import { loadRealExtractPrice } from './lib/extractRealExtractPrice.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nAn amount in words must be a whole word\n');

const v = (t: string) => JSON.stringify(arabicWordAmounts(t).map((a) => a.value));
const none: [string, string][] = [['الافنيوز', 'the Avenues mall'], ['ابغى شقة قريبة من الافنيوز', 'the live message'], ['الألفية', 'the Millennium'], ['شقة جنب الالفية', 'a place named after الألفية'], ['مليونير', 'millionaire']];
for (const [t, what] of none) check(`«${t}» (${what}) is NOT an amount`, v(t) === '[]', v(t));
const yes: [string, number][] = [['ابي شقة بالف ريال', 1_000], ['بمليون ونص', 1_500_000], ['مليون ونص', 1_500_000], ['نص مليون', 500_000], ['ثلاثة ملايين', 3_000_000], ['مليونين', 2_000_000], ['خمسة آلاف', 5_000], ['الفين', 2_000], ['بثلاثة ملايين', 3_000_000]];
for (const [t, n] of yes) check(`«${t}» is still ${n.toLocaleString()}`, v(t) === `[${n}]`, v(t));

// the whole price reader, executed (the defect lived in the seam)
const price = await loadRealExtractPrice();
check('the real price reader gives NO price for «ابغى شقة قريبة من الافنيوز»', price('ابغى شقة قريبة من الافنيوز') === '', price('ابغى شقة قريبة من الافنيوز'));
check('…and still reads «ابي شقة بالف ريال» as 1000 and «فيلا بمليون ونص» as 1,500,000', price('ابي شقة بالف ريال') === '1000' && price('فيلا بمليون ونص') === '1500000');

// mutation: take the whole-word guard away from the source and prove the check would have seen it
const post = readFileSync(join(ROOT, 'supabase/functions/agent/postModel.ts'), 'utf8');
const re = windowBetween(post, 'const AR_AMOUNT_RE = new RegExp(', '"gu",', 'postModel.ts');
const guarded = (src: string) => src.includes('(?<![\\p{L}])[بلوف]?') && src.includes('(${UNIT_ALT})(?![\\p{L}])');
check('the amount regex carries the whole-word guard (before the unit, and no more letters after it)', guarded(re));
mustCatch('the guard after the unit being removed', !guarded(re.replace('(${UNIT_ALT})(?![\\p{L}])', '(${UNIT_ALT})')));
mustCatch('the guard before the unit being removed', !guarded(re.replace('(?<![\\p{L}])[بلوف]?', '')));

// cosmetic: the size note and the stray dash
check('the size note goes BEFORE the closing emoji', insertBeforeTrailingEmoji('أبحث لك عن مكتب في الدمام 🏢', '(150 م²)') === 'أبحث لك عن مكتب في الدمام (150 م²) 🏢');
check('…and a reply with no emoji simply gets it at the end', insertBeforeTrailingEmoji('Searching', '(80 m²)') === 'Searching (80 m²)');
mustCatch('the old order (note after the emoji)', 'أبحث لك عن مكتب 🏢 (150 م²)' !== insertBeforeTrailingEmoji('أبحث لك عن مكتب 🏢', '(150 م²)'));
check('an opener followed by an em dash leaves no dash behind', dropAbshirOpener('أبشر — أدور لك شقة في الرياض 🏡') === 'أدور لك شقة في الرياض 🏡', dropAbshirOpener('أبشر — أدور لك شقة في الرياض 🏡'));
const idx = readFileSync(join(ROOT, 'supabase/functions/agent/index.ts'), 'utf8');
check('the edge function uses insertBeforeTrailingEmoji for the size note and strips dashes in English', /insertBeforeTrailingEmoji\(replyOut,/.test(idx) && /\[\\s,!\.،؛\\-–—\]\*\/u, ""\)\.trim\(\);\s*\n\s*if \(body && \/\[a-z\]\//.test(idx));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ an amount in words must be a whole word');
