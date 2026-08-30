// Regression guard for the AI-agent CLARIFY LOOP (`agent-clarify-loop`, found live 2026-08-23).
//
// THE DEFECT. Seven Saudi names are both a city and a region («الرياض», «جازان», «تبوك», «حائل»,
// «نجران», «الباحة», «الجوف»), so src/app/agent.tsx asks ««الرياض» اسم مدينة واسم منطقة في نفس الوقت.
// تقصد مدينة الرياض ولا منطقة الرياض كاملة؟». Answering with one of the two options THE APP ITSELF
// offered produced NO search in 7/7 fresh browser runs: the identical question came back, or a cold
// greeting, or the opposite question. On the SECOND identical answer the 2-ask cap fired and the app
// searched ALL of Saudi Arabia behind «ما قدرت أحدد الموقع بدقة، فبحثت في نطاق أوسع» — while its own
// Search Summary showed the location the user had named.
//
// ROOT CAUSE. locationClarification() in src/app/agent.tsx judged only the PARSED location: «الرياض»
// still resolves as a region-AND-city twin, so the branch re-fired every turn. It had escape hatches
// for «كاملة»/«كل المملكة» but none for «مدينة»/«منطقة» — the two words its own question offers. The
// edge function (supabase/functions/agent/index.ts) returned the right thing («kind":"listings",
// "location":"الرياض"», captured live); the client threw that answer away.
//
// TWO RULES THIS PROTECTS. (1) EXACT LOCATION ONLY — a user who names «مدينة الرياض» must get the city
// of Riyadh, and one who names «منطقة الرياض» must get the whole region; neither may be silently
// widened to the Kingdom or narrowed to the other. (2) The app must never re-ask a question the user
// just answered.
//
// WHAT THIS SCRIPT DOES. (a) genuinely IMPORTS AND EXECUTES src/lib/regionOrCityAnswer.ts — the
// zero-dependency module that decides which scope the user named and what location string searches it
// — against the live repro strings and the traps that make a naive .includes() fix wrong; (b)
// source-text asserts the three wiring points in src/app/agent.tsx, because that file transitively
// imports react-native and cannot be loaded from plain Node.
//
//   node --experimental-strip-types scripts/verify-agent-scope-answer.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { regionOrCityChoice, scopedLocation } from '../src/lib/regionOrCityAnswer.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// ── EXECUTED: which of the two offered scopes did the user name? ──────────────────────────────
check('the live repro answer «مدينة الرياض» is read as the CITY option', regionOrCityChoice('مدينة الرياض') === 'city');
check('the other offered answer «منطقة الرياض» is read as the REGION option', regionOrCityChoice('منطقة الرياض') === 'region');
check('the short natural answer «مدينة» is read as the CITY option', regionOrCityChoice('مدينة') === 'city');
check('«ابغى شقة في مدينة الرياض» (said up front, not as an answer) is read as the CITY option', regionOrCityChoice('ابغى شقة في مدينة الرياض') === 'city');
check('«منطقة الرياض كاملة» is read as the REGION option', regionOrCityChoice('منطقة الرياض كاملة') === 'region');
check('an answer naming NEITHER word stays null — the question still stands, we never guess a scope', regionOrCityChoice('الرياض') === null);
check('an answer naming BOTH words stays null — ambiguous, never a coin flip', regionOrCityChoice('مدينة ولا منطقة؟') === null);
check('empty / missing text is null, not a scope', regionOrCityChoice('') === null && regionOrCityChoice(undefined) === null);
// The traps: JS \b is ASCII-only and never matches Arabic, and a plain .includes() false-positives on
// names that CONTAIN these words fused to «ال» with no space.
check('TRAP: «المدينة المنورة» (Madinah — contains «مدينة» fused to «ال») is NOT a scope choice', regionOrCityChoice('ابغى شقة في المدينة المنورة') === null);
check('TRAP: «المنطقة الشرقية» (Eastern Province — contains «منطقة» fused to «ال») is NOT a scope choice', regionOrCityChoice('ابغى شقة في المنطقة الشرقية') === null);
check('TRAP: a naive ASCII-\\b regex would never fire on Arabic at all (why this module uses Unicode lookarounds)', !/\bمدينة\b/.test('مدينة الرياض'));

// ── EXECUTED: the location string each answer searches ────────────────────────────────────────
check('CITY answer → the bare city name (the engine scopes to that one city)', scopedLocation('الرياض', 'city') === 'الرياض');
check('REGION answer → «منطقة X» (the engine scopes to the WHOLE region)', scopedLocation('الرياض', 'region') === 'منطقة الرياض');
check('the two answers are DIFFERENT scopes — never collapsed into one', scopedLocation('الرياض', 'city') !== scopedLocation('الرياض', 'region'));
check('a location already carrying «منطقة » is not double-prefixed', scopedLocation('منطقة الرياض', 'region') === 'منطقة الرياض');
check('switching an already-region location back to the CITY strips «منطقة »', scopedLocation('منطقة الرياض', 'city') === 'الرياض');
check('every region/city twin round-trips (جازان تبوك حائل نجران الباحة الجوف)', ['جازان', 'تبوك', 'حائل', 'نجران', 'الباحة', 'الجوف'].every((n) => scopedLocation(n, 'city') === n && scopedLocation(n, 'region') === `منطقة ${n}`));
check('an empty twin name never becomes a bare «منطقة » (no invented location)', scopedLocation('', 'region') === '' && scopedLocation('   ', 'city') === '');

// ── SOURCE-TEXT: the three wiring points in src/app/agent.tsx ─────────────────────────────────
const src = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const clarifyFn = (() => {
  const start = src.indexOf('function locationClarification(');
  const end = src.indexOf('function detectMsgLang(');
  return start >= 0 && end > start ? src.slice(start, end) : '';
})();
check('locationClarification() found in src/app/agent.tsx', clarifyFn.length > 0);
check('it reads the scope the user named from THIS message', /const scopeChoice = regionOrCityChoice\(userText\);/.test(clarifyFn));
// THE defect: this branch re-asked the identical question forever.
check('the region-vs-city branch STOPS asking once the user named one of the two options', /if \(lm\.regionOrCity\) \{\s*\n\s*if \(scopeChoice\) return null;/.test(clarifyFn));
// STRICT on purpose (tightened 2026-08-23 after review): the suppression must key on a scope named
// ON THIS TWIN, not on a bare «منطقة» anywhere in the sentence — «في منطقة هادئة» is an ordinary
// Arabic phrase and must NOT be read as "they already chose the whole region".
check('the whole-region branch stops asking ONLY when the user named «منطقة X» for that twin',
  /scopeNamedForTwin\(userText, regionOrCityTwin\(loc\)\) === 'region'/.test(clarifyFn));
check('the twin question itself still exists for a user who has NOT answered it', /اسم مدينة واسم منطقة في نفس الوقت/.test(clarifyFn));

const sendFn = (() => {
  const start = src.indexOf('let turn = await respond(');
  const end = src.indexOf("if (turn.kind === 'interview')", start);
  return start >= 0 && end > start ? src.slice(start, end) : '';
})();
check('send() commits the named scope before deciding anything else', sendFn.length > 0);
check('a listings turn is rewritten ONLY when the model\'s location is that twin AND the user really named a scope for it (an unprompted bare «منطقة» must never widen a named city)',
  /const twin = regionOrCityTwin\(turn\.query\.location\);[\s\S]*?const named = scopeNamedForTwin\(v, twin\) \?\? \(askedTwin \? scopeChoice : null\);[\s\S]*?if \(twin && named\) turn = \{ \.\.\.turn, query: \{ \.\.\.turn\.query, location: scopedLocation\(twin, named\) \} \};/.test(sendFn));
check('when the model drifts off-thread (greeting / another question) the answer to OUR question still searches', /askedTwin && turn\.kind === 'message'[\s\S]*?kind: 'listings'[\s\S]*?location: scopedLocation\(askedTwin, scopeChoice\)/.test(sendFn));
check('the pending question is read-and-CLEARED once per turn (it can never go stale)', /const askedTwin = pendingScopeRef\.current;\s*\n\s*pendingScopeRef\.current = null;/.test(sendFn));
// RETIRED (owner-approved unified-agent-search-authority consolidation, 2026-08-30): the client used
// to arm pendingScopeRef itself whenever ITS OWN locationClarification() decided to re-ask a twin
// question — deleted along with that whole client-side gate (src/lib/agentQuestionBudget.ts and its
// call site). Twin/region/district ambiguity is now decided ONCE, server-side, by
// supabase/functions/agent/decide.ts's decideAgentTurn() (ladder step 1, fed by loc_classify) — see
// scripts/verify-agent-decide-turn.ts test (f). The client trusts kind="listings" unconditionally
// and never re-arms this ref from that path any more; asserting its ABSENCE is now the correct
// invariant, not asserting its presence.
check('the client no longer arms pendingScopeRef from its own retired clarify-or-search gate',
  !/pendingScopeRef\.current = regionOrCityTwin\(turn\.query\.location\);/.test(src));
check('New Chat inherits no half-answered question', /setMsgs\(\[\]\);\s*\n\s*pendingScopeRef\.current = null;/.test(src));
// RETIRED alongside the same gate: forcedBroad no longer depends on the client's own clarifyQ
// judgment (locationClarification() has no remaining call site) — it is simply "the server searched
// with no location", which is exactly what decideAgentTurn's budget-exhausted / hasEnoughToSearch
// steps mean by "broad is fine". See src/app/agent.tsx's `if (turn.kind === 'listings')` block.
check('the Kingdom-wide «ما قدرت أحدد الموقع بدقة» note fires exactly when the server searched with no location',
  /const forcedBroad = !turn\.query\.location;/.test(src));

console.log(
  failed === 0
    ? '\n✓ agent scope-answer verified — «مدينة X» searches that city, «منطقة X» searches the whole region, neither is re-asked and neither falls through to a Kingdom-wide search'
    : `\n✗ ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
