// SINGLE-WRITER OWNERSHIP for the AI agent edge function (owner ruling 2026-08-29).
// Auto-discovered barrier + edge-deploy gate.
//
// WHY. supabase/functions/agent/index.ts is ~113KB of production code that several automation
// sessions edit. On 2026-08-29 two INDIVIDUALLY-CORRECT changes collided — the health heartbeat and
// the usage telemetry each added `const t0 = Date.now();` to the same scope in runModel() — and the
// function stopped booting. Every barrier was green, because they all read that file as TEXT.
//
// THE DISTINCTION THAT MATTERS (owner): parse protection catches SYNTAX collisions. It does NOT
// catch two logically valid changes that overwrite or contradict each other. Ownership + a final
// semantic diff is the answer to the second class; this barrier keeps both in place.
//
// Deliberately NOT a distributed lock system. It reuses acquire_deploy_lock(), added 2026-07-16
// after two concurrent Claude sessions independently deployed and rolled back production.
import { readFileSync, existsSync, statSync } from "node:fs";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const root = new URL("..", import.meta.url).pathname;
const read = (p: string) => (existsSync(root + p) ? readFileSync(root + p, "utf8") : "");

console.log("── the ownership tool exists and is runnable ──");
const lockTool = read("scripts/agent-surface.sh");
check("scripts/agent-surface.sh exists", lockTool.length > 0);
check("...and is executable", existsSync(root + "scripts/agent-surface.sh")
  && (statSync(root + "scripts/agent-surface.sh").mode & 0o111) !== 0);
check("it uses a DISTINCT lock name, so claiming it never blocks a normal deploy",
  /LOCK_NAME="agent-edge-surface"/.test(lockTool),
  "only ^prod names canonicalize to 'production' (deploy_lock_canonical)");
check("it reuses the EXISTING lock, not a new system",
  /rpc\/acquire_deploy_lock/.test(lockTool) && /rpc\/release_deploy_lock/.test(lockTool));
check("claim FAILS CLOSED when another session owns the surface",
  /REFUSING: '\$LOCK_NAME' is owned by another session/.test(lockTool)
  && /exit 1/.test(lockTool));
check("it tells a blocked session what to do instead",
  /Wait, hand off, or work on non-overlapping files/.test(lockTool));
check("the lock carries a TTL, so a crashed session cannot own it forever",
  /p_ttl_seconds/.test(lockTool));

console.log("\n── a successful deploy command is NOT production proof ──");
check("a REAL post-deploy smoke verb exists", /^\s*smoke\)/m.test(lockTool));
check("it calls the live endpoint the way a user does", /functions\/v1\/agent/.test(lockTool));
check("BOOT_ERROR fails the smoke test",
  /\*BOOT_ERROR\*\)\s*echo "FAIL: BOOT_ERROR/.test(lockTool),
  "the 2026-08-29 outage deployed 'successfully' and then BOOT_ERRORed on every request");
check("a response without a classification also fails", /FAIL: no classification/.test(lockTool));

console.log("\n── preflight: overlap detection + the SEMANTIC diff ──");
const pre = read("scripts/agent-surface-preflight.mjs");
check("scripts/agent-surface-preflight.mjs exists", pre.length > 0);
check("it detects OPEN PRs touching the same file",
  /gh pr list --state open/.test(pre) && /files\.includes\(FILE\)/.test(pre));
check("it refuses when the branch is behind main (stale rebase)",
  /commit\(s\) behind origin\/main — REBASE before merging/.test(pre));
check("it prints a SEMANTIC diff of the merged file against main",
  /SEMANTIC DIFF vs origin\/main/.test(pre));
check("it highlights REMOVED lines — where a silent overwrite hides",
  /this is where a silent overwrite hides/.test(pre));
check("it names repeated declarations (the 2026-08-29 outage signature)",
  /repeated declaration names/.test(pre));
check("it runs the real parse gate in `final`",
  /verify-edge-functions-parse\.ts/.test(pre));
check("it exits non-zero on any blocker (fail closed)", /process\.exit\(1\)/.test(pre));

console.log("\n── the parse gate it depends on still exists ──");
check("scripts/verify-edge-functions-parse.ts exists", read("scripts/verify-edge-functions-parse.ts").length > 0);

console.log("\n── the convention is written down where a session will read it ──");
const agents = read("AGENTS.md");
check("AGENTS.md documents the single-writer rule for this surface",
  /agent-surface\.sh/.test(agents) && /single.writer|SINGLE-WRITER/i.test(agents),
  "a convention nobody reads is not a convention");

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — the agent surface is not collision-protected`);
  process.exit(1);
}
console.log("\nOK — single writer, overlap detection, semantic diff, parse gate, real boot test");
