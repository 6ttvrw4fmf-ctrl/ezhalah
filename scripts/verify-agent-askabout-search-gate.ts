// ASK_ABOUT IS A VALID SEARCH SIGNAL FOR THE nothingToSearchOn GATE (owner ruling 2026-08-30).
//
// THE BUG: supabase/functions/agent/index.ts's nothingToSearchOn gate decides whether to accept the
// model's own kind="listings" decision or silently downgrade the final response to kind="message".
// It checked location/type/price/detail/amenities/af — but NOT ask_about, the field the model uses
// to record real signal that doesn't map to a hard filter (e.g. "something big" -> ask_about=
// ["size"], with no firm type). So once the model's question budget was already spent and it
// correctly decided kind="listings" on ask_about-only signal, this gate downgraded it back to a
// question anyway — the same class of bug as the two sibling fixes in PR #1361 (a downstream gate
// overriding a valid model decision without knowing the budget/signal state).
//
// PROOF (reconfirmed live against production 2026-08-30, see PR description): ai_usage id 9575 shows
// raw model kind="listings" for a call shaped exactly this way (type-less, budget spent, "بس ودي شي
// كبير" -> ask_about=["size"]); the response actually returned to the client was kind="message" with
// an empty query. scripts/check_audit_invariants.py's check_agent_broad_search_after_budget()
// reproduces this end-to-end against the live endpoint; this file pins the DETERMINISTIC, mutation-
// proof half — the gate expression itself — without a live model call.
//
// WHY EXTRACT RATHER THAN RE-TYPE (feedback_never-test-a-copy-of-production-code): a hand-typed copy
// of the gate would drift from the real one and could stay green while the deployed expression rots.
// This pulls the ACTUAL `nothingToSearchOn` expression text out of the source and evaluates it, so a
// future edit that reintroduces the bug (or that weakens the gate into accepting nothing at all) is
// caught here, not just in a live/paid call.
//
//   node --experimental-strip-types scripts/verify-agent-askabout-search-gate.ts  (auto-discovered by npm test)

import { readFileSync } from "node:fs";

const edge = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};

// ── extract the REAL askAboutList line + the REAL nothingToSearchOn expression ──────────────────
const askAboutMatch = edge.match(
  /const askAboutList = Array\.isArray\(out\.ask_about\)\s*\n\s*\? (.+?)\s*\n\s*: \[\];/s
);
if (!askAboutMatch) throw new Error("askAboutList definition not found in the deployed source");
const askAboutMapExpr = askAboutMatch[1]; // e.g. out.ask_about.filter(...).map(...)

const gateMatch = edge.match(/const nothingToSearchOn =\s*\n([\s\S]*?);\s*\n\s*if \(nothingToSearchOn\)/);
if (!gateMatch) throw new Error("nothingToSearchOn expression not found in the deployed source");
const gateExpr = gateMatch[1];

check("askAboutList is reused (not re-filtered) inside the gate expression",
  gateExpr.includes("askAboutList"),
  "the gate must reference the SAME sanitized list the query.askAbout field ships, not a second copy");
check("the query object ships askAbout: askAboutList (single source, no duplicate filter)",
  /askAbout: askAboutList,/.test(edge),
  "a second inline filter here is exactly how the gate and the shipped field drift apart");

// Build a real evaluator for the extracted expression against synthetic `out`/`location`/`price`/
// `detailStr` — this is the ACTUAL production boolean logic, not a re-implementation of it.
const evalGate = (vars: {
  location?: string; type?: string; price?: string; detailStr?: string;
  amenities?: unknown[]; af?: Record<string, unknown>; askAbout?: unknown[];
}) => {
  const location = vars.location ?? "";
  const price = vars.price ?? "";
  const detailStr = vars.detailStr ?? "";
  const out = { type: vars.type ?? "", amenities: vars.amenities ?? [], af: vars.af ?? {}, ask_about: vars.askAbout ?? [] };
  // The extracted expression is TypeScript (typed arrow-fn params); `new Function` only runs plain
  // JS. Strip the single-identifier param-type annotations this specific snippet uses — this is
  // erasure of syntax `new Function` can't parse, not a rewrite of the logic under test.
  const asJs = (src: string) => src.replace(/\(([a-zA-Z_$][\w$]*): \w+\)/g, "($1)");
  // eslint-disable-next-line no-new-func
  const askAboutList = new Function("out", `return ${asJs(askAboutMapExpr)};`)(out);
  // eslint-disable-next-line no-new-func
  return new Function("location", "out", "price", "detailStr", "askAboutList", `return (${gateExpr});`)(
    location, out, price, detailStr, askAboutList
  );
};

console.log("\n── ask_about-only signal, budget spent -> listings is accepted (THE FIX) ──");
check('ask_about=["size"], everything else empty -> nothingToSearchOn === false',
  evalGate({ askAbout: ["size"] }) === false,
  "the exact production bug: this used to evaluate true and silently downgrade a valid kind=\"listings\" to kind=\"message\"");
check('ask_about=["rating"] alone also counts as real signal',
  evalGate({ askAbout: ["rating"] }) === false);
check("a whitespace-only / empty-string ask_about entry is NOT meaningful signal",
  evalGate({ askAbout: ["", "   "] }) === true,
  "an array of blanks is not signal — must still gate to message");

console.log("\n── truly nothing, including ask_about, still correctly downgrades (NEGATIVE CASE) ──");
check("all fields empty (including ask_about: []) -> nothingToSearchOn === true",
  evalGate({}) === true,
  "the gate's real protective purpose must survive — an honest 'nothing to go on' must still ask");
check("all fields empty, ask_about explicitly [] -> still true",
  evalGate({ askAbout: [] }) === true);

console.log("\n── existing signals still work unchanged (no regression on the other branches) ──");
check("type-only is still allowed through", evalGate({ type: "شقة" }) === false);
check("location-only is still allowed through", evalGate({ location: "الرياض" }) === false);
check("price-only is still allowed through", evalGate({ price: "500000" }) === false);
check("detail-only is still allowed through", evalGate({ detailStr: "3" }) === false);
check("amenities-only is still allowed through", evalGate({ amenities: ["parking"] }) === false);
check("af-only is still allowed through", evalGate({ af: { property_age: "new" } }) === false);

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — ask_about is not honored as search signal by the gate`);
  process.exit(1);
}
console.log("\n✅ verify-agent-askabout-search-gate: all checks passed.\n");
