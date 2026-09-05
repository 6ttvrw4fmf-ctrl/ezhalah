// SMALL FINAL SET RENDERS IN FULL + THUMBS SURVIVE ZERO RESULTS (owner 2026-08-30).
// Auto-discovered barrier.
//
// Part 5: "13 results → shows 10 + عرض المزيد" was FIRST_PAGE=10 applied unconditionally. The cutoff is
// the CANONICAL INTERVIEW_STOP_AT (25) — no second threshold was invented. Part 7: the zero-result
// branch rendered `null`, so the response-level thumbs vanished merely because listing count = 0.
import { readFileSync } from "node:fs";
import { initialReveal } from "../src/lib/initialReveal.ts";
import { INTERVIEW_STOP_AT } from "../src/lib/afRanking.ts";
import { resultCounts } from "../src/data/resultCount.ts";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const FP = 10, STOP = INTERVIEW_STOP_AT;
const r = (fetched: number, honestTotal: number | null) => initialReveal({ fetched, honestTotal, firstPage: FP, stopAt: STOP });

console.log("── the owner's exact case ──");
check("13 matches → all 13 revealed, no «عرض المزيد»", r(13, 13) === 13);
check("...and resultCounts agrees there is nothing more", resultCounts({ trueTotal: 13, shown: 13, fetched: 13, serverMore: false }).hasMore === false);

console.log("\n── the cutoff IS the canonical stop line, not a new number ──");
check(`stopAt is INTERVIEW_STOP_AT = ${STOP} (imported, never retyped; owner 2026-09-04: 50)`, STOP === 50);
check("exactly at the stop line (50) → all revealed", r(50, 50) === 50);
check("one past the stop line (51) → first page only (larger sets are untouched)", r(51, 51) === FP);
check("a 111-result set still previews 10", r(111, 111) === FP);
check("a 1,500-buffered broad set still previews 10", r(1500, 9892) === FP);

console.log("\n── honesty: an UNTRUSTWORTHY total never triggers reveal-all ──");
check("honestTotal null (client-only narrowing / annualized budget) → first page, even with 13 fetched", r(13, null) === FP);
check("a small honest total with a bigger buffer reveals only what is honest? — no: reveals the buffer, which IS the set",
  r(13, 13) === 13);
check("zero results → 0", r(0, 0) === 0);
check("never reveals more than is buffered", r(7, 25) === 7);

console.log("\n── wiring: every initial-reveal site delegates to the pure function ──");
const agent = readFileSync(new URL("../src/app/agent.tsx", import.meta.url), "utf8");
check("agent.tsx imports the pure initialReveal", /import \{ initialReveal as initialRevealPure \} from '@\/lib\/initialReveal';/.test(agent));
check("the local wrapper feeds it quotableTotal (the honest total) and INTERVIEW_STOP_AT",
  // `platforms:` was added by the 2026-09-02 initial-batch rule (the first screen carries one
  // listing from every matching platform, so FIRST_PAGE became a floor). The guarantee this check
  // exists for is unchanged: the wrapper must still feed the HONEST total and the canonical stopAt.
  /initialRevealPure\(\{ fetched: r\?\.listings\?\.length \?\? 0, honestTotal: r \? quotableTotal\(r\) : null, firstPage: FIRST_PAGE, stopAt: INTERVIEW_STOP_AT, platforms: distinctPlatformCount\(r\?\.listings\) \}\)/.test(agent));
const raw = (agent.match(/Math\.min\(FIRST_PAGE, [^)]*\)/g) ?? []);
check(`no raw Math.min(FIRST_PAGE, …) reveal remains (found ${raw.length})`, raw.length === 0, raw.slice(0, 3).join(" | "));
check("the initial drip, the restore path and the render path all use initialReveal",
  (agent.match(/initialReveal\(/g) ?? []).length >= 7);

console.log("\n── part 7: thumbs up/down on a zero-result turn ──");
const zero = agent.slice(agent.indexOf("m.result.listings.length === 0 ? ("), agent.indexOf("m.result.listings.length === 0 ? (") + 900);
check("the zero-result branch renders the FeedbackRow (not null)",
  /<FeedbackRow feedbackKey=\{m\.id\} onFeedback=\{showFbToast\}/.test(zero) && !/\n\s*null\n\s*\) : \(/.test(zero));
check("its read-aloud reads the zero-result intro alone (no phantom listings)",
  /buildResultsReadAloudSegments\(introText, \[\], undefined\)/.test(zero));
check("the non-zero branch still has its own FeedbackRow (two sites total)",
  (agent.match(/<FeedbackRow feedbackKey=\{m\.id\}/g) ?? []).length === 2);

if (failed) { console.error(`\n✗ ${failed} check(s) FAILED`); process.exit(1); }
console.log("\nOK — small final sets render in full at the canonical stop line; thumbs survive zero results");
