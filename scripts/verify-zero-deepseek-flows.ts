// Barrier: THE NON-AI FLOWS MUST NEVER BECOME PAID.
// Owner ruling, 2026-08-29: Filter / Advanced Filter / pagination / sort must remain zero-DeepSeek.
//
// WHY THIS IS SEPARATE FROM verify-filter-never-calls-agent.ts. That barrier pins the FILE-level
// boundary — only src/data/agent.ts may invoke the 'agent' function, only src/app/agent.tsx may
// import it. That is necessary and not sufficient: src/app/agent.tsx is a single ~3,600-line file
// holding BOTH the chat sender and every filter/AF/pagination/sort/refine handler. Nothing in the
// file-level check stops someone adding `await respond(...)` inside loadMore() or commitGuidedStep()
// — the existing barrier would still pass while every "عرض المزيد" tap started billing.
//
// So this pins the FUNCTION-level invariant: the only respond() call site lives inside send(), the
// free-text chat path. Everything else reaches Postgres RPCs and nothing else.
//
// It also pins the fallback: the client's offline heuristic must be provably network-free, because
// it is what runs when the spend circuit breaker denies a call. A fallback that could itself call
// DeepSeek would defeat the breaker at the exact moment it matters.
//
// Offline and deterministic: reads source, no network.
import { readFileSync } from 'node:fs';

const AGENT_TSX = 'src/app/agent.tsx';
const AGENT_TS = 'src/data/agent.ts';
// Strip comments before matching. A prose mention of respond() in a comment is not a call site, and
// counting one as a violation is the mirror image of the trap this repo keeps hitting from the other
// side (a barrier that passes because its regex matched an explanatory comment). Assert on code.
const decomment = (src: string) =>
  src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

const tsxRaw = readFileSync(AGENT_TSX, 'utf8');
const tsRaw = readFileSync(AGENT_TS, 'utf8');
const tsx = decomment(tsxRaw);
const ts = decomment(tsRaw);
const lines = tsx.split('\n');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

// ── 1. THE SINGLE PAID ENTRY POINT ─────────────────────────────────────────────
const invokes = [...ts.matchAll(/functions\.invoke\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
check("src/data/agent.ts invokes only the 'agent' function",
  invokes.length === 1 && invokes[0] === 'agent', `found: ${invokes.join(', ') || 'none'}`);

// respond() is the only thing that can reach it, and send() is the only thing that calls respond().
const respondCalls = [...tsx.matchAll(/\brespond\s*\(/g)].map((m) => tsx.slice(0, m.index).split('\n').length);
check('src/app/agent.tsx calls respond() exactly once', respondCalls.length === 1,
  `call sites at line(s): ${respondCalls.join(', ')}`);

// That single call must sit inside send(), not in any handler for a non-AI flow.
const sendStart = tsx.indexOf('const send = async');
const sendStartLine = sendStart > -1 ? tsx.slice(0, sendStart).split('\n').length : -1;
check('send() exists', sendStart > -1);
// The end of send(): the next top-level `const <name> = ` / `function ` at the same indentation.
const afterSend = tsx.slice(sendStart + 10);
const sendEndRel = afterSend.search(/\n  const \w+ = (?:async )?\(|\n  function \w+/);
const sendEndLine = sendEndRel > -1
  ? tsx.slice(0, sendStart + 10 + sendEndRel).split('\n').length
  : lines.length;
check('the only respond() call is inside send() (the free-text chat path)',
  respondCalls.length === 1 && respondCalls[0] > sendStartLine && respondCalls[0] <= sendEndLine,
  `respond at ${respondCalls[0]}, send spans ${sendStartLine}-${sendEndLine}`);

// ── 2. THE NON-AI HANDLERS MUST CONTAIN NO respond() ───────────────────────────
// Each of these is a flow the owner named as "must stay zero-DeepSeek". We slice each handler's body
// and assert respond() does not appear inside it.
const HANDLERS = [
  ['sendFilter', 'Normal Filter search'],
  ['onBubbleDone', 'the filter search execution'],
  ['loadMore', 'pagination / عرض المزيد'],
  ['runRefine', 'refine chips'],
  ['commitGuidedStep', 'Advanced Filter answering'],
  ['presentGuided', 'Advanced Filter question presentation'],
  ['finishGuided', 'Advanced Filter completion'],
];
for (const [fn, human] of HANDLERS) {
  const i = tsx.search(new RegExp(`\\b(const|function)\\s+${fn}\\b`));
  if (i === -1) { check(`${fn} (${human}) exists`, false, 'handler not found — did it get renamed?'); continue; }
  const rest = tsx.slice(i + fn.length);
  const endRel = rest.search(/\n  const \w+ = (?:async )?\(|\n  function \w+/);
  const body = rest.slice(0, endRel > -1 ? endRel : 4000);
  check(`${human} (${fn}) makes NO model call`, !/\brespond\s*\(/.test(body));
}

// ── 3. THE OFFLINE FALLBACK IS PROVABLY NETWORK-FREE ───────────────────────────
// This is what serves the user when the spend breaker denies a call. It must not be able to spend.
const backendCallIdx = ts.indexOf('await callAgentBackend(');
check('the fallback path begins after the single backend call', backendCallIdx > -1);
const afterBackend = ts.slice(backendCallIdx + 'await callAgentBackend('.length);
check('src/data/agent.ts performs NO await after the backend call (the fallback cannot do I/O)',
  !/\bawait\b/.test(afterBackend),
  'an await below this point means the offline fallback can reach the network');
check('the fallback does not reference the agent function or DeepSeek',
  !/functions\.invoke|deepseek/i.test(afterBackend));

// ── 4. THE SEARCH/AF LAYERS CANNOT REACH THE MODEL AT ALL ──────────────────────
for (const f of ['src/data/remote.ts', 'src/lib/afPlan.ts', 'src/lib/afSteps.ts', 'src/lib/afCohorts.ts',
                 'src/lib/chatTitle.ts']) {
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch { check(`${f} exists`, false); continue; }
  check(`${f} never invokes the agent function`,
    !/functions\.invoke/.test(src) && !/deepseek/i.test(src));
}

// runQuery is not defined in agent.tsx - it comes from the store (useApp()). Assert the store's
// search path is model-free at its source instead of looking for a local handler.
{
  const store = decomment(readFileSync('src/store.tsx', 'utf8'));
  check('the store search path (runQuery/loadMoreListings) never invokes the agent',
    !/functions\.invoke/.test(store) && !/\brespond\s*\(/.test(store));
}

// Chat titles were an explicit owner decision — no paid call just to name a sidebar row.
check('chat titles are generated locally, with the rule stated in the file',
  /No model call/i.test(readFileSync('src/lib/chatTitle.ts', 'utf8')));

console.log(
  failures === 0
    ? '\n✓ Filter / AF / pagination / sort / titles / fallback are all zero-DeepSeek'
    : `\n✗ ${failures} zero-DeepSeek check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
