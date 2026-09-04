#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
/**
 * verify-filter-never-calls-agent — auto-discovered barrier (see scripts/run-tests.mjs).
 *
 * Owner concern (2026-08-28): "in advanced filter and normal filter we never want to use deep seek
 * api". DeepSeek is prepaid — every accidental invocation from Filter/AF/Interview would burn real
 * balance. Chat is the ONLY path that should reach the agent edge function; Filter is Postgres-only.
 *
 * This barrier pins that boundary: the ONLY file allowed to call the `agent` edge function is
 * src/data/agent.ts, and the ONLY file allowed to import from src/data/agent is src/app/agent.tsx.
 * A stray import from Filter/AF/Interview code fails the build.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const AGENT_INVOKER_ALLOWED = new Set(["src/data/agent.ts"]);
const AGENT_IMPORTER_ALLOWED = new Set(["src/app/agent.tsx"]);
const AGENT_INVOKE_RE = /supabase\.functions\.invoke\s*\(\s*['"]agent['"]/;
const AGENT_IMPORT_RE = /from\s+['"](?:@\/|\.{1,2}\/)?(?:.*\/)?data\/agent(?:['"]|\/)/;
// Anything reaching the DeepSeek API from client code is a bug — the API is server-only.
const DEEPSEEK_URL_RE = /api\.deepseek\.com/;
const DEEPSEEK_KEY_RE = /DEEPSEEK_API_KEY/;

const failures: string[] = [];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* walk(full); continue; }
    if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

for (const path of walk("src")) {
  const rel = path.replace(/^\.\//, "");
  const src = readFileSync(path, "utf8");
  if (AGENT_INVOKE_RE.test(src) && !AGENT_INVOKER_ALLOWED.has(rel)) {
    failures.push(`${rel}: calls supabase.functions.invoke('agent') — only ${[...AGENT_INVOKER_ALLOWED].join(", ")} may. This burns DeepSeek balance every call.`);
  }
  if (AGENT_IMPORT_RE.test(src) && !AGENT_IMPORTER_ALLOWED.has(rel) && !AGENT_INVOKER_ALLOWED.has(rel)) {
    failures.push(`${rel}: imports from data/agent — only ${[...AGENT_IMPORTER_ALLOWED].join(", ")} may. Chat is the sole DeepSeek surface.`);
  }
  if (DEEPSEEK_URL_RE.test(src) || DEEPSEEK_KEY_RE.test(src)) {
    failures.push(`${rel}: references DeepSeek API/key directly. DeepSeek lives ONLY in supabase/functions/agent/index.ts.`);
  }
}

if (failures.length) {
  console.error("verify-filter-never-calls-agent: FAIL — Filter/AF must never reach DeepSeek");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("verify-filter-never-calls-agent: OK — chat is the only DeepSeek path.");
