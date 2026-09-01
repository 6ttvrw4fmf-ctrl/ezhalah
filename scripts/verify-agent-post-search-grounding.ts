// THE POST-SEARCH BROKER LINE MUST SPEAK FROM REAL DATABASE TRUTH (owner ruling 2026-08-29).
// Auto-discovered barrier + edge-deploy gate.
//
// THE TWO HALVES. The edge writes its reply BEFORE the search runs, so it may never claim inventory
// (verify-agent-broker-grounding.ts). This is the other half: AFTER the real RPC returns, the client
// may state a count — but ONLY the one the existing honest-total mechanism sanctions.
//
// quotableTotal() (src/data/search.ts) is that mechanism and the ONLY count source. It returns null —
// meaning "no honest count exists, say nothing numeric" — when the set is empty, when the budget was
// annualized (the RPC never applied that bound), or under client-only narrowing, because in those
// cases the RPC total OVERSTATES what the user can actually reach.
//
// OWNER RULES PINNED HERE: no unverified counts · no second count source · no silent widening ·
// zero-result relaxation is an OFFER requiring explicit approval · the reply must match the executed
// query/result state.
import { readFileSync } from "node:fs";
import { liftSymbols } from "./lib/liftSymbols.ts";

// src/data/search.ts uses extension-less imports Node's ESM loader rejects, so quotableTotal cannot
// be imported directly. Lift the REAL function and its real dependency chain rather than keeping a
// copy — a copy is a test that passes while production breaks.
const lifted = await liftSymbols(
  new URL("../src/data/search.ts", import.meta.url).pathname,
  [
    { header: "const numOrNull = " },
    { header: "export function bedroomTokens(" },
    { header: "export function bedroomSpec(" },
    { header: "export function hasClientOnlyNarrowing(" },
    { header: "export function quotableTotal(" },
  ],
  ["quotableTotal", "hasClientOnlyNarrowing"],
  "type SearchQuery = any; type SearchResult = any;",
);
const quotableTotal = lifted.quotableTotal as (r: unknown) => number | null;

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const eq = (l: string, a: unknown, b: unknown) =>
  check(l, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const R = (o: Record<string, unknown>) =>
  ({ heading: "", notes: [], listings: [], ...o }) as never;

console.log("── quotableTotal is the single arbiter of a stateable count ──");
eq("a real match total is quotable", quotableTotal(R({ matchTotal: 34, listings: [1, 2], query: { priceInput: "" } })), 34);
eq("zero is NEVER a quotable count (the caller has its own no-results copy)",
  quotableTotal(R({ matchTotal: 0, listings: [], query: { priceInput: "" } })), null);
// The RPC never applied an annualized budget bound, so its total overstates the reachable set.
eq("an annualized budget makes the count UNQUOTABLE",
  quotableTotal(R({ matchTotal: 34, listings: [1], query: { priceIsAnnual: true, priceInput: "" } })), null);
eq("falls back to the page length only when there is no matchTotal",
  quotableTotal(R({ listings: [1, 2, 3], query: { priceInput: "" } })), 3);

console.log("\n── the client quotes ONLY that number, and stays silent when there is none ──");
const ui = readFileSync(new URL("../src/app/agent.tsx", import.meta.url), "utf8");
check("the intro count comes from quotableTotal", /const introTotal = quotableTotal\(m\.result\);/.test(ui));
check("a NULL total falls back to non-numeric text, never a number",
  /introTotal != null\s*\n?\s*\? t\('We found \{n\} listings matching your search\.'[\s\S]{0,80}?: m\.text/.test(ui),
  "when no honest count exists the reply must say something truthful and non-numeric");
// A second count source is how two numbers describing the SAME search end up on screen.
check("the intro never quotes result.total (this page's buffer length, <= QUERY_LIMIT)",
  !/introText[\s\S]{0,200}m\.result\.total/.test(ui));
check("the intro never quotes listings.length as a count",
  !/t\('We found \{n\} listings[^)]*m\.result\.listings\.length/.test(ui));
check("the mining beat uses the SAME arbiter (one number for one search)",
  /const honestTotal = quotableTotal\(result\);/.test(ui));

console.log("\n── zero results: honest, and relaxation is an OFFER ──");
check("zero results renders the suggestion, not a count",
  /const introZeroResult = m\.result\.listings\.length === 0;/.test(ui)
  && /introZeroResult\s*\n?\s*\? \(m\.result\.suggestion \?\? t\('No exact matches/.test(ui));
const search = readFileSync(new URL("../src/data/search.ts", import.meta.url), "utf8");
// STRUCTURAL GUARANTEE: a suggestion is a STRING on SearchResult. It cannot carry a query change, so
// it is incapable of silently widening anything — the user must act on it.
check("suggestion is typed as a string, so it cannot silently mutate the query",
  /suggestion\?: string;/.test(search),
  "if this ever becomes an object carrying a query, silent widening becomes possible");
check("the relaxation copy ASKS rather than announces", (() => {
  const i18n = readFileSync(new URL("../src/i18n.tsx", import.meta.url), "utf8");
  const offers = i18n.match(/'No (?:matches|listings)[^']*Want me to[^']*':\s*\n?\s*'([^']+)'/g) ?? [];
  return offers.length >= 3 && offers.every((o) => /؟'/.test(o));
})(), "every zero-result relaxation line must end in a question mark — an offer, never an action");
check("relaxation is one field at a time, ordered by least attachment",
  /prefer to relax the field the user is LEAST attached to/.test(search));
check("nothing auto-applies a relaxation",
  !/applySuggestion|autoWiden|autoRelax/.test(ui + search),
  "the query must not change until the user explicitly agrees");

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — the post-search reply can state an unverified count`);
  process.exit(1);
}
console.log("\nOK — counts come only from quotableTotal; zero results offer, never widen");
