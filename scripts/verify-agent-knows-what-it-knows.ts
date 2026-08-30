// THE AGENT MUST KNOW WHAT IT ALREADY KNOWS (owner ruling 2026-08-29).
// Auto-discovered barrier + edge-deploy gate.
//
// THE PRINCIPLE. Advanced Filter is for a user who already knows exactly what to search and selects
// it manually. The AI Agent must accept that SAME completeness in one sentence — and must also be
// able to discover the need through conversation. What it must never do is behave like a slower
// Advanced Filter: "The agent must be aware of what it already knows. It should never ask a question
// whose answer already exists in the conversation or current search state."
//
// THE ARCHITECTURAL GAP THIS CLOSES. The edge function received only the raw text, the chat history
// and a landmark hint — it NEVER received the canonical query. So the model had to re-derive every
// field from prose each turn and had no structured view of its own accumulated state. Sending that
// state is what makes "don't ask what you already know" enforceable rather than hopeful.
import { readFileSync } from "node:fs";
import { describeKnownState } from "../src/lib/conversationState.ts";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};

console.log("── the state summary names every dimension the user can establish ──");
const rich = {
  deal: "Rent", rentPeriod: "monthly", type: "Apartment", location: "الرياض", detail: "2",
  price: "72000", priceIsAnnual: true, furnishedPref: true, amenities: ["elevator"],
  ratingMin: 9, bathMin: 2, ageMin: 1, ageMax: 2, streetWidthMin: 20,
  directions: ["شمال"], unitSubtypes: ["شقة"], sources: ["Aqar"],
} as never;
const desc = describeKnownState(rich);
for (const token of ["rentPeriod=monthly", "propertyType=Apartment", "location=الرياض",
                     "bedroomsOrSize=2", "furnished=true", "amenities=elevator", "ratingMin=9",
                     "bathroomsMin=2", "streetWidthMin=20", "direction=شمال", "unitSubtype=شقة",
                     "platforms=Aqar"]) {
  check(`summary carries ${token}`, desc.includes(token), desc);
}
// An annualized budget read as a monthly figure would make the model restate a wrong number.
check("an annualized budget is labelled as such", desc.includes("budget=72000 (annual-equivalent)"), desc);

console.log("\n── it says nothing when nothing is known (a first turn must not be polluted) ──");
check("null state → empty", describeKnownState(null) === "");
check("empty query → empty", describeKnownState({} as never) === "");
check("a false furnishedPref is still STATED (it is a real constraint)",
  describeKnownState({ furnishedPref: false } as never).includes("furnished=false"));

console.log("\n── wiring: the model actually receives it, and is told not to re-ask ──");
const client = readFileSync(new URL("../src/data/agent.ts", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
check("the client sends knownState", /knownState: describeKnownState\(ctx\.prevQuery\) \|\| undefined,/.test(client));
check("it is derived from the ACCUMULATED state, not this turn's output",
  /describeKnownState\(ctx\.prevQuery\)/.test(client));
check("the edge reads it", /knownState = String\(body\?\.knownState \?\? ""\)/.test(edge));
check("...bounded, so a long state cannot bloat every request", /\.slice\(0, 600\)/.test(edge));
check("the edge puts it in the turn the model sees", /\$\{budgetDirective\}\$\{knownLine\}/.test(edge));
check("the instruction is a PROHIBITION, not a hint",
  /do NOT ask about any of these again/.test(edge),
  "a polite hint is not enough — the model had no structured view of its own state at all");
check("...and still allows an explicit change to override",
  /only change one if the user's latest message explicitly changes it/.test(edge));

console.log("\n── deterministic floors found by this audit ──");
check("an empty reply can never ship",
  /if \(!r\.trim\(\)\) return locale === "en" \? "Got it — searching now\." : "تمام، أدوّر لك الحين\.";/.test(edge),
  "«غرفتين» produced a turn with NO reply text — the user saw silence");
check("the model is TOLD exactly one question per turn",
  /exactly ONE short question per turn — one question mark, never two questions stacked/.test(edge));
// Telling it was not enough — production still stacked two («وش نوع الشقة؟ وهل تبيها إيجار أو تمليك؟»).
// Prompt wording is a preference; this is the deterministic floor under it.
check("a DETERMINISTIC floor enforces it", /function oneQuestionOnly\(reply: string\): string/.test(edge));
check("it keeps the lead-in and drops only the extra questions",
  /return Number\.isFinite\(first\) \? r\.slice\(0, first \+ 1\)\.trim\(\) : r;/.test(edge));
// UPDATED (owner-approved unified-agent-search-authority consolidation, 2026-08-30): the empty-
// search clarification and the plain message path used to be two separate return sites, each
// spelling out its own oneQuestionOnly(groundReply(...)). decideAgentTurn() now decides ONCE whether
// a turn is a clarification at all, so both collapsed into the SAME return — one path, still floored.
check("the one remaining clarification path is floored",
  (edge.match(/oneQuestionOnly\(groundReply\(/g) ?? []).length === 1,
  "the empty-search case and the plain-message case are now the SAME return statement");
check("a single question is left untouched", /if \(!marks \|\| marks\.length < 2\) return r;/.test(edge));

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — the agent can re-ask what it already knows`);
  process.exit(1);
}
console.log("\nOK — the agent sees its own state and is forbidden from re-asking it");
