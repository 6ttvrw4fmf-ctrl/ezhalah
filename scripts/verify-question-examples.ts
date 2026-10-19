// EXAMPLES INSIDE THE AGENT'S QUESTIONS (owner 2026-10-11: «always give examples so the user knows what to type»).
//
// The questions the CODE writes (the app's locationClarification and the edge function's city floor) now carry an
// example picked from real data, end with one emoji, and are NOT the same sentence for everyone (owner 2026-10-11: «don't
// ask every user the exact same question — in what city — it's not nice»). Rules pinned here:
//   • the example cities are the two with the most listings (Riyadh 152,942 · Jeddah 82,466, measured 2026-10-11);
//   • the example SEARCHES are sentences already proven against the live agent (INTRO_EXAMPLES / _EN);
//   • the two copies of the constants (src/ and the Deno edge function) can never drift apart;
//   • every plain "which city" question carries the example and the 📍; none carries a recommendation word.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as app from '../src/data/questionExamples.ts';
import * as edge from '../supabase/functions/agent/questionExamples.ts';
import { INTRO_EXAMPLES, INTRO_EXAMPLES_EN } from '../src/data/introExamples.ts';
import { emptyLocationQuestion, plainRegionQuestion } from '../supabase/functions/agent/locationAmbiguity.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nQuestions carry a real example and end with an emoji\n');

// 1. the constants
check('the default example cities are Riyadh and Jeddah (the two with the most listings)', app.EXAMPLE_CITIES_AR.join() === 'الرياض,جدة' && app.EXAMPLE_CITIES_EN.join() === 'Riyadh,Jeddah');
check('the example searches are proven sentences', (INTRO_EXAMPLES as readonly string[]).includes(app.EXAMPLE_SEARCH_AR) && (INTRO_EXAMPLES_EN as readonly string[]).includes(app.EXAMPLE_SEARCH_EN));
const norm = (o: any) => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'function' ? String(v) : v])));
const same = (a: any, b: any) => norm(a) === norm(b);
check('the edge-function copy is identical to the app copy', same(app, edge));
mustCatch('a copy that drifted (a different example city)', !same(app, { ...edge, EXAMPLE_CITIES_AR: ['الرياض', 'الدمام'] }));
mustCatch('an example search that was never proven', !(INTRO_EXAMPLES as readonly string[]).includes('أبي قصر في جدة'));

// 2. the questions written by code (executed where they are pure)
const q1 = emptyLocationQuestion('ابغى شقة قريبة من الافنيوز'), q2 = emptyLocationQuestion('ابغى شقة على البحر'), q3 = plainRegionQuestion('عسير', 'ابغى شقة بعسير');
const ends = (t: string | null) => !!t && /\p{Extended_Pictographic}️?$/u.test(t);
check('the edge function\'s city questions end with an emoji', [q1, q2, q3].every(ends));
const hasExample = (t: string | null) => !!t && app.EXAMPLE_PAIRS_AR.some(([a, b]) => t.includes(`مثلاً ${a} أو ${b}`));
check('the "which city" ones carry two example cities', [q1, q2].every(hasExample));
check('the near-phrase question still echoes the user\'s own words', !!q1 && q1.includes('قريبة من الافنيوز'));

// 2b. NOT THE SAME SENTENCE FOR EVERYONE
const msgs = Array.from({ length: 60 }, (_, i) => ['ابي بيت', 'ابغى شقة', 'ابي فيلا للبيع', 'شقة للايجار', 'ارض', 'ابي استراحة', 'محل', 'مكتب', 'مستودع', 'ابغى عمارة'][i % 10] + ' ' + i);
const arQs = msgs.map((m) => app.cityQuestionAr(m)), enQs = msgs.map((m) => app.cityQuestionEn(m));
const phrasing = (q: string) => q.split(' مثلاً ')[0];
check('60 different messages get at least 6 different Arabic city questions', new Set(arQs.map(phrasing)).size >= 6, String(new Set(arQs.map(phrasing)).size));
check('…and at least 5 different English ones', new Set(enQs.map((q) => q.split(' For example ')[0])).size >= 5);
check('…and at least 4 different example pairs', new Set(arQs.map((q) => q.split(' مثلاً ')[1])).size >= 4);
check('the SAME message always gets the SAME question (no randomness: testable, and a refresh does not change it)', app.cityQuestionAr('ابي بيت') === app.cityQuestionAr('ابي بيت') && edge.cityQuestionAr('ابي بيت') === app.cityQuestionAr('ابي بيت'));
const dodge = app.cityQuestionAr('ابي بيت'); const second = app.cityQuestionAr('ابي بيت', dodge);
check('a question never repeats the phrasing the previous bot message already used', phrasing(second) !== phrasing(dodge) && msgs.every((m) => phrasing(app.cityQuestionAr(m, app.cityQuestionAr(m))) !== phrasing(app.cityQuestionAr(m))));
check('every phrasing is ONE question (one «؟»/«?»), ends with the 📍 after an example, has no «أبشر» and no recommendation',
  [...app.CITY_ASK_AR, ...app.GEO_ASK_AR, ...app.NEAR_ASK_AR, ...app.WHOLE_CITY_ASK_AR, ...app.CITY_ASK_EN].every((t) => (t.match(/[؟?]/g) ?? []).length === 1 && !/أبشر|best|أفضل|ننصح/i.test(t))
  && [...arQs, ...enQs].every((q) => q.endsWith(app.PIN) && /(مثلاً|For example) /.test(q)));
check('the example cities are all among the six biggest (≥ 9,000 listings each, measured 2026-10-11)',
  [...app.EXAMPLE_PAIRS_AR.flat()].every((c) => ['الرياض', 'جدة', 'الخبر', 'الدمام', 'مكة المكرمة', 'المدينة المنورة'].includes(c)) && app.EXAMPLE_PAIRS_AR.length === app.EXAMPLE_PAIRS_EN.length);
check('every whole-city phrasing is read back to its city by wholeCityQuestionSubject()',
  app.WHOLE_CITY_ASK_AR.every((t) => ['الرياض', 'مكة المكرمة', 'جدة'].every((c) => app.wholeCityQuestionSubject(t.replace('{c}', c) + ' ' + app.PIN) === c)));
mustCatch('a pool that collapsed to one sentence', new Set(msgs.map((m) => app.pickVariant([app.CITY_ASK_AR[0]], m))).size < 6);

// 3. the sources: the app's questions and the edge function's floor
const agent = read('src/app/agent.tsx'), index = read('supabase/functions/agent/index.ts');
const wired = (a: string, i: string) =>
  /return nearQuestionAr\(prox\.join\(' و'\), userText\);\s*return cityQuestionAr\(userText, '', q\.type\);/.test(a)
  && /return geoQuestionAr\(userText\);/.test(a)
  && /return twinDistrictQuestion\(arLabel\(lm\.label\)/.test(a)
  && /cityQuestionEn\(text, lastBotReply, wired\.establishedState\.type\)/.test(i) && /cityQuestionAr\(text, lastBotReply, wired\.establishedState\.type\)/.test(i)
  && /noIntentReplyText\(locale === "en", text, lastBotReply\)/.test(i)
  && [...Array(12)].every((_, k) => app.noIntentReplyText(false, `s${k}`).includes(app.EXAMPLE_SEARCH_AR) && app.noIntentReplyText(true, `s${k}`).includes(app.EXAMPLE_SEARCH_EN)
    && app.noIntentReplyText(false, `s${k}`).endsWith(app.HOUSE));
check('the app and the edge function build their questions from the shared, rotating pools', wired(agent, index));
mustCatch('the app\'s plain city question going back to one fixed sentence', !wired(agent.replace("return cityQuestionAr(userText, '', q.type);", 'return `في أي مدينة تبحث؟ ${PIN}`;'), index));
mustCatch('the edge function\'s English city floor going back to one fixed sentence', !wired(agent, index.replace('cityQuestionEn(text, lastBotReply, wired.establishedState.type)', '`Which city are you searching in? ${PIN}`')));
mustCatch('the edge function\'s city floor forgetting the previous bot message', !wired(agent, index.replace('cityQuestionAr(text, lastBotReply, wired.establishedState.type)', 'cityQuestionAr(text)')));
mustCatch('the edge function\'s no-intent reply going back to one fixed sentence', !wired(agent, index.replace('noIntentReplyText(locale === "en", text, lastBotReply)', '`أنا إزهله`')));
check('no example sentence recommends anything («best», «أفضل», «ننصح»)', ![app.EXAMPLE_SEARCH_AR, app.EXAMPLE_SEARCH_EN, app.cityExampleAr(), app.cityExampleEn(), ...arQs, ...enQs].some((t) => /(best|أفضل|ننصح|انصح|recommend)/i.test(t)));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ questions carry a real example and end with an emoji');
