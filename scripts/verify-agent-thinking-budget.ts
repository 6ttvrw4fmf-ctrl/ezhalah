// On Gemini — unlike OpenAI — THINKING TOKENS ARE BILLED AGAINST maxOutputTokens. That single fact
// makes "turn thinking on" a two-value change, and getting it wrong fails in the worst way: the API
// returns 200 OK with a truncated or empty candidate, so the agent silently answers nothing. There
// is no error to grep for; searches just start coming back blank.
//
// The original config was `thinkingBudget: 0` + `maxOutputTokens: 800`, which was internally
// consistent (no thinking, so all 800 went to the JSON). Enabling thinking without raising the cap
// re-creates the broken state — Flash on a dynamic budget spends 90-98% of the cap reasoning, and
// the JSON never gets written.
//
// This guard pins the invariant: whenever thinking is enabled, the output cap must leave real room
// for the JSON on top of the thinking budget.
//
//   node --experimental-strip-types scripts/verify-agent-thinking-budget.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');
// Assertions about CODE must ignore prose: this file explains the very numbers it configures, and a
// regex over raw source happily matches the explanation instead of the config.
const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
};

const num = (name: string): number | null => {
  const m = codeOnly.match(new RegExp(`const ${name} = Number\\(Deno\\.env\\.get\\("${name}"\\) \\?\\? "(-?\\d+)"\\)`));
  return m ? Number(m[1]) : null;
};

const budget = num('GEMINI_THINKING_BUDGET');
const cap = num('GEMINI_MAX_OUTPUT_TOKENS');

check('GEMINI_THINKING_BUDGET is env-tunable with a numeric default', budget !== null);
check('GEMINI_MAX_OUTPUT_TOKENS is env-tunable with a numeric default', cap !== null);

if (budget !== null && cap !== null) {
  // The JSON payload observed for this schema is ~400-800 tokens; require a full 800 of headroom on
  // top of thinking so a long Arabic `reply` can never be the thing that gets cut off.
  const JSON_HEADROOM = 800;
  if (budget === 0) {
    check('thinking disabled: the cap only needs to cover the JSON', cap >= JSON_HEADROOM,
      `cap=${cap} < ${JSON_HEADROOM}`);
  } else if (budget < 0) {
    // Dynamic (-1) has no ceiling the code can reason about; Flash will spend nearly the whole cap
    // thinking. Refuse it as a default — it is the exact configuration that returns empty JSON.
    check('a DYNAMIC thinking budget (-1) is not the committed default', false,
      'dynamic spends 90-98% of maxOutputTokens on reasoning, starving the JSON — set an explicit budget');
  } else {
    check(`thinking enabled (${budget}): cap leaves >= ${JSON_HEADROOM} tokens for the JSON`,
      cap - budget >= JSON_HEADROOM,
      `cap=${cap} - budget=${budget} = ${cap - budget}, which is under ${JSON_HEADROOM}`);
  }

  // The pre-2026-08-15 pairing, restated so nobody reintroduces it by "restoring the old cap".
  check('the old 800-token cap is not paired with thinking enabled',
    !(budget !== 0 && cap === 800),
    'maxOutputTokens 800 with thinking ON is the empty-response configuration');
}

// Both values must be read from the SAME config object, or one can be changed without the other.
const cfg = codeOnly.slice(codeOnly.indexOf('const genConfig'), codeOnly.indexOf('responseSchema'));
check('genConfig consumes both constants (neither is a stray literal)',
  /thinkingConfig:\s*\{\s*thinkingBudget:\s*GEMINI_THINKING_BUDGET\s*\}/.test(cfg) &&
  /maxOutputTokens:\s*GEMINI_MAX_OUTPUT_TOKENS/.test(cfg));

console.log(failed === 0
  ? '\n✓ Gemini thinking budget and output cap are mutually consistent'
  : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
