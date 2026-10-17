// AGENT PROVIDER COMPARISON — DeepSeek vs a candidate (Groq GPT-OSS 20B) on Ezhalah's REAL contract.
//
// WHAT THIS IS. A test harness only. It changes no provider, deploys nothing and touches no user. It
// loads the PRODUCTION edge function (supabase/functions/agent/index.ts) UNMODIFIED under Node, with a
// small Deno shim, and drives it turn by turn the way the app does. Every prompt, the agent_notes live
// rules, decideAgentTurn(), the post-model rules, the language guard and the JSON contract are the real
// ones — nothing is copied, so the comparison cannot drift from production (the 2026-08-29 lesson:
// never test a copy of production code).
//
// HOW THE PROVIDER IS SWITCHED WITHOUT TOUCHING THE FUNCTION. Only at the network layer, in this
// process: the function still believes it is calling DeepSeek with DEEPSEEK_MODEL, so its own model
// allowlist and request builder run exactly as in production. For the candidate arm the shim re-addresses
// that identical request to Groq's OpenAI-compatible endpoint and swaps only `model` (plus the optional
// `reasoning_effort` knob GPT-OSS needs — see the MODEL CHOICE note at the top of index.ts). The demo's
// test-only schema is deliberately NOT used anywhere.
//
// PRODUCTION SAFETY (AGENTS.md "Our own robots must not take production down").
//   • READS ONLY. The shim lets exactly two production calls through: GET agent_notes (the live rules)
//     and POST rpc/loc_classify (a STABLE, read-only function). ai_usage / agent_health_event writes are
//     swallowed, ai_spend_gate is answered locally (this run spends on its own keys, never the app's
//     breaker), and ANY other Supabase request throws — so a future new write fails closed here.
//   • ONE turn at a time, paced, and it waits whenever public.ops_search_load_now() says degraded.
//
// RUN: the "Agent provider comparison" workflow (manual). Offline proof: SELFTEST=1 (no keys, no network).
// Report: agent-provider-compare-report.md + .json in the working directory.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mergeConversationState, describeKnownState } from "../src/lib/conversationState.ts";

type Turn = { text: string; locale: "ar" | "en"; expect?: { kind?: string; replyLang?: "ar" | "en"; location?: string } };
type Case = { id: string; group: "arabic" | "english" | "mixed" | "follow-up"; turns: Turn[] };

// Cases: plain searches, rule traps (vague size, situation-not-filters, advice, unsupported website,
// ambiguous district) and multi-turn follow-ups. Expectations are only the few facts AGENTS.md /
// the prompt state outright; the main measures are self-consistency and DeepSeek↔candidate parity.
export const CASES: Case[] = [
  { id: "ar-rent-riyadh", group: "arabic", turns: [{ text: "ابي شقة للايجار في الرياض", locale: "ar", expect: { kind: "listings", replyLang: "ar" } }] },
  { id: "ar-villa-budget", group: "arabic", turns: [{ text: "فيلا للبيع في جدة ٤ غرف بحدود مليونين", locale: "ar", expect: { kind: "listings", replyLang: "ar" } }] },
  { id: "ar-dual-bathrooms", group: "arabic", turns: [{ text: "شقة مفروشة في الخبر فيها حمامين", locale: "ar", expect: { replyLang: "ar" } }] },
  { id: "ar-vague-size", group: "arabic", turns: [{ text: "ابي بيت كبير في الدمام", locale: "ar", expect: { replyLang: "ar" } }] },
  { id: "ar-ambiguous-district", group: "arabic", turns: [{ text: "شقة للايجار في حي الروضة", locale: "ar", expect: { replyLang: "ar" } }] },
  { id: "ar-situation-not-filters", group: "arabic", turns: [{ text: "عندي عائلة من ٤ أشخاص وأدور مكان هادي", locale: "ar", expect: { replyLang: "ar" } }] },
  { id: "ar-advice-refusal", group: "arabic", turns: [{ text: "وش أفضل حي للاستثمار في الرياض؟", locale: "ar", expect: { replyLang: "ar" } }] },
  { id: "ar-one-platform", group: "arabic", turns: [{ text: "ابي شقق للايجار في الرياض من عقار بس", locale: "ar", expect: { replyLang: "ar" } }] },
  { id: "en-rent-budget", group: "english", turns: [{ text: "2 bedroom apartment for rent in Riyadh under 60k a year", locale: "en", expect: { kind: "listings", replyLang: "en" } }] },
  { id: "en-cheapest-sort", group: "english", turns: [{ text: "cheapest villas for sale in Jeddah", locale: "en", expect: { kind: "listings", replyLang: "en" } }] },
  { id: "en-unsupported-site", group: "english", turns: [{ text: "show me apartments in Riyadh from Zillow", locale: "en", expect: { replyLang: "en" } }] },
  { id: "mixed-ar-majority", group: "mixed", turns: [{ text: "ابي apartment للايجار في الرياض قريب من الشغل", locale: "ar", expect: { replyLang: "ar" } }] },
  { id: "mixed-en-majority", group: "mixed", turns: [{ text: "looking for a furnished شقة near KAFD for rent", locale: "en", expect: { replyLang: "en" } }] },
  { id: "fu-refine-ar", group: "follow-up", turns: [
    { text: "ابي شقة للايجار في الرياض", locale: "ar" },
    { text: "خلها ٣ غرف", locale: "ar", expect: { replyLang: "ar" } },
    { text: "رتبها من الأرخص", locale: "ar", expect: { replyLang: "ar" } },
  ] },
  { id: "fu-city-answer", group: "follow-up", turns: [
    { text: "ابي شقة في حي الياسمين", locale: "ar" },
    { text: "الرياض", locale: "ar", expect: { replyLang: "ar" } },
  ] },
  { id: "fu-change-city-en", group: "follow-up", turns: [
    { text: "villa for sale in Dammam", locale: "en" },
    { text: "make it Khobar instead", locale: "en", expect: { replyLang: "en" } },
  ] },
  { id: "fu-new-search-ar", group: "follow-up", turns: [
    { text: "شقة للايجار في جدة", locale: "ar" },
    { text: "طيب ابي فيلا للبيع في مكة", locale: "ar", expect: { replyLang: "ar" } },
  ] },
  { id: "fu-language-switch", group: "follow-up", turns: [
    { text: "شقة للايجار في الرياض", locale: "ar" },
    { text: "now only show listings from Bayut", locale: "ar", expect: { replyLang: "en" } },
  ] },
];

const env = process.env;
const SELFTEST = env.SELFTEST === "1";
const REPEATS = Math.max(1, Math.min(10, Number(env.REPEATS ?? 3) || 3));
const PROVIDERS = String(env.PROVIDERS ?? "deepseek,groq").split(",").map((s) => s.trim()).filter(Boolean);
const GROQ_MODEL = env.GROQ_MODEL || "openai/gpt-oss-20b";
const GROQ_REASONING_EFFORT = env.GROQ_REASONING_EFFORT ?? "low"; // "" sends none
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const SUPABASE_URL = SELFTEST ? "https://selftest.invalid" : String(env.SUPABASE_URL ?? "");
const SERVICE_KEY = SELFTEST ? "selftest-service" : String(env.SUPABASE_SERVICE_ROLE_KEY ?? "");
const ANON_KEY = SELFTEST ? "selftest-anon" : String(env.SUPABASE_ANON_KEY ?? "");
const OUT_DIR = env.OUT_DIR || ".";
const PACE_MS = SELFTEST ? 0 : Number(env.PACE_MS ?? 3000);

// ── network shim ────────────────────────────────────────────────────────────────────────────────
type CallMeta = { status: number; latencyMs: number; finish: string | null; model: string | null; promptTokens: number | null; completionTokens: number | null; reasoningTokens: number | null };
let arm = "deepseek";
let calls: CallMeta[] = [];
export const blocked: string[] = [];
const realFetch = globalThis.fetch;
const pathOf = (u: string) => u.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");

function selftestModel(body: any): Response {
  const user = String(body.messages.at(-1)?.content ?? "");
  const en = /[a-z]{3}/i.test(user) && !/[؀-ۿ]/.test(user);
  const content = JSON.stringify({ kind: "listings", reply: en ? "Searching apartments in Riyadh 🏠" : "أبحث لك عن شقق في الرياض 🏠", deal: "Rent", location: "Riyadh", type: "Apartment", detail: "", price: "", pricing_basis: "none", rent_period: "none", sort: "none", count: "0", platforms: [], excludedPlatforms: [], sourceSelectionChanged: false, ask_about: [], furnished: "none", af: {}, amenities: [] });
  return new Response(JSON.stringify({ model: body.model, choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
}

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = String(init.method ?? "GET").toUpperCase();
  if (url.startsWith("https://api.deepseek.com/")) {
    const body = JSON.parse(String(init.body));
    let target = url, headers: Record<string, string> = { ...init.headers };
    if (arm === "groq") {
      target = GROQ_URL;
      body.model = GROQ_MODEL;
      if (GROQ_REASONING_EFFORT) body.reasoning_effort = GROQ_REASONING_EFFORT;
      headers = { ...headers, Authorization: `Bearer ${env.GROQ_API_KEY ?? ""}` };
    }
    const t0 = Date.now();
    const res = SELFTEST ? selftestModel(body) : await realFetch(target, { ...init, headers, body: JSON.stringify(body) });
    const text = await res.text();
    let data: any = null; try { data = JSON.parse(text); } catch { /* recorded as-is */ }
    const u = data?.usage ?? {};
    calls.push({
      status: res.status, latencyMs: Date.now() - t0, finish: data?.choices?.[0]?.finish_reason ?? null,
      model: data?.model ?? null, promptTokens: u.prompt_tokens ?? null, completionTokens: u.completion_tokens ?? null,
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? null,
    });
    return new Response(text, { status: res.status, headers: res.headers });
  }
  if (url.startsWith(SUPABASE_URL) && SUPABASE_URL) {
    const p = pathOf(url);
    if (method === "GET" && p === "/rest/v1/agent_notes") {
      return SELFTEST ? new Response("[]", { status: 200 }) : realFetch(input, init);
    }
    if (method === "POST" && p === "/rest/v1/rpc/loc_classify") {
      return SELFTEST ? new Response("null", { status: 200 }) : realFetch(input, init);
    }
    if (method === "POST" && p === "/rest/v1/rpc/ai_spend_gate") return new Response(JSON.stringify({ allow: true, state: "harness" }), { status: 200 });
    if (method === "POST" && (p === "/rest/v1/ai_usage" || p === "/rest/v1/agent_health_event")) {
      blocked.push(`${method} ${p}`);
      return new Response(null, { status: 204 });
    }
    throw new Error(`agent-provider-compare: refused unexpected production request ${method} ${p}`);
  }
  if (SELFTEST) throw new Error(`agent-provider-compare: SELFTEST must not reach the network (${method} ${url})`);
  return realFetch(input, init);
}) as typeof fetch;

// ── load the REAL function ─────────────────────────────────────────────────────────────────────
let handler: ((r: Request) => Promise<Response>) | null = null;
const denoEnv: Record<string, string> = {
  // The function refuses to run without a DeepSeek key. The groq arm replaces the Authorization header,
  // so a placeholder lets a Groq-only run proceed and the DeepSeek key never travels to Groq.
  DEEPSEEK_API_KEY: SELFTEST ? "selftest" : String(env.DEEPSEEK_API_KEY || "unused-by-groq-arm"),
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY,
};
if (env.DEEPSEEK_MODEL) denoEnv.DEEPSEEK_MODEL = env.DEEPSEEK_MODEL;
(globalThis as any).Deno = { env: { get: (k: string) => denoEnv[k] }, serve: (h: any) => { handler = h; } };
// The function logs one JSON line per model call; keep the report readable.
const realLog = console.log;
console.log = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith('{"evt"')) return; realLog(...a); };
await import("../supabase/functions/agent/index.ts");
if (!handler) throw new Error("agent-provider-compare: the agent module did not register a Deno.serve handler");

// ── helpers ────────────────────────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitForQuietDb(): Promise<void> {
  if (SELFTEST) return;
  for (let i = 0; i < 10; i++) {
    try {
      const r = await realFetch(`${SUPABASE_URL}/rest/v1/rpc/ops_search_load_now`, {
        method: "POST", headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "content-type": "application/json" }, body: "{}",
      });
      const row = (await r.json())?.[0];
      if (r.ok && row && row.degraded === false) return;
      realLog(`  production load degraded or unreadable (${r.status}) — waiting 60s`);
    } catch { realLog("  production load unreadable — waiting 60s"); }
    await sleep(60_000);
  }
  throw new Error("agent-provider-compare: production stayed busy for 10 minutes — stopping rather than adding load");
}
const lang = (s: string): "ar" | "en" | "mixed" | "none" => {
  const ar = (s.match(/[؀-ۿ]+/g) ?? []).length, en = (s.match(/[A-Za-z]+/g) ?? []).length;
  return !ar && !en ? "none" : ar > en ? "ar" : en > ar ? "en" : "mixed";
};
const EMOJI = /\p{Extended_Pictographic}/gu;
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as any)[k])])) : v;
const key = (v: unknown) => JSON.stringify(canon(v));

type TurnOut = {
  status: number; kind: string | null; reply: string; query: Record<string, unknown> | null; error: string | null;
  totalMs: number; calls: CallMeta[]; checks: string[];
};

async function runTurn(t: Turn, st: { history: { role: string; text: string }[]; prev: any; askCount: number }): Promise<TurnOut> {
  calls = [];
  const body = {
    text: t.text, locale: t.locale, loggedIn: false, order: false, history: st.history,
    knownState: describeKnownState(st.prev) || undefined, prevQuery: st.prev ?? undefined,
    askCount: st.askCount, userMessageId: `harness-${Math.random().toString(36).slice(2)}`, historyTurnsRaw: st.history.length,
  };
  const t0 = Date.now();
  const res = await handler!(new Request("http://harness/agent", {
    method: "POST", headers: { apikey: ANON_KEY, "content-type": "application/json", "x-ezhalah-client": "selftest" }, body: JSON.stringify(body),
  }));
  const d: any = await res.json().catch(() => ({}));
  const reply = String(d?.reply ?? "");
  const checks: string[] = [];
  if (res.status !== 200) checks.push(`http ${res.status}: ${d?.error ?? "?"}`);
  if (t.expect?.kind && d?.kind !== t.expect.kind) checks.push(`kind ${d?.kind} ≠ expected ${t.expect.kind}`);
  if (reply) {
    const l = lang(reply);
    if (t.expect?.replyLang && l !== t.expect.replyLang) checks.push(`reply language ${l} ≠ ${t.expect.replyLang}`);
    if ((reply.match(EMOJI) ?? []).length !== 1) checks.push(`emoji count ${(reply.match(EMOJI) ?? []).length} ≠ 1`);
    if (/[—–]|\s-\s/.test(reply)) checks.push("reply contains a dash");
    if (/^\s*أبشر/.test(reply)) checks.push("reply opens with «أبشر»");
  } else if (d?.kind === "listings" || d?.kind === "message") checks.push("empty reply");
  // Fold state forward the way the app does (approximation: the app also normalises the backend query
  // through queryFromBackend/statedKeys before merging; both arms receive identical treatment).
  st.history.push({ role: "user", text: t.text });
  if (reply) st.history.push({ role: "model", text: reply });
  if (d?.query && typeof d.query === "object") st.prev = mergeConversationState(st.prev, d.query);
  if (typeof d?.askCount === "number") st.askCount = d.askCount;
  return { status: res.status, kind: d?.kind ?? null, reply, query: d?.query ?? null, error: d?.error ?? null, totalMs: Date.now() - t0, calls: [...calls], checks };
}

// ── run ────────────────────────────────────────────────────────────────────────────────────────
const results: Record<string, Record<string, TurnOut[][]>> = {}; // provider → case → repeat → turns
const active = PROVIDERS.filter((p) => {
  if (SELFTEST) return true;
  if (p === "deepseek" && !env.DEEPSEEK_API_KEY) { realLog("skip deepseek: DEEPSEEK_API_KEY is not set"); return false; }
  if (p === "groq" && !env.GROQ_API_KEY) { realLog("skip groq: GROQ_API_KEY is not set"); return false; }
  return p === "deepseek" || p === "groq";
});
if (!active.length) throw new Error("agent-provider-compare: no provider has a key — nothing to compare");
if (!SELFTEST && (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY)) throw new Error("agent-provider-compare: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are required (live rules come from agent_notes)");

for (const c of CASES) {
  await waitForQuietDb();
  for (let r = 0; r < REPEATS; r++) {
    // Interleave providers per repeat so both see the same production state and the same minute.
    for (const p of active) {
      arm = p;
      const st = { history: [] as { role: string; text: string }[], prev: null as any, askCount: 0 };
      const turns: TurnOut[] = [];
      for (const t of c.turns) { turns.push(await runTurn(t, st)); await sleep(PACE_MS); }
      ((results[p] ??= {})[c.id] ??= []).push(turns);
    }
  }
  realLog(`done ${c.id}`);
}

// ── report ─────────────────────────────────────────────────────────────────────────────────────
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");
const q = (xs: number[], p: number) => { if (!xs.length) return "–"; const s = [...xs].sort((a, b) => a - b); return String(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => typeof x === "number"); return v.length ? String(Math.round(v.reduce((a, b) => a + b, 0) / v.length)) : "–"; };
const out: string[] = [];
out.push(`# Agent provider comparison`, ``, `Real production function, live agent_notes, read-only. Repeats per case: ${REPEATS}. Candidate: Groq \`${GROQ_MODEL}\`${GROQ_REASONING_EFFORT ? `, reasoning_effort=${GROQ_REASONING_EFFORT}` : ""}.${SELFTEST ? " **SELFTEST — stubbed model, not a real comparison.**" : ""}`, ``);
out.push(`## Health per provider`, ``, `| provider | turns | ok (200 + kind) | rule/expectation misses | finish=length | latency p50 / p95 ms | avg prompt / completion / reasoning tokens | billed model |`, `|---|---|---|---|---|---|---|---|`);
for (const p of active) {
  const all = Object.values(results[p] ?? {}).flat(2);
  const cs = all.flatMap((t) => t.calls);
  out.push(`| ${p} | ${all.length} | ${pct(all.filter((t) => t.status === 200 && t.kind).length, all.length)} | ${all.filter((t) => t.checks.length).length} | ${cs.filter((c) => c.finish === "length").length} | ${q(all.map((t) => t.totalMs), 0.5)} / ${q(all.map((t) => t.totalMs), 0.95)} | ${avg(cs.map((c) => c.promptTokens))} / ${avg(cs.map((c) => c.completionTokens))} / ${avg(cs.map((c) => c.reasoningTokens))} | ${[...new Set(cs.map((c) => c.model).filter(Boolean))].join(", ") || "–"} |`);
}
out.push(``, `## Per case`, ``, `Consistency = share of repeats giving the provider's most common (kind + query) on the final turn. Parity = whether DeepSeek's and the candidate's most common final answers match; when they differ the differing query fields are listed.`, ``);
out.push(`| case | group | ${active.map((p) => `${p} consistency`).join(" | ")} | parity | notes |`, `|---|---|${active.map(() => "---").join("|")}|---|---|`);
const modal = (runs: TurnOut[][]) => {
  const counts = new Map<string, number>();
  for (const run of runs) { const f = run.at(-1)!; const k = key({ kind: f.kind, query: f.query }); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const [k, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return { k, n, total: runs.length };
};
for (const c of CASES) {
  const m = Object.fromEntries(active.map((p) => [p, modal(results[p]?.[c.id] ?? [])]));
  let parity = "–", notes: string[] = [];
  if (active.length === 2) {
    const [a, b] = active.map((p) => JSON.parse(m[p].k || "{}"));
    if (key(a) === key(b)) parity = "same";
    else {
      const fields = new Set([...Object.keys(a.query ?? {}), ...Object.keys(b.query ?? {})]);
      const diff = [...fields].filter((f) => key(a.query?.[f]) !== key(b.query?.[f]));
      parity = "differs";
      notes.push(`${a.kind !== b.kind ? `kind ${a.kind}→${b.kind}; ` : ""}fields: ${diff.join(", ") || "none"}`);
    }
  }
  for (const p of active) {
    const misses = (results[p]?.[c.id] ?? []).flat().flatMap((t) => t.checks);
    if (misses.length) notes.push(`${p}: ${[...new Set(misses)].slice(0, 3).join("; ")}`);
  }
  out.push(`| ${c.id} | ${c.group} | ${active.map((p) => `${m[p].n}/${m[p].total}`).join(" | ")} | ${parity} | ${notes.join(" · ").replace(/\|/g, "/")} |`);
}
out.push(``, `Production writes swallowed by the shim (never sent): ${blocked.length}.`);
writeFileSync(join(OUT_DIR, "agent-provider-compare-report.md"), out.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "agent-provider-compare-results.json"), JSON.stringify({ repeats: REPEATS, groqModel: GROQ_MODEL, reasoningEffort: GROQ_REASONING_EFFORT, selftest: SELFTEST, swallowedWrites: blocked.length, results }, null, 1));
realLog(out.join("\n"));
