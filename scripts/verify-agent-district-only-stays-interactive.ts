// A USER WHO TYPES ONLY A DISTRICT KEEPS GETTING AN INTERACTIVE ANSWER, NEVER «SORRY, I CAN'T» (owner 2026-10-11).
//
// The owner typed «النرجس» and got «ما قدرت أعرف المدينة أو الحي اللي تقصده. تقدر تجرب الفلتر وتحدد بنفسك» — an apology and a dead end —
// instead of «this district is in 4 cities: Riyadh, Tarut, Qatif, Unaizah — which one?». Root causes, all reproduced on the LIVE agent:
//   1. the location question had a budget of ONE; the agent had already asked «أي مدينة؟» for «ابغى شقة», so the district got the apology;
//   2. «said a city» read the BOT'S OWN earlier list («الرياض، تاروت…») as the user's choice, so «مو مهم» silently became Riyadh and
//      «جدة» became «حي النرجس بجدة» (a district Jeddah does not have);
//   3. «مو مهم / أي مدينة» claimed «all cities» while searching one;
//   4. an English «apartment in Olaya» got an ARABIC question.
// This EXECUTES the decision ladder and every new builder, then pins the wiring, with a mutation for each.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideAgentTurn, QUESTION_BUDGET_CEILING } from '../supabase/functions/agent/decide.ts';
import * as q from '../src/data/questionExamples.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nA district-only message stays interactive\n');

const empty = { location: null, type: null, price: null, detail: null, amenities: null, af: null, priorAskAbout: null } as const;
const ambiguous = (askCount: number) => decideAgentTurn({ rawText: 'النرجس', locationAmbiguous: true, establishedState: { ...empty, location: 'حي النرجس' }, askCount });
check('the location question is asked up to 3 times, not once (the owner\'s «why didn\'t he keep it interactive?»)', QUESTION_BUDGET_CEILING === 3);
check('a second and a third ambiguous place are asked about again (a question, askCount + 1), never given up on',
  [0, 1, 2].every((n) => { const r = ambiguous(n); return r.kind === 'message' && r.askCount === n + 1 && !r.unsearchable; }));
check('only after the budget is spent does the turn stop asking, and then it still carries an invitation, not an apology',
  ambiguous(3).unsearchable === true
  && [false, true].every((en) => Array.from({ length: 12 }, (_, i) => q.unsearchableText(en, `s${i}`)).every((r) => /(?:اكتب|Type|type)/.test(r) && !/(?:عذراً|عذرا|للأسف|ما قدرت|Sorry|couldn't|can't|Unfortunately)/i.test(r) && /\p{Extended_Pictographic}$/u.test(r))));

// the words the user said, not the bot's own list
const edge = read('supabase/functions/agent/index.ts');
const hayLine = windowBetween(edge, 'const hay = arNorm(', '\n', 'index.ts');
const usersOnly = (src: string) => /history\.filter\(\(h\) => h\?\.role !== "model"\)/.test(src);
check('«said a city» reads ONLY what the user wrote, never the bot\'s own list of candidate cities', usersOnly(hayLine));
mustCatch('the bot\'s own reply counting as the user\'s choice again', !usersOnly(hayLine.replace('history.filter((h) => h?.role !== "model")', 'history')));

// a new ambiguous place is always asked about
const twin = windowBetween(edge, 'else if (ck === "twin_city") {', 'ambiguityReply = plainRegionQuestion(', 'index.ts');
const alwaysAsks = (src: string) => /else if \(regions\.length > 1\) \{/.test(src) && /else if \(cities\.length > 1\) \{/.test(src) && /else if \(ck === "region"\) \{/.test(src) && !/!alreadyAsked && (?:regions|cities)\.length/.test(src);
check('a twin city / twin district / region is asked about even when the previous bot message was a question too', alwaysAsks(twin));
mustCatch('the ask-once gate coming back (the owner\'s dead end)', !alwaysAsks(twin.replace('else if (cities.length > 1) {', 'else if (!alreadyAsked && cities.length > 1) {')));

// «any city»
const T: Array<[string, boolean]> = [['مو مهم', true], ['اي مدينة', true], ['أي مدينة', true], ['ما يفرق', true], ['كلها', true], ['any city', true], ["doesn't matter", true], ['الرياض', false], ['جدة', false], ['النرجس', false], ['شقة', false], ['Riyadh', false]];
check('«مو مهم / أي مدينة / any city» is recognized, a city name is not', T.every(([t, w]) => q.ANY_CITY_RE.test(t) === w), T.filter(([t, w]) => q.ANY_CITY_RE.test(t) !== w).map(([t]) => t).join(' | '));
const any = [q.anyCityText(false, 'x', '', 'الرياض', 'حي النرجس'), q.anyCityText(true, 'x', '', 'الرياض', 'Al Narjis')];
check('the «any city» reply names the city it really searches and why (most listings), with its emoji and no dash', any.every((r) => /(?:الرياض|Riyadh)/.test(r) && /\p{Extended_Pictographic}$/u.test(r) && !/[-‐-―−]/.test(r) && !/\{\w+\}/.test(r)), any.join(' | '));
const anyWired = (src: string) => /const anyCity = !pick && alreadyAsked && ANY_CITY_RE\.test\(text\) && cities\.length > 0;/.test(src) && /if \(anyCityReply\) replyOut = anyCityReply;/.test(src);
check('the district is searched in the biggest city of its list and the reply says so', anyWired(edge));
mustCatch('«any city» searching one city while the reply says «all»', !anyWired(edge.replace('if (anyCityReply) replyOut = anyCityReply;', '')));

// English gets English
const en = [q.twinDistrictQuestion('الملقا', q.listCities(['الرياض', 'جدة', 'الدمام'], true), 'x', '', true), q.twinRegionQuestion('الهفوف', 'Eastern, Riyadh', 'x', '', true), q.regionQuestionText('عسير', 'x', '', true), q.regionOrCityQuestion('Riyadh', 'x', '', true), q.nearQuestionEn('near the mall', 'x'), q.geoQuestionEn('x')];
check('an English message gets an ENGLISH place question: no Arabic words around the city names, a ? and its 📍', en.every((r) => !/[؀-ۿ]/.test(r.replace(/«[^»]*»|"[^"]*"/g, '').replace(/(?:الملقا|الهفوف|عسير)/g, '')) && /\?/.test(r) && r.endsWith('📍')), en.join(' | '));
check('the city list is localized: «A، B، وC» / «A, B and C», and «or another city» when there are more', q.listCities(['الرياض', 'جدة', 'الدمام'], false) === 'الرياض، جدة، والدمام' && q.listCities(['الرياض', 'جدة', 'الدمام'], true) === 'Riyadh, Jeddah and Dammam' && /another city/.test(q.listCities(['الرياض', 'جدة'], true, true)));
const enWired = (src: string) => /twinDistrictQuestion\(nm, listCities\(top, locale === "en", cities\.length > top\.length\), text, lastBotReply, locale === "en"\)/.test(src) && /plainRegionQuestion\(nm, text, lastBotReply, locale === "en"\)/.test(src) && /emptyLocationQuestion\(text, lastBotReply, locale === "en"\)/.test(src);
check('the edge asks in the language of the reply', enWired(edge));
mustCatch('the district question forgetting English', !enWired(edge.replace('cities.length > top.length), text, lastBotReply, locale === "en")', 'cities.length > top.length), text, lastBotReply)')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ a district-only message stays interactive');
