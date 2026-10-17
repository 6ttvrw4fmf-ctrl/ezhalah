#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
/**
 * verify-agent-deepseek-only — auto-discovered barrier (see scripts/run-tests.mjs).
 *
 * Owner decision 2026-08-28: DeepSeek is the SOLE agent provider. Gemini was removed as a clean
 * cutover — no coexistence layer, no env-var switch, no callGemini fallback. This barrier keeps
 * that decision from silently un-cutting-over via a future PR that "just adds Gemini back".
 *
 * If you're re-introducing a second provider on purpose, delete this file in the same PR.
 *
 * UPDATE (owner 2026-10-17): the owner decided to REPLACE DeepSeek with Groq GPT-OSS 20B. For the
 * cut-over only, both are wired behind the AI_PROVIDER rollback switch (default deepseek); this file
 * now pins that exact transitional shape — DeepSeek and Groq present, Gemini still absent — and must
 * be reduced to "Groq only" in the PR that removes DeepSeek's integration once Groq is proven.
 */
import { readFileSync } from "node:fs";

const src = readFileSync("supabase/functions/agent/index.ts", "utf8");

const failures: string[] = [];

// 1. DeepSeek must be wired.
const mustHave = ["DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "api.deepseek.com", "response_format"];
for (const s of mustHave) if (!src.includes(s)) failures.push(`missing DeepSeek marker: ${s}`);
// 1b. Groq (the replacement) must be wired, behind the switch whose default stays DeepSeek.
for (const s of ["GROQ_API_KEY", "GROQ_MODEL", "api.groq.com", 'Deno.env.get("AI_PROVIDER")']) {
  if (!src.includes(s)) failures.push(`missing Groq cut-over marker: ${s}`);
}

// 2. No Gemini identifiers in live code. Historical comment mentions ("was removed") are fine —
//    only flag identifiers that would actually run (env reads, function calls, URLs, headers).
const forbidPatterns: Array<[string, RegExp]> = [
  ["GEMINI_API_KEY env read", /Deno\.env\.get\(["']GEMINI_/],
  ["AGENT_PROVIDER env switch", /Deno\.env\.get\(["']AGENT_PROVIDER["']\)/],
  ["callGemini() function", /\bcallGemini\s*[=(]/],
  ["Gemini API URL", /generativelanguage\.googleapis\.com/],
  ["x-goog-api-key header", /x-goog-api-key/],
  ["Gemini responseSchema", /responseSchema\s*:/],
];
for (const [label, re] of forbidPatterns) if (re.test(src)) failures.push(`Gemini re-introduced: ${label}`);

if (failures.length) {
  console.error("verify-agent-deepseek-only: FAIL");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("verify-agent-deepseek-only: OK — DeepSeek + Groq behind AI_PROVIDER (cut-over), no Gemini traces.");
