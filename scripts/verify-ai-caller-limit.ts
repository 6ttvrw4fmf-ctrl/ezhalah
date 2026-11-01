// SECURITY (owner-approved plan, Phase 1.7, 2026-10-21): the AI chat has a per-caller limit.
//
// THE HOLE. agent and translit accept the publishable key — which ships in the app, so anyone has it — and the only
// brake was the GLOBAL spend gate: one script could burn the day's AI budget and every real user would then be stopped
// with it. THE FIX. Each function asks public.ai_caller_gate() (migration 20261021011029, 60/min + 600/hour per hashed
// connection address, service_role only) BEFORE any model call, right after the key check, and answers 429 when the
// caller is over. The client already treats a refusal like the spend-gate 503 (src/data/agent.ts returns null → fallback).
//
// Checks, by reading the committed sources: both functions gate before the model; the limiter is not callable with the
// public key; and the hashing never forwards the raw address. Mutations prove each check can fail.
//   node --experimental-strip-types scripts/verify-ai-caller-limit.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const MIG = 'supabase/migrations/20261021011029_ai_caller_gate.sql';
const FNS: [string, string, RegExp][] = [
  ['supabase/functions/agent/index.ts', 'agent', /fetch\(DEEPSEEK_URL/],
  ['supabase/functions/translit/index.ts', 'translit', /fetch\(urlFor\(/],
];

function fnProblems(src: string, fn: string, model: RegExp): string[] {
  const fail: string[] = [];
  const serve = src.indexOf('Deno.serve(');
  const unauth = src.indexOf('"unauthorized"', serve);
  const gate = src.indexOf(`await callerGate(req, "${fn}")`, serve);
  if (gate < 0) return [`${fn}: the handler never calls callerGate`];
  if (unauth < 0 || gate < unauth) fail.push(`${fn}: callerGate runs before the key check`);
  const m = src.slice(serve).search(model);
  if (m >= 0 && serve + m < gate) fail.push(`${fn}: the model is called before callerGate`);
  if (!/if \(!cg\.allow\)[\s\S]{0,160}429\)/.test(src.slice(gate))) fail.push(`${fn}: a refused caller is not answered 429`);
  if (!/crypto\.subtle\.digest\("SHA-256"/.test(src)) fail.push(`${fn}: the caller address is not hashed`);
  if (/p_caller:\s*(ip|cf|rip|xff)\b/.test(src)) fail.push(`${fn}: the raw address is sent to the database`);
  return fail;
}
function migProblems(sql: string): string[] {
  const fail: string[] = [];
  if (!/revoke all on function public\.ai_caller_gate\(text, text\) from public, anon, authenticated;/.test(sql)) fail.push('ai_caller_gate is callable with the public key');
  if (!/revoke all on public\.ops_ai_caller_hits from public, anon, authenticated;/.test(sql)) fail.push('ops_ai_caller_hits is readable with the public key');
  if (/security definer/i.test(sql)) fail.push('ai_caller_gate must stay SECURITY INVOKER (service_role only)');
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

for (const [p, fn, model] of FNS) { const f = fnProblems(read(p), fn, model); check(`${fn}: callers are limited after the key check and before the model`, f.length === 0, f.join('; ')); }
const mp = migProblems(read(MIG));
check('the limiter and its counters are not reachable with the public key', mp.length === 0, mp.join('; '));

const agent = read(FNS[0][0]);
mustCatch('the agent gate call removed', fnProblems(agent.replace('const cg = await callerGate(req, "agent");', 'const cg = { allow: true };'), 'agent', FNS[0][2]).length > 0);
mustCatch('the 429 answer removed', fnProblems(agent.replace('return json({ error: "rate limited", reason: cg.reason }, 429);', 'void 0;'), 'agent', FNS[0][2]).length > 0);
mustCatch('the limiter granted to anon', migProblems(read(MIG).replace('revoke all on function public.ai_caller_gate(text, text) from public, anon, authenticated;', 'grant execute on function public.ai_caller_gate(text, text) to anon;')).length > 0);

if (failed) { console.error(`\n❌ verify-ai-caller-limit: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-ai-caller-limit: the AI chat limits each caller before it pays for a model call.');
