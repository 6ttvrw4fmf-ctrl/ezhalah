// The agent edge function carries TWO declarations of the same output contract:
//   SCHEMA       — Gemini's dialect (uppercase type names, no additionalProperties)
//   SCHEMA_JSON  — standard JSON Schema, for the Messages API (lowercase + additionalProperties:false)
// Both feed the SAME downstream consumer: whichever provider runs, the parsed object must have the
// same shape, because every call site after runModel() is provider-agnostic.
//
// THE FAILURE THIS PREVENTS: someone adds a filter field (say `bathrooms`) to one schema and not the
// other. Nothing errors. The agent simply stops emitting that field on one provider — a filter the
// user asked for is silently dropped, and it looks like "the AI didn't understand me" rather than a
// missing key. That is exactly the class of bug the Normal Filter barrier exists to stop, so it gets
// the same treatment: a build-failing assertion, not a code comment asking people to remember.
//
//   node --experimental-strip-types scripts/verify-agent-schema-parity.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
};

/** Slice out `const <name> = { ... };` and return its top-level `properties` keys + `required` list. */
function parseSchema(name: string): { props: string[]; required: string[]; body: string } {
  const start = src.indexOf(`const ${name} = {`);
  if (start === -1) throw new Error(`${name} not found in the agent function`);
  const end = src.indexOf('\n};', start);
  const body = src.slice(start, end);
  // Top-level property names sit at exactly 4-space indent inside `properties: {`.
  const propsStart = body.indexOf('properties: {');
  const propsBody = body.slice(propsStart);
  const props = [...propsBody.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
  const reqMatch = body.match(/required:\s*\[(.*?)\]/s);
  const required = reqMatch
    ? reqMatch[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    : [];
  return { props, required, body };
}

const gem = parseSchema('SCHEMA');
const json = parseSchema('SCHEMA_JSON');

// ── 1. Same fields, same required list ────────────────────────────────────────
check('SCHEMA and SCHEMA_JSON declare the same properties',
  JSON.stringify([...gem.props].sort()) === JSON.stringify([...json.props].sort()),
  `gemini-only: [${gem.props.filter((p) => !json.props.includes(p))}] json-only: [${json.props.filter((p) => !gem.props.includes(p))}]`);

check('SCHEMA and SCHEMA_JSON declare the same required fields',
  JSON.stringify([...gem.required].sort()) === JSON.stringify([...json.required].sort()),
  `gemini-only: [${gem.required.filter((p) => !json.required.includes(p))}] json-only: [${json.required.filter((p) => !gem.required.includes(p))}]`);

check('every property is required (the consumer reads all of them unconditionally)',
  JSON.stringify([...json.props].sort()) === JSON.stringify([...json.required].sort()));

// ── 2. Enum values must match per field — a value in one and not the other means one provider can
//       emit something the downstream switch has never seen. ─────────────────────────────────────
// Scope each enum to ITS OWN property block — a property runs from its 4-space-indented key to the
// next one. A greedy scan across the whole schema attributes a later field's enum to an earlier
// field that has none (it read `reply`'s enum as `deal`'s, and missed `deal`/`pricing_basis`).
const enumsOf = (body: string) => {
  const propsBody = body.slice(body.indexOf('properties: {'));
  const heads = [...propsBody.matchAll(/^ {4}(\w+):/gm)];
  const out: Record<string, string[] | undefined> = {};
  heads.forEach((h, i) => {
    const block = propsBody.slice(h.index!, i + 1 < heads.length ? heads[i + 1].index! : undefined);
    const m = block.match(/enum:\s*\[(.*?)\]/s);
    out[h[1]] = m
      ? m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean).sort()
      : undefined; // no enum on this field — free-form string
  });
  return out;
};
const gemEnums = enumsOf(gem.body);
const jsonEnums = enumsOf(json.body);
for (const field of Object.keys({ ...gemEnums, ...jsonEnums })) {
  check(`enum values match for "${field}"`,
    JSON.stringify(gemEnums[field]) === JSON.stringify(jsonEnums[field]),
    `gemini=${JSON.stringify(gemEnums[field])} json=${JSON.stringify(jsonEnums[field])}`);
}

// ── 3. Messages-API-specific requirements (strict structured output) ──────────
check('SCHEMA_JSON sets additionalProperties:false (required for strict output)',
  /additionalProperties:\s*false/.test(json.body));
check('SCHEMA_JSON uses lowercase JSON Schema types, not Gemini uppercase',
  !/type:\s*["'](OBJECT|STRING|ARRAY|NUMBER|BOOLEAN)["']/.test(json.body));

// ── 4. The caching + sampling invariants that make the Claude path correct ────
// Volatile per-turn text must NEVER be concatenated into the cached system block, or the cached
// prefix changes every request and prompt caching silently never hits (cost stays at 100%).
check('the cached system block is SYSTEM alone (volatile sysExtra is a separate block)',
  /\{\s*type:\s*"text",\s*text:\s*SYSTEM,\s*cache_control:/.test(src));
check('sysExtra is pushed as its own block, never appended to the cached one',
  /system\.push\(\{\s*type:\s*"text",\s*text:\s*sysExtra\s*\}\)/.test(src));
// Sonnet 5 rejects non-default temperature/top_p/top_k with a 400. Strip comments first — the code
// explains this rule in prose, and matching the explanation instead of the code is a false positive.
const claudeCode = src
  .slice(src.indexOf('const runModelClaude'), src.indexOf('const runModelGemini'))
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check('the Claude request sends no sampling parameters',
  !/\b(temperature|top_p|top_k)\s*:/.test(claudeCode));
// A refusal is HTTP 200 with empty content — reading content[0] blindly would throw.
check('the Claude path handles stop_reason "refusal" before reading content',
  /stop_reason\s*===\s*"refusal"/.test(src));

console.log(failed === 0
  ? '\n✓ agent schema parity + Claude-path invariants hold'
  : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
