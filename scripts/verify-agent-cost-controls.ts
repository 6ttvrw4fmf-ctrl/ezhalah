// Owner ruling 2026-08-29, after the DeepSeek cost audit. Auto-discovered barrier; also part of the
// edge-deploy gate (scripts/verify-agent-*.ts glob).
//
// WHAT THE AUDIT FOUND. On 2026-08-29 the agent served 525 requests. SIX were the owner. The rest was
// CI and test automation, and every single call carried a 66,040-char fixed system message before the
// user's words were added — the user's actual text was ~0.1% of what was billed.
//
// These are the cost controls that came out of it. Each one is cheap to delete by accident and
// expensive to lose, so each is pinned here.
import { readFileSync } from "node:fs";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};

const edge = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
const cta = readFileSync(new URL("../.github/workflows/af-live-truth-check.yml", import.meta.url), "utf8");

console.log("── agent_notes budget cap (the DB can no longer grow the prompt without bound) ──");
check("NOTES_CHAR_BUDGET constant exists", /const NOTES_CHAR_BUDGET = [\d_]+;/.test(edge));
const m = edge.match(/const NOTES_CHAR_BUDGET = ([\d_]+);/);
const budget = m ? parseInt(m[1].replace(/_/g, ""), 10) : 0;
// A ratchet, not headroom. Today's live content is 19,854 chars; anything far above that is not a cap.
check(`budget is a real ceiling, not a rubber stamp (${budget.toLocaleString()} chars)`,
  budget > 0 && budget <= 30_000, `got ${budget}; >30,000 stops being a constraint on a 19,854-char body`);
check("liveNotes() enforces the budget", /used \+ block\.length > NOTES_CHAR_BUDGET/.test(edge));
check("whole rows are dropped, never truncated mid-rule (half a rule can invert its meaning)",
  edge.includes("{ dropped++; continue; }") && !/\.slice\(0,\s*NOTES_CHAR_BUDGET\)/.test(edge));
check("dropping is LOUD — a silently truncated authoritative rule set must never be quiet",
  /console\.warn\(`agent_notes over budget/.test(edge));

console.log("\n── cost observability (without this every cost figure is a guess) ──");
check("DeepSeek cache-hit tokens are recorded",
  /cache_hit_tokens:\s*data\?\.usage\?\.prompt_cache_hit_tokens/.test(edge));
check("DeepSeek cache-miss tokens are recorded",
  /cache_miss_tokens:\s*data\?\.usage\?\.prompt_cache_miss_tokens/.test(edge));
check("usage is logged on SUCCESS, not only inside an error payload",
  /console\.log\(JSON\.stringify\(\{\s*\n?\s*evt:\s*"deepseek_usage"/.test(edge));

console.log("\n── the language retry must carry the same authority as the first call ──");
// It used to pass langLine only, so the reply shown to the user was generated WITHOUT the notes the
// code itself calls "authoritative". That is a correctness bug, not just a cost one.
const retryLine = (edge.match(/const retry: any = await runModel\([^;]*;/s) ?? [""])[0];
check("retry passes notesBlock", retryLine.includes("notesBlock"), retryLine.slice(0, 160));

console.log("\n── CORS preflight caching (halves the request COUNT; no model cost either way) ──");
check("Access-Control-Max-Age is set", /"Access-Control-Max-Age":\s*"\d+"/.test(edge));

console.log("\n── CI must not hammer the paid production agent ──");
// verify-af-agent-cta-live.ts drives 11 REAL messages through the paid agent per run.
const crons = [...cta.matchAll(/- cron:\s*'([^']+)'/g)].map((x) => x[1]);
check("af-live-truth-check has a cron", crons.length > 0);
check(`no sub-daily cron on the live-agent CTA check (found: ${crons.join(", ") || "none"})`,
  crons.every((c) => !/\*\/\d/.test(c.split(" ")[1] ?? "")),
  "an hour field like */6 means 4 runs/day x 11 paid agent messages = 44/day, against ~6 real user messages");
check("post-deploy verification is KEPT (the run that actually matters)",
  /workflow_run:/.test(cta) && /Deploy frontend \(production\)/.test(cta));

if (failed) {
  console.error(`\n✗ ${failed} cost-control check(s) FAILED`);
  process.exit(1);
}
console.log("\nOK — agent cost controls intact");
