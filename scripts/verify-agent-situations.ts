// A MESSAGE THAT IS NOT A PROPERTY SEARCH IS ANSWERED FOR WHAT IT IS (owner 2026-10-11).
//
// Found by testing the LIVE agent with 30 odd messages: «اتمنى اموت», «حرامي انتم نصابين», «تنصحني أشتري ولا أأجر؟», «ابغى جيران سعوديين فقط»,
// «أبي أبيع شقتي», «أبغى قرض عقاري», «ابي شقة في دبي» were ALL answered with the same product introduction. A person in distress got an
// advertisement. This EXECUTES the classifier and every reply pool, then pins the wiring: danger first and never a search, the others only
// when the turn is a message (no search), each with its emoji, no dash, no recommendation, and never the phrasing the last message used.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { situationKind, situationReplyText, SITUATION_POOLS, type Situation } from '../supabase/functions/agent/situations.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nA message that is not a search is answered for what it is\n');

const T: Array<[string, Situation | null]> = [
  ['اتمنى اموت', 'danger'], ['ابي انتحر', 'danger'], ['I want to kill myself', 'danger'], ['تعبت من الحياة', 'danger'], ['I want to die', 'danger'], ['ودي اموت', 'danger'],
  ['ابي اموت من الضحك', null], ['ابغى اموت من الجوع الله يعافيكم', null],
  ['حرامي انتم نصابين', 'complaint'], ['this is a scam', 'complaint'], ['you are useless', 'complaint'], ['غبي', 'complaint'],
  ['ابغى جيران سعوديين فقط', 'protected'], ['ابي بيت لسعودي بس', 'protected'], ['no foreigners please', 'protected'], ['muslims only', 'protected'],
  ['أبغى قرض عقاري', 'financial'], ['mortgage rates?', 'financial'], ['استثمار عقاري', 'financial'],
  ['تنصحني أشتري ولا أأجر؟', 'advice'], ['is this a good time to buy?', 'advice'], ['which is better Aqar or Wasalt', 'advice'], ['هل هذي صفقة حلوة؟', 'advice'], ['قارن لي بين الملقا والياسمين', 'advice'], ['وش أفضل حي', 'advice'],
  ['أبي أبيع شقتي', 'sell'], ['I want to sell my apartment', 'sell'], ['ابغى انشر اعلان', 'sell'],
  ['https://sa.aqar.fm/ar/123456', 'link'], ['رقم الاعلان 7200909248', 'link'], ['www.aqar.fm/xyz', 'link'], ['ad number 7200909248', 'link'], ['0555123456', 'phone'], ['+966555123456', 'phone'], ['966 55 512 3456', 'phone'],
  ['أنا تعبان ومضايق', 'sad'], ['حزين', 'sad'], ['مالي خلق شي', 'sad'], ["I'm feeling really sad", 'sad'], ['I feel lonely', 'sad'], ['depressed', 'sad'],
  ['ابي شقة في دبي', 'outside'], ['apartment in Cairo', 'outside'], ['villa in London', 'outside'],
  ['شقة ٣ غرف في الرياض ٦٠ ألف', null], ['ابي شقة في الرياض', null], ['شقة للإيجار في جدة', null], ['villa for sale in Jeddah', null], ['مرحبا', null], ['شكراً', null], ['وش تقدر تسوي', null],
  ['ابي شقة قريبة من جامعة الملك سعود', null], ['ابغى فيلا بحي النرجس', null], ['شقة عائلية', null], ['', null],
];
const wrong = T.filter(([t, k]) => situationKind(t) !== k);
check('each odd message is told apart from a property request (and a joke about dying is not a crisis)', wrong.length === 0, wrong.map(([t, k]) => `${t} → ${situationKind(t)} (want ${k})`).join(' | '));

const DASH = /[-‐-―−]/, EMOJI_END = /\p{Extended_Pictographic}️?$/u;
const kinds = Object.keys(SITUATION_POOLS) as Situation[];
const replies = kinds.flatMap((k) => ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((s) => [situationReplyText(k, false, s + k), situationReplyText(k, true, s + k)]));
check('every reply ends with an emoji, has no dash, and no placeholder is left', replies.every((r) => EMOJI_END.test(r) && !DASH.test(r) && !/\{\w+\}/.test(r)), replies.filter((r) => !EMOJI_END.test(r) || DASH.test(r)).join(' | '));
check('every situation has ≥ 3 different phrasings in Arabic and in English', kinds.every((k) => SITUATION_POOLS[k].ar.length >= 3 && SITUATION_POOLS[k].en.length >= 3 && new Set(SITUATION_POOLS[k].ar).size === SITUATION_POOLS[k].ar.length));
const seeds = Array.from({ length: 60 }, (_, i) => `رسالة ${i}`);
check('60 different messages get ≥ 3 different versions of every reply, and never the phrasing the previous bot message used',
  kinds.every((k) => new Set(seeds.map((s) => situationReplyText(k, false, s))).size >= 3 && seeds.every((s) => { const a = situationReplyText(k, false, s); return situationReplyText(k, false, s, a) !== a; })));
check('the crisis reply names real help (emergency 911 and the Ministry of Health line 937) in both languages and never offers a search',
  [...SITUATION_POOLS.danger.ar, ...SITUATION_POOLS.danger.en].every((r) => /911/.test(r) && /937/.test(r) && !/(?:ابحث|أبحث|أدور|search|listing|إعلان|عقار)/i.test(r)));
const SEARCHY = /(?:ابحث|أبحث|أدور|ادور|search|listing|إعلان|عقار|مثلاً|for example)/i;
const sadCalm = (pool: readonly string[]) => pool.every((r) => /🤍$/.test(r) && !SEARCHY.test(r));
check('a sad message gets a calm word ending in 🤍, never a search pitch or an example search (live 2026-10-13: «أنا تعبان ومضايق» got the introduction)',
  sadCalm([...SITUATION_POOLS.sad.ar, ...SITUATION_POOLS.sad.en]));
mustCatch('a sad reply that pitches a search', !sadCalm([...SITUATION_POOLS.sad.ar, 'سلامتك، وش تبي أدور لك؟ 🏡']));
check('no reply recommends, ranks or says «best» (only the refusal «ما أقدر أنصح» may name the verb)', replies.every((r) => !/(?:أفضل|احسن|أنصح|ننصح|\bbest\b|\bI recommend\b|good deal)/i.test(r.replace('ما أقدر أنصح', ''))));
check('the nationality / religion reply refuses the filter and offers the supported ones (city, price, rooms)', [...SITUATION_POOLS.protected.ar, ...SITUATION_POOLS.protected.en].every((r) => /(?:المدينة|city)/i.test(r)));

const edge = readFileSync(join(ROOT, 'supabase/functions/agent/index.ts'), 'utf8');
const danger = windowBetween(edge, 'if (situationKind(text) === "danger") {', '\n      }\n', 'index.ts');
const dangerWired = (src: string) => /kind: "message", reply: situationReplyText\("danger", locale === "en", text, lastBotReply\)/.test(src) && /locationQuestion: false/.test(src) && !/kind: "listings"/.test(src);
check('a crisis message returns a plain message with the human reply, never a search, before anything else is decided', dangerWired(danger));
mustCatch('the crisis reply being dropped', !dangerWired(danger.replace('situationReplyText("danger"', 'noIntentText("danger"')));
const chain = (src: string) => /const reply = unsearchableReply \?\? ambiguityReply \?\? situationReply \?\? noIntentReply \?\? noPlaceReply \?\?/.test(src)
  && /const noIntentReply = !unsearchableReply && !ambiguityReply && !situationReply && !hasEnoughToSearch/.test(src)
  && /const noPlaceReply = !unsearchableReply && !ambiguityReply && !situationReply && !noIntentReply/.test(src);
check('in a message turn the situation reply beats the product introduction and the city question', chain(edge));
mustCatch('the situation reply being skipped (the introduction coming back for everyone)', !chain(edge.replace('ambiguityReply ?? situationReply ?? noIntentReply', 'ambiguityReply ?? noIntentReply')));
const before = edge.indexOf('if (situationKind(text) === "danger")'), msg = edge.indexOf('if (decision.kind === "message") {');
check('the crisis check sits before the message / listings split, so no search can answer it', before > 0 && before < msg);

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ a message that is not a search is answered for what it is');
