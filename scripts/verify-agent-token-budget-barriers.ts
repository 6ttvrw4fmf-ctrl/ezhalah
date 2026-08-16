// ─────────────────────────────────────────────────────────────────────────────────────────────
// TOKEN-BUDGET BARRIER — AI Agent foundation (owner brief 2026-08-16, item 7).
//
// scripts/verify-agent-prompt-clean-slate.ts already guards the PROMPT-CONTENT half of the
// clean-slate contract (no agent_notes, no city/landmark lists, single byte-exact system
// instruction, verbatim user turn). This file guards the CONFIG/ARCHITECTURE half that a future
// prompt-engineering pass could silently regress without touching a single word of prose:
//
//   1. no unexpected MODEL / FALLBACK_MODEL change
//   2. thinking budget staying OFF (not creeping up from 0)
//   3. the output-token ceiling staying at its committed, measured value (not creeping up)
//   4. conversation history staying BOUNDED on both the edge and the client (never unbounded)
//   5. the observability side-channel (item 6) never carrying raw user/model text
//   6. the response schema's field COUNT not silently growing (12 fields, item 3's scope)
//
// Every assertion below is structural/numeric — on the real captured request payload or on a
// committed constant — never on prompt wording. If the owner deliberately changes one of these
// committed values, update the matching constant in this file in the SAME commit and say why.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n    ${detail}`}`);
  if (!ok) failed++;
};

const EDGE_URL = new URL('../supabase/functions/agent/index.ts', import.meta.url);
const edge = readFileSync(EDGE_URL, 'utf8');
const client = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');

// ── Committed values ─────────────────────────────────────────────────────────────────────────
// Raise any of these only as a deliberate, reviewed act, in the same commit as this file.
const COMMITTED_MODEL = 'gemini-2.5-flash';
const COMMITTED_FALLBACK_MODEL = 'gemini-2.5-flash-lite';
// THINKING BUDGET — round 3 (2026-08-17, see prompt-arch-2026-08-16/thinking-budget/REPORT.md).
// Was 0 (round 2). Real generateContent calls across 3 runs of the 72-case permanent eval set at
// budgets 0/128/256/512/1024 showed the 15 reasoning-sensitive cases (cases whose pass/fail
// actually flips with budget, isolated from cases that fail identically at every budget for
// missing-taxonomy-knowledge reasons no budget fixes) scoring 42-47% at 0/128/256 — flat, no
// benefit — then jumping to 62% at 512 and staying flat at 1024 (60%, no further gain). 512 is the
// smallest budget that captures the improvement — NOT dynamic/unlimited (-1), NOT PR #702's
// unmerged 1024 proposal (that number wasn't re-derived from this evidence, it just happened to be
// in the same ballpark; 512 measured strictly as good and cheaper).
const COMMITTED_THINKING_BUDGET = 512;
// Gemini bills thinking tokens against maxOutputTokens (unlike OpenAI) — this MUST stay
// THINKING_BUDGET + a real JSON headroom, never a bare number that can drift out of sync with the
// budget above (that desync is the exact PR #702 landmine: thinking on, cap left at the old
// thinking-OFF value → HTTP 200 with a truncated/empty candidate). 800 headroom re-verified
// empirically this round across 1,080 real calls: worst-case usage at budget 512 was 615/1312
// tokens (47% of cap).
const COMMITTED_THINKING_HEADROOM = 800;
const COMMITTED_MAX_OUTPUT_TOKENS = COMMITTED_THINKING_BUDGET + COMMITTED_THINKING_HEADROOM;
const MAX_HISTORY_TURNS_CEILING = 20; // generous ceiling — the point is "bounded", not one exact number
const SCHEMA_FIELD_COUNT = 12;

// ── 1. No unexpected model change (source-level — these are the literal defaults) ──────────────
check(`MODEL default is committed value "${COMMITTED_MODEL}"`,
  new RegExp(`const MODEL = Deno\\.env\\.get\\("GEMINI_MODEL"\\) \\?\\? "${COMMITTED_MODEL}"`).test(edge));
check(`FALLBACK_MODEL default is committed value "${COMMITTED_FALLBACK_MODEL}"`,
  new RegExp(`const FALLBACK_MODEL = Deno\\.env\\.get\\("GEMINI_FALLBACK_MODEL"\\) \\?\\? "${COMMITTED_FALLBACK_MODEL}"`).test(edge));
check(`THINKING_BUDGET default is committed value ${COMMITTED_THINKING_BUDGET}`,
  new RegExp(`const THINKING_BUDGET = parseInt\\(Deno\\.env\\.get\\("GEMINI_THINKING_BUDGET"\\) \\?\\? "${COMMITTED_THINKING_BUDGET}", 10\\)`).test(edge));
check(`THINKING_HEADROOM is committed value ${COMMITTED_THINKING_HEADROOM}`,
  new RegExp(`const THINKING_HEADROOM = ${COMMITTED_THINKING_HEADROOM};`).test(edge));
check('MAX_OUTPUT_TOKENS is DERIVED from THINKING_BUDGET + THINKING_HEADROOM (never an independent literal that can drift out of sync with the budget)',
  /const MAX_OUTPUT_TOKENS = THINKING_BUDGET \+ THINKING_HEADROOM;/.test(edge));

// ── Boot the real function under a shim and capture EVERYTHING it sends ────────────────────────
type Sent = { url: string; body: any };
const sent: Sent[] = [];
let handler: ((req: Request) => Promise<Response>) | null = null;

// NOTE: real Deno.env.get() returns `undefined` for an unset key (not ''). The shim must match
// that exactly — `Deno.env.get(k) ?? "default"` only falls back on null/undefined, so a shim that
// returns '' for missing keys would silently defeat every `?? "default"` in the source and this
// barrier would test nothing real (found live while wiring the THINKING_BUDGET checks: MODEL's
// runtime value was never actually exercised before, only its source text — same latent gap).
(globalThis as any).Deno = {
  env: {
    get: (k: string): string | undefined =>
      ({
        GEMINI_API_KEY: 'test-key',
        SUPABASE_URL: 'https://example.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
        SUPABASE_ANON_KEY: 'test-anon-key',
      } as Record<string, string>)[k],
  },
  serve: (h: (req: Request) => Promise<Response>) => { handler = h; },
};

const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (url: any, init: any = {}) => {
  const u = String(url);
  let body: any = null;
  try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = String(init?.body ?? ''); }
  sent.push({ url: u, body });
  if (u.includes('generativelanguage.googleapis.com')) {
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        kind: 'listings', reply: 'ok', deal: 'Rent', location: '', type: 'Apartment',
        detail: '', price: '', pricing_basis: 'none', rent_period: 'none',
        sort: 'none', count: '', platforms: [],
      }) }] } }],
      usageMetadata: { promptTokenCount: 21, candidatesTokenCount: 79, totalTokenCount: 100 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  // loc_classify, mon_agent_request_log, and anything else: behave as a fast no-op success.
  return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
};

await import(EDGE_URL.href);
if (!handler) { console.log('✗ edge function did not register a Deno.serve handler'); process.exit(1); }

const HISTORY_SENT = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'model', text: `turn ${i}` }));
const res = await handler!(new Request('https://x.invalid/agent', {
  method: 'POST',
  headers: { 'content-type': 'application/json', apikey: 'test-anon-key' },
  body: JSON.stringify({ text: 'شقة للايجار في الرياض', locale: 'ar', history: HISTORY_SENT }),
}));
(globalThis as any).fetch = realFetch;

check('the function served the request without throwing', res.status === 200, `status ${res.status}`);

const gemini = sent.filter((s) => s.url.includes('generativelanguage.googleapis.com'));
if (gemini.length < 1) { console.log('\n✗ no Gemini call captured — cannot verify config'); process.exit(1); }
const genConfig = gemini[0].body?.generationConfig ?? {};

// ── 2. Thinking budget must be ON at exactly the approved fixed value — not 0 (round-2 default),
//    not -1/unset (dynamic/unlimited), not silently creeping to some other number ─────────────────
check(`generationConfig.thinkingConfig.thinkingBudget === ${COMMITTED_THINKING_BUDGET} (approved fixed budget)`,
  genConfig?.thinkingConfig?.thinkingBudget === COMMITTED_THINKING_BUDGET,
  `saw ${JSON.stringify(genConfig?.thinkingConfig)}`);
check('thinkingBudget is never -1 (dynamic/unlimited) anywhere in source',
  !/thinkingBudget:\s*-1\b/.test(edge));
check('no OTHER object literal hardcodes a raw thinkingBudget number — the only number is THINKING_BUDGET\'s own env-default string, wired through the THINKING_BUDGET identifier everywhere it is used',
  !/thinkingBudget:\s*-?\d+/.test(edge) && /thinkingConfig:\s*\{\s*thinkingBudget:\s*THINKING_BUDGET\s*\}/.test(edge));

// ── 3. Output-token ceiling must not creep up silently, AND must auto-scale with the budget ───────
check(`generationConfig.maxOutputTokens === ${COMMITTED_MAX_OUTPUT_TOKENS} (${COMMITTED_THINKING_BUDGET} budget + ${COMMITTED_THINKING_HEADROOM} JSON headroom)`,
  genConfig?.maxOutputTokens === COMMITTED_MAX_OUTPUT_TOKENS,
  `saw ${genConfig?.maxOutputTokens}`);

// ── 3b. THE LANDMINE, as a LIVE regression test (PR #702's exact failure mode) — a genuinely fresh
//    CHILD PROCESS (not an in-process re-import: Node's --experimental-strip-types loader resolves
//    .ts specifiers by path, ignoring cache-busting query strings, so an in-process "second import"
//    silently keeps evaluating the FIRST module instance — confirmed by direct experiment while
//    building this check) with GEMINI_THINKING_BUDGET overridden, proving maxOutputTokens follows
//    it automatically, with no separate env var for the cap and no code changed.
{
  const childScript = `
    globalThis.Deno = { env: { get: (k) => process.env[k] }, serve: (h) => { globalThis.__h = h; } };
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com')) {
        globalThis.__sentGenConfig = JSON.parse(init.body).generationConfig;
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            kind: 'message', reply: 'ok', deal: 'Rent', location: '', type: '',
            detail: '', price: '', pricing_basis: 'none', rent_period: 'none',
            sort: 'none', count: '', platforms: [],
          }) }] } }],
          usageMetadata: { promptTokenCount: 21, candidatesTokenCount: 79, thoughtsTokenCount: 1200, totalTokenCount: 1300 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await import(${JSON.stringify(EDGE_URL.href)});
    const res = await globalThis.__h(new Request('https://x.invalid/agent', {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: 'test-anon-key' },
      body: JSON.stringify({ text: 'apartment in Riyadh', locale: 'en' }),
    }));
    console.log(JSON.stringify({ status: res.status, genConfig: globalThis.__sentGenConfig }));
  `;
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--input-type=module', '-e', childScript],
    {
      env: {
        ...process.env,
        GEMINI_API_KEY: 'test-key',
        SUPABASE_URL: 'https://example.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
        SUPABASE_ANON_KEY: 'test-anon-key',
        GEMINI_THINKING_BUDGET: '2000',
      },
      encoding: 'utf8',
    },
  );
  let childOut: { status?: number; genConfig?: any } = {};
  try { childOut = JSON.parse((child.stdout || '').trim().split('\n').pop() || '{}'); } catch { /* leave empty, checks below fail loudly */ }
  check('override env (fresh process, GEMINI_THINKING_BUDGET=2000): served 200',
    childOut.status === 200, `stdout=${child.stdout}\nstderr=${child.stderr}`);
  check('override env: thinkingBudget follows GEMINI_THINKING_BUDGET=2000',
    childOut.genConfig?.thinkingConfig?.thinkingBudget === 2000, `saw ${JSON.stringify(childOut.genConfig?.thinkingConfig)}`);
  check('override env: maxOutputTokens auto-scaled to 2000 + 800 = 2800 WITHOUT a matching env var for it — this is the landmine fix, proven live, not just by formula',
    childOut.genConfig?.maxOutputTokens === 2800, `saw ${childOut.genConfig?.maxOutputTokens}`);
}

// ── 4. Conversation history stays BOUNDED — both server and client, never unbounded ────────────
// EDGE: 30 turns were sent in this test; the served payload must reflect a hard slice, not all 30.
const turnsSentToGemini = gemini[0].body?.contents?.length ?? 0;
check('the edge does not forward an unbounded history — sent turn count is far below the raw 30 supplied',
  turnsSentToGemini > 0 && turnsSentToGemini < 30,
  `sent ${turnsSentToGemini} turns to Gemini out of 30 supplied`);
const edgeSliceMatch = edge.match(/history\s*=\s*body\??\.history\.slice\(-(\d+)\)/);
check('the edge source has an explicit numeric history cap (not a magic unlimited array)',
  !!edgeSliceMatch);
if (edgeSliceMatch) {
  const n = Number(edgeSliceMatch[1]);
  check(`the edge's history cap (${n}) is a real ceiling, not effectively unbounded (<= ${MAX_HISTORY_TURNS_CEILING})`,
    Number.isFinite(n) && n > 0 && n <= MAX_HISTORY_TURNS_CEILING);
}
// CLIENT: agent.tsx builds the history array it sends the edge — it must also cap, independently.
const clientSliceMatch = client.match(/\.slice\(-(\d+)\)/);
check('the client also caps the history array it builds before sending it to the edge (defense in depth)',
  !!clientSliceMatch);
if (clientSliceMatch) {
  const n = Number(clientSliceMatch[1]);
  check(`the client's history cap (${n}) is a real ceiling, not effectively unbounded (<= ${MAX_HISTORY_TURNS_CEILING})`,
    Number.isFinite(n) && n > 0 && n <= MAX_HISTORY_TURNS_CEILING);
}

// ── 5. Observability must never carry raw content ───────────────────────────────────────────────
const monCalls = sent.filter((s) => s.url.includes('mon_agent_request_log'));
check('the request produced exactly one observability write (not zero, not duplicated)',
  monCalls.length === 1, `saw ${monCalls.length}`);
if (monCalls.length) {
  const loggedBody = monCalls[0].body ?? {};
  const bannedKeys = ['text', 'reply', 'raw', 'message', 'user_text', 'query'];
  check('the logged row contains none of the banned raw-content keys',
    bannedKeys.every((k) => !(k in loggedBody)),
    `logged keys: ${Object.keys(loggedBody).join(', ')}`);
  const loggedJson = JSON.stringify(loggedBody);
  check('the logged row does not contain the user\'s message text anywhere in its values',
    !loggedJson.includes('شقة للايجار في الرياض'));
  check('every logged value is a string/number/boolean primitive (categorical/numeric only, no nested content blob)',
    Object.values(loggedBody).every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)));
  check('request_kind is a short categorical label, not free text (<= 20 chars)',
    typeof loggedBody.request_kind === 'string' && loggedBody.request_kind.length <= 20);
}
// Static check too: the call site itself must not reference the raw text/reply variables.
const logCallMatch = edge.match(/void logUsage\(\{[\s\S]*?\}\);/);
check('the logUsage() call site does not reference `text`, `out.reply`, or `raw` as a value',
  !!logCallMatch && !/:\s*text\b/.test(logCallMatch[0]) && !/out\.reply/.test(logCallMatch[0]) && !/:\s*raw\b/.test(logCallMatch[0]));

// ── 6. Schema field count — the interface surface must not silently grow ───────────────────────
const requiredMatch = edge.match(/required:\s*\[([^\]]*)\]/);
const requiredCount = requiredMatch ? requiredMatch[1].split(',').filter((s) => s.trim()).length : 0;
check(`SCHEMA.required declares exactly ${SCHEMA_FIELD_COUNT} fields (today's interface surface)`,
  requiredCount === SCHEMA_FIELD_COUNT, `found ${requiredCount}`);

// ── 7. System instruction stays under its committed byte ceiling (cross-check with the other barrier) ──
const declared = edge.match(/\nconst SYSTEM = `([\s\S]*?)`;/)?.[1] ?? '';
check('SYSTEM constant is non-empty and comfortably under the clean-slate ceiling (see verify-agent-prompt-clean-slate.ts for the enforced number)',
  declared.length > 0 && declared.length <= 400);

console.log(
  failed === 0
    ? '\n✓ token-budget barrier holds: model, thinking budget, output ceiling, history bound, and observability are all pinned to their committed values'
    : `\n✗ ${failed} token-budget assertion(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
