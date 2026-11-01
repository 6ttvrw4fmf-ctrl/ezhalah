// A SEARCH REPLY THAT BREAKS THE OWNER'S RULES IS REPLACED BY A LINE THE CODE WRITES (owner 2026-10-11).
//
// Found by the live battery (scripts/agent-live-battery.mjs): the model, told «never state a price», still wrote «… with an annual rent around
// 60,000 SAR»; asked «وش نوع العقار؟» while already searching; asked «كم غرفة نوم تحتاجون؟» of someone who had just said «5 غرف»; and
// asked «أي مدينة تقصد؟» while a search over the whole region was running. Prose surgery breaks sentences, so such a reply is swapped
// whole for «أدور لك شقة في الرياض 🏡» built from the parsed search. EXECUTED here (detector + line), then the wiring is pinned.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replyBreaksSearchRules } from '../supabase/functions/agent/postModel.ts';
import { searchLineText } from '../src/data/questionExamples.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nA search reply that breaks the rules is replaced\n');

const R: Array<[string, string, boolean]> = [
  ['Searching apartments in Riyadh with an annual rent around 60,000 SAR 🏡', 'apartment in Riyadh 60000 per year', true],
  ['Searching villas in Jeddah up to 3 million SAR 🏡', 'villa in Jeddah up to 3 million', true],
  ['ازهله، أدور لك بيت في الرياض مع غرفة خادمة، والميزانية توصل خمس مليون دينار 🏡', 'ابي بيت في الرياض', true],
  ['أدور لك شقة بميزانية ٣ مليون 🏡', 'شقة ٣ مليون', true],
  ['أدور لك في الخرج، وش نوع العقار اللي تبيه؟ 🏡', 'دور في الخرج', true],
  ['Which kind of property are you after? 🏡', 'in Riyadh', true],
  ['أدور لك عمارة للإيجار في الرياض، وكم غرفة نوم تحتاجون بالضبط؟ 🏡', 'أدور عمارة 5 غرف للايجار في الرياض', true],
  ['How many bedrooms do you need? 🏡', 'apartment with 3 bedrooms in Riyadh', true],
  ['أدور لك شقة في الرياض. كم غرفة نوم تحتاجون؟ مثلاً ٣ أو ٤ 🏡', 'عائلتي ٥ وابغى شقة في الرياض', false],
  ['How many bedrooms do you need? For example 3 or 4 🏡', 'family of 5 apartment in Dammam', false],
  ['ازهله ⏎ أدور لك شقة في الرياض، وش الميزانية اللي في بالك؟ 🏡', 'تكفى ابي شقة في الرياض', true],
  ['What is your budget? 🏡', 'apartment in Riyadh', true],
  ['ارحب! المنطقة الغربية فيها أكثر من مدينة، أي مدينة تقصد؟ 🏡', 'شقة بالمنطقة الغربية', true],
  ['Which city do you mean? 🏡', 'apartment in the western region', true],
  ['أدور لك شقة ٣ غرف في الرياض (150 م²) 🏡', 'شقة ٣ غرف في الرياض', false],
  ['أبحث لك عن فيلا في جدة 🏡', 'فيلا في جدة', false], ['Searching villas in Jeddah for you 🏡', 'villa in jeddah', false],
  ['ازهله! تقصد حي الملقا في الرياض؟ 🏡', 'الملقا', false],
];
const wrong = R.filter(([r, t, w]) => replyBreaksSearchRules(r, t) !== w);
check('a price, a property-type question, answered bedrooms and a city question during a search are caught; ordinary replies are not', wrong.length === 0, wrong.map(([r]) => r.slice(0, 50)).join(' | '));

const lines = [searchLineText(false, 'Apartment', 'الرياض', 'a'), searchLineText(true, 'Villa', 'جدة', 'b'), searchLineText(false, null, 'الخبر', 'c'), searchLineText(true, 'House', 'الدمام', 'd'), searchLineText(true, 'Apartment', '', 'e')];
check('the line the code writes names the type and the city, ends with an emoji, has no dash, no price and no question',
  lines.every((l) => /\p{Extended_Pictographic}$/u.test(l) && !/[-‐-―−؟?]/.test(l) && !replyBreaksSearchRules(l, '')) && /شقة في الرياض/.test(lines[0]) && /villa in Jeddah/.test(lines[1]), lines.join(' | '));
check('English lines never carry an Arabic city name', !/[؀-ۿ]/.test(lines[1]) && !/[؀-ۿ]/.test(lines[3]));

const edge = readFileSync(join(ROOT, 'supabase/functions/agent/index.ts'), 'utf8');
const wire = windowBetween(edge, 'let replyOut = lead(out.reply);', 'insertBeforeTrailingEmoji(replyOut', 'index.ts');
const wired = (src: string) => /else if \(replyBreaksSearchRules\(replyOut, text\)\) \{\s*replyOut = searchLineText\(locale === "en", typeof out\.type === "string" \? out\.type : null, location, text, lastBotReply\);/.test(src);
check('every search reply goes through the check and is swapped for the code-written line', wired(wire));
mustCatch('the check being removed', !wired(wire.replace('else if (replyBreaksSearchRules(replyOut, text))', 'else if (false)')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ a search reply that breaks the rules is replaced');
