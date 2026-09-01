// AI AGENT HEALTH ALERT (owner request 2026-08-29). Auto-discovered barrier + edge-deploy gate.
//
// WHY. The agent ran BROKEN for ~14.5 hours on 2026-08-29 — 213 failed calls — and nobody knew until
// the DeepSeek bill was read by hand. The client falls back to its bundled offline heuristic on ANY
// failure (src/data/agent.ts:571), so users kept seeing results and the outage was SILENT.
//
// THE RULE THIS PROTECTS: a turn the fallback rescued is still an AI FAILURE. Any change that makes
// `fallback_certain` mean "the user saw an error" instead of "the AI did not answer" re-creates the
// exact blindness that hid the outage — so it is pinned here.
import { readFileSync } from "node:fs";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};

const edge = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
const mig = readFileSync(
  new URL("../supabase/migrations/20260829200000_agent_health_telemetry_and_detector.sql", import.meta.url), "utf8");

console.log("── the agent must emit a Postgres-visible heartbeat ──");
// Postgres cannot read Supabase edge logs, so without this write the detector framework is blind.
check("recordHealth() exists", /function recordHealth\(/.test(edge));
check("it writes to agent_health_event", /rest\/v1\/agent_health_event/.test(edge));
// Must be a REAL STATEMENT, not merely the string appearing somewhere. `void 0 && recordHealth("ok",`
// contains the substring while recording nothing — that mutation escaped the first version of this
// check, and a failure rate with no denominator silently reads as 0%.
check("SUCCESS is recorded, not only failures (a rate needs a denominator)",
  /\n\s*recordHealth\("ok",/.test(edge),
  "the success call must be a bare statement — dead-coding it makes every rate read 0%");
for (const o of ["model_http_error", "empty_output", "unparseable", "no_classification", "model_not_configured"]) {
  check(`failure outcome recorded: ${o}`, new RegExp(`recordHealth\\("${o}"`).test(edge));
}

console.log("\n── telemetry must never break a user turn ──");
const fn = (edge.match(/function recordHealth\([\s\S]*?\n\}/) ?? [""])[0];
check("the write is NOT awaited (fire-and-forget)", /void fetch\(/.test(fn) && !/await fetch\(/.test(fn));
check("the fetch rejection is swallowed", /\.catch\(\(\) => \{\}\)/.test(fn));
check("the whole body is wrapped in try/catch", /try \{[\s\S]*\} catch \{/.test(fn));

console.log("\n── FALLBACK counts as failure (the rule that makes this alert worth having) ──");
check("fallback_certain is true whenever the outcome is not ok",
  /outcome !== "ok" \|\| latencyMs > CLIENT_TIMEOUT_MS/.test(fn),
  "if this becomes `outcome !== 'ok' && ...` a failing agent stops alerting");
check("a turn slower than the CLIENT's race also counts (the user already got the heuristic)",
  /const CLIENT_TIMEOUT_MS = 20_000;/.test(edge) && /latencyMs > CLIENT_TIMEOUT_MS/.test(fn));

console.log("\n── detector: real thresholds and real false-positive protection ──");
check("detector exists in the migration", /create or replace function public\.mon_detect_agent_health/.test(mig));
check("TWO adjacent windows must BOTH breach (no alert on one bad minute)",
  /cur_rate >= 0\.20 and prv_rate >= 0\.20/.test(mig));
check("both windows need a real sample floor",
  /cur_total >= min_sample and prv_total >= min_sample/.test(mig));
const ms = mig.match(/min_sample int := (\d+);/);
check(`sample floor is meaningful (${ms?.[1] ?? "?"})`, !!ms && parseInt(ms[1], 10) >= 10,
  "below ~10 turns a percentage is noise, not a signal");
check("severity escalates with the rate", /cur_rate >= 0\.50 then 'P0' else 'P1'/.test(mig));
check("latency is monitored against the client timeout", /cur_p90 > 20000/.test(mig));
check("alerts auto-resolve when the agent recovers",
  /mon_resolve_stale_keys\('agent_health'/.test(mig));
check("telemetry is bounded (ops data cannot grow forever)",
  /delete from public\.agent_health_event where at < now\(\) - interval '14 days'/.test(mig));

console.log("\n── routed into the EXISTING engineering ownership system ──");
// mon_raise -> alert_event -> mon_dispatch_alerts -> alert-dispatch.yml -> one GitHub issue per
// dedup_key. Raising through mon_raise is what puts this in front of a human.
check("raises through mon_raise (not a bespoke channel)", /public\.mon_raise\(/.test(mig));
check("uses a stable dedup key per condition",
  /'agent_failure_rate'/.test(mig) && /'agent_latency'/.test(mig));
check("severity is P0/P1/P2 — the set alert-dispatch.yml actually delivers",
  /'P0'/.test(mig) && /'P1'/.test(mig) && /'P2'/.test(mig));
check("the alert tells the responder that users are NOT seeing an error",
  /bundled offline heuristic/.test(mig));

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — the agent health signal is not intact`);
  process.exit(1);
}
console.log("\nOK — agent health alert intact: failure rate, fallback, latency, routed, low-noise");
