// verify-agent-provider-switch — the DeepSeek → Groq cut-over switch, EXECUTED against the real agent.
//
// Owner 2026-10-17: «replace DeepSeek with Groq GPT-OSS 20B … keep DeepSeek available for rollback,
// switch only after verification». The rollback lever is the AI_PROVIDER secret (default deepseek), and
// the live-test lever is a per-request `x-ezhalah-provider` header honoured ONLY for a caller bearing the
// service-role key. Both are security- and money-relevant, so this does not grep for them: it loads
// supabase/functions/agent/index.ts UNMODIFIED under a Deno shim, drives real requests through its
// handler, and records where the paid request actually went (the fetch is stubbed — no network).
//
// Proves: users get the default; a user cannot pick the provider with a header; only the service key
// can; AI_PROVIDER=groq moves everyone; Groq gets its own key, model, ceiling and reasoning_effort;
// and a selected provider with no key FAILS CLOSED instead of quietly using the other one.
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  — ${detail}`}`);
  if (!ok) failures.push(label);
};

type Sent = { url: string; auth: string; body: any };
let sent: Sent[] = [];
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/api\.(deepseek|groq)\.com/.test(url)) {
    const body = JSON.parse(String(init.body));
    sent.push({ url, auth: String(init.headers?.Authorization ?? ""), body });
    const content = JSON.stringify({ kind: "listings", reply: "أبحث لك عن شقق في الرياض 🏠", deal: "Rent", location: "Riyadh", type: "Apartment", detail: "", price: "", pricing_basis: "none", rent_period: "none", sort: "none", count: "0", platforms: [], excludedPlatforms: [], sourceSelectionChanged: false, ask_about: [], furnished: "none", af: {}, amenities: [] });
    return new Response(JSON.stringify({ model: body.model, choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  }
  if (url.includes("ai_spend_gate")) return new Response(JSON.stringify({ allow: true }), { status: 200 });
  if (url.includes("agent_notes")) return new Response("[]", { status: 200 });
  if (url.includes("loc_classify")) return new Response("null", { status: 200 });
  return new Response(null, { status: 204 });
}) as typeof fetch;
const realLog = console.log;
console.log = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith('{"evt"')) return; realLog(...a); };

const BASE = { DEEPSEEK_API_KEY: "ds-key", GROQ_API_KEY: "groq-key", SUPABASE_URL: "https://stub.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" };
let n = 0;
async function load(env: Record<string, string>, file = "index.ts") {
  let handler: ((r: Request) => Promise<Response>) | null = null;
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: any) => { handler = h; } };
  await import(`../supabase/functions/agent/${file}?instance=${++n}`); // fresh module: env is read at load
  if (!handler) throw new Error("agent did not register a handler");
  return async (headers: Record<string, string>) => {
    sent = [];
    const res = await handler!(new Request("http://t/agent", {
      method: "POST", headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ text: "ابي شقة للايجار في الرياض", locale: "ar", history: [], askCount: 0 }),
    }));
    return { status: res.status, body: await res.json().catch(() => ({})), sent: [...sent] };
  };
}
const user = { apikey: "anon-key", Authorization: "Bearer anon-key" };
const isDeepSeek = (s: Sent[]) => s.length > 0 && s.every((x) => x.url.startsWith("https://api.deepseek.com/") && x.body.model === "deepseek-chat" && x.auth === "Bearer ds-key" && x.body.max_tokens === 1500 && !("reasoning_effort" in x.body));
const isGroq = (s: Sent[]) => s.length > 0 && s.every((x) => x.url === "https://api.groq.com/openai/v1/chat/completions" && x.body.model === "openai/gpt-oss-20b" && x.auth === "Bearer groq-key" && x.body.max_tokens >= 4000 && x.body.reasoning_effort === "low");
const where = (s: Sent[]) => s.map((x) => `${x.url} ${x.body.model} ${x.auth}`).join("; ") || "no model call";

const dflt = await load({ ...BASE });
let r = await dflt(user);
check("default (AI_PROVIDER unset): a user turn goes to DeepSeek, unchanged", r.status === 200 && isDeepSeek(r.sent), where(r.sent));
r = await dflt({ ...user, "x-ezhalah-provider": "groq" });
check("a USER cannot pick Groq with the header (anon bearer) — still DeepSeek", isDeepSeek(r.sent), where(r.sent));
r = await dflt({ apikey: "anon-key", "x-ezhalah-provider": "groq" });
check("no bearer at all + header — still DeepSeek", isDeepSeek(r.sent), where(r.sent));
r = await dflt({ apikey: "anon-key", Authorization: "Bearer service-key", "x-ezhalah-provider": "groq" });
check("the SERVICE-ROLE bearer may force Groq for one request (own key, model, 4000 ceiling, reasoning low)", r.status === 200 && isGroq(r.sent), where(r.sent));
r = await dflt({ apikey: "anon-key", Authorization: "Bearer service-key" });
check("the service bearer WITHOUT the header gets the default", isDeepSeek(r.sent), where(r.sent));

const groq = await load({ ...BASE, AI_PROVIDER: "groq" });
r = await groq(user);
check("AI_PROVIDER=groq: an ordinary user turn goes to Groq", r.status === 200 && isGroq(r.sent), where(r.sent));
r = await groq({ apikey: "anon-key", Authorization: "Bearer service-key", "x-ezhalah-provider": "deepseek" });
check("AI_PROVIDER=groq: the service bearer can still force DeepSeek (rollback test path)", isDeepSeek(r.sent), where(r.sent));

const groqNoKey = await load({ ...BASE, AI_PROVIDER: "groq", GROQ_API_KEY: "" });
r = await groqNoKey(user);
check("Groq selected but GROQ_API_KEY missing → 503 'model not configured', NO paid call to either provider",
  r.status === 503 && r.body?.error === "model not configured" && r.sent.length === 0, `${r.status} ${JSON.stringify(r.body)} ${where(r.sent)}`);

const typo = await load({ ...BASE, AI_PROVIDER: "gorq" });
r = await typo(user);
check("an unrecognised AI_PROVIDER value falls back to the DeepSeek default", isDeepSeek(r.sent), where(r.sent));

// ── mutation proof — the two safety properties, re-run against a broken copy of the REAL file ─────
// The mutant sits beside index.ts (its relative imports must resolve) and is always deleted.
const { readFileSync, writeFileSync, rmSync } = await import("node:fs");
const AGENT_DIR = new URL("../supabase/functions/agent/", import.meta.url);
const realSrc = readFileSync(new URL("index.ts", AGENT_DIR), "utf8");
const userCannotForceGroq = async (file: string) => isDeepSeek((await (await load({ ...BASE }, file))({ ...user, "x-ezhalah-provider": "groq" })).sent);
const missingKeyFailsClosed = async (file: string) => {
  const res = await (await load({ ...BASE, AI_PROVIDER: "groq", GROQ_API_KEY: "" }, file))(user);
  return res.status === 503 && res.sent.length === 0;
};
async function mustCatch(label: string, find: string, replace: string, holds: (file: string) => Promise<boolean>) {
  if (!realSrc.includes(find)) { check(`(mutation) ${label} — anchor still present in index.ts`, false, `anchor not found: ${find}`); return; }
  const name = `__mutant_provider_switch_${process.pid}_${n}.ts`;
  const path = new URL(name, AGENT_DIR);
  writeFileSync(path, realSrc.replace(find, replace));
  try {
    check(`(mutation) catches ${label}`, !(await holds(name)), "the property still held on the broken copy — this check cannot see that defect");
  } finally { rmSync(path, { force: true }); }
}
await mustCatch("ANY caller choosing the provider (service-key gate removed)",
  "const prov = modelProvider(trustedCaller && ", "const prov = modelProvider(true && ", userCannotForceGroq);
await mustCatch("a missing provider key no longer failing closed",
  "if (!prov.key) {", "if (false) {", missingKeyFailsClosed);

if (failures.length) {
  console.error(`\nverify-agent-provider-switch: FAIL (${failures.length})`);
  process.exit(1);
}
realLog("\nverify-agent-provider-switch: OK — default DeepSeek; only the service key can force Groq; AI_PROVIDER=groq moves everyone; missing key fails closed.");
