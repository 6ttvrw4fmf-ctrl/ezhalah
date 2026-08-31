// Regression guard: "1 user message -> exactly 1 normal DeepSeek call" is only PROVABLE if every
// row in public.ai_usage carries the id of the user SEND that caused it. Confirmed live 2026-08-30:
// real (non-CI-probe) production rows had user_message_id NULL on every row — the safeguard meant
// to prove the invariant was not actually watching real traffic.
//
// Investigation finding (read before touching this): by the time this guard was written, the full
// wiring below was ALREADY present on origin/main — src/app/agent.tsx's send() already stamps
// `const userMessageId = uid();` once per SEND and threads it through respond() -> callAgentBackend()
// -> the request body -> supabase/functions/agent/index.ts -> every logUsage() row, and
// mon_detect_agent_calls_per_message() (20260830202054_agent_calls_per_message_telemetry_and_detector.sql)
// already filters `user_message_id is not null` in all three of its checks, so historical null rows
// are excluded rather than grouped into one false-positive bucket (verified live: the detector runs
// clean at 0 right now). That wiring shipped as part of the same-day "unified agent search authority"
// consolidation (#1384) — this file exists so it STAYS wired, pinned end to end, source-text only
// (send() closes over full React state/refs and is not unit-testable in isolation; every assertion
// here is on the REAL files, never a hand-copied duplicate).
//
//   node --experimental-strip-types scripts/verify-agent-user-message-id-telemetry.ts (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const screen = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/data/agent.ts', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20260830202054_agent_calls_per_message_telemetry_and_detector.sql', import.meta.url),
  'utf8',
);

// ── 1. src/app/agent.tsx's send(): stamped ONCE per SEND, using the existing id shape ──
const sendBody = screen.slice(screen.indexOf('const send = async'), screen.indexOf('const sendFilter ='));
const stampCount = (sendBody.match(/const userMessageId = uid\(\);/g) ?? []).length;
check('send() stamps userMessageId exactly ONCE (not per network call/retry)', stampCount === 1);
check('send() reuses the existing uid() generator (no new id scheme/dependency)',
  /const userMessageId = uid\(\);/.test(sendBody));
check('the stamped id is passed into respond() unchanged',
  /respond\(v,\s*\{[^}]*\buserMessageId\b[^}]*\}\)/s.test(sendBody));
// It must be declared BEFORE respond() is called, or the value passed would be stale/undefined.
check('userMessageId is declared before the respond() call site',
  sendBody.indexOf('const userMessageId = uid();') < sendBody.indexOf('await respond(v,'));

// ── 2. src/data/agent.ts: respond() -> callAgentBackend() -> request body, unchanged ──
check("respond()'s options accept userMessageId",
  /userMessageId\?:\s*string;/.test(client));
check('respond() forwards it to callAgentBackend() unchanged (not regenerated)',
  /callAgentBackend\(v,\s*\{[^}]*userMessageId:\s*opts\?\.userMessageId[^}]*\}\)/s.test(client));
check("callAgentBackend()'s ctx type accepts userMessageId",
  /userMessageId\?:\s*string;/.test(client.slice(client.indexOf('async function callAgentBackend'))));
// Present, non-null (whenever the caller set it) in the OUTGOING request body — the minimum bar the
// task sets if no client-side retry scenario exists (confirmed: only one respond() call site in
// agent.tsx, and the language-mismatch retry is entirely server-side in runModel()).
check('the outgoing supabase.functions.invoke body carries userMessageId: ctx.userMessageId',
  /body:\s*\{[^]*?userMessageId:\s*ctx\.userMessageId,[^]*?\}/.test(client));

// ── 3. supabase/functions/agent/index.ts: parsed from the body, threaded to EVERY logged row ──
check('the edge function reads userMessageId from the request body (capped, type-checked)',
  /userMessageId = typeof body\?\.userMessageId === "string" && body\.userMessageId \? body\.userMessageId\.slice\(0, 100\) : null;/.test(edge));
const logUsageCallSites = [...edge.matchAll(/logUsage\(\{[^]*?\}\);/g)];
check('logUsage() is called at least twice (the http_retry row and the primary/language_retry row)',
  logUsageCallSites.length >= 2);
check('EVERY logUsage() call site stamps user_message_id: userMessageId (no unlabelled row)',
  logUsageCallSites.length > 0 && logUsageCallSites.every((m) => /user_message_id:\s*userMessageId,/.test(m[0])));
// The primary call and its language-mismatch retry must share the SAME id, distinguished only by
// call_reason — proven by both sharing the one outer `userMessageId` variable (never a per-call id).
check('callReason is a runModel() parameter distinguishing primary vs language_retry, not a new id',
  /callReason:\s*"primary"\s*\|\s*"language_retry"\s*=\s*"primary"/.test(edge));
check('the primary logUsage() row is stamped with call_reason: callReason (not hardcoded "primary")',
  /call_reason:\s*callReason,/.test(edge));

// ── 4. mon_detect_agent_calls_per_message(): historical NULL rows excluded, not one mega-bucket ──
const detectorBody = migration.slice(
  migration.indexOf('create or replace function public.mon_detect_agent_calls_per_message'),
  migration.indexOf('comment on function public.mon_detect_agent_calls_per_message'),
);
const nullGuardCount = (detectorBody.match(/user_message_id is not null/g) ?? []).length;
check('every population/grouping query in the detector excludes NULL user_message_id (>= 4 sites: population floor + the 3 checks)',
  nullGuardCount >= 4);
check('the detector never GROUPs BY user_message_id without first filtering it non-null (no false-positive mega-bucket)',
  !/group by user_message_id\s*\n\s*having count\(\*\) > \d/.test(detectorBody.replace(/user_message_id is not null[^)]*\)/g, '')));

console.log('');
if (failed) {
  console.log(`✗ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('✓ all user_message_id telemetry wiring checks passed.');
