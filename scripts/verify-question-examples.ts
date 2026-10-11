// EXAMPLES INSIDE THE AGENT'S QUESTIONS (owner 2026-10-11: «always give examples so the user knows what to type»).
//
// The questions the CODE writes (the app's locationClarification and the edge function's city floor) now carry an
// example picked from real data, and end with one emoji. Rules pinned here:
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
check('the example cities are Riyadh and Jeddah (the two with the most listings)', app.EXAMPLE_CITIES_AR.join() === 'الرياض,جدة' && app.EXAMPLE_CITIES_EN.join() === 'Riyadh,Jeddah');
check('the example searches are proven sentences', (INTRO_EXAMPLES as readonly string[]).includes(app.EXAMPLE_SEARCH_AR) && (INTRO_EXAMPLES_EN as readonly string[]).includes(app.EXAMPLE_SEARCH_EN));
const same = (a: any, b: any) => JSON.stringify(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'function' ? (v as any)() : v]))) === JSON.stringify(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === 'function' ? (v as any)() : v])));
check('the edge-function copy is identical to the app copy', same(app, edge));
mustCatch('a copy that drifted (a different example city)', !same(app, { ...edge, EXAMPLE_CITIES_AR: ['الرياض', 'الدمام'] }));
mustCatch('an example search that was never proven', !(INTRO_EXAMPLES as readonly string[]).includes('أبي قصر في جدة'));

// 2. the questions written by code (executed where they are pure)
const q1 = emptyLocationQuestion('ابغى شقة قريبة من الافنيوز'), q2 = emptyLocationQuestion('ابغى شقة على البحر'), q3 = plainRegionQuestion('عسير', 'ابغى شقة بعسير');
const ends = (t: string | null) => !!t && /\p{Extended_Pictographic}️?$/u.test(t);
check('the edge function\'s city questions end with an emoji', [q1, q2, q3].every(ends));
check('the "which city" ones carry the example cities', [q1, q2].every((t) => !!t && t.includes('مثلاً الرياض أو جدة')));

// 3. the sources: the app's questions and the edge function's floor
const agent = read('src/app/agent.tsx'), index = read('supabase/functions/agent/index.ts');
const wired = (a: string, i: string) =>
  /return `في أي مدينة تبحث؟ \$\{cityExampleAr\(\)\} \$\{PIN\}`;/.test(a)
  && /return `تقصد في أي مدينة أو منطقة؟ \$\{cityExampleAr\(\)\} \$\{PIN\}`;/.test(a)
  && /أي مدينة تقصدها؟ \$\{PIN\}`/.test(a)
  && /Which city are you searching in\? \$\{cityExampleEn\(\)\} \$\{PIN\}/.test(i)
  && /في أي مدينة تبحث؟ \$\{cityExampleAr\(\)\} \$\{PIN\}/.test(i)
  && /مثلاً: \$\{EXAMPLE_SEARCH_AR\} \$\{HOUSE\}/.test(i) && /for example: \$\{EXAMPLE_SEARCH_EN\} \$\{HOUSE\}/.test(i);
check('the app and the edge function build their questions from the shared example', wired(agent, index));
mustCatch('the app\'s plain city question losing its example', !wired(agent.replace('في أي مدينة تبحث؟ ${cityExampleAr()} ${PIN}`;', 'في أي مدينة تبحث؟`;'), index));
mustCatch('the edge function\'s English city floor losing its example', !wired(agent, index.replace('Which city are you searching in? ${cityExampleEn()} ${PIN}', 'Which city are you searching in?')));
mustCatch('the edge function\'s no-intent reply losing its example search', !wired(agent, index.replace('مثلاً: ${EXAMPLE_SEARCH_AR} ${HOUSE}', '')));
check('no example sentence recommends anything («best», «أفضل», «ننصح»)', ![app.EXAMPLE_SEARCH_AR, app.EXAMPLE_SEARCH_EN, app.cityExampleAr(), app.cityExampleEn()].some((t) => /(best|أفضل|ننصح|انصح|recommend)/i.test(t)));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ questions carry a real example and end with an emoji');
