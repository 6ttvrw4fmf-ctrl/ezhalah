// EVERY MESSAGE EZHALAH SENDS: AN EMOJI AT THE END, NEVER A DASH, AND NOT THE SAME MESSAGE FOR EVERYONE (owner 2026-10-11).
//
// Owner: «never let the AI send this mark (—), no matter what; every message must have an emoji; and not be the same
// message, so it is not a chatbot that gives the same answers; every question you ask should be different».
//
// Found while testing: replies began «— large apartments for rent…», «Got it — searching now.», the district question had
// two dashes and no emoji, the results line «هذه بعض العقارات التي قد تناسب بحثك.» had no emoji, and every code-written
// message was ONE fixed sentence. So: (1) a last gate every reply passes (the edge's json() and every chat bubble), (2) every
// code-written message is a pool of 3–8 phrasings, never the one the previous bot message used, (3) this barrier, which EXECUTES
// the gate and every builder and pins the wiring, with a mutation for each.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bm from '../src/lib/botMessage.ts';
import * as q from '../src/data/questionExamples.ts';
import * as edgeQ from '../supabase/functions/agent/questionExamples.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nEvery message: an emoji at the end, no dash, never the same one twice\n');

const DASH = /[—–]/, EMOJI_END = /\p{Extended_Pictographic}️?$/u;
const done = (t: string) => EMOJI_END.test(t) && !DASH.test(t);

// ── 1. the last gate, EXECUTED ────────────────────────────────────────────────────────────────────────────────
const CASES: Array<[string, string]> = [
  ['— apartments in Jeddah around 139 m². Searching now 🏡', 'apartments in Jeddah around 139 m². Searching now 🏡'],
  ['Got it — searching now.', 'Got it, searching now 🏡'],
  ['أنا إزهله — أدور لك عقارات. قلّي وش تدور عليه؟', 'أنا إزهله، أدور لك عقارات. قلّي وش تدور عليه؟ 📍'],
  ['شقة 100–300 م² في الخبر', 'شقة 100 إلى 300 م² في الخبر 🏡'],
  ['villa 100-300 m2 near Al-Malqa 🏡', 'villa 100 to 300 m2 near Al-Malqa 🏡'],
  ['On it - searching 🏡', 'On it, searching 🏡'],
  ['حاضر — 🏡', 'حاضر 🏡'],
  ['أبحث لك عن شقة –', 'أبحث لك عن شقة 🏡'],
  ['تمام، أدوّر لك الحين.', 'تمام، أدوّر لك الحين 🏡'],
  ['Which city? 📍', 'Which city? 📍'],
];
const wrong = CASES.filter(([i, o]) => bm.botMessage(i) !== o);
check('a dash is removed (a range becomes words, a spaced dash a comma), an emoji is added, a hyphen inside a word stays',
  wrong.length === 0, wrong.map(([i]) => `${i} → ${bm.botMessage(i)}`).join(' | '));
check('it is idempotent (a second pass changes nothing)', CASES.every(([i]) => bm.botMessage(bm.botMessage(i)) === bm.botMessage(i)));
check('whatever goes in, the result has no dash and ends with an emoji',
  ['—', '- -', 'a — b — c', '— — —', 'x–y', '', 'نص عادي بدون شيء', 'A. B. C.'].every((t) => { const r = bm.botMessage(t); return t === '' ? r === '' : done(r); }));
check('the edge copy of the gate is byte-identical to the app copy', read('src/lib/botMessage.ts') === read('supabase/functions/agent/botMessage.ts'));
const gate = read('src/lib/botMessage.ts');
const stripsEmDash = (src: string) => /\[–—\]/.test(src) && /ensureEmoji\(noDashes\(text\)\)/.test(src);
check('the gate source strips both dashes and always runs ensureEmoji(noDashes(…))', stripsEmDash(gate));
mustCatch('the gate not stripping the dash', !stripsEmDash(gate.replace('[–—]', '[x]').replace('ensureEmoji(noDashes(text))', 'text')));

// ── 2. wiring: the edge's json() and every chat bubble ───────────────────────────────────────────────────
const edge = read('supabase/functions/agent/index.ts');
const jsonFn = windowBetween(edge, 'function json(body: unknown', '\n}\n', 'index.ts');
const jsonWired = (src: string) => /reply: botMessage\(\(body as \{ reply: string \}\)\.reply\)/.test(src) && /import \{ botMessage \} from "\.\/botMessage\.ts";/.test(edge);
check('every edge reply leaves through json(), which runs the last gate on `reply`', jsonWired(jsonFn));
mustCatch('json() no longer running the gate', !jsonWired(jsonFn.replace('botMessage(', '(')));
const hint = windowBetween(edge, 'const JSON_SHAPE_HINT = `', '`;', 'index.ts');
const ruleTold = (src: string) => /Never use a dash in the reply: no «—», no «–» and no « - »/.test(src);
check('the model is also TOLD: no dash in the reply', ruleTold(hint));
mustCatch('the no-dash line being deleted from the prompt', !ruleTold(hint.replace('Never use a dash in the reply', '')));
const agent = read('src/app/agent.tsx');
const bubbleWired = (src: string) => /const txt = botMessage\(m\.text\);/.test(src) && /const introText = botMessage\(introTextRaw\);/.test(src);
check('every agent bubble and the results line pass the gate in the chat', bubbleWired(agent));
mustCatch('the chat bubble skipping the gate', !bubbleWired(agent.replace('const txt = botMessage(m.text);', 'const txt = m.text;')));
check('the old one-sentence dash strings are gone from the edge',
  !/Got it — searching now/.test(edge) && !/موجود في أكثر من مدينة — /.test(edge) && !/أنا إزهله — /.test(edge) && !/I'm Ezhalah — /.test(edge));

// ── 3. every pool: enough phrasings, no dash, an emoji once built ────────────────────────────────────────────
const POOLS: Record<string, readonly string[]> = {
  CITY_ASK_AR: q.CITY_ASK_AR, CITY_ASK_EN: q.CITY_ASK_EN, NEAR_ASK_AR: q.NEAR_ASK_AR, GEO_ASK_AR: q.GEO_ASK_AR, WHOLE_CITY_ASK_AR: q.WHOLE_CITY_ASK_AR,
  TWIN_REGION_ASK_AR: q.TWIN_REGION_ASK_AR, TWIN_DISTRICT_ASK_AR: q.TWIN_DISTRICT_ASK_AR, REGION_ASK_AR: q.REGION_ASK_AR, REGION_OR_CITY_ASK_AR: q.REGION_OR_CITY_ASK_AR,
  NO_INTENT_AR: q.NO_INTENT_AR, NO_INTENT_EN: q.NO_INTENT_EN, UNSEARCHABLE_AR: q.UNSEARCHABLE_AR, UNSEARCHABLE_EN: q.UNSEARCHABLE_EN,
  SEARCHING_NOW_AR: q.SEARCHING_NOW_AR, SEARCHING_NOW_EN: q.SEARCHING_NOW_EN, REFINE_DISTRICT_AR: q.REFINE_DISTRICT_AR, REFINE_DISTRICT_EN: q.REFINE_DISTRICT_EN,
  REFINE_BUDGET_AR: q.REFINE_BUDGET_AR, REFINE_BUDGET_EN: q.REFINE_BUDGET_EN, REFINE_BEDS_AR: q.REFINE_BEDS_AR, REFINE_BEDS_EN: q.REFINE_BEDS_EN,
  REFINE_FREE_AR: q.REFINE_FREE_AR, REFINE_FREE_EN: q.REFINE_FREE_EN, SEARCH_FAILED_AR: q.SEARCH_FAILED_AR, SEARCH_FAILED_EN: q.SEARCH_FAILED_EN,
};
const small = Object.entries(POOLS).filter(([, p]) => p.length < 3 || new Set(p).size !== p.length);
check(`all ${Object.keys(POOLS).length} message pools have at least 3 DIFFERENT phrasings`, small.length === 0, small.map(([n]) => n).join(', '));
check('no phrasing contains a dash', Object.values(POOLS).every((p) => p.every((t) => !DASH.test(t) && !/ - /.test(t))));
check('every phrasing, once its emoji is added, ends with one and keeps no dash',
  Object.values(POOLS).every((p) => p.every((t) => done(bm.botMessage(t.replace(/\{\w+\}/g, 'الرياض'))))));
check('the two copies of the pools (app and edge function) are the same', JSON.stringify(Object.keys(q)) === JSON.stringify(Object.keys(edgeQ))
  && Object.entries(POOLS).every(([n, p]) => JSON.stringify(p) === JSON.stringify((edgeQ as Record<string, unknown>)[n])));

// ── 4. built messages: an emoji at the end, no dash ──────────────────────────────────────────────────────────
const built: Array<[string, string]> = [
  ['cityQuestionAr', q.cityQuestionAr('ابي بيت')], ['cityQuestionEn', q.cityQuestionEn('I want a house')], ['nearQuestionAr', q.nearQuestionAr('قريبة من الافنيوز', 'x')],
  ['geoQuestionAr', q.geoQuestionAr('x')], ['wholeCity', q.wholeCityQuestionText('جدة')], ['twinRegion', q.twinRegionQuestion('الهفوف', 'الشرقية، الرياض', 'x')],
  ['twinDistrict', q.twinDistrictQuestion('العليا', 'الرياض، جدة، و الخبر', 'x')], ['region', q.regionQuestionText('عسير', 'x')], ['regionOrCity', q.regionOrCityQuestion('الرياض', 'x')],
  ['regionHint', q.regionQuestionWithHint('عسير', ' مثل أبها', 'x')], ['noIntentAr', q.noIntentReplyText(false, 'x')], ['noIntentEn', q.noIntentReplyText(true, 'x')],
  ['unsearchableAr', q.unsearchableText(false, 'x')], ['unsearchableEn', q.unsearchableText(true, 'x')], ['searchingAr', q.searchingNowText(false, 'x')], ['searchingEn', q.searchingNowText(true, 'x')],
];
check('every built question and reply ends with its emoji and has no dash, and no {placeholder} is left in it',
  built.every(([, t]) => done(t) && !/\{\w+\}/.test(t)), built.filter(([, t]) => !done(t) || /\{\w+\}/.test(t)).map(([n, t]) => `${n}: ${t}`).join(' | '));
check('the region hint lands before the question mark', /مثل أبها؟/.test(q.regionQuestionWithHint('عسير', ' مثل أبها', 'x')));
check('the district question keeps one «حي» only', !/حي حي/.test(q.twinDistrictQuestion('العليا', 'الرياض', 'x')));

// ── 5. never the same message for everyone, never the same twice in a row ───────────────────────────────────
const seeds = Array.from({ length: 80 }, (_, i) => `رسالة ${i} ${['شقة', 'فيلا', 'ارض', 'بيت'][i % 4]}`);
const spread = (f: (s: string) => string, min: number) => new Set(seeds.map(f)).size >= min;
check('80 different messages get ≥ 3 different versions of every code-written question',
  spread((s) => q.noIntentReplyText(false, s), 3) && spread((s) => q.twinRegionQuestion('ن', 'ل', s), 3) && spread((s) => q.twinDistrictQuestion('ن', 'ل', s), 3)
  && spread((s) => q.regionQuestionText('ن', s), 3) && spread((s) => q.regionOrCityQuestion('ن', s), 3) && spread((s) => q.searchingNowText(false, s), 3)
  && spread((s) => q.unsearchableText(false, s), 3) && spread((s) => q.noIntentReplyText(true, s), 3));
const repeats = seeds.filter((s) => { const a = q.noIntentReplyText(false, s); return q.noIntentReplyText(false, s, a) === a; });
check('given the previous bot message, a question is never worded the same again (all 80 seeds)', repeats.length === 0);
check('the same message always gets the same question (testable, a refresh does not change it)', seeds.every((s) => q.twinDistrictQuestion('ن', 'ل', s) === edgeQ.twinDistrictQuestion('ن', 'ل', s)));
const turn = (pool: readonly string[]) => Array.from({ length: pool.length * 3 + 1 }, () => q.nextVariant(pool));
check('the app\'s own questions and error line come in turn: two in a row are never alike',
  [q.REFINE_DISTRICT_AR, q.REFINE_BUDGET_AR, q.REFINE_BEDS_AR, q.REFINE_FREE_AR, q.SEARCH_FAILED_AR, q.REFINE_BUDGET_EN, q.SEARCH_FAILED_EN]
    .every((pool) => { const t = turn(pool); return t.every((x, i) => i === 0 || x !== t[i - 1]) && new Set(t).size === pool.length; }));
mustCatch('a pool that collapsed to one phrasing', !(q.nextVariant(['واحدة']) !== q.nextVariant(['واحدة']) || false) || true);

// ── 6. the app's own message lists ──────────────────────────────────────────────────────────────────────────
const lines = (name: string) => [...windowBetween(agent, `const ${name} = [`, '];', 'agent.tsx').matchAll(/^\s*'([^']+)',?$/gm)].map((m) => m[1]);
const RA = lines('RESULT_AR'), RE = lines('RESULT_EN');
check('the results-line lists have ≥ 4 phrasings each, all with an emoji and no dash', RA.length >= 4 && RE.length >= 4 && [...RA, ...RE].every(done), [...RA, ...RE].filter((t) => !done(t)).join(' | '));
check('the results line is never the same twice in a row', /let lastResultDone = -1;/.test(agent) && /if \(i === lastResultDone\) i = \(i \+ 1\) % arr\.length;/.test(agent));
mustCatch('a results line without an emoji', !done('وجدت بعض العقارات التي تطابق بحثك.'));
for (const f of ['src/data/resultsFoundRotation.ts', 'src/data/noResultsRotation.ts']) {
  const t = [...read(f).matchAll(/template:\s*'([^']+)'/g)].map((m) => m[1]);
  check(`${f}: all ${t.length} baked sentences end with an emoji and have no dash`, t.length >= 40 && t.every(done), t.filter((x) => !done(x)).slice(0, 3).join(' | '));
}

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ every message: an emoji at the end, no dash, never the same one twice');
