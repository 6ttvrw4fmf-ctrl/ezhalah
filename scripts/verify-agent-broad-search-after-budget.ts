// Once the model has already spent its own clarifying-question budget this chat, a resulting
// kind="listings" decision must be SEARCHED, not re-asked about the location a 3rd/4th time.
//
// THE DEFECT THIS EXISTS TO PREVENT (owner-reported live production bug, 2026-08-30):
//
//   السلام عليكم / ايش عندك / ماعرف عندك شيء حلو عندي ٥ عيال / عادي الاثنين ماعندي مشكلة بس شيء كبير
//
// The agent clearly understood "family of 5 -> a large villa/apartment, either type is fine" but
// never showed a single listing. Live replay against production (2026-08-30) confirmed DeepSeek DID
// classify turn 4 as kind="listings" with location="" (a legitimate nationwide search — no city was
// ever named) and askAbout:["size"]. The bug was downstream, client-side: src/app/agent.tsx's
// deterministic locationClarification() backstop re-asks "which city?" up to 2 times using its OWN
// askCountRef, counted from ZERO — completely unaware that the model itself had already asked 2
// questions this chat (the server's own, separate budget, enforced via `priorQuestions` in
// supabase/functions/agent/index.ts). The user experience: a THIRD "which city?" instead of results.
//
// ROOT CAUSE: two independent, unsynchronized 2-question budgets for the same conversation.
//
// WHAT IS PINNED HERE:
//   1. shouldAskLocationInsteadOfSearching() — the pure gate — returns FALSE (search now, don't ask)
//      once the model has already asked >=2 questions this chat, even with an empty/unusable
//      location, and returns TRUE (ask, as before) when the model has not yet used its budget — the
//      existing "it MUST ask, not guess the location" behavior for a fresh, low-signal request is
//      unchanged.
//   2. agent.tsx actually WIRES it at the one call site that matters (turn.kind === 'listings').
//
//   node --experimental-strip-types scripts/verify-agent-broad-search-after-budget.ts  (auto-discovered by npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldAskLocationInsteadOfSearching } from '../src/lib/agentQuestionBudget.ts';

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

console.log('\nA model that already asked 2 questions this chat gets trusted, not re-asked\n');

const askedTwice = [
  { role: 'user' as const, text: 'ماعرف عندك شيء حلو عندي 5 عيال' },
  { role: 'model' as const, text: 'أبشر! وش تدور عليه بالضبط؟' },
  { role: 'user' as const, text: 'عادي الاثنين ماعندي مشكلة' },
  { role: 'model' as const, text: 'طيب، إيجار ولا تمليك؟' },
];
const askedOnce = askedTwice.slice(0, 2);
const CITY_Q = 'في أي مدينة تبحث؟ (وإذا تبي كل المملكة قل لي «كل مدن المملكة»)';

// ── 1. THE GATE trusts the model once its OWN budget is spent ───────────────────────────────────
check('no clarify question at all -> never ask (regardless of history/count)',
  shouldAskLocationInsteadOfSearching(null, 0, askedTwice) === false);
check('model has NOT asked 2 questions yet -> still ask (existing behavior preserved)',
  shouldAskLocationInsteadOfSearching(CITY_Q, 0, askedOnce) === true);
check('model has NOT asked 2 questions yet, but client askCount already hit 2 -> do not ask',
  shouldAskLocationInsteadOfSearching(CITY_Q, 2, askedOnce) === false,
  'the older 2-ask client cap must still terminate the loop on its own');
check('model already asked 2 questions this chat -> SEARCH, do not ask a 3rd (THE FIX)',
  shouldAskLocationInsteadOfSearching(CITY_Q, 0, askedTwice) === false,
  'this is the exact production bug: it returned true here before the fix, and the app asked again');
check('a user "?" does not count as a MODEL question (only role:model counts)',
  shouldAskLocationInsteadOfSearching(CITY_Q, 0, [
    { role: 'user', text: 'وش عندك؟' }, { role: 'user', text: 'في الرياض؟' },
  ]) === true,
  'two user "?" must not be mistaken for the model having asked twice');

// ── 2. THE WIRING — a predicate nothing calls protects nothing ──────────────────────────────────
check("agent.tsx imports shouldAskLocationInsteadOfSearching from '@/lib/agentQuestionBudget'",
  /import \{ shouldAskLocationInsteadOfSearching \} from '@\/lib\/agentQuestionBudget'/.test(agentSrc));
check('the listings branch gates on it instead of a bare askCountRef check',
  /if \(shouldAskLocationInsteadOfSearching\(clarifyQ, askCountRef\.current, history\)\) \{/.test(agentSrc),
  'a bare `if (clarifyQ && askCountRef.current < 2)` would silently resurrect the bug');
check('the broad-search explanation still fires whenever a location question was skipped',
  /const forcedBroad = !!clarifyQ;/.test(agentSrc),
  'the user must still be told "searched a broader scope" when the city question was bypassed');

console.log(failures === 0
  ? '\n✅ verify-agent-broad-search-after-budget: all checks passed.\n'
  : `\n❌ verify-agent-broad-search-after-budget: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
