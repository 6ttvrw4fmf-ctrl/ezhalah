// verify-agent-provider-compare-harness — keeps the DeepSeek-vs-Groq comparison honest and harmless.
//
// scripts/agent-provider-compare.ts loads the REAL agent edge function and swaps the provider only at
// the network layer. That is only safe and only meaningful while three things hold, and every one of
// them can break silently when index.ts changes (a new Supabase call, a renamed field, a new env var):
//   1. it still loads and answers every case through the real handler (no stale harness),
//   2. the candidate arm really reaches the candidate model (not DeepSeek wearing a new label),
//   3. production telemetry writes are swallowed, never sent — and SELFTEST reaches no network at all
//      (the harness throws on any request it does not recognise, which fails this check).
// EXECUTED, not grepped: it runs the harness in SELFTEST mode (stubbed model, no keys, no network).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "agent-compare-"));
const failures: string[] = [];
try {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/agent-provider-compare.ts"], {
    env: { ...process.env, SELFTEST: "1", REPEATS: "1", OUT_DIR: out, GROQ_MODEL: "openai/gpt-oss-20b", DEEPSEEK_API_KEY: "", GROQ_API_KEY: "" },
    encoding: "utf8", timeout: 120_000,
  });
  if (r.status !== 0) {
    failures.push(`harness exited ${r.status ?? r.signal}: ${(r.stderr || r.stdout).trim().split("\n").slice(-4).join(" | ")}`);
  } else {
    const j = JSON.parse(readFileSync(join(out, "agent-provider-compare-results.json"), "utf8"));
    for (const p of ["deepseek", "groq"]) {
      const turns = Object.values(j.results[p] ?? {}).flat(2) as any[];
      if (!turns.length) failures.push(`${p}: no turns ran`);
      const bad = turns.filter((t) => t.status !== 200 || !t.kind);
      if (bad.length) failures.push(`${p}: ${bad.length} turn(s) did not return 200 + kind (first: ${bad[0].status} ${bad[0].error})`);
      const models = new Set(turns.flatMap((t) => t.calls.map((c: any) => c.model)));
      const want = p === "groq" ? "openai/gpt-oss-20b" : "deepseek-chat";
      if (models.size !== 1 || !models.has(want)) failures.push(`${p}: provider calls carried model ${[...models].join(",")}, expected only ${want}`);
    }
    if (!(j.swallowedWrites > 0)) failures.push("no production telemetry write was intercepted — the shim no longer sees ai_usage/agent_health_event");
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures.length) {
  console.error("verify-agent-provider-compare-harness: FAIL");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("verify-agent-provider-compare-harness: OK — real agent handler runs every case on both arms offline; candidate arm reaches the candidate model; production writes are swallowed.");
