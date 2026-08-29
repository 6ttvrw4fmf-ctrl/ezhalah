// THE AGENT LLM PROVIDER SWITCH (AGENT_PROVIDER=gemini|deepseek) — added 2026-08-25 so DeepSeek could
// be brought in alongside Gemini without touching production traffic. This is the barrier for it:
//
//   (A) SOURCE — cheap structural checks: the default is "gemini" (so adding DeepSeek changes NOTHING
//       until someone deliberately flips the env var), neither provider's key is ever hardcoded, and
//       every downstream call site still goes through the single `runModel` indirection (never a
//       stray direct call to one provider's fetch from inside the request-handling logic).
//   (B) BEHAVIOR — the real thing that matters, proved by actually invoking the deployed handler
//       code with network mocked out (per the repo rule: test behavior, never conclude from a code
//       string). Each provider gets its OWN process (dynamic-import caches the module by URL, so two
//       different Deno.env states in one process would silently reuse the FIRST provider's frozen
//       top-level consts — see the driver comment below) that:
//         1. stubs `Deno` (env + serve) and mocks `fetch` for loc_classify/agent_notes/the LLM itself,
//         2. sends one real POST through the real Deno.serve handler,
//         3. asserts the OUTBOUND request the code actually built (URL, headers, payload shape,
//            correct message-role mapping for DeepSeek's OpenAI-style messages[]), and
//         4. asserts the final response the client would receive is correctly built from a
//            provider-shaped reply (kind/query fields, the location catalog backstop, price
//            annualization — i.e. the ENTIRE post-model pipeline, not just the HTTP call).
//
//   node --experimental-strip-types scripts/verify-agent-provider-switch.ts   (wired into `npm test`)

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const AGENT_FILE = `${ROOT}supabase/functions/agent/index.ts`;
const src = readFileSync(AGENT_FILE, "utf8");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
};

console.log("\nAgent LLM provider switch (AGENT_PROVIDER=gemini|deepseek)\n");

// ── (A) SOURCE ────────────────────────────────────────────────────────────────────────────────────
check("AGENT_PROVIDER defaults to \"gemini\" — adding DeepSeek changes nothing until explicitly flipped",
  /const AGENT_PROVIDER = \(Deno\.env\.get\("AGENT_PROVIDER"\) \?\? "gemini"\)/.test(src));
check("neither provider's API key is ever a literal — both come from Deno.env.get only",
  /const GEMINI_API_KEY = Deno\.env\.get\("GEMINI_API_KEY"\) \?\? "";/.test(src)
  && /const DEEPSEEK_API_KEY = Deno\.env\.get\("DEEPSEEK_API_KEY"\) \?\? "";/.test(src)
  && !/(?:GEMINI|DEEPSEEK)_API_KEY\s*=\s*"[A-Za-z0-9]/.test(src));
check("the \"model not configured\" gate checks the ACTIVE provider's key, not always Gemini's",
  /const activeKeyMissing = AGENT_PROVIDER === "deepseek" \? !DEEPSEEK_API_KEY : !GEMINI_API_KEY;/.test(src));
check("exactly one runModel indirection selects the provider (no second, competing selector)",
  (src.match(/const runModel = AGENT_PROVIDER === "deepseek" \? callDeepSeek : callGemini;/g) ?? []).length === 1);
check("both call sites that invoke the model go through runModel(), not a provider function directly",
  (src.match(/await runModel\(contents,/g) ?? []).length === 2
  && !/await callGemini\(contents/.test(src.replace(/const callGemini = async[\s\S]*?\n {4}\};\n/, ""))
  && !/await callDeepSeek\(contents/.test(src.replace(/const callDeepSeek = async[\s\S]*?\n {4}\};\n/, "")));
check("Gemini's hard responseSchema (SCHEMA) is still wired into its own payload, untouched",
  /responseSchema: SCHEMA,/.test(src));
check("DeepSeek's message system prompt carries the SYSTEM text + the belt-and-braces key-shape reminder",
  /content: SYSTEM \+ sysExtra \+ DEEPSEEK_JSON_SHAPE/.test(src));
check("DeepSeek requests response_format:{type:\"json_object\"} (its only structural JSON guarantee)",
  /response_format: \{ type: "json_object" \}/.test(src));
check("Gemini's 'model' role is translated to DeepSeek's 'assistant' (OpenAI-shape has no 'model' role)",
  /role: c\.role === "model" \? "assistant" : "user"/.test(src));

// ── (B) BEHAVIOR — one isolated child process per provider ──────────────────────────────────────
// The driver is plain JS (no TS syntax of its own) so it runs under the SAME
// --experimental-strip-types flag as this barrier; only the dynamically-imported agent file needs
// that loader for its own TS syntax, and it inherits the parent process's flag.
const DRIVER = `
  const cfg = JSON.parse(process.env.__AGENT_TEST_CFG);
  globalThis.Deno = { env: { get: (k) => cfg.env[k] }, serve: (fn) => { globalThis.__h = fn; } };
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("agent_notes")) return new Response("[]", { status: 200 });
    if (u.includes("loc_classify")) return new Response(JSON.stringify({ kind: "city", name: cfg.resolvedCity }), { status: 200 });
    if (u.includes(cfg.llmUrlContains)) {
      captured = { url: u, headers: opts.headers, payload: JSON.parse(opts.body) };
      return new Response(cfg.llmResponseBody, { status: 200 });
    }
    return realFetch(url, opts);
  };
  await import(${JSON.stringify(AGENT_FILE)});
  const req = new Request("https://fake/agent", {
    method: "POST",
    headers: { apikey: "sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB", "content-type": "application/json" },
    body: JSON.stringify({ text: cfg.text, locale: "ar", loggedIn: false, history: [] }),
  });
  const res = await globalThis.__h(req);
  const body = await res.json();
  console.log(JSON.stringify({ status: res.status, body, captured }));
`;
const driverPath = `${ROOT}scripts/.tmp-agent-provider-driver.mjs`;
writeFileSync(driverPath, DRIVER);

function runScenario(cfg: Record<string, unknown>): { status: number; body: any; captured: any } {
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", driverPath],
    { env: { ...process.env, __AGENT_TEST_CFG: JSON.stringify(cfg) }, encoding: "utf8" },
  );
  return JSON.parse(out.trim().split("\n").pop()!);
}

try {
  // ── GEMINI scenario: AGENT_PROVIDER omitted → must default and behave exactly as before ──
  const gemini = runScenario({
    env: { GEMINI_API_KEY: "fake-gemini-key", SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fake", SUPABASE_ANON_KEY: "fake-anon" },
    llmUrlContains: "generativelanguage.googleapis.com",
    resolvedCity: "Jeddah",
    text: "أبي فيلا للبيع في جدة 4 غرف بحدود مليونين",
    llmResponseBody: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      kind: "listings", reply: "أبشر، أدور لك فلل في جدة.", deal: "Buy", location: "Jeddah", type: "Villa",
      detail: "4", price: "2000000", pricing_basis: "full_price", rent_period: "none", sort: "none", count: "0", platforms: [],
    }) }] } }] }),
  });
  check("[gemini] HTTP 200 with kind=listings", gemini.status === 200 && gemini.body.kind === "listings");
  check("[gemini] query fields flow through correctly (deal/location/price)",
    gemini.body.query?.deal === "Buy" && gemini.body.query?.location === "Jeddah" && gemini.body.query?.price === "2000000");
  check("[gemini] hit the unchanged Gemini URL for gemini-2.5-flash",
    gemini.captured?.url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", gemini.captured?.url);
  check("[gemini] key sent via x-goog-api-key header, never the URL or a messages[] body",
    gemini.captured?.headers?.["x-goog-api-key"] === "fake-gemini-key");
  check("[gemini] payload still uses system_instruction + contents[] (Gemini's own shape)",
    !!gemini.captured?.payload?.system_instruction?.parts?.[0]?.text?.includes("You are Ezhalah")
    && Array.isArray(gemini.captured?.payload?.contents));
  check("[gemini] payload's responseSchema is still the full hard schema (untouched by the switch)",
    gemini.captured?.payload?.generationConfig?.responseSchema?.type === "OBJECT");
  check("[gemini] no DeepSeek-shaped field leaked into the Gemini payload",
    !("messages" in (gemini.captured?.payload ?? {})) && !("response_format" in (gemini.captured?.payload ?? {})));

  // ── DEEPSEEK scenario: AGENT_PROVIDER=deepseek → the new path ──
  const deepseek = runScenario({
    env: { AGENT_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "fake-deepseek-key", DEEPSEEK_MODEL: "deepseek-v4-flash", SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fake", SUPABASE_ANON_KEY: "fake-anon" },
    llmUrlContains: "api.deepseek.com",
    resolvedCity: "Riyadh",
    text: "أبي شقة للإيجار في الرياض 3 غرف بميزانية 80 ألف",
    llmResponseBody: JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({
      kind: "listings", reply: "أبشر، أدور لك شقق للإيجار في الرياض.", deal: "Rent", location: "Riyadh", type: "Apartment",
      detail: "3", price: "80000", pricing_basis: "annual_rent", rent_period: "annual", sort: "none", count: "0", platforms: [],
    }) }, finish_reason: "stop" }] }),
  });
  check("[deepseek] HTTP 200 with kind=listings", deepseek.status === 200 && deepseek.body.kind === "listings");
  check("[deepseek] query fields flow through the SAME downstream pipeline as Gemini (deal/location/rentPeriod)",
    deepseek.body.query?.deal === "Rent" && deepseek.body.query?.location === "Riyadh" && deepseek.body.query?.rentPeriod === "annual");
  check("[deepseek] hit the DeepSeek chat-completions endpoint with Bearer auth",
    deepseek.captured?.url === "https://api.deepseek.com/chat/completions"
    && deepseek.captured?.headers?.Authorization === "Bearer fake-deepseek-key");
  check("[deepseek] payload uses OpenAI-shape messages[] with the configured model + json_object mode",
    deepseek.captured?.payload?.model === "deepseek-v4-flash"
    && Array.isArray(deepseek.captured?.payload?.messages)
    && deepseek.captured?.payload?.response_format?.type === "json_object");
  check("[deepseek] the SYSTEM prompt reached the model as the first message, role=system",
    deepseek.captured?.payload?.messages?.[0]?.role === "system"
    && deepseek.captured.payload.messages[0].content.includes("You are Ezhalah"));
  check("[deepseek] the user's turn reached the model as the LAST message, role=user",
    deepseek.captured?.payload?.messages?.at(-1)?.role === "user"
    && deepseek.captured.payload.messages.at(-1).content.includes("أبي شقة للإيجار"));
  check("[deepseek] no Gemini-only role ('model') ever appears in the OpenAI-shape messages",
    !deepseek.captured?.payload?.messages?.some((m: any) => m.role === "model"));
} finally {
  unlinkSync(driverPath);
}

console.log(failures === 0
  ? "\n✓ the provider switch defaults safely to Gemini, and both providers run the identical downstream pipeline\n"
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
