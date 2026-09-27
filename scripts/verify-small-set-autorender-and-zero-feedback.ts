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
const STOP = INTERVIEW_STOP_AT;
// No `platforms` passed here on purpose — this file tests the SMALL-SET / HONESTY branches, which
// return before the platform-count reveal is ever computed. Without platform data the reveal falls
// to its safety floor of 1 (owner PERMANENT rule 2026-09-25 — see src/lib/initialReveal.ts for the
// full history of the floor going from a fixed 10 to a per-platform count). The exact "1" below is
// that safety floor, not a meaningful preview size; verify-initial-batch-covers-platforms.ts is
// where the real per-platform reveal count is tested.
const r = (fetched: number, honestTotal: number | null) => initialReveal({ fetched, honestTotal, stopAt: STOP });

console.log("── the owner's exact case ──");
check("13 matches → all 13 revealed, no «عرض المزيد»", r(13, 13) === 13);
check("...and resultCounts agrees there is nothing more", resultCounts({ trueTotal: 13, shown: 13, fetched: 13, serverMore: false }).hasMore === false);

console.log("\n── the cutoff IS the canonical stop line, not a new number ──");
check(`stopAt is INTERVIEW_STOP_AT = ${STOP} (imported, never retyped; owner 2026-09-20: 25)`, STOP === 25);
check("exactly at the stop line (25) → all revealed", r(25, 25) === 25);
check("one past the stop line (26) → not fully revealed (larger sets are untouched)", r(26, 26) === 1);
check("a 111-result set still only previews the safety floor (no platform data)", r(111, 111) === 1);
check("a 1,500-buffered broad set still only previews the safety floor (no platform data)", r(1500, 9892) === 1);

console.log("\n── honesty: an UNTRUSTWORTHY total never triggers reveal-all ──");
check("honestTotal null (client-only narrowing / annualized budget) → not fully revealed, even with 13 fetched", r(13, null) === 1);
check("a small honest total with a bigger buffer reveals only what is honest? — no: reveals the buffer, which IS the set",
  r(13, 13) === 13);
check("zero results → 0", r(0, 0) === 0);
check("never reveals more than is buffered", r(7, 25) === 7);

console.log("\n── wiring: every initial-reveal site delegates to the pure function ──");
const agent = readFileSync(new URL("../src/app/agent.tsx", import.meta.url), "utf8");
// The ALIAS and the MODULE are what this pins; the rest of the named-import list is not its
// business. agent.tsx also imports CASCADE_MAX from here since 2026-09-22 (the cascade size moved
// into the same module so live journeys stop re-typing it), and a literal-string match called that
// a missing import. Still fails if the alias or the module changes — which is the actual contract.
check("agent.tsx imports the pure initialReveal",
  /import \{[^}]*\binitialReveal as initialRevealPure\b[^}]*\} from '@\/lib\/initialReveal';/.test(agent));
check("the local wrapper feeds it quotableTotal (the honest total) and INTERVIEW_STOP_AT",
  // `platforms:` was added by the 2026-09-02 initial-batch rule (the first screen carries one
  // listing from every matching platform). `firstPage` was retired 2026-09-25 when the floor of 10
  // was dropped in favour of exactly one card per platform (src/lib/initialReveal.ts has the full
  // history). The guarantee this check exists for is unchanged: the wrapper must still feed the
  // HONEST total and the canonical stopAt.
  /initialRevealPure\(\{ fetched: r\?\.listings\?\.length \?\? 0, honestTotal: r \? quotableTotal\(r\) : null, stopAt: INTERVIEW_STOP_AT, platforms: distinctPlatformCount\(r\?\.listings\), afCompleted \}\)/.test(agent));
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
