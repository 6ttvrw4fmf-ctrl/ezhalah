// The bare answer to «تقصد مدينة X كاملة، أو حي معيّن؟» must keep the city X.
//
// THE DEFECT THIS EXISTS TO PREVENT (found live on production 2026-08-29 by the AF + Trending
// routine, while driving ordinary non-Riyadh AF journeys through the الوكيل الذكي flow).
//
// The app asks its own question — «تقصد مدينة الدمام كاملة، أو حي معيّن؟» — and the user answers it
// with the phrase the question invites: «المدينة كاملة» ("the whole city"). Measured against
// https://ezhalah-app.vercel.app the same minute, reading the request the page actually sent:
//
//   answer «المدينة كاملة» → p_cities = [المدينة المنورة, ينبع, العلا, أملج, بدر, الحناكية,
//                                        خيبر, مهد الذهب]   ·  1,155 results
//   answer «كامل الدمام»  → p_cities = [الدمام]              ·  2,600 results
//
// Identical wrong 8-city fan-out for جدة and أبها, and for the phrasing «المدينة كلها». The generic
// Arabic noun «المدينة» in the answer was re-parsed as the CITY NAME المدينة المنورة, and the city
// the app had just named was silently dropped — so the results, every Advanced Filter question and
// count computed from them, and Trending, all belonged to a region 1,200 km from the one asked
// about. Nothing in the UI said the scope had changed.
//
// ROOT CAUSE. `pendingScopeRef` in src/app/agent.tsx is only ever set for region-AND-city TWIN names
// (الرياض, جازان, …). For a PLAIN city the app remembered nothing about the question it had just
// asked, so the next turn's parse was free to invent a different city out of the generic answer.
//
// WHAT IS PINNED HERE, in both directions:
//   1. isGenericWholeAreaAnswer() accepts the bare generic affirmations and REJECTS anything that
//      carries a place of its own — it must never be able to overwrite a city the user did name.
//   2. The question template and its subject parser round-trip, so the template cannot drift out
//      from under the parser and silently stop arming the fix.
//   3. agent.tsx actually WIRES it: the ref is armed where the question is asked, read-and-cleared
//      once per turn, applied to the query's location, and cleared by New Chat.
//
//   node --experimental-strip-types scripts/verify-agent-whole-city-answer.ts  (auto-discovered by npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isGenericWholeAreaAnswer, scopeNamedForTwin } from '../src/lib/regionOrCityAnswer.ts';

const root = join(import.meta.dirname, '..');
const agentRaw = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
// Prose describes intent; only executable source may satisfy a wiring check.
const agentSrc = agentRaw
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nThe bare «المدينة كاملة» answer keeps the city the app asked about\n');

// ── 1. THE PREDICATE ACCEPTS a generic whole-area answer ────────────────────────────────────────
// Every one of these is a real way to say "yes, the whole city" and carries NO place of its own.
for (const yes of [
  'المدينة كاملة',   // the exact phrasing that broke production
  'المدينة كلها',
  'كل المدينة',
  'المدينة',         // bare — an answer, because WE asked
  'كاملة',
  'كامل',
  'نعم المدينة كاملة',
  'المدينة كاملة.',   // trailing punctuation must not matter
  'the whole city',
]) {
  check(`accepts «${yes}»`, isGenericWholeAreaAnswer(yes) === true);
}

// ── 2. THE PREDICATE REJECTS anything carrying its own place ────────────────────────────────────
// This half is what makes the fix safe: it can only refuse to FORGET a city, never overwrite one.
for (const no of [
  'كامل الدمام',        // the user named a city — their words win, untouched
  'كامل جدة',
  'المدينة المنورة',    // they really do want Madinah — must NOT be treated as generic
  'مدينة المدينة المنورة',
  'حي الشاطئ',          // they picked a district, the opposite answer
  'حي معين',
  'الرياض كاملة',
  'شقة في الخبر',
  '',                    // nothing said
  '؟',                   // punctuation only
  'في من',               // filler with no affirmation is not an answer
]) {
  check(`rejects «${no || '(empty)'}»`, isGenericWholeAreaAnswer(no) === false);
}

// ── 3. It does not disturb the TWIN answer path it sits beside ──────────────────────────────────
check('the twin parser still reads «مدينة الرياض» as the city choice',
  scopeNamedForTwin('مدينة الرياض', 'الرياض') === 'city');
check('the twin parser still reads «منطقة الرياض» as the region choice',
  scopeNamedForTwin('منطقة الرياض', 'الرياض') === 'region');
// «المدينة كاملة» names no twin, so the twin parser must stay silent on it — the two answers are
// different questions and must not cross-talk.
check('the twin parser stays silent on a bare whole-area answer',
  scopeNamedForTwin('المدينة كاملة', 'الرياض') === null);

// ── 4. TEMPLATE ↔ PARSER ROUND-TRIP ─────────────────────────────────────────────────────────────
// Executed against the real source, so a reworded question that the parser can no longer read is a
// loud failure rather than a fix that silently stops arming itself.
const tplMatch = /export const wholeCityQuestion = \(cityAr: string\) => (`[^`]+`)/.exec(agentSrc);
check('wholeCityQuestion() is exported from agent.tsx', !!tplMatch,
  'the question template must live in one named place so the parser can be pinned to it');
const subjMatch = /export function wholeCityQuestionSubject[\s\S]*?exec\(\(text \?\? ''\)\.trim\(\)\)/.exec(agentSrc);
check('wholeCityQuestionSubject() is exported from agent.tsx', !!subjMatch);

if (tplMatch) {
  // Rebuild both halves from the source text and prove they agree for real city names.
  const tplBody = tplMatch[1].slice(1, -1); // strip the backticks
  const render = (city: string) => tplBody.replace('${cityAr}', city);
  const reMatch = /const m = (\/\^.*?\/u)\.exec/.exec(agentSrc);
  check('the subject parser uses a single anchored regex', !!reMatch);
  if (reMatch) {
    // eslint-disable-next-line no-eval
    const re: RegExp = (0, eval)(reMatch[1]);
    for (const city of ['الدمام', 'جدة', 'أبها', 'المدينة المنورة', 'رأس تنورة']) {
      const rendered = render(city);
      const back = re.exec(rendered.trim())?.[1]?.trim() ?? null;
      check(`round-trip «${city}»`, back === city,
        `rendered=${rendered}\n      parsed back=${back}`);
    }
    // A question that is NOT this one must not yield a subject — otherwise the ref would arm on the
    // twin question or the district question and commit a city nobody asked about.
    for (const other of [
      'تقصد مدينة الرياض ولا منطقة الرياض كاملة؟',
      '«حي البلد» موجود في أكثر من مدينة (جدة، مكة). أي مدينة تقصدها؟',
      'في أي مدينة تبحث؟',
    ]) {
      check(`no subject parsed out of «${other.slice(0, 34)}…»`, re.exec(other.trim()) === null);
    }
  }
}

// ── 5. THE WIRING — a predicate nothing calls protects nothing ──────────────────────────────────
check('agent.tsx imports isGenericWholeAreaAnswer',
  /import \{[^}]*isGenericWholeAreaAnswer[^}]*\} from '@\/lib\/regionOrCityAnswer'/.test(agentSrc));
check('a pendingCityRef holds the city the plain-city question was about',
  /const pendingCityRef = useRef<string \| null>\(null\)/.test(agentSrc));
// RETIRED (owner-approved unified-agent-search-authority consolidation, 2026-08-30): the client's
// own clarify-or-search gate — the only call site that ever armed pendingCityRef — is deleted along
// with src/lib/agentQuestionBudget.ts. The plain-city question is now decided server-side by
// decideAgentTurn() in supabase/functions/agent/decide.ts; asserting the ref stays UNARMED from that
// retired path is the correct invariant now, not asserting it fires.
check('the client no longer arms pendingCityRef from its own retired clarify-or-search gate',
  !/pendingCityRef\.current = wholeCityQuestionSubject\(/.test(agentSrc));
check('the ref is READ AND CLEARED once per turn (one question, one answer)',
  /const askedCity = pendingCityRef\.current;\s*pendingCityRef\.current = null;/.test(agentSrc),
  'leaving it armed would let a later, unrelated message be treated as the answer');
check('the answer is only honoured when WE asked (askedCity gates the predicate)',
  /const genericWholeArea = !!askedCity && isGenericWholeAreaAnswer\(v\)/.test(agentSrc),
  'unprompted «المدينة كاملة» must not rewrite anything — same rule as scopeNamedForTwin');
check('on a generic answer the query keeps the city we asked about',
  /genericWholeArea\) turn = \{ \.\.\.turn, query: \{ \.\.\.turn\.query, location: askedCity! \} \}/.test(agentSrc));
check('a model that drifts off-thread still searches that city',
  /genericWholeArea && turn\.kind === 'message'/.test(agentSrc),
  'the twin path already recovers this way; the plain-city path must too, or the answer is lost');
check('New Chat clears the pending city',
  /pendingCityRef\.current = null;\s*\/\/ …including the plain-city question|setMsgs\(\[\]\);[\s\S]{0,200}?pendingCityRef\.current = null/.test(agentRaw),
  'a half-answered question must never leak into a fresh conversation');

// The plain-city branch must go through the template, or the subject parser reads a question that is
// never actually shown.
check('the plain-city clarification renders through wholeCityQuestion()',
  /return wholeCityQuestion\(cityDisplay\(lm\.city, 'ar'\)\)/.test(agentSrc));

console.log(failures === 0
  ? '\n✅ verify-agent-whole-city-answer: all checks passed.\n'
  : `\n❌ verify-agent-whole-city-answer: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
