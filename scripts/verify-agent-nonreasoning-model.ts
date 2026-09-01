#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
/**
 * verify-agent-nonreasoning-model — auto-discovered barrier (see scripts/run-tests.mjs).
 *
 * INCIDENT 2026-08-28 (production, 50% failure rate on a live Arabic eval):
 * the agent shipped with model "deepseek-v4-flash" and max_tokens 800. That alias runs the model in
 * REASONING mode, and DeepSeek bills reasoning tokens against max_tokens. Measured on the failing
 * production prompt:
 *
 *   deepseek-v4-flash @ 800  → reasoning_tokens 800, content "" , finish_reason "length"   ← BROKEN
 *   deepseek-v4-flash @ 4000 → reasoning_tokens 2591, content OK, finish_reason "stop"
 *   deepseek-chat     @ 800  → reasoning absent,      96 tokens, finish_reason "stop"      ← SHIPPED
 *
 * Same weights either way; the ALIAS is the thinking switch, and classification needs no
 * chain-of-thought. The previous Gemini integration solved the identical problem with
 * thinkingConfig.thinkingBudget = 0.
 *
 * This barrier stops a future "let's use the newer//faster-sounding model" edit from silently
 * re-entering reasoning mode, and stops max_tokens from being tightened back into truncation range.
 *
 * If you are deliberately moving to a reasoning model, you MUST raise max_tokens well past the
 * reasoning burn (≥4000 measured) and update this barrier in the same PR.
 */
import { readFileSync } from "node:fs";

const src = readFileSync("supabase/functions/agent/index.ts", "utf8");
const failures: string[] = [];

// 1. The default model must be a non-reasoning alias.
const NON_REASONING = ["deepseek-chat"];
const m = src.match(/const DEEPSEEK_MODEL\s*=\s*Deno\.env\.get\("DEEPSEEK_MODEL"\)\s*\?\?\s*"([^"]+)"/);
if (!m) {
  failures.push("could not find the DEEPSEEK_MODEL default — did the declaration change shape?");
} else if (!NON_REASONING.includes(m[1])) {
  failures.push(
    `DEEPSEEK_MODEL defaults to "${m[1]}", which is not a known non-reasoning alias ` +
    `(${NON_REASONING.join(", ")}). Reasoning aliases burn max_tokens on hidden chain-of-thought ` +
    `and return EMPTY content — this took production down on 2026-08-28.`,
  );
}

// 2. max_tokens must leave real headroom. 800 is the exact value that broke production.
const t = src.match(/max_tokens:\s*(\d+)/);
if (!t) failures.push("could not find max_tokens in the DeepSeek payload");
else if (Number(t[1]) < 1200) {
  failures.push(`max_tokens is ${t[1]}; must be >= 1200. A truncated JSON body fails JSON.parse and 502s the whole turn.`);
}

// 3. Truncation must stay diagnosable — finish_reason has to reach the error payload.
if (!/finish_reason/.test(src)) {
  failures.push("finish_reason is no longer surfaced in the model-call error path; a future truncation would be invisible again.");
}

if (failures.length) {
  console.error("verify-agent-nonreasoning-model: FAIL");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`verify-agent-nonreasoning-model: OK — non-reasoning alias "${m?.[1]}", max_tokens ${t?.[1]}, finish_reason surfaced.`);
